"""LLM bridge for the Forgekin Council Web Chat.

This module is the *only* place where the web layer talks to real LLMs.
It wires :mod:`flowforge.llm.client.LLMClient` to the YAML configuration in
``config/llm_route.yaml`` + ``config/web_chat_prompts.yaml`` and exposes two
high-level async methods:

Migrated from `flowforge/web/llm_bridge.py` to
`flowforge/llm/council_bridge.py` — keeps the T7/T9/push_back/external-agent
advantages while adopting the modular `app/api/endpoints/` structure.

* :meth:`ForgekinLLMBridge.respond` — generate a forgekin's council reply.
* :meth:`ForgekinLLMBridge.audit_t7` — T7 audit of a primary forgekin reply
  using a *different* vendor (I9 no-self-review).

Design rules honoured:
- 铁律 3 — no direct instantiation of workers; LLMClient is built here from config.
- 铁律 5 — every prompt body lives in ``config/web_chat_prompts.yaml``; this
  module only renders templates with ``str.format_map``.
- T1       — real LLM calls only; no mock / template strings returned.
- T7       — audit method invokes a second LLM call to review the first.
- I9       — reviewer/audit chain is selected to differ from the author vendor.
- I11      — multi-turn context + push-back marker injected into user prompt.

The bridge is constructed once at FastAPI startup (DI-style) and reused
across requests; it is safe to call concurrently because ``LLMClient.complete``
creates a fresh ``httpx.AsyncClient`` per call.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from flowforge.core.errors import LLMError
from flowforge.core.tracing import get_logger, get_trace_id
from flowforge.forgemind.external_agents import (
    ExternalAgentAdapter,
    ExternalAgentError,
    ExternalAgentKind,
    load_adapters_from_config,
)
from flowforge.llm.client import FallbackEntry, LLMClient
from flowforge.llm.provider import (
    DirectProvider,
    LLMProvider,
    OpenRouteProvider,
    LLMResponse,
)

logger = get_logger("flowforge.llm.council_bridge")

# ── Public dataclasses ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class ForgekinReply:
    """Result of a single forgekin LLM call."""

    text: str
    model: str
    provider: str
    latency_ms: float
    finish_reason: str
    raw: dict[str, Any] | None = None

@dataclass(frozen=True)
class T7AuditResult:
    """Result of a T7 audit (LLM reviewing LLM output)."""

    score: float
    verdict: str  # "pass" | "fail"
    reasons: list[str]
    model: str
    provider: str
    latency_ms: float
    quality_threshold: float
    raw_text: str

# ── Internal helpers ─────────────────────────────────────────────────────────

class _SafeDict(dict):
    """dict subclass that returns '{key}' for missing keys, so str.format_map
    never raises KeyError on optional placeholders like {push_back_block}."""

    def __missing__(self, key: str) -> str:  # noqa: D401
        return "{" + key + "}"

def _env(name: str, default: str = "") -> str:
    """Read an environment variable, stripping surrounding whitespace."""
    val = os.environ.get(name, default)
    return val.strip() if isinstance(val, str) else default

def _bool_env(name: str, default: bool = False) -> bool:
    return _env(name, str(default)).lower() in {"1", "true", "yes", "on"}

def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"config file not found: {path}")
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"config file is not a mapping: {path}")
    return data

# ── Bridge ───────────────────────────────────────────────────────────────────

class ForgekinLLMBridge:
    """Bridge between the web chat layer and the LLM stack.

    Construct once at startup::

        bridge = ForgekinLLMBridge.from_config(config_dir)
        reply = await bridge.respond(fk_cfg, role="primary", user_content="...")
    """

    # Default fallback chain names from llm_route.yaml
    DEFAULT_CHAIN = "content_create"
    T7_CHAIN = "t7_audit"
    DEFAULT_QUALITY_THRESHOLD = 0.85  # P33

    def __init__(
        self,
        *,
        llm_route_cfg: dict[str, Any],
        prompts_cfg: dict[str, Any],
        config_dir: Path,
        quality_threshold: float | None = None,
        forgemind_cfg: dict[str, Any] | None = None,
    ) -> None:
        self._llm_route = llm_route_cfg
        self._prompts = prompts_cfg
        self._config_dir = config_dir
        self._quality_threshold = (
            quality_threshold
            if quality_threshold is not None
            else float(prompts_cfg.get("t7_audit", {}).get("quality_threshold", self.DEFAULT_QUALITY_THRESHOLD))
        )

        # Build provider instances once (idempotent).
        self._providers: dict[str, LLMProvider] = self._build_providers()

        # Build LLMClient instances per fallback chain name (lazy).
        self._clients: dict[str, LLMClient] = {}
        self._defaults: dict[str, Any] = prompts_cfg.get("defaults", {})

        # External agent adapters (claude_code/codex/gemini/opencode/trae).
        # Loaded from config/forgemind.yaml — gives Forgekins a path to invoke
        # host-installed CLI agents instead of (or alongside) the LLM gateway.
        self._external_agents: dict[ExternalAgentKind, ExternalAgentAdapter] = (
            load_adapters_from_config(forgemind_cfg or {})
        )

        logger.info(
            f"ForgekinLLMBridge ready: providers={list(self._providers)} "
            f"quality_threshold={self._quality_threshold} "
            f"external_agents={[k.value for k in self._external_agents]}"
        )

    # ── Construction ─────────────────────────────────────────────────────

    @classmethod
    def from_config(cls, config_dir: Path) -> ForgekinLLMBridge:
        """Build the bridge from a config directory.

        Reads ``config/llm_route.yaml``, ``config/web_chat_prompts.yaml``, and
        ``config/forgemind.yaml``. Environment variables override YAML values
        per 铁律 5.
        """
        config_dir = Path(config_dir).resolve()
        llm_route_path = config_dir / "llm_route.yaml"
        prompts_path = config_dir / "web_chat_prompts.yaml"
        forgemind_path = config_dir / "forgemind.yaml"
        llm_route = _load_yaml(llm_route_path)
        prompts = _load_yaml(prompts_path)
        # forgemind.yaml is optional — missing file ⇒ no external agents.
        forgemind = _load_yaml(forgemind_path) if forgemind_path.exists() else {}
        return cls(
            llm_route_cfg=llm_route,
            prompts_cfg=prompts,
            config_dir=config_dir,
            forgemind_cfg=forgemind,
        )

    def _build_providers(self) -> dict[str, LLMProvider]:
        """Instantiate every enabled provider from llm_route.yaml.

        Environment variables override the api_key / base_url so secrets
        never live in the repo (铁律 5).
        """
        providers_cfg = self._llm_route.get("providers", {}) or {}
        out: dict[str, LLMProvider] = {}

        for name, cfg in providers_cfg.items():
            if not cfg.get("enabled", False):
                continue
            kind = (cfg.get("kind") or "").lower()
            base_url = _env(
                f"FLOWFORGE_LLM_ROUTE_{name.upper()}_BASE_URL",
                cfg.get("base_url", ""),
            )
            api_key = _env(
                f"FLOWFORGE_LLM_ROUTE_{name.upper()}_API_KEY",
                cfg.get("api_key", ""),
            )

            if kind == "openroute":
                if not base_url:
                    raise ValueError(f"openroute provider missing base_url (name={name})")
                out[name] = OpenRouteProvider(base_url=base_url, api_key=api_key)
            elif kind == "direct":
                vendor = cfg.get("vendor", name)
                if not base_url:
                    raise ValueError(f"direct provider missing base_url (name={name})")
                out[name] = DirectProvider(
                    vendor=vendor,
                    base_url=base_url,
                    api_key=api_key,
                )
            elif kind == "webchat":
                # WebchatProvider requires a browser_manager; skipped in API mode.
                # The LLMClient fallback chain will route around it.
                logger.info(f"webchat provider '{name}' skipped (no browser_manager in API mode)")
                continue
            else:
                logger.warning(f"unknown provider kind '{kind}' for '{name}', skipping")

        if not out:
            raise RuntimeError(
                "no enabled LLM providers in config/llm_route.yaml — "
                "set providers.openroute.enabled=true or provide env overrides"
            )
        return out

    def _get_client(self, chain_name: str) -> LLMClient:
        """Build (and cache) an LLMClient for the given fallback chain.

        If a chain entry references a disabled provider (e.g. direct_zhipu
        in dev mode), we fall back to ``openroute`` so the call still goes
        through the OpenRoute multi-model gateway.  This preserves the
        cross-vendor ordering semantics of the YAML while working in any
        environment that has OpenRoute running.
        """
        if chain_name in self._clients:
            return self._clients[chain_name]

        chains_cfg = self._llm_route.get("fallback_chains", {}) or {}
        chain_entries = chains_cfg.get(chain_name)
        if not chain_entries:
            raise KeyError(f"fallback chain '{chain_name}' not found in llm_route.yaml")

        # OpenRoute is the universal gateway: when a chain entry points to a
        # disabled provider, route through OpenRoute instead.  This lets the
        # same YAML work in both full-provider and openroute-only setups.
        openroute_provider = self._providers.get("openroute")

        fallback: list[FallbackEntry] = []
        for entry in chain_entries:
            model = entry["model"]
            prov_name = entry.get("provider", "openroute")
            priority = int(entry.get("priority", 0))
            provider = self._providers.get(prov_name)
            if provider is None:
                if openroute_provider is None:
                    logger.warning(
                        f"chain '{chain_name}' entry model={model} provider={prov_name} "
                        "is disabled and no openroute fallback exists — skipping"
                    )
                    continue
                logger.info(
                    f"chain '{chain_name}' entry model={model} provider={prov_name} "
                    "disabled → routing through openroute"
                )
                provider = openroute_provider
            fallback.append(FallbackEntry(model=model, provider=provider, priority=priority))

        if not fallback:
            raise RuntimeError(
                f"fallback chain '{chain_name}' has no usable entries "
                "(all providers disabled and no openroute fallback)"
            )

        client = LLMClient(
            fallback_chain=fallback,
            max_retries=int(self._llm_route.get("max_retries", 3)),
            retry_delay=float(self._llm_route.get("retry_delay", 1.0)),
            prefer_api=bool(self._llm_route.get("prefer_api", True)),
        )
        self._clients[chain_name] = client
        return client

    # ── Prompt rendering ────────────────────────────────────────────────

    def _render_system_prompt(
        self,
        fk_cfg: dict[str, Any],
        role: str,
    ) -> str:
        """Render the system prompt for a (forgekin, role) tuple.

        Lookup order: system_prompts.{forgekin_id}.{role}
                      → system_prompts.role_default.{role}
        """
        sp = self._prompts.get("system_prompts", {}) or {}
        fk_id = fk_cfg.get("forgekin_id", "")
        # 1. per-forgekin override
        per_fk = sp.get(fk_id, {}) or {}
        tmpl = per_fk.get(role)
        # 2. role default
        if tmpl is None:
            role_default = sp.get("role_default", {}) or {}
            tmpl = role_default.get(role)
        if tmpl is None:
            raise KeyError(
                f"no system prompt for forgekin_id={fk_id} role={role} "
                f"(checked system_prompts.{fk_id}.{role} and role_default.{role})"
            )

        capabilities = fk_cfg.get("capabilities", []) or []
        cap_names = [c["name"] if isinstance(c, dict) else str(c) for c in capabilities][:3]
        council_role = fk_cfg.get("council_role", {}) or {}
        review_domains = council_role.get("preferred_review_domains", []) or []

        variables = _SafeDict(
            name=fk_cfg.get("name", ""),
            alias=fk_cfg.get("alias", ""),
            role=role,
            loop_type=fk_cfg.get("self_dev_loop", {}).get("loop_type", ""),
            awakening_stage=fk_cfg.get("self_dev_loop", {}).get("awakening_stage", ""),
            catchphrase=fk_cfg.get("persona", {}).get("catchphrase", ""),
            working_style=fk_cfg.get("persona", {}).get("working_style", ""),
            capabilities=", ".join(cap_names),
            review_domains=", ".join(review_domains) if review_domains else "通用",
            no_self_review=str(council_role.get("no_self_review", True)),
            user_content="",  # filled by user prompt
            context_block="",  # filled by user prompt
            push_back_block="",  # filled by user prompt
            primary_output="",  # only for reviewer/tester
        )
        return tmpl.format_map(variables)

    def _render_user_prompt(
        self,
        user_content: str,
        context_block: str,
        push_back_block: str,
    ) -> str:
        tmpl = self._prompts.get("user_prompt")
        if tmpl is None:
            # Minimal fallback — should never trigger if config is loaded.
            return f"{user_content}\n\n{context_block}\n\n{push_back_block}"
        return tmpl.format_map(
            _SafeDict(
                user_content=user_content,
                context_block=context_block,
                push_back_block=push_back_block,
            )
        )

    def _render_context_block(self, recent_context: list[Any] | None) -> str:
        """Render the I11 multi-turn context block.

        ``recent_context`` is a list of objects with ``author_name`` and
        ``content`` attributes (ChatMessage dataclass from app.py).
        """
        if not recent_context:
            return ""
        tmpl = self._prompts.get("context_block_template")
        if tmpl is None:
            return ""
        lines: list[str] = []
        for msg in recent_context:
            try:
                name = getattr(msg, "author_name", "?")
                content = getattr(msg, "content", "")
            except Exception:  # noqa: BLE001
                continue
            snippet = (content or "").replace("\n", " ").strip()
            if len(snippet) > 120:
                snippet = snippet[:117] + "..."
            lines.append(f"- [{name}] {snippet}")
        if not lines:
            return ""
        return tmpl.format_map(
            _SafeDict(
                history_count=len(lines),
                history_lines="\n".join(lines),
            )
        )

    def _render_push_back_block(self, push_back_round: int) -> str:
        if push_back_round <= 0:
            return ""
        pb_tmpl = self._prompts.get("push_back_template", "")
        esc_tmpl = self._prompts.get("push_back_escalation_template", "")
        block = pb_tmpl.format_map(_SafeDict(push_back_round=push_back_round))
        if push_back_round >= 3 and esc_tmpl:
            block = block + "\n" + esc_tmpl
        return block

    # ── Public API ──────────────────────────────────────────────────────

    async def respond(
        self,
        fk_cfg: dict[str, Any],
        *,
        role: str,
        user_content: str,
        recent_context: list[Any] | None = None,
        push_back_round: int = 0,
        chain_name: str | None = None,
    ) -> ForgekinReply:
        """Generate a forgekin's reply via real LLM call.

        Raises :class:`flowforge.core.errors.LLMError` on failure.
        """
        chain = chain_name or self.DEFAULT_CHAIN
        client = self._get_client(chain)

        system_prompt = self._render_system_prompt(fk_cfg, role)
        context_block = self._render_context_block(recent_context)
        push_back_block = self._render_push_back_block(push_back_round)
        user_prompt = self._render_user_prompt(user_content, context_block, push_back_block)

        defaults = self._defaults
        temperature = float(defaults.get("temperature", 0.6))
        max_tokens = int(defaults.get("max_tokens", 600))
        timeout = float(defaults.get("timeout", 60.0))

        tid = get_trace_id()
        logger.info(
            f"[trace_id={tid}] bridge.respond START: fk={fk_cfg.get('forgekin_id')} "
            f"role={role} chain={chain} prompt_len={len(user_prompt)} "
            f"timeout={timeout}s temp={temperature}"
        )
        resp: LLMResponse = await client.complete(
            user_prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        )
        logger.info(
            f"[trace_id={tid}] bridge.respond DONE: fk={fk_cfg.get('forgekin_id')} "
            f"model={resp.model} provider={resp.provider} "
            f"latency={resp.latency_ms:.0f}ms finish={resp.finish_reason} "
            f"len={len(resp.content)}"
        )
        return ForgekinReply(
            text=resp.content,
            model=resp.model,
            provider=resp.provider,
            latency_ms=resp.latency_ms,
            finish_reason=resp.finish_reason,
            raw=resp.raw,
        )

    async def respond_via_external_agent(
        self,
        fk_cfg: dict[str, Any],
        *,
        role: str,
        user_content: str,
        recent_context: list[Any] | None = None,
    ) -> ForgekinReply:
        """Generate a forgekin's reply by invoking its bound external agent.

        Reads the forgekin's ``bound_external_agents`` config to find the
        kind of CLI agent to invoke (e.g. claude_code for 文心). Raises
        ExternalAgentError if no binding exists, the agent is unconfigured,
        or the binary is not installed on the host.
        """
        bindings = fk_cfg.get("bound_external_agents", []) or []
        if not bindings:
            raise ExternalAgentError(
                f"forgekin {fk_cfg.get('forgekin_id', '?')} has no bound_external_agents"
            )
        # Pick the first binding with role=primary_executor; fall back to first.
        binding = next(
            (b for b in bindings if b.get("role") == "primary_executor"),
            bindings[0],
        )
        kind_str = binding.get("kind", "")
        try:
            kind = ExternalAgentKind(kind_str)
        except ValueError:
            raise ExternalAgentError(
                f"unknown external agent kind: {kind_str!r} "
                f"(supported: {[k.value for k in ExternalAgentKind]})"
            ) from None

        adapter = self._external_agents.get(kind)
        if adapter is None:
            raise ExternalAgentError(
                f"external agent {kind.value} not configured in forgemind.yaml"
            )
        if not adapter.is_available():
            raise ExternalAgentError(
                f"external agent {kind.value} binary not installed on host"
            )

        # Render system prompt (same as LLM path — keeps persona/role consistent).
        system_prompt = self._render_system_prompt(fk_cfg, role)
        context_block = self._render_context_block(recent_context)
        full_prompt = user_content
        if context_block:
            full_prompt = f"{context_block}\n\n{user_content}"

        tid = get_trace_id()
        logger.info(
            f"[trace_id={tid}] bridge.respond_via_external_agent START: "
            f"fk={fk_cfg.get('forgekin_id')} role={role} kind={kind.value}"
        )
        result = await adapter.invoke_for_chat(
            full_prompt,
            system_prompt=system_prompt,
            timeout=float(binding.get("default_timeout", adapter.config.default_timeout)),
        )
        logger.info(
            f"[trace_id={tid}] bridge.respond_via_external_agent DONE: "
            f"fk={fk_cfg.get('forgekin_id')} kind={kind.value} "
            f"latency={result['latency_ms']:.0f}ms len={len(result['text'])}"
        )
        return ForgekinReply(
            text=result["text"],
            model=result["model"],
            provider=result["provider"],
            latency_ms=result["latency_ms"],
            finish_reason=result["finish_reason"],
            raw={"source": "external_agent", "kind": kind.value},
        )

    async def audit_t7(
        self,
        *,
        primary_name: str,
        primary_output: str,
        loop_type: str,
        chain_name: str | None = None,
    ) -> T7AuditResult:
        """T7 audit — invoke a *different* LLM to audit the primary output.

        Uses the ``t7_audit`` fallback chain (Qwen3.6-Plus → Kimi-K2.6 →
        HunYuan3 in the default config).  The audit LLM must return a JSON
        object ``{"score": float, "verdict": "pass"|"fail", "reasons": [...]}``;
        non-JSON output is treated as a fail with score 0.
        """
        chain = chain_name or self.T7_CHAIN
        client = self._get_client(chain)

        t7_cfg = self._prompts.get("t7_audit", {}) or {}
        sys_tmpl = t7_cfg.get("system_prompt", "")
        usr_tmpl = t7_cfg.get("user_prompt", "")
        if not sys_tmpl or not usr_tmpl:
            raise KeyError("t7_audit.system_prompt / t7_audit.user_prompt missing in web_chat_prompts.yaml")

        system_prompt = sys_tmpl.format_map(
            _SafeDict(quality_threshold=f"{self._quality_threshold:.2f}")
        )
        user_prompt = usr_tmpl.format_map(
            _SafeDict(
                primary_name=primary_name,
                primary_output=primary_output,
                loop_type=loop_type,
            )
        )

        logger.info(
            f"[trace_id={get_trace_id()}] bridge.audit_t7 START: primary={primary_name} "
            f"loop={loop_type} chain={chain} prompt_len={len(user_prompt)}"
        )
        t0 = time.perf_counter()
        try:
            resp = await client.complete(
                user_prompt,
                system_prompt=system_prompt,
                temperature=0.2,  # audit needs determinism
                max_tokens=400,
                timeout=30.0,  # 30s per attempt — fail fast & let fallback take over
            )
        except LLMError:
            raise
        latency_ms = (time.perf_counter() - t0) * 1000

        score, verdict, reasons, raw_text = _parse_t7_response(resp.content, self._quality_threshold)
        logger.info(
            f"[trace_id={get_trace_id()}] bridge.audit_t7 DONE: primary={primary_name} "
            f"score={score:.2f} verdict={verdict} model={resp.model} "
            f"latency={latency_ms:.0f}ms"
        )
        return T7AuditResult(
            score=score,
            verdict=verdict,
            reasons=reasons,
            model=resp.model,
            provider=resp.provider,
            latency_ms=latency_ms,
            quality_threshold=self._quality_threshold,
            raw_text=raw_text,
        )

    # ── Introspection (used by /api/verify/t8) ──────────────────────────

    def get_dom_checklist(self) -> list[dict[str, str]]:
        """Return the T8 DOM checklist from web_chat_prompts.yaml."""
        return list(self._prompts.get("t8_dom_checklist", []) or [])

    # ── External agent introspection (used by /api/external-agents) ─────

    def get_external_agents_status(self) -> list[dict[str, Any]]:
        """Return status for all configured external agents."""
        return [adapter.get_status() for adapter in self._external_agents.values()]

    def find_external_agent_for_forgekin(self, fk_cfg: dict[str, Any]) -> ExternalAgentKind | None:
        """Return the ExternalAgentKind bound to a forgekin, or None."""
        bindings = fk_cfg.get("bound_external_agents", []) or []
        for binding in bindings:
            kind_str = binding.get("kind", "")
            try:
                kind = ExternalAgentKind(kind_str)
                if kind in self._external_agents:
                    return kind
            except ValueError:
                continue
        return None

    def update_external_agent_config(
        self,
        kind: ExternalAgentKind,
        *,
        binary_override: str | None = None,
        default_timeout: float | None = None,
    ) -> dict[str, Any]:
        """Update one external agent's runtime config (in-memory; not persisted).

        Used by PUT /api/external-agents/{kind} to let the user point at a
        non-standard binary location without editing forgemind.yaml.
        """
        adapter = self._external_agents.get(kind)
        if adapter is None:
            raise KeyError(f"external agent {kind.value} not configured")
        if binary_override is not None:
            adapter.config.binary_override = binary_override
        if default_timeout is not None:
            adapter.config.default_timeout = default_timeout
        logger.info(
            f"external agent config updated: kind={kind.value} "
            f"binary_override={adapter.config.binary_override!r} "
            f"timeout={adapter.config.default_timeout}"
        )
        return adapter.get_status()

    def get_external_adapter(self, kind: ExternalAgentKind) -> ExternalAgentAdapter | None:
        """Return the adapter for a kind, or None. Used by /api/external-agents/{kind}/test."""
        return self._external_agents.get(kind)

# ── T7 response parsing ─────────────────────────────────────────────────────

def _parse_t7_response(
    text: str,
    threshold: float,
) -> tuple[float, str, list[str], str]:
    """Parse the audit LLM's JSON response.

    Tolerates:
    - markdown code fences (```json ... ```)
    - leading/trailing prose
    - missing fields (defaults to score=0, verdict=fail)
    """
    import json
    import re

    raw = text or ""
    # Strip markdown fences if present.
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    payload = fence_match.group(1) if fence_match else raw

    # Find the first {...} block.
    if not payload.strip().startswith("{"):
        brace_match = re.search(r"\{.*\}", payload, re.DOTALL)
        if brace_match:
            payload = brace_match.group(0)

    try:
        data = json.loads(payload)
    except Exception:  # noqa: BLE001
        return 0.0, "fail", [f"audit LLM returned non-JSON output (first 200 chars): {raw[:200]!r}"], raw

    score = float(data.get("score", 0.0))
    score = max(0.0, min(1.0, score))
    verdict_in = str(data.get("verdict", "")).lower().strip()
    reasons = data.get("reasons", []) or []
    if not isinstance(reasons, list):
        reasons = [str(reasons)]
    reasons = [str(r) for r in reasons]

    # Recompute verdict from score to enforce the threshold consistently.
    verdict = "pass" if score >= threshold else "fail"
    if verdict_in and verdict_in != verdict:
        reasons.append(
            f"verdict mismatch: audit said '{verdict_in}' but score {score:.2f} "
            f"vs threshold {threshold:.2f} → reclassified as '{verdict}'"
        )
    return score, verdict, reasons, raw

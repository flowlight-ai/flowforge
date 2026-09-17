"""ExternalAgentAdapter — bridge to third-party agents (claude code, codex, opencode, trae).

Forgekins can call out to specialized third-party coding/agent tools via this
adapter. Each adapter is subprocess-based (so a crashing external agent cannot
take down flowforge) and follows a uniform async interface.

v0.1 ships with four adapters configured but stubbed — production wiring
requires the corresponding CLI to be installed on the host.
"""

from __future__ import annotations

import asyncio
import shutil
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from flowforge.core.errors import FlowForgeError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.forgemind.external_agents")


class ExternalAgentKind(str, Enum):
    CLAUDE_CODE = "claude_code"
    CODEX = "codex"
    GEMINI = "gemini"
    OPENCODE = "opencode"
    TRAE = "trae"
    CUSTOM = "custom"


@dataclass
class ExternalAgentConfig:
    """Configuration for one external agent adapter."""

    kind: ExternalAgentKind
    binary: str  # CLI binary name (e.g. "claude", "codex", "opencode", "trae")
    description: str = ""
    env: dict[str, str] = field(default_factory=dict)
    default_timeout: float = 120.0


# Default configurations — overridable via forgemind.yaml
DEFAULT_CONFIGS: dict[ExternalAgentKind, ExternalAgentConfig] = {
    ExternalAgentKind.CLAUDE_CODE: ExternalAgentConfig(
        kind=ExternalAgentKind.CLAUDE_CODE,
        binary="claude",
        description="Anthropic Claude Code — coding & code review",
    ),
    ExternalAgentKind.CODEX: ExternalAgentConfig(
        kind=ExternalAgentKind.CODEX,
        binary="codex",
        description="OpenAI Codex CLI — code generation",
    ),
    ExternalAgentKind.GEMINI: ExternalAgentConfig(
        kind=ExternalAgentKind.GEMINI,
        binary="gemini",
        description="Google Gemini CLI — multimodal coding & review",
    ),
    ExternalAgentKind.OPENCODE: ExternalAgentConfig(
        kind=ExternalAgentKind.OPENCODE,
        binary="opencode",
        description="Open-source coding agent",
    ),
    ExternalAgentKind.TRAE: ExternalAgentConfig(
        kind=ExternalAgentKind.TRAE,
        binary="trae",
        description="Trae IDE agent — coding & debugging",
    ),
}


class ExternalAgentError(FlowForgeError):
    """External agent invocation failed."""


class ExternalAgentAdapter:
    """Subprocess-based adapter for a third-party agent."""

    def __init__(self, config: ExternalAgentConfig) -> None:
        self.config = config

    def is_available(self) -> bool:
        """Check whether the agent's CLI binary is installed on this host."""
        return shutil.which(self.config.binary) is not None

    async def invoke(
        self,
        prompt: str,
        *,
        cwd: str | None = None,
        timeout: float | None = None,
        extra_args: list[str] | None = None,
    ) -> str:
        """Invoke the external agent with a prompt. Returns stdout.

        The adapter uses the agent's "one-shot" prompt mode where supported.
        Production wrappers should add structured output parsing per agent.
        """
        if not self.is_available():
            raise ExternalAgentError(
                f"External agent {self.config.kind.value} binary "
                f"{self.config.binary!r} not found in PATH"
            )
        args = [self.config.binary]
        if extra_args:
            args.extend(extra_args)
        args.extend(["--prompt", prompt])
        timeout_s = timeout or self.config.default_timeout
        logger.info(
            f"external_agent invoke: kind={self.config.kind.value} binary={self.config.binary} "
            f"prompt_len={len(prompt)} timeout={timeout_s}s"
        )
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                cwd=cwd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**self.config.env} or None,
            )
        except OSError as exc:
            raise ExternalAgentError(
                f"Failed to spawn {self.config.binary!r}", cause=exc
            ) from exc
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except asyncio.TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise ExternalAgentError(
                f"External agent {self.config.binary!r} timed out after {timeout_s}s"
            ) from exc
        if proc.returncode != 0:
            stderr = stderr_b.decode("utf-8", errors="replace") if stderr_b else ""
            raise ExternalAgentError(
                f"External agent {self.config.binary!r} exited with {proc.returncode}: {stderr[:200]}"
            )
        return stdout_b.decode("utf-8", errors="replace") if stdout_b else ""


def build_default_adapters() -> dict[ExternalAgentKind, ExternalAgentAdapter]:
    """Construct adapters for all four built-in external agents."""
    return {kind: ExternalAgentAdapter(cfg) for kind, cfg in DEFAULT_CONFIGS.items()}


def load_adapters_from_config(
    forgemind_cfg: dict[str, Any],
) -> dict[ExternalAgentKind, ExternalAgentAdapter]:
    """从 forgemind 配置加载外部 Agent 适配器.

    配置格式 (config/forgemind.yaml 中的 external_agents 段):
        external_agents:
          claude_code:
            binary: claude
            env:
              ANTHROPIC_API_KEY: xxx
          codex:
            binary: codex

    若配置中没有 external_agents 段或为空, 则回退到 build_default_adapters().
    """
    raw = forgemind_cfg.get("external_agents") or {}
    if not raw:
        return build_default_adapters()

    adapters: dict[ExternalAgentKind, ExternalAgentAdapter] = {}
    for kind, cfg in DEFAULT_CONFIGS.items():
        override = raw.get(kind.value) or raw.get(kind.value.replace("_", "-")) or {}
        if override:
            merged = ExternalAgentConfig(
                kind=kind,
                binary=override.get("binary", cfg.binary),
                description=override.get("description", cfg.description),
                env={**cfg.env, **override.get("env", {})},
                default_timeout=override.get("default_timeout", cfg.default_timeout),
            )
        else:
            merged = cfg
        adapters[kind] = ExternalAgentAdapter(merged)
    return adapters

"""ExternalAgentAdapter — bridge to third-party agents (claude code, codex, gemini, opencode, trae).

Forgekins can call out to specialized third-party coding/agent tools via this
adapter. Each adapter is subprocess-based (so a crashing external agent cannot
take down flowforge) and follows a uniform async interface.

This module is the *only* path through which Forgekins invoke host-installed
CLI agents. The web chat layer (app.py + llm_bridge.py) calls
``ExternalAgentAdapter.invoke()`` when ``use_external_agent=true`` is passed
to ``POST /api/chat``.

Cross-platform binary resolution :
- Windows: PATH → %APPDATA%\\npm → %LOCALAPPDATA%\\npm → D:\\ProgramData\\nodejs\\npm-global
  Prefers ``.cmd`` shims (reliable for create_subprocess_exec).
- Unix: PATH → ~/.local/bin → ~/.claude/bin → ~/.volta/bin → ~/.fnm/aliases/default/bin
  plus nvm-managed ~/.nvm/versions/node/*/bin.

Per-CLI oneshot argument shapes (verified against upstream CLI
implementations — see ClaudeAgentService.ts:6, GeminiAgentService.ts:856,
OpenCodeAgentService.ts:6, routing-guard-remedial.ts:4):
- claude:  ``claude -p "<prompt>"``
- codex:   ``codex exec "<prompt>"``
- gemini:  ``gemini --print "<prompt>"``
- opencode: ``opencode run "<prompt>"``
- trae:    Not a CLI — Trae CN is an IDE. ``invoke`` returns a structured
  error directing the user to launch Trae CN and run the task manually.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
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
    # Optional manual override — when set, this absolute path is used directly
    # and no PATH / well-known-dir probing is performed. Lets the user point
    # at a non-standard install location via /api/external-agents/{kind} PUT.
    binary_override: str = ""
    # Default extra args appended to every invocation (e.g. model selection
    # flags like "-m openroute/DeepSeek-V4-Pro" for opencode,
    # "--skip-trust" for gemini, "--skip-git-repo-check" for codex).
    # Caller-supplied extra_args still take precedence (deduped by flag name).
    default_extra_args: list[str] = field(default_factory=list)

# Default configurations — overridable via forgemind.yaml or the settings API.
DEFAULT_CONFIGS: dict[ExternalAgentKind, ExternalAgentConfig] = {
    ExternalAgentKind.CLAUDE_CODE: ExternalAgentConfig(
        kind=ExternalAgentKind.CLAUDE_CODE,
        binary="claude",
        description="Anthropic Claude Code — coding & code review",
        default_timeout=120.0,
        env={
            "ANTHROPIC_BASE_URL": "http://127.0.0.1:8083",
            "ANTHROPIC_AUTH_TOKEN": "openroute-proxy",
            "ANTHROPIC_API_KEY": "openroute-proxy",
            "DISABLE_AUTOUPDATER": "1",
            "DISABLE_TELEMETRY": "1",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        },
    ),
    ExternalAgentKind.CODEX: ExternalAgentConfig(
        kind=ExternalAgentKind.CODEX,
        binary="codex",
        description="OpenAI Codex CLI — code generation",
        default_timeout=120.0,
        env={
            # 铁律5: 禁止硬编码密钥 — 通过 OPENROUTE_API_KEY 环境变量注入
            "OPENROUTE_API_KEY": os.environ.get("OPENROUTE_API_KEY", ""),
        },
        # Codex 1.5+ refuses to run inside an untrusted git repo without this flag.
        default_extra_args=["--skip-git-repo-check"],
    ),
    ExternalAgentKind.GEMINI: ExternalAgentConfig(
        kind=ExternalAgentKind.GEMINI,
        binary="gemini",
        description="Google Gemini CLI — multimodal coding & review",
        default_timeout=120.0,
        env={
            "GEMINI_API_KEY": "openroute-proxy",
            "GOOGLE_GEMINI_BASE_URL": "http://127.0.0.1:8082",
            "GOOGLE_GENAI_BASE_URL": "http://127.0.0.1:8082",
        },
        # Gemini CLI 0.51+ blocks untrusted working dirs without explicit trust.
        default_extra_args=["--skip-trust"],
    ),
    ExternalAgentKind.OPENCODE: ExternalAgentConfig(
        kind=ExternalAgentKind.OPENCODE,
        binary="opencode",
        description="Open-source coding agent",
        default_timeout=120.0,
        env={
            # 铁律5: 禁止硬编码密钥 — 通过 OPENROUTE_API_KEY 环境变量注入
            "OPENCODE_API_KEY": os.environ.get("OPENROUTE_API_KEY", ""),
        },
        # opencode requires explicit model selection: "-m <provider>/<model>".
        # OpenRoute is configured as a custom provider in ~/.config/opencode/opencode.json.
        # Doubao-Seed2.0 is the most stable model on OpenRoute as of 2026-07-25.
        default_extra_args=["-m", "openroute/Doubao-Seed2.0"],
    ),
    ExternalAgentKind.TRAE: ExternalAgentConfig(
        kind=ExternalAgentKind.TRAE,
        binary="trae",
        description="Trae IDE agent — coding & debugging (IDE-only, no CLI oneshot)",
        default_timeout=120.0,
    ),
}

class ExternalAgentError(FlowForgeError):
    """External agent invocation failed."""

_IS_WINDOWS = sys.platform.startswith("win")

# Unix well-known install directories (relative to $HOME).
_UNIX_SEARCH_DIRS = (
    ".local/bin",
    ".claude/bin",
    ".claude/local/bin",
    ".volta/bin",
    ".fnm/aliases/default/bin",
    ".nix-profile/bin",
)

def _collect_nvm_bin_dirs() -> list[Path]:
    """Discover nvm-managed Node.js bin directories under ~/.nvm/versions/node/."""
    home = Path.home()
    nvm_dir = home / ".nvm" / "versions" / "node"
    if not nvm_dir.exists():
        return []
    return [d / "bin" for d in nvm_dir.iterdir() if d.is_dir() and d.name.startswith("v")]

def _windows_search_dirs() -> list[Path]:
    """Windows well-known install directories for npm-global CLIs."""
    dirs: list[Path] = []
    appdata = os.environ.get("APPDATA")
    local_appdata = os.environ.get("LOCALAPPDATA")
    if appdata:
        dirs.append(Path(appdata) / "npm")
    if local_appdata:
        dirs.append(Path(local_appdata) / "npm")
    # Common system-wide npm prefix (user-confirmed install location on this host).
    dirs.append(Path("D:/ProgramData/nodejs/npm-global"))
    dirs.append(Path("C:/Program Files/nodejs"))
    return dirs

def _probe_dir_for_binary(dir_path: Path, binary: str) -> Path | None:
    """Probe one directory for the binary, preferring .cmd/.exe on Windows."""
    if not dir_path.exists():
        return None
    if _IS_WINDOWS:
        for ext in (".cmd", ".exe", ".bat", ".ps1", ""):
            candidate = dir_path / f"{binary}{ext}"
            if candidate.exists() and candidate.is_file():
                return candidate
    else:
        candidate = dir_path / binary
        if candidate.exists() and candidate.is_file():
            return candidate
    return None

def resolve_cli_binary(binary: str, override: str = "") -> Path | None:
    """Resolve the full path to a CLI binary.

    Order:
    1. If ``override`` is set and points to a real file, use it directly.
    2. ``shutil.which(binary)`` — checks PATH (and PATHEXT on Windows).
    3. Well-known install directories (npm-global, .claude/bin, .volta/bin, …).

    Returns the absolute path if found, or ``None`` if not found anywhere.
    """
    if override:
        p = Path(override)
        if p.exists() and p.is_file():
            return p.resolve()
        logger.warning(f"binary override set but file missing: {override}")

    # Fast path: already in PATH
    found = shutil.which(binary)
    if found:
        return Path(found).resolve()

    # Fallback: well-known install locations
    if _IS_WINDOWS:
        search_dirs = _windows_search_dirs()
    else:
        search_dirs = [Path.home() / d for d in _UNIX_SEARCH_DIRS]
        search_dirs.extend(_collect_nvm_bin_dirs())

    for dir_path in search_dirs:
        candidate = _probe_dir_for_binary(dir_path, binary)
        if candidate:
            return candidate.resolve()
    return None

# ─── Per-kind oneshot argument construction ──────────────────────────────────

def build_oneshot_args(kind: ExternalAgentKind, prompt: str, extra_args: list[str] | None = None) -> list[str]:
    """Build the CLI argument vector for a one-shot prompt invocation.

    Each CLI has a different oneshot shape — see module docstring for the
    reference table. ``extra_args`` (when provided) is inserted in the
    appropriate position for each CLI (typically after the subcommand verb
    but before the prompt), so callers can pass model/approval flags.
    """
    if kind == ExternalAgentKind.CLAUDE_CODE:
        # claude -p "<prompt>"   (ClaudeAgentService.ts:6)
        # extra_args go before -p (e.g. --model xxx)
        args: list[str] = []
        if extra_args:
            args.extend(extra_args)
        args.extend(["-p", prompt])
        return args
    if kind == ExternalAgentKind.CODEX:
        # codex exec [OPTIONS] "<prompt>"  (routing-guard-remedial.ts:4)
        # extra_args (like --skip-git-repo-check) go AFTER exec but BEFORE prompt
        args = ["exec"]
        if extra_args:
            args.extend(extra_args)
        args.append(prompt)
        return args
    if kind == ExternalAgentKind.GEMINI:
        # gemini [OPTIONS] -p "<prompt>"  (gemini-cli 0.51+)
        # extra_args (like --skip-trust) go BEFORE -p
        args = []
        if extra_args:
            args.extend(extra_args)
        args.extend(["-p", prompt])
        return args
    if kind == ExternalAgentKind.OPENCODE:
        # opencode run "<prompt>"  (OpenCodeAgentService.ts:6)
        args = ["run"]
        if extra_args:
            args.extend(extra_args)
        args.append(prompt)
        return args
    if kind == ExternalAgentKind.TRAE:
        # Trae CN is an IDE, not a CLI — no oneshot form exists.
        # We still build a placeholder so callers can surface a clear error.
        args = []
        if extra_args:
            args.extend(extra_args)
        args.extend(["--oneshot-not-supported", prompt])
        return args
    # CUSTOM: assume ``<binary> --prompt <prompt>`` as a generic shape.
    args = []
    if extra_args:
        args.extend(extra_args)
    args.extend(["--prompt", prompt])
    return args

# ─── Adapter ─────────────────────────────────────────────────────────────────

def _is_flag_token(token: str) -> bool:
    """Return True if the token looks like a CLI flag (starts with '-' or '--')."""
    return token.startswith("-") and token != "-"

def _merge_extra_args(defaults: list[str] | None, override: list[str] | None) -> list[str]:
    """Merge default_extra_args with caller-supplied extra_args.

    Caller-supplied args take precedence: if the caller passes the same flag
    (e.g. "-m") that's already in defaults, the default's flag+value pair is
    dropped in favor of the caller's. Values are heuristically detected as
    "the token immediately after a flag token".
    """
    if not defaults:
        return list(override or [])
    if not override:
        return list(defaults)

    # Collect (flag, value_index) pairs from override to know which default
    # (flag, value) pairs to drop.
    override_flags: set[str] = set()
    for i, tok in enumerate(override):
        if _is_flag_token(tok):
            override_flags.add(tok)

    merged: list[str] = []
    i = 0
    while i < len(defaults):
        tok = defaults[i]
        if _is_flag_token(tok) and tok in override_flags:
            # Skip this flag and its value (if any)
            if i + 1 < len(defaults) and not _is_flag_token(defaults[i + 1]):
                i += 2
            else:
                i += 1
            continue
        merged.append(tok)
        i += 1
    merged.extend(override)
    return merged

class ExternalAgentAdapter:
    """Subprocess-based adapter for a third-party agent."""

    def __init__(self, config: ExternalAgentConfig) -> None:
        self.config = config

    # ── availability ───────────────────────────────────────────────────

    def resolve_binary(self) -> Path | None:
        """Return the absolute path to the binary, or None if not installed."""
        return resolve_cli_binary(self.config.binary, self.config.binary_override)

    def is_available(self) -> bool:
        """Check whether the agent's CLI binary is installed on this host."""
        return self.resolve_binary() is not None

    def get_status(self) -> dict[str, Any]:
        """Return a detailed status dict for the /api/external-agents endpoint."""
        binary_path = self.resolve_binary()
        return {
            "kind": self.config.kind.value,
            "binary": self.config.binary,
            "binary_override": self.config.binary_override or None,
            "resolved_path": str(binary_path) if binary_path else None,
            "available": binary_path is not None,
            "description": self.config.description,
            "default_timeout": self.config.default_timeout,
            "platform": sys.platform,
            "supports_oneshot": self.config.kind != ExternalAgentKind.TRAE,
        }

    # ── invocation ─────────────────────────────────────────────────────

    async def invoke(
        self,
        prompt: str,
        *,
        cwd: str | None = None,
        timeout: float | None = None,
        extra_args: list[str] | None = None,
    ) -> str:
        """Invoke the external agent with a prompt. Returns stdout.

        Uses the agent's "one-shot" prompt mode. For Trae (which has no CLI
        oneshot form), raises ExternalAgentError with a clear message.
        """
        if self.config.kind == ExternalAgentKind.TRAE:
            raise ExternalAgentError(
                f"External agent {self.config.kind.value} is IDE-only — "
                "Trae CN does not support CLI oneshot invocation. "
                "Open Trae CN IDE and run the task manually."
            )

        binary_path = self.resolve_binary()
        if binary_path is None:
            raise ExternalAgentError(
                f"External agent {self.config.kind.value} binary "
                f"{self.config.binary!r} not found in PATH or well-known install dirs. "
                f"On Windows, check %APPDATA%\\npm and D:\\ProgramData\\nodejs\\npm-global. "
                f"On Unix, check ~/.local/bin and ~/.claude/bin. "
                f"Or set binary_override via PUT /api/external-agents/{self.config.kind.value}."
            )

        # Merge default_extra_args with caller-supplied extra_args. Caller
        # supplied args take precedence (last wins) — we dedupe by flag name
        # so a caller can override the default model selection.
        merged_extra_args = _merge_extra_args(self.config.default_extra_args, extra_args)
        args = build_oneshot_args(self.config.kind, prompt, extra_args=merged_extra_args)
        # On Windows, create_subprocess_exec needs the full path to the .cmd/.exe
        # shim — it does NOT consult PATHEXT the way cmd.exe does. Passing the
        # resolved absolute path handles this transparently.
        cmd_display = f"{binary_path.name} {' '.join(args[:1])} ... <prompt len={len(prompt)}>"
        timeout_s = timeout or self.config.default_timeout
        logger.info(
            f"external_agent invoke: kind={self.config.kind.value} "
            f"binary={binary_path.name} cmd={cmd_display} timeout={timeout_s}s "
            f"cwd={cwd or '<inherit>'}"
        )

        # Merge config env with current process env (subprocess needs full env
        # on Windows, otherwise COMSPEC/PATH/etc are missing and .cmd shims fail).
        proc_env = {**os.environ, **self.config.env}

        try:
            proc = await asyncio.create_subprocess_exec(
                str(binary_path),
                *args,
                cwd=cwd,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=proc_env,
            )
        except OSError as exc:
            raise ExternalAgentError(
                f"Failed to spawn {binary_path.name!r}: {exc}", cause=exc
            ) from exc

        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
        except TimeoutError as exc:
            # Windows: proc.kill() only terminates the .cmd shim, not the
            # node.exe/python.exe child it launched. The child keeps the
            # stdout/stderr pipes open, so proc.wait() hangs forever. Use
            # `taskkill /T /F /PID` to kill the entire process tree.
            await _kill_process_tree(proc, binary_path.name)
            raise ExternalAgentError(
                f"External agent {binary_path.name!r} timed out after {timeout_s}s"
            ) from exc

        stdout = stdout_b.decode("utf-8", errors="replace") if stdout_b else ""
        stderr = stderr_b.decode("utf-8", errors="replace") if stderr_b else ""

        if proc.returncode != 0:
            raise ExternalAgentError(
                f"External agent {binary_path.name!r} exited with code={proc.returncode}. "
                f"stderr (first 300 chars): {stderr[:300]}"
            )

        if not stdout.strip():
            logger.warning(
                f"external_agent {binary_path.name!r} returned empty stdout. "
                f"stderr (first 200 chars): {stderr[:200]}"
            )
        else:
            logger.info(
                f"external_agent invoke done: kind={self.config.kind.value} "
                f"binary={binary_path.name} stdout_len={len(stdout)} stderr_len={len(stderr)}"
            )
        return stdout

    async def invoke_for_chat(
        self,
        prompt: str,
        *,
        system_prompt: str = "",
        cwd: str | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Chat-oriented wrapper around invoke().

        Prepends the system_prompt to the user prompt (CLIs don't accept a
        separate system role) and returns a dict with the fields the
        ForgekinLLMBridge needs to construct a ForgekinReply.
        """
        full_prompt = prompt
        if system_prompt:
            full_prompt = (
                f"[System instructions]\n{system_prompt}\n\n"
                f"[Task]\n{prompt}\n\n"
                f"[Output] Respond concisely."
            )
        t0 = asyncio.get_event_loop().time()
        try:
            text = await self.invoke(full_prompt, cwd=cwd, timeout=timeout)
            latency_ms = (asyncio.get_event_loop().time() - t0) * 1000
            return {
                "text": text.strip(),
                "model": self.config.kind.value,  # CLI doesn't report model; use kind
                "provider": f"external:{self.config.kind.value}",
                "latency_ms": latency_ms,
                "finish_reason": "stop",  # CLI doesn't report finish reason
                "source": "external_agent",
            }
        except ExternalAgentError:
            raise

def build_default_adapters() -> dict[ExternalAgentKind, ExternalAgentAdapter]:
    """Construct adapters for all five built-in external agents."""
    return {kind: ExternalAgentAdapter(cfg) for kind, cfg in DEFAULT_CONFIGS.items()}

async def _kill_process_tree(proc: asyncio.subprocess.Process, label: str) -> None:
    """Kill a subprocess and all its children (Windows-aware).

    On Windows, ``proc.kill()`` only terminates the immediate process (often
    a ``.cmd`` shim), leaving the real child (``node.exe`` / ``python.exe``)
    alive. The child keeps the stdout/stderr pipes open, which makes
    ``proc.wait()`` hang forever.

    This helper uses ``taskkill /T /F /PID`` on Windows to recursively kill
    the whole process tree, then awaits ``proc.wait()`` with a short timeout
    so we never block indefinitely on a stuck child.
    """
    pid = proc.pid
    try:
        if _IS_WINDOWS:
            # /T = kill child processes recursively, /F = force
            kill_proc = await asyncio.create_subprocess_exec(
                "taskkill", "/T", "/F", "/PID", str(pid),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await asyncio.wait_for(kill_proc.wait(), timeout=5.0)
            except TimeoutError:
                kill_proc.kill()
        else:
            # Unix: send SIGKILL to the process group (negative PID)
            try:
                import signal
                os.killpg(os.getpgid(pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
    except Exception as exc:
        logger.warning(f"_kill_process_tree({label}, pid={pid}) fallback: {exc}")
        try:
            proc.kill()
        except ProcessLookupError:
            pass

    # Await process exit, but never block forever — 5s ceiling.
    try:
        await asyncio.wait_for(proc.wait(), timeout=5.0)
    except TimeoutError:
        logger.warning(
            f"_kill_process_tree({label}, pid={pid}): proc.wait() still pending "
            f"after 5s — pipe may be held by an orphaned child. Continuing."
        )

def load_adapters_from_config(config: dict[str, Any]) -> dict[ExternalAgentKind, ExternalAgentAdapter]:
    """Build adapters from a forgemind.yaml ``external_agents`` mapping.

    The YAML shape is:
        external_agents:
          claude_code:
            enabled: true
            binary: "claude"
            default_timeout: 120.0
            binary_override: ""   # optional manual path
    """
    adapters: dict[ExternalAgentKind, ExternalAgentAdapter] = {}
    ea_cfg = config.get("external_agents", {}) or {}
    for kind in ExternalAgentKind:
        if kind == ExternalAgentKind.CUSTOM:
            continue
        entry = ea_cfg.get(kind.value, {}) or {}
        if not entry.get("enabled", True):
            logger.info(f"external agent {kind.value} disabled in config, skipping")
            continue
        default = DEFAULT_CONFIGS[kind]
        cfg = ExternalAgentConfig(
            kind=kind,
            binary=entry.get("binary", default.binary),
            description=entry.get("description", default.description),
            default_timeout=float(entry.get("default_timeout", default.default_timeout)),
            env=dict(entry.get("env", {})),
            binary_override=str(entry.get("binary_override", "") or ""),
            default_extra_args=list(entry.get("default_extra_args", default.default_extra_args)),
        )
        adapters[kind] = ExternalAgentAdapter(cfg)
    return adapters

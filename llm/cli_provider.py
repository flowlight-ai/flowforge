"""CLI LLM Provider — 通过 subprocess 调用三方 Agent CLI 工具.

支持的 CLI Agent：
  - claude_code (claude -p "prompt")              — 经 claude-code-router 转发
  - codex       (codex exec "prompt")             — 经 responses proxy 转发
  - gemini      (gemini -p "prompt")              — 经 gemini proxy 转发
  - opencode    (opencode run "prompt")           — 直连（默认模型）
  - codebuddy   (codebuddy -p "prompt")           — 直连（hy3 默认模型）
  - qodercli    (qodercli -p "prompt")            — 需 Qoder 账号登录
  - iflow       (iflow -p "prompt")               — OpenAI-Compatible API
  - trae-cn     (文件桥接，由 TraeLLMClient 处理，不在此类)

设计原则：
  - 铁律 3：依赖通过构造函数注入
  - 铁律 5：不硬编码路径/密钥
  - 红线 11：不硬编码密钥
  - 统一接口：chat() 返回与 TraeLLMClient 兼容的响应字典
"""

from __future__ import annotations

import asyncio
import glob
import os
import shutil
import time
from dataclasses import dataclass, field
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.llm.cli_provider")


# 常见 CLI 安装目录（Bug 6 修复：进程 PATH 可能缺失这些目录）
# 实测：contentforge 通过 systemd 启动时 PATH 不含 ~/.npm-global/bin，
# 而 codex/opencode/claude 等 CLI 均安装在 ~/.npm-global/bin，
# 导致 is_available() 全部判 False → [CLI 不可用] 无效产出。
# 兜底目录列表仅作解析候选，实际可执行性仍以文件存在 + X_OK 为准。
# 可通过环境变量 FLOWFORGE_CLI_EXTRA_PATH（冒号分隔）追加自定义目录。
CLI_EXTRA_PATH_DIRS = [
    "~/.npm-global/bin",
    "~/.local/bin",
    "~/.opencode/bin",
    "~/.codex/bin",
    "~/.volta/bin",
    "~/.bun/bin",
    "~/go/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
    # nvm 版本化 node bin（如 ~/.nvm/versions/node/v22.9.0/bin）
    "~/.nvm/versions/node/*/bin",
]


def _expand_extra_path_dirs() -> list[str]:
    """展开额外 CLI 查找目录（含 ~ 与 glob，支持环境变量扩展）."""
    dirs: list[str] = []
    for d in CLI_EXTRA_PATH_DIRS:
        if "*" in d:
            dirs.extend(glob.glob(os.path.expanduser(d)))
        else:
            dirs.append(os.path.expanduser(d))
    # 环境变量扩展（冒号分隔，供部署时按机器定制）
    extra = os.environ.get("FLOWFORGE_CLI_EXTRA_PATH", "")
    dirs.extend(p for p in extra.split(":") if p)
    return dirs


@dataclass
class CLIProviderConfig:
    """单个 CLI Agent 的配置."""

    provider: str            # provider 名（claude_code / codex / gemini / opencode / ...）
    binary: str              # CLI 二进制名（claude / codex / gemini / opencode / ...）
    cli_args: list[str]      # 非交互模式参数（["-p"] / ["exec"] / ["-p"] / ["run"]）
    model_flag: list[str] = field(default_factory=list)  # 指定模型的 CLI 参数（如 ["--model"]）
    model_after_prompt: bool = False  # True: 模型参数置于 prompt 之后（gemini/iflow）
    trailer_args: list[str] = field(default_factory=list)  # prompt 之后追加的参数（如 gemini 的 --output-format text）
    default_timeout: float = 300.0
    env: dict[str, str] = field(default_factory=dict)


# 预置配置 — 与 forgekin YAML 中的 llm.provider 对应
PRESET_CONFIGS: dict[str, CLIProviderConfig] = {
    "claude_code": CLIProviderConfig(
        provider="claude_code",
        binary="claude",
        cli_args=["-p"],
        model_flag=["--model"],
        env={
            "ANTHROPIC_BASE_URL": "http://127.0.0.1:3456",
            "ANTHROPIC_API_KEY": "or-6eb9e20d63d01d190b0e26d06c9f5acc4a0ea248a5dd62e7",
        },
    ),
    "codex": CLIProviderConfig(
        provider="codex",
        binary="codex",
        cli_args=["exec"],
        model_flag=["-m"],
        env={"CODEX_API_KEY": "or-6eb9e20d63d01d190b0e26d06c9f5acc4a0ea248a5dd62e7"},
    ),
    "gemini": CLIProviderConfig(
        provider="gemini",
        binary="gemini",
        cli_args=["-p"],
        model_flag=["--model"],
        model_after_prompt=True,
        trailer_args=["--output-format", "text"],
        env={
            "GOOGLE_GEMINI_BASE_URL": "http://127.0.0.1:8082",
            "GEMINI_API_KEY": "or-6eb9e20d63d01d190b0e26d06c9f5acc4a0ea248a5dd62e7",
            "GEMINI_CLI_TRUST_WORKSPACE": "true",
        },
    ),
    "opencode": CLIProviderConfig(
        provider="opencode",
        binary="opencode",
        cli_args=["run"],
        model_flag=[],  # opencode 使用内置默认模型（build），不传 -m
    ),
    "codebuddy": CLIProviderConfig(
        provider="codebuddy",
        binary="codebuddy",
        cli_args=["-p"],
        model_flag=["--model"],
    ),
    "qodercli": CLIProviderConfig(
        provider="qodercli",
        binary="qodercli",
        cli_args=["-p"],
        model_flag=["-m"],
        model_after_prompt=True,
    ),
    "iflow": CLIProviderConfig(
        provider="iflow",
        binary="iflow",
        cli_args=["-p"],
        model_flag=["--model"],
        model_after_prompt=True,
        trailer_args=["-y"],
    ),
}


def _messages_to_prompt(messages: list[dict[str, str]]) -> str:
    """将 OpenAI 格式消息列表转换为 CLI prompt 字符串.

    CLI 工具通常接收单个 prompt，所以将 system + user 消息合并。
    """
    parts: list[str] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            parts.append(f"[System Instructions]\n{content}")
        elif role == "user":
            parts.append(content)
        elif role == "assistant":
            parts.append(f"[Previous Assistant Response]\n{content}")
    return "\n\n---\n\n".join(parts)


class CLILLMProvider:
    """通过 subprocess 调用三方 Agent CLI 的 LLM Provider.

    接口与 TraeLLMClient.chat() 兼容，可被 ForgekinBase 直接使用。
    """

    def __init__(self, config: CLIProviderConfig) -> None:
        self.config = config
        self._binary_path: str | None = None

    def is_available(self) -> bool:
        """检查 CLI 二进制是否可用（PATH + 常见安装目录兜底）.

        修复 Bug：进程 PATH 缺失 CLI 安装目录（如 ~/.npm-global/bin）时，
        shutil.which 返回 None 导致 CLI 被误判不可用。
        兜底查找成功后将该目录注入进程 PATH（供后续 subprocess 使用）。
        """
        self._binary_path = shutil.which(self.config.binary)
        if self._binary_path is not None:
            return True

        # 兜底：遍历常见 CLI 安装目录，找到可执行文件即视为可用
        for d in _expand_extra_path_dirs():
            if not os.path.isdir(d):
                continue
            candidate = os.path.join(d, self.config.binary)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                self._binary_path = candidate
                self._ensure_path(d)
                logger.info(
                    "cli_provider binary %s found in fallback dir: %s",
                    self.config.binary,
                    d,
                )
                return True
        return False

    def _ensure_path(self, directory: str) -> None:
        """将 CLI 所在目录注入进程 PATH（进程级，幂等）.

        子进程通过 env={**os.environ, **config.env} 继承进程环境，
        注入后 subprocess 调用（及 CLI 自身的插件/工具查找）才能生效。
        """
        path = os.environ.get("PATH", "")
        parts = path.split(os.pathsep) if path else []
        if directory in parts:
            return
        os.environ["PATH"] = directory + os.pathsep + path

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        session_id: str = "",
        timeout: float | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """调用 CLI Agent 并返回响应.

        Args:
            messages: OpenAI 格式消息列表
            session_id: 会话 ID（用于日志追踪）
            timeout: 超时秒数
            **kwargs: 透传参数（temperature 等暂不传递给 CLI）

        Returns:
            与 TraeLLMClient 兼容的响应字典
        """
        if not self.is_available():
            logger.warning(
                "cli_provider binary %s not found in PATH (session=%s)",
                self.config.binary, session_id,
            )
            return {
                "content": (
                    f"[CLI 不可用] {self.config.binary} 未在 PATH 中找到。"
                    f"请确认 {self.config.provider} CLI 已安装。"
                ),
                "model": self.config.provider,
                "usage": {"latency_ms": 0, "degraded": True, "error": "binary_not_found"},
                "session_id": session_id,
            }

        prompt = _messages_to_prompt(messages)
        timeout_s = timeout or self.config.default_timeout
        start_ts = time.monotonic()

        # 构建命令参数
        args = [self._binary_path or self.config.binary] + list(self.config.cli_args)
        model = kwargs.get("model")
        def _model_args() -> list[str]:
            if model and self.config.model_flag:
                return list(self.config.model_flag) + [model]
            return []
        if self.config.model_after_prompt:
            args += [prompt] + _model_args() + list(self.config.trailer_args)
        else:
            args += _model_args() + [prompt] + list(self.config.trailer_args)

        logger.info(
            "cli_provider invoke: provider=%s binary=%s prompt_len=%d timeout=%ss session=%s model=%s",
            self.config.provider, self.config.binary, len(prompt), timeout_s, session_id, model,
        )

        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, **self.config.env},
            )
        except OSError as exc:
            logger.error("cli_provider spawn failed: %s", exc)
            return {
                "content": f"[CLI 启动失败] {self.config.binary}: {exc}",
                "model": self.config.provider,
                "usage": {"latency_ms": 0, "error": "spawn_failed"},
                "session_id": session_id,
            }

        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_s
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            logger.warning("cli_provider timeout after %ss: %s", timeout_s, self.config.binary)
            return {
                "content": f"[CLI 超时] {self.config.binary} 在 {timeout_s}s 后未响应",
                "model": self.config.provider,
                "usage": {"latency_ms": int(timeout_s * 1000), "error": "timeout"},
                "session_id": session_id,
            }

        latency_ms = int((time.monotonic() - start_ts) * 1000)
        stdout = stdout_b.decode("utf-8", errors="replace") if stdout_b else ""
        stderr = stderr_b.decode("utf-8", errors="replace") if stderr_b else ""

        if proc.returncode != 0:
            logger.error(
                "cli_provider exit %d: %s stderr=%s",
                proc.returncode, self.config.binary, stderr[:300],
            )
            return {
                "content": (
                    f"[CLI 错误] {self.config.binary} 退出码 {proc.returncode}\n"
                    f"stderr: {stderr[:500]}"
                ),
                "model": self.config.provider,
                "usage": {"latency_ms": latency_ms, "error": f"exit_{proc.returncode}"},
                "session_id": session_id,
            }

        logger.info(
            "cli_provider success: provider=%s latency=%dms stdout_len=%d",
            self.config.provider, latency_ms, len(stdout),
        )

        return {
            "content": stdout.strip(),
            "model": self.config.provider,
            "usage": {"latency_ms": latency_ms, "prompt_tokens": 0, "completion_tokens": 0},
            "session_id": session_id,
        }


def build_cli_provider(provider_name: str) -> CLILLMProvider | None:
    """根据 provider 名构建 CLI LLM Provider.

    Args:
        provider_name: YAML 中 llm.provider 的值（claude_code/codex/gemini/opencode）

    Returns:
        CLILLMProvider 实例，或 None（不支持的 provider）
    """
    config = PRESET_CONFIGS.get(provider_name)
    if config is None:
        return None
    return CLILLMProvider(config)

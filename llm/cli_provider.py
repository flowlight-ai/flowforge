"""CLI LLM Provider — 通过 subprocess 调用三方 Agent CLI 工具.

支持 5 个 CLI Agent：
  - claude   (claude -p "prompt")
  - codex    (codex exec "prompt")
  - gemini   (gemini -p "prompt")
  - opencode (opencode run "prompt")
  - trae-cn  (文件桥接，由 TraeLLMClient 处理，不在此类)

设计原则：
  - 铁律 3：依赖通过构造函数注入
  - 铁律 5：不硬编码路径/密钥
  - 红线 11：不硬编码密钥
  - 统一接口：chat() 返回与 TraeLLMClient 兼容的响应字典
"""

from __future__ import annotations

import asyncio
import shutil
import time
from dataclasses import dataclass, field
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.llm.cli_provider")


@dataclass
class CLIProviderConfig:
    """单个 CLI Agent 的配置."""

    provider: str          # provider 名（claude_code / codex / gemini / opencode）
    binary: str            # CLI 二进制名（claude / codex / gemini / opencode）
    cli_args: list[str]    # 非交互模式参数（["-p"] / ["exec"] / ["-p"] / ["run"]）
    default_timeout: float = 300.0
    env: dict[str, str] = field(default_factory=dict)


# 预置配置 — 与 forgekin YAML 中的 llm.provider 对应
PRESET_CONFIGS: dict[str, CLIProviderConfig] = {
    "claude_code": CLIProviderConfig(
        provider="claude_code",
        binary="claude",
        cli_args=["-p"],
    ),
    "codex": CLIProviderConfig(
        provider="codex",
        binary="codex",
        cli_args=["exec"],
    ),
    "gemini": CLIProviderConfig(
        provider="gemini",
        binary="gemini",
        cli_args=["-p"],
    ),
    "opencode": CLIProviderConfig(
        provider="opencode",
        binary="opencode",
        cli_args=["run"],
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
        """检查 CLI 二进制是否在 PATH 中."""
        self._binary_path = shutil.which(self.config.binary)
        return self._binary_path is not None

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
        args = [self._binary_path or self.config.binary] + self.config.cli_args + [prompt]

        logger.info(
            "cli_provider invoke: provider=%s binary=%s prompt_len=%d timeout=%ss session=%s",
            self.config.provider, self.config.binary, len(prompt), timeout_s, session_id,
        )

        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**self.config.env} or None,
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

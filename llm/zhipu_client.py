"""ZHIPU LLM Client — 直连智谱 AI API 的 LLM 客户端.

为 Forgekin 提供直接的 LLM 调用接口，绕过 OpenRoute 网关的 WebChat 浏览器
自动化路径（WebChat 在浏览器卡住时会超时）。直接走 ZHIPU 官方 OpenAI 兼容
API，响应稳定、延迟可控。

配置示例（forgekin YAML）:
    llm:
      provider: zhipu
      model: glm-4-flash        # 或 glm-4-plus / glm-4-long
      temperature: 0.7
      max_tokens: 8192

设计原则:
    - 铁律 3：依赖通过构造函数注入
    - 铁律 5：不硬编码路径/密钥（从环境变量读取）
    - 红线 11：不硬编码密钥
    - 兼容 TraeLLMClient 接口：chat() 返回 dict（含 content/model/usage/session_id）
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.llm.zhipu_client")


def _load_zhipu_api_key() -> str:
    """加载 ZHIPU_API_KEY，优先环境变量，回退到 openroute .env 文件.

    FlowForge 后端默认不加载 .env，所以需要从 openroute 的 .env 文件中
    读取 ZHIPU_API_KEY 作为后备。这是项目约束（共享 openroute 的密钥配置）。
    """
    # 1. 优先从环境变量读取
    key = os.environ.get("ZHIPU_API_KEY", "")
    if key:
        return key

    # 2. 回退：从 openroute .env 文件读取
    #    路径：d:\\software\\openclaw\\hiclaw\\tool\\openroute\\.env
    #    使用基于代码文件位置的绝对路径计算
    try:
        openroute_env = (
            Path(__file__).resolve().parent.parent.parent
            / "hiclaw" / "tool" / "openroute" / ".env"
        )
        if openroute_env.exists():
            with open(openroute_env, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    if k.strip() == "ZHIPU_API_KEY":
                        return v.strip()
    except Exception as exc:
        logger.warning("从 openroute .env 读取 ZHIPU_API_KEY 失败: %s", exc)

    return ""


# ── 配置（从环境变量读取，不硬编码）──────────────────────────────
# base_url 只到域名，请求路径在 chat() 中拼接 /api/paas/v4/chat/completions
_ZHIPU_BASE_URL = os.environ.get(
    "ZHIPU_BASE_URL",
    "https://open.bigmodel.cn",
).rstrip("/")

_ZHIPU_API_KEY = _load_zhipu_api_key()


class ZhipuLLMClient:
    """直连智谱 AI API 的 LLM 客户端.

    接口与 TraeLLMClient.chat() 兼容，可被 ForgekinBase 直接使用。
    每个 Forgekin 实例可指定不同的 model，实现差异化对话。
    """

    def __init__(
        self,
        model: str = "glm-4-flash",
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        default_timeout: float = 60.0,
    ) -> None:
        self.model = model
        self._base_url = (base_url or _ZHIPU_BASE_URL).rstrip("/")
        self._api_key = api_key or _ZHIPU_API_KEY
        self._default_timeout = default_timeout
        self._client: httpx.AsyncClient | None = None
        if not self._api_key:
            logger.warning(
                "ZHIPU_API_KEY 未设置——ZhipuLLMClient 将返回配置错误响应。"
                "请在 .env 中设置 ZHIPU_API_KEY。"
            )

    async def _get_client(self) -> httpx.AsyncClient:
        """延迟初始化 httpx 客户端（复用连接池）。"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=httpx.Timeout(self._default_timeout, connect=10.0),
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
            )
        return self._client

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        session_id: str = "",
        timeout: float | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """调用 ZHIPU /v4/chat/completions 端点.

        Args:
            messages: OpenAI 格式消息列表
                ``[{"role": "system"|"user"|"assistant", "content": str}]``
            session_id: 会话 ID（用于日志追踪）
            timeout: 超时秒数（覆盖默认值）
            **kwargs: 透传参数（temperature/max_tokens/model 等）

        Returns:
            与 TraeLLMClient 兼容的响应字典:
                - content: str — LLM 生成的文本
                - model: str — 实际使用的模型名
                - usage: dict — token 用量与延迟
                - session_id: str — 会话 ID
        """
        if not self._api_key:
            return {
                "content": "[ZHIPU 配置错误] ZHIPU_API_KEY 未设置，请在 .env 中配置。",
                "model": "zhipu",
                "usage": {"latency_ms": 0, "error": "config_error"},
                "session_id": session_id,
            }

        model = kwargs.pop("model", self.model)
        temperature = kwargs.pop("temperature", 0.7)
        max_tokens = kwargs.pop("max_tokens", 8192)
        timeout_s = timeout or self._default_timeout

        client = await self._get_client()
        start_ts = time.monotonic()

        logger.info(
            "zhipu chat: model=%s session=%s msg_count=%d timeout=%ss",
            model, session_id, len(messages), timeout_s,
        )

        try:
            resp = await client.post(
                "/api/paas/v4/chat/completions",
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "stream": False,
                },
                timeout=timeout_s,
            )
        except httpx.TimeoutException as exc:
            latency_ms = int((time.monotonic() - start_ts) * 1000)
            logger.warning("zhipu timeout: model=%s latency=%dms", model, latency_ms)
            return {
                "content": f"[ZHIPU 超时] 模型 {model} 在 {timeout_s}s 后未响应: {exc}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "timeout"},
                "session_id": session_id,
            }
        except httpx.HTTPError as exc:
            latency_ms = int((time.monotonic() - start_ts) * 1000)
            logger.error("zhipu http error: %s", exc)
            return {
                "content": f"[ZHIPU 网络错误] {type(exc).__name__}: {exc}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "http_error"},
                "session_id": session_id,
            }

        latency_ms = int((time.monotonic() - start_ts) * 1000)

        if resp.status_code != 200:
            error_text = resp.text[:500]
            logger.error(
                "zhipu http %d: model=%s body=%s",
                resp.status_code, model, error_text,
            )
            return {
                "content": f"[ZHIPU HTTP {resp.status_code}] {error_text}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": f"http_{resp.status_code}"},
                "session_id": session_id,
            }

        try:
            data = resp.json()
        except json.JSONDecodeError as exc:
            logger.error("zhipu json decode error: %s", exc)
            return {
                "content": f"[ZHIPU 响应解析失败] {exc}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "json_decode"},
                "session_id": session_id,
            }

        # 检查 error 字段
        if "error" in data:
            error_info = data["error"]
            error_msg = error_info.get("message", str(error_info)) if isinstance(error_info, dict) else str(error_info)
            logger.error("zhipu error body: model=%s error=%s", model, error_msg[:200])
            return {
                "content": f"[ZHIPU 错误] {error_msg}",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "api_error"},
                "session_id": session_id,
            }

        choices = data.get("choices", [])
        if not choices:
            logger.warning("zhipu empty choices: model=%s", model)
            return {
                "content": f"[ZHIPU 空响应] 模型 {model} 未返回任何选项",
                "model": model,
                "usage": {"latency_ms": latency_ms, "error": "empty_choices"},
                "session_id": session_id,
            }

        choice = choices[0]
        message = choice.get("message", {})
        content = message.get("content", "")

        usage_info = data.get("usage", {})
        usage = {
            "latency_ms": latency_ms,
            "prompt_tokens": usage_info.get("prompt_tokens", 0),
            "completion_tokens": usage_info.get("completion_tokens", 0),
            "total_tokens": usage_info.get("total_tokens", 0),
        }

        logger.info(
            "zhipu success: model=%s latency=%dms tokens=%d",
            model, latency_ms, usage.get("total_tokens", 0),
        )

        return {
            "content": content,
            "model": data.get("model", model),
            "usage": usage,
            "session_id": session_id,
        }

    async def close(self) -> None:
        """关闭 HTTP 客户端连接池。"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None


def build_zhipu_client(model: str) -> ZhipuLLMClient:
    """根据模型名构建 ZHIPU LLM 客户端.

    Args:
        model: ZHIPU 模型名（如 "glm-4-flash", "glm-4-plus", "glm-4-long"）

    Returns:
        ZhipuLLMClient 实例
    """
    return ZhipuLLMClient(model=model)

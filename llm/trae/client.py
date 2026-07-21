"""Trae LLM Client — F045 §2.2 客户端薄层.

TraeLLMClient 是 LLM 客户端薄层，所有文件 I/O 委托给 TraeBridgeProtocol。
遵守铁律：
- 铁律 3：依赖通过构造函数注入（protocol + config）
- 铁律 5：路径从 config 读取，不硬编码
- 红线 11：不硬编码密钥（无密钥，靠文件系统协同）
- 红线 12：通过 DI 容器注册到 ModelCapability

桥接模式工作流程（F045 §2.1 协议流程）：
1. ForgekinEngine 调用 TraeLLMClient.chat(messages, context=...)
2. TraeLLMClient 委托 protocol.write_request 写入 request_{uuid}.json
3. TraeLLMClient 委托 protocol.poll_response 轮询 response_{uuid}.json
4. TraeLLMClient 委托 protocol.parse_response 解析响应
5. 返回标准 LLM 响应字典给 ForgekinEngine

会话持久化（可选）：
- 通过 set_memory_manager 注入 MemoryManager
- 会话历史通过 TraeSessionManager 管理
- 持久化到 SQLite（通过 MemoryManager，不直接操作数据库，铁律 4）
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncIterator, Dict, List, Optional

from flowforge.core.tracing import get_logger

from flowforge.llm.trae.config import TraeBridgeConfig, TraeConfig
from flowforge.llm.trae.exceptions import (
    TraeBridgeCancelledError,
    TraeBridgeConfigError,
    TraeBridgeError,
    TraeBridgeIOError,
    TraeBridgeProtocolError,
    TraeBridgeTimeoutError,
    # 向后兼容别名
    TraeLLMApiError,
    TraeLLMCliError,
    TraeLLMError,
    TraeLLMTimeoutError,
)
from flowforge.llm.trae.models import BridgeRequestContext, BridgeResponse
from flowforge.llm.trae.protocol import TraeBridgeProtocol
from flowforge.llm.trae.session import TraeSession, TraeSessionManager

logger = get_logger("trae_llm.client")


class TraeLLMClient:
    """Trae LLM Client — F045 §2.2 客户端薄层.

    所有文件 I/O 委托给 TraeBridgeProtocol，本类只负责：
    1. 会话上下文管理（可选）
    2. 调用 protocol 写入请求
    3. 调用 protocol 轮询响应
    4. 调用 protocol 解析响应
    5. 返回标准 LLM 响应格式

    用法示例：
        from flowforge.llm.trae import TraeLLMClient, TraeBridgeConfig
        from flowforge.llm.trae.protocol import TraeBridgeProtocol
        from flowforge.llm.trae.models import BridgeRequestContext

        config = TraeBridgeConfig.load_from_yaml("config/trae_bridge.yaml")
        protocol = TraeBridgeProtocol(config)
        client = TraeLLMClient(protocol=protocol)

        context = BridgeRequestContext(
            forgekin_id="forgemind:luban",
            task_type="chat",
            task_summary="设计 F046 SelfDev 三闭环",
        )
        result = await client.chat(
            messages=[{"role": "user", "content": "请设计 SelfDev 三闭环"}],
            context=context,
        )
        print(result["content"])
    """

    def __init__(
        self,
        *,
        config: Optional[TraeConfig] = None,
        bridge_config: Optional[TraeBridgeConfig] = None,
        protocol: Optional[TraeBridgeProtocol] = None,
    ) -> None:
        """初始化 TraeLLMClient.

        Args:
            config: TraeConfig（决定 mode/api_url 等，向后兼容）
            bridge_config: TraeBridgeConfig（桥接配置，对应 trae_bridge.yaml）
            protocol: TraeBridgeProtocol（文件协议层，优先使用）

        优先级：protocol > bridge_config > 默认配置
        """
        self._config = config or TraeConfig()
        self._bridge_config = bridge_config or TraeBridgeConfig()
        self._protocol = protocol or TraeBridgeProtocol(self._bridge_config)
        self._session_manager = TraeSessionManager(self._config)
        self._logger = get_logger("trae_llm.client")

    # ── 依赖注入 ────────────────────────────────────────────────────

    def set_memory_manager(self, memory_manager: Any) -> None:
        """注入 MemoryManager（依赖注入，铁律 3）.

        设置后，会话管理器会使用该 MemoryManager 进行会话持久化。
        """
        self._session_manager.set_memory_manager(memory_manager)

    @property
    def config(self) -> TraeConfig:
        """获取 TraeConfig（向后兼容）."""
        return self._config

    @property
    def bridge_config(self) -> TraeBridgeConfig:
        """获取 TraeBridgeConfig."""
        return self._bridge_config

    @property
    def protocol(self) -> TraeBridgeProtocol:
        """获取 TraeBridgeProtocol."""
        return self._protocol

    @property
    def session_manager(self) -> TraeSessionManager:
        """获取会话管理器."""
        return self._session_manager

    # ── 核心 chat 方法 ──────────────────────────────────────────────

    async def chat(
        self,
        messages: List[Dict[str, str]],
        *,
        context: Optional[BridgeRequestContext] = None,
        session_id: str = "",
        task_id: str = "",
        timeout: Optional[float] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """发送聊天请求并返回响应.

        对应 F045 §2.1 协议流程步骤 1-6。

        Args:
            messages: 消息列表 [{"role": "system"|"user"|"assistant", "content": str}]
            context: 请求上下文（F045 §2.3 不变量 7 operator 可见性）
                     不传时用默认值 forgekin_id="unknown", task_type="chat"
            session_id: 可选会话 ID（用于保持上下文）
            task_id: 可选任务 ID（向后兼容，等同于 request_id）
            timeout: 超时秒数（None 用请求文件中的 timeout_seconds）
            **kwargs: 向后兼容参数（model/temperature/max_tokens/tools 等）

        Returns:
            与 flowforge.tools.llm_client.LLMClient.chat() 兼容的响应字典：
            {
                "content": str,
                "model": str,
                "provider": "trae",
                "usage": dict,
                "tool_calls": list,
                "request_id": str,
            }

        Raises:
            TraeBridgeTimeoutError: 超时未收到响应
            TraeBridgeCancelledError: operator 取消
            TraeBridgeProtocolError: 响应格式错误或 LLM 调用错误
            TraeBridgeConfigError: 桥接未启用
        """
        # 校验桥接启用
        if not self._bridge_config.enabled:
            raise TraeBridgeConfigError("Trae 桥接未启用（bridge.enabled=false）")

        # 构造请求上下文（不变量 7 operator 可见性）
        ctx = context or BridgeRequestContext(
            forgekin_id=kwargs.get("forgekin_id", "unknown"),
            task_type=kwargs.get("task_type", "chat"),
            task_summary=kwargs.get("task_summary", ""),
            model=kwargs.get("model", self._config.default_model),
            temperature=kwargs.get("temperature", 0.7),
            max_tokens=kwargs.get("max_tokens", 4096),
            tools=kwargs.get("tools"),
        )

        # 会话上下文管理（可选）
        full_messages = messages
        if session_id and self._config.session_persistence:
            session = self._session_manager.create_session(session_id)
            await session.load()
            # 如果传入的 messages 为空或只有一条，追加会话历史
            if len(messages) <= 1 and session.get_context():
                full_messages = session.get_context() + messages
            # 将新的 user 消息加入会话
            for msg in messages:
                if msg.get("role") == "user":
                    session.add_message(msg["role"], msg["content"])

        # 计算超时：长任务用 long_task_timeout
        effective_timeout = timeout
        if effective_timeout is None:
            if ctx.task_type in ("write_doc", "generate_tests", "review_code"):
                effective_timeout = float(self._bridge_config.long_task_timeout_seconds)
            else:
                effective_timeout = float(self._bridge_config.default_timeout_seconds)

        start_time = time.monotonic()
        try:
            # 委托 protocol 写入请求
            request_id = await self._protocol.write_request(
                messages=full_messages,
                context=ctx,
                session_id=session_id,
                timeout_seconds=int(effective_timeout),
                request_id=task_id or None,
            )

            self._logger.info(
                f"chat 调用: forgekin={ctx.forgekin_id}, task={ctx.task_type}, "
                f"request_id={request_id}, session={session_id or 'N/A'}, "
                f"messages={len(full_messages)}, timeout={effective_timeout}s"
            )

            # 委托 protocol 轮询响应
            response: BridgeResponse = await self._protocol.poll_response(
                request_id,
                timeout=effective_timeout,
            )

            # 委托 protocol 解析响应
            result = self._protocol.parse_response(response)

            # 记录延迟
            latency_ms = (time.monotonic() - start_time) * 1000
            result["usage"] = result.get("usage", {}) or {}
            result["usage"]["latency_ms"] = latency_ms

            # 将 assistant 响应加入会话
            if session_id and self._config.session_persistence and result.get("content"):
                session = self._session_manager.get_session(session_id)
                if session:
                    session.add_message("assistant", result["content"])
                    await session.save()

            self._logger.info(
                f"chat 完成: request_id={request_id}, latency={latency_ms:.0f}ms, "
                f"content_len={len(result.get('content', ''))}"
            )
            return result

        except TraeBridgeError:
            raise
        except Exception as e:
            self._logger.exception(f"chat 调用异常: task_id={task_id}")
            raise TraeBridgeError(
                f"chat 调用失败: {e}",
                request_id=task_id,
            ) from e

    async def stream_chat(
        self,
        messages: List[Dict[str, str]],
        *,
        context: Optional[BridgeRequestContext] = None,
        session_id: str = "",
        task_id: str = "",
        **kwargs,
    ) -> AsyncIterator[str]:
        """流式聊天响应.

        注意：Bridge 模式下，先完整获取响应再分段 yield（模拟流式）。
        Phase 3 将实现真正的增量流式（F045 §2.1 双向通信支持）。

        Args:
            messages: 消息列表
            context: 请求上下文
            session_id: 可选会话 ID
            task_id: 可选任务 ID
            **kwargs: 向后兼容参数

        Yields:
            文本块
        """
        result = await self.chat(
            messages,
            context=context,
            session_id=session_id,
            task_id=task_id,
            **kwargs,
        )
        content = result.get("content", "")
        # 按行分割并逐行 yield，模拟流式效果
        chunk_size = kwargs.get("stream_chunk_size", 80)
        for i in range(0, len(content), chunk_size):
            yield content[i : i + chunk_size]
            await asyncio.sleep(0.01)  # 轻微延迟模拟流式

    async def chat_with_tools(
        self,
        messages: List[Dict[str, str]],
        tools: List[Dict[str, Any]],
        *,
        context: Optional[BridgeRequestContext] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """支持工具调用的聊天.

        Args:
            messages: 消息列表
            tools: 工具定义列表（OpenAI function-calling 格式）
            context: 请求上下文
            **kwargs: 向后兼容参数

        Returns:
            包含 content 和可能的 tool_calls 的响应
        """
        # 将 tools 注入 context
        ctx = context or BridgeRequestContext(
            forgekin_id=kwargs.get("forgekin_id", "unknown"),
            task_type="chat_with_tools",
        )
        ctx.tools = tools
        return await self.chat(messages, context=ctx, **kwargs)

    # ── 专用编码方法（便捷封装）──────────────────────────────────────

    async def complete_code(
        self,
        prompt: str,
        context: BridgeRequestContext,
        *,
        context_code: str = "",
        **kwargs,
    ) -> str:
        """代码补全专用方法.

        Args:
            prompt: 补全提示
            context: 请求上下文（forgekin_id 必填）
            context_code: 额外上下文代码
            **kwargs: 向后兼容参数

        Returns:
            补全的代码字符串
        """
        system_prompt = (
            "你是一个专业的代码补全助手。根据用户提供的上下文和提示，"
            "生成高质量的代码补全。只返回代码，不要解释。"
        )
        user_content = (
            f"上下文:\n{context_code}\n\n补全提示:\n{prompt}"
            if context_code
            else prompt
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        ctx = context
        ctx.task_type = "complete_code"
        result = await self.chat(messages, context=ctx, **kwargs)
        return result.get("content", "")

    async def review_code(
        self,
        code: str,
        context: BridgeRequestContext,
        *,
        language: str = "python",
        **kwargs,
    ) -> Dict[str, Any]:
        """代码审查专用方法.

        Args:
            code: 要审查的代码
            context: 请求上下文
            language: 代码语言
            **kwargs: 向后兼容参数

        Returns:
            {"findings": [...], "severity": "P1"|"P2"|"P3", "summary": str}
        """
        import json
        import re

        system_prompt = (
            "你是一个严格的代码审查专家。审查用户提交的代码，"
            "识别潜在问题（bug、安全漏洞、性能问题、风格问题）。"
            "返回 JSON 格式：\n"
            '{"findings": [{"type": "bug|security|performance|style", '
            '"description": "问题描述", "line": 行号, "severity": "P1|P2|P3"}], '
            '"severity": "整体严重等级 P1|P2|P3", "summary": "总结"}'
        )
        user_content = f"语言: {language}\n\n代码:\n```\n{code}\n```"
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        ctx = context
        ctx.task_type = "review_code"
        result = await self.chat(messages, context=ctx, temperature=0.3, **kwargs)
        content = result.get("content", "")

        review_result: Dict[str, Any] = {
            "findings": [],
            "severity": "P3",
            "summary": content,
            "raw_content": content,
        }
        try:
            cleaned = re.sub(
                r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE
            )
            cleaned = re.sub(r"\s*```$", "", cleaned.strip())
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                review_result.update(parsed)
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.debug(f"代码审查响应非 JSON 格式，返回原始内容: {e}")
        return review_result

    async def generate_tests(
        self,
        code: str,
        context: BridgeRequestContext,
        *,
        language: str = "python",
        **kwargs,
    ) -> str:
        """测试生成专用方法.

        Args:
            code: 要生成测试的代码
            context: 请求上下文
            language: 代码语言
            **kwargs: 向后兼容参数

        Returns:
            生成的测试代码字符串
        """
        system_prompt = (
            "你是一个测试工程师专家。根据用户提供的代码生成全面的单元测试。"
            "遵循以下原则：\n"
            "1. 覆盖正常路径和边界情况\n"
            "2. 测试异常和错误处理\n"
            "3. 使用真实的测试框架（Python 用 pytest）\n"
            "4. 测试数据必须是真实场景数据，禁止使用 'test'、'hello' 等假数据\n"
            "只返回测试代码，不要解释。"
        )
        user_content = f"语言: {language}\n\n代码:\n```\n{code}\n```"
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        ctx = context
        ctx.task_type = "generate_tests"
        result = await self.chat(messages, context=ctx, temperature=0.5, **kwargs)
        return result.get("content", "")

    # ── 健康检查 ────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """检查 Trae 桥接是否可用.

        Bridge 模式：检查桥接目录是否可读写（委托 protocol）。
        CLI/API 模式：未实现。
        """
        if self._config.mode == "bridge":
            return await self._protocol.health_check()
        elif self._config.mode == "cli":
            # CLI 模式未实现
            return False
        elif self._config.mode == "api":
            # API 模式未实现
            if not self._config.api_url:
                return False
            return False
        return False


__all__ = [
    "TraeLLMClient",
    # 向后兼容异常别名
    "TraeLLMError",
    "TraeLLMTimeoutError",
    "TraeLLMCliError",
    "TraeLLMApiError",
]

"""Trae LLM Client — 将 Trae AI 助手包装为编码 LLM.

核心 LLM 客户端，实现与 flowforge LLMClient 兼容的接口。
支持三种工作模式：
- cli: 通过命令行调用 trae CLI（未来 trae CLI 可用时）
- bridge: 通过文件桥接，devforge 写任务到文件，Trae AI 读取并写回响应（当前主模式）
- api: 通过 HTTP API 调用（未来 trae API 可用时）

Bridge 模式工作流程：
1. devforge 的 agent 调用 trae_client.chat(messages, session_id="devforge:coder:task123")
2. TraeLLMClient 将任务写入 data/trae_bridge/tasks/{task_id}.json
3. TraeLLMClient 轮询 data/trae_bridge/responses/{task_id}.json
4. Trae AI（在 IDE 中）看到任务文件，处理后将响应写入 responses 目录
5. TraeLLMClient 读取响应并返回给 agent
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from flowforge.core.tracing import get_logger

from flowforge.llm.trae.config import TraeConfig
from flowforge.llm.trae.session import TraeSession, TraeSessionManager

logger = get_logger("trae_llm.client")


class TraeLLMError(Exception):
    """Trae LLM 调用基础异常."""

    def __init__(self, message: str, mode: str = "", task_id: str = ""):
        self.mode = mode
        self.task_id = task_id
        super().__init__(message)


class TraeLLMTimeoutError(TraeLLMError):
    """Trae LLM 调用超时."""


class TraeLLMCliError(TraeLLMError):
    """Trae LLM CLI 调用错误."""


class TraeLLMApiError(TraeLLMError):
    """Trae LLM API 调用错误."""


class TraeLLMClient:
    """Trae LLM Client — 将 Trae AI 助手包装为编码 LLM.

    支持三种模式：
    - cli: 包装 trae CLI 命令（未来）
    - bridge: 基于文件桥接，当前使用（devforge 写任务，Trae AI 处理并写回响应）
    - api: HTTP API 调用（未来）

    用法示例：
        client = TraeLLMClient()
        result = await client.chat(
            messages=[{"role": "user", "content": "写一个 Python 函数"}],
            session_id="devforge:coder:task123",
        )
        print(result["content"])
    """

    def __init__(self, config: Optional[TraeConfig] = None):
        self._config = config or TraeConfig()
        self._session_manager = TraeSessionManager(self._config)
        self._logger = get_logger("trae_llm")
        # 桥接目录的 Path 对象（基于项目根解析）
        self._project_root = self._resolve_project_root()
        self._bridge_dir = self._project_root / self._config.bridge_dir
        self._tasks_dir = self._bridge_dir / "tasks"
        self._responses_dir = self._bridge_dir / "responses"
        self._ensure_bridge_dirs()

    @staticmethod
    def _resolve_project_root() -> Path:
        """解析项目根目录.

        优先使用 flowforge 包所在目录的父目录。
        """
        # flowforge/llm/trae/client.py → 向上3层到项目根
        return Path(__file__).parent.parent.parent.parent

    def _ensure_bridge_dirs(self) -> None:
        """确保桥接模式所需的目录存在."""
        if self._config.mode == "bridge":
            self._tasks_dir.mkdir(parents=True, exist_ok=True)
            self._responses_dir.mkdir(parents=True, exist_ok=True)

    def set_memory_manager(self, memory_manager: Any) -> None:
        """注入 MemoryManager（依赖注入，铁律3）.

        设置后，会话管理器会使用该 MemoryManager 进行会话持久化。
        """
        self._session_manager.set_memory_manager(memory_manager)

    @property
    def config(self) -> TraeConfig:
        """获取配置."""
        return self._config

    @property
    def session_manager(self) -> TraeSessionManager:
        """获取会话管理器."""
        return self._session_manager

    # ── 核心 chat 方法 ──────────────────────────────────────────────

    async def chat(self, messages: List[Dict[str, str]], **kwargs) -> Dict[str, Any]:
        """发送聊天请求并返回响应.

        Args:
            messages: 消息列表 [{"role": "system"|"user"|"assistant", "content": str}]
            **kwargs: 可选参数：
                - model: 模型名（默认使用 config.default_model）
                - temperature: 采样温度
                - max_tokens: 最大生成 token 数
                - tools: 工具定义列表
                - session_id: 会话 ID（用于保持上下文）
                - task_id: 任务 ID（如不指定则自动生成）

        Returns:
            {"content": str, "model": str, "usage": {...}, "tool_calls": [...]}

        Raises:
            TraeLLMTimeoutError: 调用超时
            TraeLLMCliError: CLI 调用失败
            TraeLLMApiError: API 调用失败
        """
        model = kwargs.get("model", self._config.default_model)
        session_id = kwargs.get("session_id", "")
        task_id = kwargs.get("task_id") or self._generate_task_id()

        # 会话上下文管理
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

        self._logger.info(
            f"chat 调用: mode={self._config.mode}, task_id={task_id}, "
            f"session_id={session_id}, messages={len(full_messages)}"
        )

        start_time = time.monotonic()
        try:
            if self._config.mode == "bridge":
                result = await self._chat_bridge(
                    full_messages, task_id=task_id, session_id=session_id, **kwargs
                )
            elif self._config.mode == "cli":
                result = await self._chat_cli(full_messages, **kwargs)
            elif self._config.mode == "api":
                result = await self._chat_api(full_messages, **kwargs)
            else:
                raise TraeLLMError(
                    f"不支持的模式: {self._config.mode}", mode=self._config.mode
                )

            latency_ms = (time.monotonic() - start_time) * 1000
            result.setdefault("model", model)
            result.setdefault("usage", {})
            result["usage"]["latency_ms"] = latency_ms

            # 将 assistant 响应加入会话
            if session_id and self._config.session_persistence and result.get("content"):
                session = self._session_manager.get_session(session_id)
                if session:
                    session.add_message("assistant", result["content"])
                    await session.save()

            self._logger.info(
                f"chat 完成: task_id={task_id}, latency={latency_ms:.0f}ms, "
                f"content_len={len(result.get('content', ''))}"
            )
            return result
        except TraeLLMError:
            raise
        except Exception as e:
            self._logger.exception(f"chat 调用异常: task_id={task_id}")
            raise TraeLLMError(
                f"chat 调用失败: {e}", mode=self._config.mode, task_id=task_id
            ) from e

    async def stream_chat(
        self, messages: List[Dict[str, str]], **kwargs
    ) -> AsyncIterator[str]:
        """流式聊天响应，逐 token 生成.

        注意：Bridge 模式下，先完整获取响应再分段 yield；
        CLI/API 模式未来可实现真正的流式。

        Args:
            messages: 消息列表
            **kwargs: 可选参数（同 chat）

        Yields:
            文本块
        """
        result = await self.chat(messages, **kwargs)
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
        **kwargs,
    ) -> Dict[str, Any]:
        """支持工具调用的聊天.

        Args:
            messages: 消息列表
            tools: 工具定义列表（OpenAI function-calling 格式）
            **kwargs: 可选参数（同 chat）

        Returns:
            包含 content 和可能的 tool_calls 的响应
        """
        kwargs["tools"] = tools
        result = await self.chat(messages, **kwargs)
        # bridge 模式下，tool_calls 由 Trae AI 在响应中提供
        return result

    # ── 专用编码方法 ─────────────────────────────────────────────────

    async def complete_code(
        self, prompt: str, context: str = "", **kwargs
    ) -> str:
        """代码补全专用方法.

        Args:
            prompt: 补全提示（如已输入的代码或描述）
            context: 额外上下文（如文件内容、光标位置等）
            **kwargs: 可选参数

        Returns:
            补全的代码字符串
        """
        system_prompt = (
            "你是一个专业的代码补全助手。根据用户提供的上下文和提示，"
            "生成高质量的代码补全。只返回代码，不要解释。"
        )
        user_content = f"上下文:\n{context}\n\n补全提示:\n{prompt}" if context else prompt
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        result = await self.chat(messages, **kwargs)
        return result.get("content", "")

    async def review_code(
        self, code: str, language: str = "python", **kwargs
    ) -> Dict[str, Any]:
        """代码审查专用方法.

        Args:
            code: 要审查的代码
            language: 代码语言
            **kwargs: 可选参数

        Returns:
            {"findings": [...], "severity": "P1"|"P2"|"P3", "summary": str}
        """
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
        result = await self.chat(messages, temperature=0.3, **kwargs)
        content = result.get("content", "")

        # 尝试解析 JSON 响应
        review_result: Dict[str, Any] = {
            "findings": [],
            "severity": "P3",
            "summary": content,
            "raw_content": content,
        }
        try:
            import re

            cleaned = re.sub(r"^```(?:json)?\s*", "", content.strip(), flags=re.MULTILINE)
            cleaned = re.sub(r"\s*```$", "", cleaned.strip())
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                review_result.update(parsed)
        except (json.JSONDecodeError, ValueError) as e:
            self._logger.debug(f"代码审查响应非 JSON 格式，返回原始内容: {e}")
        return review_result

    async def generate_tests(
        self, code: str, language: str = "python", **kwargs
    ) -> str:
        """测试生成专用方法.

        Args:
            code: 要生成测试的代码
            language: 代码语言
            **kwargs: 可选参数

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
        result = await self.chat(messages, temperature=0.5, **kwargs)
        return result.get("content", "")

    # ── Bridge 模式实现 ─────────────────────────────────────────────

    async def _chat_bridge(
        self,
        messages: List[Dict[str, str]],
        *,
        task_id: str,
        session_id: str = "",
        **kwargs,
    ) -> Dict[str, Any]:
        """Bridge 模式：通过文件桥接调用 Trae AI.

        1. 将任务写入 tasks/{task_id}.json
        2. 轮询 responses/{task_id}.json
        3. 读取响应并返回
        """
        task_file = self._tasks_dir / f"{task_id}.json"
        response_file = self._responses_dir / f"{task_id}.json"

        # 清理可能存在的旧响应文件
        if response_file.exists():
            response_file.unlink()

        # 构造任务数据
        task_data = {
            "task_id": task_id,
            "session_id": session_id,
            "messages": messages,
            "context": {
                "model": kwargs.get("model", self._config.default_model),
                "temperature": kwargs.get("temperature", 0.7),
                "max_tokens": kwargs.get("max_tokens", 4096),
            },
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "status": "pending",
        }

        # 写入任务文件
        task_file.write_text(
            json.dumps(task_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        self._logger.info(
            f"Bridge 任务已写入: {task_file} (session={session_id})"
        )

        # 轮询等待响应
        timeout = kwargs.get("bridge_timeout", self._config.bridge_timeout)
        poll_interval = self._config.bridge_poll_interval
        elapsed = 0.0
        start = time.monotonic()

        while elapsed < timeout:
            await asyncio.sleep(poll_interval)
            elapsed = time.monotonic() - start

            if response_file.exists():
                try:
                    response_data = json.loads(
                        response_file.read_text(encoding="utf-8")
                    )
                    status = response_data.get("status", "")
                    if status == "completed":
                        self._logger.info(
                            f"Bridge 响应已收到: {response_file} "
                            f"(等待 {elapsed:.1f}s)"
                        )
                        # 清理任务文件（响应文件保留供审计）
                        self._cleanup_task_file(task_file)
                        return self._parse_bridge_response(response_data)
                    elif status == "error":
                        error_msg = response_data.get("error", "未知错误")
                        self._cleanup_task_file(task_file)
                        self._cleanup_response_file(response_file)
                        raise TraeLLMError(
                            f"Bridge 响应错误: {error_msg}",
                            mode="bridge",
                            task_id=task_id,
                        )
                    # status 为其他值（如 processing）继续等待
                except json.JSONDecodeError as e:
                    self._logger.warning(
                        f"响应文件 JSON 解析失败，继续等待: {e}"
                    )

            if elapsed % 30 < poll_interval:  # 每30秒打印一次等待日志
                self._logger.debug(
                    f"Bridge 等待响应: task_id={task_id}, "
                    f"elapsed={elapsed:.0f}s/{timeout}s"
                )

        # 超时
        self._cleanup_task_file(task_file)
        raise TraeLLMTimeoutError(
            f"Bridge 模式超时: task_id={task_id}, timeout={timeout}s",
            mode="bridge",
            task_id=task_id,
        )

    def _parse_bridge_response(self, response_data: Dict[str, Any]) -> Dict[str, Any]:
        """解析 bridge 响应文件内容为标准返回格式."""
        content = response_data.get("content", "")
        model = response_data.get("model", self._config.default_model)
        usage = response_data.get("usage", {})
        tool_calls = response_data.get("tool_calls", [])

        return {
            "content": content,
            "model": model,
            "usage": usage,
            "tool_calls": tool_calls if tool_calls else [],
        }

    def _cleanup_task_file(self, task_file: Path) -> None:
        """清理任务文件."""
        try:
            if task_file.exists():
                task_file.unlink()
        except OSError as e:
            self._logger.warning(f"清理任务文件失败: {task_file}, {e}")

    def _cleanup_response_file(self, response_file: Path) -> None:
        """清理响应文件."""
        try:
            if response_file.exists():
                response_file.unlink()
        except OSError as e:
            self._logger.warning(f"清理响应文件失败: {response_file}, {e}")

    # ── CLI 模式实现（未来） ────────────────────────────────────────

    async def _chat_cli(
        self, messages: List[Dict[str, str]], **kwargs
    ) -> Dict[str, Any]:
        """CLI 模式：通过 subprocess 异步调用 trae CLI.

        未来 trae CLI 可用时实现。当前抛出 NotImplementedError。
        """
        raise TraeLLMCliError(
            "CLI 模式尚未实现：trae CLI 不可用。请使用 bridge 模式。",
            mode="cli",
        )

    # ── API 模式实现（未来） ────────────────────────────────────────

    async def _chat_api(
        self, messages: List[Dict[str, str]], **kwargs
    ) -> Dict[str, Any]:
        """API 模式：通过 HTTP API 调用 trae.

        未来 trae API 可用时实现。当前抛出 NotImplementedError。
        """
        if not self._config.api_url:
            raise TraeLLMApiError(
                "API 模式尚未配置：api_url 为空。请设置 TRAE_API_URL 环境变量。",
                mode="api",
            )

        try:
            import httpx
        except ImportError as e:
            raise TraeLLMApiError(
                "httpx 未安装，无法使用 API 模式", mode="api"
            ) from e

        headers = {"Content-Type": "application/json"}
        if self._config.api_key:
            headers["Authorization"] = f"Bearer {self._config.api_key}"

        payload = {
            "model": kwargs.get("model", self._config.default_model),
            "messages": messages,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 4096),
        }
        if kwargs.get("tools"):
            payload["tools"] = kwargs["tools"]

        timeout = kwargs.get("timeout", self._config.timeout)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{self._config.api_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()
                return {
                    "content": data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", ""),
                    "model": data.get("model", payload["model"]),
                    "usage": data.get("usage", {}),
                    "tool_calls": data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("tool_calls", []),
                }
        except httpx.HTTPStatusError as e:
            raise TraeLLMApiError(
                f"API HTTP 错误: {e.response.status_code} - {e.response.text}",
                mode="api",
            ) from e
        except httpx.RequestError as e:
            raise TraeLLMApiError(f"API 请求错误: {e}", mode="api") from e

    # ── 辅助方法 ────────────────────────────────────────────────────

    @staticmethod
    def _generate_task_id() -> str:
        """生成唯一任务 ID."""
        return f"task_{uuid.uuid4().hex[:12]}"

    async def health_check(self) -> bool:
        """检查 Trae LLM 是否可用.

        Bridge 模式：检查桥接目录是否可读写。
        CLI 模式：检查 trae 命令是否存在。
        API 模式：发送 ping 请求。
        """
        try:
            if self._config.mode == "bridge":
                # 检查目录是否可写
                test_file = self._tasks_dir / ".health_check"
                test_file.write_text("ok", encoding="utf-8")
                test_file.unlink()
                return True
            elif self._config.mode == "cli":
                # 检查 trae 命令是否存在
                proc = await asyncio.create_subprocess_exec(
                    self._config.cli_command, "--version",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await proc.wait()
                return proc.returncode == 0
            elif self._config.mode == "api":
                if not self._config.api_url:
                    return False
                import httpx
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.get(f"{self._config.api_url}/health")
                    return resp.status_code == 200
            return False
        except Exception as e:
            self._logger.warning(f"健康检查失败: {e}")
            return False

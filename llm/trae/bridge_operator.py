"""Trae 桥接 LLM Operator — 监听桥接请求并通过 OpenRoute 调用 LLM 回写响应.

本模块是 Trae 桥接协议的 operator 端实现（F045 §2.1 协议流程步骤 4-5）：
- 监听 .trae_bridge/requests/ 目录中的 request_*.json 文件
- 读取请求中的 messages 字段
- 通过 OpenRoute API 调用 DeepSeek-V4-Pro 模型
- 将 LLM 响应写入 responses/response_{request_id}.json

用法：
    python -m flowforge.llm.trae.bridge_operator
    或
    from flowforge.llm.trae.bridge_operator import BridgeLLMOperator
    async with BridgeLLMOperator() as op:
        ...
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# 确保能导入 flowforge 包（本文件位于 flowforge/llm/trae/ 下，parents[3] 为项目根 openclaw）
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

import httpx

from flowforge.core.tracing import get_logger
from flowforge.llm.trae.config import TraeBridgeConfig
from flowforge.llm.trae.models import BridgeResponseStatus

logger = get_logger(__name__)


class BridgeLLMOperator:
    """LLM-backed Trae 桥接 operator.

    监听桥接 requests 目录，读取请求消息，调用 OpenRoute LLM，
    将响应写回 responses 目录。支持取消文件逃生舱与超时/错误处理。

    Attributes:
        config: 桥接配置（目录/路径）
        openroute_base_url: OpenRoute API 基础 URL（形如 http://localhost:13001/v1）
        openroute_api_key: OpenRoute API key
        model: 调用的模型名
        poll_interval: 轮询 requests 目录间隔（秒）
        llm_timeout: LLM 调用超时（秒）
    """

    # 重试时切换的 fallback 模型列表（主模型沉默失败后按 attempt 顺序切换）
    # attempt=1 用主模型 self._model；attempt>=2 用 FALLBACK_MODELS[attempt-1]
    FALLBACK_MODELS: list[str] = ["Doubao-Seed2.0", "Kimi-K2.6", "GLM-5.1", "auto"]

    def __init__(
        self,
        config: Optional[TraeBridgeConfig] = None,
        *,
        openroute_base_url: str = "http://localhost:13001/v1",
        openroute_api_key: str = "or-6eb9e20d63d01d190b0e26d06c9f5acc4a0ea248a5dd62e7",
        model: str = "Doubao-Seed2.0",
        poll_interval: float = 1.0,
        llm_timeout: float = 180.0,
    ) -> None:
        """初始化 operator.

        Args:
            config: 桥接配置，None 时使用默认 TraeBridgeConfig()
            openroute_base_url: OpenRoute API 基础 URL，尾部 /v1 会被剥离后统一拼接
            openroute_api_key: OpenRoute API key
            model: 调用的模型名
            poll_interval: 轮询 requests 目录间隔秒数
            llm_timeout: 单次 LLM 调用超时秒数
        """
        self._config = config or TraeBridgeConfig()
        self._openroute_base_url = openroute_base_url
        self._openroute_api_key = openroute_api_key
        self._model = model
        self._poll_interval = poll_interval
        self._llm_timeout = llm_timeout

        # 规范化 base_url：剥离尾部 /v1，后续统一拼 /v1/chat/completions
        self._api_base = openroute_base_url.removesuffix("/v1")
        self._chat_endpoint = f"{self._api_base}/v1/chat/completions"

        # 目录路径
        self._shared_dir = Path(self._config.shared_dir)
        self._requests_dir = Path(self._config.requests_path)
        self._responses_dir = Path(self._config.responses_path)
        self._cancels_dir = Path(self._config.cancels_path)

        self._client: Optional[httpx.AsyncClient] = None
        self._stop_event = asyncio.Event()
        self._poll_task: Optional[asyncio.Task] = None
        self._handled_requests: set[str] = set()
        self._stats: Dict[str, int] = {
            "received": 0,
            "completed": 0,
            "errors": 0,
            "timeouts": 0,
            "cancelled": 0,
        }

    # ── 生命周期 ─────────────────────────────────────────────────

    async def start(self) -> None:
        """启动 operator：创建目录、HTTP 客户端，开始轮询."""
        if self._poll_task is not None and not self._poll_task.done():
            return

        # 确保目录存在
        self._requests_dir.mkdir(parents=True, exist_ok=True)
        self._responses_dir.mkdir(parents=True, exist_ok=True)
        self._cancels_dir.mkdir(parents=True, exist_ok=True)

        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(self._llm_timeout),
            headers={
                "Authorization": f"Bearer {self._openroute_api_key}",
                "Content-Type": "application/json",
            },
        )
        self._stop_event.clear()
        self._poll_task = asyncio.create_task(self._poll_loop())
        logger.info(
            f"BridgeLLMOperator 已启动: requests={self._requests_dir}, "
            f"endpoint={self._chat_endpoint}, model={self._model}, "
            f"poll_interval={self._poll_interval}s, llm_timeout={self._llm_timeout}s"
        )

    async def stop(self) -> None:
        """停止 operator：取消轮询任务并关闭 HTTP 客户端."""
        if self._poll_task is not None:
            self._stop_event.set()
            self._poll_task.cancel()
            try:
                await asyncio.wait_for(self._poll_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            self._poll_task = None

        if self._client is not None:
            await self._client.aclose()
            self._client = None

        logger.info(f"BridgeLLMOperator 已停止: stats={self._stats}")

    async def __aenter__(self) -> "BridgeLLMOperator":
        await self.start()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.stop()
    # ── 轮询主循环 ───────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        """轮询 requests 目录，发现新 request 文件后处理."""
        try:
            while not self._stop_event.is_set():
                try:
                    for req_file in self._requests_dir.glob("request_*.json"):
                        await self._handle_request_file(req_file)
                except Exception as e:
                    logger.warning(f"轮询异常: {e}")
                    self._stats["errors"] += 1
                await asyncio.sleep(self._poll_interval)
        except asyncio.CancelledError:
            pass

    async def _handle_request_file(self, req_file: Path) -> None:
        """处理单个 request 文件：读取、检查取消、调用 LLM、写响应.

        通过原子文件重命名实现跨进程互斥：将 ``request_xxx.json`` 重命名为
        ``request_xxx.json.processing``，重命名成功者获得处理权，失败者
        表示已被其他 operator 进程接手，直接跳过。这解决了多 operator
        进程并发处理同一请求导致响应被覆盖的竞态问题。
        """
        # 跨进程互斥：原子重命名 request_xxx.json → request_xxx.json.processing
        processing_file = req_file.with_suffix(req_file.suffix + ".processing")
        try:
            await asyncio.to_thread(req_file.rename, processing_file)
        except OSError:
            # 文件不存在（已被处理/归档）或被其他进程抢先重命名
            return

        try:
            data = json.loads(processing_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"解析 request 失败: {processing_file}, {e}")
            await self._safe_unlink(processing_file)
            return

        request_id = data.get("request_id", "")
        if not request_id or request_id in self._handled_requests:
            await self._safe_unlink(processing_file)
            return

        # 只处理 pending 状态的请求
        status = data.get("status", "")
        if status != "pending":
            await self._safe_unlink(processing_file)
            return

        self._handled_requests.add(request_id)
        self._stats["received"] += 1

        messages = data.get("messages", []) or []
        context = data.get("context", {}) or {}
        logger.info(
            f"收到请求: {request_id[:8]}... "
            f"(forgekin={context.get('forgekin_id', '?')}, "
            f"task={context.get('task_type', '?')})"
        )

        # 检查取消文件（不变量 8 逃生舱）
        cancel_file = self._cancels_dir / f"cancel_{request_id}.json"
        if cancel_file.exists():
            self._stats["cancelled"] += 1
            logger.info(f"检测到 cancel 文件，跳过请求: {request_id[:8]}...")
            await self._safe_unlink(processing_file)
            return

        # 调用 LLM 并写回响应
        result = await self._call_llm(messages)

        # 按结果状态更新统计
        result_status = result.get("status", BridgeResponseStatus.ERROR.value)
        if result_status == BridgeResponseStatus.COMPLETED.value:
            self._stats["completed"] += 1
        elif result_status == "timeout":
            self._stats["timeouts"] += 1
        else:
            self._stats["errors"] += 1

        await self._write_response(request_id, result)
        # 处理完成，清理 .processing 文件
        await self._safe_unlink(processing_file)

    async def _safe_unlink(self, file_path: Path) -> None:
        """安全删除文件，忽略文件不存在的错误."""
        try:
            await asyncio.to_thread(file_path.unlink)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning(f"删除文件失败: {file_path}, {e}")

    # ── 无效响应检测 ─────────────────────────────────────────────

    # 无效响应检测模式（参考 project_memory 的 fallback_patterns）
    # 用于检测 LLM 沉默失败：状态返回 completed 但内容是"无法回答"等无效内容
    INVALID_RESPONSE_PATTERNS: list[str] = [
        "无法回答", "无法回答这个问题", "我暂时无法回答",
        "我不能回答", "我无法提供", "我无法完成",
        "当前不可用，请稍后重试", "当前不可用,请稍后重试",
    ]

    def _is_invalid_response(self, content: str) -> bool:
        """检测 LLM 响应是否为无效的沉默失败内容.

        Args:
            content: LLM 返回的内容

        Returns:
            True 表示是无效响应（需要重试），False 表示有效
        """
        if not content or not content.strip():
            return False

        stripped = content.strip()

        # 1. 精确匹配或主要匹配 INVALID_RESPONSE_PATTERNS
        for pattern in self.INVALID_RESPONSE_PATTERNS:
            if stripped == pattern:
                return True
            if stripped.startswith(pattern):
                return True
            # 主要匹配：pattern 是内容的核心部分
            if pattern in stripped and len(stripped) <= len(pattern) + 20:
                return True

        # 2. 内容过短（<10字符）且包含"无法"/"不能"/"暂"等关键词
        if len(stripped) < 10:
            short_keywords = ["无法", "不能", "暂"]
            if any(kw in stripped for kw in short_keywords):
                return True

        return False

    # ── LLM 调用 ─────────────────────────────────────────────────

    def _merge_system_into_user(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """将 system role message 合并到第一条 user message 前面.

        OpenRoute 的 web chat 模型（DeepSeek-V4-Pro/Doubao-Seed2.0/Doubao/GLM 等）不处理
        OpenAI 协议中的 system role message，导致灵智体的角色 system prompt
        被忽略。本方法将所有 system message 内容合并到第一条 user message
        前面，确保 web chat 模型能"看到"角色设定。

        Args:
            messages: 原始消息列表（可能包含 system/user/assistant 角色）

        Returns:
            处理后的消息列表，只包含 user/assistant 角色
        """
        if not messages:
            return messages

        # 分离 system 消息和其他消息
        system_contents = []
        other_messages = []
        for msg in messages:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "system":
                if content:
                    system_contents.append(content)
            else:
                other_messages.append(msg)

        # 如果没有 system 消息，直接返回原消息
        if not system_contents:
            return messages

        # 合并 system 内容
        merged_system = "\n\n".join(system_contents)

        # 找到第一条 user 消息，将 system 内容合并到前面
        result = []
        user_merged = False
        for msg in other_messages:
            if msg.get("role") == "user" and not user_merged:
                # 合并 system 到 user 前面
                user_content = msg.get("content", "")
                merged_content = f"{merged_system}\n\n---\n\n{user_content}"
                result.append({
                    "role": "user",
                    "content": merged_content,
                })
                user_merged = True
            else:
                result.append(msg)

        # 如果没有 user 消息，把 system 作为 user 消息
        if not user_merged:
            result.insert(0, {
                "role": "user",
                "content": merged_system,
            })

        logger.debug(
            f"合并 system 到 user: system_len={len(merged_system)}, "
            f"original_messages={len(messages)}, processed_messages={len(result)}"
        )

        return result

    async def _call_llm(self, messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """调用 OpenRoute chat completions API.

        支持无效响应检测与重试：当 LLM 返回"无法回答"等沉默失败内容时，
        自动重试最多 3 次，每次间隔 2 秒。重试耗尽后返回最后一次响应。

        Args:
            messages: OpenAI 兼容的消息列表（role + content）

        Returns:
            结果字典，包含 content/status/usage/error/model/attempts 字段。
            status 取值：completed | timeout | error
            attempts: 实际尝试次数（1-3）
        """
        client = self._client
        if client is None:
            # 防御性兜底：未启动时也能调用（同步上下文外使用）
            client = httpx.AsyncClient(
                timeout=httpx.Timeout(self._llm_timeout),
                headers={
                    "Authorization": f"Bearer {self._openroute_api_key}",
                    "Content-Type": "application/json",
                },
            )

        max_attempts = 3
        retry_wait_seconds = 2.0
        last_result: Optional[Dict[str, Any]] = None

        # ── 预处理 messages：合并 system 到 user（web chat 模式不支持 system role）──
        processed_messages = self._merge_system_into_user(messages)

        for attempt in range(1, max_attempts + 1):
            start_time = time.monotonic()

            # 模型选择：attempt=1 用主模型；重试时切换到 fallback 模型提高成功率
            if attempt == 1:
                model = self._model
            else:
                fallback_idx = min(attempt - 1, len(self.FALLBACK_MODELS) - 1)
                model = self.FALLBACK_MODELS[fallback_idx]
                logger.info(
                    f"切换到 fallback 模型 (attempt={attempt}/{max_attempts}): {model}"
                )

            try:
                payload = {
                    "model": model,
                    "messages": processed_messages,
                }
                resp = await client.post(self._chat_endpoint, json=payload)
                resp.raise_for_status()
                data = resp.json()

                content = ""
                choices = data.get("choices") or []
                if choices:
                    content = choices[0].get("message", {}).get("content", "") or ""

                usage = data.get("usage") or {}
                latency_ms = int((time.monotonic() - start_time) * 1000)
                usage_with_latency = {
                    "latency_ms": latency_ms,
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                }

                # 检测无效响应（沉默失败：状态 completed 但内容无效）
                if self._is_invalid_response(content):
                    logger.warning(
                        f"检测到无效响应 (attempt={attempt}): {content[:50]}..."
                    )
                    last_result = {
                        "content": content,
                        "status": BridgeResponseStatus.COMPLETED.value,
                        "usage": usage_with_latency,
                        "error": "",
                        "model": model,
                        "attempts": attempt,
                    }
                    if attempt < max_attempts:
                        logger.info(
                            f"重试 LLM 调用 (attempt={attempt + 1}/{max_attempts})"
                        )
                        await asyncio.sleep(retry_wait_seconds)
                        continue
                    else:
                        logger.warning(
                            f"重试耗尽，返回最后响应 (attempts={attempt})"
                        )
                        return last_result

                logger.info(
                    f"LLM 调用成功: latency={latency_ms}ms, "
                    f"tokens={usage_with_latency['total_tokens']}, "
                    f"content_len={len(content)}, attempts={attempt}"
                )

                return {
                    "content": content,
                    "status": BridgeResponseStatus.COMPLETED.value,
                    "usage": usage_with_latency,
                    "error": "",
                    "model": model,
                    "attempts": attempt,
                }
            except httpx.TimeoutException as e:
                latency_ms = int((time.monotonic() - start_time) * 1000)
                err_msg = f"LLM 调用超时: {e}"
                logger.warning(f"{err_msg} (latency={latency_ms}ms)")
                last_result = {
                    "content": err_msg,
                    "status": "timeout",
                    "usage": {
                        "latency_ms": latency_ms,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                    },
                    "error": err_msg,
                    "model": model,
                    "attempts": attempt,
                }
                if attempt < max_attempts:
                    logger.info(
                        f"超时后切换 fallback 模型重试 (attempt={attempt + 1}/{max_attempts})"
                    )
                    await asyncio.sleep(retry_wait_seconds)
                    continue
                else:
                    logger.warning(
                        f"重试耗尽，返回超时 (attempts={attempt})"
                    )
                    return last_result
            except Exception as e:
                latency_ms = int((time.monotonic() - start_time) * 1000)
                err_msg = f"LLM 调用失败: {e}"
                logger.error(f"{err_msg} (latency={latency_ms}ms)", exc_info=True)
                return {
                    "content": err_msg,
                    "status": BridgeResponseStatus.ERROR.value,
                    "usage": {
                        "latency_ms": latency_ms,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                    },
                    "error": err_msg,
                    "model": model,
                    "attempts": attempt,
                }

        # 防御性兜底：循环正常结束但未返回（理论不会到达）
        return last_result if last_result is not None else {
            "content": "",
            "status": BridgeResponseStatus.ERROR.value,
            "usage": {},
            "error": "未知错误：重试循环异常退出",
            "model": self._model,
            "attempts": max_attempts,
        }

    # ── 响应写入 ─────────────────────────────────────────────────

    async def _write_response(self, request_id: str, result: Dict[str, Any]) -> None:
        """写入 response_{request_id}.json 文件.

        Args:
            request_id: 关联的请求 ID
            result: _call_llm 返回的结果字典
        """
        response_file = self._responses_dir / f"response_{request_id}.json"
        payload = {
            "request_id": request_id,
            "content": result.get("content", ""),
            "status": result.get("status", BridgeResponseStatus.ERROR.value),
            "model": result.get("model", self._model),
            "usage": result.get("usage", {}),
            "tool_calls": [],
            "error": result.get("error", ""),
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await asyncio.to_thread(
                response_file.write_text,
                json.dumps(payload, ensure_ascii=False, indent=2),
                "utf-8",
            )
            logger.info(
                f"已写入响应: {request_id[:8]}... "
                f"(status={payload['status']}, content_len={len(payload['content'])})"
            )
        except OSError as e:
            logger.error(f"写入 response 失败: {request_id}, {e}")

    # ── 状态查询 ─────────────────────────────────────────────────

    @property
    def stats(self) -> Dict[str, int]:
        """获取 operator 统计信息."""
        return dict(self._stats)


async def main() -> None:
    """主入口：启动 operator 服务并持续运行直到被中断."""
    operator = BridgeLLMOperator()
    await operator.start()
    logger.info("BridgeLLMOperator 服务已启动，按 Ctrl+C 退出")

    stop_event = asyncio.Event()
    try:
        # 注册信号处理（POSIX 平台）
        try:
            import signal

            loop = asyncio.get_running_loop()
            for sig in (signal.SIGINT, signal.SIGTERM):
                loop.add_signal_handler(sig, stop_event.set)
        except (NotImplementedError, AttributeError):
            # Windows 不支持 add_signal_handler，依赖 KeyboardInterrupt 退出
            pass

        await stop_event.wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        await operator.stop()


if __name__ == "__main__":
    asyncio.run(main())
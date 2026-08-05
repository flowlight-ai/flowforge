"""Trae 桥接协议层 — F045 §2.2 关键接口 + §2.3 不变量.

TraeBridgeProtocol 负责所有文件 I/O 与协议逻辑：
- write_request: 写入 request_{uuid}.json（不变量 1 唯一性 + 不变量 7 operator 可见性）
- poll_response: 轮询 response_{uuid}.json（不变量 3 超时保证 + 不变量 8 逃生舱）
- parse_response: 解析响应为标准 LLMResponse 格式
- check_cancel: 检测 operator 取消（不变量 8）
- archive: 归档完成请求（不变量 4 不丢数据）
- update_status: 更新 status.json（operator 可见性）

设计原则：
- 协议层无 LLM 逻辑，只负责文件协议
- 所有路径从 TraeBridgeConfig 读取（不变量 6 不硬编码）
- 异步 I/O（铁律：所有 I/O 使用 async/await）
- UUID4 保证文件名唯一（不变量 1）
- 请求-响应通过 request_id 配对（不变量 2）
"""

from __future__ import annotations

import asyncio
import json
import shutil
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from flowforge.core.tracing import get_logger
from flowforge.llm.trae.config import TraeBridgeConfig
from flowforge.llm.trae.exceptions import (
    TraeBridgeCancelledError,
    TraeBridgeIOError,
    TraeBridgeProtocolError,
    TraeBridgeTimeoutError,
)
from flowforge.llm.trae.models import (
    BridgeCancel,
    BridgeMessage,
    BridgeRequest,
    BridgeRequestContext,
    BridgeRequestStatus,
    BridgeResponse,
    BridgeResponseStatus,
    BridgeStatus,
)
from flowforge.llm.trae.watcher import TraeBridgeWatcher

logger = get_logger("trae_llm.protocol")


class TraeBridgeProtocol:
    """Trae 桥接协议层 — F045 §2.2 关键接口.

    所有文件 I/O 与协议逻辑集中在此类，TraeLLMClient 通过组合方式调用。
    遵守铁律 3（依赖注入）：通过构造函数注入 TraeBridgeConfig。

    用法：
        config = TraeBridgeConfig.load_from_yaml("config/trae_bridge.yaml")
        protocol = TraeBridgeProtocol(config)
        request_id = await protocol.write_request(messages, context)
        response = await protocol.poll_response(request_id, timeout=300)
        result = protocol.parse_response(response)
    """

    def __init__(
        self,
        config: TraeBridgeConfig | None = None,
        *,
        watcher: TraeBridgeWatcher | None = None,
        enable_watcher: bool = False,
    ) -> None:
        """初始化桥接协议层.

        Args:
            config: 桥接配置（None 用默认配置）
            watcher: 可选的预创建 TraeBridgeWatcher 实例（优先级高于 enable_watcher）
            enable_watcher: 是否自动创建并启动 watcher（watchdog 不可用时降级到轮询）
        """
        self._config = config or TraeBridgeConfig()
        self._shared_dir = Path(self._config.shared_dir)
        self._requests_dir = self._shared_dir / self._config.requests_dir
        self._responses_dir = self._shared_dir / self._config.responses_dir
        self._cancels_dir = self._shared_dir / self._config.cancels_dir
        self._acks_dir = self._shared_dir / self._config.acks_dir
        self._archive_dir = self._shared_dir / self._config.archive_dir
        self._status_file = self._shared_dir / "status.json"
        self._ensure_dirs()

        # 文件监听器（可选，事件驱动加速）
        self._watcher: TraeBridgeWatcher | None = watcher
        self._watcher_owned = False  # 标记是否由本实例管理生命周期
        if self._watcher is None and enable_watcher and TraeBridgeWatcher(config=self._config).available:
            self._watcher = TraeBridgeWatcher(self._config)
            self._watcher_owned = True

    # ── 目录初始化 ───────────────────────────────────────────────────

    def _ensure_dirs(self) -> None:
        """确保所有桥接目录存在（不变量 6 路径从配置读取）."""
        try:
            for d in (
                self._shared_dir,
                self._requests_dir,
                self._responses_dir,
                self._cancels_dir,
                self._acks_dir,
                self._archive_dir,
            ):
                d.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise TraeBridgeIOError(
                f"创建桥接目录失败: {self._shared_dir}, {e}",
            ) from e

        if self._config.cleanup_on_startup:
            self._cleanup_pending_requests()

    def _cleanup_pending_requests(self) -> None:
        """启动时清理遗留的 pending 请求（标记为 timeout）.

        对应 F045 §2.3 不变量 3：超时保证。
        避免重启后 pending 请求永久挂起。
        """
        try:
            for req_file in self._requests_dir.glob("request_*.json"):
                try:
                    data = json.loads(req_file.read_text(encoding="utf-8"))
                    if data.get("status") == BridgeRequestStatus.PENDING.value:
                        data["status"] = BridgeRequestStatus.TIMEOUT.value
                        data["timeout_at"] = datetime.now(UTC).isoformat()
                        req_file.write_text(
                            json.dumps(data, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                        logger.warning(
                            f"启动清理：标记遗留请求为 timeout: {req_file.name}"
                        )
                except (json.JSONDecodeError, OSError) as e:
                    logger.warning(f"清理请求文件失败: {req_file}, {e}")
        except Exception as e:
            logger.warning(f"cleanup_pending_requests 异常: {e}")

    # ── 写入请求（不变量 1 + 7）────────────────────────────────────

    async def write_request(
        self,
        messages: list[dict[str, str]],
        context: BridgeRequestContext,
        *,
        session_id: str = "",
        timeout_seconds: int | None = None,
        request_id: str | None = None,
    ) -> str:
        """写入 request_{uuid}.json 文件.

        对应 F045 §2.1 协议流程步骤 2 + §2.3 不变量 1（UUID4 唯一）+ 不变量 7（operator 可见性）。

        Args:
            messages: 消息列表 [{"role": "system"|"user"|"assistant", "content": str}]
            context: 请求上下文（forgekin_id + task_type + task_summary 等）
            session_id: 可选会话 ID
            timeout_seconds: 超时秒数（None 用 config.default_timeout_seconds）
            request_id: 可选请求 ID（None 自动生成 UUID4）

        Returns:
            request_id: UUID4 字符串，用于后续 poll_response

        Raises:
            TraeBridgeIOError: 文件写入失败
            TraeBridgeProtocolError: 消息格式非法
        """
        # 生成或使用传入的 request_id（不变量 1 UUID4 唯一）
        rid = request_id or str(uuid.uuid4())

        # 校验消息格式
        if not messages:
            raise TraeBridgeProtocolError("messages 不能为空")
        try:
            bridge_messages = [BridgeMessage(**m) for m in messages]
        except Exception as e:
            raise TraeBridgeProtocolError(
                f"消息格式非法（role 必须是 system/user/assistant）: {e}",
                request_id=rid,
            ) from e

        # 构造请求对象
        timeout_secs = timeout_seconds or self._config.default_timeout_seconds
        request = BridgeRequest(
            request_id=rid,
            session_id=session_id,
            messages=bridge_messages,
            context=context,
            timeout_seconds=timeout_secs,
            status=BridgeRequestStatus.PENDING,
        )

        # 写入文件（request_{uuid}.json）
        request_file = self._requests_dir / f"request_{rid}.json"
        try:
            payload = request.model_dump_json(indent=2)
            # 异步写入（使用 asyncio.to_thread 避免阻塞事件循环）
            await asyncio.to_thread(
                request_file.write_text, payload, "utf-8"
            )
        except OSError as e:
            raise TraeBridgeIOError(
                f"写入请求文件失败: {request_file}, {e}",
                request_id=rid,
            ) from e

        logger.info(
            f"Bridge 请求已写入: {request_file.name} "
            f"(forgekin={context.forgekin_id}, task={context.task_type}, "
            f"session={session_id or 'N/A'}, timeout={timeout_secs}s)"
        )

        # 更新 status.json（不变量 7 operator 可见性）
        if self._config.update_status_on_write:
            await self._bump_status(pending_delta=1)

        return rid

    # ── 轮询响应（不变量 3 + 8）─────────────────────────────────────

    async def poll_response(
        self,
        request_id: str,
        *,
        timeout: float | None = None,
    ) -> BridgeResponse:
        """等待 response_{uuid}.json 到达或超时/取消.

        对应 F045 §2.1 协议流程步骤 3 + §2.3 不变量 3（超时保证）+ 不变量 8（逃生舱）。

        监听过程中同时检测：
        - response_{uuid}.json 到达 → 解析返回
        - cancel_{uuid}.json 到达 → 抛 TraeBridgeCancelledError
        - 超时 → 标记 request 为 timeout，抛 TraeBridgeTimeoutError

        路径选择（F045 §3.2 Phase 3 优化）：
        - 若 watcher 已启动 → 事件驱动（毫秒级响应）
        - 否则 → 轮询（默认 2s 间隔，可配置）

        Args:
            request_id: 请求 ID（write_request 返回值）
            timeout: 超时秒数（None 用请求文件中的 timeout_seconds）

        Returns:
            BridgeResponse 对象

        Raises:
            TraeBridgeTimeoutError: 超时未收到响应
            TraeBridgeCancelledError: operator 写入 cancel 文件
            TraeBridgeProtocolError: 响应文件格式非法
            TraeBridgeIOError: 文件读取失败
        """
        response_file = self._responses_dir / f"response_{request_id}.json"
        cancel_file = self._cancels_dir / f"cancel_{request_id}.json"

        # 解析超时：优先用传入参数，否则读 request 文件中的 timeout_seconds
        effective_timeout = timeout
        if effective_timeout is None:
            effective_timeout = self._read_request_timeout(request_id)
        effective_timeout = float(effective_timeout or self._config.default_timeout_seconds)

        # 路径选择：watcher 已启动 → 事件驱动；否则 → 轮询
        use_watcher = (
            self._watcher is not None
            and self._watcher.started
            and self._watcher.available
        )

        if use_watcher:
            kind, _file_path = await self._wait_with_watcher(
                request_id, effective_timeout
            )
        else:
            kind = await self._wait_with_polling(
                request_id, response_file, cancel_file, effective_timeout
            )

        # 处理取消
        if kind == "cancel":
            cancel_data = self._read_cancel_file(cancel_file, request_id)
            logger.warning(
                f"Bridge 请求被 operator 取消: {request_id}, "
                f"reason={cancel_data.reason}"
            )
            await self._update_request_status(
                request_id, BridgeRequestStatus.CANCELLED
            )
            if self._config.update_status_on_complete:
                await self._bump_status(cancelled_delta=1)
            raise TraeBridgeCancelledError(
                f"operator 取消请求: {cancel_data.reason or '无理由'}",
                request_id=request_id,
            )

        # kind == "response"：解析响应文件
        try:
            raw = await asyncio.to_thread(
                response_file.read_text, "utf-8"
            )
            data = json.loads(raw)
        except (OSError, json.JSONDecodeError) as e:
            raise TraeBridgeProtocolError(
                f"响应文件解析失败: {response_file}, {e}",
                request_id=request_id,
            ) from e

        # 校验 request_id 配对（不变量 2）
        if data.get("request_id") != request_id:
            raise TraeBridgeProtocolError(
                f"响应 request_id 不匹配: 期望 {request_id}, "
                f"实际 {data.get('request_id')}",
                request_id=request_id,
            )

        try:
            response = BridgeResponse(**data)
        except Exception as e:
            raise TraeBridgeProtocolError(
                f"响应数据校验失败: {e}",
                request_id=request_id,
            ) from e

        # 错误响应
        if response.status == BridgeResponseStatus.ERROR:
            logger.error(
                f"Bridge 响应错误: {request_id}, error={response.error}"
            )
            await self._archive_request_response(request_id)
            if self._config.update_status_on_complete:
                await self._bump_status(completed_delta=1)
            raise TraeBridgeProtocolError(
                f"LLM 调用错误: {response.error}",
                request_id=request_id,
            )

        # 正常完成
        logger.info(
            f"Bridge 响应已收到: {request_id} "
            f"(content_len={len(response.content)})"
        )
        await self._archive_request_response(request_id)
        if self._config.update_status_on_complete:
            await self._bump_status(completed_delta=1)
        return response

    async def _wait_with_watcher(
        self,
        request_id: str,
        effective_timeout: float,
    ) -> tuple[str, str]:
        """事件驱动等待：watcher 监听 response/cancel 文件创建.

        并行等待 response 和 cancel 两个事件，哪个先到就处理哪个。
        若都超时，标记 timeout 并抛 TraeBridgeTimeoutError。

        Returns:
            ("response" | "cancel", file_path)

        Raises:
            TraeBridgeTimeoutError: 超时
        """
        assert self._watcher is not None
        start = time.monotonic()

        response_task = asyncio.create_task(
            self._watcher.wait_for_response(
                request_id, timeout=effective_timeout
            )
        )
        cancel_task = asyncio.create_task(
            self._watcher.wait_for_cancel(
                request_id, timeout=effective_timeout
            )
        )

        try:
            done, pending = await asyncio.wait(
                {response_task, cancel_task},
                return_when=asyncio.FIRST_COMPLETED,
                timeout=effective_timeout,
            )

            # 取消未完成的任务，避免资源泄漏
            for t in pending:
                t.cancel()

            if not done:
                # 双方都超时
                await self._update_request_status(
                    request_id, BridgeRequestStatus.TIMEOUT
                )
                if self._config.update_status_on_complete:
                    await self._bump_status(timeout_delta=1)
                raise TraeBridgeTimeoutError(
                    f"Bridge 超时: request_id={request_id}, "
                    f"timeout={effective_timeout}s",
                    request_id=request_id,
                )

            winner = done.pop()
            elapsed = time.monotonic() - start

            if winner is response_task:
                file_path = winner.result()
                logger.debug(
                    f"watcher 命中 response: request_id={request_id}, "
                    f"elapsed={elapsed:.2f}s"
                )
                return ("response", file_path)
            else:
                file_path = winner.result()
                logger.debug(
                    f"watcher 命中 cancel: request_id={request_id}, "
                    f"elapsed={elapsed:.2f}s"
                )
                return ("cancel", file_path)

        except TimeoutError:
            await self._update_request_status(
                request_id, BridgeRequestStatus.TIMEOUT
            )
            if self._config.update_status_on_complete:
                await self._bump_status(timeout_delta=1)
            raise TraeBridgeTimeoutError(
                f"Bridge 超时: request_id={request_id}, "
                f"timeout={effective_timeout}s",
                request_id=request_id,
            ) from None

    async def _wait_with_polling(
        self,
        request_id: str,
        response_file: Path,
        cancel_file: Path,
        effective_timeout: float,
    ) -> str:
        """轮询等待：周期性检查 response/cancel 文件存在.

        Returns:
            "response" | "cancel"

        Raises:
            TraeBridgeTimeoutError: 超时
        """
        poll_interval = self._config.poll_interval_seconds
        start = time.monotonic()
        elapsed = 0.0
        last_log = 0.0

        while elapsed < effective_timeout:
            # 检测取消（不变量 8 逃生舱）
            if cancel_file.exists():
                return "cancel"

            # 检测响应
            if response_file.exists():
                return "response"

            # 等待下一轮
            await asyncio.sleep(poll_interval)
            elapsed = time.monotonic() - start

            # 每 30 秒打印一次等待日志
            if elapsed - last_log >= 30:
                logger.debug(
                    f"Bridge 等待响应: request_id={request_id}, "
                    f"elapsed={elapsed:.0f}s/{effective_timeout:.0f}s"
                )
                last_log = elapsed

        # 超时（不变量 3）
        await self._update_request_status(request_id, BridgeRequestStatus.TIMEOUT)
        if self._config.update_status_on_complete:
            await self._bump_status(timeout_delta=1)
        raise TraeBridgeTimeoutError(
            f"Bridge 超时: request_id={request_id}, timeout={effective_timeout}s",
            request_id=request_id,
        )

    async def poll_response_stream(
        self,
        request_id: str,
        *,
        timeout: float | None = None,
    ):
        """流式轮询响应（F045 §2.1 双向通信支持，预留）.

        当前实现：等完整响应后一次性 yield。
        Phase 3 将实现真正的增量轮询（检测 response 文件大小变化）。
        """
        # 当前阶段直接返回完整响应
        response = await self.poll_response(request_id, timeout=timeout)
        yield response

    # ── 解析响应 ────────────────────────────────────────────────────

    def parse_response(self, response: BridgeResponse) -> dict[str, Any]:
        """解析 BridgeResponse 为标准 LLM 返回格式.

        转换为与 flowforge.tools.llm_client.LLMClient.chat() 兼容的字典格式：
        {
            "content": str,
            "model": str,
            "usage": dict,
            "tool_calls": list,
            "provider": "trae",
        }
        """
        return {
            "content": response.content,
            "model": response.model,
            "usage": response.usage,
            "tool_calls": response.tool_calls or [],
            "provider": "trae",
            "request_id": response.request_id,
            "completed_at": response.completed_at.isoformat()
            if response.completed_at
            else "",
        }

    # ── 取消机制（不变量 8 逃生舱）──────────────────────────────────

    async def write_cancel(
        self,
        request_id: str,
        reason: str = "",
        cancelled_by: str = "operator",
    ) -> None:
        """写入 cancel_{uuid}.json 取消进行中的请求.

        对应 F045 §2.3 不变量 8：operator 可写入 cancel 文件取消任意请求。
        通常由 operator 在 Trae 内手动创建，本方法供程序化调用（如超时主动取消）。

        Args:
            request_id: 要取消的请求 ID
            reason: 取消原因
            cancelled_by: 取消者标识
        """
        cancel = BridgeCancel(
            request_id=request_id,
            reason=reason,
            cancelled_by=cancelled_by,
        )
        cancel_file = self._cancels_dir / f"cancel_{request_id}.json"
        try:
            await asyncio.to_thread(
                cancel_file.write_text,
                cancel.model_dump_json(indent=2),
                "utf-8",
            )
        except OSError as e:
            raise TraeBridgeIOError(
                f"写入取消文件失败: {cancel_file}, {e}",
                request_id=request_id,
            ) from e
        logger.info(f"Bridge 取消请求: {request_id}, reason={reason}")

    # ── 归档机制（不变量 4 不丢数据）────────────────────────────────

    async def _archive_request_response(self, request_id: str) -> None:
        """归档完成的 request/response 文件到 archive/.

        对应 F045 §2.3 不变量 4：completed request/response 归档，保留最近 N 条。
        """
        if not self._config.archive_completed:
            return

        request_file = self._requests_dir / f"request_{request_id}.json"
        response_file = self._responses_dir / f"response_{request_id}.json"
        cancel_file = self._cancels_dir / f"cancel_{request_id}.json"
        ack_file = self._acks_dir / f"ack_{request_id}.json"

        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        archive_prefix = f"{timestamp}_{request_id[:8]}"

        for src in (request_file, response_file, cancel_file, ack_file):
            if src.exists():
                dst = self._archive_dir / f"{archive_prefix}_{src.name}"
                try:
                    await asyncio.to_thread(shutil.move, str(src), str(dst))
                except OSError as e:
                    logger.warning(f"归档文件失败: {src} → {dst}, {e}")

        # 清理归档目录超限文件
        await self._enforce_archive_limit()

    async def _enforce_archive_limit(self) -> None:
        """清理归档目录，保留最近 max_archive_files 个文件."""
        try:
            files = sorted(
                self._archive_dir.glob("*"),
                key=lambda f: f.stat().st_mtime,
                reverse=True,
            )
            if len(files) <= self._config.max_archive_files:
                return
            excess = files[self._config.max_archive_files :]
            for f in excess:
                try:
                    await asyncio.to_thread(f.unlink)
                except OSError as e:
                    logger.warning(f"清理归档文件失败: {f}, {e}")
            logger.info(f"清理归档目录：删除 {len(excess)} 个旧文件")
        except Exception as e:
            logger.warning(f"enforce_archive_limit 异常: {e}")

    # ── 状态总览（不变量 7 operator 可见性）────────────────────────

    async def _bump_status(
        self,
        *,
        pending_delta: int = 0,
        processing_delta: int = 0,
        completed_delta: int = 0,
        timeout_delta: int = 0,
        cancelled_delta: int = 0,
    ) -> None:
        """更新 status.json 计数器.

        对应 F045 §2.1 共享目录中的 status.json。
        operator 在 Trae 内可一眼看到当前桥接状态。
        """
        try:
            status = self._read_status()
            status.pending_count = max(0, status.pending_count + pending_delta)
            status.processing_count = max(
                0, status.processing_count + processing_delta
            )
            status.completed_total = max(
                0, status.completed_total + completed_delta
            )
            status.timeout_total = max(0, status.timeout_total + timeout_delta)
            status.cancelled_total = max(
                0, status.cancelled_total + cancelled_delta
            )
            status.last_activity_at = datetime.now(UTC)
            await asyncio.to_thread(
                self._status_file.write_text,
                status.model_dump_json(indent=2),
                "utf-8",
            )
        except Exception as e:
            logger.warning(f"更新 status.json 失败: {e}")

    def _read_status(self) -> BridgeStatus:
        """读取 status.json，不存在则返回空状态."""
        try:
            if self._status_file.exists():
                data = json.loads(self._status_file.read_text(encoding="utf-8"))
                return BridgeStatus(**data)
        except Exception as e:
            logger.warning(f"读取 status.json 失败: {e}")
        return BridgeStatus()

    # ── 辅助方法 ────────────────────────────────────────────────────

    def _read_request_timeout(self, request_id: str) -> float | None:
        """从 request 文件读取 timeout_seconds."""
        request_file = self._requests_dir / f"request_{request_id}.json"
        try:
            if request_file.exists():
                data = json.loads(request_file.read_text(encoding="utf-8"))
                return float(data.get("timeout_seconds", 0)) or None
        except Exception as e:
            logger.warning(f"读取请求超时失败: {request_file}, {e}")
        return None

    async def _update_request_status(
        self,
        request_id: str,
        status: BridgeRequestStatus,
    ) -> None:
        """更新 request 文件的 status 字段（不变量 3 超时可见）."""
        request_file = self._requests_dir / f"request_{request_id}.json"
        try:
            if not request_file.exists():
                return
            data = json.loads(request_file.read_text(encoding="utf-8"))
            data["status"] = status.value
            if status == BridgeRequestStatus.TIMEOUT:
                data["timeout_at"] = datetime.now(UTC).isoformat()
            elif status == BridgeRequestStatus.CANCELLED:
                data["cancelled_at"] = datetime.now(UTC).isoformat()
            await asyncio.to_thread(
                request_file.write_text,
                json.dumps(data, ensure_ascii=False, indent=2),
                "utf-8",
            )
        except Exception as e:
            logger.warning(f"更新请求状态失败: {request_file}, {e}")

    def _read_cancel_file(
        self,
        cancel_file: Path,
        request_id: str,
    ) -> BridgeCancel:
        """读取 cancel 文件."""
        try:
            data = json.loads(cancel_file.read_text(encoding="utf-8"))
            return BridgeCancel(**data)
        except Exception as e:
            logger.warning(f"解析 cancel 文件失败: {cancel_file}, {e}")
            return BridgeCancel(
                request_id=request_id,
                reason=f"解析失败: {e}",
                cancelled_by="operator",
            )

    # ── 健康检查 ────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """检查桥接目录是否可读写."""
        try:
            test_file = self._requests_dir / ".health_check"
            await asyncio.to_thread(test_file.write_text, "ok", "utf-8")
            content = await asyncio.to_thread(test_file.read_text, "utf-8")
            await asyncio.to_thread(test_file.unlink)
            return content == "ok"
        except Exception as e:
            logger.warning(f"桥接健康检查失败: {e}")
            return False

    # ── 查询方法（供 operator/调试用）──────────────────────────────

    def list_pending_requests(self) -> list[dict[str, Any]]:
        """列出所有 pending 状态的请求（供 operator 查看）."""
        result = []
        try:
            for req_file in self._requests_dir.glob("request_*.json"):
                try:
                    data = json.loads(req_file.read_text(encoding="utf-8"))
                    if data.get("status") == BridgeRequestStatus.PENDING.value:
                        result.append(
                            {
                                "request_id": data.get("request_id", ""),
                                "forgekin_id": data.get("context", {}).get(
                                    "forgekin_id", ""
                                ),
                                "task_type": data.get("context", {}).get(
                                    "task_type", ""
                                ),
                                "task_summary": data.get("context", {}).get(
                                    "task_summary", ""
                                ),
                                "created_at": data.get("created_at", ""),
                                "timeout_seconds": data.get("timeout_seconds", 0),
                                "file": req_file.name,
                            }
                        )
                except (json.JSONDecodeError, OSError) as e:
                    logger.warning(f"读取请求文件失败: {req_file}, {e}")
        except Exception as e:
            logger.warning(f"list_pending_requests 异常: {e}")
        # 按创建时间排序（最早的在前，最该处理的优先）
        result.sort(key=lambda x: x.get("created_at", ""))
        return result

    def get_status(self) -> BridgeStatus:
        """获取当前桥接状态总览."""
        return self._read_status()

    # ── Watcher 生命周期管理（F045 §3.2 Phase 3）──────────────────

    @property
    def watcher(self) -> TraeBridgeWatcher | None:
        """获取关联的 watcher 实例（可能为 None 或未启动）."""
        return self._watcher

    @property
    def watcher_enabled(self) -> bool:
        """watcher 是否已启用（已启动且可用）."""
        return (
            self._watcher is not None
            and self._watcher.started
            and self._watcher.available
        )

    async def start_watcher(self) -> bool:
        """启动文件监听器（事件驱动模式）.

        启动成功后，poll_response 将使用 watchdog 事件驱动而非轮询。
        启动失败时返回 False，调用方应继续使用轮询模式（自动降级）。

        Returns:
            True 表示启动成功，False 表示启动失败或 watcher 不可用
        """
        if self._watcher is None:
            logger.info("watcher 未配置，跳过启动（使用轮询模式）")
            return False

        if self._watcher.started:
            return True

        if not self._watcher.available:
            logger.warning("watchdog 未安装，无法启动 watcher（使用轮询模式）")
            return False

        try:
            await self._watcher.start()
            logger.info("TraeBridgeWatcher 已启动，poll_response 切换到事件驱动模式")
            return True
        except Exception as e:
            logger.warning(
                f"启动 TraeBridgeWatcher 失败，回退到轮询模式: {e}"
            )
            self._watcher = None
            return False

    async def stop_watcher(self) -> None:
        """停止文件监听器.

        仅当 watcher 由本 protocol 实例创建时才停止（外部注入的不归本实例管理）。
        """
        if self._watcher is None or not self._watcher.started:
            return

        if not self._watcher_owned:
            # 外部注入的 watcher，由外部负责生命周期
            return

        try:
            await self._watcher.stop()
            logger.info("TraeBridgeWatcher 已停止")
        except Exception as e:
            logger.warning(f"停止 TraeBridgeWatcher 异常: {e}")


__all__ = ["TraeBridgeProtocol"]

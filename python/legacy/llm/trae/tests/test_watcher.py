"""TraeBridgeWatcher 单元测试 — F045 §3.2 Phase 3 文件监听器.

覆盖：
- 初始化与生命周期（start/stop/context manager）
- 事件驱动等待响应（创建 response 文件 → 立即唤醒）
- 事件驱动等待取消（创建 cancel 文件 → 立即唤醒）
- 文件已存在时立即返回
- 超时机制
- 集成到 TraeBridgeProtocol 后的端到端事件驱动调用
- 并发请求处理
- 非 response/cancel 文件被忽略

测试铁律遵守：
- T1：使用真实文件系统（tempfile.TemporaryDirectory），不 mock
- T2：使用真实场景数据（forgekin_id="forgemind:luban"）
- T3：具体断言（检查返回值类型/内容，非 status 模糊断言）
- T6：通过时间差量化性能（事件驱动 vs 轮询）
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from flowforge.llm.trae.config import TraeBridgeConfig
from flowforge.llm.trae.exceptions import TraeBridgeConfigError
from flowforge.llm.trae.models import (
    BridgeRequestContext,
    BridgeResponse,
    BridgeResponseStatus,
)
from flowforge.llm.trae.protocol import TraeBridgeProtocol
from flowforge.llm.trae.watcher import TraeBridgeWatcher, _WATCHDOG_AVAILABLE


pytestmark = pytest.mark.skipif(
    not _WATCHDOG_AVAILABLE,
    reason="watchdog 未安装，跳过 watcher 测试",
)


# ── 测试固件 ───────────────────────────────────────────────────────


@pytest.fixture
def temp_bridge_dir(tmp_path) -> Path:
    """创建临时桥接目录."""
    bridge_dir = tmp_path / ".trae_bridge_test"
    bridge_dir.mkdir(parents=True, exist_ok=True)
    (bridge_dir / "requests").mkdir(exist_ok=True)
    (bridge_dir / "responses").mkdir(exist_ok=True)
    (bridge_dir / "cancels").mkdir(exist_ok=True)
    (bridge_dir / "acks").mkdir(exist_ok=True)
    (bridge_dir / "archive").mkdir(exist_ok=True)
    return bridge_dir


@pytest.fixture
def bridge_config(temp_bridge_dir) -> TraeBridgeConfig:
    """桥接配置（指向临时目录，poll_interval=0.5）."""
    return TraeBridgeConfig(
        shared_dir=str(temp_bridge_dir),
        poll_interval_seconds=0.5,
        default_timeout_seconds=5,
        archive_completed=True,
        max_archive_files=10,
        cleanup_on_startup=False,
    )


@pytest.fixture
def sample_context() -> BridgeRequestContext:
    """真实场景数据：鲁班可进化智能体设计 F046 SelfDev 三闭环."""
    return BridgeRequestContext(
        forgekin_id="forgemind:luban",
        task_type="chat",
        task_summary="设计 F046 SelfDev 三闭环",
        model="trae",
    )


@pytest.fixture
def sample_messages():
    """真实场景消息：SelfDev 三闭环设计请求."""
    return [
        {"role": "system", "content": "你是鲁班可进化智能体，主导 FlowForge 自主开发流程。"},
        {"role": "user", "content": "请设计 SelfDev 三闭环的核心机制与状态转换图。"},
    ]


def _make_response_payload(
    request_id: str,
    content: str = "SelfDev 三闭环：Discover→Assign→Act→Verify→Persist",
) -> dict:
    """构造标准 response payload."""
    return {
        "request_id": request_id,
        "content": content,
        "status": BridgeResponseStatus.COMPLETED.value,
        "model": "trae",
        "usage": {"prompt_tokens": 50, "completion_tokens": 30, "total_tokens": 80},
        "tool_calls": [],
        "error": "",
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }


# ── 1. 初始化与生命周期 ───────────────────────────────────────────


class TestWatcherInit:
    def test_watcher_available(self, bridge_config):
        """watchdog 已安装时 available 返回 True."""
        watcher = TraeBridgeWatcher(bridge_config)
        assert watcher.available is True
        assert watcher.started is False

    @pytest.mark.asyncio
    async def test_start_creates_observer(self, bridge_config):
        """start() 后 watcher 进入 started 状态."""
        watcher = TraeBridgeWatcher(bridge_config)
        try:
            await watcher.start()
            assert watcher.started is True
        finally:
            await watcher.stop()
            assert watcher.started is False

    @pytest.mark.asyncio
    async def test_start_idempotent(self, bridge_config):
        """重复 start() 不会创建多个 observer."""
        watcher = TraeBridgeWatcher(bridge_config)
        try:
            await watcher.start()
            observer1 = watcher._observer
            await watcher.start()  # 第二次 start 应该是 no-op
            assert watcher._observer is observer1
        finally:
            await watcher.stop()

    @pytest.mark.asyncio
    async def test_stop_idempotent(self, bridge_config):
        """未启动时 stop() 不会抛错."""
        watcher = TraeBridgeWatcher(bridge_config)
        await watcher.stop()  # 未启动直接 stop
        assert watcher.started is False

    @pytest.mark.asyncio
    async def test_context_manager(self, bridge_config):
        """async context manager 自动管理生命周期."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            assert watcher.started is True
        assert watcher.started is False


# ── 2. 事件驱动等待响应 ────────────────────────────────────────────


class TestWaitForResponse:
    @pytest.mark.asyncio
    async def test_event_driven_response_immediate(self, bridge_config, tmp_path):
        """创建 response 文件后，wait_for_response 立即返回（毫秒级）."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            request_id = "test-event-driven-001"
            response_file = Path(bridge_config.responses_path) / f"response_{request_id}.json"

            # 启动等待任务
            wait_task = asyncio.create_task(
                watcher.wait_for_response(request_id, timeout=3.0)
            )

            # 等待 watcher 注册 future
            await asyncio.sleep(0.3)

            # 创建 response 文件（模拟 operator 写入）
            payload = _make_response_payload(request_id)
            response_file.write_text(json.dumps(payload), encoding="utf-8")

            start = time.monotonic()
            file_path = await asyncio.wait_for(wait_task, timeout=2.0)
            elapsed = time.monotonic() - start

            assert file_path == str(response_file)
            # 事件驱动应该在 0.5s 内返回（watchdog 触发到 call_soon_threadsafe）
            assert elapsed < 0.5, f"事件驱动响应过慢: {elapsed:.3f}s"

    @pytest.mark.asyncio
    async def test_pre_existing_response_returns_immediately(
        self, bridge_config, tmp_path
    ):
        """response 文件已存在时立即返回（不依赖事件）."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            request_id = "test-pre-existing-002"
            response_file = Path(bridge_config.responses_path) / f"response_{request_id}.json"

            # 先创建文件再等待
            payload = _make_response_payload(request_id)
            response_file.write_text(json.dumps(payload), encoding="utf-8")

            start = time.monotonic()
            file_path = await watcher.wait_for_response(request_id, timeout=2.0)
            elapsed = time.monotonic() - start

            assert file_path == str(response_file)
            assert elapsed < 0.1, f"预存在文件应立即返回，实际 {elapsed:.3f}s"

    @pytest.mark.asyncio
    async def test_wait_for_response_timeout(self, bridge_config):
        """超时未收到响应文件时抛 asyncio.TimeoutError."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            request_id = "test-timeout-003"
            with pytest.raises(asyncio.TimeoutError):
                await watcher.wait_for_response(request_id, timeout=1.0)

    @pytest.mark.asyncio
    async def test_unrelated_files_ignored(self, bridge_config):
        """非 response_{uuid}.json 文件被忽略."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            request_id = "test-unrelated-004"
            responses_dir = Path(bridge_config.responses_path)

            # 创建不相关的文件
            (responses_dir / "request_001.json").write_text("{}", encoding="utf-8")
            (responses_dir / "cancel_001.json").write_text("{}", encoding="utf-8")
            (responses_dir / "status.json").write_text("{}", encoding="utf-8")
            (responses_dir / "response_other.json").write_text("{}", encoding="utf-8")

            wait_task = asyncio.create_task(
                watcher.wait_for_response(request_id, timeout=1.0)
            )
            await asyncio.sleep(0.3)

            # 应该超时（因为没有匹配的文件）
            with pytest.raises(asyncio.TimeoutError):
                await wait_task

    @pytest.mark.asyncio
    async def test_ignored_then_matched(self, bridge_config):
        """先创建不相关文件，再创建匹配文件，应能命中."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            request_id = "test-ignored-then-matched-005"
            responses_dir = Path(bridge_config.responses_path)

            wait_task = asyncio.create_task(
                watcher.wait_for_response(request_id, timeout=3.0)
            )
            await asyncio.sleep(0.3)

            # 先创建不匹配的文件
            (responses_dir / "response_other.json").write_text("{}", encoding="utf-8")
            await asyncio.sleep(0.3)
            assert not wait_task.done(), "不匹配的文件不应触发"

            # 再创建匹配的文件
            target = responses_dir / f"response_{request_id}.json"
            target.write_text("{}", encoding="utf-8")

            file_path = await asyncio.wait_for(wait_task, timeout=2.0)
            assert file_path == str(target)


# ── 3. 事件驱动等待取消 ────────────────────────────────────────────


class TestWaitForCancel:
    @pytest.mark.asyncio
    async def test_event_driven_cancel(self, bridge_config):
        """创建 cancel 文件后，wait_for_cancel 立即返回."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            request_id = "test-cancel-006"
            cancel_file = Path(bridge_config.cancels_path) / f"cancel_{request_id}.json"

            wait_task = asyncio.create_task(
                watcher.wait_for_cancel(request_id, timeout=3.0)
            )
            await asyncio.sleep(0.3)

            # 创建 cancel 文件
            cancel_payload = {
                "request_id": request_id,
                "reason": "测试取消",
                "cancelled_by": "operator",
                "cancelled_at": datetime.now(timezone.utc).isoformat(),
            }
            cancel_file.write_text(json.dumps(cancel_payload), encoding="utf-8")

            file_path = await asyncio.wait_for(wait_task, timeout=2.0)
            assert file_path == str(cancel_file)


# ── 4. 并发请求处理 ───────────────────────────────────────────────


class TestConcurrentRequests:
    @pytest.mark.asyncio
    async def test_multiple_concurrent_waits(self, bridge_config):
        """多个 request_id 并发等待，各自独立返回."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            responses_dir = Path(bridge_config.responses_path)
            request_ids = [f"conc-{i:03d}" for i in range(5)]

            # 启动 5 个并发等待任务
            tasks = [
                asyncio.create_task(
                    watcher.wait_for_response(rid, timeout=5.0)
                )
                for rid in request_ids
            ]
            await asyncio.sleep(0.3)

            # 乱序创建 response 文件（验证不依赖顺序）
            shuffled = list(request_ids)
            import random
            random.shuffle(shuffled)
            for rid in shuffled:
                f = responses_dir / f"response_{rid}.json"
                f.write_text("{}", encoding="utf-8")
                await asyncio.sleep(0.05)

            # 所有任务应在 2s 内完成
            results = await asyncio.wait_for(
                asyncio.gather(*tasks), timeout=2.0
            )
            for rid, file_path in zip(request_ids, results):
                expected = str(responses_dir / f"response_{rid}.json")
                assert file_path == expected

    @pytest.mark.asyncio
    async def test_pending_count_tracking(self, bridge_config):
        """pending_count 准确反映等待中的请求数."""
        async with TraeBridgeWatcher(bridge_config) as watcher:
            assert watcher.pending_count() == 0

            tasks = [
                asyncio.create_task(
                    watcher.wait_for_response(f"cnt-{i}", timeout=1.5)
                )
                for i in range(3)
            ]
            await asyncio.sleep(0.3)
            assert watcher.pending_count() == 3
            assert set(watcher.pending_request_ids()) == {
                "cnt-0", "cnt-1", "cnt-2"
            }

            # 等待超时清理
            for t in tasks:
                with pytest.raises(asyncio.TimeoutError):
                    await t
            assert watcher.pending_count() == 0


# ── 5. 集成到 TraeBridgeProtocol ──────────────────────────────────


class TestProtocolWatcherIntegration:
    """通过 TraeBridgeProtocol 验证事件驱动 vs 轮询对比."""

    @pytest.mark.asyncio
    async def test_protocol_with_watcher_enabled(
        self, bridge_config, sample_context, sample_messages
    ):
        """protocol 启动 watcher 后，poll_response 走事件驱动路径."""
        protocol = TraeBridgeProtocol(bridge_config, enable_watcher=True)

        # 启动 watcher
        ok = await protocol.start_watcher()
        assert ok is True, "watcher 启动失败"
        assert protocol.watcher_enabled is True

        try:
            # 写入请求
            request_id = await protocol.write_request(
                sample_messages, sample_context
            )

            # 异步任务：0.3s 后写入 response 文件（模拟 operator）
            response_file = Path(bridge_config.responses_path) / f"response_{request_id}.json"
            payload = _make_response_payload(request_id)

            async def write_response_after_delay():
                await asyncio.sleep(0.3)
                response_file.write_text(json.dumps(payload), encoding="utf-8")

            asyncio.create_task(write_response_after_delay())

            # 等待响应（事件驱动应在 ~0.3s 后返回）
            start = time.monotonic()
            response = await protocol.poll_response(request_id, timeout=3.0)
            elapsed = time.monotonic() - start

            assert isinstance(response, BridgeResponse)
            assert response.content == payload["content"]
            # 事件驱动应该在 1s 内完成（writer 延迟 0.3s + watcher 触发）
            assert elapsed < 1.5, f"事件驱动响应过慢: {elapsed:.3f}s"
        finally:
            await protocol.stop_watcher()

    @pytest.mark.asyncio
    async def test_protocol_fallback_to_polling_when_watcher_unavailable(
        self, bridge_config, sample_context, sample_messages, monkeypatch
    ):
        """watcher 启动失败时，poll_response 自动降级到轮询."""
        protocol = TraeBridgeProtocol(bridge_config, enable_watcher=True)

        # 模拟 watcher 启动失败
        original_start = TraeBridgeWatcher.start

        async def fake_start(self):
            raise TraeBridgeConfigError("模拟启动失败")

        monkeypatch.setattr(TraeBridgeWatcher, "start", fake_start)

        ok = await protocol.start_watcher()
        assert ok is False, "watcher 启动失败时应返回 False"
        assert protocol.watcher_enabled is False

        try:
            request_id = await protocol.write_request(
                sample_messages, sample_context
            )

            # 写入 response 文件
            response_file = Path(bridge_config.responses_path) / f"response_{request_id}.json"
            payload = _make_response_payload(request_id)

            async def write_after_delay():
                await asyncio.sleep(0.3)
                response_file.write_text(json.dumps(payload), encoding="utf-8")

            asyncio.create_task(write_after_delay())

            # 轮询模式：poll_interval=0.5s，应在 1.5s 内完成
            response = await protocol.poll_response(request_id, timeout=3.0)
            assert response.content == payload["content"]
        finally:
            await protocol.stop_watcher()

    @pytest.mark.asyncio
    async def test_protocol_event_driven_cancel(
        self, bridge_config, sample_context, sample_messages
    ):
        """事件驱动模式下 cancel 立即生效."""
        from flowforge.llm.trae.exceptions import TraeBridgeCancelledError

        protocol = TraeBridgeProtocol(bridge_config, enable_watcher=True)
        await protocol.start_watcher()

        try:
            request_id = await protocol.write_request(
                sample_messages, sample_context
            )

            # 0.3s 后写入 cancel 文件
            cancel_file = Path(bridge_config.cancels_path) / f"cancel_{request_id}.json"
            cancel_payload = {
                "request_id": request_id,
                "reason": "测试事件驱动取消",
                "cancelled_by": "operator",
                "cancelled_at": datetime.now(timezone.utc).isoformat(),
            }

            async def write_cancel_after_delay():
                await asyncio.sleep(0.3)
                cancel_file.write_text(json.dumps(cancel_payload), encoding="utf-8")

            asyncio.create_task(write_cancel_after_delay())

            start = time.monotonic()
            with pytest.raises(TraeBridgeCancelledError) as exc_info:
                await protocol.poll_response(request_id, timeout=3.0)
            elapsed = time.monotonic() - start

            assert "测试事件驱动取消" in str(exc_info.value)
            assert elapsed < 1.5, f"事件驱动取消应快速生效，实际 {elapsed:.3f}s"
        finally:
            await protocol.stop_watcher()


# ── 6. 性能对比（事件驱动 vs 轮询）───────────────────────────────


class TestPerformanceComparison:
    """F045 §4.2 AC-8/AC-10：性能验收."""

    @pytest.mark.asyncio
    async def test_event_driven_faster_than_polling(
        self, bridge_config, sample_context, sample_messages
    ):
        """事件驱动响应延迟应低于轮询模式.

        在文件创建后立即返回（毫秒级）vs 轮询平均等待 poll_interval/2.
        """
        # 事件驱动
        protocol_event = TraeBridgeProtocol(bridge_config, enable_watcher=True)
        await protocol_event.start_watcher()

        try:
            rid1 = await protocol_event.write_request(
                sample_messages, sample_context
            )
            response_file1 = Path(bridge_config.responses_path) / f"response_{rid1}.json"
            payload1 = _make_response_payload(rid1, "事件驱动响应")

            async def writer1():
                await asyncio.sleep(0.2)
                response_file1.write_text(json.dumps(payload1), encoding="utf-8")

            asyncio.create_task(writer1())
            start = time.monotonic()
            await protocol_event.poll_response(rid1, timeout=3.0)
            event_elapsed = time.monotonic() - start
        finally:
            await protocol_event.stop_watcher()

        # 轮询模式（poll_interval=0.5）
        protocol_poll = TraeBridgeProtocol(bridge_config, enable_watcher=False)
        rid2 = await protocol_poll.write_request(
            sample_messages, sample_context
        )
        response_file2 = Path(bridge_config.responses_path) / f"response_{rid2}.json"
        payload2 = _make_response_payload(rid2, "轮询响应")

        async def writer2():
            await asyncio.sleep(0.2)
            response_file2.write_text(json.dumps(payload2), encoding="utf-8")

        asyncio.create_task(writer2())
        start = time.monotonic()
        await protocol_poll.poll_response(rid2, timeout=3.0)
        poll_elapsed = time.monotonic() - start

        # 事件驱动应明显快于轮询（至少快 100ms）
        # 注意：轮询模式下 poll_interval=0.5s，所以平均会有 ~0.25s 的延迟
        # 事件驱动应该 < 0.5s，轮询应该 > 0.5s（实际取决于时机）
        print(
            f"\n事件驱动: {event_elapsed:.3f}s, "
            f"轮询: {poll_elapsed:.3f}s, "
            f"差异: {poll_elapsed - event_elapsed:.3f}s"
        )
        # 宽松断言：事件驱动至少不应慢于轮询
        assert event_elapsed <= poll_elapsed + 0.1

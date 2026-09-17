"""Trae 桥接协议单元测试 — F045 §3.2 Phase 1.

覆盖 TraeBridgeProtocol 所有关键功能：
- write_request: 写入 request_{uuid}.json（不变量 1 唯一性 + 7 可见性）
- poll_response: 轮询 response_{uuid}.json（不变量 3 超时 + 8 取消）
- parse_response: 解析响应为标准格式
- 取消机制（不变量 8 逃生舱）
- 归档机制（不变量 4 不丢数据）
- 健康检查

测试策略：
- 不 Mock LLM（T1 铁律）— 测试协议层，不涉及 LLM 调用
- 用真实场景 prompt（T2 铁律）— 使用 FlowForge 可进化智能体真实任务
- 具体断言（T3 铁律）— 验证文件内容、状态、异常类型
- 模拟 operator 行为：测试代码主动写入 response 文件
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

# 确保能导入 flowforge
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent))

from flowforge.llm.trae.config import TraeBridgeConfig
from flowforge.llm.trae.exceptions import (
    TraeBridgeCancelledError,
    TraeBridgeProtocolError,
    TraeBridgeTimeoutError,
)
from flowforge.llm.trae.models import (
    BridgeRequestContext,
    BridgeRequestStatus,
    BridgeResponse,
    BridgeResponseStatus,
)
from flowforge.llm.trae.protocol import TraeBridgeProtocol


# ── 测试固件 ────────────────────────────────────────────────────────


@pytest.fixture
def temp_bridge_dir():
    """临时桥接目录（测试隔离）."""
    tmp = Path(tempfile.mkdtemp(prefix="trae_bridge_test_"))
    yield tmp
    # 清理
    try:
        shutil.rmtree(tmp, ignore_errors=True)
    except Exception:
        pass


@pytest.fixture
def bridge_config(temp_bridge_dir):
    """测试用 TraeBridgeConfig（指向临时目录）."""
    return TraeBridgeConfig(
        enabled=True,
        shared_dir=str(temp_bridge_dir),
        poll_interval_seconds=0.5,  # 测试用快速轮询（最小值 0.5）
        default_timeout_seconds=2,   # 测试用短超时
        long_task_timeout_seconds=5,
        archive_completed=True,
        max_archive_files=10,
        cleanup_on_startup=False,
        update_status_on_write=True,
        update_status_on_complete=True,
    )


@pytest.fixture
def protocol(bridge_config):
    """测试用 TraeBridgeProtocol."""
    return TraeBridgeProtocol(bridge_config)


@pytest.fixture
def sample_context():
    """真实场景的请求上下文（T2 铁律：不用假数据）."""
    return BridgeRequestContext(
        forgekin_id="forgemind:luban",
        task_type="chat",
        task_summary="设计 F046 SelfDev 三闭环实现方案",
        model="trae",
        temperature=0.7,
        max_tokens=4096,
    )


@pytest.fixture
def sample_messages():
    """真实场景的消息列表（T2 铁律：不用假数据）."""
    return [
        {"role": "system", "content": "你是 FlowForge 架构师可进化智能体（猫头鹰·鲁班）。"},
        {
            "role": "user",
            "content": "请设计 F046 SelfDev 三闭环（Doc/Code/Framework）的实现方案，"
            "包含数据模型、接口、状态机、关键不变量。",
        },
    ]


# ── 协议层目录初始化测试 ───────────────────────────────────────────


class TestProtocolInit:
    """测试协议层初始化."""

    def test_init_creates_all_dirs(self, temp_bridge_dir):
        """初始化时创建所有桥接子目录."""
        config = TraeBridgeConfig(shared_dir=str(temp_bridge_dir))
        TraeBridgeProtocol(config)

        assert (temp_bridge_dir / "requests").exists()
        assert (temp_bridge_dir / "responses").exists()
        assert (temp_bridge_dir / "cancels").exists()
        assert (temp_bridge_dir / "acks").exists()
        assert (temp_bridge_dir / "archive").exists()

    def test_init_with_cleanup_on_startup(self, temp_bridge_dir):
        """cleanup_on_startup=True 时清理遗留 pending 请求."""
        # 先创建一个 pending 请求
        requests_dir = temp_bridge_dir / "requests"
        requests_dir.mkdir(parents=True, exist_ok=True)
        pending_request = {
            "request_id": str(uuid.uuid4()),
            "status": BridgeRequestStatus.PENDING.value,
            "messages": [{"role": "user", "content": "遗留请求"}],
            "context": {"forgekin_id": "forgemind:luban"},
            "timeout_seconds": 300,
            "created_at": "2026-07-20T10:00:00+00:00",
        }
        req_file = requests_dir / "request_legacy.json"
        req_file.write_text(
            json.dumps(pending_request, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 启用 cleanup_on_startup
        config = TraeBridgeConfig(
            shared_dir=str(temp_bridge_dir),
            cleanup_on_startup=True,
        )
        TraeBridgeProtocol(config)

        # 验证遗留请求被标记为 timeout
        data = json.loads(req_file.read_text(encoding="utf-8"))
        assert data["status"] == BridgeRequestStatus.TIMEOUT.value
        assert "timeout_at" in data


# ── write_request 测试 ─────────────────────────────────────────────


class TestWriteRequest:
    """测试 write_request — F045 §2.3 不变量 1（唯一性）+ 7（可见性）."""

    @pytest.mark.asyncio
    async def test_write_request_creates_file(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """写入 request 文件并验证内容."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
            session_id="forgemind:luban:task123",
        )

        # 验证 request_id 是 UUID4 格式（不变量 1）
        assert len(request_id) == 36
        uuid.UUID(request_id)  # 不抛异常即为合法 UUID

        # 验证文件存在
        req_file = temp_bridge_dir / "requests" / f"request_{request_id}.json"
        assert req_file.exists()

        # 验证文件内容（不变量 7 operator 可见性）
        data = json.loads(req_file.read_text(encoding="utf-8"))
        assert data["request_id"] == request_id
        assert data["session_id"] == "forgemind:luban:task123"
        assert data["status"] == BridgeRequestStatus.PENDING.value
        assert len(data["messages"]) == 2
        assert data["context"]["forgekin_id"] == "forgemind:luban"
        assert data["context"]["task_type"] == "chat"
        assert data["context"]["task_summary"] == "设计 F046 SelfDev 三闭环实现方案"
        assert data["timeout_seconds"] > 0
        assert "created_at" in data

    @pytest.mark.asyncio
    async def test_write_request_unique_ids(
        self, protocol, sample_messages, sample_context
    ):
        """多次调用生成唯一 request_id（不变量 1 唯一性）."""
        ids = set()
        for _ in range(10):
            rid = await protocol.write_request(
                messages=sample_messages,
                context=sample_context,
            )
            ids.add(rid)
        assert len(ids) == 10, "request_id 必须全局唯一"

    @pytest.mark.asyncio
    async def test_write_request_empty_messages_raises(
        self, protocol, sample_context
    ):
        """空消息列表应抛 TraeBridgeProtocolError."""
        with pytest.raises(TraeBridgeProtocolError):
            await protocol.write_request(messages=[], context=sample_context)

    @pytest.mark.asyncio
    async def test_write_request_invalid_role_raises(
        self, protocol, sample_context
    ):
        """非法 role 应抛 TraeBridgeProtocolError."""
        with pytest.raises(TraeBridgeProtocolError):
            await protocol.write_request(
                messages=[{"role": "invalid", "content": "test"}],
                context=sample_context,
            )

    @pytest.mark.asyncio
    async def test_write_request_updates_status(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """写入 request 时更新 status.json（不变量 7 operator 可见性）."""
        await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        status_file = temp_bridge_dir / "status.json"
        assert status_file.exists()
        status = json.loads(status_file.read_text(encoding="utf-8"))
        assert status["pending_count"] >= 1


# ── poll_response 测试 ─────────────────────────────────────────────


class TestPollResponse:
    """测试 poll_response — F045 §2.3 不变量 3（超时）+ 8（取消）."""

    @pytest.mark.asyncio
    async def test_poll_response_receives_completed(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """正常完成：模拟 operator 写入 response 文件."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        # 模拟 operator 在 Trae 内调用 LLM 后回写 response
        async def _simulate_operator():
            await asyncio.sleep(0.3)  # 模拟 LLM 调用延迟
            response = BridgeResponse(
                request_id=request_id,
                content="# F046 SelfDev 三闭环设计\n\n## 1. 数据模型\n...",
                status=BridgeResponseStatus.COMPLETED,
                model="trae",
                usage={"input_tokens": 100, "output_tokens": 200},
            )
            response_file = temp_bridge_dir / "responses" / f"response_{request_id}.json"
            response_file.write_text(
                response.model_dump_json(indent=2),
                encoding="utf-8",
            )

        # 并发执行：protocol 轮询 + 模拟 operator 写入
        await asyncio.gather(
            _simulate_operator(),
            protocol.poll_response(request_id, timeout=5),
        )

        # 验证：再调用一次 poll_response 应能立即返回（响应已存在）
        # 但实际已被归档，所以这里只验证归档
        archive_dir = temp_bridge_dir / "archive"
        archived_files = list(archive_dir.glob("*"))
        assert any(request_id[:8] in f.name for f in archived_files), \
            "完成的请求应归档到 archive/"

    @pytest.mark.asyncio
    async def test_poll_response_timeout(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """超时机制：operator 不回写 response 时抛 TraeBridgeTimeoutError（不变量 3）."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
            timeout_seconds=1,  # 1 秒超时
        )

        with pytest.raises(TraeBridgeTimeoutError) as exc_info:
            await protocol.poll_response(request_id, timeout=1.5)

        assert request_id in str(exc_info.value)

        # 验证 request 文件被标记为 timeout
        req_file = temp_bridge_dir / "requests" / f"request_{request_id}.json"
        data = json.loads(req_file.read_text(encoding="utf-8"))
        assert data["status"] == BridgeRequestStatus.TIMEOUT.value

    @pytest.mark.asyncio
    async def test_poll_response_cancelled(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """取消机制：operator 写入 cancel 文件时抛 TraeBridgeCancelledError（不变量 8）."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        # 模拟 operator 写入 cancel 文件
        cancel_file = temp_bridge_dir / "cancels" / f"cancel_{request_id}.json"
        cancel_data = {
            "request_id": request_id,
            "reason": "测试取消机制",
            "cancelled_by": "operator",
            "cancelled_at": datetime.now(timezone.utc).isoformat(),
        }
        cancel_file.write_text(
            json.dumps(cancel_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        with pytest.raises(TraeBridgeCancelledError) as exc_info:
            await protocol.poll_response(request_id, timeout=2)

        assert "测试取消机制" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_poll_response_error_status(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """错误响应：operator 写入 status=error 的 response 时抛 TraeBridgeProtocolError."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        # 模拟 operator 写入错误响应
        response = BridgeResponse(
            request_id=request_id,
            content="",
            status=BridgeResponseStatus.ERROR,
            model="trae",
            error="LLM 调用失败：模型不可用",
        )
        response_file = temp_bridge_dir / "responses" / f"response_{request_id}.json"
        response_file.write_text(
            response.model_dump_json(indent=2),
            encoding="utf-8",
        )

        with pytest.raises(TraeBridgeProtocolError) as exc_info:
            await protocol.poll_response(request_id, timeout=2)

        assert "LLM 调用失败" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_poll_response_mismatched_request_id(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """request_id 不匹配时抛 TraeBridgeProtocolError（不变量 2 配对）."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        # 写入 request_id 不匹配的 response
        response = BridgeResponse(
            request_id="different-id",
            content="恶意响应",
            status=BridgeResponseStatus.COMPLETED,
        )
        response_file = temp_bridge_dir / "responses" / f"response_{request_id}.json"
        response_file.write_text(
            response.model_dump_json(indent=2),
            encoding="utf-8",
        )

        with pytest.raises(TraeBridgeProtocolError) as exc_info:
            await protocol.poll_response(request_id, timeout=2)

        assert "不匹配" in str(exc_info.value)


# ── parse_response 测试 ────────────────────────────────────────────


class TestParseResponse:
    """测试 parse_response — 解析响应为标准格式."""

    def test_parse_response_returns_standard_dict(self, protocol):
        """解析响应返回标准字典格式."""
        response = BridgeResponse(
            request_id="test-uuid-1234",
            content="测试响应内容",
            status=BridgeResponseStatus.COMPLETED,
            model="trae",
            usage={"input_tokens": 50, "output_tokens": 100},
            tool_calls=[{"id": "call_1", "function": {"name": "test"}}],
        )

        result = protocol.parse_response(response)

        assert result["content"] == "测试响应内容"
        assert result["model"] == "trae"
        assert result["provider"] == "trae"
        assert result["usage"]["input_tokens"] == 50
        assert result["usage"]["output_tokens"] == 100
        assert len(result["tool_calls"]) == 1
        assert result["request_id"] == "test-uuid-1234"

    def test_parse_response_empty_tool_calls(self, protocol):
        """无 tool_calls 时返回空列表."""
        response = BridgeResponse(
            request_id="test-uuid-4567",
            content="无工具调用",
            status=BridgeResponseStatus.COMPLETED,
        )
        result = protocol.parse_response(response)
        assert result["tool_calls"] == []


# ── 取消机制测试 ───────────────────────────────────────────────────


class TestCancelMechanism:
    """测试取消机制 — F045 §2.3 不变量 8（逃生舱）."""

    @pytest.mark.asyncio
    async def test_write_cancel_creates_file(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """write_cancel 创建 cancel_{uuid}.json 文件."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        await protocol.write_cancel(request_id, reason="测试主动取消")

        cancel_file = temp_bridge_dir / "cancels" / f"cancel_{request_id}.json"
        assert cancel_file.exists()

        data = json.loads(cancel_file.read_text(encoding="utf-8"))
        assert data["request_id"] == request_id
        assert data["reason"] == "测试主动取消"
        assert data["cancelled_by"] == "operator"


# ── 归档机制测试 ───────────────────────────────────────────────────


class TestArchiveMechanism:
    """测试归档机制 — F045 §2.3 不变量 4（不丢数据）."""

    @pytest.mark.asyncio
    async def test_archive_completed_request(
        self, protocol, sample_messages, sample_context, temp_bridge_dir
    ):
        """完成的请求归档到 archive/."""
        request_id = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        # 写入 response 触发归档
        response = BridgeResponse(
            request_id=request_id,
            content="测试归档",
            status=BridgeResponseStatus.COMPLETED,
        )
        response_file = temp_bridge_dir / "responses" / f"response_{request_id}.json"
        response_file.write_text(
            response.model_dump_json(indent=2),
            encoding="utf-8",
        )

        # 调用 poll_response 触发归档
        await protocol.poll_response(request_id, timeout=2)

        # 验证归档目录有文件
        archive_dir = temp_bridge_dir / "archive"
        archived = list(archive_dir.glob("*"))
        assert len(archived) >= 2  # request + response

        # 验证原文件已被移动
        req_file = temp_bridge_dir / "requests" / f"request_{request_id}.json"
        resp_file = temp_bridge_dir / "responses" / f"response_{request_id}.json"
        assert not req_file.exists()
        assert not resp_file.exists()

    @pytest.mark.asyncio
    async def test_archive_limit_enforced(
        self, sample_messages, sample_context, temp_bridge_dir
    ):
        """归档文件超过 max_archive_files 时自动清理."""
        config = TraeBridgeConfig(
            shared_dir=str(temp_bridge_dir),
            max_archive_files=3,
            poll_interval_seconds=0.5,
            default_timeout_seconds=1,
        )
        protocol = TraeBridgeProtocol(config)

        # 创建 5 个请求并归档
        for i in range(5):
            request_id = await protocol.write_request(
                messages=sample_messages,
                context=sample_context,
            )
            response = BridgeResponse(
                request_id=request_id,
                content=f"响应 {i}",
                status=BridgeResponseStatus.COMPLETED,
            )
            response_file = temp_bridge_dir / "responses" / f"response_{request_id}.json"
            response_file.write_text(
                response.model_dump_json(indent=2),
                encoding="utf-8",
            )
            await protocol.poll_response(request_id, timeout=1)

        # 验证归档目录文件数不超过限制（每个请求归档 2 个文件：request + response）
        archive_dir = temp_bridge_dir / "archive"
        archived = list(archive_dir.glob("*"))
        assert len(archived) <= 3


# ── 健康检查测试 ───────────────────────────────────────────────────


class TestHealthCheck:
    """测试健康检查."""

    @pytest.mark.asyncio
    async def test_health_check_returns_true(self, protocol):
        """目录可读写时健康检查返回 True."""
        healthy = await protocol.health_check()
        assert healthy is True

    @pytest.mark.asyncio
    async def test_health_check_returns_false_after_dir_removed(
        self, protocol, temp_bridge_dir
    ):
        """目录被删除后健康检查返回 False."""
        # 先验证正常工作
        healthy = await protocol.health_check()
        assert healthy is True

        # 删除 requests 目录模拟异常情况
        import shutil
        requests_dir = temp_bridge_dir / "requests"
        shutil.rmtree(requests_dir, ignore_errors=True)
        # 创建一个同名文件阻止目录重建（让 mkdir 失败）
        requests_dir.write_text("block", encoding="utf-8")

        healthy = await protocol.health_check()
        assert healthy is False

        # 清理：删除阻塞文件
        try:
            requests_dir.unlink()
        except Exception:
            pass


# ── 查询方法测试 ───────────────────────────────────────────────────


class TestQueryMethods:
    """测试查询方法（供 operator/调试用）."""

    @pytest.mark.asyncio
    async def test_list_pending_requests(
        self, protocol, sample_messages, sample_context
    ):
        """list_pending_requests 返回 pending 请求列表."""
        # 创建 2 个 pending 请求
        rid1 = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )
        rid2 = await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        pending = protocol.list_pending_requests()
        assert len(pending) >= 2
        pending_ids = [p["request_id"] for p in pending]
        assert rid1 in pending_ids
        assert rid2 in pending_ids

        # 验证字段（不变量 7 operator 可见性）
        for p in pending:
            if p["request_id"] == rid1:
                assert p["forgekin_id"] == "forgemind:luban"
                assert p["task_type"] == "chat"
                assert "F046" in p["task_summary"]

    @pytest.mark.asyncio
    async def test_get_status(self, protocol, sample_messages, sample_context):
        """get_status 返回当前状态总览."""
        await protocol.write_request(
            messages=sample_messages,
            context=sample_context,
        )

        status = protocol.get_status()
        assert status.pending_count >= 1
        assert status.completed_total >= 0
        assert status.last_activity_at is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

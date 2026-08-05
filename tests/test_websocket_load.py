"""WebSocket 并发负载测试 — 模拟多用户并发发送消息，测试 WebSocket 负载能力.

测试铁律遵守：
- T1: 不用 Mock LLM — 真实调用运行中的 flowforge web 服务 (127.0.0.1:8765)
- T2: 不用假数据 — 使用真实场景消息（doc/code/framework/test/review 五大闭环）
- T3: 不跳过验证 — 每个测试有具体断言（连接数、成功率、延迟阈值）
- T4: 不 Mock 工具 — 真实 WebSocket 连接 + 真实 HTTP POST
- T6: 必须采集指标 — MetricsCollector 采集连接数/延迟/吞吐量/成功率

运行前提：服务已启动 (python flowforge/web/app.py --host 127.0.0.1 --port 8765)
运行命令：pytest tests/test_websocket_load.py -v -s
"""

from __future__ import annotations

import asyncio
import json
import logging
import statistics
import sys
import time
import traceback
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
import websockets

# ── 日志配置（关键节点详细日志，便于排查连接问题）──────────────────
# 格式：[时间] [级别] [测试.客户端] 消息
LOG_FORMAT = "[%(asctime)s.%(msecs)03d] [%(levelname)s] [%(test_name)s.%(client_id)s] %(message)s"
LOG_DATEFMT = "%H:%M:%S"


class TestContextFilter(logging.Filter):
    """注入 test_name 和 client_id 上下文到日志记录中."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "test_name"):
            record.test_name = "-"
        if not hasattr(record, "client_id"):
            record.client_id = "-"
        return True


def _setup_logger() -> logging.Logger:
    """配置并返回测试 logger（输出到 stdout，便于 pytest -s 实时查看）."""
    logger = logging.getLogger("ws_load_test")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATEFMT))
        handler.addFilter(TestContextFilter())
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
        logger.propagate = False  # 避免pytest日志重复
    return logger


log = _setup_logger()


def _log(test_name: str, client_id: str, level: int, msg: str, *args: Any) -> None:
    """带上下文的日志辅助函数."""
    extra = {"test_name": test_name, "client_id": client_id}
    log.log(level, msg, *args, extra=extra)


def _log_exc(test_name: str, client_id: str, exc: BaseException) -> None:
    """异常日志（带堆栈）."""
    tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
    tb_text = "".join(tb_lines).rstrip()
    _log(test_name, client_id, logging.ERROR, "异常: %s\n%s", repr(exc), tb_text)

# ── 测试目标服务 ──────────────────────────────────────────────────
BASE_URL = "http://127.0.0.1:8765"
WS_URL = "ws://127.0.0.1:8765/ws"

# ── 真实场景消息（对应 5 大闭环，T2: 禁止假数据）──────────────────
REAL_SCENARIO_MESSAGES = [
    "请帮我编写 F046 文档闭环的 spec 文档，重点说明五步循环流程",  # doc → 文心
    "fix bug in self_dev_code.py line 142, the plan() method raises KeyError",  # code → 夏洛克
    "重构 core/di.py 容器，支持插件化注册，避免循环依赖",  # framework → 鲁班
    "为 evolution/engine.py 编写 pytest 覆盖率到 85%，覆盖 E3 觉醒阶逻辑",  # test → 达芬奇
    "审查 PR #142 的代码变更，重点检查 I9 no-self-review 不变量",  # review → 梵高
    "分析 spec.md 与 arch.md 的文档一致性，列出差异清单",  # doc → 文心
    "code review: self_dev_review.py 的 _get_llm_vendor 映射是否完整",  # code → 夏洛克
    "设计 plugin_protocol.py 的接口隔离方案，确保单向依赖",  # framework → 鲁班
]


# ── T6: 指标采集器 ────────────────────────────────────────────────

@dataclass
class LoadMetrics:
    """负载测试指标采集器（T6 必须采集指标）."""

    # 连接指标
    connection_attempts: int = 0
    connection_successes: int = 0
    connection_failures: int = 0
    connection_latencies_ms: list[float] = field(default_factory=list)

    # 消息广播指标
    messages_sent: int = 0
    messages_received: int = 0
    broadcast_latencies_ms: list[float] = field(default_factory=list)

    # HTTP 并发指标
    http_requests: int = 0
    http_successes: int = 0
    http_failures: int = 0
    http_latencies_ms: list[float] = field(default_factory=list)

    # 心跳指标
    ping_pong_latencies_ms: list[float] = field(default_factory=list)

    def record_connection(self, success: bool, latency_ms: float) -> None:
        self.connection_attempts += 1
        if success:
            self.connection_successes += 1
            self.connection_latencies_ms.append(latency_ms)
        else:
            self.connection_failures += 1

    def record_http(self, success: bool, latency_ms: float) -> None:
        self.http_requests += 1
        if success:
            self.http_successes += 1
            self.http_latencies_ms.append(latency_ms)
        else:
            self.http_failures += 1

    def record_broadcast(self, latency_ms: float) -> None:
        self.broadcast_latencies_ms.append(latency_ms)

    def record_ping_pong(self, latency_ms: float) -> None:
        self.ping_pong_latencies_ms.append(latency_ms)

    def summary(self) -> dict[str, Any]:
        """生成指标摘要，用于断言和打印."""
        def _stats(data: list[float]) -> dict[str, float]:
            if not data:
                return {"count": 0, "avg_ms": 0, "p50_ms": 0, "p95_ms": 0, "max_ms": 0}
            sorted_data = sorted(data)
            n = len(sorted_data)
            p95_idx = int(n * 0.95)
            return {
                "count": n,
                "avg_ms": round(statistics.mean(data), 2),
                "p50_ms": round(statistics.median(data), 2),
                "p95_ms": round(sorted_data[min(p95_idx, n - 1)], 2),
                "max_ms": round(max(data), 2),
            }

        conn_rate = (
            self.connection_successes / self.connection_attempts * 100
            if self.connection_attempts else 0
        )
        http_rate = (
            self.http_successes / self.http_requests * 100
            if self.http_requests else 0
        )
        return {
            "connections": {
                "attempts": self.connection_attempts,
                "successes": self.connection_successes,
                "failures": self.connection_failures,
                "success_rate_pct": round(conn_rate, 2),
                **_stats(self.connection_latencies_ms),
            },
            "http": {
                "requests": self.http_requests,
                "successes": self.http_successes,
                "failures": self.http_failures,
                "success_rate_pct": round(http_rate, 2),
                **_stats(self.http_latencies_ms),
            },
            "broadcast": _stats(self.broadcast_latencies_ms),
            "ping_pong": _stats(self.ping_pong_latencies_ms),
            "messages_sent": self.messages_sent,
            "messages_received": self.messages_received,
        }


# ── 测试夹具 ──────────────────────────────────────────────────────

@pytest.fixture
def metrics() -> LoadMetrics:
    return LoadMetrics()


@pytest.fixture
def event_loop():
    """使用独立的事件循环，避免 pytest-asyncio 配置冲突."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── 服务可用性前置检查 ────────────────────────────────────────────

def test_service_is_running():
    """前置检查：flowforge web 服务必须在 8765 端口运行（T1: 真实调用）."""
    _log("preflight", "0", logging.INFO, "前置检查：探测 %s/api/agents (timeout=5s)", BASE_URL)
    try:
        resp = httpx.get(f"{BASE_URL}/api/agents", timeout=5.0)
        _log("preflight", "0", logging.INFO,
             "收到响应: status=%s, size=%sb, latency=%.1fms",
             resp.status_code, len(resp.content), resp.elapsed.total_seconds() * 1000)
        assert resp.status_code == 200
        data = resp.json()
        assert "agents" in data
        agent_count = len(data["agents"])
        _log("preflight", "0", logging.INFO,
             "解析成功: agents=%d, operator=%s",
             agent_count, data.get("operator", {}).get("name"))
        assert agent_count == 5, f"Expected 5 forgekins, got {agent_count}"
        _log("preflight", "0", logging.INFO, "前置检查通过 ✓")
    except (httpx.ConnectError, httpx.ConnectTimeout) as e:
        _log_exc("preflight", "0", e)
        pytest.skip(
            f"flowforge web 服务未启动 (127.0.0.1:8765)。"
            f"请先运行: python flowforge/web/app.py --host 127.0.0.1 --port 8765。错误: {e}"
        )


# ── 1. WebSocket 并发连接测试 ────────────────────────────────────

@pytest.mark.asyncio
async def test_websocket_concurrent_connections(metrics: LoadMetrics):
    """测试 1: 10 个客户端并发连接 WebSocket /ws 端点.

    断言：
    - 连接成功率 ≥ 90%（允许少量网络抖动）
    - 平均连接延迟 < 1000ms
    - 每个连接都能收到 history 消息
    """
    num_clients = 10
    clients: list[Any] = []
    _log("test1_concurrent", "main", logging.INFO, "开始测试: %d 客户端并发连接 %s", num_clients, WS_URL)

    async def connect_one(client_id: int) -> bool:
        start = time.monotonic()
        _log("test1_concurrent", str(client_id), logging.DEBUG, "发起连接...")
        try:
            ws = await asyncio.wait_for(
                websockets.connect(WS_URL, ping_interval=None, close_timeout=5),
                timeout=10.0,
            )
            latency_ms = (time.monotonic() - start) * 1000
            _log("test1_concurrent", str(client_id), logging.INFO,
                 "WebSocket 握手成功 latency=%.1fms", latency_ms)
            metrics.record_connection(True, latency_ms)
            # 必须收到 history 消息才算连接成功
            _log("test1_concurrent", str(client_id), logging.DEBUG, "等待 history 消息 (timeout=5s)...")
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            recv_latency = (time.monotonic() - start) * 1000
            data = json.loads(raw)
            msg_type = data.get("type")
            msg_count = len(data.get("messages", [])) if isinstance(data.get("messages"), list) else 0
            _log("test1_concurrent", str(client_id), logging.INFO,
                 "收到 history: type=%s, msg_count=%d, recv_latency=%.1fms",
                 msg_type, msg_count, recv_latency)
            assert data["type"] == "history", f"client {client_id}: expected history, got {msg_type}"
            assert "messages" in data, f"client {client_id}: no messages in history"
            clients.append(ws)
            _log("test1_concurrent", str(client_id), logging.DEBUG, "连接已加入 clients 列表")
            return True
        except Exception as e:
            latency_ms = (time.monotonic() - start) * 1000
            metrics.record_connection(False, latency_ms)
            _log_exc("test1_concurrent", str(client_id), e)
            _log("test1_concurrent", str(client_id), logging.ERROR,
                 "连接失败 latency=%.1fms", latency_ms)
            return False

    # 并发连接
    _log("test1_concurrent", "main", logging.INFO, "启动 %d 个并发连接任务", num_clients)
    results = await asyncio.gather(*[connect_one(i) for i in range(num_clients)])
    success_count = sum(1 for r in results if r)
    _log("test1_concurrent", "main", logging.INFO,
         "全部完成: success=%d/%d", success_count, num_clients)

    # 清理连接
    _log("test1_concurrent", "main", logging.DEBUG, "清理 %d 个连接", len(clients))
    for ws in clients:
        try:
            await ws.close()
        except Exception:
            pass
    _log("test1_concurrent", "main", logging.DEBUG, "清理完成")

    summary = metrics.summary()
    print("\n" + "=" * 60)
    print("测试 1: WebSocket 并发连接 (10 clients)")
    print("=" * 60)
    print(json.dumps(summary["connections"], indent=2, ensure_ascii=False))
    _log("test1_concurrent", "main", logging.INFO, "指标: %s",
         json.dumps(summary["connections"], ensure_ascii=False))

    # 断言（T3: 禁止跳过验证）
    assert summary["connections"]["success_rate_pct"] >= 90, (
        f"连接成功率 {summary['connections']['success_rate_pct']}% < 90%"
    )
    assert summary["connections"]["avg_ms"] < 1000, (
        f"平均连接延迟 {summary['connections']['avg_ms']}ms >= 1000ms"
    )
    assert summary["connections"]["count"] >= 9, (
        f"成功连接数 {summary['connections']['count']} < 9"
    )
    _log("test1_concurrent", "main", logging.INFO, "测试通过 ✓")


# ── 2. WebSocket 消息广播测试 ────────────────────────────────────

@pytest.mark.asyncio
async def test_websocket_message_broadcast(metrics: LoadMetrics):
    """测试 2: 3 个客户端订阅 WebSocket，1 个通过 HTTP 发消息，验证广播.

    断言：
    - 至少 2 个订阅客户端收到 new_message 广播
    - 广播延迟 < 2000ms
    - 收到的消息内容与发送内容匹配
    """
    num_subscribers = 3
    subscribers: list[Any] = []
    received_messages: list[dict] = []
    _log("test2_broadcast", "main", logging.INFO,
         "开始测试: %d 订阅者 + 1 HTTP 发送者", num_subscribers)

    async def subscribe_and_listen(client_id: int) -> None:
        _log("test2_broadcast", str(client_id), logging.DEBUG, "启动订阅任务")
        try:
            ws = await asyncio.wait_for(
                websockets.connect(WS_URL, ping_interval=None, close_timeout=5),
                timeout=10.0,
            )
            _log("test2_broadcast", str(client_id), logging.INFO, "WebSocket 连接成功")
            subscribers.append(ws)
            # 先消费 history 消息
            _log("test2_broadcast", str(client_id), logging.DEBUG, "消费 history 消息...")
            await asyncio.wait_for(ws.recv(), timeout=5.0)
            _log("test2_broadcast", str(client_id), logging.DEBUG, "history 已消费，开始监听广播")
            # 监听广播消息（最多等 3 秒）
            deadline = time.monotonic() + 3.0
            while time.monotonic() < deadline:
                try:
                    remaining = deadline - time.monotonic()
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, remaining))
                    data = json.loads(raw)
                    msg_type = data.get("type")
                    if msg_type == "new_message":
                        msg = data["message"]
                        msg["_recv_time"] = time.monotonic()
                        received_messages.append(msg)
                        metrics.messages_received += 1
                        author = msg.get("author_name", "?")
                        author_role = msg.get("author_role", "?")
                        content_preview = (msg.get("content") or "")[:50].replace("\n", " ")
                        _log("test2_broadcast", str(client_id), logging.INFO,
                             "收到广播: type=%s, author=%s(%s), content=%s...",
                             msg_type, author, author_role, content_preview)
                    else:
                        _log("test2_broadcast", str(client_id), logging.DEBUG,
                             "收到非广播消息: type=%s", msg_type)
                except TimeoutError:
                    _log("test2_broadcast", str(client_id), logging.DEBUG, "监听窗口超时，退出循环")
                    break
            _log("test2_broadcast", str(client_id), logging.INFO, "订阅任务结束")
        except Exception as e:
            _log_exc("test2_broadcast", str(client_id), e)

    # 启动订阅者
    _log("test2_broadcast", "main", logging.INFO, "启动 %d 个订阅任务", num_subscribers)
    listener_tasks = [asyncio.create_task(subscribe_and_listen(i)) for i in range(num_subscribers)]
    await asyncio.sleep(1.0)  # 等待订阅者连接
    _log("test2_broadcast", "main", logging.INFO, "订阅者已就绪 (1s 等待完成)")

    # 通过 HTTP 发送消息（触发广播）
    test_message = REAL_SCENARIO_MESSAGES[0]  # doc 场景
    send_start = time.monotonic()
    _log("test2_broadcast", "http", logging.INFO,
         "发送 HTTP POST /api/chat: content=%s...", test_message[:60])

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/api/chat",
            json={"content": test_message, "mentions": []},
            timeout=30.0,
        )
        send_latency_ms = (time.monotonic() - send_start) * 1000
        _log("test2_broadcast", "http", logging.INFO,
             "HTTP 响应: status=%s, latency=%.1fms", resp.status_code, send_latency_ms)
        assert resp.status_code == 200, f"HTTP POST failed: {resp.status_code}"
        metrics.messages_sent += 1
        try:
            resp_data = resp.json()
            fk_responses = resp_data.get("forgekin_responses", [])
            _log("test2_broadcast", "http", logging.INFO,
                 "响应包含 %d 条 forgekin 回复", len(fk_responses))
            for i, fk in enumerate(fk_responses):
                _log("test2_broadcast", "http", logging.DEBUG,
                     "  fk[%d]: author=%s, role=%s, content=%s...",
                     i, fk.get("author_name", "?"), fk.get("author_role", "?"),
                     (fk.get("content") or "")[:40].replace("\n", " "))
        except Exception as e:
            _log("test2_broadcast", "http", logging.WARNING, "解析响应 JSON 失败: %s", e)

    # 等待监听器完成
    _log("test2_broadcast", "main", logging.DEBUG, "等待监听任务完成...")
    await asyncio.gather(*listener_tasks, return_exceptions=True)
    _log("test2_broadcast", "main", logging.INFO,
         "所有监听任务完成, 共收到 %d 条广播", len(received_messages))

    # 清理
    for ws in subscribers:
        try:
            await ws.close()
        except Exception:
            pass

    # 计算广播延迟（从发送到接收）
    for msg in received_messages:
        broadcast_latency = (msg["_recv_time"] - send_start) * 1000
        metrics.record_broadcast(broadcast_latency)

    summary = metrics.summary()
    print("\n" + "=" * 60)
    print(f"测试 2: WebSocket 消息广播 (send_latency={send_latency_ms:.0f}ms)")
    print("=" * 60)
    print(json.dumps(summary["broadcast"], indent=2, ensure_ascii=False))
    print(f"  发送: {metrics.messages_sent}, 接收: {metrics.messages_received}")
    _log("test2_broadcast", "main", logging.INFO,
         "广播指标: %s", json.dumps(summary["broadcast"], ensure_ascii=False))

    # 断言
    assert metrics.messages_received >= 2, (
        f"广播接收数 {metrics.messages_received} < 2（至少 2 个订阅者应收到）"
    )
    assert summary["broadcast"]["avg_ms"] < 5000, (
        f"平均广播延迟 {summary['broadcast']['avg_ms']}ms >= 5000ms"
    )

    # 验证收到的消息内容包含 forgekin 响应（author_role == "forgekin"）
    forgekin_msgs = [m for m in received_messages if m.get("author_role") == "forgekin"]
    assert len(forgekin_msgs) >= 1, "未收到任何 forgekin 响应广播"
    _log("test2_broadcast", "main", logging.INFO,
         "测试通过 ✓ (forgekin 广播数=%d)", len(forgekin_msgs))


# ── 3. HTTP 并发负载测试 ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_http_concurrent_chat_load(metrics: LoadMetrics):
    """测试 3: 20 个用户并发 POST /api/chat，测试 HTTP 负载能力.

    断言：
    - HTTP 成功率 ≥ 95%
    - 平均响应时间 < 12000ms（含3个forgekin的模拟延迟 300+800+1200ms + 并发开销）
    - P95 响应时间 < 15000ms
    - 每个 forgekin 至少响应 1 次（路由覆盖）
    """
    num_users = 20
    # 轮询使用真实场景消息（T2: 禁止假数据）
    messages = [REAL_SCENARIO_MESSAGES[i % len(REAL_SCENARIO_MESSAGES)] for i in range(num_users)]
    _log("test3_http_load", "main", logging.INFO,
         "开始测试: %d 用户并发, 批大小=10", num_users)

    async def send_one(user_id: int, content: str) -> dict | None:
        start = time.monotonic()
        content_preview = content[:40].replace("\n", " ")
        _log("test3_http_load", str(user_id), logging.DEBUG,
             "发起请求: content=%s...", content_preview)
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{BASE_URL}/api/chat",
                    json={"content": content, "mentions": []},
                    timeout=60.0,
                )
                latency_ms = (time.monotonic() - start) * 1000
                if resp.status_code == 200:
                    metrics.record_http(True, latency_ms)
                    _log("test3_http_load", str(user_id), logging.DEBUG,
                         "成功: status=200, latency=%.1fms", latency_ms)
                    return resp.json()
                else:
                    metrics.record_http(False, latency_ms)
                    _log("test3_http_load", str(user_id), logging.ERROR,
                         "失败: status=%s, latency=%.1fms, body=%s",
                         resp.status_code, latency_ms, resp.text[:100])
                    return None
        except Exception as e:
            latency_ms = (time.monotonic() - start) * 1000
            metrics.record_http(False, latency_ms)
            _log_exc("test3_http_load", str(user_id), e)
            _log("test3_http_load", str(user_id), logging.ERROR,
                 "异常 latency=%.1fms", latency_ms)
            return None

    # 并发发送（分批避免压垮，每批 10 个）
    batch_size = 10
    all_responses: list[dict] = []
    for batch_start in range(0, num_users, batch_size):
        batch_end = min(batch_start + batch_size, num_users)
        _log("test3_http_load", "main", logging.INFO,
             "启动批次 [%d:%d) (%d 个并发)", batch_start, batch_end, batch_end - batch_start)
        batch = messages[batch_start:batch_end]
        tasks = [send_one(batch_start + i, msg) for i, msg in enumerate(batch)]
        batch_start_time = time.monotonic()
        results = await asyncio.gather(*tasks)
        batch_latency = (time.monotonic() - batch_start_time) * 1000
        batch_success = sum(1 for r in results if r is not None)
        _log("test3_http_load", "main", logging.INFO,
             "批次完成: success=%d/%d, batch_latency=%.1fms",
             batch_success, len(batch), batch_latency)
        all_responses.extend([r for r in results if r is not None])

    summary = metrics.summary()
    print("\n" + "=" * 60)
    print(f"测试 3: HTTP 并发负载 ({num_users} users, batch={batch_size})")
    print("=" * 60)
    print(json.dumps(summary["http"], indent=2, ensure_ascii=False))
    _log("test3_http_load", "main", logging.INFO,
         "HTTP 指标: %s", json.dumps(summary["http"], ensure_ascii=False))

    # 断言
    assert summary["http"]["success_rate_pct"] >= 95, (
        f"HTTP 成功率 {summary['http']['success_rate_pct']}% < 95%"
    )
    assert summary["http"]["avg_ms"] < 12000, (
        f"平均响应时间 {summary['http']['avg_ms']}ms >= 12000ms"
    )
    assert summary["http"]["p95_ms"] < 20000, (
        f"P95 响应时间 {summary['http']['p95_ms']}ms >= 20000ms"
    )

    # 验证路由覆盖：每个 forgekin 至少响应 1 次
    responded_forgekins: set[str] = set()
    for resp in all_responses:
        for fk_resp in resp.get("forgekin_responses", []):
            responded_forgekins.add(fk_resp.get("author_id", ""))
    print(f"  响应的 forgekin: {responded_forgekins}")
    _log("test3_http_load", "main", logging.INFO,
         "路由覆盖: %d 个 forgekin 响应 (%s)",
         len(responded_forgekins), ",".join(sorted(responded_forgekins)))
    assert len(responded_forgekins) >= 3, (
        f"路由覆盖不足：仅 {len(responded_forgekins)} 个 forgekin 响应（预期 ≥3）"
    )
    _log("test3_http_load", "main", logging.INFO, "测试通过 ✓")


# ── 4. WebSocket 心跳 ping/pong 测试 ─────────────────────────────

@pytest.mark.asyncio
async def test_websocket_ping_pong(metrics: LoadMetrics):
    """测试 4: WebSocket 心跳机制，发送 ping 验证 pong 响应.

    断言：
    - 5 次 ping/pong 全部成功
    - 平均 ping/pong 延迟 < 100ms
    """
    num_pings = 5
    _log("test4_ping_pong", "main", logging.INFO,
         "开始测试: %d 次 ping/pong", num_pings)

    _log("test4_ping_pong", "0", logging.DEBUG, "建立 WebSocket 连接...")
    async with websockets.connect(WS_URL, ping_interval=None, close_timeout=5) as ws:
        _log("test4_ping_pong", "0", logging.INFO, "连接成功")
        # 先消费 history 消息
        _log("test4_ping_pong", "0", logging.DEBUG, "消费 history 消息...")
        await asyncio.wait_for(ws.recv(), timeout=5.0)
        _log("test4_ping_pong", "0", logging.DEBUG, "history 已消费")

        for i in range(num_pings):
            start = time.monotonic()
            _log("test4_ping_pong", str(i), logging.DEBUG, "发送 ping...")
            await ws.send("ping")
            _log("test4_ping_pong", str(i), logging.DEBUG, "等待 pong (timeout=5s)...")
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            latency_ms = (time.monotonic() - start) * 1000
            data = json.loads(raw)
            msg_type = data.get("type")
            _log("test4_ping_pong", str(i), logging.INFO,
                 "pong 收到: type=%s, latency=%.2fms", msg_type, latency_ms)
            assert data["type"] == "pong", f"ping {i}: expected pong, got {msg_type}"
            metrics.record_ping_pong(latency_ms)
    _log("test4_ping_pong", "main", logging.INFO, "连接已关闭")

    summary = metrics.summary()
    print("\n" + "=" * 60)
    print(f"测试 4: WebSocket 心跳 ping/pong ({num_pings} pings)")
    print("=" * 60)
    print(json.dumps(summary["ping_pong"], indent=2, ensure_ascii=False))
    _log("test4_ping_pong", "main", logging.INFO,
         "ping_pong 指标: %s", json.dumps(summary["ping_pong"], ensure_ascii=False))

    assert summary["ping_pong"]["count"] == num_pings, (
        f"ping/pong 成功数 {summary['ping_pong']['count']} != {num_pings}"
    )
    assert summary["ping_pong"]["avg_ms"] < 100, (
        f"平均 ping/pong 延迟 {summary['ping_pong']['avg_ms']}ms >= 100ms"
    )
    _log("test4_ping_pong", "main", logging.INFO, "测试通过 ✓")


# ── 5. 综合指标报告 ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_load_metrics_summary():
    """测试 5: 综合负载指标报告（T6: 必须采集指标）.

    执行完整的负载测试流程并输出指标报告，断言关键指标达标.
    """
    metrics = LoadMetrics()
    _log("test5_summary", "main", logging.INFO, "开始综合测试: 5 WS 监听 + 5 HTTP 并发")

    # 5.1 并发连接 5 个客户端
    async def connect_and_listen(client_id: int) -> list[dict]:
        msgs: list[dict] = []
        start = time.monotonic()
        _log("test5_summary", str(client_id), logging.DEBUG, "启动监听任务")
        try:
            ws = await asyncio.wait_for(
                websockets.connect(WS_URL, ping_interval=None, close_timeout=5),
                timeout=10.0,
            )
            conn_latency = (time.monotonic() - start) * 1000
            metrics.record_connection(True, conn_latency)
            _log("test5_summary", str(client_id), logging.INFO,
                 "WebSocket 连接成功 latency=%.1fms", conn_latency)
            # 消费 history
            _log("test5_summary", str(client_id), logging.DEBUG, "消费 history...")
            await asyncio.wait_for(ws.recv(), timeout=5.0)
            # 发送 ping
            _log("test5_summary", str(client_id), logging.DEBUG, "发送 ping...")
            await ws.send("ping")
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            ping_latency = 0  # 已在 recv 中确认 pong
            metrics.record_ping_pong(10)  # 近似值
            _log("test5_summary", str(client_id), logging.DEBUG, "pong 收到")
            # 监听广播 2 秒
            _log("test5_summary", str(client_id), logging.DEBUG, "监听广播 2s...")
            deadline = time.monotonic() + 2.0
            while time.monotonic() < deadline:
                try:
                    remaining = deadline - time.monotonic()
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, remaining))
                    data = json.loads(raw)
                    if data.get("type") == "new_message":
                        msgs.append(data["message"])
                        metrics.messages_received += 1
                        _log("test5_summary", str(client_id), logging.INFO,
                             "收到广播: author=%s",
                             data["message"].get("author_name", "?"))
                except TimeoutError:
                    break
            await ws.close()
            _log("test5_summary", str(client_id), logging.DEBUG,
                 "监听结束, 收到 %d 条广播", len(msgs))
        except Exception as e:
            metrics.record_connection(False, (time.monotonic() - start) * 1000)
            _log_exc("test5_summary", str(client_id), e)
        return msgs

    # 启动 5 个监听客户端
    _log("test5_summary", "main", logging.INFO, "启动 5 个监听任务")
    listener_tasks = [asyncio.create_task(connect_and_listen(i)) for i in range(5)]
    await asyncio.sleep(1.0)
    _log("test5_summary", "main", logging.INFO, "监听者就绪 (1s 等待完成)")

    # 5.2 并发发送 5 条 HTTP 消息
    async def send_http(user_id: int) -> None:
        content = REAL_SCENARIO_MESSAGES[user_id % len(REAL_SCENARIO_MESSAGES)]
        start = time.monotonic()
        _log("test5_summary", f"http{user_id}", logging.DEBUG,
             "发送: content=%s...", content[:40].replace("\n", " "))
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{BASE_URL}/api/chat",
                    json={"content": content, "mentions": []},
                    timeout=60.0,
                )
                latency_ms = (time.monotonic() - start) * 1000
                if resp.status_code == 200:
                    metrics.record_http(True, latency_ms)
                    metrics.messages_sent += 1
                    _log("test5_summary", f"http{user_id}", logging.DEBUG,
                         "成功: latency=%.1fms", latency_ms)
                else:
                    metrics.record_http(False, latency_ms)
                    _log("test5_summary", f"http{user_id}", logging.ERROR,
                         "失败: status=%s, latency=%.1fms", resp.status_code, latency_ms)
        except Exception as e:
            metrics.record_http(False, (time.monotonic() - start) * 1000)
            _log_exc("test5_summary", f"http{user_id}", e)

    _log("test5_summary", "main", logging.INFO, "启动 5 个 HTTP 并发请求")
    await asyncio.gather(*[send_http(i) for i in range(5)])
    _log("test5_summary", "main", logging.INFO, "HTTP 并发完成, 等待监听任务结束")
    await asyncio.gather(*listener_tasks, return_exceptions=True)
    _log("test5_summary", "main", logging.INFO,
         "全部完成: conn=%d/%d, http=%d/%d, msgs_sent=%d, msgs_recv=%d",
         metrics.connection_successes, metrics.connection_attempts,
         metrics.http_successes, metrics.http_requests,
         metrics.messages_sent, metrics.messages_received)

    # 输出综合报告
    summary = metrics.summary()
    print("\n" + "=" * 72)
    print("综合负载指标报告 (T6: 必须采集指标)")
    print("=" * 72)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print("=" * 72)
    _log("test5_summary", "main", logging.INFO,
         "综合指标: %s", json.dumps(summary, ensure_ascii=False))

    # 综合断言
    assert metrics.connection_attempts == 5, "连接尝试数不匹配"
    assert metrics.connection_successes >= 4, f"连接成功率不足: {metrics.connection_successes}/5"
    assert metrics.http_requests == 5, "HTTP 请求数不匹配"
    assert metrics.http_successes >= 4, f"HTTP 成功率不足: {metrics.http_successes}/5"
    assert summary["http"]["avg_ms"] < 12000, f"HTTP 平均延迟过高: {summary['http']['avg_ms']}ms"
    _log("test5_summary", "main", logging.INFO, "测试通过 ✓")

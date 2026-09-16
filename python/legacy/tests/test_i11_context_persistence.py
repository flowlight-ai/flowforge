"""I11 不变量专项测试 — 多轮对话上下文保持 + push back 协议.

I11 不变量定义（参考 docs/features/F006-push-back-protocol.md + im_channels.yaml）：
- push back 协议：审查员对产出有质疑时，可触发 push back，要求 author 重新 Reflect
- 最多 3 轮 push back，3 轮后升级 operator 处理
- 多轮对话上下文必须被保持：forgekin 响应应能引用前一轮的对话内容

测试铁律遵守：
- T1: 不用 Mock LLM — 真实调用运行中的 flowforge web 服务 (127.0.0.1:8765)
- T2: 不用假数据 — 使用真实场景（doc/code/framework/test/review 五大闭环）
- T3: 不跳过验证 — 每个测试有具体断言（上下文标记、push back 轮次、升级状态）
- T4: 不 Mock 工具 — 真实 HTTP POST /api/chat /api/push_back /api/context
- T6: 必须采集指标 — 采集轮次、上下文深度、升级状态

运行前提：服务已启动 (python flowforge/web/app.py --host 127.0.0.1 --port 8765)
运行命令：pytest tests/test_i11_context_persistence.py -v -s
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest

BASE_URL = "http://127.0.0.1:8765"

# ── 真实场景数据（T2: 禁止假数据）──────────────────────────────────
# 模拟多轮对话：operator 逐步深入讨论文档闭环设计
MULTI_TURN_SCENARIO = [
    {
        "content": "请帮我编写 F046 文档闭环的 spec 文档，重点说明五步循环流程",
        "topic": "F046-doc-spec",
    },
    {
        "content": "补充说明 Discover 阶段的文档过期检测逻辑，max_age_days 参数如何配置",
        "topic": "F046-doc-spec",
    },
    {
        "content": "Verify 阶段需要检查 front-matter 和标题层级，请完善这部分验证规则",
        "topic": "F046-doc-spec",
    },
]

PUSH_BACK_SCENARIO = {
    "topic": "self_dev_code.py 重构方案审查",
    "forgekin_id": "fk-vangogh",  # 梵高是审查员
    "issues": [
        "plan() 方法缺少 I9 no-self-review 检查，author 与 reviewer 可能同厂商",
        "act() 方法未通过 Repository 层操作数据库，违反铁律 4",
        "verify() 方法的质量阈值硬编码为 0.9，应为 0.85（v4.0 调整）",
    ],
}


# ── T6: 指标采集器 ────────────────────────────────────────────────

@dataclass
class I11Metrics:
    """I11 不变量测试指标采集器（T6 必须采集指标）."""

    # 多轮上下文指标
    turns_executed: int = 0
    context_references_found: int = 0
    context_depth_per_turn: list[int] = field(default_factory=list)

    # push back 指标
    push_back_rounds: int = 0
    push_back_escalated: bool = False
    push_back_round_history: list[dict] = field(default_factory=list)

    # 延迟指标
    api_latencies_ms: list[float] = field(default_factory=list)

    def record_latency(self, latency_ms: float) -> None:
        self.api_latencies_ms.append(latency_ms)

    def summary(self) -> dict[str, Any]:
        return {
            "multi_turn": {
                "turns_executed": self.turns_executed,
                "context_references_found": self.context_references_found,
                "context_depth_per_turn": self.context_depth_per_turn,
            },
            "push_back": {
                "rounds": self.push_back_rounds,
                "escalated": self.push_back_escalated,
                "history": self.push_back_round_history,
            },
            "latency": {
                "count": len(self.api_latencies_ms),
                "avg_ms": round(sum(self.api_latencies_ms) / len(self.api_latencies_ms), 2)
                if self.api_latencies_ms else 0,
                "max_ms": round(max(self.api_latencies_ms), 2)
                if self.api_latencies_ms else 0,
            },
        }


@pytest.fixture
def metrics() -> I11Metrics:
    return I11Metrics()


@pytest.fixture
def http_client():
    """共享 HTTP 客户端，减少连接开销."""
    with httpx.Client(base_url=BASE_URL, timeout=60.0) as client:
        yield client


# ── 前置检查 ──────────────────────────────────────────────────────

def test_service_running_for_i11(http_client):
    """前置检查：服务必须运行，且支持 I11 新端点."""
    try:
        resp = http_client.get("/api/agents")
        assert resp.status_code == 200
        # 验证 /api/context 端点存在
        resp = http_client.get("/api/context")
        assert resp.status_code == 200
        data = resp.json()
        assert "push_back" in data
        assert "i11_invariant" in data
    except httpx.ConnectError as e:
        pytest.skip(
            f"服务未启动或未包含 I11 端点。"
            f"请运行: python flowforge/web/app.py --host 127.0.0.1 --port 8765。错误: {e}"
        )


# ── 1. 多轮对话上下文保持测试 ────────────────────────────────────

def test_i11_multi_turn_context_persistence(http_client, metrics):
    """测试 1: I11 多轮对话上下文保持.

    场景：operator 发送3轮消息讨论 F046 文档闭环设计.
    断言：
    - 每轮对话后 /api/context 返回的消息数递增
    - 第2轮和第3轮的 forgekin 响应包含 [上下文保持] 标记
    - 上下文深度（消息数）随轮次增加
    """
    initial_context = http_client.get("/api/context").json()
    initial_msg_count = initial_context["total_messages"]

    for i, turn in enumerate(MULTI_TURN_SCENARIO):
        start = time.monotonic()
        resp = http_client.post(
            "/api/chat",
            json={"content": turn["content"], "mentions": []},
        )
        metrics.record_latency((time.monotonic() - start) * 1000)
        assert resp.status_code == 200, f"turn {i+1}: HTTP {resp.status_code}"

        metrics.turns_executed += 1

        # 获取上下文
        ctx_resp = http_client.get("/api/context?limit=20")
        assert ctx_resp.status_code == 200
        ctx_data = ctx_resp.json()
        metrics.context_depth_per_turn.append(ctx_data["total_messages"])

        # 验证消息数递增
        assert ctx_data["total_messages"] > initial_msg_count + i, (
            f"turn {i+1}: 上下文消息数未递增 "
            f"(got {ctx_data['total_messages']}, expected > {initial_msg_count + i})"
        )

        # 第2轮起，验证 forgekin 响应包含上下文引用
        if i >= 1:
            forgekin_responses = resp.json().get("forgekin_responses", [])
            has_context_ref = False
            for fk_resp in forgekin_responses:
                if "[上下文保持]" in fk_resp.get("content", ""):
                    has_context_ref = True
                    break
            if has_context_ref:
                metrics.context_references_found += 1
            # 断言：至少1个 forgekin 响应包含上下文引用
            assert has_context_ref, (
                f"turn {i+1}: forgekin 响应未包含 [上下文保持] 标记，"
                f"上下文未被正确引用"
            )

    summary = metrics.summary()
    print("\n" + "=" * 60)
    print("测试 1: I11 多轮对话上下文保持 (3 turns)")
    print("=" * 60)
    print(f"  上下文引用找到: {summary['multi_turn']['context_references_found']}/2")
    print(f"  上下文深度变化: {summary['multi_turn']['context_depth_per_turn']}")
    print(f"  API 平均延迟: {summary['latency']['avg_ms']}ms")

    # 断言：3轮对话执行完成
    assert metrics.turns_executed == 3, "应执行3轮对话"
    # 断言：至少2轮包含上下文引用（第2轮和第3轮）
    assert metrics.context_references_found >= 2, (
        f"上下文引用数 {metrics.context_references_found} < 2"
    )
    # 断言：上下文深度递增
    assert len(metrics.context_depth_per_turn) == 3
    assert metrics.context_depth_per_turn[2] > metrics.context_depth_per_turn[0], (
        "上下文深度未随轮次递增"
    )


# ── 2. push back 最多 3 轮测试 ───────────────────────────────────

def test_i11_push_back_max_rounds(http_client, metrics):
    """测试 2: I11 push back 协议 — 最多 3 轮.

    场景：梵高对 self_dev_code.py 重构方案提出3轮质疑.
    断言：
    - 每次触发 push back，round 递增（1→2→3）
    - 第3轮后 escalated_to_operator = true
    - max_rounds 始终为 3
    """
    # 先重置 push back 状态
    http_client.post("/api/push_back/reset")

    scenario = PUSH_BACK_SCENARIO

    for i, issue in enumerate(scenario["issues"]):
        start = time.monotonic()
        resp = http_client.post(
            "/api/push_back",
            json={
                "topic": scenario["topic"],
                "forgekin_id": scenario["forgekin_id"],
                "issue": issue,
            },
        )
        metrics.record_latency((time.monotonic() - start) * 1000)
        assert resp.status_code == 200, f"push_back {i+1}: HTTP {resp.status_code}"

        data = resp.json()
        metrics.push_back_rounds = data["round"]
        metrics.push_back_round_history.append({
            "round": data["round"],
            "escalated": data["escalated_to_operator"],
            "topic": data["topic"],
        })

        # 断言：round 递增
        assert data["round"] == i + 1, (
            f"push_back {i+1}: round={data['round']}, expected {i+1}"
        )
        # 断言：max_rounds 始终为 3
        assert data["max_rounds"] == 3, (
            f"push_back {i+1}: max_rounds={data['max_rounds']}, expected 3"
        )

        # 第3轮应升级
        if i == 2:
            assert data["escalated_to_operator"] is True, (
                "push_back 第3轮应升级 operator"
            )
            metrics.push_back_escalated = True
        else:
            assert data["escalated_to_operator"] is False, (
                f"push_back 第{i+1}轮不应升级（未达3轮上限）"
            )

    summary = metrics.summary()
    print("\n" + "=" * 60)
    print("测试 2: I11 push back 最多 3 轮")
    print("=" * 60)
    print(f"  push back 轮次: {summary['push_back']['rounds']}")
    print(f"  已升级 operator: {summary['push_back']['escalated']}")
    print(f"  轮次历史: {summary['push_back']['history']}")

    # 断言
    assert metrics.push_back_rounds == 3, f"push back 应执行3轮, 实际 {metrics.push_back_rounds}"
    assert metrics.push_back_escalated is True, "第3轮应升级 operator"


# ── 3. push back 升级 operator 验证 ──────────────────────────────

def test_i11_push_back_escalation_message(http_client, metrics):
    """测试 3: I11 push back 第3轮响应包含升级标记.

    断言：
    - 第3轮 push back 的响应消息包含 "升级 operator" 标记
    - /api/context 返回的 push_back.escalated_to_operator = true
    - 消息 mentions 包含 "operator"
    """
    http_client.post("/api/push_back/reset")

    scenario = PUSH_BACK_SCENARIO
    topic = "escalation_test_" + str(int(time.time()))

    # 触发3轮 push back
    last_message = ""
    for i in range(3):
        resp = http_client.post(
            "/api/push_back",
            json={
                "topic": topic,
                "forgekin_id": "fk-vangogh",
                "issue": f"测试 issue {i+1}",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        last_message = data["message"]
        metrics.push_back_rounds = data["round"]
        if data["escalated_to_operator"]:
            metrics.push_back_escalated = True

    # 断言：响应消息包含升级标记
    assert "升级 operator" in last_message or "I11 升级" in last_message, (
        f"第3轮 push back 响应未包含升级标记: {last_message}"
    )

    # 验证 /api/context 返回升级状态
    ctx_resp = http_client.get("/api/context")
    assert ctx_resp.status_code == 200
    ctx_data = ctx_resp.json()
    assert ctx_data["push_back"]["escalated_to_operator"] is True, (
        "/api/context 未返回 escalated_to_operator=true"
    )
    assert ctx_data["i11_invariant"]["escalated"] is True, (
        "/api/context i11_invariant.escalated 未返回 true"
    )

    # 验证最后一条消息 mentions 包含 operator
    messages = ctx_data["messages"]
    escalation_msgs = [m for m in messages if "升级" in m.get("content", "")]
    assert len(escalation_msgs) >= 1, "未找到包含升级标记的消息"
    escalation_msg = escalation_msgs[-1]
    assert "operator" in escalation_msg.get("mentions", []), (
        f"升级消息的 mentions 未包含 operator: {escalation_msg.get('mentions')}"
    )

    print("\n" + "=" * 60)
    print("测试 3: I11 push back 升级 operator 验证")
    print("=" * 60)
    print(f"  升级消息: {last_message[:100]}...")
    print(f"  mentions: {escalation_msg.get('mentions')}")


# ── 4. push back 重置测试 ────────────────────────────────────────

def test_i11_push_back_reset(http_client, metrics):
    """测试 4: I11 push back 重置后状态归零.

    断言：
    - 重置后 current_round = 0
    - 重置后 escalated_to_operator = false
    - 重置后可重新触发 push back
    """
    # 先触发2轮 push back
    topic = "reset_test"
    for i in range(2):
        http_client.post("/api/push_back", json={
            "topic": topic,
            "forgekin_id": "fk-vangogh",
            "issue": f"issue {i+1}",
        })

    # 验证未升级
    ctx = http_client.get("/api/context").json()
    assert ctx["push_back"]["current_round"] == 2

    # 重置
    resp = http_client.post("/api/push_back/reset")
    assert resp.status_code == 200
    reset_data = resp.json()
    assert reset_data["reset"] is True

    # 验证状态归零
    ctx = http_client.get("/api/context").json()
    assert ctx["push_back"]["current_round"] == 0, "重置后 current_round 应为 0"
    assert ctx["push_back"]["escalated_to_operator"] is False, "重置后 escalated 应为 false"
    assert ctx["push_back"]["topic"] == "", "重置后 topic 应为空"

    # 验证可重新触发
    resp = http_client.post("/api/push_back", json={
        "topic": "new_topic_after_reset",
        "forgekin_id": "fk-vangogh",
        "issue": "new issue",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["round"] == 1, f"重置后重新触发应从 round=1 开始, 实际 {data['round']}"
    assert data["escalated_to_operator"] is False

    print("\n" + "=" * 60)
    print("测试 4: I11 push back 重置")
    print("=" * 60)
    print("  重置后状态归零 ✓")
    print("  可重新触发 push back ✓")


# ── 5. 新话题重置 push back 计数器 ───────────────────────────────

def test_i11_new_topic_resets_push_back(http_client, metrics):
    """测试 5: I11 新话题自动重置 push back 计数器.

    场景：topic A 触发2轮 push back，切换到 topic B 时应重置.
    断言：
    - topic A 触发2轮后 round=2
    - 切换到 topic B 后 round 重置为 1
    """
    http_client.post("/api/push_back/reset")

    # topic A: 触发2轮
    for i in range(2):
        resp = http_client.post("/api/push_back", json={
            "topic": "topic_A_code_review",
            "forgekin_id": "fk-vangogh",
            "issue": f"topic A issue {i+1}",
        })
        assert resp.status_code == 200

    ctx = http_client.get("/api/context").json()
    assert ctx["push_back"]["current_round"] == 2
    assert ctx["push_back"]["topic"] == "topic_A_code_review"

    # 切换到 topic B: 应重置为 round=1
    resp = http_client.post("/api/push_back", json={
        "topic": "topic_B_doc_spec",
        "forgekin_id": "fk-vangogh",
        "issue": "topic B issue 1",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["round"] == 1, (
        f"新话题应重置 round 为 1, 实际 {data['round']}"
    )
    assert data["escalated_to_operator"] is False, "新话题不应处于升级状态"

    ctx = http_client.get("/api/context").json()
    assert ctx["push_back"]["topic"] == "topic_B_doc_spec"
    assert ctx["push_back"]["current_round"] == 1

    print("\n" + "=" * 60)
    print("测试 5: I11 新话题重置 push back")
    print("=" * 60)
    print("  topic A: 2轮 → topic B: 重置为1轮 ✓")


# ── 6. 多轮对话后 push back 上下文完整性 ─────────────────────────

def test_i11_context_after_push_back(http_client, metrics):
    """测试 6: 多轮对话 + push back 后，上下文完整性验证.

    场景：先进行2轮对话，再触发1轮 push back，验证上下文包含所有消息.
    断言：
    - /api/context 返回的消息数 = 初始 + 对话消息 + push back 消息
    - 上下文中同时包含 operator 消息、forgekin 响应、push back 消息
    """
    http_client.post("/api/push_back/reset")

    # 获取初始消息数
    initial_count = http_client.get("/api/context").json()["total_messages"]

    # 2轮对话
    for i in range(2):
        http_client.post("/api/chat", json={
            "content": f"第{i+1}轮对话：讨论 F046 文档闭环的 Act 阶段实现",
            "mentions": [],
        })

    after_chat_count = http_client.get("/api/context").json()["total_messages"]
    # 每轮对话至少增加2条消息（operator + 至少1个forgekin响应）
    assert after_chat_count >= initial_count + 4, (
        f"2轮对话后消息数 {after_chat_count}，预期至少 {initial_count + 4}"
    )

    # 触发1轮 push back
    http_client.post("/api/push_back", json={
        "topic": "context_integrity_test",
        "forgekin_id": "fk-vangogh",
        "issue": "Act 阶段缺少 T7 LLM 审核步骤",
    })

    final_ctx = http_client.get("/api/context?limit=50").json()
    final_count = final_ctx["total_messages"]
    assert final_count > after_chat_count, "push back 后消息数应增加"

    # 验证上下文包含三种类型的消息
    messages = final_ctx["messages"]
    has_operator = any(m["author_role"] == "operator" for m in messages)
    has_forgekin = any(m["author_role"] == "forgekin" for m in messages)
    has_push_back = any("push back" in m.get("content", "") for m in messages)

    assert has_operator, "上下文中缺少 operator 消息"
    assert has_forgekin, "上下文中缺少 forgekin 响应"
    assert has_push_back, "上下文中缺少 push back 消息"

    print("\n" + "=" * 60)
    print("测试 6: I11 上下文完整性（对话+push back）")
    print("=" * 60)
    print(f"  初始消息数: {initial_count}")
    print(f"  对话后: {after_chat_count}")
    print(f"  push back 后: {final_count}")
    print(f"  包含 operator/forgekin/push_back: {has_operator}/{has_forgekin}/{has_push_back}")


# ── 7. 综合指标报告 ───────────────────────────────────────────────

def test_i11_metrics_summary(http_client, metrics):
    """测试 7: I11 综合指标报告（T6: 必须采集指标）.

    执行完整流程：多轮对话 → push back → 升级 → 重置，输出指标报告.
    """
    http_client.post("/api/push_back/reset")

    # 7.1 多轮对话（2轮）
    for i in range(2):
        start = time.monotonic()
        http_client.post("/api/chat", json={
            "content": f"综合测试第{i+1}轮：验证 I11 上下文保持和 push back 协议",
            "mentions": [],
        })
        metrics.record_latency((time.monotonic() - start) * 1000)
        metrics.turns_executed += 1

    # 7.2 push back 3轮（触发升级）
    for i in range(3):
        start = time.monotonic()
        resp = http_client.post("/api/push_back", json={
            "topic": "metrics_summary_test",
            "forgekin_id": "fk-vangogh",
            "issue": f"综合测试 push back 第{i+1}轮",
        })
        metrics.record_latency((time.monotonic() - start) * 1000)
        data = resp.json()
        metrics.push_back_rounds = data["round"]
        metrics.push_back_round_history.append({
            "round": data["round"],
            "escalated": data["escalated_to_operator"],
        })
        if data["escalated_to_operator"]:
            metrics.push_back_escalated = True

    # 7.3 验证升级状态
    ctx = http_client.get("/api/context").json()
    assert ctx["push_back"]["escalated_to_operator"] is True

    # 7.4 重置
    http_client.post("/api/push_back/reset")

    summary = metrics.summary()
    print("\n" + "=" * 72)
    print("I11 综合指标报告 (T6: 必须采集指标)")
    print("=" * 72)
    import json
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print("=" * 72)

    # 综合断言
    assert metrics.turns_executed == 2, "应执行2轮对话"
    assert metrics.push_back_rounds == 3, "应执行3轮 push back"
    assert metrics.push_back_escalated is True, "应触发升级"
    assert len(metrics.api_latencies_ms) >= 5, "应采集至少5次API延迟"
    assert summary["latency"]["avg_ms"] > 0, "平均延迟应大于0"

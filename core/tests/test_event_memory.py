"""EventMemoryStore 单元测试 — CL-029/030 P0 必修项验证.

测试 FlowForge v7.1-§D14 Event Memory 规范的核心铁律:
    - teleport(thread_id, message_id) 精确跳转
    - 多租户隔离（owner A 看不到 owner B 的事件）
    - no-classifier 红线（禁止 LLM 分类，分类由显式 trigger 字段决定）
    - resolution 链（事件因果链 A → B → C）
    - 趋势分析 + 过期清理

测试铁律遵守:
    - T1（禁止 Mock LLM）: 本测试为纯单元测试，不调用也不 Mock LLM.
      no-classifier 红线要求 EventMemoryStore 不依赖 LLM，测试验证这一点.
    - T2（禁止假数据）: 测试数据使用真实场景（ContentForge 内容创作 +
      NovelForge 小说创作），不使用 "test"/"hello" 等假数据.
    - T3（禁止跳过验证）: 所有断言具体明确.
    - T7（LLM 内容必须经 LLM 审核）: 本测试不涉及 LLM 生成内容，不适用.

详见:
    - flowforge/docs/design.md v7.1-§D14 Event Memory 规范
    - flowforge/docs/review/review.md 第十四章 CL-029/CL-030
    - hiclaw/rules.md 测试铁律 T1-T8
"""

from __future__ import annotations

import inspect
from datetime import datetime, timedelta, timezone

import pytest

from flowforge.core.event_memory import (
    EventMemoryStore,
    EventRecord,
    EventTrigger,
    EventType,
    ResolutionLink,
)


# ── 测试夹具：真实场景数据（ContentForge 内容创作 + NovelForge 小说创作）──


@pytest.fixture
def content_task_started_event() -> EventRecord:
    """ContentForge 用户请求创作技术文章的事件（真实场景数据）.

    场景: 用户 Alice 请求 ContentForge 创作一篇关于异步编程的技术文章，
    系统记录 task_started 事件，trigger 为 user_input.
    """
    return EventRecord(
        type=EventType.TASK_STARTED,
        trigger=EventTrigger.USER_INPUT,
        cat="content_creation",
        thread_id="thread-cf-async-article-001",
        message_id="msg-user-request-001",
        summary="用户 Alice 请求创作一篇关于 Python asyncio 的技术文章",
        cognitive_transition="E1→E2",
        related_harness="harness-contentforge-001",
        confidence=0.95,
        owner_user_id="user-alice",
    )


@pytest.fixture
def novel_outline_shift_event() -> EventRecord:
    """NovelForge 小说大纲认知变迁事件（真实场景数据）.

    场景: NovelForge 在为用户 Bob 创作玄幻小说时，从大纲阶段进入正文阶段，
    发生认知状态变迁 E2→E3，trigger 为 agent_action.
    """
    return EventRecord(
        type=EventType.COGNITIVE_SHIFT,
        trigger=EventTrigger.AGENT_ACTION,
        cat="novel_writing",
        thread_id="thread-nf-xuanhuan-outline-001",
        message_id="msg-outline-shift-001",
        summary="玄幻小说从大纲阶段进入正文撰写阶段，认知状态 E2→E3",
        cognitive_transition="E2→E3",
        related_harness="harness-novelforge-001",
        confidence=0.88,
        owner_user_id="user-bob",
    )


@pytest.fixture
def store() -> EventMemoryStore:
    """空的 EventMemoryStore 实例（纯内存模式）."""
    return EventMemoryStore()


# ──────────────────────────────────────────────────────────────────────────────
# 用例 1：record 后能按 ID 查询
# ──────────────────────────────────────────────────────────────────────────────


async def test_record_and_get(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """记录事件后，能通过返回的 event_id 查询到完整记录."""
    event_id = await store.record(content_task_started_event)

    # event_id 必须是非空 UUID hex（32 字符）
    assert isinstance(event_id, str)
    assert len(event_id) == 32, f"event_id 应为 UUID hex（32 字符），实际: {len(event_id)}"

    stored = await store.get(event_id)
    assert stored is not None, "记录后应能按 ID 查询到"
    # 字段完整保留
    assert stored.type == EventType.TASK_STARTED
    assert stored.trigger == EventTrigger.USER_INPUT
    assert stored.cat == "content_creation"
    assert stored.thread_id == "thread-cf-async-article-001"
    assert stored.message_id == "msg-user-request-001"
    assert stored.summary == "用户 Alice 请求创作一篇关于 Python asyncio 的技术文章"
    assert stored.cognitive_transition == "E1→E2"
    assert stored.related_harness == "harness-contentforge-001"
    assert stored.confidence == 0.95
    assert stored.owner_user_id == "user-alice"
    # event_id 已被 store 自动填充
    assert stored.event_id == event_id


async def test_get_nonexistent_returns_none(store: EventMemoryStore) -> None:
    """查询不存在的 event_id 应返回 None（具体断言，不跳过验证）."""
    result = await store.get("nonexistent-id-0000000000000000000000000000")
    assert result is None, "不存在的 event_id 应返回 None"


# ──────────────────────────────────────────────────────────────────────────────
# 用例 2：teleport 精确跳转（threadId + messageId 二元组）
# ──────────────────────────────────────────────────────────────────────────────


async def test_teleport_by_thread_message(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
    novel_outline_shift_event: EventRecord,
) -> None:
    """teleport 通过 thread_id + message_id 精确定位事件（跨 thread 上下文恢复）."""
    await store.record(content_task_started_event)
    await store.record(novel_outline_shift_event)

    # 精确跳转到 ContentForge 线程的事件
    cf_event = await store.teleport(
        thread_id="thread-cf-async-article-001",
        message_id="msg-user-request-001",
    )
    assert cf_event is not None
    assert cf_event.cat == "content_creation"
    assert cf_event.owner_user_id == "user-alice"

    # 精确跳转到 NovelForge 线程的事件
    nf_event = await store.teleport(
        thread_id="thread-nf-xuanhuan-outline-001",
        message_id="msg-outline-shift-001",
    )
    assert nf_event is not None
    assert nf_event.cat == "novel_writing"
    assert nf_event.cognitive_transition == "E2→E3"

    # thread_id 正确但 message_id 错误 → 应返回 None（精确匹配）
    miss = await store.teleport(
        thread_id="thread-cf-async-article-001",
        message_id="msg-wrong-message-id",
    )
    assert miss is None, "teleport 必须精确匹配 thread_id + message_id 二元组"

    # message_id 正确但 thread_id 错误 → 应返回 None
    miss2 = await store.teleport(
        thread_id="thread-wrong-thread",
        message_id="msg-user-request-001",
    )
    assert miss2 is None, "teleport 不允许跨 thread 误匹配"


# ──────────────────────────────────────────────────────────────────────────────
# 用例 3：按线程查询
# ──────────────────────────────────────────────────────────────────────────────


async def test_list_by_thread(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """list_by_thread 返回该线程下所有事件，按时间戳升序."""
    # 同一线程下记录 3 个事件（时间递增）
    e1 = content_task_started_event.model_copy()
    e1.timestamp = datetime(2026, 7, 18, 9, 0, tzinfo=timezone.utc)
    e1.message_id = "msg-001"

    e2 = content_task_started_event.model_copy()
    e2.timestamp = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)
    e2.message_id = "msg-002"
    e2.type = EventType.TASK_COMPLETED
    e2.summary = "技术文章创作完成"

    e3 = content_task_started_event.model_copy()
    e3.timestamp = datetime(2026, 7, 18, 11, 0, tzinfo=timezone.utc)
    e3.message_id = "msg-003"
    e3.type = EventType.ERROR_OCCURRED
    e3.summary = "发布阶段发生错误"

    await store.record(e1)
    await store.record(e2)
    await store.record(e3)

    # 另一线程的事件不应出现
    other_thread = EventRecord(
        type=EventType.TASK_STARTED,
        trigger=EventTrigger.SYSTEM_EVENT,
        cat="devops",
        thread_id="thread-df-refactor-001",
        message_id="msg-other-001",
        summary="DevForge 代码重构任务启动",
        owner_user_id="user-carol",
    )
    await store.record(other_thread)

    results = await store.list_by_thread("thread-cf-async-article-001")
    assert len(results) == 3, "应只返回该线程的 3 个事件"
    # 验证按时间戳升序
    assert results[0].timestamp < results[1].timestamp < results[2].timestamp
    assert results[0].message_id == "msg-001"
    assert results[1].message_id == "msg-002"
    assert results[2].message_id == "msg-003"
    # 不应包含其他线程的事件
    assert all(r.thread_id == "thread-cf-async-article-001" for r in results)


async def test_list_by_thread_limit(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """list_by_thread 的 limit 参数生效."""
    for i in range(5):
        e = content_task_started_event.model_copy()
        e.timestamp = datetime(2026, 7, 18, 9 + i, 0, tzinfo=timezone.utc)
        e.message_id = f"msg-limit-{i:03d}"
        await store.record(e)

    results = await store.list_by_thread(
        "thread-cf-async-article-001", limit=3
    )
    assert len(results) == 3, "limit=3 应只返回 3 条"
    # 应返回最早的 3 条（按时间升序）
    assert results[0].message_id == "msg-limit-000"
    assert results[2].message_id == "msg-limit-002"


# ──────────────────────────────────────────────────────────────────────────────
# 用例 4：多租户隔离（owner A 看不到 owner B 的事件）
# ──────────────────────────────────────────────────────────────────────────────


async def test_list_by_owner_multitenant(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
    novel_outline_shift_event: EventRecord,
) -> None:
    """多租户隔离: owner A 查询时看不到 owner B 的事件."""
    # Alice 的事件（ContentForge 内容创作）
    await store.record(content_task_started_event)
    # Bob 的事件（NovelForge 小说创作）
    await store.record(novel_outline_shift_event)
    # Carol 的事件（DevForge 开发）
    carol_event = EventRecord(
        type=EventType.SCOPE_DIVERGENCE,
        trigger=EventTrigger.AGENT_ACTION,
        cat="code_refactor",
        thread_id="thread-df-refactor-001",
        message_id="msg-scope-div-001",
        summary="DevForge 重构任务检测到范围发散，超出原始 scope",
        cognitive_transition="scope_guard→knowledge_evolution",
        related_harness="harness-devforge-001",
        confidence=0.72,
        owner_user_id="user-carol",
    )
    await store.record(carol_event)

    # Alice 只能看到自己的 1 个事件
    alice_events = await store.list_by_owner("user-alice")
    assert len(alice_events) == 1, "Alice 应只看到自己的 1 个事件"
    assert alice_events[0].owner_user_id == "user-alice"
    assert alice_events[0].cat == "content_creation"

    # Bob 只能看到自己的 1 个事件
    bob_events = await store.list_by_owner("user-bob")
    assert len(bob_events) == 1, "Bob 应只看到自己的 1 个事件"
    assert bob_events[0].owner_user_id == "user-bob"
    assert bob_events[0].cat == "novel_writing"

    # Carol 只能看到自己的 1 个事件
    carol_events = await store.list_by_owner("user-carol")
    assert len(carol_events) == 1, "Carol 应只看到自己的 1 个事件"
    assert carol_events[0].owner_user_id == "user-carol"
    assert carol_events[0].type == EventType.SCOPE_DIVERGENCE

    # 关键隔离断言: Alice 看不到 Bob 和 Carol 的事件
    alice_cats = {e.cat for e in alice_events}
    assert "novel_writing" not in alice_cats, "Alice 不应看到 Bob 的小说创作事件"
    assert "code_refactor" not in alice_cats, "Alice 不应看到 Carol 的开发事件"


# ──────────────────────────────────────────────────────────────────────────────
# 用例 5：按类型 + 时间过滤
# ──────────────────────────────────────────────────────────────────────────────


async def test_list_by_type_with_time_filter(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """list_by_type 按 EventType 过滤，并可叠加 since 时间过滤."""
    base_time = datetime(2026, 7, 18, 9, 0, tzinfo=timezone.utc)

    # 记录 3 个 TASK_STARTED 事件（时间不同）+ 1 个 ERROR_OCCURRED 事件
    e_old = content_task_started_event.model_copy()
    e_old.timestamp = base_time - timedelta(hours=48)
    e_old.message_id = "msg-old-task"
    await store.record(e_old)

    e_mid = content_task_started_event.model_copy()
    e_mid.timestamp = base_time - timedelta(hours=12)
    e_mid.message_id = "msg-mid-task"
    await store.record(e_mid)

    e_recent = content_task_started_event.model_copy()
    e_recent.timestamp = base_time
    e_recent.message_id = "msg-recent-task"
    await store.record(e_recent)

    error_event = EventRecord(
        type=EventType.ERROR_OCCURRED,
        trigger=EventTrigger.SYSTEM_EVENT,
        cat="content_creation",
        thread_id="thread-cf-async-article-001",
        message_id="msg-error-001",
        summary="发布工具调用失败，重试中",
        timestamp=base_time,
        owner_user_id="user-alice",
    )
    await store.record(error_event)

    # 不带时间过滤: 应返回所有 3 个 TASK_STARTED（不含 ERROR_OCCURRED）
    all_started = await store.list_by_type(EventType.TASK_STARTED)
    assert len(all_started) == 3
    assert all(e.type == EventType.TASK_STARTED for e in all_started)
    # 按时间升序
    assert all_started[0].message_id == "msg-old-task"
    assert all_started[2].message_id == "msg-recent-task"

    # 带 since 过滤: 只返回 base_time - 24h 之后的事件（mid + recent）
    since = base_time - timedelta(hours=24)
    recent_started = await store.list_by_type(EventType.TASK_STARTED, since=since)
    assert len(recent_started) == 2, "since 过滤后应只剩 2 个 TASK_STARTED"
    assert recent_started[0].message_id == "msg-mid-task"
    assert recent_started[1].message_id == "msg-recent-task"
    # 旧事件不应出现
    assert all(e.timestamp >= since for e in recent_started)

    # ERROR_OCCURRED 类型应独立查询
    errors = await store.list_by_type(EventType.ERROR_OCCURRED)
    assert len(errors) == 1
    assert errors[0].message_id == "msg-error-001"


# ──────────────────────────────────────────────────────────────────────────────
# 用例 6：因果链（A → B → C，查 C 的链返回 [A, B, C]）
# ──────────────────────────────────────────────────────────────────────────────


async def test_resolution_chain(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """因果链: A causes B, B causes C → get_resolution_chain(C) 返回 [A, B, C]."""
    # 事件 A: 任务启动
    event_a = content_task_started_event.model_copy()
    event_a.message_id = "msg-a-task-started"
    event_a.timestamp = datetime(2026, 7, 18, 9, 0, tzinfo=timezone.utc)
    event_a.summary = "用户请求创作技术文章，任务启动"
    id_a = await store.record(event_a)

    # 事件 B: 认知变迁（A 导致 B）
    event_b = content_task_started_event.model_copy()
    event_b.message_id = "msg-b-cognitive-shift"
    event_b.timestamp = datetime(2026, 7, 18, 10, 0, tzinfo=timezone.utc)
    event_b.type = EventType.COGNITIVE_SHIFT
    event_b.summary = "从需求理解进入素材搜集，认知 E1→E2"
    event_b.cognitive_transition = "E1→E2"
    id_b = await store.record(event_b)

    # 事件 C: 范围发散（B 导致 C）
    event_c = content_task_started_event.model_copy()
    event_c.message_id = "msg-c-scope-divergence"
    event_c.timestamp = datetime(2026, 7, 18, 11, 0, tzinfo=timezone.utc)
    event_c.type = EventType.SCOPE_DIVERGENCE
    event_c.summary = "素材搜集超出原始 scope，检测到范围发散"
    event_c.cognitive_transition = "E2→scope_guard"
    id_c = await store.record(event_c)

    # 建立因果链: A → B → C
    link_ab = await store.add_resolution_link(
        from_id=id_a, to_id=id_b, link_type="causes", confidence=0.9
    )
    link_bc = await store.add_resolution_link(
        from_id=id_b, to_id=id_c, link_type="causes", confidence=0.85
    )

    # 验证 ResolutionLink 字段
    assert isinstance(link_ab, ResolutionLink)
    assert link_ab.from_event_id == id_a
    assert link_ab.to_event_id == id_b
    assert link_ab.link_type == "causes"
    assert link_ab.confidence == 0.9
    assert len(link_ab.link_id) == 32, "link_id 应为 UUID hex"

    # 查询 C 的因果链 → 应返回 [A, B, C]
    chain = await store.get_resolution_chain(id_c)
    assert len(chain) == 3, "因果链应包含 3 个事件"
    # 按因果顺序: A 在前，C 在后
    assert chain[0].event_id == id_a
    assert chain[1].event_id == id_b
    assert chain[2].event_id == id_c
    # 验证事件类型按因果链递进
    assert chain[0].type == EventType.TASK_STARTED
    assert chain[1].type == EventType.COGNITIVE_SHIFT
    assert chain[2].type == EventType.SCOPE_DIVERGENCE

    # 查询 B 的因果链 → 应返回 [A, B]
    chain_b = await store.get_resolution_chain(id_b)
    assert len(chain_b) == 2
    assert chain_b[0].event_id == id_a
    assert chain_b[1].event_id == id_b

    # 查询 A 的因果链 → 应返回 [A]（A 没有祖先）
    chain_a = await store.get_resolution_chain(id_a)
    assert len(chain_a) == 1
    assert chain_a[0].event_id == id_a

    # 不存在的 event_id → 返回空列表
    empty_chain = await store.get_resolution_chain("nonexistent-id")
    assert empty_chain == []


async def test_add_resolution_link_missing_event(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """add_resolution_link 对不存在的事件应抛出 KeyError."""
    real_id = await store.record(content_task_started_event)

    with pytest.raises(KeyError, match="from_event not found"):
        await store.add_resolution_link(
            from_id="nonexistent-from-id",
            to_id=real_id,
        )

    with pytest.raises(KeyError, match="to_event not found"):
        await store.add_resolution_link(
            from_id=real_id,
            to_id="nonexistent-to-id",
        )


# ──────────────────────────────────────────────────────────────────────────────
# 用例 7：趋势分析返回正确聚合
# ──────────────────────────────────────────────────────────────────────────────


async def test_analyze_trend(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
    novel_outline_shift_event: EventRecord,
) -> None:
    """analyze_trend 按 type/trigger/cat 聚合统计."""
    now = datetime.now(timezone.utc)

    # 窗口内事件：e1/e2 在 24h 窗口内但超出 1h 窗口；e3 在两个窗口内
    e1 = content_task_started_event.model_copy()
    e1.timestamp = now - timedelta(hours=2)
    e1.message_id = "msg-trend-001"
    await store.record(e1)

    e2 = content_task_started_event.model_copy()
    e2.timestamp = now - timedelta(minutes=90)
    e2.message_id = "msg-trend-002"
    e2.type = EventType.TASK_COMPLETED
    e2.trigger = EventTrigger.AGENT_ACTION
    await store.record(e2)

    e3 = novel_outline_shift_event.model_copy()
    e3.timestamp = now - timedelta(minutes=10)
    e3.message_id = "msg-trend-003"
    await store.record(e3)

    # 窗口外事件（48 小时前，不在 24h 窗口内）
    e_old = content_task_started_event.model_copy()
    e_old.timestamp = now - timedelta(hours=48)
    e_old.message_id = "msg-trend-old"
    await store.record(e_old)

    # 添加一个 resolution link 验证计数（e1 causes e2）
    e1_stored = await store.teleport(
        "thread-cf-async-article-001", "msg-trend-001"
    )
    e2_stored = await store.teleport(
        "thread-cf-async-article-001", "msg-trend-002"
    )
    assert e1_stored is not None and e2_stored is not None
    await store.add_resolution_link(
        from_id=e1_stored.event_id,
        to_id=e2_stored.event_id,
    )

    trend = await store.analyze_trend(window_hours=24)

    # 基本字段
    assert trend["window_hours"] == 24
    assert "window_start" in trend
    assert "window_end" in trend
    # 窗口内应有 3 个事件（e_old 在窗口外）
    assert trend["total"] == 3, f"窗口内应有 3 个事件，实际: {trend['total']}"

    # 按 type 聚合: e1=task_started, e2=task_completed, e3=cognitive_shift
    assert trend["by_type"].get("task_started", 0) == 1
    assert trend["by_type"].get("task_completed", 0) == 1
    assert trend["by_type"].get("cognitive_shift", 0) == 1

    # 按 trigger 聚合: e1=user_input, e2=agent_action, e3=agent_action
    assert trend["by_trigger"].get("user_input", 0) == 1
    assert trend["by_trigger"].get("agent_action", 0) == 2

    # 按 cat 聚合: e1/e2=content_creation, e3=novel_writing
    assert trend["by_cat"].get("content_creation", 0) == 2
    assert trend["by_cat"].get("novel_writing", 0) == 1

    # resolution chain 链接计数
    assert trend["resolution_chain_count"] == 1, "应有 1 个 resolution link"

    # 缩小窗口到 1 小时: 只剩 e3（10 分钟前），e1/e2 已在 1h 窗口外
    narrow = await store.analyze_trend(window_hours=1)
    assert narrow["total"] == 1, "1 小时窗口内应只剩最近 1 个事件"
    assert narrow["by_type"].get("cognitive_shift", 0) == 1


# ──────────────────────────────────────────────────────────────────────────────
# 用例 8：清理过期事件
# ──────────────────────────────────────────────────────────────────────────────


async def test_purge_expired(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """purge_expired 按 timestamp 清理过期事件，并联动清理 links 和 teleport 索引."""
    now = datetime.now(timezone.utc)

    # 过期事件（35 天前）
    e_expired = content_task_started_event.model_copy()
    e_expired.timestamp = now - timedelta(days=35)
    e_expired.message_id = "msg-expired-001"
    e_expired.summary = "35 天前的旧任务事件"
    id_expired = await store.record(e_expired)

    # 另一个过期事件（40 天前）
    e_expired2 = content_task_started_event.model_copy()
    e_expired2.timestamp = now - timedelta(days=40)
    e_expired2.message_id = "msg-expired-002"
    e_expired2.summary = "40 天前的旧任务事件"
    id_expired2 = await store.record(e_expired2)

    # 未过期事件（5 天前）
    e_fresh = content_task_started_event.model_copy()
    e_fresh.timestamp = now - timedelta(days=5)
    e_fresh.message_id = "msg-fresh-001"
    e_fresh.summary = "5 天前的事件，仍在保留期"
    id_fresh = await store.record(e_fresh)

    # 在过期事件之间建立 resolution link（验证联动清理）
    await store.add_resolution_link(
        from_id=id_expired, to_id=id_expired2, link_type="causes"
    )

    # 执行清理（max_age_days=30）
    purged_count = await store.purge_expired(max_age_days=30)
    assert purged_count == 2, f"应清理 2 个过期事件，实际: {purged_count}"

    # 过期事件应已删除
    assert await store.get(id_expired) is None
    assert await store.get(id_expired2) is None
    # 未过期事件应保留
    fresh = await store.get(id_fresh)
    assert fresh is not None, "未过期事件应保留"
    assert fresh.message_id == "msg-fresh-001"

    # teleport 索引应联动清理
    teleport_expired = await store.teleport(
        "thread-cf-async-article-001", "msg-expired-001"
    )
    assert teleport_expired is None, "过期事件的 teleport 索引应已清理"
    teleport_fresh = await store.teleport(
        "thread-cf-async-article-001", "msg-fresh-001"
    )
    assert teleport_fresh is not None, "未过期事件的 teleport 索引应保留"

    # resolution links 应联动清理（涉及过期事件的 link 被删除）
    trend = await store.analyze_trend(window_hours=24 * 60)  # 大窗口覆盖所有
    assert (
        trend["resolution_chain_count"] == 0
    ), "涉及过期事件的 resolution link 应已联动清理"

    # 再次清理应返回 0（无过期事件）
    second_purge = await store.purge_expired(max_age_days=30)
    assert second_purge == 0, "无过期事件时清理应返回 0"


# ──────────────────────────────────────────────────────────────────────────────
# 用例 9：no-classifier 红线（record 不调用 LLM）
# ──────────────────────────────────────────────────────────────────────────────


async def test_no_classifier_red_line(
    store: EventMemoryStore,
    content_task_started_event: EventRecord,
) -> None:
    """no-classifier 红线: EventMemoryStore 不依赖 LLM 做事件分类.

    验证三个层面:
        1. 模块源码不导入任何 LLM 客户端（静态检查）.
        2. EventMemoryStore.__init__ 不接受 LLM / classifier 参数（静态检查）.
        3. record() 后 type/trigger/cat 字段原样保留，未经 LLM 重新分类（行为验证）.
    """
    from flowforge.core import event_memory as event_memory_module

    # ── 1. 静态检查: 模块源码不应包含 LLM 客户端依赖 ──
    module_src = inspect.getsource(event_memory_module)
    forbidden_patterns = [
        "import openai",
        "from openai",
        "import anthropic",
        "from anthropic",
        "LLMClient",
        "llm_client",
        "classify_with_llm",
        "langchain",
        "langgraph",
    ]
    for pattern in forbidden_patterns:
        assert pattern not in module_src, (
            f"no-classifier 红线违反: event_memory 模块禁止依赖 LLM "
            f"（源码中发现 '{pattern}'）"
        )

    # ── 2. 静态检查: __init__ 不接受 LLM / classifier 参数 ──
    sig = inspect.signature(EventMemoryStore.__init__)
    for param_name in sig.parameters:
        if param_name == "self":
            continue
        lower_name = param_name.lower()
        assert "llm" not in lower_name, (
            f"no-classifier 红线: EventMemoryStore.__init__ 不应接受 LLM 参数 "
            f"（发现 '{param_name}'）"
        )
        assert "classifier" not in lower_name, (
            f"no-classifier 红线: EventMemoryStore.__init__ 不应接受 classifier 参数 "
            f"（发现 '{param_name}'）"
        )

    # ── 3. 行为验证: record 后字段原样保留，未经 LLM 重新分类 ──
    original_type = content_task_started_event.type
    original_trigger = content_task_started_event.trigger
    original_cat = content_task_started_event.cat
    original_transition = content_task_started_event.cognitive_transition
    original_confidence = content_task_started_event.confidence

    event_id = await store.record(content_task_started_event)
    stored = await store.get(event_id)

    assert stored is not None
    # type/trigger 必须是原样枚举值，未被任何 LLM 重新分类
    assert stored.type == original_type, "type 字段不应被 LLM 重新分类"
    assert stored.trigger == original_trigger, "trigger 字段不应被 LLM 重新分类"
    # cat 必须是原样字符串
    assert stored.cat == original_cat, "cat 字段不应被 LLM 重新分类"
    # cognitive_transition 必须原样保留
    assert stored.cognitive_transition == original_transition
    # confidence 必须原样保留（不被 LLM 覆盖）
    assert stored.confidence == original_confidence

"""ScheduleFactoryRegistry 单元测试（CL-023 P0 必修）.

测试 F202 Phase 2 ScheduleFactoryRegistry 的四大核心能力:
    1. plugin-owned factory 边界
    2. deterministic runtime task id
    3. cross-plugin ownership collision 检测
    4. Schedule Factory Whitelist

测试铁律遵守（project_rules.md T1-T8）:
    - T1: 禁止使用 Mock LLM —— 本模块不涉及 LLM（单元测试，T1 适用于
      E2E/集成测试，此处不适用）
    - T2: 禁止使用假数据 —— 测试输入使用真实场景（contentforge 内容创作
      定时发布 / devforge 代码审查定时调度），不使用 "test"/"hello" 等
    - T3: 禁止跳过验证 —— 每个用例都有具体断言
    - T4: 禁止 Mock 工具 —— 本测试不调用外部工具
    - T5: 未实现即 Bug —— 本测试覆盖所有声明的功能
    - T6: E2E 测试需采集指标 —— 本测试为单元测试，不适用
    - T7: LLM 内容审核 —— 本测试不涉及 LLM 内容
    - T8: Web 功能 DOM 验证 —— 本测试不涉及 Web

AC 完整对齐:
    - AC-F1: Plugin 声明 ScheduleFactory 后，host 启动期加载并验证
    - AC-F2: 同名 factory 冲突时，启动失败并报告冲突 Plugin
    - AC-F3: runtime task id 格式：``{plugin_id}:{factory_id}:{seq:08d}``，确定性
    - AC-F4: 未在白名单中的 factory 调用被拒绝（raises PermissionError）
    - AC-F5: factory 注册信息含（plugin_id / factory_id / schedule_type /
      cron_expr_or_interval / max_concurrent / owner_user_id）

详见:
    - [doc:design.md#§D5.5] ScheduleFactoryRegistry 规范
    - [doc:review/review.md#14] CL-023
    - [doc:rules.md] 测试铁律 T1-T8
"""

from __future__ import annotations

import pytest

from flowforge.core.schedule_registry import (
    FactoryRegistration,
    RuntimeTaskId,
    ScheduleFactoryRegistry,
    ScheduleType,
)


# ── 测试数据：真实场景白名单 YAML（contentforge / devforge）─────────────────
# 铁律 T2：使用真实场景数据，非 "test"/"hello" 等假数据
WHITELIST_YAML_CONTENT = """\
factories:
  - plugin_id: contentforge
    factory_id: topic_scheduler
    schedule_type: cron
    cron_expr: "0 9 * * *"
    max_concurrent: 3
    owner_user_id: operator_001
  - plugin_id: devforge
    factory_id: code_review_scheduler
    schedule_type: interval
    interval_seconds: 3600
    max_concurrent: 5
    owner_user_id: operator_001
"""


# ── 测试夹具 ──────────────────────────────────────────────────


@pytest.fixture
def whitelist_yaml_path(tmp_path):
    """创建临时白名单 YAML 文件（真实场景数据）.

    使用 contentforge（内容创作定时发布）和 devforge（代码审查定时调度）
    两个真实场景的 factory 声明。
    """
    yaml_file = tmp_path / "schedule_factories_test.yaml"
    yaml_file.write_text(WHITELIST_YAML_CONTENT, encoding="utf-8")
    return yaml_file


@pytest.fixture
def registry():
    """空 ScheduleFactoryRegistry 实例。"""
    return ScheduleFactoryRegistry()


@pytest.fixture
async def loaded_registry(registry, whitelist_yaml_path):
    """已加载白名单的 ScheduleFactoryRegistry 实例。"""
    await registry.load_whitelist(whitelist_yaml_path)
    return registry


def _make_contentforge_topic_registration() -> FactoryRegistration:
    """构造 contentforge:topic_scheduler 注册信息（真实场景）."""
    return FactoryRegistration(
        plugin_id="contentforge",
        factory_id="topic_scheduler",
        schedule_type=ScheduleType.CRON,
        cron_expr="0 9 * * *",
        max_concurrent=3,
        owner_user_id="operator_001",
    )


def _make_devforge_code_review_registration() -> FactoryRegistration:
    """构造 devforge:code_review_scheduler 注册信息（真实场景）."""
    return FactoryRegistration(
        plugin_id="devforge",
        factory_id="code_review_scheduler",
        schedule_type=ScheduleType.INTERVAL,
        interval_seconds=3600,
        max_concurrent=5,
        owner_user_id="operator_001",
    )


# ── AC-F1: Plugin 声明 ScheduleFactory 后，host 启动期加载并验证 ──────────────


async def test_load_whitelist_from_yaml(registry, whitelist_yaml_path):
    """AC-F1：从 YAML 加载白名单。

    验证:
        - load_whitelist 返回加载数量
        - 加载后 list_factories 仍为空（白名单 ≠ 已注册）
    """
    count = await registry.load_whitelist(whitelist_yaml_path)
    assert count == 2, "应加载 2 个 factory（topic_scheduler + code_review_scheduler）"
    # 加载白名单不应自动注册 factory
    factories = await registry.list_factories()
    assert factories == [], "加载白名单不应注册 factory（白名单 ≠ 已注册）"


async def test_load_whitelist_file_not_found(registry, tmp_path):
    """AC-F1：白名单文件不存在时 raises FileNotFoundError。"""
    nonexistent = tmp_path / "nonexistent.yaml"
    with pytest.raises(FileNotFoundError, match="白名单文件不存在"):
        await registry.load_whitelist(nonexistent)


async def test_load_whitelist_empty_yaml(registry, tmp_path):
    """AC-F1：空 YAML 文件加载返回 0。"""
    empty_yaml = tmp_path / "empty.yaml"
    empty_yaml.write_text("", encoding="utf-8")
    count = await registry.load_whitelist(empty_yaml)
    assert count == 0


# ── AC-F1 / AC-F5: 成功注册白名单内 factory ─────────────────────────────────


async def test_register_factory_success(loaded_registry):
    """AC-F1 / AC-F5：成功注册白名单内 factory。

    验证 AC-F5 字段契约: plugin_id / factory_id / schedule_type /
    cron_expr / max_concurrent / owner_user_id 全部正确存储。
    """
    registration = _make_contentforge_topic_registration()
    await loaded_registry.register(registration)

    # 验证注册成功（AC-F5 字段契约）
    fetched = await loaded_registry.get_factory(
        "contentforge", "topic_scheduler"
    )
    assert fetched is not None, "注册后应能查询到 factory"
    assert fetched.plugin_id == "contentforge"
    assert fetched.factory_id == "topic_scheduler"
    assert fetched.schedule_type == ScheduleType.CRON
    assert fetched.cron_expr == "0 9 * * *"
    assert fetched.max_concurrent == 3
    assert fetched.owner_user_id == "operator_001"


async def test_register_interval_factory_success(loaded_registry):
    """AC-F1 / AC-F5：成功注册 interval 类型 factory（devforge 真实场景）."""
    registration = _make_devforge_code_review_registration()
    await loaded_registry.register(registration)

    fetched = await loaded_registry.get_factory(
        "devforge", "code_review_scheduler"
    )
    assert fetched is not None
    assert fetched.schedule_type == ScheduleType.INTERVAL
    assert fetched.interval_seconds == 3600
    assert fetched.max_concurrent == 5


async def test_register_factory_list_filter_by_plugin(loaded_registry):
    """AC-F1：list_factories 支持按 plugin_id 过滤。"""
    await loaded_registry.register(_make_contentforge_topic_registration())
    await loaded_registry.register(_make_devforge_code_review_registration())

    all_factories = await loaded_registry.list_factories()
    assert len(all_factories) == 2

    contentforge_only = await loaded_registry.list_factories(
        plugin_id="contentforge"
    )
    assert len(contentforge_only) == 1
    assert contentforge_only[0].plugin_id == "contentforge"

    devforge_only = await loaded_registry.list_factories(
        plugin_id="devforge"
    )
    assert len(devforge_only) == 1
    assert devforge_only[0].plugin_id == "devforge"

    # 不存在的 plugin 返回空列表
    empty = await loaded_registry.list_factories(plugin_id="novelforge")
    assert empty == []


# ── AC-F4: 未在白名单中的 factory 调用被拒绝 ────────────────────────────────


async def test_register_factory_not_in_whitelist_rejected(loaded_registry):
    """AC-F4：未在白名单中的 factory 注册被拒绝（PermissionError）.

    场景：novelforge 试图注册 chapter_scheduler，但白名单中未声明此
    factory_id。应 raises PermissionError。
    """
    registration = FactoryRegistration(
        plugin_id="novelforge",
        factory_id="chapter_scheduler",  # 不在白名单中
        schedule_type=ScheduleType.CRON,
        cron_expr="0 10 * * *",
        max_concurrent=2,
        owner_user_id="operator_001",
    )
    with pytest.raises(PermissionError, match="白名单"):
        await loaded_registry.register(registration)

    # 验证未注册成功
    fetched = await loaded_registry.get_factory(
        "novelforge", "chapter_scheduler"
    )
    assert fetched is None, "被拒绝的 factory 不应被注册"


async def test_register_without_whitelist_loaded_rejected(registry):
    """AC-F4：未加载白名单时，所有 factory 注册都被拒绝。

    场景：未调用 load_whitelist，直接尝试注册。白名单为空，
    任何 factory_id 都不在白名单中，应 raises PermissionError。
    """
    registration = _make_contentforge_topic_registration()
    with pytest.raises(PermissionError, match="白名单"):
        await registry.register(registration)


# ── AC-F2: 同名 factory 冲突检测 ────────────────────────────────────────────


async def test_register_factory_collision_detected(loaded_registry):
    """AC-F2：跨 plugin 同名 factory 冲突检测。

    场景：contentforge 先注册 topic_scheduler 成功；
    devforge 试图注册同名 topic_scheduler，应 raises ValueError（冲突）。
    """
    # 1. contentforge 注册 topic_scheduler（成功）
    await loaded_registry.register(_make_contentforge_topic_registration())

    # 2. devforge 试图注册同名 topic_scheduler（冲突）
    collision_registration = FactoryRegistration(
        plugin_id="devforge",  # 不同 plugin
        factory_id="topic_scheduler",  # 同名 factory
        schedule_type=ScheduleType.INTERVAL,
        interval_seconds=1800,
        max_concurrent=2,
        owner_user_id="operator_001",
    )
    with pytest.raises(ValueError, match="跨 plugin ownership 冲突"):
        await loaded_registry.register(collision_registration)

    # 验证 devforge 未注册成功
    fetched = await loaded_registry.get_factory(
        "devforge", "topic_scheduler"
    )
    assert fetched is None, "冲突的 factory 不应被注册"

    # 验证 contentforge 仍注册成功（原注册不受影响）
    fetched_cf = await loaded_registry.get_factory(
        "contentforge", "topic_scheduler"
    )
    assert fetched_cf is not None, "原注册不应受冲突影响"


async def test_register_same_plugin_same_factory_idempotent(loaded_registry):
    """AC-F2：同一 plugin 重复注册同一 factory 不应报冲突（幂等）。

    场景：contentforge 两次注册 topic_scheduler，第二次应成功覆盖
    （同 plugin 同 factory_id 不算跨 plugin 冲突）。
    """
    reg1 = _make_contentforge_topic_registration()
    reg2 = FactoryRegistration(
        plugin_id="contentforge",  # 同 plugin
        factory_id="topic_scheduler",  # 同 factory_id
        schedule_type=ScheduleType.CRON,
        cron_expr="0 10 * * *",  # 不同 cron_expr
        max_concurrent=5,  # 不同 max_concurrent
        owner_user_id="operator_001",
    )

    await loaded_registry.register(reg1)
    # 同 plugin 同 factory_id 不应报冲突
    await loaded_registry.register(reg2)

    fetched = await loaded_registry.get_factory(
        "contentforge", "topic_scheduler"
    )
    assert fetched is not None
    assert fetched.cron_expr == "0 10 * * *", "应被第二次注册覆盖"
    assert fetched.max_concurrent == 5


# ── AC-F3: runtime task id 格式确定性 ──────────────────────────────────────


async def test_allocate_deterministic_task_id(loaded_registry):
    """AC-F3：分配确定性 task id。

    格式：``{plugin_id}:{factory_id}:{seq:08d}``

    验证:
        - 第一次分配 sequence=1 → "contentforge:topic_scheduler:00000001"
        - 第二次分配 sequence=2 → "contentforge:topic_scheduler:00000002"
        - 第三次分配 sequence=3 → "contentforge:topic_scheduler:00000003"
    """
    await loaded_registry.register(_make_contentforge_topic_registration())

    task_id_1 = await loaded_registry.allocate_task_id(
        "contentforge", "topic_scheduler"
    )
    assert task_id_1.sequence == 1
    assert task_id_1.format() == "contentforge:topic_scheduler:00000001"
    assert str(task_id_1) == "contentforge:topic_scheduler:00000001"

    task_id_2 = await loaded_registry.allocate_task_id(
        "contentforge", "topic_scheduler"
    )
    assert task_id_2.sequence == 2
    assert task_id_2.format() == "contentforge:topic_scheduler:00000002"

    task_id_3 = await loaded_registry.allocate_task_id(
        "contentforge", "topic_scheduler"
    )
    assert task_id_3.sequence == 3
    assert task_id_3.format() == "contentforge:topic_scheduler:00000003"


async def test_allocate_task_id_independent_per_factory(loaded_registry):
    """AC-F3：不同 factory 的 sequence 独立递增。

    验证:
        - contentforge:topic_scheduler 的 sequence 与
          devforge:code_review_scheduler 的 sequence 互不影响
    """
    await loaded_registry.register(_make_contentforge_topic_registration())
    await loaded_registry.register(_make_devforge_code_review_registration())

    # 交替分配 task id
    cf_id_1 = await loaded_registry.allocate_task_id(
        "contentforge", "topic_scheduler"
    )
    df_id_1 = await loaded_registry.allocate_task_id(
        "devforge", "code_review_scheduler"
    )
    cf_id_2 = await loaded_registry.allocate_task_id(
        "contentforge", "topic_scheduler"
    )
    df_id_2 = await loaded_registry.allocate_task_id(
        "devforge", "code_review_scheduler"
    )

    # 验证 sequence 独立递增
    assert cf_id_1.sequence == 1
    assert cf_id_1.format() == "contentforge:topic_scheduler:00000001"
    assert df_id_1.sequence == 1
    assert df_id_1.format() == "devforge:code_review_scheduler:00000001"
    assert cf_id_2.sequence == 2
    assert cf_id_2.format() == "contentforge:topic_scheduler:00000002"
    assert df_id_2.sequence == 2
    assert df_id_2.format() == "devforge:code_review_scheduler:00000002"


async def test_allocate_task_id_unregistered_factory_raises(loaded_registry):
    """AC-F3：未注册 factory 分配 task id raises KeyError。"""
    with pytest.raises(KeyError, match="factory 未注册"):
        await loaded_registry.allocate_task_id(
            "contentforge", "topic_scheduler"  # 未注册
        )


async def test_runtime_task_id_format_zero_padding():
    """AC-F3：RuntimeTaskId 格式 8 位零填充。"""
    # 验证 sequence=1 的零填充
    tid = RuntimeTaskId(
        plugin_id="contentforge",
        factory_id="topic_scheduler",
        sequence=1,
    )
    assert tid.format() == "contentforge:topic_scheduler:00000001"

    # 验证大 sequence 不会被截断
    tid_big = RuntimeTaskId(
        plugin_id="devforge",
        factory_id="code_review_scheduler",
        sequence=12345678,
    )
    assert tid_big.format() == "devforge:code_review_scheduler:12345678"

    # 验证 RuntimeTaskId 是 frozen（不可变）
    with pytest.raises(AttributeError):
        tid.sequence = 999  # type: ignore[misc]


# ── 注销 factory ────────────────────────────────────────────────────────────


async def test_unregister_factory(loaded_registry):
    """注销 factory 后无法分配 task id。"""
    await loaded_registry.register(_make_contentforge_topic_registration())

    # 注销前可以分配 task id
    task_id = await loaded_registry.allocate_task_id(
        "contentforge", "topic_scheduler"
    )
    assert task_id.sequence == 1

    # 注销 factory
    ok = await loaded_registry.unregister(
        "contentforge", "topic_scheduler"
    )
    assert ok is True, "注销已注册的 factory 应返回 True"

    # 验证已注销
    fetched = await loaded_registry.get_factory(
        "contentforge", "topic_scheduler"
    )
    assert fetched is None, "注销后 get_factory 应返回 None"

    # 注销后无法分配 task id
    with pytest.raises(KeyError, match="factory 未注册"):
        await loaded_registry.allocate_task_id(
            "contentforge", "topic_scheduler"
        )


async def test_unregister_nonexistent_factory_returns_false(loaded_registry):
    """注销未注册的 factory 返回 False。"""
    ok = await loaded_registry.unregister(
        "contentforge", "topic_scheduler"  # 未注册
    )
    assert ok is False


async def test_unregister_preserves_other_factories(loaded_registry):
    """注销一个 factory 不影响其他 factory 的 sequence 计数。"""
    await loaded_registry.register(_make_contentforge_topic_registration())
    await loaded_registry.register(_make_devforge_code_review_registration())

    # 分配一些 task id
    await loaded_registry.allocate_task_id("contentforge", "topic_scheduler")
    await loaded_registry.allocate_task_id("contentforge", "topic_scheduler")
    await loaded_registry.allocate_task_id("devforge", "code_review_scheduler")

    # 注销 contentforge 的 factory
    await loaded_registry.unregister("contentforge", "topic_scheduler")

    # devforge 的 factory 不受影响
    df_id = await loaded_registry.allocate_task_id(
        "devforge", "code_review_scheduler"
    )
    assert df_id.sequence == 2, "devforge 的 sequence 应继续递增（2）"


# ── 启动期验证 ──────────────────────────────────────────────────────────────


async def test_validate_at_startup_clean(loaded_registry):
    """启动期验证：无冲突时返回空错误列表。"""
    await loaded_registry.register(_make_contentforge_topic_registration())
    await loaded_registry.register(_make_devforge_code_review_registration())

    errors = await loaded_registry.validate_at_startup()
    assert errors == [], f"无冲突时应返回空列表，got: {errors}"


async def test_validate_at_startup_empty_registry(loaded_registry):
    """启动期验证：空注册表返回空错误列表。"""
    errors = await loaded_registry.validate_at_startup()
    assert errors == []


async def test_validate_at_startup_with_collisions(registry, whitelist_yaml_path):
    """启动期验证：有冲突时返回错误列表。

    场景：通过白盒方式注入跨 plugin 冲突（register 已阻止冲突，故需
    手动注入以模拟持久化恢复时的状态不一致）。
    """
    await registry.load_whitelist(whitelist_yaml_path)

    # 正常注册 contentforge:topic_scheduler
    await registry.register(_make_contentforge_topic_registration())

    # 白盒注入：手动添加 devforge:topic_scheduler（模拟持久化恢复冲突）
    # register 会阻止此操作，故直接操作内部状态以测试 validate_at_startup
    collision_registration = FactoryRegistration(
        plugin_id="devforge",
        factory_id="topic_scheduler",
        schedule_type=ScheduleType.INTERVAL,
        interval_seconds=1800,
        max_concurrent=2,
        owner_user_id="operator_001",
    )
    registry._factories[("devforge", "topic_scheduler")] = (
        collision_registration
    )
    registry._factory_owners["topic_scheduler"] = "devforge"
    registry._sequence_counters[("devforge", "topic_scheduler")] = 0

    errors = await registry.validate_at_startup()
    assert len(errors) >= 1, "应检测到跨 plugin 冲突"
    collision_errors = [
        e for e in errors if "跨 plugin ownership 冲突" in e
    ]
    assert len(collision_errors) >= 1, "应包含冲突错误信息"
    # 验证错误信息包含冲突的 plugin
    assert any("contentforge" in e and "devforge" in e for e in collision_errors)


async def test_validate_at_startup_with_undeclared_factory(registry, whitelist_yaml_path):
    """启动期验证：未声明 factory 返回错误列表。

    场景：白盒注入一个不在白名单中的 factory（模拟持久化恢复时
    白名单已更新但旧 factory 仍存在的情况）。
    """
    await registry.load_whitelist(whitelist_yaml_path)

    # 白盒注入：手动添加未声明 factory
    undeclared_registration = FactoryRegistration(
        plugin_id="novelforge",
        factory_id="chapter_scheduler",  # 不在白名单
        schedule_type=ScheduleType.CRON,
        cron_expr="0 10 * * *",
        max_concurrent=2,
        owner_user_id="operator_001",
    )
    registry._factories[("novelforge", "chapter_scheduler")] = (
        undeclared_registration
    )
    registry._factory_owners["chapter_scheduler"] = "novelforge"
    registry._sequence_counters[("novelforge", "chapter_scheduler")] = 0

    errors = await registry.validate_at_startup()
    assert len(errors) >= 1, "应检测到未声明 factory"
    undeclared_errors = [e for e in errors if "未在白名单中声明" in e]
    assert len(undeclared_errors) >= 1, "应包含未声明错误信息"
    assert any("chapter_scheduler" in e for e in undeclared_errors)


# ── 跨 plugin 冲突检测 ──────────────────────────────────────────────────────


async def test_check_cross_plugin_collision_clean(loaded_registry):
    """跨 plugin 冲突检测：无冲突时返回空列表。"""
    await loaded_registry.register(_make_contentforge_topic_registration())
    await loaded_registry.register(_make_devforge_code_review_registration())

    collisions = await loaded_registry.check_cross_plugin_collision()
    assert collisions == [], "无冲突时应返回空列表"


async def test_check_cross_plugin_collision(registry, whitelist_yaml_path):
    """AC-F2：跨 plugin 冲突检测返回 (factory_id, plugin_a, plugin_b) 元组。

    场景：两个 plugin 注册同名 factory，应检测到冲突并返回元组列表。
    """
    await registry.load_whitelist(whitelist_yaml_path)
    # 正常注册 contentforge:topic_scheduler
    await registry.register(_make_contentforge_topic_registration())

    # 白盒注入冲突：devforge 也注册 topic_scheduler
    collision_registration = FactoryRegistration(
        plugin_id="devforge",
        factory_id="topic_scheduler",
        schedule_type=ScheduleType.INTERVAL,
        interval_seconds=1800,
        max_concurrent=2,
        owner_user_id="operator_001",
    )
    registry._factories[("devforge", "topic_scheduler")] = (
        collision_registration
    )
    registry._sequence_counters[("devforge", "topic_scheduler")] = 0

    collisions = await registry.check_cross_plugin_collision()
    assert len(collisions) == 1, "应检测到 1 个冲突"
    factory_id, plugin_a, plugin_b = collisions[0]
    assert factory_id == "topic_scheduler"
    # plugin_a < plugin_b（排序保证确定性）
    assert plugin_a == "contentforge"
    assert plugin_b == "devforge"


async def test_check_cross_plugin_collision_empty_registry(loaded_registry):
    """跨 plugin 冲突检测：空注册表返回空列表。"""
    collisions = await loaded_registry.check_cross_plugin_collision()
    assert collisions == []


# ── AC-F5: FactoryRegistration 字段契约校验 ─────────────────────────────────


def test_factory_registration_cron_requires_cron_expr():
    """AC-F5：schedule_type=cron 时 cron_expr 必填（Pydantic 校验）."""
    with pytest.raises(ValueError, match="cron_expr 必填"):
        FactoryRegistration(
            plugin_id="contentforge",
            factory_id="topic_scheduler",
            schedule_type=ScheduleType.CRON,
            cron_expr=None,  # 缺失
            max_concurrent=3,
            owner_user_id="operator_001",
        )


def test_factory_registration_interval_requires_interval_seconds():
    """AC-F5：schedule_type=interval 时 interval_seconds 必填（Pydantic 校验）."""
    with pytest.raises(ValueError, match="interval_seconds 必填"):
        FactoryRegistration(
            plugin_id="devforge",
            factory_id="code_review_scheduler",
            schedule_type=ScheduleType.INTERVAL,
            interval_seconds=None,  # 缺失
            max_concurrent=5,
            owner_user_id="operator_001",
        )


def test_factory_registration_interval_must_be_positive():
    """AC-F5：interval_seconds 必须大于 0。"""
    with pytest.raises(ValueError, match="interval_seconds 必须大于 0"):
        FactoryRegistration(
            plugin_id="devforge",
            factory_id="code_review_scheduler",
            schedule_type=ScheduleType.INTERVAL,
            interval_seconds=0,  # 非法
            max_concurrent=5,
            owner_user_id="operator_001",
        )


def test_factory_registration_max_concurrent_minimum():
    """AC-F5：max_concurrent 必须 >= 1。"""
    with pytest.raises(ValueError):
        FactoryRegistration(
            plugin_id="contentforge",
            factory_id="topic_scheduler",
            schedule_type=ScheduleType.CRON,
            cron_expr="0 9 * * *",
            max_concurrent=0,  # 非法
            owner_user_id="operator_001",
        )


def test_factory_registration_one_shot_allows_no_schedule_fields():
    """AC-F5：schedule_type=one_shot 时 cron_expr 和 interval_seconds 都可省略。"""
    reg = FactoryRegistration(
        plugin_id="contentforge",
        factory_id="one_shot_publisher",
        schedule_type=ScheduleType.ONE_SHOT,
        max_concurrent=1,
        owner_user_id="operator_001",
    )
    assert reg.schedule_type == ScheduleType.ONE_SHOT
    assert reg.cron_expr is None
    assert reg.interval_seconds is None


def test_schedule_type_enum_values():
    """AC-F5：ScheduleType 枚举值正确。"""
    assert ScheduleType.CRON.value == "cron"
    assert ScheduleType.INTERVAL.value == "interval"
    assert ScheduleType.ONE_SHOT.value == "one_shot"
    assert ScheduleType.EVENT_TRIGGERED.value == "event_triggered"

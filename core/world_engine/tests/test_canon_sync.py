"""CanonSync 协议单元测试骨架。

测试 F093 世界引擎三层架构的核心铁律："RP 台词不自动入典"（CL-010）。

测试场景:
    使用真实场景数据（西游记世界观），不使用 "test"/"hello" 等假数据
    （遵守测试铁律 T2）。所有断言具体明确，不跳过验证（T3）。本测试为
    纯单元测试，不调用 LLM（T1 适用于 E2E/集成测试，单元测试不需要
    LLM），不调用外部工具（T4 适用于 E2E/集成测试）。

覆盖用例:
    1. CanonMemory.write() 拒绝未确认的 Turn（confirmed_by 不在白名单）。
    2. CanonSyncProtocol.propose_canon() 返回 proposal_id，且不立即写入 Canon。
    3. CanonSyncProtocol.confirm_canon() 仅 operator / canon_driver 可确认。
    4. CanonSyncProtocol.reject_canon() 任何人都可拒绝。
    5. SessionMemory.clear_session() 不影响 Canon 和 Relational 记忆。
    6. RoleMask.wear() / take_off() 正确切换层（L4 可独立卸载）。
    7. WorldDriver.tick() 返回事件列表。
    8. WorldDriver.can_write_canon() 权限检查。

详见:
    - [doc:review/review.md#13.2] CL-007~CL-013
    - [doc:rules.md] 测试铁律 T1-T8
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from flowforge.core.world_engine.canon_memory import CanonMemory
from flowforge.core.world_engine.canon_sync import CanonSyncProtocol
from flowforge.core.world_engine.citizens import (
    CanonDecision,
    Character,
    Relationship,
    Scene,
    Turn,
    World,
)
from flowforge.core.world_engine.core_identity import CoreIdentityLayer
from flowforge.core.world_engine.driver import WorldDriver
from flowforge.core.world_engine.relational_memory import RelationalMemory
from flowforge.core.world_engine.role_mask import RoleMask, RoleMaskLayer
from flowforge.core.world_engine.session_memory import SessionMemory
from flowforge.core.world_engine.world import WorldLayer

# ── 测试夹具：真实西游记世界观数据 ──────────────────────────────


@pytest.fixture
def journey_world() -> World:
    """西游记世界设定（真实场景数据，非假数据）。"""
    return World(
        world_id="world-journey-to-west",
        name="西游记",
        setting=(
            "东胜神洲花果山石卵化猴，后拜师须菩提习得七十二变，大闹天宫后"
            "被如来压五行山，唐僧揭帖救出，护送西天取经。"
        ),
        rules=[
            "法术不跨越三界",
            "因果不灭",
            "取经人需历九九八十一难",
            "佛门弟子不可杀生",
        ],
    )


@pytest.fixture
def sun_wukong_character() -> Character:
    """孙悟空角色（真实角色数据）。"""
    return Character(
        character_id="char-sun-wukong",
        name="孙悟空",
        role="主角",
        world_id="world-journey-to-west",
    )


@pytest.fixture
def tang_monk_character() -> Character:
    """唐僧角色。"""
    return Character(
        character_id="char-tang-sanzang",
        name="唐三藏",
        role="师父",
        world_id="world-journey-to-west",
    )


@pytest.fixture
def huaguoshan_scene() -> Scene:
    """花果山场景。"""
    return Scene(
        scene_id="scene-huaguoshan",
        world_id="world-journey-to-west",
        location="花果山水帘洞",
        time="贞观十三年秋",
    )


@pytest.fixture
def wukong_identity() -> CoreIdentityLayer:
    """孙悟空扮演Forgekin的核心身份（注意：核心身份是写作Forgekin，不是孙悟空）。

    铁律 CL-007：即使Forgekin演 1000 次孙悟空，核心身份仍是写作Forgekin。
    """
    return CoreIdentityLayer(
        forgekin_id="forgemind:writer_cat_001",
        name="墨灵",
        species="virtual",
        birth_timestamp=datetime(2026, 1, 1, tzinfo=UTC),
        core_personality=["沉稳", "好奇", "严谨"],
        value_anchors=[
            "禁止删除测试用例",
            "禁止硬编码提示词",
            "RP 台词不自动入典",
        ],
        soul_imprint_hash="a" * 64,  # 64 字符 SHA-256 占位
    )


@pytest.fixture
def wukong_rp_turn() -> Turn:
    """孙悟空的一句 RP 台词。

    铁律 CL-010：此 Turn 的 is_canon 默认 False，不能自动入典。
    """
    return Turn(
        turn_id="turn-rp-001",
        round_id="round-huaguoshan-1",
        character_id="char-sun-wukong",
        content="俺老孙乃齐天大圣！今日要踏碎凌霄宝殿！",
        is_canon=False,
    )


@pytest.fixture
def canon_memory() -> CanonMemory:
    """空 CanonMemory 实例。"""
    return CanonMemory()


@pytest.fixture
def relational_memory() -> RelationalMemory:
    """空 RelationalMemory 实例。"""
    return RelationalMemory()


@pytest.fixture
def session_memory() -> SessionMemory:
    """空 SessionMemory 实例。"""
    return SessionMemory()


@pytest.fixture
def world_layer(
    journey_world: World,
    canon_memory: CanonMemory,
    relational_memory: RelationalMemory,
    session_memory: SessionMemory,
) -> WorldLayer:
    """聚合三路记忆的世界层实例。"""
    return WorldLayer(
        world=journey_world,
        canon_memory=canon_memory,
        relational_memory=relational_memory,
        session_memory=session_memory,
    )


@pytest.fixture
def world_driver(world_layer: WorldLayer, canon_memory: CanonMemory) -> WorldDriver:
    """世界驱动器实例。"""
    return WorldDriver(world=world_layer, canon_memory=canon_memory)


@pytest.fixture
def canon_sync(
    canon_memory: CanonMemory,
    session_memory: SessionMemory,
    journey_world: World,
) -> CanonSyncProtocol:
    """CanonSyncProtocol 实例（注入 world_id 以正确构造 CanonDecision）。"""
    return CanonSyncProtocol(
        canon_memory=canon_memory,
        session_memory=session_memory,
        world_id=journey_world.world_id,
    )


# ── 用例 1：CanonMemory.write() 拒绝未确认的 Turn ────────────────


async def test_canon_memory_rejects_unconfirmed_writer(
    canon_memory: CanonMemory,
    journey_world: World,
) -> None:
    """铁律 CL-010：CanonMemory.write() 拒绝无权限的 confirmed_by。"""
    decision = CanonDecision(
        decision_id="canon-001",
        world_id=journey_world.world_id,
        decision="孙悟空是齐天大圣",
        decided_by="operator",
        timestamp=datetime(2026, 1, 1, tzinfo=UTC),
    )
    # Forgekin自身（forgekin:xxx）无 Canon 写入权限
    ok = await canon_memory.write(decision, confirmed_by="forgemind:writer_cat_001")
    assert ok is False, "Forgekin自身不应有 Canon 写入权限（违反 CL-010）"
    decisions = await canon_memory.read(journey_world.world_id)
    assert decisions == [], "未确认的写入不应进入 CanonMemory"


async def test_canon_memory_accepts_operator(
    canon_memory: CanonMemory,
    journey_world: World,
) -> None:
    """operator 有 Canon 写入权限。"""
    decision = CanonDecision(
        decision_id="canon-002",
        world_id=journey_world.world_id,
        decision="唐僧取经九九八十一难",
        decided_by="operator",
        timestamp=datetime(2026, 1, 1, tzinfo=UTC),
    )
    ok = await canon_memory.write(decision, confirmed_by="operator")
    assert ok is True
    decisions = await canon_memory.read(journey_world.world_id)
    assert len(decisions) == 1
    assert decisions[0].decision_id == "canon-002"


async def test_canon_memory_rejects_invalid_decider(
    canon_memory: CanonMemory,
    journey_world: World,
) -> None:
    """CanonDecision.decided_by 必须在白名单中（Pydantic 校验）。"""
    with pytest.raises(ValueError, match="decided_by"):
        CanonDecision(
            decision_id="canon-003",
            world_id=journey_world.world_id,
            decision="无效决策",
            decided_by="forgemind:writer_cat_001",  # 非法 decider
            timestamp=datetime(2026, 1, 1, tzinfo=UTC),
        )


# ── 用例 2：CanonSyncProtocol.propose_canon() 返回 proposal_id ────


async def test_propose_canon_returns_proposal_id(
    canon_sync: CanonSyncProtocol,
    wukong_rp_turn: Turn,
) -> None:
    """propose_canon 返回非空 proposal_id，且不立即写入 CanonMemory。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    assert proposal_id, "proposal_id 不能为空"
    assert isinstance(proposal_id, str)
    # 提议后状态应为 pending
    state = await canon_sync.get_proposal(proposal_id)
    assert state is not None
    assert state["status"] == "pending"
    assert state["proposer"] == "forgemind:writer_cat_001"
    assert state["turn_id"] == wukong_rp_turn.turn_id


async def test_propose_canon_does_not_write_canon(
    canon_sync: CanonSyncProtocol,
    canon_memory: CanonMemory,
    wukong_rp_turn: Turn,
    journey_world: World,
) -> None:
    """铁律 CL-010：propose_canon 不应写入 CanonMemory。"""
    await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    decisions = await canon_memory.read(journey_world.world_id)
    assert decisions == [], "propose_canon 不应直接写入 CanonMemory"


async def test_propose_canon_rejects_already_canon_turn(
    canon_sync: CanonSyncProtocol,
) -> None:
    """已入典的 Turn 不应重复提议。"""
    already_canon_turn = Turn(
        turn_id="turn-canoned",
        round_id="round-1",
        character_id="char-1",
        content="已是 Canon",
        is_canon=True,
    )
    with pytest.raises(ValueError, match="已经是 Canon"):
        await canon_sync.propose_canon(
            turn=already_canon_turn,
            proposer="forgemind:writer_cat_001",
        )


# ── 用例 3：CanonSyncProtocol.confirm_canon() 仅 operator/canon_driver ──


async def test_confirm_canon_by_operator(
    canon_sync: CanonSyncProtocol,
    canon_memory: CanonMemory,
    wukong_rp_turn: Turn,
    journey_world: World,
) -> None:
    """operator 确认入典应成功，并写入 CanonMemory。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    ok = await canon_sync.confirm_canon(proposal_id, confirmer="operator")
    assert ok is True, "operator 应能确认入典"
    # 验证已写入 CanonMemory
    decisions = await canon_memory.read(journey_world.world_id)
    assert len(decisions) == 1, "确认后 CanonMemory 应有 1 条决策"
    assert decisions[0].decided_by == "operator"
    # 验证提案状态已更新
    state = await canon_sync.get_proposal(proposal_id)
    assert state is not None
    assert state["status"] == "confirmed"


async def test_confirm_canon_by_canon_driver(
    canon_sync: CanonSyncProtocol,
    canon_memory: CanonMemory,
    wukong_rp_turn: Turn,
) -> None:
    """canon_driver 也能确认入典。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    ok = await canon_sync.confirm_canon(proposal_id, confirmer="canon_driver")
    assert ok is True


async def test_confirm_canon_rejects_unauthorized(
    canon_sync: CanonSyncProtocol,
    wukong_rp_turn: Turn,
) -> None:
    """铁律 CL-010：Forgekin自身 / council 不能确认入典（council 只能提议不能确认）。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    # Forgekin自身无确认权限
    ok = await canon_sync.confirm_canon(
        proposal_id, confirmer="forgemind:writer_cat_001"
    )
    assert ok is False, "Forgekin自身不应有 Canon 确认权限"
    # council 也不在 _CANON_CONFIRMERS 白名单中
    ok2 = await canon_sync.confirm_canon(proposal_id, confirmer="council")
    assert ok2 is False, "council 不在 Canon 确认白名单中"


async def test_confirm_canon_rejects_double_confirm(
    canon_sync: CanonSyncProtocol,
    wukong_rp_turn: Turn,
) -> None:
    """已闭环的提案不可重复确认。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    ok1 = await canon_sync.confirm_canon(proposal_id, confirmer="operator")
    assert ok1 is True
    ok2 = await canon_sync.confirm_canon(proposal_id, confirmer="operator")
    assert ok2 is False, "已确认的提案不可重复确认"


# ── 用例 4：CanonSyncProtocol.reject_canon() 任何人都可拒绝 ──────


async def test_reject_canon_by_anyone(
    canon_sync: CanonSyncProtocol,
    wukong_rp_turn: Turn,
) -> None:
    """任何角色都可拒绝入典（包括提议者自己撤回）。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    # Forgekin自身可拒绝（撤回自己的提议）
    ok = await canon_sync.reject_canon(
        proposal_id=proposal_id,
        rejecter="forgemind:writer_cat_001",
        reason="此 RP 台词不具长期价值，仅是孙悟空一时狂言",
    )
    assert ok is True
    state = await canon_sync.get_proposal(proposal_id)
    assert state is not None
    assert state["status"] == "rejected"
    assert state["rejecter"] == "forgemind:writer_cat_001"
    assert "不具长期价值" in state["reject_reason"]


async def test_reject_canon_requires_reason(
    canon_sync: CanonSyncProtocol,
    wukong_rp_turn: Turn,
) -> None:
    """拒绝必须填写原因。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    with pytest.raises(ValueError, match="reason"):
        await canon_sync.reject_canon(
            proposal_id=proposal_id,
            rejecter="operator",
            reason="",
        )


async def test_reject_then_confirm_fails(
    canon_sync: CanonSyncProtocol,
    wukong_rp_turn: Turn,
) -> None:
    """已拒绝的提案不可再确认。"""
    proposal_id = await canon_sync.propose_canon(
        turn=wukong_rp_turn,
        proposer="forgemind:writer_cat_001",
    )
    await canon_sync.reject_canon(
        proposal_id=proposal_id,
        rejecter="operator",
        reason="内容与世界规则冲突",
    )
    ok = await canon_sync.confirm_canon(proposal_id, confirmer="operator")
    assert ok is False, "已拒绝的提案不可再确认"


# ── 用例 5：SessionMemory.clear_session() 不影响 Canon/Relational ──


async def test_session_clear_does_not_pollute_canon(
    canon_memory: CanonMemory,
    session_memory: SessionMemory,
    journey_world: World,
    wukong_rp_turn: Turn,
) -> None:
    """铁律 CL-009/CL-010：清理 Session 不应影响 Canon 记忆。"""
    # 1. Turn 进入 Session
    await session_memory.add_turn(wukong_rp_turn)
    # 2. Canon 中也有 1 条决策（来自其他来源）
    canon_decision = CanonDecision(
        decision_id="canon-preset",
        world_id=journey_world.world_id,
        decision="唐僧是金蝉子转世",
        decided_by="operator",
        timestamp=datetime(2026, 1, 1, tzinfo=UTC),
    )
    await canon_memory.write(canon_decision, confirmed_by="operator")
    # 3. 清理 Session
    await session_memory.clear_session(wukong_rp_turn.round_id)
    # 4. Canon 不受影响
    decisions = await canon_memory.read(journey_world.world_id)
    assert len(decisions) == 1, "清理 Session 不应影响 Canon"
    assert decisions[0].decision_id == "canon-preset"
    # 5. Session 已空
    turns = await session_memory.get_turns(wukong_rp_turn.round_id)
    assert turns == [], "Session 应已被清理"


async def test_session_clear_does_not_pollute_relational(
    relational_memory: RelationalMemory,
    session_memory: SessionMemory,
    wukong_rp_turn: Turn,
    sun_wukong_character: Character,
    tang_monk_character: Character,
) -> None:
    """铁律 CL-009：清理 Session 不应影响 Relational 记忆。"""
    # 1. 建立师徒关系
    rel = Relationship(
        relationship_id="rel-wukong-tang",
        character_a=sun_wukong_character.character_id,
        character_b=tang_monk_character.character_id,
        relation_type="师徒",
    )
    await relational_memory.record_interaction(
        rel=rel,
        interaction={"type": "拜师", "summary": "悟空拜唐僧为师"},
    )
    # 2. Turn 进入 Session
    await session_memory.add_turn(wukong_rp_turn)
    # 3. 清理 Session
    await session_memory.clear_session(wukong_rp_turn.round_id)
    # 4. Relational 不受影响
    rels = await relational_memory.query_relationships(sun_wukong_character.character_id)
    assert len(rels) == 1, "清理 Session 不应影响 Relational"
    assert rels[0].relation_type == "师徒"


# ── 用例 6：RoleMask.wear() / take_off() 层切换 ──────────────────


def test_role_mask_wear_take_off_l4() -> None:
    """L4 场景皮肤可独立戴/摘，不影响 L3 本体能力（CL-011）。"""
    mask = RoleMask(forgekin_id="forgemind:writer_cat_001")
    # 1. 戴上 L3 本体能力（写作能力）
    mask.wear(
        RoleMaskLayer.L3_ONTOLOGY,
        {"ability": "writing", "skill_level": "expert"},
    )
    # 2. 戴上 L4 场景皮肤（孙悟空角色）
    mask.wear(
        RoleMaskLayer.L4_SCENE_SKIN,
        {"character": "孙悟空", "persona": "齐天大圣"},
    )
    # 3. 验证两层都戴着
    assert mask.is_wearing(RoleMaskLayer.L3_ONTOLOGY)
    assert mask.is_wearing(RoleMaskLayer.L4_SCENE_SKIN)
    active = mask.get_active_mask()
    assert set(active.keys()) == {
        RoleMaskLayer.L3_ONTOLOGY,
        RoleMaskLayer.L4_SCENE_SKIN,
    }
    # 4. 摘下 L4（退出场景）
    taken = mask.take_off(RoleMaskLayer.L4_SCENE_SKIN)
    assert taken is not None
    assert taken["character"] == "孙悟空"
    # 5. L3 本体能力不受影响（铁律 CL-011）
    assert mask.is_wearing(RoleMaskLayer.L3_ONTOLOGY), "摘下 L4 不应影响 L3"
    assert not mask.is_wearing(RoleMaskLayer.L4_SCENE_SKIN)


def test_role_mask_take_off_scene_layers() -> None:
    """take_off_scene_layers 一次性摘下 L4+L5，保留 L1/L2/L3。"""
    mask = RoleMask(forgekin_id="forgemind:writer_cat_001")
    mask.wear(RoleMaskLayer.L1_ROUTING, {"agent": "writer"})
    mask.wear(RoleMaskLayer.L2_INFRASTRUCTURE, {"tool": "web_search"})
    mask.wear(RoleMaskLayer.L3_ONTOLOGY, {"ability": "writing"})
    mask.wear(RoleMaskLayer.L4_SCENE_SKIN, {"character": "孙悟空"})
    mask.wear(RoleMaskLayer.L5_WORLD_STATE, {"location": "五行山"})

    taken = mask.take_off_scene_layers()
    # L4 / L5 应被摘下
    assert RoleMaskLayer.L4_SCENE_SKIN in taken
    assert RoleMaskLayer.L5_WORLD_STATE in taken
    # L1 / L2 / L3 应保留
    assert mask.is_wearing(RoleMaskLayer.L1_ROUTING)
    assert mask.is_wearing(RoleMaskLayer.L2_INFRASTRUCTURE)
    assert mask.is_wearing(RoleMaskLayer.L3_ONTOLOGY)


def test_role_mask_layer_classifiers() -> None:
    """RoleMaskLayer.scene_layers / ontology_layers 分类正确。"""
    scene = RoleMaskLayer.scene_layers()
    onto = RoleMaskLayer.ontology_layers()
    assert scene == frozenset(
        {RoleMaskLayer.L4_SCENE_SKIN, RoleMaskLayer.L5_WORLD_STATE}
    )
    assert onto == frozenset(
        {
            RoleMaskLayer.L1_ROUTING,
            RoleMaskLayer.L2_INFRASTRUCTURE,
            RoleMaskLayer.L3_ONTOLOGY,
        }
    )
    assert scene.isdisjoint(onto), "场景层与本体层不应重叠"


# ── 用例 7：WorldDriver.tick() 返回事件列表 ──────────────────────


async def test_world_driver_tick_returns_events(world_driver: WorldDriver) -> None:
    """WorldDriver.tick() 返回非空事件列表（CL-013 世界自转）。"""
    events = await world_driver.tick()
    assert isinstance(events, list)
    assert len(events) >= 1, "tick 至少产生 1 个事件"
    event = events[0]
    assert "tick" in event
    assert "world_id" in event
    assert "timestamp" in event
    assert event["world_id"] == "world-journey-to-west"
    # 第二次 tick 应递增 tick 计数
    events2 = await world_driver.tick()
    assert world_driver.tick_count == 2
    assert events2[0]["tick"] == 2


async def test_world_driver_get_world_state(world_driver: WorldDriver) -> None:
    """get_world_state 返回完整世界状态快照。"""
    await world_driver.tick()
    state = await world_driver.get_world_state()
    assert state["tick_count"] == 1
    assert state["world"]["world_id"] == "world-journey-to-west"
    assert state["world"]["name"] == "西游记"
    assert "canon_writers" in state
    assert "operator" in state["canon_writers"]


# ── 用例 8：WorldDriver.can_write_canon() 权限检查 ───────────────


def test_world_driver_can_write_canon_operator(world_driver: WorldDriver) -> None:
    """operator 有 Canon 写入权限。"""
    assert world_driver.can_write_canon("operator") is True
    assert world_driver.can_write_canon("canon_driver") is True
    assert world_driver.can_write_canon("council") is True


def test_world_driver_cannot_write_canon_forgekin(world_driver: WorldDriver) -> None:
    """铁律 CL-010/CL-021：Forgekin自身无 Canon 写入权限。"""
    assert world_driver.can_write_canon("forgemind:writer_cat_001") is False
    assert world_driver.can_write_canon("char-sun-wukong") is False
    assert world_driver.can_write_canon("") is False


# ── 用例 9：CoreIdentityLayer 不可变性（CL-007）──────────────────


def test_core_identity_is_immutable(wukong_identity: CoreIdentityLayer) -> None:
    """铁律 CL-007：CoreIdentityLayer 完全不可变（属性重赋值被拒绝）。

    注意：Pydantic v2 的 ``frozen=True`` 阻止属性**重赋值**，但不阻止
    list 字段内部的 mutation（这是 Pydantic v2 的已知行为，与
    :class:`~flowforge.forgemind.soul_imprint.SoulImprint` 一致）。生产
    实现若需完全不可变 list，应使用 ``tuple[str, ...]`` 字段类型。
    本测试仅验证属性重赋值被拒绝——这是身份隔离的核心保证。
    """
    from pydantic import ValidationError

    # 属性重赋值应被 frozen=True 拒绝
    with pytest.raises((ValidationError, TypeError)):
        wukong_identity.name = "被污染的名字"  # type: ignore[misc]
    with pytest.raises((ValidationError, TypeError)):
        wukong_identity.forgekin_id = "forgemind:polluted"  # type: ignore[misc]
    with pytest.raises((ValidationError, TypeError)):
        wukong_identity.species = "bio"  # type: ignore[misc]
    with pytest.raises((ValidationError, TypeError)):
        wukong_identity.soul_imprint_hash = "b" * 64  # type: ignore[misc]


def test_core_identity_verify_imprint(wukong_identity: CoreIdentityLayer) -> None:
    """verify_imprint 校验SoulImprint一致性。"""
    assert wukong_identity.verify_imprint("a" * 64) is True
    assert wukong_identity.verify_imprint("b" * 64) is False


# ── 用例 10：CanonSyncProtocol 权限白名单自检 ────────────────────


def test_canon_confirmers_whitelist() -> None:
    """铁律 CL-010：Canon 确认白名单只有 operator / canon_driver。"""
    confirmers = CanonSyncProtocol.get_canon_confirmers()
    assert confirmers == frozenset({"operator", "canon_driver"})
    # council 不在确认白名单（council 可提议，但不能最终确认）
    assert "council" not in confirmers

"""P2-013 / CL-026 四心智家族护栏单元测试.

验证 Ragdoll / Maine Coon / Siamese / hotfix 四家族 GuardrailHook 实现，
以及 MindFamilyRouter 路由逻辑。
"""

from __future__ import annotations

import pytest

from flowforge.core.world_engine.mind_families import (
    DEFAULT_FAMILY_HOOKS,
    FAMILY_ALLOWED_ACTIONS,
    FAMILY_AWAKENING_RANGE,
    FAMILY_GUARDRAIL_STRENGTH,
    GuardrailDecision,
    HotfixGuardrail,
    MaineCoonGuardrail,
    MindFamily,
    MindFamilyRouter,
    RagdollGuardrail,
    SiameseGuardrail,
)


# ════════════════════════════════════════════════════════════════════
# §1 枚举与常量测试
# ════════════════════════════════════════════════════════════════════


def test_mind_family_values() -> None:
    """四家族枚举值正确."""
    assert MindFamily.RAGDOLL.value == "ragdoll"
    assert MindFamily.MAINE_COON.value == "maine_coon"
    assert MindFamily.SIAMESE.value == "siamese"
    assert MindFamily.HOTFIX.value == "hotfix"


def test_family_awakening_range() -> None:
    """家族 → 觉醒阶范围映射完整."""
    assert FAMILY_AWAKENING_RANGE[MindFamily.RAGDOLL] == ("E1", "E2")
    assert FAMILY_AWAKENING_RANGE[MindFamily.MAINE_COON] == ("E2", "E3")
    assert FAMILY_AWAKENING_RANGE[MindFamily.SIAMESE] == ("E3", "E4")
    assert FAMILY_AWAKENING_RANGE[MindFamily.HOTFIX] == ("E5", "E6")


def test_family_guardrail_strength_ordering() -> None:
    """护栏强度从强到弱：Ragdoll > Maine Coon > Siamese > hotfix."""
    strength = FAMILY_GUARDRAIL_STRENGTH
    assert strength[MindFamily.RAGDOLL] > strength[MindFamily.MAINE_COON]
    assert strength[MindFamily.MAINE_COON] > strength[MindFamily.SIAMESE]
    assert strength[MindFamily.SIAMESE] > strength[MindFamily.HOTFIX]


def test_family_allowed_actions_inclusion() -> None:
    """允许动作集合逐级扩大：hotfix > Siamese > Maine Coon > Ragdoll."""
    ragdoll = FAMILY_ALLOWED_ACTIONS[MindFamily.RAGDOLL]
    maine = FAMILY_ALLOWED_ACTIONS[MindFamily.MAINE_COON]
    siamese = FAMILY_ALLOWED_ACTIONS[MindFamily.SIAMESE]
    hotfix = FAMILY_ALLOWED_ACTIONS[MindFamily.HOTFIX]

    # Ragdoll 是 Maine Coon 的子集
    assert ragdoll.issubset(maine)
    # Maine Coon 是 Siamese 的子集
    assert maine.issubset(siamese)
    # Siamese 是 hotfix 的子集
    assert siamese.issubset(hotfix)


# ════════════════════════════════════════════════════════════════════
# §2 Ragdoll 护栏测试
# ════════════════════════════════════════════════════════════════════


def test_ragdoll_allows_read() -> None:
    """Ragdoll 允许 read 动作."""
    hook = RagdollGuardrail()
    decision = hook.pre_action("read", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.ALLOW


def test_ragdoll_requires_approval_for_write_doc() -> None:
    """Ragdoll write_doc 需要 approval."""
    hook = RagdollGuardrail()
    decision = hook.pre_action("write_doc", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.REQUIRE_APPROVAL


def test_ragdoll_denies_write_code() -> None:
    """Ragdoll 拒绝 write_code（不在 allowed 中）."""
    hook = RagdollGuardrail()
    decision = hook.pre_action("write_code", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.DENY


def test_ragdoll_denies_deploy() -> None:
    """Ragdoll 拒绝 deploy."""
    hook = RagdollGuardrail()
    decision = hook.pre_action("deploy", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.DENY


# ════════════════════════════════════════════════════════════════════
# §3 Maine Coon 护栏测试
# ════════════════════════════════════════════════════════════════════


def test_maine_coon_allows_write_code() -> None:
    """Maine Coon 允许 write_code."""
    hook = MaineCoonGuardrail()
    decision = hook.pre_action("write_code", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.ALLOW


def test_maine_coon_allows_review() -> None:
    """Maine Coon 允许 review."""
    hook = MaineCoonGuardrail()
    decision = hook.pre_action("review", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.ALLOW


def test_maine_coon_denies_deploy() -> None:
    """Maine Coon 拒绝 deploy（不在 allowed 中）."""
    hook = MaineCoonGuardrail()
    decision = hook.pre_action("deploy", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.DENY


# ════════════════════════════════════════════════════════════════════
# §4 Siamese 护栏测试
# ════════════════════════════════════════════════════════════════════


def test_siamese_allows_deploy() -> None:
    """Siamese 允许 deploy."""
    hook = SiameseGuardrail()
    decision = hook.pre_action("deploy", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.ALLOW


def test_siamese_allows_merge() -> None:
    """Siamese 允许 merge."""
    hook = SiameseGuardrail()
    decision = hook.pre_action("merge", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.ALLOW


def test_siamese_requires_approval_for_unknown_action() -> None:
    """Siamese 对未知动作 REQUIRE_APPROVAL."""
    hook = SiameseGuardrail()
    decision = hook.pre_action("unknown_exotic_action", {"forgekin_id": "test"})
    assert decision == GuardrailDecision.REQUIRE_APPROVAL


# ════════════════════════════════════════════════════════════════════
# §5 hotfix 护栏测试
# ════════════════════════════════════════════════════════════════════


def test_hotfix_defers_all_actions() -> None:
    """hotfix 对所有动作 DEFER（事后追审）."""
    hook = HotfixGuardrail()
    for action in ("read", "write_code", "deploy", "force_push", "rollback"):
        decision = hook.pre_action(action, {
            "forgekin_id": "test",
            "reason": "production incident",
        })
        assert decision == GuardrailDecision.DEFER, f"action={action}"


# ════════════════════════════════════════════════════════════════════
# §6 DEFAULT_FAMILY_HOOKS 测试
# ════════════════════════════════════════════════════════════════════


def test_default_family_hooks_complete() -> None:
    """DEFAULT_FAMILY_HOOKS 包含全部 4 个家族."""
    assert set(DEFAULT_FAMILY_HOOKS.keys()) == {
        MindFamily.RAGDOLL,
        MindFamily.MAINE_COON,
        MindFamily.SIAMESE,
        MindFamily.HOTFIX,
    }


def test_default_family_hooks_instances() -> None:
    """DEFAULT_FAMILY_HOOKS 中每个家族实例类型正确."""
    assert isinstance(DEFAULT_FAMILY_HOOKS[MindFamily.RAGDOLL], RagdollGuardrail)
    assert isinstance(DEFAULT_FAMILY_HOOKS[MindFamily.MAINE_COON], MaineCoonGuardrail)
    assert isinstance(DEFAULT_FAMILY_HOOKS[MindFamily.SIAMESE], SiameseGuardrail)
    assert isinstance(DEFAULT_FAMILY_HOOKS[MindFamily.HOTFIX], HotfixGuardrail)


# ════════════════════════════════════════════════════════════════════
# §7 MindFamilyRouter 路由测试
# ════════════════════════════════════════════════════════════════════


def test_router_select_ragdoll_for_e1() -> None:
    """E1 觉醒阶 → Ragdoll 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E1", "read", {})
    assert family == MindFamily.RAGDOLL


def test_router_select_ragdoll_for_e2() -> None:
    """E2 觉醒阶 → Ragdoll 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E2", "read", {})
    assert family == MindFamily.RAGDOLL


def test_router_select_maine_coon_for_e3() -> None:
    """E3 觉醒阶 → Maine Coon 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E3", "write_code", {})
    assert family == MindFamily.MAINE_COON


def test_router_select_siamese_for_e4() -> None:
    """E4 觉醒阶 → Siamese 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E4", "deploy", {})
    assert family == MindFamily.SIAMESE


def test_router_select_siamese_for_e5_default() -> None:
    """E5 觉醒阶 + 普通动作 → Siamese 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E5", "write_code", {})
    assert family == MindFamily.SIAMESE


def test_router_select_hotfix_for_emergency_context() -> None:
    """emergency=True 时强制使用 HOTFIX 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E2", "read", {"emergency": True})
    assert family == MindFamily.HOTFIX


def test_router_select_hotfix_for_e5_rollback_action() -> None:
    """E5 觉醒阶 + rollback 动作 → HOTFIX 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E5", "rollback", {})
    assert family == MindFamily.HOTFIX


def test_router_select_hotfix_for_e6_force_push() -> None:
    """E6 觉醒阶 + force_push 动作 → HOTFIX 家族."""
    router = MindFamilyRouter()
    family = router.select_family("E6", "force_push", {})
    assert family == MindFamily.HOTFIX


def test_router_select_default_for_invalid_stage() -> None:
    """无效觉醒阶 → 默认 Ragdoll."""
    router = MindFamilyRouter()
    family = router.select_family("invalid", "read", {})
    assert family == MindFamily.RAGDOLL


# ════════════════════════════════════════════════════════════════════
# §8 Router route + post_route 完整流程测试
# ════════════════════════════════════════════════════════════════════


def test_router_route_returns_family_and_decision() -> None:
    """route 返回 (family, decision) 元组."""
    router = MindFamilyRouter()
    family, decision = router.route(
        forgekin_id="test:ragdoll",
        awakening_stage="E1",
        action="read",
        context={},
    )
    assert family == MindFamily.RAGDOLL
    assert decision == GuardrailDecision.ALLOW


def test_router_route_ragdoll_denies_deploy() -> None:
    """Ragdoll 灵智体尝试 deploy 被拒绝."""
    router = MindFamilyRouter()
    family, decision = router.route(
        forgekin_id="test:ragdoll",
        awakening_stage="E1",
        action="deploy",
        context={},
    )
    assert family == MindFamily.RAGDOLL
    assert decision == GuardrailDecision.DENY


def test_router_route_hotfix_for_emergency() -> None:
    """emergency context 强制 HOTFIX 家族."""
    router = MindFamilyRouter()
    family, decision = router.route(
        forgekin_id="test:emergency",
        awakening_stage="E2",
        action="rollback",
        context={"emergency": True, "reason": "production down"},
    )
    assert family == MindFamily.HOTFIX
    assert decision == GuardrailDecision.DEFER


def test_router_post_route_calls_post_action() -> None:
    """post_route 调用家族 hook 的 post_action 不抛异常."""
    router = MindFamilyRouter()
    router.post_route(
        family=MindFamily.RAGDOLL,
        action="read",
        context={"forgekin_id": "test"},
        result={"success": True, "data": "ok"},
    )


def test_router_full_cycle_siamese() -> None:
    """Siamese 灵智体完整流程：route → 执行 → post_route."""
    router = MindFamilyRouter()
    # 1. route
    family, decision = router.route(
        forgekin_id="test:siamese",
        awakening_stage="E4",
        action="deploy",
        context={},
    )
    assert family == MindFamily.SIAMESE
    assert decision == GuardrailDecision.ALLOW

    # 2. 执行动作（mock）
    result = {"success": True, "deployed_to": "production"}

    # 3. post_route（事后审核）
    router.post_route(
        family=family,
        action="deploy",
        context={"forgekin_id": "test:siamese"},
        result=result,
    )


# ════════════════════════════════════════════════════════════════════
# §9 自定义 hooks 注入测试
# ════════════════════════════════════════════════════════════════════


class _CustomRagdollHook(RagdollGuardrail):
    """自定义 Ragdoll hook — 拒绝所有动作."""

    def pre_action(self, action: str, context: dict) -> GuardrailDecision:
        return GuardrailDecision.DENY


def test_router_supports_custom_hooks() -> None:
    """Router 支持注入自定义 hooks 覆盖默认实现."""
    custom_hooks = dict(DEFAULT_FAMILY_HOOKS)
    custom_hooks[MindFamily.RAGDOLL] = _CustomRagdollHook()
    router = MindFamilyRouter(hooks=custom_hooks)

    family, decision = router.route(
        forgekin_id="test",
        awakening_stage="E1",
        action="read",
        context={},
    )
    assert family == MindFamily.RAGDOLL
    assert decision == GuardrailDecision.DENY  # 自定义 hook 拒绝

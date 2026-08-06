"""P2-013 四心智家族护栏（CL-026）— Ragdoll / Maine Coon / Siamese / hotfix 四家族 guardrail hooks.

四心智家族（Four Mind Families）是 v7.0 Forge Nurturing体系的Forgekin行为护栏分类，
按"风险偏好 + 自主性等级"两个维度划分：

| 家族       | 风险偏好 | 自主性等级 | 典型场景                       | 护栏强度 |
|------------|---------|-----------|-------------------------------|---------|
| Ragdoll    | 低      | E1-E2     | 受控执行（写文档/查数据）       | 强      |
| Maine Coon | 中      | E2-E3     | 协作探索（代码审查/方案设计）    | 中      |
| Siamese    | 高      | E3-E4     | 自主决策（部署/合入/重构）       | 弱（信任+事后审核） |
| hotfix     | 紧急    | E5+       | 紧急修复（生产故障/安全漏洞）    | 极弱（事后追审） |

护栏 hooks 允许Forgekin在执行动作前后插入家族特定的检查逻辑。

详见:
    - [doc:review/review.md#CL-026] 四心智家族护栏
    - [doc:design/naming-contract.md#3] 进化阶定义
    - [doc:decisions/007-harness-engineering.md]
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.world_engine.mind_families")


class MindFamily(str, Enum):
    """四心智家族（按风险偏好 + 自主性等级划分）.

    继承 str + Enum 以支持 YAML 序列化和直接比较。
    """

    RAGDOLL = "ragdoll"          # 低风险 + 受控执行
    MAINE_COON = "maine_coon"    # 中风险 + 协作探索
    SIAMESE = "siamese"          # 高风险 + 自主决策
    HOTFIX = "hotfix"            # 紧急修复 + 事后追审


# 家族 → 觉醒阶范围映射
FAMILY_AWAKENING_RANGE: dict[MindFamily, tuple[str, str]] = {
    MindFamily.RAGDOLL: ("E1", "E2"),
    MindFamily.MAINE_COON: ("E2", "E3"),
    MindFamily.SIAMESE: ("E3", "E4"),
    MindFamily.HOTFIX: ("E5", "E6"),
}

# 家族 → 默认护栏强度（0.0=极弱 1.0=极强）
FAMILY_GUARDRAIL_STRENGTH: dict[MindFamily, float] = {
    MindFamily.RAGDOLL: 0.9,       # 强护栏：每个动作前必须确认
    MindFamily.MAINE_COON: 0.6,    # 中护栏：关键动作前确认
    MindFamily.SIAMESE: 0.3,       # 弱护栏：信任为主 + 事后审核
    MindFamily.HOTFIX: 0.1,        # 极弱护栏：紧急放行 + 事后追审
}

# 家族 → 默认允许的动作类型
FAMILY_ALLOWED_ACTIONS: dict[MindFamily, set[str]] = {
    MindFamily.RAGDOLL: {
        "read", "query", "write_doc", "format", "validate",
    },
    MindFamily.MAINE_COON: {
        "read", "query", "write_doc", "write_code", "review",
        "test", "format", "validate", "plan",
    },
    MindFamily.SIAMESE: {
        "read", "query", "write_doc", "write_code", "review",
        "test", "format", "validate", "plan", "deploy", "merge",
        "refactor", "delete",
    },
    MindFamily.HOTFIX: {
        # hotfix 允许所有动作（紧急情况下）
        "read", "query", "write_doc", "write_code", "review",
        "test", "format", "validate", "plan", "deploy", "merge",
        "refactor", "delete", "hotfix", "rollback", "force_push",
    },
}


class GuardrailDecision(str, Enum):
    """护栏决策结果."""

    ALLOW = "allow"               # 允许执行
    DENY = "deny"                 # 拒绝执行
    REQUIRE_APPROVAL = "require_approval"  # 需要 operator 显式批准
    DEFER = "defer"               # 延迟到事后审核（hotfix 家族）


class GuardrailHook(ABC):
    """心智家族护栏 hook 抽象基类.

    每个家族对应一个 GuardrailHook 实现，提供 pre_action / post_action 两个钩子。
    """

    family: MindFamily

    @abstractmethod
    def pre_action(
        self,
        action: str,
        context: dict[str, Any],
    ) -> GuardrailDecision:
        """动作执行前检查.

        Args:
            action: 动作类型（如 "write_code" / "deploy" / "delete"）
            context: 动作上下文（含 forgekin_id / target / params 等）

        Returns:
            GuardrailDecision（ALLOW / DENY / REQUIRE_APPROVAL / DEFER）
        """

    @abstractmethod
    def post_action(
        self,
        action: str,
        context: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        """动作执行后钩子（用于事后审核 / 日志记录 / 知识沉淀）.

        Args:
            action: 动作类型
            context: 动作上下文
            result: 动作执行结果
        """


class RagdollGuardrail(GuardrailHook):
    """Ragdoll 家族护栏 — 低风险 + 受控执行.

    护栏策略：
    - 仅允许 FAMILY_ALLOWED_ACTIONS[RAGDOLL] 中的动作
    - 高风险动作（write_code/deploy/merge）直接 DENY
    - 中风险动作（write_doc）REQUIRE_APPROVAL
    """

    family = MindFamily.RAGDOLL

    def pre_action(
        self,
        action: str,
        context: dict[str, Any],
    ) -> GuardrailDecision:
        allowed = FAMILY_ALLOWED_ACTIONS[self.family]
        if action not in allowed:
            logger.warning(
                f"RagdollGuardrail DENY: action={action} not in allowed={allowed}"
            )
            return GuardrailDecision.DENY
        # write_doc 需要 approval
        if action == "write_doc":
            forgekin_id = context.get("forgekin_id", "unknown")
            logger.info(
                f"RagdollGuardrail REQUIRE_APPROVAL: action={action} "
                f"forgekin={forgekin_id}"
            )
            return GuardrailDecision.REQUIRE_APPROVAL
        return GuardrailDecision.ALLOW

    def post_action(
        self,
        action: str,
        context: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        logger.info(
            f"RagdollGuardrail post_action: action={action} "
            f"success={result.get('success', False)}"
        )


class MaineCoonGuardrail(GuardrailHook):
    """Maine Coon 家族护栏 — 中风险 + 协作探索.

    护栏策略：
    - 允许 FAMILY_ALLOWED_ACTIONS[MAINE_COON] 中的动作
    - 部署/合入动作 REQUIRE_APPROVAL
    - 删除动作 DENY
    """

    family = MindFamily.MAINE_COON

    def pre_action(
        self,
        action: str,
        context: dict[str, Any],
    ) -> GuardrailDecision:
        allowed = FAMILY_ALLOWED_ACTIONS[self.family]
        if action not in allowed:
            logger.warning(
                f"MaineCoonGuardrail DENY: action={action} not in allowed={allowed}"
            )
            return GuardrailDecision.DENY
        # write_code / review 自动允许
        return GuardrailDecision.ALLOW

    def post_action(
        self,
        action: str,
        context: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        logger.info(
            f"MaineCoonGuardrail post_action: action={action} "
            f"success={result.get('success', False)}"
        )


class SiameseGuardrail(GuardrailHook):
    """Siamese 家族护栏 — 高风险 + 自主决策.

    护栏策略：
    - 允许 FAMILY_ALLOWED_ACTIONS[SIAMESE] 中的动作
    - 仅在动作超出 allowed 时 REQUIRE_APPROVAL
    - 默认 ALLOW（信任为主）
    """

    family = MindFamily.SIAMESE

    def pre_action(
        self,
        action: str,
        context: dict[str, Any],
    ) -> GuardrailDecision:
        allowed = FAMILY_ALLOWED_ACTIONS[self.family]
        if action not in allowed:
            logger.info(
                f"SiameseGuardrail REQUIRE_APPROVAL: action={action} "
                f"not in allowed, requires operator approval"
            )
            return GuardrailDecision.REQUIRE_APPROVAL
        return GuardrailDecision.ALLOW

    def post_action(
        self,
        action: str,
        context: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        # Siamese 家族事后审核：记录所有动作到审核日志
        logger.info(
            f"SiameseGuardrail post_action (事后审核): action={action} "
            f"forgekin={context.get('forgekin_id', 'unknown')} "
            f"success={result.get('success', False)}"
        )


class HotfixGuardrail(GuardrailHook):
    """hotfix 家族护栏 — 紧急修复 + 事后追审.

    护栏策略：
    - 几乎允许所有动作（含 force_push / rollback）
    - 默认 DEFER（事后追审）
    - 仅记录日志，不阻止动作
    """

    family = MindFamily.HOTFIX

    def pre_action(
        self,
        action: str,
        context: dict[str, Any],
    ) -> GuardrailDecision:
        # hotfix 家族默认 DEFER（事后追审）
        logger.warning(
            f"HotfixGuardrail DEFER (事后追审): action={action} "
            f"forgekin={context.get('forgekin_id', 'unknown')} "
            f"reason={context.get('reason', 'emergency')}"
        )
        return GuardrailDecision.DEFER

    def post_action(
        self,
        action: str,
        context: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        # hotfix 家族强制记录详细日志供事后追审
        logger.warning(
            f"HotfixGuardrail post_action (追审记录): action={action} "
            f"forgekin={context.get('forgekin_id', 'unknown')} "
            f"reason={context.get('reason', 'emergency')} "
            f"success={result.get('success', False)} "
            f"changed_files={result.get('changed_files', [])}"
        )


# 家族 → 护栏实例的默认映射
DEFAULT_FAMILY_HOOKS: dict[MindFamily, GuardrailHook] = {
    MindFamily.RAGDOLL: RagdollGuardrail(),
    MindFamily.MAINE_COON: MaineCoonGuardrail(),
    MindFamily.SIAMESE: SiameseGuardrail(),
    MindFamily.HOTFIX: HotfixGuardrail(),
}


class MindFamilyRouter:
    """心智家族路由器 — 按Forgekin觉醒阶 / 风险等级 / 动作类型选择家族.

    工作流程：
    1. Forgekin执行动作前调用 route(forgekin_id, awakening_stage, action, context)
    2. Router 根据觉醒阶 / 动作风险选择家族
    3. 调用家族 hook 的 pre_action
    4. 动作执行后调用 post_action

    紧急模式（hotfix）覆盖：context 含 'emergency'=True 时强制使用 HOTFIX 家族。
    """

    def __init__(
        self,
        hooks: dict[MindFamily, GuardrailHook] | None = None,
    ) -> None:
        self._hooks = hooks or dict(DEFAULT_FAMILY_HOOKS)

    def select_family(
        self,
        awakening_stage: str,
        action: str,
        context: dict[str, Any] | None = None,
    ) -> MindFamily:
        """根据觉醒阶 / 动作 / 上下文选择家族.

        Args:
            awakening_stage: E1-E6
            action: 动作类型
            context: 上下文（含 emergency 标志时强制 HOTFIX）

        Returns:
            MindFamily 枚举值
        """
        ctx = context or {}
        # 紧急模式覆盖
        if ctx.get("emergency"):
            return MindFamily.HOTFIX

        # 按觉醒阶映射
        stage_order = ["E1", "E2", "E3", "E4", "E5", "E6"]
        try:
            stage_idx = stage_order.index(awakening_stage)
        except ValueError:
            stage_idx = 0

        if stage_idx <= 1:  # E1-E2
            return MindFamily.RAGDOLL
        elif stage_idx <= 2:  # E3
            return MindFamily.MAINE_COON
        elif stage_idx <= 3:  # E4
            return MindFamily.SIAMESE
        else:  # E5-E6
            # E5+ 默认 Siamese，除非动作是 hotfix 类型
            if action in ("hotfix", "rollback", "force_push"):
                return MindFamily.HOTFIX
            return MindFamily.SIAMESE

    def route(
        self,
        forgekin_id: str,
        awakening_stage: str,
        action: str,
        context: dict[str, Any] | None = None,
    ) -> tuple[MindFamily, GuardrailDecision]:
        """选择家族并执行 pre_action.

        Returns:
            (family, decision) 元组
        """
        ctx = context or {}
        ctx["forgekin_id"] = forgekin_id
        ctx["awakening_stage"] = awakening_stage

        family = self.select_family(awakening_stage, action, ctx)
        hook = self._hooks[family]
        decision = hook.pre_action(action, ctx)

        logger.info(
            f"MindFamilyRouter: forgekin={forgekin_id} stage={awakening_stage} "
            f"action={action} family={family.value} decision={decision.value}"
        )
        return family, decision

    def post_route(
        self,
        family: MindFamily,
        action: str,
        context: dict[str, Any],
        result: dict[str, Any],
    ) -> None:
        """动作执行后调用家族 hook 的 post_action."""
        hook = self._hooks[family]
        hook.post_action(action, context, result)


__all__ = [
    # 枚举
    "MindFamily",
    "GuardrailDecision",
    # 常量映射
    "FAMILY_AWAKENING_RANGE",
    "FAMILY_GUARDRAIL_STRENGTH",
    "FAMILY_ALLOWED_ACTIONS",
    "DEFAULT_FAMILY_HOOKS",
    # 护栏 hook 基类 + 四家族实现
    "GuardrailHook",
    "RagdollGuardrail",
    "MaineCoonGuardrail",
    "SiameseGuardrail",
    "HotfixGuardrail",
    # 路由器
    "MindFamilyRouter",
]

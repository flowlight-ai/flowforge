"""Governance Boundary — Harness 第 4 层：约束现实（压缩免疫）。

对应 roleagent.md §3.2 Harness 七层中的"约束现实"层（F010）。
解决开放环境失败模式 4：治理失败（agent 绕过规则 / 上下文压缩吞掉规则）。

核心机制（roleagent.md §3.3 压缩免疫层）：
    治理规则不能通过 user message prepend 注入（会被上下文压缩吞掉），
    必须通过 system role 注入。每压缩一次规则丢一次，
    团队被迫"十轮对话教十次传球"。

    本模块的关键不变量：
        - 治理规则默认注入 SYSTEM_ROLE（压缩免疫）
        - 仅在显式标记可压缩时才允许 USER_MESSAGE 注入
        - critical 优先级规则（priority >= critical_threshold）永不可降级

半衰期标记（roleagent.md §1.3）：
    - GovernanceRule 数据模型 → Built-to-Persist（不可逆操作护栏）
    - GovernanceInjector → Built-to-Persist（压缩免疫层）
    - InjectionPoint 枚举 → Built-to-Persist（架构契约）

设计依据：
    - F010-governance-boundary.md
    - roleagent.md §3.1（治理失败）+ §3.2（七层）+ §3.3（压缩免疫层）
    - ADR 007 §4（Governance Boundary）

铁律遵守：
    - 铁律 3：Injector 不持有可变外部资源
    - 铁律 5：阈值与默认规则通过配置注入
    - 编程红线 9：使用组合（Pydantic 字段）而非继承
    - 编程红线 11：注入模板外置到 config/prompts.yaml
    - 禁止 user message prepend 治理规则（roleagent.md §3.3）

License: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from flowforge.core.tracing import get_logger

logger = get_logger("harness.governance")


# ──────────────────────────────────────────────────────────────────────────────
# 枚举与数据模型
# ──────────────────────────────────────────────────────────────────────────────


class InjectionPoint(str, Enum):
    """治理规则注入点 —— Built-to-Persist。

    关键设计（roleagent.md §3.3）：
        - SYSTEM_ROLE: 压缩免疫，治理规则必须走此路径
        - USER_MESSAGE: 会被上下文压缩吞掉，仅用于非关键临时提示
    """

    SYSTEM_ROLE = "SYSTEM_ROLE"
    USER_MESSAGE = "USER_MESSAGE"


class GovernanceRule(BaseModel):
    """治理规则 —— Built-to-Persist（不可逆操作护栏）。

    描述一条治理规则的内容、优先级、注入点。
    GovernanceInjector 基于这些字段决定如何注入。

    Attributes:
        rule_id: 规则唯一 ID（如 GOV-001）。
        content: 规则内容（人类可读）。
        priority: 优先级（0-100，越高越关键；critical_threshold 以上不可降级）。
        injection_point: 注入点（默认 SYSTEM_ROLE，压缩免疫）。
        created_at: 创建时间 ISO 8601。
        enabled: 是否启用（禁用的规则不注入）。
    """

    rule_id: str = Field(..., description="规则唯一 ID")
    content: str = Field(..., description="规则内容")
    priority: int = Field(
        default=50, ge=0, le=100, description="优先级（0-100）"
    )
    injection_point: InjectionPoint = Field(
        default=InjectionPoint.SYSTEM_ROLE,
        description="注入点（默认 SYSTEM_ROLE，压缩免疫）",
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="创建时间 ISO 8601",
    )
    enabled: bool = Field(default=True, description="是否启用")

    @field_validator("injection_point")
    @classmethod
    def _validate_injection_point(cls, v: InjectionPoint) -> InjectionPoint:
        """校验注入点（不在此处强制 SYSTEM_ROLE，但记录警告级别日志）。

        实际"禁止 USER_MESSAGE prepend 治理规则"由 GovernanceInjector 在注入时
        强制（critical 规则不允许 USER_MESSAGE 注入）。
        """
        return v


# ──────────────────────────────────────────────────────────────────────────────
# GovernanceInjector
# ──────────────────────────────────────────────────────────────────────────────


class GovernanceInjector:
    """治理规则注入器 —— Built-to-Persist（压缩免疫层）。

    roleagent.md §3.2 第四层"约束现实"的核心组件。
    负责把治理规则注入到 LLM 调用的 SYSTEM_ROLE 或 USER_MESSAGE。

    关键不变量（roleagent.md §3.3 压缩免疫层）：
        1. 治理规则默认注入 SYSTEM_ROLE（压缩免疫）
        2. priority >= critical_threshold 的规则永不可降级到 USER_MESSAGE
        3. 即使调用方请求 USER_MESSAGE 注入 critical 规则，也会被拒绝并
           自动改为 SYSTEM_ROLE（记录 warning 日志）
        4. 禁止 user message prepend 治理规则（roleagent.md §3.3 铁律）

    # Built-to-Persist: 压缩免疫层是复利型基础设施（不可逆操作护栏）

    Attributes:
        rules: 已注册的治理规则（rule_id → GovernanceRule）。
        critical_priority_threshold: 关键规则优先级阈值。
        system_role_template: SYSTEM_ROLE 注入模板。
        user_message_template: USER_MESSAGE 注入模板。
    """

    def __init__(
        self,
        critical_priority_threshold: int = 90,
        system_role_template: str | None = None,
        user_message_template: str | None = None,
    ) -> None:
        self.rules: dict[str, GovernanceRule] = {}
        self.critical_priority_threshold = critical_priority_threshold
        # 注入模板（默认值仅作为兜底；生产环境应从 config/prompts.yaml 加载）
        self.system_role_template = system_role_template or (
            "[GOVERNANCE RULE #{rule_id}] (priority={priority})\n"
            "{content}\n"
            "[/GOVERNANCE RULE #{rule_id}]"
        )
        self.user_message_template = user_message_template or (
            "[提示] {content}"
        )
        logger.info(
            "GovernanceInjector initialized",
            critical_threshold=critical_priority_threshold,
        )

    def register_rule(self, rule: GovernanceRule) -> None:
        """注册治理规则。

        Args:
            rule: 待注册的治理规则。
        """
        self.rules[rule.rule_id] = rule
        logger.info(
            "Governance rule registered",
            rule_id=rule.rule_id,
            priority=rule.priority,
            injection_point=rule.injection_point.value,
        )

    def _enforce_injection_point(
        self, rule: GovernanceRule
    ) -> InjectionPoint:
        """强制注入点策略（roleagent.md §3.3 压缩免疫层）。

        critical 规则（priority >= critical_priority_threshold）永不可降级到
        USER_MESSAGE。即使规则配置为 USER_MESSAGE，也会被强制改为 SYSTEM_ROLE
        并记录 warning。

        Args:
            rule: 待注入的规则。

        Returns:
            实际使用的注入点。
        """
        if (
            rule.priority >= self.critical_priority_threshold
            and rule.injection_point == InjectionPoint.USER_MESSAGE
        ):
            logger.warning(
                "Critical governance rule forced to SYSTEM_ROLE "
                "(compression-immune, roleagent.md §3.3)",
                rule_id=rule.rule_id,
                priority=rule.priority,
                requested_point=rule.injection_point.value,
                forced_point=InjectionPoint.SYSTEM_ROLE.value,
            )
            return InjectionPoint.SYSTEM_ROLE
        return rule.injection_point

    async def inject_to_system_role(
        self,
        rule: GovernanceRule | None = None,
        rule_id: str | None = None,
    ) -> str:
        """注入治理规则到 SYSTEM_ROLE（压缩免疫）。

        本方法是治理规则注入的主路径（roleagent.md §3.3）。
        无论规则配置为何种 injection_point，此方法都会注入到 SYSTEM_ROLE。

        Args:
            rule: 待注入的规则（与 rule_id 二选一）。
            rule_id: 已注册规则的 ID（与 rule 二选一）。

        Returns:
            注入到 SYSTEM_ROLE 的规则文本。

        Raises:
            ValueError: rule 与 rule_id 同时为空，或 rule_id 未注册。
        """
        target = self._resolve_rule(rule, rule_id)
        text = self.system_role_template.format(
            rule_id=target.rule_id,
            priority=target.priority,
            content=target.content,
        )
        logger.info(
            "Governance rule injected to SYSTEM_ROLE (compression-immune)",
            rule_id=target.rule_id,
            priority=target.priority,
        )
        return text

    async def inject_to_user_message(
        self,
        rule: GovernanceRule | None = None,
        rule_id: str | None = None,
    ) -> str:
        """注入治理规则到 USER_MESSAGE（可被压缩吞掉）。

        警告：此路径会被上下文压缩吞掉（roleagent.md §3.3）。
        critical 规则不允许走此路径，会被强制改为 SYSTEM_ROLE。

        Args:
            rule: 待注入的规则（与 rule_id 二选一）。
            rule_id: 已注册规则的 ID（与 rule 二选一）。

        Returns:
            注入到 USER_MESSAGE 的规则文本。

        Raises:
            ValueError: rule 与 rule_id 同时为空，或 rule_id 未注册。
        """
        target = self._resolve_rule(rule, rule_id)
        actual_point = self._enforce_injection_point(target)

        if actual_point == InjectionPoint.SYSTEM_ROLE:
            # critical 规则被强制改为 SYSTEM_ROLE
            return await self.inject_to_system_role(target)

        text = self.user_message_template.format(
            rule_id=target.rule_id,
            content=target.content,
            priority=target.priority,
        )
        logger.info(
            "Governance rule injected to USER_MESSAGE (compressible)",
            rule_id=target.rule_id,
            priority=target.priority,
        )
        return text

    async def inject_to_system_role_batch(
        self, rule_ids: list[str] | None = None
    ) -> str:
        """批量注入治理规则到 SYSTEM_ROLE。

        按优先级降序拼接所有规则文本。

        Args:
            rule_ids: 待注入的规则 ID 列表；None 表示注入全部已启用规则。

        Returns:
            拼接后的 SYSTEM_ROLE 文本。
        """
        if rule_ids is None:
            rules = [r for r in self.rules.values() if r.enabled]
        else:
            rules = [
                self.rules[rid]
                for rid in rule_ids
                if rid in self.rules and self.rules[rid].enabled
            ]
        # 按优先级降序排序
        rules.sort(key=lambda r: r.priority, reverse=True)

        parts: list[str] = []
        for r in rules:
            parts.append(await self.inject_to_system_role(r))
        return "\n\n".join(parts)

    def _resolve_rule(
        self,
        rule: GovernanceRule | None,
        rule_id: str | None,
    ) -> GovernanceRule:
        """解析规则参数。"""
        if rule is not None:
            return rule
        if rule_id is None:
            raise ValueError(
                "either 'rule' or 'rule_id' must be provided"
            )
        if rule_id not in self.rules:
            raise ValueError(
                f"governance rule '{rule_id}' not registered"
            )
        return self.rules[rule_id]


__all__ = [
    "InjectionPoint",
    "GovernanceRule",
    "GovernanceInjector",
]

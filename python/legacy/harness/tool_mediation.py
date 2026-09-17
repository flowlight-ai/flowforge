"""Tool Mediation — Harness 第 2 层：改变现实。

对应 roleagent.md §3.2 Harness 七层中的"改变现实"层。
解决开放环境失败模式 2：行动失败（agent 调用工具但实际没改变现实）。

核心机制：
    agent 不直接调用工具，而是通过 ToolMediator 中介。
    ToolMediator 负责白名单校验、危险等级评估、副作用记录、别名兜底。
    所有工具调用都有审计 trail，便于事后追溯。

半衰期标记（roleagent.md §1.3）：
    - ToolDescriptor 数据模型 → Built-to-Persist（架构契约）
    - ToolMediator 主体 → Built-to-Persist（不可逆操作护栏）
    - 别名兜底逻辑（alias_fallback） → Build-to-Delete（模型能力提升后退役）

设计依据：
    - roleagent.md §3.1（行动失败）+ §3.2（七层）+ §1.3（Build to Delete）
    - ADR 007 §2（Tool Mediation）

铁律遵守：
    - 铁律 3：ToolMediator 不持有可变外部资源，描述符通过配置注入
    - 铁律 5：白名单通过配置注入，不硬编码
    - 编程红线 9：使用组合（描述符列表 + Pydantic 模型）而非继承
    - 编程红线 11：提示词外置到 config/prompts.yaml

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("harness.tool_mediation")


# ──────────────────────────────────────────────────────────────────────────────
# 枚举与数据模型
# ──────────────────────────────────────────────────────────────────────────────


class SafetyLevel(str, Enum):
    """工具安全等级。

   ,readonly: 只读操作，无副作用。
    normal: 有副作用但可逆。
    dangerous: 不可逆或高风险操作（如 shell_exec / db_drop）。
    """

    READONLY = "readonly"
    NORMAL = "normal"
    DANGEROUS = "dangerous"


class MediationOutcome(str, Enum):
    """工具中介结果状态。"""

    ALLOWED = "allowed"  # 直接放行
    ALIAS_FALLBACK = "alias_fallback"  # 别名兜底放行（Build to Delete）
    REJECTED_NOT_AUTHORIZED = "rejected_not_authorized"  # 未在白名单
    REJECTED_DANGEROUS = "rejected_dangerous"  # 危险工具未确认
    REJECTED_NOT_REVERSIBLE = "rejected_not_reversible"  # 不可逆操作未授权


class ToolDescriptor(BaseModel):
    """工具描述符 —— Built-to-Persist。

    描述工具的元信息：安全等级、副作用、可逆性。
    ToolMediator 基于这些字段做中介决策。

    Attributes:
        tool_name: 工具唯一名称（如 file_read / shell_exec）。
        safety_level: 安全等级枚举。
        side_effects: 副作用列表（如 ["filesystem", "network"]）。
        reversible: 是否可逆（不可逆操作需更高级别授权）。
        description: 工具描述（人类可读）。
    """

    tool_name: str = Field(..., description="工具唯一名称")
    safety_level: SafetyLevel = Field(
        default=SafetyLevel.NORMAL, description="安全等级"
    )
    side_effects: list[str] = Field(
        default_factory=list, description="副作用列表"
    )
    reversible: bool = Field(default=True, description="是否可逆")
    description: str = Field(default="", description="工具描述")


class MediationResult(BaseModel):
    """工具中介结果 —— Built-to-Persist。

    记录一次工具调用的中介决策，作为审计 trail。

    Attributes:
        mediation_id: 中介记录唯一 ID。
        requested_tool: agent 请求调用的工具名。
        canonical_tool: 实际放行的工具名（别名兜底后）。
        args: 调用参数（脱敏后）。
        outcome: 中介结果状态。
        descriptor: 关联的 ToolDescriptor（若存在）。
        reason: 决策原因（人类可读）。
        timestamp: 中介时间 ISO 8601。
    """

    mediation_id: str = Field(
        default_factory=lambda: f"med-{uuid4().hex[:12]}",
        description="中介记录唯一 ID",
    )
    requested_tool: str = Field(..., description="请求调用的工具名")
    canonical_tool: Optional[str] = Field(
        default=None, description="实际放行的工具名"
    )
    args: dict[str, Any] = Field(
        default_factory=dict, description="调用参数（脱敏后）"
    )
    outcome: MediationOutcome = Field(
        ..., description="中介结果状态"
    )
    descriptor: Optional[ToolDescriptor] = Field(
        default=None, description="关联的工具描述符"
    )
    reason: str = Field(default="", description="决策原因")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="中介时间 ISO 8601",
    )


# ──────────────────────────────────────────────────────────────────────────────
# ToolMediator 主体
# ──────────────────────────────────────────────────────────────────────────────


class ToolMediator:
    """工具中介器 —— Built-to-Persist（不可逆操作护栏）。

    roleagent.md §3.2 第二层"改变现实"的中介组件。
    agent 不直接调用工具，所有调用都经过此中介。

    职责：
        1. 白名单校验（不在白名单中的工具调用被拒绝）
        2. 别名兜底（Build to Delete：模型工具调用能力提升后退役）
        3. 危险工具评估（safety_level=dangerous 需要确认）
        4. 不可逆操作拦截（reversible=False 需要更高级别授权）
        5. 审计 trail 记录（所有决策写入 MediationResult）

    # Built-to-Persist: 不可逆操作护栏是复利型基础设施
    # Build-to-Delete: 别名兜底逻辑（_resolve_alias）应随模型能力提升退役

    Attributes:
        whitelist: 工具白名单（tool_name → ToolDescriptor）。
        aliases: 工具别名映射（alias → canonical tool_name）。
        dangerous_requires_confirm: 危险工具是否需要外部确认。
        audit_trail: 中介审计记录列表。
    """

    def __init__(
        self,
        whitelist: Optional[list[ToolDescriptor]] = None,
        aliases: Optional[dict[str, str]] = None,
        dangerous_requires_confirm: bool = True,
    ) -> None:
        self.whitelist: dict[str, ToolDescriptor] = {
            desc.tool_name: desc for desc in (whitelist or [])
        }
        # Build-to-Delete: 别名兜底映射，模型工具调用能力提升后退役
        self.aliases: dict[str, str] = dict(aliases or {})
        self.dangerous_requires_confirm = dangerous_requires_confirm
        self.audit_trail: list[MediationResult] = []
        logger.info(
            "ToolMediator initialized",
            whitelist_size=len(self.whitelist),
            aliases_size=len(self.aliases),
            dangerous_requires_confirm=dangerous_requires_confirm,
        )

    def register_tool(self, descriptor: ToolDescriptor) -> None:
        """注册工具到白名单。

        Args:
            descriptor: 工具描述符。
        """
        self.whitelist[descriptor.tool_name] = descriptor
        logger.info(
            "Tool registered to whitelist",
            tool_name=descriptor.tool_name,
            safety_level=descriptor.safety_level.value,
        )

    def register_alias(self, alias: str, canonical: str) -> None:
        """注册工具别名（Build to Delete 路径）。

        Args:
            alias: 别名（agent 可能请求的名字）。
            canonical: 标准工具名（白名单中的名字）。
        """
        self.aliases[alias] = canonical
        logger.info(
            "Tool alias registered (Build-to-Delete)",
            alias=alias,
            canonical=canonical,
        )

    def _resolve_alias(self, requested: str) -> Optional[str]:
        """解析别名到标准工具名。

        Build-to-Delete: 此方法是别名兜底逻辑的核心，
        当模型工具调用能力提升后应退役。

        Args:
            requested: agent 请求的工具名。

        Returns:
            标准工具名；无匹配时返回 None。
        """
        return self.aliases.get(requested)

    async def mediate(
        self,
        tool_name: str,
        args: Optional[dict[str, Any]] = None,
        confirmed_dangerous: bool = False,
    ) -> MediationResult:
        """中介一次工具调用。

        决策流程：
            1. 白名单直接命中 → 评估安全等级 → 放行/拒绝
            2. 别名兜底命中 → 记录 alias_fallback → 评估安全等级 → 放行/拒绝
            3. 都未命中 → rejected_not_authorized

        Args:
            tool_name: agent 请求调用的工具名。
            args: 调用参数（用于审计 trail，会被脱敏）。
            confirmed_dangerous: 调用方是否已确认危险操作。

        Returns:
            MediationResult 包含决策结果与原因。
        """
        args = args or {}
        # 简单脱敏：截断超长参数值
        sanitized_args = self._sanitize_args(args)

        # 1. 白名单直接命中
        descriptor = self.whitelist.get(tool_name)
        canonical = tool_name
        used_alias = False

        # 2. 别名兜底（Build to Delete 路径）
        if descriptor is None:
            alias_target = self._resolve_alias(tool_name)
            if alias_target is not None:
                descriptor = self.whitelist.get(alias_target)
                canonical = alias_target
                used_alias = True
                logger.info(
                    "Tool alias fallback used (Build-to-Delete)",
                    requested=tool_name,
                    canonical=canonical,
                )

        # 3. 都未命中 → 拒绝
        if descriptor is None:
            result = MediationResult(
                requested_tool=tool_name,
                canonical_tool=None,
                args=sanitized_args,
                outcome=MediationOutcome.REJECTED_NOT_AUTHORIZED,
                descriptor=None,
                reason=(
                    f"tool '{tool_name}' not in whitelist and no alias "
                    f"available; rejected by ToolMediator"
                ),
            )
            self.audit_trail.append(result)
            logger.warning(
                "Tool mediation rejected",
                tool_name=tool_name,
                outcome=result.outcome.value,
            )
            return result

        # 评估安全等级
        outcome = MediationOutcome.ALLOWED
        reason = "tool authorized; safety level acceptable"

        if descriptor.safety_level == SafetyLevel.DANGEROUS:
            if self.dangerous_requires_confirm and not confirmed_dangerous:
                outcome = MediationOutcome.REJECTED_DANGEROUS
                reason = (
                    f"tool '{canonical}' is dangerous "
                    f"(safety_level={descriptor.safety_level.value}, "
                    f"side_effects={descriptor.side_effects}); "
                    f"requires confirmed_dangerous=True"
                )
        elif not descriptor.reversible and not confirmed_dangerous:
            outcome = MediationOutcome.REJECTED_NOT_REVERSIBLE
            reason = (
                f"tool '{canonical}' is not reversible; "
                f"requires confirmed_dangerous=True"
            )

        if used_alias and outcome == MediationOutcome.ALLOWED:
            # 别名兜底放行，标记为 alias_fallback（Build to Delete 标记）
            outcome = MediationOutcome.ALIAS_FALLBACK
            reason = (
                f"tool '{tool_name}' resolved via alias to '{canonical}'; "
                f"alias fallback path is Build-to-Delete"
            )

        result = MediationResult(
            requested_tool=tool_name,
            canonical_tool=canonical,
            args=sanitized_args,
            outcome=outcome,
            descriptor=descriptor,
            reason=reason,
        )
        self.audit_trail.append(result)
        logger.info(
            "Tool mediation completed",
            requested=tool_name,
            canonical=canonical,
            outcome=outcome.value,
        )
        return result

    @staticmethod
    def _sanitize_args(args: dict[str, Any]) -> dict[str, Any]:
        """脱敏调用参数（截断超长值，避免审计 trail 膨胀）。"""
        sanitized: dict[str, Any] = {}
        for k, v in args.items():
            if isinstance(v, str) and len(v) > 200:
                sanitized[k] = v[:200] + "...(truncated)"
            elif isinstance(v, (list, dict)):
                # 转字符串后截断
                s = str(v)
                if len(s) > 200:
                    sanitized[k] = s[:200] + "...(truncated)"
                else:
                    sanitized[k] = v
            else:
                sanitized[k] = v
        return sanitized

    def get_audit_trail(
        self, tool_name: Optional[str] = None
    ) -> list[MediationResult]:
        """获取审计 trail。

        Args:
            tool_name: 若指定，仅返回该工具的记录。

        Returns:
            审计记录列表（按时间顺序）。
        """
        if tool_name is None:
            return list(self.audit_trail)
        return [
            r for r in self.audit_trail
            if r.requested_tool == tool_name or r.canonical_tool == tool_name
        ]


__all__ = [
    "SafetyLevel",
    "MediationOutcome",
    "ToolDescriptor",
    "MediationResult",
    "ToolMediator",
]

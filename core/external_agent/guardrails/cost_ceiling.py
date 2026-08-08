"""L6 Cost Ceiling — 成本上限 Guardrail（EX-006）。

按 EX-006 实现三方 Agent 成本与配额管理：
    - 每Forgekin有三方 Agent 调用配额
    - 成本告警（接近上限时告警）
    - 成本分摊到任务

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-006 三方 Agent 成本与配额管理缺失
    - [doc:decisions/006-external-agent-integration.md] §6 安全治理 L6

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（cost_store 由 host 注入）
    - 编程红线 12：禁止绕过 DI 容器直接实例化

License: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Protocol

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.guardrails.cost_ceiling")


class CostStore(Protocol):
    """成本存储后端协议（DI 注入点）。"""

    async def get_usage(self, forgekin_id: str) -> dict[str, Any]:
        """获取某Forgekin的累计成本使用量。"""
        ...

    async def add_usage(
        self, forgekin_id: str, tokens: int, calls: int, cost: float
    ) -> None:
        """累加使用量。"""
        ...

    async def reset_usage(self, forgekin_id: str) -> None:
        """重置使用量（如配额周期重置）。"""
        ...


class CostCeilingConfig(BaseModel):
    """成本上限配置。"""

    # 每Forgekin的配额（默认值，可按Forgekin覆盖）
    default_token_quota: int = Field(
        default=1_000_000, description="默认 token 配额"
    )
    default_call_quota: int = Field(
        default=1000, description="默认调用次数配额"
    )
    default_cost_quota: float = Field(
        default=100.0, description="默认货币成本配额（美元）"
    )
    # 告警阈值（占配额的百分比）
    warn_threshold: float = Field(
        default=0.8, ge=0.0, le=1.0, description="告警阈值（80%）"
    )
    # 临界阈值（占配额的百分比，超过则拒绝）
    critical_threshold: float = Field(
        default=1.0, ge=0.0, le=1.0, description="临界阈值（100%）"
    )
    # 按Forgekin覆盖配额（key=forgekin_id）
    per_forgekin_quota: dict[str, dict[str, Any]] = Field(
        default_factory=dict, description="按Forgekin定制的配额"
    )


class CostCheckResult(BaseModel):
    """成本检查结果。"""

    allowed: bool = Field(..., description="是否允许调用")
    forgekin_id: str = Field(..., description="Forgekin ID")
    current_tokens: int = Field(default=0, description="当前 token 使用量")
    current_calls: int = Field(default=0, description="当前调用次数")
    current_cost: float = Field(default=0.0, description="当前货币成本")
    token_quota: int = Field(default=0, description="token 配额")
    call_quota: int = Field(default=0, description="调用次数配额")
    cost_quota: float = Field(default=0.0, description="货币成本配额")
    warning: str = Field(default="", description="告警信息")
    usage_ratio: float = Field(default=0.0, description="使用率（0.0-1.0+）")


class CostCeilingGuardrail:
    """L6 成本上限 Guardrail（EX-006）。

    每Forgekin有三方 Agent 调用配额，超过配额时拒绝调用。

    详见 [doc:review/review.md#第九章§9.2] EX-006

    配额维度：
        1. token 数：按 LLM token 计费（如 claude code）
        2. 调用次数：按 API 调用次数计费（如 codex）
        3. 货币成本：按订阅 / 使用量计费（如 trae）
    """

    def __init__(
        self,
        cost_store: CostStore,
        config: CostCeilingConfig | None = None,
    ) -> None:
        """注入成本存储和配置。

        Args:
            cost_store: 成本存储后端（SQLite / Redis / 内存字典）。
            config: 成本上限配置。
        """
        self._store = cost_store
        self._config = config or CostCeilingConfig()

    async def check(
        self,
        forgekin_id: str,
        estimated_tokens: int = 0,
        estimated_cost: float = 0.0,
    ) -> CostCheckResult:
        """检查是否允许调用（配额未超）。

        Args:
            forgekin_id: Forgekin ID。
            estimated_tokens: 本次预计 token 消耗。
            estimated_cost: 本次预计货币成本。

        Returns:
            CostCheckResult 检查结果。
        """
        usage = await self._store.get_usage(forgekin_id)
        current_tokens = int(usage.get("tokens", 0))
        current_calls = int(usage.get("calls", 0))
        current_cost = float(usage.get("cost", 0.0))

        # 获取配额（per_forgekin 优先，否则 default）
        quota = self._config.per_forgekin_quota.get(forgekin_id, {})
        token_quota = int(
            quota.get("token_quota", self._config.default_token_quota)
        )
        call_quota = int(
            quota.get("call_quota", self._config.default_call_quota)
        )
        cost_quota = float(
            quota.get("cost_quota", self._config.default_cost_quota)
        )

        # 预估使用量
        projected_tokens = current_tokens + estimated_tokens
        projected_calls = current_calls + 1
        projected_cost = current_cost + estimated_cost

        # 计算使用率（取三者最大值）
        token_ratio = projected_tokens / token_quota if token_quota > 0 else 0
        call_ratio = projected_calls / call_quota if call_quota > 0 else 0
        cost_ratio = projected_cost / cost_quota if cost_quota > 0 else 0
        max_ratio = max(token_ratio, call_ratio, cost_ratio)

        # 判断是否允许
        allowed = max_ratio < self._config.critical_threshold
        warning = ""
        if max_ratio >= self._config.critical_threshold:
            warning = (
                f"配额超限：token={projected_tokens}/{token_quota} "
                f"calls={projected_calls}/{call_quota} "
                f"cost={projected_cost:.2f}/{cost_quota:.2f}"
            )
            logger.warning(
                "cost_ceiling.exceeded forgekin=%s %s", forgekin_id, warning
            )
        elif max_ratio >= self._config.warn_threshold:
            warning = (
                f"配额告警：使用率 {max_ratio:.1%}，"
                f"token={projected_tokens}/{token_quota} "
                f"calls={projected_calls}/{call_quota} "
                f"cost={projected_cost:.2f}/{cost_quota:.2f}"
            )
            logger.info(
                "cost_ceiling.warn forgekin=%s ratio=%.2f", forgekin_id, max_ratio
            )

        return CostCheckResult(
            allowed=allowed,
            forgekin_id=forgekin_id,
            current_tokens=current_tokens,
            current_calls=current_calls,
            current_cost=current_cost,
            token_quota=token_quota,
            call_quota=call_quota,
            cost_quota=cost_quota,
            warning=warning,
            usage_ratio=max_ratio,
        )

    async def record_usage(
        self,
        forgekin_id: str,
        tokens: int,
        calls: int,
        cost: float,
    ) -> None:
        """记录实际使用量（调用完成后）。

        Args:
            forgekin_id: Forgekin ID。
            tokens: 本次实际 token 消耗。
            calls: 本次调用次数（通常为 1）。
            cost: 本次实际货币成本。
        """
        await self._store.add_usage(forgekin_id, tokens, calls, cost)
        logger.info(
            "cost_ceiling.record forgekin=%s tokens=%d calls=%d cost=%.4f",
            forgekin_id,
            tokens,
            calls,
            cost,
        )

    async def get_usage_report(self, forgekin_id: str) -> dict[str, Any]:
        """获取某Forgekin的成本使用报告（用于审计 / 成本分摊）。"""
        usage = await self._store.get_usage(forgekin_id)
        quota = self._config.per_forgekin_quota.get(forgekin_id, {})
        return {
            "forgekin_id": forgekin_id,
            "usage": usage,
            "quota": {
                "token_quota": quota.get(
                    "token_quota", self._config.default_token_quota
                ),
                "call_quota": quota.get(
                    "call_quota", self._config.default_call_quota
                ),
                "cost_quota": quota.get(
                    "cost_quota", self._config.default_cost_quota
                ),
            },
            "timestamp": datetime.now(UTC).isoformat(),
        }

    async def reset_quota(self, forgekin_id: str) -> None:
        """重置配额（如配额周期重置）。"""
        await self._store.reset_usage(forgekin_id)
        logger.info("cost_ceiling.reset forgekin=%s", forgekin_id)

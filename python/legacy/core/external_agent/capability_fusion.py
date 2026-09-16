"""ExternalAgentCapabilityFusion — 三方 Agent 能力融合机制（EX-010）。

Forgekin调用三方 Agent 后，三方 Agent 的能力应能"沉淀"到Forgekin的能力画像中。
如Forgekin多次调用 claude code 写代码后，应"学到"代码编写能力（通过SpiritForge蒸馏）。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-010 三方 Agent 与Forgekin能力融合机制缺失
    - [doc:decisions/006-external-agent-integration.md] §3 四大机制（F035）
    - [doc:design/naming-contract.md#2.7] SpiritForge / [doc:design/naming-contract.md#2.12] 能力画像

铁律遵守：
    - 铁律 3：依赖通过构造函数注入
    - 编程红线 9：使用组合表达融合策略
    - 不修改不相关代码（编程红线 7）

License: MIT
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.capability_fusion")


class FusionConfig(BaseModel):
    """能力融合配置（控制融合强度 / 阈值 / 衰减）。"""

    # 融合权重：外部能力对Forgekin主画像的影响系数（0.0-1.0）
    # 调用次数越多、成功率越高，融合权重越大（但不超过 max_weight）
    base_weight: float = Field(default=0.1, ge=0.0, le=1.0, description="基础融合权重")
    max_weight: float = Field(default=0.5, ge=0.0, le=1.0, description="最大融合权重")
    # 触发融合的最小调用次数（避免一次调用就"学到"能力）
    min_invocations: int = Field(default=3, ge=1, description="触发融合的最小调用次数")
    # 触发融合的最小成功率（避免从失败中"学到"错误能力）
    min_success_rate: float = Field(
        default=0.7, ge=0.0, le=1.0, description="触发融合的最小成功率"
    )
    # 盲点融合开关：是否同时融合三方 Agent 的盲点（用于跨厂商 review 配对）
    fuse_blind_spots: bool = Field(default=True, description="是否融合盲点")


class FusionResult(BaseModel):
    """能力融合结果。"""

    fused_profile: dict[str, Any] = Field(..., description="融合后的能力画像")
    fused: bool = Field(..., description="是否实际发生融合")
    fused_capabilities: list[str] = Field(
        default_factory=list, description="本次融合的能力列表"
    )
    fused_blind_spots: list[str] = Field(
        default_factory=list, description="本次融合的盲点列表"
    )
    fusion_weight: float = Field(default=0.0, description="本次融合的实际权重")
    reason: str = Field(default="", description="未融合原因（fused=False 时）")


class ExternalAgentCapabilityFusion:
    """三方 Agent 能力融合机制（EX-010）。

    Forgekin调用三方 Agent 后，三方 Agent 的能力应能"沉淀"到Forgekin的能力画像中。
    如Forgekin多次调用 claude code 写代码后，应"学到"代码编写能力（通过SpiritForge蒸馏）。

    详见 [doc:review/review.md#第九章§9.2] EX-010

    融合策略：
        1. 调用次数门槛：min_invocations 次以下不融合（避免一次调用"学到"）
        2. 成功率门槛：min_success_rate 以下不融合（避免从失败中学习）
        3. 权重渐进：weight = min(base * invocation_count, max_weight)
        4. 盲点同步：盲点同步到Forgekin画像，用于跨厂商 review 配对
        5. 不去重：原有能力保留，新能力追加（让SpiritForge后续蒸馏去重）
    """

    def __init__(self, config: FusionConfig | None = None) -> None:
        """注入融合配置。

        Args:
            config: 融合配置（None 时使用默认配置）。
        """
        self._config = config or FusionConfig()

    def fuse(
        self,
        forgekin_profile: dict[str, Any],
        external_agent_profile: dict[str, Any],
        invocation_count: int,
        success_rate: float,
    ) -> FusionResult:
        """融合三方 Agent 能力到Forgekin主画像。

        Args:
            forgekin_profile: Forgekin当前能力画像（含 capabilities / blind_spots）。
            external_agent_profile: 三方 Agent 能力画像（来自 Adapter.get_capability_profile）。
            invocation_count: 历史调用次数（用于门槛判断）。
            success_rate: 历史成功率（0.0-1.0）。

        Returns:
            FusionResult 融合结果（fused_profile 是融合后的新画像，调用方负责持久化）。
        """
        # 门槛检查
        if invocation_count < self._config.min_invocations:
            return FusionResult(
                fused_profile=forgekin_profile,
                fused=False,
                reason=(
                    f"invocation_count={invocation_count} < "
                    f"min={self._config.min_invocations}"
                ),
            )
        if success_rate < self._config.min_success_rate:
            return FusionResult(
                fused_profile=forgekin_profile,
                fused=False,
                reason=(
                    f"success_rate={success_rate:.2f} < "
                    f"min={self._config.min_success_rate:.2f}"
                ),
            )

        # 计算融合权重（渐进式，不超过 max_weight）
        weight = min(
            self._config.base_weight * invocation_count,
            self._config.max_weight,
        )

        # 融合能力（不去重，让SpiritForge后续蒸馏去重）
        existing_caps: list[str] = list(forgekin_profile.get("capabilities", []))
        external_caps: list[str] = list(
            external_agent_profile.get("capabilities", [])
        )
        new_caps = [c for c in external_caps if c not in existing_caps]
        fused_caps = existing_caps + new_caps

        # 融合盲点（用于跨厂商 review 配对）
        fused_blind_spots: list[str] = list(
            forgekin_profile.get("blind_spots", [])
        )
        new_blind_spots: list[str] = []
        if self._config.fuse_blind_spots:
            external_blind = list(external_agent_profile.get("blind_spots", []))
            new_blind_spots = [
                b for b in external_blind if b not in fused_blind_spots
            ]
            fused_blind_spots = fused_blind_spots + new_blind_spots

        # 构建融合后的画像（保留原画像其他字段）
        fused_profile: dict[str, Any] = {
            **forgekin_profile,
            "capabilities": fused_caps,
            "blind_spots": fused_blind_spots,
            # 记录融合历史（供SpiritForge SpiritForge 蒸馏使用）
            "fusion_history": list(forgekin_profile.get("fusion_history", [])) + [
                {
                    "external_agent": external_agent_profile.get(
                        "provider_name", "unknown"
                    ),
                    "fused_capabilities": new_caps,
                    "fused_blind_spots": new_blind_spots,
                    "weight": weight,
                    "invocation_count": invocation_count,
                    "success_rate": success_rate,
                }
            ],
        }

        logger.info(
            "fusion.fuse new_caps=%d new_blind_spots=%d weight=%.3f invocations=%d",
            len(new_caps),
            len(new_blind_spots),
            weight,
            invocation_count,
        )

        return FusionResult(
            fused_profile=fused_profile,
            fused=True,
            fused_capabilities=new_caps,
            fused_blind_spots=new_blind_spots,
            fusion_weight=weight,
        )

    def get_config(self) -> FusionConfig:
        """返回当前融合配置（供调试 / 测试使用）。"""
        return self._config

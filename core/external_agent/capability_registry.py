"""CapabilityRegistry — 三方 Agent 能力注册表（EAC v1 契约 4 Capability）。

能力声明与发现：注册每个 Provider 声明的 capability 及其 manifest 引用，
Forgekin通过 discover() 查询"谁能做 code_review"。

与 ProviderTransportRegistry 互补：
    - ProviderTransportRegistry 管"谁在线"（Provider 元数据 / 传输方式）
    - CapabilityRegistry 管"谁能做什么"（能力画像 / 成功率排序）

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-008 三方 Agent 能力发现机制缺失
    - [doc:design/naming-contract.md#2.12] 能力画像
    - [doc:design.md v7.1-§D6.2] EAC v1 七契约 #4 Capability

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（无外部依赖时构造函数留空）
    - 编程红线 11：配置驱动（capability / manifest_ref 来自 YAML，不硬编码）
    - 编程红线 12：禁止绕过 DI 容器直接实例化
    - 与 ProviderTransportRegistry 同步模式（in-memory 操作）

License: MIT
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.capability_registry")


class CapabilityEntry(BaseModel):
    """能力注册条目（单个 Provider 单个 capability）。

    Attributes:
        provider_name: 声明该能力的 Provider 名称。
        capability: 能力名称（如 "code_generation" / "code_review"）。
        manifest_ref: Manifest 引用（指向 Provider 声明式配置的子集）。
        registered_at: 注册时间（UTC）。
        success_rate: 历史成功率（0.0-1.0，默认 1.0，用于 get_best_provider 排序）。
    """

    provider_name: str = Field(..., description="Provider 名称")
    capability: str = Field(..., description="能力名称")
    manifest_ref: dict[str, Any] = Field(
        default_factory=dict, description="Manifest 引用（来自 YAML 配置）"
    )
    registered_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="注册时间（UTC）",
    )
    success_rate: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="历史成功率（用于 get_best_provider 排序）",
    )


class CapabilityRegistry:
    """三方 Agent 能力注册表（EAC v1 契约 4 Capability）。

    能力声明与发现：注册每个 Provider 声明的 capability 及其 manifest 引用，
    Forgekin通过 discover() 查询"谁能做 code_review"。

    详见 [doc:review/review.md#第九章§9.2] EX-008

    与 ProviderTransportRegistry 互补：
        - ProviderTransportRegistry 管"谁在线"
        - CapabilityRegistry 管"谁能做什么"

    设计要点：
        - 仅内存存储（dict[provider, dict[capability, entry]]）
        - get_best_provider 按 success_rate 降序返回最优 Provider
        - manifest_ref 不在本类内解析，由调用方按需读取
    """

    def __init__(self) -> None:
        """初始化空能力注册表。

        数据通过 register_capability 填充，由 DI 容器管理生命周期。
        """
        # 二级索引：provider_name -> capability -> CapabilityEntry
        self._capabilities: dict[str, dict[str, CapabilityEntry]] = {}

    def register_capability(
        self,
        provider_name: str,
        capability: str,
        manifest_ref: dict[str, Any],
    ) -> None:
        """注册一个能力（provider × capability 唯一）。

        若同一 provider × capability 已存在，则覆盖更新（支持热更新）。

        Args:
            provider_name: Provider 名称。
            capability: 能力名称。
            manifest_ref: Manifest 引用（来自 Provider YAML 配置的子集）。
        """
        provider_caps = self._capabilities.setdefault(provider_name, {})
        entry = CapabilityEntry(
            provider_name=provider_name,
            capability=capability,
            manifest_ref=manifest_ref,
        )
        provider_caps[capability] = entry
        logger.info(
            "capability.register provider=%s capability=%s",
            provider_name,
            capability,
        )

    def unregister_capability(
        self, provider_name: str, capability: str
    ) -> None:
        """注销一个能力。

        Args:
            provider_name: Provider 名称。
            capability: 能力名称。
        """
        provider_caps = self._capabilities.get(provider_name)
        if provider_caps is None:
            return
        if capability in provider_caps:
            del provider_caps[capability]
            logger.info(
                "capability.unregister provider=%s capability=%s",
                provider_name,
                capability,
            )
            # 若该 provider 已无任何能力，清理空字典
            if not provider_caps:
                del self._capabilities[provider_name]

    def discover(self, capability: str) -> list[CapabilityEntry]:
        """按能力发现 Provider 列表（EX-008 能力发现）。

        Args:
            capability: 能力名称（如 "code_review"）。

        Returns:
            匹配的 CapabilityEntry 列表（按 success_rate 降序）。
        """
        matched: list[CapabilityEntry] = []
        for provider_caps in self._capabilities.values():
            entry = provider_caps.get(capability)
            if entry is not None:
                matched.append(entry)
        matched.sort(key=lambda e: e.success_rate, reverse=True)
        logger.debug(
            "capability.discover capability=%s matched=%d",
            capability,
            len(matched),
        )
        return matched

    def list_capabilities(self, provider_name: str) -> list[str]:
        """列出某 Provider 声明的所有能力。

        Args:
            provider_name: Provider 名称。

        Returns:
            能力名称列表（无声明时返回空列表）。
        """
        provider_caps = self._capabilities.get(provider_name, {})
        return list(provider_caps.keys())

    def get_best_provider(
        self,
        capability: str,
        exclude: list[str] | None = None,
    ) -> CapabilityEntry | None:
        """按 success_rate 返回最优 Provider（EX-008 能力发现 + 排序）。

        Args:
            capability: 能力名称。
            exclude: 排除的 Provider 名称列表（用于 fallback 链跳过已失败 Provider）。

        Returns:
            最优 CapabilityEntry（无匹配时返回 None）。
        """
        exclude_set = set(exclude) if exclude else set()
        candidates = [
            e
            for e in self.discover(capability)
            if e.provider_name not in exclude_set
        ]
        if not candidates:
            return None
        # discover 已按 success_rate 降序，取第一个
        best = candidates[0]
        logger.debug(
            "capability.best capability=%s provider=%s success_rate=%.3f",
            capability,
            best.provider_name,
            best.success_rate,
        )
        return best

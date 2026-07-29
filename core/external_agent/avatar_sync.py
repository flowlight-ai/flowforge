"""AvatarSyncAdapter — Forgekin形象同步适配器（EAC v1 契约 7 Avatar Sync）。

Forgekin形象（persona）同步到三方 Agent：确保 claude code / codex / opencode / trae
在调用时使用一致的Forgekin身份（名称 / 性格 / 语音 / 头像）。

设计依据：
    - [doc:review/review.md#第九章§9.2] EX-002 能力画像（avatar 维度）
    - [doc:design/naming-contract.md#2.6] SoulImprint（forgekin_id 命名空间）
    - [doc:design.md v7.1-§D6.2] EAC v1 七契约 #7 Avatar Sync

铁律遵守：
    - 铁律 3：依赖通过构造函数注入（无外部依赖时构造函数留空）
    - 编程红线 11：配置驱动（AvatarSpec 字段来自Forgekin YAML 配置）
    - 编程红线 12：禁止绕过 DI 容器直接实例化
    - 骨架实现：sync_avatar 返回固定成功结构，不实际调用三方 Agent

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("external_agent.avatar_sync")


class AvatarSpec(BaseModel):
    """Forgekin形象规格（同步到三方 Agent 的 persona 数据）。

    与 [doc:design/naming-contract.md#2.6] SoulImprint一致，
    forgekin_id 作为命名空间键。

    Attributes:
        forgekin_id: Forgekin ID。
        name: Forgekin正式名称。
        nickname: 昵称。
        species: 物种（如 "code_dragon" / "research_owl"）。
        personality_summary: 性格摘要（一句话）。
        voice: 语音风格描述（如 "calm_analytical"）。
        avatar_uri: 头像资源 URI（图片 / Live2D 模型等）。
        blind_spots: 盲点列表（EX-002，决定谁该 review 谁）。
    """

    forgekin_id: str = Field(..., description="Forgekin ID")
    name: str = Field(..., description="Forgekin正式名称")
    nickname: str = Field(default="", description="昵称")
    species: str = Field(default="", description="物种")
    personality_summary: str = Field(default="", description="性格摘要")
    voice: str = Field(default="", description="语音风格描述")
    avatar_uri: str = Field(default="", description="头像资源 URI")
    blind_spots: list[str] = Field(
        default_factory=list, description="盲点列表（EX-002）"
    )


class SyncResult(BaseModel):
    """单个 Provider 的同步结果。

    Attributes:
        provider_name: 目标 Provider 名称。
        success: 是否同步成功。
        synced_at: 同步时间（UTC）。
        error: 失败时的错误信息。
    """

    provider_name: str = Field(..., description="Provider 名称")
    success: bool = Field(..., description="是否成功")
    synced_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="同步时间（UTC）",
    )
    error: Optional[str] = Field(default=None, description="错误信息")


class AvatarSyncAdapter:
    """Forgekin形象同步适配器（EAC v1 契约 7 Avatar Sync）。

    Forgekin形象同步到三方 Agent：确保 claude code / codex / opencode / trae
    在调用时使用一致的Forgekin身份。

    详见 [doc:review/review.md#第九章§9.2] EX-002 + [doc:design/naming-contract.md#2.6]

    设计要点：
        - 仅内存存储：dict[forgekin_id, dict[provider_name, AvatarSpec]]
        - sync_avatar 骨架实现：返回固定成功结构，不实际调用三方 Agent
        - get_synced_avatar 用于校验三方 Agent 是否使用最新 persona
    """

    def __init__(self) -> None:
        """初始化空形象同步表。

        数据通过 sync_avatar 填充，由 DI 容器管理生命周期。
        """
        # forgekin_id -> provider_name -> AvatarSpec
        self._synced: dict[str, dict[str, AvatarSpec]] = {}

    def sync_avatar(
        self,
        forgekin_id: str,
        avatar_spec: AvatarSpec,
        target_providers: list[str],
    ) -> dict[str, SyncResult]:
        """同步Forgekin形象到多个三方 Agent（骨架实现：固定成功）。

        实际实现应按 Provider 协议（如 system_prompt 注入 / avatar API 上传）
        将 avatar_spec 推送到目标 Provider。

        Args:
            forgekin_id: Forgekin ID。
            avatar_spec: Forgekin形象规格。
            target_providers: 目标 Provider 名称列表。

        Returns:
            按 provider_name 索引的 SyncResult 字典。
        """
        provider_map = self._synced.setdefault(forgekin_id, {})
        results: dict[str, SyncResult] = {}
        now = datetime.now(timezone.utc)
        for provider in target_providers:
            # 骨架实现：直接写入内存并返回成功
            provider_map[provider] = avatar_spec
            results[provider] = SyncResult(
                provider_name=provider,
                success=True,
                synced_at=now,
                error=None,
            )
        logger.info(
            "avatar.sync forgekin=%s providers=%d success=%d",
            forgekin_id,
            len(target_providers),
            sum(1 for r in results.values() if r.success),
        )
        return results

    def get_synced_avatar(
        self, forgekin_id: str, provider_name: str
    ) -> Optional[AvatarSpec]:
        """获取已同步到指定 Provider 的Forgekin形象。

        Args:
            forgekin_id: Forgekin ID。
            provider_name: Provider 名称。

        Returns:
            AvatarSpec（未同步时返回 None）。
        """
        provider_map = self._synced.get(forgekin_id)
        if provider_map is None:
            return None
        return provider_map.get(provider_name)

    def list_synced_providers(self, forgekin_id: str) -> list[str]:
        """列出已同步形象到哪些 Provider。

        Args:
            forgekin_id: Forgekin ID。

        Returns:
            Provider 名称列表（未同步时返回空列表）。
        """
        provider_map = self._synced.get(forgekin_id, {})
        return list(provider_map.keys())

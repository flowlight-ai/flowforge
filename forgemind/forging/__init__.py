"""育灵（Forge Nurturing）流水线包 — 灵智体锻造流水线。

育灵是灵智体从无到有、从弱到强的锻造过程。包括: 初始化身份 → 加载
基础能力 → 实战任务 → 经验蒸馏 → 形态进化。类似 clowder-ai 中
"养小猫"的范式扩展到"养万物"。

包含:
    - :class:`~flowforge.forgemind.forging.stages.ForgingStage` — 锻造
        阶段枚举（6 阶段）
    - :class:`~flowforge.forgemind.forging.pipeline.ForgePipeline` —
        锻造流水线主类

6 阶段流水线（详见 [doc:review/review.md#第九章] FM-006）::

    species_definition → capability_injection → memory_seeding →
    value_alignment → capability_verification → awakening_promotion

详见:
    - [doc:design/naming-contract.md#2.4] 育灵定义
    - [doc:review/review.md#第九章] FM-006 锻造流水线
"""

from flowforge.forgemind.forging.pipeline import ForgePipeline
from flowforge.forgemind.forging.stages import ForgingStage, ForgingStageResult

__all__ = ["ForgePipeline", "ForgingStage", "ForgingStageResult"]

"""HandoffCapsule — 交接胶囊（协议层硬要求）。

交接胶囊是 TeamAct 协作协议的协议层硬要求（不是可选的礼貌行为）。
前一个Forgekin在传球时主动留下结构化摘要，让后一个Forgekin接手时不需要重读全部上下文。

对应 roleagent.md §2.3：交接胶囊（resume capsule）
    "前一个 agent 在传球时主动留下结构化摘要：做了什么 / 为什么 / 权衡了什么 /
     开放问题 / 下一步。是协议层硬要求，不是可选礼貌。"

设计依据：
    - features/F002-teamact-loop.md §2.2 + AC-3
    - features/F003-handoff-capsule.md
    - roleagent.md §2.3

铁律遵守：
    - 铁律 3：不直接实例化外部服务
    - 铁律 5：无硬编码路径/密钥
    - 编程红线 9：使用 Pydantic 字段组合而非继承

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("teamact.handoff")


class HandoffCapsule(BaseModel):
    """交接胶囊 — Forgekin间协作的结构化交接摘要。

    交接胶囊是 TeamAct 协议层硬要求（roleagent.md §2.3）。
    前一个Forgekin在传球时必须留下结构化摘要，使后一个Forgekin无需重读全部上下文。

    字段同时满足：
        - 任务规格（capsule_id / from_agent / to_agent / task_summary /
          decisions_made / open_questions / next_step / context_snapshot / created_at）
        - F002 AC-3（summary / rationale / tradeoffs / open_questions / next_step）

    Attributes:
        capsule_id: 胶囊唯一标识（自动生成 UUID）。
        from_agent: 传出Forgekin（Forgekin）标识。
        to_agent: 接收Forgekin（Forgekin）标识。
        task_summary: 做了什么（任务摘要）。
        rationale: 为什么这样做（设计理由，F002 AC-3）。
        tradeoffs: 权衡了什么（取舍说明，F002 AC-3）。
        decisions_made: 已做决策列表。
        open_questions: 留下的开放问题列表（须 resolved 或升级，对应终止条件 4）。
        next_step: 下一步该做什么。
        context_snapshot: 上下文快照（关键状态键值对，便于接手者快速恢复）。
        created_at: 胶囊创建时间。
    """

    capsule_id: str = Field(
        default_factory=lambda: f"capsule-{uuid4().hex[:12]}",
        description="胶囊唯一标识",
    )
    from_agent: str = Field(..., description="传出Forgekin标识")
    to_agent: str = Field(..., description="接收Forgekin标识")
    task_summary: str = Field(..., description="任务摘要（做了什么）")
    rationale: str = Field(default="", description="设计理由（为什么这样做）")
    tradeoffs: str = Field(default="", description="取舍说明（权衡了什么）")
    decisions_made: list[str] = Field(
        default_factory=list, description="已做决策列表"
    )
    open_questions: list[str] = Field(
        default_factory=list, description="开放问题列表"
    )
    next_step: str = Field(..., description="下一步该做什么")
    context_snapshot: dict[str, Any] = Field(
        default_factory=dict, description="上下文快照"
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="胶囊创建时间",
    )

    def to_summary(self) -> str:
        """生成人类可读摘要。

        用于 trace 日志 / operator 展示 / MindCouncil议事时快速理解交接内容。
        格式参考 config/prompts.yaml 的 handoff_capsule.summary_template。
        """
        decisions = ", ".join(self.decisions_made) or "(none)"
        questions = ", ".join(self.open_questions) or "(none)"
        return (
            f"HandoffCapsule[{self.capsule_id}] "
            f"{self.from_agent} → {self.to_agent} | "
            f"summary: {self.task_summary} | "
            f"decisions: [{decisions}] | "
            f"open_questions: [{questions}] | "
            f"next_step: {self.next_step}"
        )

    def is_valid(self) -> bool:
        """校验胶囊完整性。

        交接胶囊是协议层硬要求，必须包含：
            - from_agent / to_agent 非空（有明确路由）
            - task_summary 非空（做了什么）
            - next_step 非空（下一步该做什么）
            - to_agent != from_agent（不能自己交给自己）

        Returns:
            True 表示胶囊完整可用，False 表示胶囊不完整。
        """
        if not self.from_agent or not self.to_agent:
            logger.warning(
                f"Capsule {self.capsule_id} invalid: missing from/to agent"
            )
            return False
        if not self.task_summary or not self.next_step:
            logger.warning(
                f"Capsule {self.capsule_id} invalid: missing summary or next_step"
            )
            return False
        if self.from_agent == self.to_agent:
            logger.warning(
                f"Capsule {self.capsule_id} invalid: from_agent == to_agent"
            )
            return False
        return True

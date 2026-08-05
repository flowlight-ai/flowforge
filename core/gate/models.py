"""FlowForge Gate 模型定义。

Gate 相关模型（GateVerdict、GateRecord、Score、GateStatus）和
工作流模型（TaskStatus、WorkflowType、WorkflowStep）
是 FlowForge 门控体系的核心数据结构，由各 gate 模块和 evaluator 共同使用。
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED_AT_GATE = "paused_at_gate"
    PASSED_GATE = "passed_gate"
    FAILED_GATE = "failed_gate"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    WAITING_REVIEW = "waiting_review"


class GateStatus(str, Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    PASSED = "passed"
    FAILED = "failed"
    WAIVED = "waived"
    TIMEOUT = "timeout"


class WorkflowType(str, Enum):
    GREENFIELD = "greenfield"
    FEATURE = "feature"
    CHANGE = "change"
    HOTFIX = "hotfix"


class Score(BaseModel):
    dimension: str = Field(description="评分维度名称")
    value: float = Field(ge=0.0, le=1.0, description="评分值")
    weight: float = Field(default=1.0, ge=0.0, le=1.0, description="权重")
    rationale: str = Field(default="", description="评分理由")
    suggestions: list[str] = Field(default_factory=list, description="改进建议")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="置信度")

    @property
    def weighted_value(self) -> float:
        return self.value * self.weight


class GateVerdict(BaseModel):
    gate_id: str
    gate_name: str = ""
    task_id: str
    status: GateStatus = GateStatus.PENDING
    scores: list[Score] = Field(default_factory=list)
    overall_score: float = Field(default=0.0, ge=0.0, le=1.0)
    pass_threshold: float = Field(default=0.7, ge=0.0, le=1.0)
    veto_dimensions_triggered: list[str] = Field(default_factory=list)
    decision: str = "pending"
    retry_count: int = 0
    goto_step: str | None = None
    reviewer_feedback: str = ""
    decided_at: datetime | None = None
    audit_entry: dict[str, Any] | None = None

    @property
    def is_passed(self) -> bool:
        return self.status == GateStatus.PASSED


class GateRecord(BaseModel):
    gate_id: str
    gate_name: str
    verdict: GateVerdict | None = None
    status: GateStatus = GateStatus.PENDING


class WorkflowStep(BaseModel):
    step_id: str
    step_name: str = ""
    agent_name: str = ""
    step_type: str = "agent"
    mode: str = "plan_execute"
    gate_config: dict[str, Any] | None = None
    gate_id: str | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    status: TaskStatus = TaskStatus.PENDING
    output_key: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)

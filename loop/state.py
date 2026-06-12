"""Loop State — Loop 执行过程中的独立状态模型。

LoopState 不污染 TaskContext，通过 CheckpointManager 持久化。
"""

from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class LoopPhase(str, Enum):
    """Loop 执行阶段。"""
    PLANNING = "planning"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    REFLECTING = "reflecting"
    COMPLETED = "completed"
    FAILED = "failed"


class Verdict(BaseModel):
    """Verifier 校验结果。"""
    passed: bool
    score: float = 0.0
    errors: list[str] = Field(default_factory=list)


class Reflection(BaseModel):
    """Reflector 复盘结果。"""
    suggestions: list[str] = Field(default_factory=list)
    root_cause: str = ""
    plan_adjustments: list[dict] = Field(default_factory=list)


class LoopState(BaseModel):
    """Loop 执行状态 — 独立于 TaskContext，通过 CheckpointManager 持久化。"""
    loop_id: str
    task_id: str
    template_name: str
    phase: LoopPhase = LoopPhase.PLANNING
    attempt: int = 0
    max_retries: int = 3
    current_plan: list[dict] | None = None
    past_errors: list[str] = Field(default_factory=list)
    verification_history: list[dict] = Field(default_factory=list)
    reflection_history: list[dict] = Field(default_factory=list)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LoopResult(BaseModel):
    """Loop 执行结果。"""
    success: bool
    output: dict | None = None
    error: str | None = None
    total_attempts: int = 0
    state: LoopState | None = None

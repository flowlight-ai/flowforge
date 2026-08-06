"""Pydantic data models for the self-evolution layer.

All models are immutable (frozen=True) where possible to prevent accidental
mutation after construction. datetime fields default to utcnow() and are
written by the engine, not by callers.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ScopeGuardSignal(BaseModel):
    """Mode A signal — detected scope deviation."""

    model_config = ConfigDict(frozen=True)

    signal_id: str
    detected_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    signal_type: Literal[
        "scope_creep",
        "out_of_scope",
        "magic_word",
        "frequency_breach",
        "high_risk_unauthorized",
    ]
    scope_baseline: str
    actual_behavior: str
    evidence: list[str] = Field(default_factory=list)
    severity: Literal["info", "warn", "block"] = "warn"
    magic_word: str | None = None


class ScopeGuardLog(BaseModel):
    """Persisted log entry emitted by ScopeGuard."""

    model_config = ConfigDict(frozen=True)

    log_id: str
    signal: ScopeGuardSignal
    action_taken: Literal["logged", "escalated", "blocked", "magic_word_triggered"]
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    note: str = ""


class EvolutionProposal(BaseModel):
    """Mode B proposal — process improvement (5-slot template)."""

    model_config = ConfigDict()

    proposal_id: str
    trigger_type: Literal[
        "repeated_error",
        "user_correction",
        "sop_gap",
        "review_systemic",
    ]
    target: str
    status: Literal["proposed", "accepted", "rejected", "retired"] = "proposed"
    # Five slots
    trigger: str
    evidence: list[str]
    root_cause: str
    lever: str  # one of LEVERAGE_ORDER
    verify: str
    # Lifecycle metadata
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    accepted_at: datetime | None = None
    commit_ref: str | None = None
    replay_check_due: datetime | None = None


class EpisodeCard(BaseModel):
    """Mode C L0 — high-value collaboration event snapshot."""

    model_config = ConfigDict()

    episode_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    task_snapshot: str
    evidence_map: dict[str, Any]
    decision_timeline: list[dict[str, Any]]
    collaboration_pivots: list[dict[str, Any]]
    transferable_method: str
    non_transferable_facts: str
    safety_boundary: str
    distillation_direction: Literal[
        "method_card",
        "skill_draft",
        "memory",
    ] = "method_card"


class MethodCard(BaseModel):
    """Mode C L2 — distilled method or skill draft."""

    model_config = ConfigDict()

    method_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    title: str
    domain: str
    knowledge_type: Literal["procedural", "declarative", "experiential"]
    scope: Literal["agent_local", "team", "org"]
    trust_level: Literal["experimental", "validated", "standard"]
    lifecycle: Literal["draft", "active", "deprecated"]
    content: str
    source_refs: list[str] = Field(default_factory=list)
    maturity_level: Literal["L0", "L1", "L2", "L3", "L4"] = "L2"


class EvalLedger(BaseModel):
    """Mode C — Replay A/B validation ledger."""

    model_config = ConfigDict()

    eval_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    method_id: str
    cases: list[dict[str, Any]]
    smoke_gate_passed: bool | None = None
    promotion_gate_passed: bool | None = None


class KnowledgeMaturityLevel(str, Enum):
    """Five-level maturity ladder."""

    L0_EPISODE = "L0"  # 原始记录
    L1_PATTERN = "L1"  # 草稿
    L2_DRAFT = "L2"  # Method Card / Skill Draft
    L3_VALIDATED = "L3"  # 正式 method/skill
    L4_STANDARD = "L4"  # 团队标准


class KnowledgeObject(BaseModel):
    """Generic knowledge object that flows through the maturity ladder."""

    model_config = ConfigDict()

    knowledge_id: str
    title: str
    domain: str
    maturity_level: KnowledgeMaturityLevel = KnowledgeMaturityLevel.L0_EPISODE
    content: str
    source_refs: list[str] = Field(default_factory=list)
    long_tail: bool = False  # 高风险/低频域允许长期停 L2/L3
    usage_count: int = 0
    agents_used: list[str] = Field(default_factory=list)
    recent_results: list[bool] = Field(default_factory=list)
    last_used_at: datetime | None = None
    frozen: bool = False

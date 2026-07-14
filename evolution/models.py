"""F100 Self-Evolution Data Models — Pydantic 数据模型。

移植自 clowder-ai 的自我进化机制，三模式共享：
- 五级知识成熟度阶梯 (KnowledgeMaturityLevel)
- 知识对象契约 (KnowledgeObject)
- 元认知路由信号

所有模型均为 Pydantic v2 BaseModel，用于数据校验和序列化。
"""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ScopeGuardSignal(Enum):
    """Scope Guard 偏离信号。

    - NOT_SERVING_VISION: 普通 — 新想法不直接服务当前愿景
    - NEW_JOURNEY: 强 — 新想法引入新的用户旅程/新页面/新子系统
    - NEW_DEPENDENCY: 强 — 新想法需要新的外部依赖/API/数据模型
    - UNCLEAR_VERIFICATION: 强 — 新想法导致"这次怎么验收"说不清了
    """

    NOT_SERVING_VISION = "not_serving_vision"
    NEW_JOURNEY = "new_journey"
    NEW_DEPENDENCY = "new_dependency"
    UNCLEAR_VERIFICATION = "unclear_verification"


class ScopeGuardLog(BaseModel):
    """Scope Guard 触发日志。"""

    date: datetime = Field(default_factory=datetime.utcnow)
    feature_id: str
    signal_type: str
    action_taken: str
    outcome: str
    agent: str


class EvolutionProposal(BaseModel):
    """Process Evolution 提案 — 5 槽模板。

    五槽：Trigger / Evidence / Root Cause / Lever / Verify
    硬护栏：证据 ≥2 源，最小杠杆优先，先修当前再提改进，提案要短。
    """

    proposal_id: str
    trigger_type: str  # "repeated_error" | "user_correction" | "sop_gap" | "review_systemic"
    target: str  # "sop" | "skill" | "rule" | "memory" | "system_prompt" | "l0"
    status: str = "proposed"  # "proposed" | "accepted" | "rejected" | "superseded"
    trigger: str
    evidence: list[str] = Field(default_factory=list)  # ≥2 sources
    root_cause: str
    lever: str  # minimal leverage
    verify: str  # verification method
    impact_assessment: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    accepted_at: datetime | None = None
    commit_ref: str = ""  # accepted → 必须关联 commit/PR
    replay_check_due: datetime | None = None  # 30 天验证


class EpisodeCard(BaseModel):
    """Episode Card — 高价值协作后的结构化事件快照。

    L0 原始记录，可蒸馏为 Method Card / Skill Draft / Memory。
    """

    episode_id: str
    task_snapshot: str  # 情境 + 风险等级
    evidence_map: dict = Field(default_factory=dict)  # 证据来源 + 可靠性
    decision_timeline: list[dict] = Field(default_factory=list)  # 推理转折点
    collaboration_pivots: list[dict] = Field(default_factory=list)  # human cue → AI interpretation → effect → lesson
    transferable_method: str  # 蒸馏种子
    non_transferable_facts: str
    safety_boundary: str
    distillation_direction: str = "method_card"  # "method_card" | "skill_draft" | "memory"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class MethodCard(BaseModel):
    """Method Card — 蒸馏后的可复用方法 (L2 Draft / L3 Validated)。

    knowledge_type: declarative | procedural | analytical | metacognitive
    trust_level: experimental | tested | validated | production
    lifecycle: draft | active | deprecated
    """

    method_id: str
    title: str
    domain: str  # "development" | "medical" | "legal" | etc.
    knowledge_type: str  # "declarative" | "procedural" | "analytical" | "metacognitive"
    scope: str  # "agent_local" | "team_shared"
    trust_level: str = "experimental"  # "experimental" | "tested" | "validated" | "production"
    lifecycle: str = "draft"  # "draft" | "active" | "deprecated"
    content: str
    source_refs: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    maturity_level: str = "L2"  # 关联五级阶梯


class EvalLedger(BaseModel):
    """Eval Ledger — Replay A/B 验证知识净增益。

    judge_rubric 四维：boundary_compliance / evidence_handling / knowledge_application / human_edit_volume
    Smoke gate: 3 cases, ≥2/3 pass
    Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类（标准成功/边界应升级/冲突反例）
    """

    eval_id: str
    method_id: str
    cases: list[dict] = Field(default_factory=list)  # A/B paired cases
    judge_rubric: dict = Field(
        default_factory=lambda: {
            "boundary_compliance": 0.0,
            "evidence_handling": 0.0,
            "knowledge_application": 0.0,
            "human_edit_volume": 0.0,
        }
    )
    smoke_gate_passed: bool = False
    promotion_gate_passed: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class KnowledgeMaturityLevel(Enum):
    """五级知识成熟度阶梯。

    | Level | 形态 | 晋升条件 |
    |-------|------|----------|
    | L0 Episode | 原始记录 | 模板完整，已分离可迁移/不可迁移 |
    | L1 Pattern | 草稿 | ≥2 个相似 episode（180天内），或人类要求；5Q ≥ 7/10 |
    | L2 Draft | Method Card / Skill Draft | smoke gate + promotion gate |
    | L3 Validated | 正式 method/skill | ≥6 uses，≥2 agents，≥80%，无 critical breach |
    | L4 Standard | 团队标准 | ≥12 uses，最近 10 次 ≥90%，用户批准 |
    """

    L0_EPISODE = "L0"
    L1_PATTERN = "L1"
    L2_DRAFT = "L2"
    L3_VALIDATED = "L3"
    L4_STANDARD = "L4"


class KnowledgeObject(BaseModel):
    """知识对象契约 — 统一描述所有进化产物。

    artifact_type: episode | method | skill | proposal | eval | lesson | log
    provenance.author_type: agent | human | collaborative
    """

    artifact_type: str  # episode | method | skill | proposal | eval | lesson | log
    domain: str
    knowledge_type: str
    scope: str  # "agent_local" | "team_shared"
    trust_level: str
    lifecycle: str  # "draft" | "active" | "deprecated" | "frozen"
    provenance: dict = Field(default_factory=dict)  # author_type: agent | human | collaborative
    source_refs: list[str] = Field(default_factory=list)
    maturity_level: str = "L0"

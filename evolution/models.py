"""F100 Self-Evolution Data Models — Pydantic 数据模型。

FlowForge 自我进化机制，三模式共享：
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
    """Eval Ledger — Replay A/B 验证知识净增益（进化级 Eval，CL-004）。

    与任务级 Eval（core/eval/）区分：
    - 任务级 Eval：评估单次任务执行质量（quality_score ≥ 0.85）
    - 进化级 Eval：评估进化提案的净增益（net_gain > 0 + 双门通过）

    judge_rubric 四维：boundary_compliance / evidence_handling / knowledge_application / human_edit_volume
    Smoke gate: 3 cases, ≥2/3 pass
    Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类（标准成功/边界应升级/冲突反例）

    详见 design.md v7.1-§D7.6。
    """

    eval_id: str
    method_id: str  # 关联 MethodCard.method_id（被评估的方法库/锻典条目）
    proposal_id: str = ""  # 关联 EvolutionProposal.proposal_id（CL-004 新增）
    pre_score: float = 0.0  # 前测分数（A 组，使用当前方法库条目）0.0~1.0（CL-004 新增）
    post_score: float = 0.0  # 后测分数（B 组，使用提案修改后的方法库条目）0.0~1.0（CL-004 新增）
    net_gain: float = 0.0  # 净增益 = post_score - pre_score，必须 > 0 才允许合入（CL-004 新增）
    cases: list[dict] = Field(default_factory=list)  # A/B paired cases（≥8：3 smoke + 5 promotion）
    judge_rubric: dict = Field(
        default_factory=lambda: {
            "boundary_compliance": 0.0,
            "evidence_handling": 0.0,
            "knowledge_application": 0.0,
            "human_edit_volume": 0.0,
        }
    )
    smoke_gate_passed: bool = False  # 3 cases, ≥2/3 pass
    promotion_gate_passed: bool = False  # 5 cases, ≥3/5 pass, 覆盖 3 类
    merged: bool = False  # net_gain > min_net_gain AND 双门通过（CL-004 新增）
    reject_reason: str = ""  # 拒绝原因（merged=False 时填充）（CL-004 新增）
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

    CL-005 七字段契约（v2 扩展，向后兼容）：
    - trigger: 触发条件（何时使用此知识）
    - procedure: 执行步骤（如何使用此知识）
    - precondition: 前置条件（使用前必须满足的条件）
    - postcondition: 后置条件（使用后必须达到的状态）
    - anti_pattern: 反模式（不应使用的场景）
    - provenance: 来源信息（已存在，扩展为含 author_type/timestamp/source 等）
    - confidence: 置信度 0.0~1.0（基于 L0~L4 成熟度阶梯映射）
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

    # ── CL-005 七字段契约（v2 扩展，所有新字段都有默认值，向后兼容） ──
    trigger: str = ""  # 触发条件：何时使用此知识（e.g., "用户询问代码审查时"）
    procedure: str = ""  # 执行步骤：如何使用此知识（e.g., "1. 读取代码 2. 检查风格 3. 给出建议"）
    precondition: str = ""  # 前置条件：使用前必须满足（e.g., "代码必须可编译"）
    postcondition: str = ""  # 后置条件：使用后必须达到（e.g., "建议必须包含行号引用"）
    anti_pattern: str = ""  # 反模式：不应使用的场景（e.g., "不要用于自动合入"）
    confidence: float = 0.0  # 置信度 0.0~1.0（基于成熟度阶梯映射：L0=0.2, L1=0.4, L2=0.6, L3=0.8, L4=1.0）

    def compute_confidence_from_maturity(self) -> float:
        """根据 maturity_level 计算置信度（CL-005 映射规则）.

        L0_EPISODE → 0.2
        L1_PATTERN → 0.4
        L2_DRAFT → 0.6
        L3_VALIDATED → 0.8
        L4_STANDARD → 1.0
        """
        mapping = {
            KnowledgeMaturityLevel.L0_EPISODE.value: 0.2,
            KnowledgeMaturityLevel.L1_PATTERN.value: 0.4,
            KnowledgeMaturityLevel.L2_DRAFT.value: 0.6,
            KnowledgeMaturityLevel.L3_VALIDATED.value: 0.8,
            KnowledgeMaturityLevel.L4_STANDARD.value: 1.0,
        }
        return mapping.get(self.maturity_level, 0.2)

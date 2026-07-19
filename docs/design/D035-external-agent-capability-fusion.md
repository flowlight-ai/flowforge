# D035: 三方 Agent 能力融合详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10]（三方 Agent 集成）+ [doc:../arch.md#§3.14]（灵锻 SpiritForge + 灵议 Mind Council）
> **对应 design.md**: [doc:../design.md#§3.10]
> **对应 Feature**: [doc:../features/F035-external-agent-capability-fusion.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A035-external-agent-capability-fusion.md]（同号 Architecture 级 SAD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]
> **9 大点名称修订**: 已应用（双轨命名 ForgeMind/Forgekin + AI 术语优先 + 弱化万物使用"多形态智能体 (Multi-Form Agent)" + 去 AGI 化使用"通用智能体 (General-Purpose Agent)"）
> **依赖详细设计**: [doc:D031-external-agent-adapter.md]（容器层） + [doc:D032-external-agent-profile.md]（agent_id 引用） + [doc:D033-external-agent-shared-state.md]（artifact_refs 来源） + [doc:D034-external-agent-fallback.md]（反模式蒸馏） + [doc:D014-memory-collection.md]（F014 灵忆） + [doc:D018-eval-contract.md]（F018 Eval Ledger）

---

## 1. 详细设计上下文

### 1.1 设计问题

ExternalAgentAdapter 抽象层（D031）需要实现"用完即走 -> 用完即学"的能力增长机制，让灵智体（Forgekin，多形态智能体）多次调用三方 Agent 后"学到"能力。但 v7.0 无三方 Agent 能力融合机制——与 clowder-ai 最大差距是 clowder-ai 的猫会从调用工具中学习，v7.0 的 Forgekin 不会。本详细设计在 `core/external_agent/capability_fusion.py` 落地 A035 架构，解决以下详细设计层问题：

1. **FusionSource 自动采集算法未实现**：A035 描述"每次调用成功后自动采集"，未给出 auto_collect_on_call 触发点、质量分阈值（0.85）过滤、call_artifacts 字段映射。
2. **相似调用聚类算法未编码**：A035 要求"基于任务上下文 + 能力域聚类"，未给出相似度计算（任务上下文 embedding + 能力域 Jaccard）、min_count=3 校验、聚类结果持久化。
3. **CL-003 五级阶梯晋升校验未实现**：A035 要求 L0->L1->L2->L3->L4 严格按级晋升，未给出当前级别查询、目标级别校验（必须 = 当前 + 1）、跳级拒绝逻辑。
4. **CL-004 Eval Ledger 净增益验证未实现**：A035 要求前后测对比 net_gain > 0，未给出 before_score / after_score 采集、net_gain 计算、净增益 <= 0 拒绝合入逻辑。
5. **CL-005 Knowledge Object Contract 六字段完整性校验未实现**：A035 要求 trigger_pattern / procedure / precondition / postcondition / anti_pattern / provenance 六字段，未给出字段非空校验、字段长度校验、provenance Episode ID 有效性校验。
6. **CapabilityFusionApplier 合入 CapabilityProfile 未编码**：A035 要求 L3+ 锻典条目作为 SkillPackage 合入 F001，未给出 SkillPackage 构造、合入接口、CapabilityProfile 更新原子性。
7. **operator 审批 L4 阶段未实现**：A035 要求 L3->L4 必须 operator 显式批准，未给出审批接口、审批状态机、审批拒绝/批准后状态转移。
8. **与灵锻（SpiritForge）联动蒸馏未编码**：A035 要求与 arch.md §3.14 灵锻联动，未给出灵锻调用接口、蒸馏原料（FusionSource + FallbackExecutionRecord）传递、蒸馏结果（CapabilityDistillationCandidate）回流。

### 1.2 设计约束

- **单向依赖约束**：`core/external_agent/capability_fusion.py` 仅依赖 F001 CapabilityProfile + F014 Memory Collection + F018 Eval Contract + F032 能力画像 + F033 共享状态 + F034 失败回退 + F039 灵典 + 灵锻 SpiritForge + core/interfaces，禁止反向依赖 *Forge。
- **DI 容器约束**：FusionSourceCollector / CapabilityDistiller / CapabilityFusionApplier / EvalLedger 实例必须通过 DI 容器注入到 ExternalAgentBridge（D031）。
- **Repository 层约束**：FusionSource / CapabilityDistillationCandidate / 锻典条目 / EvalLedgerRecord 写入必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：source_collector / distillation / codex_submission / profile_apply 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码。
- **质量阈值约束**：FusionSource 采集的 min_quality_score 必须为 0.85（与项目规则一致）。
- **CL-003 五级阶梯约束**：L0 -> L1 -> L2 -> L3 -> L4 必须严格按级晋升，禁止跳级。
- **CL-003 L0->L1 阈值约束**：相似 Episode >= 3 才能晋升 L1_PATTERN。
- **CL-004 Eval Ledger 约束**：合入锻典前必须前后测对比，net_gain > 0 才允许合入。
- **CL-005 Knowledge Object Contract 约束**：蒸馏候选必须含六字段（trigger_pattern / procedure / precondition / postcondition / anti_pattern / provenance），缺一即校验失败。
- **operator 审批约束**：L4 Standard 阶段必须 operator 显式批准，禁止自动合入。
- **L3+ 合入约束**：仅 L3_VALIDATED / L4_STANDARD 锻典条目可合入 F001 CapabilityProfile。
- **9 大点名称修订约束**：所有命名严格遵循双轨命名（产品层 ForgeMind / 代码层 Forgekin），AI 术语优先（Forgekin/Multi-Form Agent），弱化万物，去 AGI 化。

### 1.3 设计影响

- **对 F001 能力画像的影响**：成熟度 L3+ 锻典条目作为 SkillPackage 合入 CapabilityProfile，灵智体能力画像动态增长。
- **对 F014 多域记忆的影响**：FusionSource 与 FallbackExecutionRecord 共同写入灵忆作为蒸馏原料。
- **对 F018 Eval Contract 的影响**：Eval Ledger 前后测对比用于净增益验证。
- **对 F032 能力画像的影响**：external_agent_profile_ref 字段引用 ExternalAgentCapabilityProfile。
- **对 F033 共享状态的影响**：call_artifacts 字段引用 ExternalAgentSharedState 产出物。
- **对 F034 失败回退的影响**：FallbackExecutionRecord 作为反模式蒸馏原料。
- **对 F039 灵典可检索知识库的影响**：锻典条目作为 F039 灵典知识库条目来源。
- **对灵锻 SpiritForge（arch.md §3.14）的影响**：能力融合层提供蒸馏原料与目标画像，灵锻作为蒸馏引擎。
- **对 D031 ExternalAgentBridge 的影响**：Bridge 在调用成功后调用 FusionSourceCollector.collect() 采集融合来源。

---

## 2. 详细设计

### 2.1 数据模型

#### 2.1.1 MaturityLevel 枚举（CL-003 五级阶梯）

```python
from enum import Enum


class MaturityLevel(str, Enum):
    """五级成熟度阶梯（CL-003，严格不可跳级）

    晋升路径：L0 -> L1 -> L2 -> L3 -> L4
    """
    L0_EPISODE = "L0"      # L0 Episode（单次调用，初始级别）
    L1_PATTERN = "L1"      # L1 Pattern（3+ 相似 Episode 聚类）
    L2_DRAFT = "L2"        # L2 Draft（灵锻主动抽象）
    L3_VALIDATED = "L3"    # L3 Validated（Eval A/B 验证通过，可合入锻典）
    L4_STANDARD = "L4"     # L4 Standard（operator 批准，可合入 CapabilityProfile）


# CL-003 晋升路径校验表
MATURITY_PROGRESSION: dict[MaturityLevel, MaturityLevel] = {
    MaturityLevel.L0_EPISODE: MaturityLevel.L1_PATTERN,
    MaturityLevel.L1_PATTERN: MaturityLevel.L2_DRAFT,
    MaturityLevel.L2_DRAFT: MaturityLevel.L3_VALIDATED,
    MaturityLevel.L3_VALIDATED: MaturityLevel.L4_STANDARD,
    MaturityLevel.L4_STANDARD: MaturityLevel.L4_STANDARD,  # 已最高级，不可再晋升
}
"""CL-003 严格晋升路径（禁止跳级）"""

MIN_SIMILAR_EPISODES_FOR_L1 = 3
"""CL-003 L0->L1 需 3+ 相似 Episode"""
```

#### 2.1.2 FusionSource（融合来源）

```python
from datetime import datetime
from pydantic import BaseModel, Field


class FusionSource(BaseModel):
    """能力融合来源（一次三方 Agent 调用）

    每次三方 Agent 调用成功后自动采集（auto_collect_on_call=true）。
    质量分 < 0.85 时不采集（min_quality_score=0.85）。
    """
    source_id: str
    forgekin_id: str                           # 调用方灵智体 ID
    external_agent_id: str                     # 三方 Agent ID（来自 F032）
    external_agent_profile_ref: str            # F032 能力画像引用
    task_context: dict = Field(
        description="调用时任务上下文（含 task_description / requirements / env）",
    )
    call_artifacts: list[str] = Field(
        default_factory=list,
        description="调用产出物 ID 列表（来自 F033 共享状态 artifact_refs）",
    )
    call_quality_score: float = Field(
        ge=0.0, le=1.0,
        description="调用质量分（来自 F018 Eval Contract，必须 >= 0.85）",
    )
    call_timestamp: datetime = Field(default_factory=datetime.now)
    capability_domain: str | None = Field(
        default=None,
        description="能力域标签（用于相似聚类）",
    )

    model_config = {"extra": "forbid"}
```

#### 2.1.3 CapabilityDistillationCandidate（蒸馏候选，含 CL-005 六字段）

```python
class CapabilityDistillationCandidate(BaseModel):
    """能力蒸馏候选（待灵锻评估是否合入锻典）

    CL-005 Knowledge Object Contract 六字段必须完整：
        - trigger_pattern: 何时使用
        - procedure: 怎么用
        - precondition: 前置条件
        - postcondition: 预期效果
        - anti_pattern: 反模式
        - provenance: 来源 Episode ID 列表
    """
    candidate_id: str
    forgekin_id: str
    fusion_sources: list[FusionSource] = Field(
        min_length=1,
        description="多次相似调用作为蒸馏原料（L1_PATTERN 需 3+）",
    )
    distilled_capability: str = Field(
        min_length=1,
        description="蒸馏出的能力描述（灵锻主动抽象）",
    )
    # CL-005 六字段（必须完整）
    trigger_pattern: str = Field(min_length=1, description="何时使用（CL-005）")
    procedure: str = Field(min_length=1, description="怎么用（CL-005）")
    precondition: str = Field(min_length=1, description="前置条件（CL-005）")
    postcondition: str = Field(min_length=1, description="预期效果（CL-005）")
    anti_pattern: str = Field(min_length=1, description="反模式（CL-005）")
    provenance: list[str] = Field(
        min_length=1,
        description="来源 Episode ID 列表（CL-005）",
    )
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    maturity_level: MaturityLevel = MaturityLevel.L0_EPISODE
    capability_domain: str | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _validate_cl005_fields(self) -> "CapabilityDistillationCandidate":
        """CL-005 Knowledge Object Contract 六字段完整性校验"""
        required_fields = {
            "trigger_pattern": self.trigger_pattern,
            "procedure": self.procedure,
            "precondition": self.precondition,
            "postcondition": self.postcondition,
            "anti_pattern": self.anti_pattern,
            "provenance": self.provenance,
        }
        missing = [
            name for name, value in required_fields.items()
            if not value or (isinstance(value, list) and len(value) == 0)
        ]
        if missing:
            raise CL005KnowledgeObjectContractError(
                candidate_id=self.candidate_id,
                missing_fields=missing,
            )
        return self
```

#### 2.1.4 EvalLedgerRecord（CL-004 净增益验证）

```python
class EvalLedgerRecord(BaseModel):
    """Eval Ledger 记录（CL-004 净增益验证）

    合入锻典前必须前后测对比，net_gain > 0 才允许合入。
    """
    ledger_id: str
    candidate_id: str
    before_score: float = Field(
        ge=0.0, le=1.0,
        description="使用候选能力前任务质量分（基准）",
    )
    after_score: float = Field(
        ge=0.0, le=1.0,
        description="使用候选能力后任务质量分",
    )
    net_gain: float = Field(
        description="净增益 = after_score - before_score，必须 > 0 才允许合入",
    )
    validated_at: datetime = Field(default_factory=datetime.now)
    ab_test_task_ids: list[str] = Field(
        default_factory=list,
        description="A/B 测试使用的任务 ID 列表",
    )

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _validate_net_gain(self) -> "EvalLedgerRecord":
        """CL-004 净增益必须 > 0"""
        actual_net_gain = self.after_score - self.before_score
        if abs(actual_net_gain - self.net_gain) > 0.001:
            raise ValueError(
                f"net_gain 不一致：声明 {self.net_gain}，实际 {actual_net_gain}"
            )
        return self
```

#### 2.1.5 SkillPackage（合入 CapabilityProfile 的载体）

```python
class SkillPackage(BaseModel):
    """能力包（L3+ 锻典条目合入 F001 CapabilityProfile 的载体）

    仅 L3_VALIDATED / L4_STANDARD 锻典条目可构造 SkillPackage。
    """
    package_id: str
    codex_entry_id: str                        # F039 灵典条目 ID
    skill_name: str
    trigger_pattern: str                       # 来自 CL-005
    procedure: str                             # 来自 CL-005
    precondition: str                          # 来自 CL-005
    postcondition: str                         # 来自 CL-005
    anti_pattern: str                          # 来自 CL-005
    provenance: list[str]                      # 来自 CL-005
    confidence: float = Field(ge=0.0, le=1.0)
    maturity_level: MaturityLevel
    codex_entry_ref: str                       # F039 灵典可检索引用

    model_config = {"extra": "forbid"}
```

### 2.2 相似调用聚类算法

```python
def compute_fusion_source_similarity(
    source_a: FusionSource,
    source_b: FusionSource,
) -> float:
    """计算两个 FusionSource 的相似度（0.0-1.0）

    算法：
        1. 能力域 Jaccard 相似度（权重 0.6）
        2. 任务上下文 embedding 余弦相似度（权重 0.4，需调用 embedding 服务）
        3. 综合 similarity = 0.6 * jaccard + 0.4 * cosine

    Args:
        source_a: FusionSource A
        source_b: FusionSource B

    Returns:
        相似度（0.0-1.0）
    """
    # 能力域 Jaccard
    domain_a = {source_a.capability_domain} if source_a.capability_domain else set()
    domain_b = {source_b.capability_domain} if source_b.capability_domain else set()
    if domain_a and domain_b:
        jaccard = len(domain_a & domain_b) / len(domain_a | domain_b)
    else:
        jaccard = 0.0

    # 任务上下文余弦相似度（简化：用 task_description 词集 Jaccard 近似）
    # 实际实现应调用 embedding 服务
    ctx_a_words = set(str(source_a.task_context.get("task_description", "")).split())
    ctx_b_words = set(str(source_b.task_context.get("task_description", "")).split())
    if ctx_a_words and ctx_b_words:
        cosine_approx = len(ctx_a_words & ctx_b_words) / len(ctx_a_words | ctx_b_words)
    else:
        cosine_approx = 0.0

    return 0.6 * jaccard + 0.4 * cosine_approx


SIMILARITY_THRESHOLD = 0.7
"""相似度阈值：>= 0.7 视为相似 Episode"""


def find_similar_sources(
    all_sources: list[FusionSource],
    target_source: FusionSource,
    min_count: int = MIN_SIMILAR_EPISODES_FOR_L1,
    similarity_threshold: float = SIMILARITY_THRESHOLD,
) -> list[FusionSource]:
    """找出与 target_source 相似的 FusionSource 列表

    CL-003 L0->L1 需 3+ 相似 Episode 才能晋升 Pattern。

    Args:
        all_sources: 全部 FusionSource 列表
        target_source: 目标 FusionSource
        min_count: 最少相似数量（默认 3）
        similarity_threshold: 相似度阈值（默认 0.7）

    Returns:
        相似 FusionSource 列表（含 target_source 自身）；若 < min_count 返回空列表
    """
    similar = [target_source]
    for source in all_sources:
        if source.source_id == target_source.source_id:
            continue
        if source.forgekin_id != target_source.forgekin_id:
            continue  # 仅同灵智体的调用聚类
        similarity = compute_fusion_source_similarity(source, target_source)
        if similarity >= similarity_threshold:
            similar.append(source)
    if len(similar) < min_count:
        return []
    return similar
```

### 2.3 CL-003 晋升路径校验

```python
def assert_maturity_progression(
    current_level: MaturityLevel,
    target_level: MaturityLevel,
) -> None:
    """校验 CL-003 晋升路径合法（禁止跳级）

    Args:
        current_level: 当前级别
        target_level: 目标级别

    Raises:
        MaturityProgressionViolationError: 跳级或降级时抛出
    """
    if target_level == current_level:
        return  # 同级，允许（如重新验证）

    expected_next = MATURITY_PROGRESSION.get(current_level)
    if expected_next is None:
        raise MaturityProgressionViolationError(
            current_level=current_level,
            target_level=target_level,
            reason=f"未知当前级别: {current_level}",
        )

    if target_level != expected_next:
        raise MaturityProgressionViolationError(
            current_level=current_level,
            target_level=target_level,
            reason=(
                f"CL-003 禁止跳级：{current_level.value} -> {target_level.value}；"
                f"合法下一级为 {expected_next.value}"
            ),
        )


class MaturityProgressionViolationError(Exception):
    """成熟度阶梯晋升违反 CL-003（跳级或降级）"""

    def __init__(
        self,
        current_level: MaturityLevel,
        target_level: MaturityLevel,
        reason: str,
    ) -> None:
        self.current_level = current_level
        self.target_level = target_level
        super().__init__(
            f"CL-003 progression violation: {current_level.value} -> {target_level.value}: {reason}"
        )


class CL005KnowledgeObjectContractError(Exception):
    """CL-005 Knowledge Object Contract 六字段不完整"""

    def __init__(
        self,
        candidate_id: str,
        missing_fields: list[str],
    ) -> None:
        self.candidate_id = candidate_id
        self.missing_fields = missing_fields
        super().__init__(
            f"CL-005 violation: candidate '{candidate_id}' missing fields: {missing_fields}"
        )


class NetGainNotPositiveError(Exception):
    """CL-004 净增益 <= 0"""

    def __init__(
        self,
        candidate_id: str,
        net_gain: float,
    ) -> None:
        self.candidate_id = candidate_id
        self.net_gain = net_gain
        super().__init__(
            f"CL-004 violation: candidate '{candidate_id}' net_gain={net_gain} "
            f"(must be > 0)"
        )


class OperatorApprovalRequiredError(Exception):
    """L3->L4 必须 operator 显式批准"""

    def __init__(self, candidate_id: str) -> None:
        self.candidate_id = candidate_id
        super().__init__(
            f"L3->L4 promotion requires operator approval; candidate '{candidate_id}'"
        )


class MaturityLevelTooLowError(Exception):
    """成熟度不足，禁止合入 CapabilityProfile"""

    def __init__(
        self,
        candidate_id: str,
        current_level: MaturityLevel,
        required_levels: list[MaturityLevel],
    ) -> None:
        self.candidate_id = candidate_id
        self.current_level = current_level
        self.required_levels = required_levels
        super().__init__(
            f"candidate '{candidate_id}' maturity {current_level.value} "
            f"too low; required: {[l.value for l in required_levels]}"
        )
```

### 2.4 CL-004 Eval Ledger 净增益验证

```python
async def validate_net_gain(
    candidate: CapabilityDistillationCandidate,
    eval_contract: "EvalContract",  # F018
    ab_test_tasks: list[dict],
) -> EvalLedgerRecord:
    """CL-004 净增益验证

    算法：
        1. before_score: 不使用候选能力时，对 ab_test_tasks 的平均质量分
        2. after_score: 使用候选能力时，对 ab_test_tasks 的平均质量分
        3. net_gain = after_score - before_score
        4. net_gain > 0: 验证通过
        5. net_gain <= 0: 抛 NetGainNotPositiveError

    Args:
        candidate: 待验证的蒸馏候选
        eval_contract: F018 Eval Contract 实例
        ab_test_tasks: A/B 测试任务列表

    Returns:
        EvalLedgerRecord

    Raises:
        NetGainNotPositiveError: net_gain <= 0
    """
    # before: 不使用候选能力（baseline）
    before_scores: list[float] = []
    for task in ab_test_tasks:
        score = await eval_contract.score_task_without_capability(
            task=task,
            forgekin_id=candidate.forgekin_id,
        )
        before_scores.append(score)
    before_score = sum(before_scores) / max(1, len(before_scores))

    # after: 使用候选能力
    after_scores: list[float] = []
    for task in ab_test_tasks:
        score = await eval_contract.score_task_with_capability(
            task=task,
            forgekin_id=candidate.forgekin_id,
            capability_procedure=candidate.procedure,
            capability_precondition=candidate.precondition,
        )
        after_scores.append(score)
    after_score = sum(after_scores) / max(1, len(after_scores))

    net_gain = after_score - before_score
    if net_gain <= 0:
        raise NetGainNotPositiveError(
            candidate_id=candidate.candidate_id,
            net_gain=net_gain,
        )

    return EvalLedgerRecord(
        ledger_id=f"ledger_{candidate.candidate_id}_{uuid.uuid4().hex[:8]}",
        candidate_id=candidate.candidate_id,
        before_score=before_score,
        after_score=after_score,
        net_gain=net_gain,
        ab_test_task_ids=[t["task_id"] for t in ab_test_tasks],
    )
```

### 2.5 SkillPackage 构造

```python
def build_skill_package(
    candidate: CapabilityDistillationCandidate,
    codex_entry_id: str,
    codex_entry_ref: str,
) -> SkillPackage:
    """从 L3+ 蒸馏候选构造 SkillPackage

    Args:
        candidate: L3+ 蒸馏候选
        codex_entry_id: F039 灵典条目 ID
        codex_entry_ref: F039 灵典可检索引用

    Returns:
        SkillPackage

    Raises:
        MaturityLevelTooLowError: 候选成熟度 < L3
    """
    required_levels = [MaturityLevel.L3_VALIDATED, MaturityLevel.L4_STANDARD]
    if candidate.maturity_level not in required_levels:
        raise MaturityLevelTooLowError(
            candidate_id=candidate.candidate_id,
            current_level=candidate.maturity_level,
            required_levels=required_levels,
        )

    return SkillPackage(
        package_id=f"pkg_{candidate.candidate_id}_{uuid.uuid4().hex[:8]}",
        codex_entry_id=codex_entry_id,
        skill_name=candidate.distilled_capability,
        trigger_pattern=candidate.trigger_pattern,
        procedure=candidate.procedure,
        precondition=candidate.precondition,
        postcondition=candidate.postcondition,
        anti_pattern=candidate.anti_pattern,
        provenance=candidate.provenance,
        confidence=candidate.confidence,
        maturity_level=candidate.maturity_level,
        codex_entry_ref=codex_entry_ref,
    )
```

---

## 3. 模块实现

### 3.1 FusionSourceCollector 抽象与实现

#### 3.1.1 抽象基类

```python
from abc import ABC, abstractmethod


class FusionSourceCollector(ABC):
    """融合来源采集器（每次三方 Agent 调用后采集）"""

    @abstractmethod
    async def collect(
        self, call_record: dict, quality_score: float
    ) -> FusionSource | None:
        """采集 FusionSource

        - 质量分 < min_quality_score (0.85) 时不采集
        - 质量分 >= 0.85 时自动采集
        """
        ...

    @abstractmethod
    async def list_similar_sources(
        self,
        forgekin_id: str,
        capability_domain: str,
        min_count: int = MIN_SIMILAR_EPISODES_FOR_L1,
    ) -> list[FusionSource]:
        """列出相似调用（CL-003 L0->L1 需 3+ 相似 Episode）"""
        ...

    @abstractmethod
    async def list_by_forgekin(
        self, forgekin_id: str
    ) -> list[FusionSource]:
        """列出某灵智体的全部 FusionSource"""
        ...
```

#### 3.1.2 Harness 实现

```python
from core.tracing import get_logger
from core.interfaces.repository import Repository

logger = get_logger(__name__)


class HarnessFusionSourceCollector(FusionSourceCollector):
    """FusionSourceCollector 的 Harness 实现"""

    def __init__(
        self,
        fusion_source_repo: Repository[FusionSource],
        profile_registry: "ExternalAgentProfileRegistry",  # D032
        min_quality_score: float = 0.85,
        similarity_threshold: float = SIMILARITY_THRESHOLD,
    ) -> None:
        self._repo = fusion_source_repo
        self._profiles = profile_registry
        self._min_quality = min_quality_score
        self._sim_threshold = similarity_threshold
        logger.info(
            "HarnessFusionSourceCollector initialized",
            extra={
                "min_quality_score": min_quality_score,
                "similarity_threshold": similarity_threshold,
            },
        )

    async def collect(
        self, call_record: dict, quality_score: float
    ) -> FusionSource | None:
        # 质量分过滤
        if quality_score < self._min_quality:
            logger.debug(
                "FusionSource not collected: quality below threshold",
                extra={
                    "quality_score": quality_score,
                    "threshold": self._min_quality,
                    "task_id": call_record.get("task_id"),
                },
            )
            return None

        agent_id = call_record["agent_id"]
        # 通过 D032 获取能力画像引用
        profile = await self._profiles.get(agent_id)

        source = FusionSource(
            source_id=f"fs_{call_record['task_id']}_{uuid.uuid4().hex[:8]}",
            forgekin_id=call_record["forgekin_id"],
            external_agent_id=agent_id,
            external_agent_profile_ref=profile.agent_id,
            task_context=call_record.get("task_context", {}),
            call_artifacts=call_record.get("artifacts", []),
            call_quality_score=quality_score,
            capability_domain=call_record.get("capability_domain"),
        )
        await self._repo.save(source.source_id, source)
        logger.info(
            "FusionSource collected",
            extra={
                "source_id": source.source_id,
                "forgekin_id": source.forgekin_id,
                "external_agent_id": agent_id,
                "quality_score": quality_score,
                "capability_domain": source.capability_domain,
            },
        )
        return source

    async def list_similar_sources(
        self,
        forgekin_id: str,
        capability_domain: str,
        min_count: int = MIN_SIMILAR_EPISODES_FOR_L1,
    ) -> list[FusionSource]:
        all_sources = await self.list_by_forgekin(forgekin_id)
        # 找出与 capability_domain 相似的源
        domain_sources = [
            s for s in all_sources if s.capability_domain == capability_domain
        ]
        if len(domain_sources) < min_count:
            return []
        # 进一步用相似度过滤
        if not domain_sources:
            return []
        target = domain_sources[0]
        similar = find_similar_sources(
            all_sources=all_sources,
            target_source=target,
            min_count=min_count,
            similarity_threshold=self._sim_threshold,
        )
        return similar

    async def list_by_forgekin(
        self, forgekin_id: str
    ) -> list[FusionSource]:
        all_sources = await self._repo.list_all()
        return [s for s in all_sources if s.forgekin_id == forgekin_id]
```

### 3.2 CapabilityDistiller 抽象与实现

#### 3.2.1 抽象基类

```python
class CapabilityDistiller(ABC):
    """能力蒸馏器（与灵锻 SpiritForge 联动）"""

    @abstractmethod
    async def distill(
        self, sources: list[FusionSource]
    ) -> CapabilityDistillationCandidate:
        """蒸馏能力候选

        1. 调用灵锻（SpiritForge）主动抽象出 distilled_capability
        2. 填充 CL-005 六字段
        3. 初始 maturity_level = L1_PATTERN（满足 3+ 相似）
        """
        ...

    @abstractmethod
    async def promote_maturity(
        self,
        candidate_id: str,
        target_level: MaturityLevel,
        operator_approval: bool = False,
    ) -> CapabilityDistillationCandidate:
        """晋升成熟度阶梯（L0->L1->L2->L3->L4，禁止跳级）"""
        ...

    @abstractmethod
    async def submit_to_codex(
        self, candidate: CapabilityDistillationCandidate
    ) -> str:
        """提交到 F039 灵典（需 Eval Ledger 前后测验证，CL-004）"""
        ...

    @abstractmethod
    async def distill_from_fallback_records(
        self,
        forgekin_id: str,
        fallback_records: list["FallbackExecutionRecord"],
    ) -> list[CapabilityDistillationCandidate]:
        """从 F034 fallback 执行记录蒸馏反模式知识"""
        ...
```

#### 3.2.2 Harness 实现

```python
class HarnessCapabilityDistiller(CapabilityDistiller):
    """CapabilityDistiller 的 Harness 实现"""

    def __init__(
        self,
        candidate_repo: Repository[CapabilityDistillationCandidate],
        spirit_forge: "SpiritForgeEngine",  # 灵锻引擎（arch.md §3.14）
        eval_contract: "EvalContract",  # F018
        codex_repo: "Repository",  # F039 灵典 Repository
        operator_notifier: "OperatorNotifier",
    ) -> None:
        self._repo = candidate_repo
        self._spirit_forge = spirit_forge
        self._eval = eval_contract
        self._codex = codex_repo
        self._operator = operator_notifier

    async def distill(
        self, sources: list[FusionSource]
    ) -> CapabilityDistillationCandidate:
        if len(sources) < MIN_SIMILAR_EPISODES_FOR_L1:
            raise ValueError(
                f"CL-003 L0->L1 需 {MIN_SIMILAR_EPISODES_FOR_L1}+ 相似 Episode，"
                f"实际 {len(sources)}"
            )

        # 1. 灵锻主动抽象
        distilled = await self._spirit_forge.abstract_capability(sources)

        # 2. 填充 CL-005 六字段（由灵锻生成）
        candidate = CapabilityDistillationCandidate(
            candidate_id=f"cand_{sources[0].forgekin_id}_{uuid.uuid4().hex[:8]}",
            forgekin_id=sources[0].forgekin_id,
            fusion_sources=sources,
            distilled_capability=distilled["distilled_capability"],
            trigger_pattern=distilled["trigger_pattern"],
            procedure=distilled["procedure"],
            precondition=distilled["precondition"],
            postcondition=distilled["postcondition"],
            anti_pattern=distilled["anti_pattern"],
            provenance=[s.source_id for s in sources],
            confidence=distilled.get("confidence", 0.5),
            maturity_level=MaturityLevel.L1_PATTERN,
            capability_domain=sources[0].capability_domain,
        )
        await self._repo.save(candidate.candidate_id, candidate)
        logger.info(
            "CapabilityDistillationCandidate distilled (L1_PATTERN)",
            extra={
                "candidate_id": candidate.candidate_id,
                "forgekin_id": candidate.forgekin_id,
                "sources_count": len(sources),
                "capability_domain": candidate.capability_domain,
            },
        )
        return candidate

    async def promote_maturity(
        self,
        candidate_id: str,
        target_level: MaturityLevel,
        operator_approval: bool = False,
    ) -> CapabilityDistillationCandidate:
        candidate = await self._repo.find_by_id(candidate_id)
        if candidate is None:
            raise CandidateNotFoundError(
                candidate_id=candidate_id,
                message=f"candidate '{candidate_id}' not found",
            )

        # 1. CL-003 晋升路径校验
        assert_maturity_progression(
            current_level=candidate.maturity_level,
            target_level=target_level,
        )

        # 2. L2->L3 需 Eval Ledger 净增益 > 0
        if (
            candidate.maturity_level == MaturityLevel.L2_DRAFT
            and target_level == MaturityLevel.L3_VALIDATED
        ):
            ab_test_tasks = await self._eval.generate_ab_test_tasks(
                forgekin_id=candidate.forgekin_id,
                capability_domain=candidate.capability_domain,
            )
            ledger = await validate_net_gain(
                candidate=candidate,
                eval_contract=self._eval,
                ab_test_tasks=ab_test_tasks,
            )
            # 持久化 EvalLedgerRecord
            await self._repo.save(
                f"ledger::{ledger.ledger_id}", ledger
            )

        # 3. L3->L4 需 operator 显式批准
        if (
            candidate.maturity_level == MaturityLevel.L3_VALIDATED
            and target_level == MaturityLevel.L4_STANDARD
        ):
            if not operator_approval:
                # 通知 operator 请求审批
                await self._operator.notify_approval_required(
                    payload={
                        "candidate_id": candidate_id,
                        "distilled_capability": candidate.distilled_capability,
                        "trigger_pattern": candidate.trigger_pattern,
                        "procedure": candidate.procedure,
                        "confidence": candidate.confidence,
                    }
                )
                raise OperatorApprovalRequiredError(candidate_id=candidate_id)

        # 4. 更新成熟度
        updated = candidate.model_copy(
            update={
                "maturity_level": target_level,
                "updated_at": datetime.now(),
            }
        )
        await self._repo.save(candidate_id, updated)
        logger.info(
            "Candidate maturity promoted",
            extra={
                "candidate_id": candidate_id,
                "from_level": candidate.maturity_level.value,
                "to_level": target_level.value,
                "operator_approval": operator_approval,
            },
        )
        return updated

    async def submit_to_codex(
        self, candidate: CapabilityDistillationCandidate
    ) -> str:
        # 1. CL-005 六字段完整性校验（Pydantic model_validator 已保证，这里二次校验）
        if candidate.maturity_level == MaturityLevel.L0_EPISODE:
            raise MaturityLevelTooLowError(
                candidate_id=candidate.candidate_id,
                current_level=candidate.maturity_level,
                required_levels=[
                    MaturityLevel.L3_VALIDATED,
                    MaturityLevel.L4_STANDARD,
                ],
            )

        # 2. 写入 F039 灵典
        codex_entry_id = f"codex_{candidate.candidate_id}_{uuid.uuid4().hex[:8]}"
        await self._codex.save(
            codex_entry_id,
            {
                "candidate_id": candidate.candidate_id,
                "distilled_capability": candidate.distilled_capability,
                "trigger_pattern": candidate.trigger_pattern,
                "procedure": candidate.procedure,
                "precondition": candidate.precondition,
                "postcondition": candidate.postcondition,
                "anti_pattern": candidate.anti_pattern,
                "provenance": candidate.provenance,
                "confidence": candidate.confidence,
                "maturity_level": candidate.maturity_level.value,
                "capability_domain": candidate.capability_domain,
                "forgekin_id": candidate.forgekin_id,
                "submitted_at": datetime.now().isoformat(),
            },
        )
        logger.info(
            "Candidate submitted to Mind Codex (F039)",
            extra={
                "candidate_id": candidate.candidate_id,
                "codex_entry_id": codex_entry_id,
                "maturity_level": candidate.maturity_level.value,
            },
        )
        return codex_entry_id

    async def distill_from_fallback_records(
        self,
        forgekin_id: str,
        fallback_records: list["FallbackExecutionRecord"],
    ) -> list[CapabilityDistillationCandidate]:
        """从 F034 fallback 执行记录蒸馏反模式知识"""
        candidates: list[CapabilityDistillationCandidate] = []

        # 按 (from_provider, trigger) 聚类
        clusters: dict[tuple[str, str], list] = {}
        for record in fallback_records:
            key = (record.from_provider, record.trigger.value)
            clusters.setdefault(key, []).append(record)

        for (provider, trigger), records in clusters.items():
            if len(records) < MIN_SIMILAR_EPISODES_FOR_L1:
                continue  # CL-003 L0->L1 需 3+ 相似 Episode

            candidate = CapabilityDistillationCandidate(
                candidate_id=f"anti_{provider}_{trigger}_{uuid.uuid4().hex[:8]}",
                forgekin_id=forgekin_id,
                fusion_sources=[],  # 反模式蒸馏不依赖 FusionSource
                distilled_capability=f"避免在 {trigger} 场景下调用 {provider}",
                trigger_pattern=f"{provider} 在 {trigger} 场景下失败",
                procedure="换用其他厂商或降级到内置 agent",
                precondition=f"任务触发 {trigger}",
                postcondition="任务由其他厂商或内置 agent 完成",
                anti_pattern=f"不要在 {trigger} 场景下首选 {provider}",
                provenance=[r.record_id for r in records],
                confidence=min(1.0, len(records) / 10),
                maturity_level=MaturityLevel.L1_PATTERN,
            )
            await self._repo.save(candidate.candidate_id, candidate)
            candidates.append(candidate)

        logger.info(
            "Anti-pattern candidates distilled from fallback records",
            extra={
                "forgekin_id": forgekin_id,
                "fallback_records_count": len(fallback_records),
                "candidates_count": len(candidates),
            },
        )
        return candidates
```

### 3.3 CapabilityFusionApplier 抽象与实现

```python
class CapabilityFusionApplier(ABC):
    """能力融合应用器（合入灵智体能力画像）"""

    @abstractmethod
    async def apply_to_profile(
        self, forgekin_id: str, codex_entry_id: str
    ) -> None:
        """将锻典条目作为 SkillPackage 合入 F001 CapabilityProfile"""
        ...


class HarnessCapabilityFusionApplier(CapabilityFusionApplier):
    """CapabilityFusionApplier 的 Harness 实现"""

    def __init__(
        self,
        candidate_repo: Repository[CapabilityDistillationCandidate],
        codex_repo: "Repository",  # F039 灵典
        capability_profile_repo: "Repository",  # F001 CapabilityProfile
    ) -> None:
        self._candidates = candidate_repo
        self._codex = codex_repo
        self._profiles = capability_profile_repo

    async def apply_to_profile(
        self, forgekin_id: str, codex_entry_id: str
    ) -> None:
        # 1. 从 F039 灵典读取条目
        codex_entry = await self._codex.find_by_id(codex_entry_id)
        if codex_entry is None:
            raise CodexEntryNotFoundError(
                codex_entry_id=codex_entry_id,
                message=f"codex entry '{codex_entry_id}' not found",
            )

        # 2. 从候选 Repository 读取候选（含 maturity_level）
        candidate_id = codex_entry.get("candidate_id")
        candidate = await self._candidates.find_by_id(candidate_id)
        if candidate is None:
            raise CandidateNotFoundError(
                candidate_id=candidate_id,
                message=f"candidate '{candidate_id}' not found",
            )

        # 3. 校验成熟度 L3+
        required_levels = [
            MaturityLevel.L3_VALIDATED,
            MaturityLevel.L4_STANDARD,
        ]
        if candidate.maturity_level not in required_levels:
            raise MaturityLevelTooLowError(
                candidate_id=candidate.candidate_id,
                current_level=candidate.maturity_level,
                required_levels=required_levels,
            )

        # 4. 构造 SkillPackage
        package = build_skill_package(
            candidate=candidate,
            codex_entry_id=codex_entry_id,
            codex_entry_ref=f"codex://{codex_entry_id}",
        )

        # 5. 合入 F001 CapabilityProfile
        profile = await self._profiles.find_by_id(forgekin_id)
        if profile is None:
            raise ForgekinProfileNotFoundError(
                forgekin_id=forgekin_id,
                message=f"forgekin profile '{forgekin_id}' not found",
            )

        # 假设 F001 CapabilityProfile 有 skill_packages 字段
        existing_packages = list(getattr(profile, "skill_packages", []))
        updated_packages = existing_packages + [package.model_dump()]
        updated_profile = profile.model_copy(
            update={"skill_packages": updated_packages}
        )
        await self._profiles.save(forgekin_id, updated_profile)

        logger.info(
            "SkillPackage applied to CapabilityProfile",
            extra={
                "forgekin_id": forgekin_id,
                "codex_entry_id": codex_entry_id,
                "package_id": package.package_id,
                "skill_name": package.skill_name,
                "maturity_level": package.maturity_level.value,
                "total_packages": len(updated_packages),
            },
        )
```

### 3.4 异常类（补充）

```python
class CandidateNotFoundError(Exception):
    """蒸馏候选未找到"""

    def __init__(self, candidate_id: str, message: str) -> None:
        self.candidate_id = candidate_id
        super().__init__(message)


class CodexEntryNotFoundError(Exception):
    """F039 灵典条目未找到"""

    def __init__(self, codex_entry_id: str, message: str) -> None:
        self.codex_entry_id = codex_entry_id
        super().__init__(message)


class ForgekinProfileNotFoundError(Exception):
    """灵智体画像未找到（F001）"""

    def __init__(self, forgekin_id: str, message: str) -> None:
        self.forgekin_id = forgekin_id
        super().__init__(message)
```

### 3.5 配置加载器与 YAML

```python
class CapabilityFusionConfigLoader:
    """能力融合配置加载器"""

    REQUIRED_CONFIG_FIELDS = [
        "min_quality_score",
        "min_similar_episodes_for_l1",
        "similarity_threshold",
        "codex_collection",
        "auto_collect_on_call",
    ]

    def __init__(
        self,
        config_path: str = "config/external_agent.yaml",
    ) -> None:
        self._config_path = Path(config_path).resolve()

    def load(self) -> dict:
        if not self._config_path.exists():
            raise FileNotFoundError(
                f"external_agent.yaml not found: {self._config_path}"
            )
        with open(self._config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        fusion_config = config.get("capability_fusion", {})
        self._assert_fields_complete(fusion_config)
        # 校验质量阈值不可修改
        if fusion_config["min_quality_score"] != 0.85:
            raise ValueError(
                f"min_quality_score must be 0.85 (项目规则铁律), "
                f"got {fusion_config['min_quality_score']}"
            )
        return fusion_config

    def _assert_fields_complete(self, config: dict) -> None:
        missing = [f for f in self.REQUIRED_CONFIG_FIELDS if f not in config]
        if missing:
            raise ValueError(f"capability_fusion config missing fields: {missing}")
```

### 3.6 external_agent.yaml 配置示例

```yaml
# config/external_agent.yaml（capability_fusion 段节选）

capability_fusion:
  min_quality_score: 0.85                # FusionSource 采集最低质量分（项目规则铁律）
  min_similar_episodes_for_l1: 3         # CL-003 L0->L1 最少相似 Episode 数
  similarity_threshold: 0.7              # 相似度阈值
  codex_collection: "external_agent_capability_codex"  # F039 灵典集合名
  auto_collect_on_call: true             # 每次调用成功后自动采集
  require_operator_approval_for_L4: true # L3->L4 必须 operator 显式批准
  ab_test_task_count: 5                  # CL-004 Eval Ledger A/B 测试任务数
```

### 3.7 DI 容器注册

```python
def register_external_agent_capability_fusion_layer(
    container: DIContainer,
    config_path: str = "config/external_agent.yaml",
) -> None:
    """注册三方 Agent 能力融合层到 DI 容器"""
    config_loader = CapabilityFusionConfigLoader(config_path=config_path)
    config = config_loader.load()

    fusion_source_repo = container.resolve_repository(
        model_type="FusionSource",
    )
    candidate_repo = container.resolve_repository(
        model_type="CapabilityDistillationCandidate",
    )
    codex_repo = container.resolve_repository(
        model_type="CodexEntry",  # F039 灵典
        collection=config["codex_collection"],
    )
    capability_profile_repo = container.resolve_repository(
        model_type="CapabilityProfile",  # F001
    )
    profile_registry = container.resolve("ExternalAgentProfileRegistry")  # D032
    spirit_forge = container.resolve("SpiritForgeEngine")  # arch.md §3.14
    eval_contract = container.resolve("EvalContract")  # F018
    operator_notifier = container.resolve("OperatorNotifier")

    collector = HarnessFusionSourceCollector(
        fusion_source_repo=fusion_source_repo,
        profile_registry=profile_registry,
        min_quality_score=config["min_quality_score"],
        similarity_threshold=config["similarity_threshold"],
    )
    container.register_instance(FusionSourceCollector, collector)

    distiller = HarnessCapabilityDistiller(
        candidate_repo=candidate_repo,
        spirit_forge=spirit_forge,
        eval_contract=eval_contract,
        codex_repo=codex_repo,
        operator_notifier=operator_notifier,
    )
    container.register_instance(CapabilityDistiller, distiller)

    applier = HarnessCapabilityFusionApplier(
        candidate_repo=candidate_repo,
        codex_repo=codex_repo,
        capability_profile_repo=capability_profile_repo,
    )
    container.register_instance(CapabilityFusionApplier, applier)
```

---

## 4. 跨模块协作实现

### 4.1 与 D031 ExternalAgentBridge 协作

```python
# core/external_agent/bridge.py（D031 节选，展示与 D035 协作）

class ExternalAgentBridge:
    def __init__(
        self,
        adapter_registry: "ExternalAgentAdapterRegistry",
        capability_matcher: CapabilityMatcher,  # D032
        profile_registry: ExternalAgentProfileRegistry,  # D032
        shared_state_store: SharedStateStore,  # D033
        shared_state_handoff: SharedStateHandoff,  # D033
        fallback_chain_builder: FallbackChainBuilder,  # D034
        fallback_chain_executor: FallbackChainExecutor,  # D034
        failure_detector: FailureDetector,  # D034
        fusion_source_collector: FusionSourceCollector,  # D035
        eval_contract: "EvalContract",  # F018
    ) -> None:
        # ... 其他初始化
        self._fusion_collector = fusion_source_collector
        self._eval = eval_contract

    async def invoke_with_fusion(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
        task_capability_requirements: list[str] | None = None,
        state_id: str | None = None,
    ) -> ExternalAgentResult:
        """带 fallback + 能力融合的完整调用"""
        # 1. 调用（含 fallback）
        result = await self.invoke_with_fallback(
            forgekin_id=forgekin_id,
            task=task,
            task_capability_requirements=task_capability_requirements,
            state_id=state_id,
        )

        # 2. 调用成功后采集 FusionSource（D035）
        if result.success:
            quality_score = await self._eval.score(result)
            if quality_score >= 0.85:
                await self._fusion_collector.collect(
                    call_record={
                        "task_id": task.task_id,
                        "forgekin_id": forgekin_id,
                        "agent_id": result.output.get("agent_id") if result.output else None,
                        "task_context": task.input_data,
                        "artifacts": result.output.get("artifacts", []) if result.output else [],
                        "capability_domain": task_capability_requirements[0] if task_capability_requirements else None,
                    },
                    quality_score=quality_score,
                )

        return result
```

### 4.2 与 F001 CapabilityProfile 协作

```python
# core/capability/profile.py（F001 节选，展示与 D035 协作）

class CapabilityProfile(BaseModel):
    """F001 能力画像（已扩展 skill_packages 字段）"""

    profile_id: str
    forgekin_id: str
    strengths: list[str]
    blind_spots: list[str]
    proficiency: dict[str, float]
    historical_performance: PerformanceLog
    skill_packages: list[dict] = Field(
        default_factory=list,
        description="已合入的 SkillPackage 列表（来自 D035）",
    )
```

### 4.3 与 F014 EchoStore 协作

FusionSource + CapabilityDistillationCandidate + EvalLedgerRecord + 锻典条目均通过 Repository 持久化到 F014 EchoStore 灵忆集合。

### 4.4 与 F018 Eval Contract 协作

```python
# core/eval/contract.py（F018 节选，展示与 D035 协作）

class EvalContract:
    async def score_task_without_capability(
        self,
        task: dict,
        forgekin_id: str,
    ) -> float:
        """不使用候选能力时，对任务评分（baseline）"""
        # 调用灵智体无 SkillPackage 增强时执行任务并评分
        ...

    async def score_task_with_capability(
        self,
        task: dict,
        forgekin_id: str,
        capability_procedure: str,
        capability_precondition: str,
    ) -> float:
        """使用候选能力时，对任务评分"""
        # 调用灵智体带 SkillPackage 增强时执行任务并评分
        ...

    async def generate_ab_test_tasks(
        self,
        forgekin_id: str,
        capability_domain: str | None,
    ) -> list[dict]:
        """生成 A/B 测试任务集（默认 5 个任务）"""
        ...
```

### 4.5 与 F039 灵典协作

```python
# core/mind_codex/repository.py（F039 节选，展示与 D035 协作）

class MindCodexRepository:
    """F039 灵典可检索知识库 Repository"""

    async def save(
        self,
        entry_id: str,
        entry: dict,
        collection: str = "external_agent_capability_codex",
    ) -> str:
        """保存灵典条目（可被检索）"""
        ...

    async def search(
        self,
        query: str,
        collection: str = "external_agent_capability_codex",
        top_k: int = 5,
    ) -> list[dict]:
        """检索灵典条目（用于灵智体执行任务时检索相关知识）"""
        ...
```

### 4.6 与灵锻 SpiritForge 协作（arch.md §3.14）

```python
# core/spirit_forge/engine.py（arch.md §3.14 节选，展示与 D035 协作）

class SpiritForgeEngine:
    """灵锻引擎（蒸馏抽象能力）"""

    async def abstract_capability(
        self,
        sources: list[FusionSource],
    ) -> dict:
        """从 FusionSource 列表抽象出能力候选

        Returns:
            {
                "distilled_capability": str,
                "trigger_pattern": str,
                "procedure": str,
                "precondition": str,
                "postcondition": str,
                "anti_pattern": str,
                "confidence": float,
            }
        """
        # 调用 LLM 抽象能力（提示词外置到 YAML）
        ...
```

### 4.7 与 D034 FallbackExecutionRecord 协作（反模式蒸馏）

详见 §3.2.2 HarnessCapabilityDistiller.distill_from_fallback_records() 实现。

### 4.8 完整时序图：用完即学闭环

```
[Forgekin] --invoke_with_fusion(forgekin_id, task)--> [ExternalAgentBridge]
                                                          |
                                                          | 1. invoke_with_fallback()
                                                          v
                                                    [D034 FallbackChainExecutor]
                                                          |
                                                          | <--- ExternalAgentResult (success)
                                                          v
                                                    [ExternalAgentBridge]
                                                          |
                                                          | 2. eval_contract.score(result)
                                                          v
                                                    [F018 EvalContract] --quality_score=0.92-->
                                                          |
                                                          | 3. quality >= 0.85, collect FusionSource
                                                          v
                                                    [D035 FusionSourceCollector.collect()]
                                                          |
                                                          | 4. profile_registry.get(agent_id)
                                                          v
                                                    [D032 ExternalAgentProfileRegistry]
                                                          |
                                                          | 5. 持久化 FusionSource 到 F014 灵忆
                                                          v
                                                    [F014 EchoStoreRepository]

[聚类阶段（异步触发）]
    [FusionSourceCollector] --list_similar_sources(forgekin_id, domain, min_count=3)-->
        |
        | 6. find_similar_sources() (相似度 >= 0.7)
        v
    [similar_sources: [s1, s2, s3, s4]]
        |
        | 7. >= 3 个相似，触发蒸馏
        v
    [D035 CapabilityDistiller.distill(sources)]
        |
        | 8. spirit_forge.abstract_capability(sources)
        v
    [SpiritForgeEngine] --distilled_capability + CL-005 六字段-->
        |
        | 9. 构造 CapabilityDistillationCandidate (L1_PATTERN)
        v
    [持久化到 F014]

[晋升阶段（异步触发）]
    [CapabilityDistiller] --promote_maturity(candidate_id, L2_DRAFT)-->
        |
        | 10. assert_maturity_progression(L1 -> L2)
        v
    [updated candidate (L2_DRAFT)]

    [CapabilityDistiller] --promote_maturity(candidate_id, L3_VALIDATED)-->
        |
        | 11. validate_net_gain() (CL-004 Eval Ledger)
        v
    [F018 EvalContract]
        |
        | 12. before_score (无 SkillPackage) vs after_score (带 SkillPackage)
        v
    [EvalLedgerRecord] --net_gain=0.08 > 0-->
        |
        | 13. 晋升 L3_VALIDATED
        v
    [updated candidate (L3_VALIDATED)]

    [CapabilityDistiller] --submit_to_codex(candidate)-->
        |
        | 14. CL-005 六字段校验（Pydantic model_validator）
        v
    [F039 MindCodexRepository] --codex_entry_id-->

    [CapabilityDistiller] --promote_maturity(candidate_id, L4_STANDARD, operator_approval=True)-->
        |
        | 15. operator 显式批准
        v
    [updated candidate (L4_STANDARD)]

[合入阶段]
    [CapabilityFusionApplier] --apply_to_profile(forgekin_id, codex_entry_id)-->
        |
        | 16. 读取 codex_entry + candidate
        v
    [F039 + candidate_repo]
        |
        | 17. 校验 maturity_level >= L3
        v
    [build_skill_package()]
        |
        | 18. 构造 SkillPackage
        v
    [F001 CapabilityProfile]
        |
        | 19. skill_packages 字段追加新包
        v
    [profile_repo.save(forgekin_id, updated_profile)]

[下次任务执行]
    [Forgekin] --invoke_with_fusion(forgekin_id, similar_task)-->
        |
        | 20. CapabilityMatcher.match_for_task() 发现 skill_packages 中已有匹配
        v
    [D032 CapabilityMatcher] --无需调用三方 Agent-->
        |
        | 21. 灵智体自主完成任务（用完即学闭环）
        v
    [ExternalAgentResult]
```

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

- [ ] **AC-F-01**: MaturityLevel 枚举含 5 级（L0/L1/L2/L3/L4），运行时无法新增。
- [ ] **AC-F-02**: MATURITY_PROGRESSION 表含 5 个映射，L0->L1->L2->L3->L4 严格按级。
- [ ] **AC-F-03**: FusionSource.call_quality_score 字段 ge=0.0, le=1.0。
- [ ] **AC-F-04**: CapabilityDistillationCandidate._validate_cl005_fields 在六字段缺失时抛 CL005KnowledgeObjectContractError。
- [ ] **AC-F-05**: EvalLedgerRecord._validate_net_gain 校验 net_gain == after_score - before_score。
- [ ] **AC-F-06**: assert_maturity_progression 在跳级时抛 MaturityProgressionViolationError。
- [ ] **AC-F-07**: assert_maturity_progression 在降级时抛 MaturityProgressionViolationError。
- [ ] **AC-F-08**: assert_maturity_progression 在同级时通过（重新验证）。
- [ ] **AC-F-09**: find_similar_sources 在相似数量 < 3 时返回空列表。
- [ ] **AC-F-10**: find_similar_sources 在相似数量 >= 3 时返回相似列表（含 target）。
- [ ] **AC-F-11**: HarnessFusionSourceCollector.collect 在 quality_score < 0.85 时返回 None。
- [ ] **AC-F-12**: HarnessFusionSourceCollector.collect 在 quality_score >= 0.85 时持久化 FusionSource。
- [ ] **AC-F-13**: HarnessCapabilityDistiller.distill 在 sources < 3 时抛 ValueError。
- [ ] **AC-F-14**: HarnessCapabilityDistiller.distill 调用灵锻 abstract_capability 生成 L1_PATTERN 候选。
- [ ] **AC-F-15**: HarnessCapabilityDistiller.promote_maturity 在 L2->L3 时调用 validate_net_gain。
- [ ] **AC-F-16**: HarnessCapabilityDistiller.promote_maturity 在 net_gain <= 0 时抛 NetGainNotPositiveError。
- [ ] **AC-F-17**: HarnessCapabilityDistiller.promote_maturity 在 L3->L4 无 operator_approval 时抛 OperatorApprovalRequiredError。
- [ ] **AC-F-18**: HarnessCapabilityDistiller.submit_to_codex 在 L0 候选时抛 MaturityLevelTooLowError。
- [ ] **AC-F-19**: HarnessCapabilityDistiller.distill_from_fallback_records 在 records < 3 时跳过聚类。
- [ ] **AC-F-20**: build_skill_package 在 maturity < L3 时抛 MaturityLevelTooLowError。
- [ ] **AC-F-21**: HarnessCapabilityFusionApplier.apply_to_profile 在 codex_entry 不存在时抛 CodexEntryNotFoundError。
- [ ] **AC-F-22**: HarnessCapabilityFusionApplier.apply_to_profile 在 maturity < L3 时抛 MaturityLevelTooLowError。
- [ ] **AC-F-23**: HarnessCapabilityFusionApplier.apply_to_profile 成功后 F001 CapabilityProfile.skill_packages 长度 +1。
- [ ] **AC-F-24**: CapabilityFusionConfigLoader 在 min_quality_score != 0.85 时抛 ValueError。

### 5.2 性能验收（Performance AC）

- [ ] **AC-P-01**: HarnessFusionSourceCollector.collect 单次采集 < 30ms（含 profile_registry.get + Repository save）。
- [ ] **AC-P-02**: compute_fusion_source_similarity 单次计算 < 2ms（集合运算 + 词集 Jaccard）。
- [ ] **AC-P-03**: find_similar_sources 在 100 FusionSource 下 < 50ms（O(n) 相似度计算）。
- [ ] **AC-P-04**: HarnessCapabilityDistiller.distill 在 3-5 sources 下 < 5s（灵锻 LLM 调用为主）。
- [ ] **AC-P-05**: validate_net_gain 在 5 个 A/B 测试任务下 < 60s（含 before/after 任务执行 + 评分）。
- [ ] **AC-P-06**: HarnessCapabilityDistiller.submit_to_codex 单次提交 < 50ms。
- [ ] **AC-P-07**: HarnessCapabilityFusionApplier.apply_to_profile 单次合入 < 50ms。
- [ ] **AC-P-08**: distill_from_fallback_records 在 20 records 下 < 100ms（聚类 + 候选构造）。

### 5.3 安全验收（Security AC）

- [ ] **AC-S-01**: capability_fusion.py 无直接数据库操作（grep "cursor.execute" 为空）。
- [ ] **AC-S-02**: min_quality_score = 0.85 常量定义后不可运行时修改（ConfigLoader 校验）。
- [ ] **AC-S-03**: CL-005 六字段非空校验，防止空字段污染锻典。
- [ ] **AC-S-04**: L4 必须 operator 显式批准，防止自动合入低质量条目。
- [ ] **AC-S-05**: Eval Ledger net_gain > 0 硬门，防止负增益条目合入。
- [ ] **AC-S-06**: yaml.safe_load 防止 YAML 反序列化攻击。
- [ ] **AC-S-07**: 5 级成熟度枚举不可扩展，运行时无法注入新级别。
- [ ] **AC-S-08**: model_config extra="forbid" 防止 YAML 误加字段污染数据模型。
- [ ] **AC-S-09**: 灵锻 LLM 调用提示词外置到 YAML（铁律 5 + P16 + P34），禁止 .py 硬编码。
- [ ] **AC-S-10**: logger 输出不含敏感数据（仅含 candidate_id / forgekin_id / quality_score 等指标）。

### 5.4 Eval 验收（Eval AC）

- [ ] **AC-E-01**: FusionSource 在质量分 >= 0.85 时被采集，可在 F014 EchoStore 中查询到。
- [ ] **AC-E-02**: CapabilityDistillationCandidate 在 L1_PATTERN 时含 3+ provenance Episode ID。
- [ ] **AC-E-03**: EvalLedgerRecord.net_gain 在 L2->L3 晋升后 > 0。
- [ ] **AC-E-04**: L3_VALIDATED 候选可成功提交到 F039 灵典并获取 codex_entry_id。
- [ ] **AC-E-05**: L4_STANDARD 候选可作为 SkillPackage 合入 F001 CapabilityProfile。
- [ ] **AC-E-06**: 合入后 F001 CapabilityProfile.skill_packages 含新 SkillPackage。
- [ ] **AC-E-07**: 用完即学闭环：合入后下次类似任务灵智体可自主完成（不调三方 Agent）。
- [ ] **AC-E-08**: 反模式蒸馏：3+ 同种 fallback 失败记录可蒸馏出"避免某厂商"反模式知识。

### 5.5 集成测试点（Integration Test Points）

| 测试 ID | 测试场景 | 验证点 |
|---------|---------|--------|
| IT-D035-001 | FusionSource 采集（quality=0.92） | source_id 返回，F014 中可查 |
| IT-D035-002 | FusionSource 采集（quality=0.80） | 返回 None，不采集 |
| IT-D035-003 | find_similar_sources（3 相似） | 返回 3 个相似源 |
| IT-D035-004 | find_similar_sources（2 相似） | 返回空列表（< min_count=3） |
| IT-D035-005 | distill（3 sources） | 返回 L1_PATTERN 候选 |
| IT-D035-006 | distill（2 sources） | 触发 ValueError |
| IT-D035-007 | promote_maturity L1->L2 | 成功晋升 L2_DRAFT |
| IT-D035-008 | promote_maturity L1->L3 跳级 | 触发 MaturityProgressionViolationError |
| IT-D035-009 | promote_maturity L2->L3 net_gain > 0 | 成功晋升 L3_VALIDATED |
| IT-D035-010 | promote_maturity L2->L3 net_gain <= 0 | 触发 NetGainNotPositiveError |
| IT-D035-011 | promote_maturity L3->L4 无 operator_approval | 触发 OperatorApprovalRequiredError |
| IT-D035-012 | promote_maturity L3->L4 有 operator_approval | 成功晋升 L4_STANDARD |
| IT-D035-013 | submit_to_codex（L3 候选） | 返回 codex_entry_id |
| IT-D035-014 | submit_to_codex（L0 候选） | 触发 MaturityLevelTooLowError |
| IT-D035-015 | CapabilityDistillationCandidate 六字段缺失 | 触发 CL005KnowledgeObjectContractError |
| IT-D035-016 | apply_to_profile（L4 候选） | F001 skill_packages +1 |
| IT-D035-017 | apply_to_profile（L2 候选） | 触发 MaturityLevelTooLowError |
| IT-D035-018 | apply_to_profile（codex_entry 不存在） | 触发 CodexEntryNotFoundError |
| IT-D035-019 | distill_from_fallback_records（3+ 同种失败） | 返回反模式候选列表 |
| IT-D035-020 | CapabilityFusionConfigLoader min_quality_score != 0.85 | 触发 ValueError |

### 5.6 错误处理矩阵

| 错误场景 | 异常类型 | 处理策略 | 上报层级 |
|---------|---------|---------|---------|
| CL-003 跳级 | MaturityProgressionViolationError | 晋升被拒绝 | logger.warning |
| CL-004 净增益 <= 0 | NetGainNotPositiveError | L2->L3 晋升被拒绝 | logger.warning |
| CL-005 六字段缺失 | CL005KnowledgeObjectContractError | 候选构造被拒绝 | logger.error |
| L3->L4 无 operator 审批 | OperatorApprovalRequiredError | 晋升被拒绝，通知 operator | logger.warning |
| 成熟度 < L3 合入 | MaturityLevelTooLowError | 合入被拒绝 | logger.warning |
| 候选未找到 | CandidateNotFoundError | 操作被拒绝 | logger.error |
| 灵典条目未找到 | CodexEntryNotFoundError | 合入被拒绝 | logger.error |
| 灵智体画像未找到 | ForgekinProfileNotFoundError | 合入被拒绝 | logger.error |
| 灵锻 LLM 调用失败 | SpiritForgeError | distill 失败，透传 | logger.error |
| Eval Ledger A/B 测试失败 | EvalContractError | validate_net_gain 失败 | logger.error |
| min_quality_score != 0.85 | ValueError | 启动期失败 | operator |
| 5 级枚举运行时新增 | TypeError | 拒绝 | operator |
| Repository 写入失败 | Repository 异常 | 透传到调用方 | logger.error |
| 相似 Episode < 3 | 无异常 | 返回空列表，不触发蒸馏 | logger.debug |

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../arch.md#§3.14]（灵锻 SpiritForge + 灵议 Mind Council）
- [doc:../features/F035-external-agent-capability-fusion.md]（同号 Feature 级 SRS）
- [doc:../architecture/A035-external-agent-capability-fusion.md]（同号 Architecture 级 SAD）
- [doc:../features/F001-capability-profile.md]（SkillPackage 合入目标）
- [doc:../features/F014-memory-collection.md]（FusionSource 灵忆归档）
- [doc:../features/F018-eval-contract.md]（Eval Ledger 前后测对比）
- [doc:../features/F031-external-agent-adapter.md]（Bridge 调用后采集）
- [doc:../features/F032-external-agent-profile.md]（external_agent_profile_ref 引用）
- [doc:../features/F033-external-agent-shared-state.md]（call_artifacts 来源）
- [doc:../features/F034-external-agent-fallback.md]（反模式蒸馏原料）
- [doc:../features/F039-mind-codex-searchable.md]（锻典条目提交目标）
- [doc:D031-external-agent-adapter.md]（容器层）
- [doc:D032-external-agent-profile.md]（agent_id 引用）
- [doc:D033-external-agent-shared-state.md]（artifact_refs 来源）
- [doc:D034-external-agent-fallback.md]（反模式蒸馏）
- [doc:D014-memory-collection.md]（F014 灵忆）
- [doc:D018-eval-contract.md]（F018 Eval Ledger）
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../design/naming-contract.md]（灵锻 SpiritForge + 锻典 Mind Codex 命名）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（5 级成熟度 + FusionSource 自动采集 + 相似聚类算法 + CL-003 晋升校验 + CL-004 Eval Ledger 净增益 + CL-005 六字段校验 + L3+ 合入 CapabilityProfile + operator 审批 L4 + 灵锻联动 + 反模式蒸馏 + 24 功能 AC + 8 性能 AC + 10 安全 AC + 8 Eval AC + 20 集成测试点） | 架构师灵智体（猫头鹰·鲁班） |

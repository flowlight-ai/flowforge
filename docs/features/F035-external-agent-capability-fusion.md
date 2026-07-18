# Feature F035: 三方 Agent 能力融合

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#EX-010] + [doc:roleagent.md#第4章]
> **关联 ADR**: [doc:decisions/006-external-agent-integration.md]
> **类型**: external-agent
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

三方 Agent 能力融合（External Agent Capability Fusion）是 forgemind 应用层最深层的能力增长机制：灵智体（Forgekin）调用三方 Agent 后，三方 Agent 的能力应能"沉淀"到灵智体的能力画像（F001）中。本 Feature 实现调用轨迹蒸馏、能力沉淀到锻典（Mind Codex）、与 F039 灵典可检索知识库联动、与 F014 灵忆联动，让灵智体多次调用 claude code 写代码后"学到"代码编写能力。

这是 Build to Persist 基础设施——编码"用完即走 → 用完即学"的工程规则，对标 clowder-ai 猫从调用工具中学习的能力。

## 2. 动机（Motivation）

`[doc:review/review.md#EX-010]` 指出：v7.0 无三方 Agent 能力融合机制，三方 Agent 调用是"用完即走"，灵智体无法从调用中成长。这是与 clowder-ai 最大差距——clowder-ai 的猫会从调用工具中学习，v7.0 的 Forgekin 不会。灵智体多次调用 claude code 写代码后，应通过灵锻（SpiritForge）蒸馏出代码编写能力条目写入锻典（Mind Codex），下次任务可直接复用。

不做这个 Feature，F032 能力画像无能力增长通道，F033 共享状态无蒸馏原料，F039 灵典无三方 Agent 调用经验条目。这是三方 Agent 集成层的能力增长底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class FusionSource(BaseModel):
    """能力融合来源（一次三方 Agent 调用）"""
    source_id: str
    forgekin_id: str                           # 调用方灵智体 ID
    external_agent_id: str                     # 三方 Agent ID（来自 F032）
    external_agent_profile_ref: str            # F032 能力画像引用
    task_context: dict                         # 调用时任务上下文
    call_artifacts: list[str]                  # 调用产出物 ID（来自 F033 共享状态）
    call_quality_score: float                  # 调用质量分（Eval）
    call_timestamp: datetime

class CapabilityDistillationCandidate(BaseModel):
    """能力蒸馏候选（待灵锻评估是否合入锻典）"""
    candidate_id: str
    fusion_sources: list[FusionSource]         # 多次相似调用作为蒸馏原料
    distilled_capability: str                  # 蒸馏出的能力描述
    trigger_pattern: str                       # 何时使用（CL-005 Knowledge Object Contract）
    procedure: str                             # 怎么用
    precondition: str                          # 前置条件
    postcondition: str                         # 预期效果
    anti_pattern: str                          # 反模式
    provenance: list[str]                      # 来源 Episode ID（CL-005）
    confidence: float                          # 置信度
    maturity_level: Literal["L0", "L1", "L2", "L3", "L4"]  # CL-003 五级成熟度
```

### 3.2 核心接口

```python
class FusionSourceCollector(ABC):
    """融合来源采集器（每次三方 Agent 调用后采集）"""
    @abstractmethod
    async def collect(self, call_record: AgentCallRecord, quality_score: float) -> FusionSource: ...

    @abstractmethod
    async def list_similar_sources(
        self, forgekin_id: str, capability_domain: str, min_count: int = 3
    ) -> list[FusionSource]:
        """列出相似调用（CL-003 L0→L1 需 3+ 相似 Episode）"""
        ...

class CapabilityDistiller(ABC):
    """能力蒸馏器（与灵锻 SpiritForge 联动）"""
    @abstractmethod
    async def distill(self, sources: list[FusionSource]) -> CapabilityDistillationCandidate: ...

    @abstractmethod
    async def submit_to_codex(self, candidate: CapabilityDistillationCandidate) -> str:
        """提交到 F039 灵典（需 Eval Ledger 前后测验证，CL-004）"""
        ...

class CapabilityFusionApplier(ABC):
    """能力融合应用器（合入灵智体能力画像）"""
    @abstractmethod
    async def apply_to_profile(
        self, forgekin_id: str, codex_entry_id: str
    ) -> None:
        """将锻典条目作为 SkillPackage 合入 F001 能力画像"""
        ...
```

### 3.3 关键算法

- **相似调用聚类**：基于任务上下文 + 三方 Agent 能力域聚类相似 FusionSource（CL-003 L0→L1 需 3+ 相似）。
- **五级成熟度阶梯**：L0 Episode → L1 Pattern（3+ 相似）→ L2 Draft（灵锻主动抽象）→ L3 Validated（Eval A/B 验证）→ L4 Standard（operator 批准），与 CL-003 一致。
- **Eval Ledger 净增益**：合入锻典前必须前后测对比，净增益 > 0 才允许合入（CL-004）。
- **合入能力画像**：成熟度 L3+ 的锻典条目作为 SkillPackage 合入 F001 CapabilityProfile，下次任务可路由到此灵智体。

### 3.4 配置外置（YAML 示例）

```yaml
external_agent_capability_fusion:
  source_collector:
    min_quality_score: 0.85            # 与项目规则质量分阈值一致
    auto_collect_on_call: true
  distillation:
    min_similar_sources: 3             # CL-003 L0→L1 阈值
    maturity_levels: [L0, L1, L2, L3, L4]
    require_eval_ledger: true          # CL-004 净增益验证
    require_operator_approval_for_L4: true
  codex_submission:
    target: mind_codex_searchable      # F039
    knowledge_object_contract: CL-005  # 字段完整性校验
  profile_apply:
    min_maturity_for_apply: L3
    skill_package_format: F001
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 每次三方 Agent 调用后采集 FusionSource
- [ ] AC-2: 相似调用聚类（CL-003 L0→L1 需 3+ 相似）
- [ ] AC-3: 五级成熟度阶梯严格（L0→L4 不可跳级）
- [ ] AC-4: Eval Ledger 净增益 > 0 才允许合入锻典（CL-004）
- [ ] AC-5: L3+ 锻典条目作为 SkillPackage 合入 F001 能力画像

## 5. 测试策略

### 5.1 单元测试

- FusionSource 采集、相似聚类、五级成熟度阶梯、Eval Ledger 净增益计算。

### 5.2 集成测试

- 接入 F001 能力画像、F014 灵忆、F032 三方 Agent 能力画像、F033 共享状态、F039 灵典、F018 Eval Contract。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实灵智体调用真实 claude code 写代码 5 次相似任务（每次 Eval ≥ 0.85），通过真实 LLM 灵锻蒸馏出代码编写能力候选，经 Eval Ledger 前后测验证净增益 > 0 后合入锻典，再合入能力画像。下次类似任务灵智体可自主完成（不调 claude code）。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用（含真实三方 Agent）。

## 6. 引用

- [doc:roleagent.md#第4章]
- [doc:review/review.md#第九章/EX-010]
- [doc:review/review.md#第十三章/CL-003]（五级知识成熟度阶梯）
- [doc:review/review.md#第十三章/CL-004]（Eval Ledger 进化账本）
- [doc:review/review.md#第十三章/CL-005]（Knowledge Object Contract）
- [doc:decisions/006-external-agent-integration.md]
- [doc:design/naming-contract.md#2.7]（灵锻 SpiritForge）
- [doc:design/naming-contract.md#2.8]（锻典 Mind Codex）
- [doc:design/naming-contract.md#2.12]（能力画像 Capability Profile）
- [doc:features/F001-capability-profile.md]
- [doc:features/F014-memory-collection.md]
- [doc:features/F018-eval-contract.md]
- [doc:features/F032-external-agent-profile.md]
- [doc:features/F033-external-agent-shared-state.md]
- [doc:features/F039-mind-codex-searchable.md]
- [doc:project_rules.md#T1-T8]

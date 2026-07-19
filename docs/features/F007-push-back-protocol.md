# Feature F007: Generator Push Back 协议

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-015] + [doc:roleagent.md#第2章]
> **关联 ADR**: [doc:decisions/002-collaboration-protocol.md]
> **类型**: collaboration
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.2]（待创建）
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

Generator Push Back 协议把 TeamAct 的 review 从单向（reviewer → author 修改）升级为双向辩论：任何灵智体（Forgekin）在任何角色下都有权 push back reviewer 的裁决——前提是带着证据 + 适用性论证 + 替代方案。没有证据的 push back 不合法；有证据的 push back 必须被正视。

本 Feature 实现合法 push back 的 Schema、辩论链、超时升级，以及"无证据 push back 拒绝"的硬约束。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-015]` 指出：roleagent.md 第 2 章强调"任何 agent 在任何角色下都有权 push back——前提是带着证据 + 适用性论证 + 替代方案。没有证据的 push back 不合法；有证据的 push back 必须被正视"。v7.0 的 review 协议是单向的，未实现双向辩论协议，reviewer 错判时 author 无纠错机制。

不做这个 Feature，reviewer 的错判会直接传导到代码，author 被迫执行错误修改，F019 三方信号交叉也无法识别"reviewer 盲点 vs author 盲点"。这是 Build to Persist 的协作协议资产，编码"reviewer 也会错"的工程现实。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class PushBack(BaseModel):
    pushback_id: str
    team_id: str
    author_forgekin_id: str         # 发起 push back 的 author
    reviewer_forgekin_id: str       # 被 push back 的 reviewer
    original_verdict_id: str        # 原裁决 ID
    evidence_refs: list[str]        # 证据（commit/测试/trace/spec 引用）
    applicability_argument: str     # 适用性论证（为何原裁决不适用）
    alternative_proposal: str       # 替代方案
    status: Literal["submitted", "accepted", "rejected", "escalated"]
    schema_version: str = "1.0"

class DebateChain(BaseModel):
    original_verdict_id: str
    pushbacks: list[PushBack]
    final_resolution: Optional[str]
    resolved_at: Optional[datetime]
```

### 3.2 核心接口

```python
class PushBackValidator:
    """合法性校验：三要素非空"""
    def validate(self, pb: PushBack) -> ValidationResult: ...

class DebateOrchestrator:
    def submit(self, pb: PushBack) -> str: ...
    def respond(self, pushback_id: str, response: ReviewerResponse) -> None: ...
    def escalate(self, pushback_id: str, reason: str) -> None: ...
    def resolve(self, chain_id: str, resolution: str) -> None: ...
```

### 3.3 关键算法

- **合法性校验**：evidence_refs / applicability_argument / alternative_proposal 三要素任一为空即拒绝提交。
- **辩论轮次上限**：同一 verdict 的 push back 链最多 3 轮，超限强制升级 CVO。
- **超时升级**：reviewer 在 `response_deadline` 内未回应，自动升级 CVO 仲裁。
- **证据锚定**：evidence_refs 必须指向 F009 Evidence & Sensors 已记录的真实证据，不接受自由文本主张。

### 3.4 配置外置（YAML 示例）

```yaml
push_back:
  require_evidence: true
  require_applicability: true
  require_alternative: true
  max_debate_rounds: 3
  response_deadline_seconds: 3600
  on_timeout: escalate_cvo
  evidence_must_be_in_store: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 三要素任一为空的 push back 被拒绝提交
- [ ] AC-2: evidence_refs 必须指向 F009 已记录证据
- [ ] AC-3: 同一 verdict 辩论超 3 轮强制升级 CVO
- [ ] AC-4: reviewer 超时未回应自动升级 CVO 仲裁
- [ ] AC-5: push back 链可被追溯（DebateChain 完整记录）

## 5. 测试策略

### 5.1 单元测试

- 合法性校验、辩论轮次计数、超时升级、证据锚定。

### 5.2 集成测试

- 接入 F002 TeamAct Verdict 步，验证 push back 暂停终止条件判定。
- 接入 F009 Evidence & Sensors，验证证据锚定。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商 reviewer 灵智体给出错判，真实 author 灵智体带证据 push back，验证辩论链正确流转并最终由 CVO 仲裁。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用，LLM 生成内容经 LLM 审核。

## 6. 引用

- [doc:roleagent.md#第2章]
- [doc:review/review.md#第八章/RA-015]
- [doc:decisions/002-collaboration-protocol.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F002-teamact-loop.md]
- [doc:features/F009-evidence-sensors.md]
- [doc:features/F019-three-signal-cross.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.2 同号映射 | 文档员灵智体（钢笔·文心） |

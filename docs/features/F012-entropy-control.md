# Feature F012: Entropy Control 退役机制

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-021] + [doc:roleagent.md#第3章]
> **关联 ADR**: [doc:decisions/007-harness-engineering.md]
> **类型**: harness
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.3]（待创建）
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）

---

## 1. 概述（Overview）

Entropy Control 是 Harness 七层的退役机制：roleagent.md 第 3 章强调"hotfix 合入后两周自动触发升级 review：正式修复、接受永久方案、已不再相关，三选一，没有第四项叫'再看看'"。本 Feature 实现 hotfix sunset 计时器、两周强制 review、三选一裁决，以及 Build to Delete 资产的退役信号采集。

这是 Build to Persist 治理资产——编码"脚手架代码不能无限期占用注意力预算"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-021]` 指出：roleagent.md 强调 hotfix 合入后两周自动触发升级 review，三选一没有第四项"再看看"。v7.0 有 `scripts/scan_deprecated.py` 但未实现 hotfix 两周 sunset 强制审查，脚手架代码无限期占用注意力预算。

不做这个 Feature，F008 Build to Delete 资产无 sunset 信号，F018 Eval Contract 的"退役信号"无采集入口，F040 Harness Eval 控制面无法识别"哪块机制正在折旧"。roleagent.md 第 1 章明确 Build to Delete 必须标注 sunset 时间。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class HotfixTag(BaseModel):
    tag_id: str
    commit_sha: str
    forgekin_id: str
    merged_at: datetime
    sunset_review_due: datetime         # merged_at + 14 天
    status: Literal["pending_review", "formal_fix", "permanent", "no_longer_relevant"]

class EntropyReviewVerdict(BaseModel):
    verdict_id: str
    hotfix_tag_id: str
    reviewer_forgekin_id: str
    decision: Literal["formal_fix", "permanent", "no_longer_relevant"]  # 三选一
    rationale: str
    reviewed_at: datetime
```

### 3.2 核心接口

```python
class HotfixTagger:
    """提交 hotfix 时自动打 tag + 启动 sunset 计时器"""
    async def tag(self, commit_sha: str, forgekin_id: str) -> str: ...

class SunsetScheduler:
    """两周强制 review 调度"""
    def schedule_review(self, hotfix_tag_id: str) -> None: ...
    def list_overdue(self) -> list[HotfixTag]: ...

class EntropyReviewGate:
    """三选一硬约束"""
    def validate(self, verdict: EntropyReviewVerdict) -> ValidationResult: ...
```

### 3.3 关键算法

- **自动 tag**：commit message 含 `[hotfix]` 标记时自动打 HotfixTag + 启动 14 天计时。
- **两周强制 review**：sunset_review_due 到期自动创建 review 任务，分配给非作者Forgekin。
- **三选一硬约束**：decision 仅允许 formal_fix / permanent / no_longer_relevant；拒绝"再看看"。
- **退役信号采集**：no_longer_relevant 决策写入 F018 Eval Contract 退役信号，触发 F040 控制面 sunset review。

### 3.4 配置外置（YAML 示例）

```yaml
entropy_control:
  hotfix_marker: "[hotfix]"
  sunset_days: 14
  allowed_decisions: [formal_fix, permanent, no_longer_relevant]
  forbidden_decisions: [再看看, defer, later]
  reviewer_must_not_be_author: true
  overdue_escalation: cvo
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 含 [hotfix] 标记的 commit 自动打 tag + 启动 14 天计时
- [ ] AC-2: 到期未 review 自动升级 CVO
- [ ] AC-3: decision 仅允许三选一，"再看看"被拒绝
- [ ] AC-4: reviewer 不可为 author
- [ ] AC-5: no_longer_relevant 决策写入 F018 退役信号

## 5. 测试策略

### 5.1 单元测试

- tag 自动打、计时器、三选一校验、reviewer 非作者校验。

### 5.2 集成测试

- 接入 F018 Eval Contract 退役信号、F040 Harness Eval 控制面。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商Forgekin提交 hotfix，14 天后由另一Forgekin强制 review 并给出三选一裁决。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用（时间可加速）。

## 6. 引用

- [doc:roleagent.md#第3章]
- [doc:review/review.md#第八章/RA-021]
- [doc:decisions/007-harness-engineering.md]
- [doc:design/naming-contract.md#2.2]（Forgekin Forgekin）
- [doc:features/F008-durable-state-surfaces.md]
- [doc:features/F018-eval-contract.md]
- [doc:features/F040-harness-eval-control-plane.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|

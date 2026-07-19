# Feature F018: Eval Contract 五问

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-032] + [doc:roleagent.md#第5章]
> **关联 ADR**: [doc:decisions/009-eval-self-metabolism.md]
> **类型**: eval
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.5]（待创建）
> **对应 design.md**: [doc:../design.md#§3.5]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

Eval Contract 五问是 roleagent.md 第 5 章的硬要求：新增一块 harness 时必须写清楚①服务谁 ②何时触发 ③摩擦指标 ④回归用例 ⑤退役信号。本 Feature 实现五问 Schema、契约注册、契约校验门禁，以及"无契约即拒绝合入"的硬约束。

这是 Build to Persist 基础设施——编码"每块 harness 必须声明预期"的工程规则，是 harness 技术债的根源治理。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-032]` 指出：roleagent.md 第 5 章的 Eval Contract——新增一块 harness 时必须写清楚①服务谁②何时触发③摩擦指标④回归用例⑤退役信号。v7.0 新增 harness 组件无任何预期声明，导致无法判断该组件是否在增值、是否该退役。这是 harness 技术债的根源。

不做这个 Feature，F012 Entropy Control 的退役信号无契约来源，F019 三方信号交叉缺少"摩擦指标"基线，F020 七类归因矩阵无法识别"harness 错位 vs 执行缺口"，F040 Harness Eval 控制面无契约可对比。这是 roleagent.md 第 5 章 Eval 自代谢的入口。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class EvalContract(BaseModel):
    contract_id: str
    harness_component: str                 # 关联的 harness 组件
    who: str                               # 1. 服务谁（灵智体类型/角色）
    when: str                              # 2. 何时触发（事件/频率/条件）
    friction_metrics: list[FrictionMetric] # 3. 摩擦指标
    regression_cases: list[str]            # 4. 回归用例 ID
    sunset_signals: list[SunsetSignal]     # 5. 退役信号
    author_forgekin_id: str
    created_at: datetime
    schema_version: str = "1.0"

class FrictionMetric(BaseModel):
    name: str
    target_value: float
    alert_threshold: float

class SunsetSignal(BaseModel):
    signal_type: Literal["unused_days", "friction_above_threshold", "superseded_by"]
    threshold: float
```

### 3.2 核心接口

```python
class EvalContractRegistry(ABC):
    @abstractmethod
    async def register(self, contract: EvalContract) -> str: ...
    @abstractmethod
    async def get(self, contract_id: str) -> EvalContract: ...
    @abstractmethod
    async def list_by_component(self, component: str) -> list[EvalContract]: ...

class ContractGate:
    """合入门禁：无契约即拒绝"""
    def validate_on_merge(self, component: str) -> GateResult: ...
```

### 3.3 关键算法

- **五问非空校验**：who/when/friction_metrics/regression_cases/sunset_signals 任一为空即拒绝注册。
- **合入门禁**：新增 harness 组件的 PR 必须附 EvalContract，否则 CI 拒绝。
- **摩擦指标对齐**：friction_metrics 必须可在 F019 三方信号交叉中采集。
- **退役信号联动**：sunset_signals 触发时联动 F012 Entropy Control 启动 sunset review。

### 3.4 配置外置（YAML 示例）

```yaml
eval_contract:
  require_on_merge: true
  five_questions_required: [who, when, friction_metrics, regression_cases, sunset_signals]
  friction_metric_must_be_collectable: true
  sunset_signal_handlers:
    unused_days: F012_sunset_review
    friction_above_threshold: F040_alert
    superseded_by: F012_formal_fix
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 五问任一为空的契约被拒绝注册
- [ ] AC-2: 新增 harness 组件 PR 无契约时 CI 拒绝
- [ ] AC-3: friction_metrics 必须在 F019 可采集
- [ ] AC-4: sunset_signals 触发时联动 F012 sunset review
- [ ] AC-5: 契约可按 harness_component 查询

## 5. 测试策略

### 5.1 单元测试

- 五问非空校验、合入门禁、摩擦指标对齐、退役信号联动。

### 5.2 集成测试

- 接入 F012 Entropy Control、F019 三方信号交叉、F040 控制面。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体新增一个 harness 组件并附 EvalContract，验证五问校验与门禁生效。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第5章]
- [doc:review/review.md#第八章/RA-032]
- [doc:decisions/009-eval-self-metabolism.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F012-entropy-control.md]
- [doc:features/F019-three-signal-cross.md]
- [doc:features/F020-seven-attribution.md]
- [doc:features/F040-harness-eval-control-plane.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.5 同号映射 | 文档员灵智体（钢笔·文心） |

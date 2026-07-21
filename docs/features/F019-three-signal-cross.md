# Feature F019: 三方信号交叉

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-033] + [doc:roleagent.md#第5章]
> **关联 ADR**: [doc:decisions/009-eval-self-metabolism.md]
> **类型**: eval
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.5]（待创建）
> **对应 design.md**: [doc:../design.md#§3.5]（待创建）

---

## 1. 概述（Overview）

三方信号交叉是 roleagent.md 第 5 章的 Eval 数据源：①第一方 CVO 愿景信号 ②第二方 agent 摩擦信号（结构化采访，不是自由散文反思）③第三方运行时观测信号（工具调用模式/失败频率/重试次数/耗时分布）。本 Feature 实现三信号采集、交叉验证、冲突检测，以及"三方不一致即触发 F020 归因"的硬约束。

这是 Build to Persist 基础设施——编码"多源信号交叉验证"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-033]` 指出：roleagent.md 三方信号——第一方 CVO 愿景信号、第二方 agent 摩擦信号（结构化采访，不是自由散文反思）、第三方运行时观测信号（工具调用模式/失败频率/重试次数/耗时分布）。v7.0 只有第三方信号（MetricsCollector），无 CVO 愿景信号采集，无 agent 摩擦信号结构化采访。

不做这个 Feature，F018 Eval Contract 的摩擦指标无采集入口，F020 七类归因矩阵缺少多源信号对比，F040 控制面无法识别"哪块机制正在增值/折旧"。这是 roleagent.md 第 5 章 Eval 自代谢的数据基础。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class SignalSource(str, Enum):
    CVO_VISION = "cvo_vision"             # 第一方 CVO 愿景信号
    AGENT_FRICTION = "agent_friction"     # 第二方 agent 摩擦信号
    RUNTIME_OBSERVATION = "runtime_observation"  # 第三方运行时观测

class Signal(BaseModel):
    signal_id: str
    source: SignalSource
    forgekin_id: Optional[str]
    metric_name: str
    value: float
    unit: str
    collected_at: datetime
    context: dict

class FrictionInterview(BaseModel):
    """第二方结构化采访（非自由散文）"""
    interview_id: str
    forgekin_id: str
    questions: list[str]                  # 结构化问题
    answers: list[str]                    # 结构化答案
    friction_score: float
```

### 3.2 核心接口

```python
class SignalCollector(ABC):
    @abstractmethod
    async def collect_cvo(self, metric: str) -> Signal: ...
    @abstractmethod
    async def collect_friction(self, interview: FrictionInterview) -> Signal: ...
    @abstractmethod
    async def collect_runtime(self, metric: str) -> Signal: ...

class SignalCrossValidator:
    """三方交叉验证"""
    def cross_validate(self, signals: list[Signal]) -> CrossValidationResult: ...
    def detect_conflict(self, signals: list[Signal]) -> list[SignalConflict]: ...
```

### 3.3 关键算法

- **结构化采访**：agent 摩擦信号通过预设问题采集（如"这次任务哪一步最卡？"），禁自由散文。
- **交叉验证**：同一 metric 的三方信号差异超阈值即标记冲突。
- **冲突触发归因**：三方不一致自动触发 F020 七类归因矩阵。
- **CVO 愿景信号**：从 VISION.md / ROADMAP.md 派生的愿景对齐度评分。

### 3.4 配置外置（YAML 示例）

```yaml
three_signal_cross:
  sources:
    cvo_vision: {enabled: true, derived_from: [VISION.md, ROADMAP.md]}
    agent_friction: {enabled: true, interview_template: friction_interview_v1}
    runtime_observation: {enabled: true, metrics: [tool_call_rate, failure_rate, retry_count, latency_p95]}
  conflict_threshold: 0.3
  on_conflict: trigger_F020_attribution
  forbid_free_form_reflection: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 三方信号均可独立采集
- [ ] AC-2: agent 摩擦信号必须用结构化采访，拒绝自由散文
- [ ] AC-3: 同 metric 三方差异超阈值即标记冲突
- [ ] AC-4: 冲突自动触发 F020 七类归因
- [ ] AC-5: 信号可被 F018 契约 friction_metrics 引用

## 5. 测试策略

### 5.1 单元测试

- 三方采集、结构化采访校验、交叉验证、冲突检测。

### 5.2 集成测试

- 接入 F018 Eval Contract、F020 七类归因、F040 控制面。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商Forgekin完成任务，采集三方信号并构造冲突场景，验证归因触发。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第5章]
- [doc:review/review.md#第八章/RA-033]
- [doc:decisions/009-eval-self-metabolism.md]
- [doc:design/naming-contract.md#2.2]（Forgekin Forgekin）
- [doc:features/F018-eval-contract.md]
- [doc:features/F020-seven-attribution.md]
- [doc:features/F040-harness-eval-control-plane.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|

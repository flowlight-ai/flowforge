# A019: 三方信号交叉架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005）
> **对应 arch.md**: [doc:../arch.md#§3.5]
> **对应 design.md**: [doc:../design.md#§3.5]（待创建）
> **对应 Feature**: [doc:../features/F019-three-signal-cross.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D019-three-signal-cross.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]

---

## 1. 架构上下文

### 1.1 架构问题

Eval 数据源的架构问题是"单一信号失真"。v7.0 只有第三方信号（MetricsCollector 采集的工具调用频率），导致三类架构故障：

1. **无愿景对齐判断**：缺少第一方 CVO 愿景信号，无法判断"harness 在增值但偏离愿景"。
2. **无Forgekin摩擦反馈**：缺少第二方 agent 摩擦信号，Forgekin的真实摩擦无法被采集。常见错误是用"自由散文反思"代替结构化采访，导致反思无法机器处理。
3. **冲突无法识别**：三方信号冲突时无检测机制，CVO 说"这块该退役"而 MetricsCollector 显示"用得很频繁"，无仲裁。

roleagent.md 第 5 章三方信号：**①第一方 CVO 愿景信号 ②第二方 agent 摩擦信号（结构化采访，不是自由散文反思）③第三方运行时观测信号**。本架构解决的核心问题：**如何在 L2 三方信号交叉层实现三信号采集、交叉验证、冲突检测，以及"三方不一致即触发 F020 归因"的硬约束**。

### 1.2 架构约束

- **单向依赖约束**：三方信号交叉层依赖 F018 Eval Contract，禁止被 F018 反向依赖。
- **结构化采访约束**：第二方 agent 摩擦信号必须用预设问题采集，禁止自由散文反思。
- **冲突触发约束**：同 metric 三方差异超阈值必须自动触发 F020 七类归因矩阵。
- **CVO 愿景派生约束**：第一方 CVO 愿景信号从 VISION.md / ROADMAP.md 派生，禁止Forgekin自评愿景对齐度。
- **配置驱动约束**：冲突阈值、采访模板、采集指标外置 YAML。

### 1.3 架构影响

- **对 F018 Eval Contract**：friction_metrics 的"应该是什么样"基线由三方信号采集对照。
- **对 F020 七类归因矩阵**：三方冲突是 F020 归因的触发源，归因器读取冲突详情做七类分类。
- **对 F040 控制面**：三方信号写入 F040 Eval Hub，作为"哪块机制正在增值/折旧"的依据。
- **对 VISION.md / ROADMAP.md**：CVO 愿景信号反向驱动 VISION/ROADMAP 文档结构化（必须可机器读取）。
- **对Forgekin执行流**：第二方摩擦信号在Forgekin完成任务后触发结构化采访，注入到 Forgekin.verify 之后。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F018 ContractRegistry  F020 AttributionClassifier  F040 EvalHub   │
└──────────┬──────────────────┬──────────────────┬────────────────────┘
           │ friction_metrics │ on_conflict      │ hub
           ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L2: SignalCrossValidator（三方交叉验证 + 冲突检测）                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 1. 汇聚三方 Signal 列表                                     │  │
│  │ 2. 按 metric_name 分组                                       │  │
│  │ 3. 同 metric 三方差异 > conflict_threshold → 标记冲突       │  │
│  │ 4. 冲突自动派发 F020 归因                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬──────────────────┬──────────────────┬──────────────────────────┘
    │ cvo_vision       │ agent_friction   │ runtime_observation
    ▼                  ▼                  ▼
┌────────────┐  ┌────────────┐    ┌──────────────────┐
│CvoSignal   │  │Friction    │    │ RuntimeSignal    │
│Collector   │  │Interview   │    │ Collector        │
│（VISION派生）│  │Collector   │    │（MetricsCollector）│
└─────┬──────┘  └─────┬──────┘    └────────┬─────────┘
      │                │                    │
      ▼                ▼                    ▼
┌────────────┐  ┌────────────┐    ┌──────────────────┐
│VISION.md / │  │Interview   │    │ Tool Call / Fail │
│ROADMAP.md  │  │Template    │    │ Rate / Latency   │
│（结构化）  │  │（结构化问题）│    │ （F009 证据）    │
└────────────┘  └────────────┘    └──────────────────┘
```

### 2.2 关键架构决策

- **决策 1：第二方信号必须结构化采访**。预设问题列表（如"这次任务哪一步最卡？""哪个工具调用最失败？"），Forgekin按问题给答案。理由：自由散文反思无法机器处理，结构化采访让摩擦信号可量化、可对比、可归因。
- **决策 2：第一方信号从 VISION/ROADMAP 派生而非Forgekin自评**。CVO 愿景对齐度由 VISION.md / ROADMAP.md 的结构化字段派生（如"该 harness 组件对应 ROADMAP 第几条"），禁止Forgekin自评"我对齐愿景了"。理由：自评会引入"模型说自己好"的失真。
- **决策 3：冲突检测按 metric 分组**。同 metric_name 的三方信号差异 > conflict_threshold（默认 0.3）标记冲突。理由：跨 metric 比较无意义（如"工具调用频率"与"任务成功率"无可比性）。
- **决策 4：冲突自动触发 F020**。检测到冲突不依赖人工 review，自动派发到 F020 归因矩阵。理由：roleagent.md 第 5 章硬要求"三方不一致即触发归因"。
- **决策 5：禁止自由散文反思**。`forbid_free_form_reflection: true` 是硬配置，禁止Forgekin在采访外发送自由反思文本。理由：避免散文污染结构化信号。
- **决策 6：第三方信号复用 F009 Evidence & Sensors**。runtime_observation 信号来自 F009 已采集的工具调用模式/失败频率/重试次数/耗时分布，不另起采集器。理由：避免重复采集与数据不一致。

### 2.3 架构不变量

- 第二方 agent 摩擦信号必须用结构化采访采集，必须禁止自由散文反思。
- 第一方 CVO 愿景信号必须从 VISION.md / ROADMAP.md 派生，必须禁止Forgekin自评。
- 同 metric 三方差异超 conflict_threshold 必须自动触发 F020 归因。
- 第三方 runtime_observation 信号必须复用 F009 采集器，必须不另起采集。
- 采访模板必须从配置加载，必须禁止代码硬编码问题列表。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| SignalCollector | `flowforge/core/eval/signal/collector.py` | 三方信号采集统一入口 | `collect_cvo / collect_friction / collect_runtime` |
| CvoSignalCollector | `flowforge/core/eval/signal/cvo.py` | VISION/ROADMAP 派生 CVO 信号 | `derive_from_vision` |
| FrictionInterviewCollector | `flowforge/core/eval/signal/interview.py` | 结构化采访采集 | `conduct_interview` |
| RuntimeSignalCollector | `flowforge/core/eval/signal/runtime.py` | 复用 F009 采集 runtime 信号 | `collect_from_evidence` |
| SignalCrossValidator | `flowforge/core/eval/signal/cross_validator.py` | 三方交叉验证 + 冲突检测 | `cross_validate / detect_conflict` |
| SignalConfigLoader | `flowforge/core/eval/signal/config.py` | YAML 配置加载 | `load_signal_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class SignalSource(str, Enum):
    CVO_VISION = "cvo_vision"
    AGENT_FRICTION = "agent_friction"
    RUNTIME_OBSERVATION = "runtime_observation"


class Signal(BaseModel):
    signal_id: str
    source: SignalSource
    forgekin_id: Optional[str] = None  # CVO 信号无 forgekin_id
    metric_name: str = Field(min_length=1)
    value: float
    unit: str
    collected_at: datetime
    context: dict


class FrictionInterview(BaseModel):
    """第二方结构化采访（非自由散文）"""
    interview_id: str
    forgekin_id: str
    questions: list[str] = Field(min_length=1)
    answers: list[str] = Field(min_length=1)
    friction_score: float
    interview_template_version: str


class SignalConflict(BaseModel):
    conflict_id: str
    metric_name: str
    signals: list[Signal]
    max_diff: float
    detected_at: datetime


class CrossValidationResult(BaseModel):
    metric_name: str
    cvo_signal: Optional[Signal]
    friction_signal: Optional[Signal]
    runtime_signal: Optional[Signal]
    is_conflict: bool
    max_diff: float


class SignalCollector(ABC):
    @abstractmethod
    async def collect_cvo(self, metric: str) -> Signal:
        """从 VISION/ROADMAP 派生 CVO 信号；禁止Forgekin自评"""

    @abstractmethod
    async def collect_friction(self, interview: FrictionInterview) -> Signal:
        """结构化采访采集摩擦信号；拒绝自由散文"""

    @abstractmethod
    async def collect_runtime(self, metric: str) -> Signal:
        """复用 F009 Evidence 采集 runtime 信号"""


class SignalCrossValidator(ABC):
    @abstractmethod
    async def cross_validate(self, signals: list[Signal]) -> list[CrossValidationResult]:
        """按 metric_name 分组，三方差异 > conflict_threshold 标记冲突"""

    @abstractmethod
    async def detect_conflict(self, signals: list[Signal]) -> list[SignalConflict]:
        """检测冲突，自动派发 F020 归因"""


class CvoSignalCollector(ABC):
    @abstractmethod
    async def derive_from_vision(self, metric: str) -> Signal:
        """从 VISION.md / ROADMAP.md 结构化字段派生 CVO 信号"""
```

### 3.3 数据流

```
[三方采集路径]
  任务完成 / 周期触发
        │
        ├─ CvoSignalCollector.derive_from_vision(metric)
        │    └─ 读 VISION.md / ROADMAP.md 结构化字段
        │    └─ 派生愿景对齐度评分
        │
        ├─ FrictionInterviewCollector.conduct_interview(forgekin_id)
        │    └─ 加载采访模板（YAML）
        │    └─ Forgekin按问题给答案（结构化）
        │    └─ 拒绝自由散文反思
        │
        └─ RuntimeSignalCollector.collect_from_evidence(metric)
             └─ 复用 F009 Evidence & Sensors 已采集数据
             └─ 工具调用频率 / 失败率 / 重试次数 / latency_p95
        │
        ▼
  Signal 列表（三方）

[交叉验证路径]
  SignalCollector 采集完毕
        │
        ▼
  SignalCrossValidator.cross_validate(signals)
        │
        ├─ 按 metric_name 分组
        ├─ 同 metric 三方差异 > conflict_threshold (0.3) → is_conflict=True
        │
        ▼
  detect_conflict 检测冲突
        │
        ▼
  冲突自动派发 F020 AttributionClassifier.classify
        │
        ▼
  F020 七类归因矩阵分类根因

[愿景对齐反馈路径]
  CVO 信号 → F040 EvalHub
        │
        ▼
  CVO 查看哪块机制愿景对齐度低
        │
        ▼
  CVO 决策：保留 / 退役 / 升级愿景
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F009 Evidence & Sensors**：runtime_observation 信号复用 F009 已采集数据。
- 依赖 **F018 Eval Contract**：friction_metrics 列表决定哪些 metric 需要采集。
- 依赖 **VISION.md / ROADMAP.md**：CVO 愿景信号源，必须可机器读取（结构化字段）。

### 4.2 下游影响

- 影响 **F020 七类归因矩阵**：三方冲突是 F020 归因的触发源。
- 影响 **F040 控制面**：三方信号写入 F040 Eval Hub，作为"哪块机制正在增值/折旧"的依据。
- 影响 **F012 Entropy Control**：长期 CVO 愿景对齐度低可触发 F012 sunset review（通过 F018 sunset_signals）。
- 影响 **Forgekin.verify**：第二方摩擦采访注入到Forgekin verify 之后，作为标准反馈环节。

### 4.3 跨模块不变量

- 第二方摩擦信号必须用结构化采访，必须禁止自由散文（forbid_free_form_reflection=true）。
- 第一方 CVO 信号必须从 VISION/ROADMAP 派生，必须禁止Forgekin自评。
- 第三方 runtime 信号必须复用 F009，必须不另起采集器。
- 同 metric 三方差异超阈值必须自动触发 F020，必须不依赖人工 review。
- 采访模板必须从配置加载，必须禁止代码硬编码。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/eval/signal/` 不 import F018/F020/F040/F012 任何模块。
- [ ] AC-2: DI 容器注入通过——`SignalCollector` 通过 `inject("signal_collector")` 获取。
- [ ] AC-3: Repository 层通过——信号持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——冲突阈值 / 采访模板 / 采集指标从 `config/three_signal_cross.yaml` 加载。
- [ ] AC-5: 三方信号均可独立采集（集成测试覆盖）。

### 5.2 架构不变量验收

- [ ] AC-6: 第二方信号必须是 FrictionInterview 结构化对象，自由散文被拒绝（单测覆盖）。
- [ ] AC-7: 第一方 CVO 信号从 VISION/ROADMAP 派生，无Forgekin自评代码（静态扫描确认）。
- [ ] AC-8: 第三方 runtime 信号复用 F009，无独立采集器（静态扫描确认）。
- [ ] AC-9: 同 metric 三方差异 > 0.3 自动触发 F020 归因（集成测试覆盖）。
- [ ] AC-10: 采访模板从 YAML 加载，代码中无硬编码问题列表。

---

## 6. 引用

- [doc:../spec.md#§3.5]
- [doc:../arch.md#§3.5]
- [doc:../features/F009-evidence-sensors.md]
- [doc:../features/F012-entropy-control.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F019-three-signal-cross.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/009-eval-self-metabolism.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 三方采集 + 结构化采访 + 冲突自动触发归因） | 架构师 Forgekin（猫头鹰·鲁班） |

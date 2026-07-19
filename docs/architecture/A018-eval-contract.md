# A018: Eval Contract 五问架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005）
> **对应 arch.md**: [doc:../arch.md#§3.5]
> **对应 design.md**: [doc:../design.md#§3.5]（待创建）
> **对应 Feature**: [doc:../features/F018-eval-contract.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D018-eval-contract.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

Eval 自代谢系统的入口问题：新增一块 harness 组件时无任何预期声明，导致三类架构故障：

1. **无法判断增值**：不知道某 harness 组件是否在增值，技术债积累无法识别。
2. **无法识别退役**：组件退役信号无契约来源，F012 Entropy Control 的 sunset review 无依据触发。
3. **无法对齐摩擦**：组件摩擦指标无基线，F019 三方信号交叉缺少"应该是什么样"的对照。

roleagent.md 第 5 章硬要求：**新增一块 harness 时必须写清楚①服务谁 ②何时触发 ③摩擦指标 ④回归用例 ⑤退役信号**。本架构解决的核心问题：**如何在 L1 Eval Contract 层实现五问 Schema、契约注册、契约校验门禁，以及"无契约即拒绝合入"的硬约束**，让每块 harness 组件都有可验证的预期声明。

### 1.2 架构约束

- **单向依赖约束**：Eval Contract 层是 Eval 自代谢的 L1 底座，禁止被 F019/F020/F040 反向依赖。
- **合入门禁约束**：新增 harness 组件的 PR 必须附 EvalContract，CI 拒绝无契约 PR（编程红线第 15 条"未实现即 Bug"的延伸）。
- **五问非空约束**：who/when/friction_metrics/regression_cases/sunset_signals 任一为空即拒绝注册。
- **摩擦指标可采约束**：friction_metrics 必须可在 F019 三方信号交叉中采集，否则拒绝注册。
- **配置驱动约束**：五问必填字段、sunset_signal_handlers 外置 YAML。

### 1.3 架构影响

- **对 F012 Entropy Control**：sunset_signals 触发时联动 F012 启动 sunset review，是 Entropy Control 退役信号的契约来源。
- **对 F019 三方信号交叉**：friction_metrics 是 F019 三方信号采集的"应该是什么样"基线。
- **对 F020 七类归因矩阵**：契约 friction_metrics 偏离时触发 F020 归因，识别"harness 错位 vs 执行缺口"。
- **对 F040 控制面**：契约注册/校验/退役事件写入 F040 Eval Hub，作为"哪块机制在增值/折旧"的依据。
- **对 CI/CD**：合入门禁集成到 CI 流水线，无契约 PR 自动拒绝。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F012 SunsetReviewer  F019 SignalCollector  F020 Attributor  F040  │
└──────────┬──────────────────┬──────────────────┬─────────────┬─────┘
           │ list_by_component│ collect_friction │ on_deviate  │ hub
           ▼                  ▼                  ▼             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L1: EvalContractRegistry（契约注册中心 + 校验器）                    │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│  │ register()       │ │ get()            │ │ list_by_component│  │
│  │ validate_5q()    │ │ check_collectable│ │ emit_sunset()    │  │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘  │
└───┬──────────────────────────────────────────────┬─────────────────┘
    │ register / validate                          │ gate
    ▼                                              ▼
┌────────────────────┐               ┌──────────────────────────┐
│ContractRepository  │               │ ContractGate             │
│（禁直操作数据库）   │               │ （合入门禁，CI 集成）    │
└────────────────────┘               └──────────┬───────────────┘
                                                │
                                                ▼
                                    ┌──────────────────────────┐
                                    │ CI Pipeline              │
                                    │  PR 无契约 → 拒绝合入    │
                                    └──────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：五问 Schema 强类型而非自由文本**。who/when/friction_metrics/regression_cases/sunset_signals 用 Pydantic 模型强制类型，who 必须是灵智体类型枚举、friction_metrics 必须是 FrictionMetric 列表。理由：自由文本无法被 F019 自动采集，强类型让摩擦指标可机器读取。
- **决策 2：合入门禁硬约束而非软提示**。CI 在 PR 阶段强制校验 EvalContract 存在性，无契约直接拒绝合入。理由：软提示会被工程师以"先合入后补契约"绕过，硬约束是结构性保障。
- **决策 3：摩擦指标可采性校验**。`friction_metrics` 中每个 metric 必须在 F019 SignalCollector 中有对应采集器，否则拒绝注册。理由：声明了但采不到的指标是死指标，无 Eval 价值。
- **决策 4：sunset_signals 三类型枚举**。`unused_days / friction_above_threshold / superseded_by` 三类枚举，每类对应不同的 sunset 处理器。理由：避免自由文本触发器无法被 F012 自动识别。
- **决策 5：契约不可变，变更需新版本**。EvalContract 一旦注册不可修改，变更需新版本号注册，旧版本标 deprecated。理由：契约是历史记录，需要追溯"harness 组件曾经的预期是什么"。
- **决策 6：契约 schema_version 字段**。schema_version=1.0 起步，后续契约格式演进通过版本号区分。理由：Build to Persist 的兼容性保障。

### 2.3 架构不变量

- 新增 harness 组件 PR 必须附 EvalContract，无契约 PR 必须被 CI 拒绝。
- 五问字段（who/when/friction_metrics/regression_cases/sunset_signals）必须全部非空，任一为空必须拒绝注册。
- friction_metrics 中每个 metric 必须在 F019 SignalCollector 中有对应采集器。
- sunset_signals 必须是 `unused_days / friction_above_threshold / superseded_by` 三类之一。
- EvalContract 一旦注册必须不可变，变更必须新版本注册。
- ContractGate 必须集成到 CI 流水线，必须不依赖人工 review。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| EvalContractRegistry | `flowforge/core/eval/contract/registry.py` | 契约注册、查询、校验 | `register / get / list_by_component` |
| ContractRepository | `flowforge/core/eval/contract/repository.py` | 持久化读写 | 不对上层暴露 |
| ContractGate | `flowforge/core/eval/contract/gate.py` | 合入门禁，CI 集成 | `validate_on_merge` |
| FrictionMetricValidator | `flowforge/core/eval/contract/validator.py` | 摩擦指标可采性校验 | `check_collectable` |
| SunsetSignalDispatcher | `flowforge/core/eval/contract/sunset.py` | 退役信号派发到 F012 | `dispatch_sunset` |
| ContractConfigLoader | `flowforge/core/eval/contract/config.py` | YAML 配置加载 | `load_contract_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class FrictionMetric(BaseModel):
    name: str = Field(min_length=1)
    target_value: float
    alert_threshold: float
    collector: str  # 必须指向 F019 SignalCollector 中的采集器名


class SunsetSignalType(str, Enum):
    UNUSED_DAYS = "unused_days"
    FRICTION_ABOVE_THRESHOLD = "friction_above_threshold"
    SUPERSEDED_BY = "superseded_by"


class SunsetSignal(BaseModel):
    signal_type: SunsetSignalType
    threshold: float
    handler: str  # 必须指向 F012 sunset_review 或 F040 alert


class EvalContract(BaseModel):
    contract_id: str
    harness_component: str = Field(min_length=1)
    who: str = Field(min_length=1)
    when: str = Field(min_length=1)
    friction_metrics: list[FrictionMetric] = Field(min_length=1)
    regression_cases: list[str] = Field(min_length=1)
    sunset_signals: list[SunsetSignal] = Field(min_length=1)
    author_forgekin_id: str = Field(min_length=1)
    created_at: datetime
    schema_version: str = "1.0"


class GateResult(BaseModel):
    passed: bool
    reason: str


class EvalContractRegistry(ABC):
    @abstractmethod
    async def register(self, contract: EvalContract) -> str:
        """注册契约；五问非空校验 + 摩擦指标可采性校验"""

    @abstractmethod
    async def get(self, contract_id: str) -> EvalContract: ...

    @abstractmethod
    async def list_by_component(self, component: str) -> list[EvalContract]: ...


class ContractGate(ABC):
    @abstractmethod
    def validate_on_merge(self, component: str, pr_files: list[str]) -> GateResult:
        """
        合入门禁：
        1. 检查 PR 是否含 EvalContract 文件
        2. 检查契约五问非空
        3. 检查 friction_metrics 可采性
        任一失败 → passed=False
        """


class FrictionMetricValidator(ABC):
    @abstractmethod
    async def check_collectable(self, metrics: list[FrictionMetric]) -> bool:
        """每个 metric.collector 必须在 F019 SignalCollector 中存在"""


class SunsetSignalDispatcher(ABC):
    @abstractmethod
    async def dispatch_sunset(self, contract_id: str, signal: SunsetSignal) -> None:
        """派发 sunset 信号到 F012 sunset_review 或 F040 alert"""
```

### 3.3 数据流

```
[契约注册路径]
  灵智体开发新 harness 组件
        │
        ▼
  编写 EvalContract（五问 + friction_metrics + sunset_signals）
        │
        ▼
  EvalContractRegistry.register(contract)
        │
        ├─ 五问非空校验 ── 任一为空 ──▶ 抛 ValueError，拒绝注册
        ├─ FrictionMetricValidator.check_collectable() ── 不可采 ──▶ 拒绝
        ├─ sunset_signals 类型校验 ── 非三类枚举 ──▶ 拒绝
        │
        ▼
  ContractRepository.insert()
        │
        ▼
  返回 contract_id（不可变）

[合入门禁路径]
  开发者提交 PR（新增 harness 组件代码）
        │
        ▼
  CI Pipeline 触发 ContractGate.validate_on_merge(component, pr_files)
        │
        ├─ PR 文件中无 EvalContract 文件 ──▶ passed=False, reason="无契约"
        ├─ 契约五问任一为空 ──▶ passed=False, reason="五问不完整"
        ├─ friction_metrics 不可采 ──▶ passed=False, reason="摩擦指标不可采"
        │
        ▼
  passed=False → CI 拒绝合入
  passed=True  → CI 通过，进入代码 review

[退役信号路径]
  F019 SignalCollector 采集到 friction_above_threshold 信号
        │
        ▼
  SunsetSignalDispatcher.dispatch_sunset(contract_id, signal)
        │
        ├─ signal_type=unused_days → 派发 F012 sunset_review
        ├─ signal_type=friction_above_threshold → 派发 F040 alert + F012 review
        └─ signal_type=superseded_by → 派发 F012 formal_fix
        │
        ▼
  F012 启动 sunset review（三选一无"再看看"）
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F009 Evidence & Sensors**：契约注册时 author_forgekin_id 必须有 F009 证据支撑。
- 依赖 **F013 Harnessability 评估**：契约的 friction_metrics 与 F013 6 项评估指标对齐。

### 4.2 下游影响

- 影响 **F012 Entropy Control**：sunset_signals 是 F012 sunset review 的触发源，三选一无"再看看"。
- 影响 **F019 三方信号交叉**：friction_metrics 是 F019 采集的"应该是什么样"基线。
- 影响 **F020 七类归因矩阵**：friction_metrics 偏离时触发 F020 归因，识别"harness 错位 vs 执行缺口"。
- 影响 **F040 控制面**：契约注册/校验/退役事件写入 F040 Eval Hub，作为"哪块机制在增值/折旧"的依据。
- 影响 **CI/CD 流水线**：合入门禁集成到 CI，无契约 PR 自动拒绝。

### 4.3 跨模块不变量

- ContractGate 必须不依赖人工 review，必须自动化执行。
- friction_metrics 必须在 F019 SignalCollector 中有对应采集器，否则拒绝注册。
- sunset_signals 必须是三类枚举之一，必须禁止自由文本触发器。
- EvalContract 一旦注册必须不可变，变更必须新版本注册（旧版本 deprecated）。
- 契约 schema_version 必须显式声明，必须从 1.0 起步。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/eval/contract/` 不 import F012/F019/F020/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`EvalContractRegistry` 通过 `inject("eval_contract_registry")` 获取。
- [ ] AC-3: Repository 层通过——契约持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——五问必填字段 / sunset_signal_handlers 从 `config/eval_contract.yaml` 加载。
- [ ] AC-5: ContractGate 集成到 CI 流水线，无契约 PR 自动拒绝（集成测试覆盖）。

### 5.2 架构不变量验收

- [ ] AC-6: 五问任一为空的契约被拒绝注册（单测覆盖 5 种空字段场景）。
- [ ] AC-7: friction_metrics 中存在 F019 无法采集的 metric 时契约被拒绝注册。
- [ ] AC-8: sunset_signals 必须是三类枚举之一，自由文本触发器被拒绝。
- [ ] AC-9: EvalContract 注册后不可修改，变更需新版本注册（单测覆盖）。
- [ ] AC-10: ContractGate 不依赖人工 review，全自动化执行。
- [ ] AC-11: 契约 schema_version 字段必填，默认 1.0。

---

## 6. 引用

- [doc:../spec.md#§3.5]
- [doc:../arch.md#§3.5]
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
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 五问 Schema + 合入门禁 + 退役信号派发） | 架构师灵智体（猫头鹰·鲁班） |

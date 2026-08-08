# D019: 三方信号交叉详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005）
> **对应 arch.md**: [doc:../arch.md#§3.5]
> **对应 design.md**: [doc:../design.md#§3.5]
> **对应 Feature**: [doc:../features/F019-three-signal-cross.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A019-three-signal-cross.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

Eval 自代谢系统（§3.5）L2 层需要将三类独立信号源交叉验证，A019 架构设计已确认三类信号源：
1. **CVO 愿景信号**（来自 F007/F008 VISION.md 与 ROADMAP.md）
2. **Forgekin摩擦信号**（来自结构化采访，禁止自由散文）
3. **runtime 观测信号**（来自 F009 FrictionSignal）

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **三方信号语义对齐**：CVO 愿景（声明性）与 runtime 观测（事实性）的单位/语义差异如何在交叉验证前对齐（`metric_name` 标准化）。
2. **结构化采访的强约束实现**：`FrictionInterview` 必须使用预设问题列表 + 选项，禁止自由散文；如何在 Pydantic 模型层强制约束。
3. **冲突检测的阈值与归一化**：三方信号在数值维度（如 latency/error_rate）与分类维度（如 pass/fail）上的统一冲突判定算法。
4. **冲突自动派发 F020 的触发时机**：检测到冲突时同步阻塞派发还是异步事件派发，避免 Eval 流程被 F020 归因阻塞。
5. **采集去重与幂等**：同一 `forgekin_id` 在同一 `eval_cycle_id` 内的多源采集如何幂等（避免采集器重试导致信号被放大）。
6. **forbid_free_form_reflection 硬约束**：如何在所有采集器与配置中强制 `forbid_free_form_reflection=true`，禁止 LLM 自由反思输出散文。
7. **三方采集的并发与限流**：三个采集器并发执行时的 timeout/rate_limit 隔离，避免一个采集器失败拖累整体。
8. **signal_id 全局唯一性**：UUID v7 时序排序的 `signal_id` 在跨域采集时如何防止冲突。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/eval/cross/` 禁止 import F020/F040/F012 任何模块（编程红线第 10 条延伸）。F020 通过 EventBus 订阅冲突事件解耦。
- **DI 容器约束**：`SignalCrossValidator` 通过 DI 容器注入，绑定生命周期为 `singleton`，禁止直接实例化（编程红线第 12 条）。
- **Repository 层约束**：所有 signal 持久化必须经 `SignalRepository` 抽象，禁止直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：冲突阈值 / 采集超时 / 重试次数 / 问题列表外置 YAML（编程红线第 11 条）。
- **forbid_free_form_reflection 硬约束**：所有采集器与配置强制 `forbid_free_form_reflection=true`，禁止 LLM 自由反思散文输出。
- **结构化采访约束**：`FrictionInterview` 必须用 `StructuredQuestion[]` 列表 + `Literal` 选项，禁止 `free_text` 字段。
- **runtime 复用 F009 约束**：runtime 采集器必须复用 F009 FrictionSignal，不另起 telemetry pipeline。
- **异步约束**：所有 I/O 操作使用 `async/await`，三个采集器通过 `asyncio.gather` 并发。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。
- **提示词外置约束**：采访问题模板与冲突告警模板外置到 `config/eval/prompts.yaml`（编程红线第 11 条 + P16）。

### 1.3 设计影响

- **对 L1 Eval Contract（F018/A018）**：`FrictionMetric.friction_source` 字段成为本设计的输入来源之一。本设计需保证采集的 signal 与 F018 契约中的 metric_name 对齐。
- **对 L3 七类归因（F020/A020）**：`SignalConflict` 是 F020 归因分类器的输入。本设计需保证冲突派发的事件 schema 与 F020 输入契约一致。
- **对 F009 FrictionSignal**：runtime 采集器订阅 F009 事件流，复用其 metric 定义。本设计需保证不重复定义 metric。
- **对 F007/F008 VISION.md / ROADMAP.md**：CVO 采集器从声明性文档派生愿景信号。本设计需保证派生算法的幂等。
- **对 F012 退役**：当 `superseded_by` 冲突信号触发时，F012 退役流程启动。本设计需保证 sunset 信号的派发幂等。
- **对 F040 控制面**：所有信号与冲突事件写入 F040 Eval Hub。本设计需保证事件 schema 可被 F040 消费。
- **对 Forgekin.verify**：Forgekin 自检接口在 verify 中调用本设计的 `cross_validate`，作为可进化门禁之一。
- **对 DI 容器**：需新增 `signal_cross_validator` / `signal_repository` / `cvo_collector` / `friction_interview_collector` / `runtime_signal_collector` 五个绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          <<module>> eval.cross                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  <<enum>> SignalSource              <<enum>> ConflictSeverity              │
│  + CVO_VISION                       + LOW (< 0.3)                          │
│  + AGENT_FRICTION                   + MEDIUM (0.3 ~ 0.6)                  │
│  + RUNTIME_OBSERVATION              + HIGH (> 0.6)                         │
│                                                                            │
│  <<enum>> SignalValueType                                                   │
│  + NUMERIC                          <<model>> StructuredQuestion           │
│  + CATEGORICAL                      + question_id: str                     │
│                                     + metric_name: str                     │
│  <<model>> Signal                   + options: list[str]                   │
│  + signal_id: str (UUID v7)         + selected: str                        │
│  + source: SignalSource             + forbid_free_text: bool = true        │
│  + forgekin_id: str                                                          │
│  + eval_cycle_id: str               <<model>> FrictionInterview            │
│  + metric_name: str                 + interview_id: str                    │
│  + value: float | str               + forgekin_id: str                     │
│  + value_type: SignalValueType      + questions: list[StructuredQuestion]  │
│  + captured_at: datetime            + free_form_reflection: str = ""       │
│  + provenance_uri: str              + forbid_free_form: bool = true        │
│                                     + validator: model_validator           │
│  <<model>> SignalConflict                                                    │
│  + conflict_id: str                 <<model>> CrossValidationResult        │
│  + metric_name: str                 + cycle_id: str                        │
│  + signals: list[Signal]            + total_signals: int                   │
│  + severity: ConflictSeverity       + conflicts: list[SignalConflict]      │
│  + delta: float                     + passed: bool                         │
│  + dispatched_to_f020: bool         + dispatched_count: int                │
│                                                                            │
│  <<interface>> SignalCollector (ABC)                                       │
│  + collect(context) -> list[Signal]                                       │
│                                                                            │
│  <<interface>> CvoSignalCollector          <<interface>> FrictionInterview  │
│  + collect_from_vision -> list[Signal]   + conduct_interview          │
│                                                                            │
│  <<interface>> RuntimeSignalCollector                                      │
│  + collect_from_f009 -> list[Signal]                                      │
│                                                                            │
│  <<interface>> SignalCrossValidator                                        │
│  + cross_validate(cycle_id) -> CrossValidationResult                      │
│  + detect_conflicts(signals) -> list[SignalConflict]                      │
│  + dispatch_to_f020(conflicts) -> int                                      │
│                                                                            │
│  <<interface>> SignalRepository                                            │
│  + insert_signal(signal) -> str                                            │
│  + query_by_cycle(cycle_id) -> list[Signal]                                │
│  + dedup_by_idempotency_key(key) -> bool                                    │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/eval/cross/models.py
from __future__ import annotations
from typing import Optional, Literal, Union
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum


class SignalSource(str, Enum):
    CVO_VISION = "cvo_vision"  # 来自 VISION.md / ROADMAP.md
    AGENT_FRICTION = "agent_friction"  # 来自结构化采访
    RUNTIME_OBSERVATION = "runtime_observation"  # 来自 F009 FrictionSignal


class SignalValueType(str, Enum):
    NUMERIC = "numeric"
    CATEGORICAL = "categorical"


class ConflictSeverity(str, Enum):
    LOW = "low"  # delta < 0.3
    MEDIUM = "medium"  # 0.3 <= delta < 0.6
    HIGH = "high"  # delta >= 0.6


class Signal(BaseModel):
    """三方信号的统一数据模型"""
    model_config = ConfigDict(frozen=True)  # 信号不可变，避免被篡改

    signal_id: str = Field(min_length=1)  # UUID v7，时序排序
    source: SignalSource
    forgekin_id: str = Field(min_length=1)
    eval_cycle_id: str = Field(min_length=1)
    metric_name: str = Field(min_length=1)  # 标准化指标名（与 F018 对齐）
    value: Union[float, str]  # numeric 或 categorical
    value_type: SignalValueType
    captured_at: datetime
    provenance_uri: str = Field(min_length=1)  # 溯源 URI
    idempotency_key: str = Field(min_length=1)  # 幂等键：source:cycle:metric:forgekin

    @model_validator(mode="after")
    def _validate_value_type_consistency(self) -> "Signal":
        if self.value_type == SignalValueType.NUMERIC:
            if not isinstance(self.value, (int, float)):
                raise ValueError(f"NUMERIC signal value must be float, got {type(self.value)}")
        else:
            if not isinstance(self.value, str):
                raise ValueError(f"CATEGORICAL signal value must be str, got {type(self.value)}")
        return self


class StructuredQuestion(BaseModel):
    """结构化采访问题（禁止自由散文）"""
    model_config = ConfigDict(frozen=True)

    question_id: str = Field(min_length=1)
    metric_name: str = Field(min_length=1)  # 与 Signal.metric_name 对齐
    question_text: str = Field(min_length=1)
    options: list[str] = Field(min_length=2)  # 至少 2 个选项
    selected: str  # 必须在 options 中
    forbid_free_text: bool = True  # 硬约束：禁止自由文本

    @model_validator(mode="after")
    def _validate_selected_in_options(self) -> "StructuredQuestion":
        if self.selected not in self.options:
            raise ValueError(
                f"selected '{self.selected}' not in options {self.options}"
            )
        if self.forbid_free_text is not True:
            raise ValueError("forbid_free_text must be True (hard constraint)")
        return self


class FrictionInterview(BaseModel):
    """Forgekin结构化采访"""
    model_config = ConfigDict(frozen=True)

    interview_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    eval_cycle_id: str = Field(min_length=1)
    questions: list[StructuredQuestion] = Field(min_length=1)
    free_form_reflection: str = ""  # 必须为空，禁止自由散文
    forbid_free_form: bool = True  # 硬约束
    conducted_at: datetime

    @model_validator(mode="after")
    def _validate_no_free_form(self) -> "FrictionInterview":
        if self.forbid_free_form is not True:
            raise ValueError("forbid_free_form must be True (hard constraint)")
        if self.free_form_reflection and self.free_form_reflection.strip:
            raise ValueError(
                "free_form_reflection must be empty (forbid_free_form=True)"
            )
        # 检查问题列表中的所有 question 都禁止自由文本
        for q in self.questions:
            if q.forbid_free_text is not True:
                raise ValueError(
                    f"question {q.question_id} must have forbid_free_text=True"
                )
        return self


class SignalConflict(BaseModel):
    """三方信号冲突"""
    model_config = ConfigDict(frozen=True)

    conflict_id: str = Field(min_length=1)
    metric_name: str = Field(min_length=1)
    signals: list[Signal] = Field(min_length=2)  # 至少 2 个信号才有冲突
    severity: ConflictSeverity
    delta: float = Field(ge=0.0, le=1.0)  # 差异度
    dispatched_to_f020: bool = False
    detected_at: datetime


class CrossValidationResult(BaseModel):
    """三方交叉验证结果"""
    model_config = ConfigDict(frozen=True)

    cycle_id: str = Field(min_length=1)
    total_signals: int = Field(ge=0)
    conflicts: list[SignalConflict] = Field(default_factory=list)
    passed: bool = True
    dispatched_count: int = Field(default=0, ge=0)
    validated_at: datetime


# flowforge/core/eval/cross/interfaces.py
from abc import ABC, abstractmethod


class SignalCollector(ABC):
    """信号采集器基类"""

    @abstractmethod
    async def collect(self, context: "CollectContext") -> list[Signal]:
        """采集信号；返回 signal 列表（已幂等去重）"""


class CvoSignalCollector(SignalCollector):
    """CVO 愿景信号采集器"""

    @abstractmethod
    async def collect_from_vision(
        self, vision_uri: str, cycle_id: str
    ) -> list[Signal]:
        """
        从 VISION.md / ROADMAP.md 派生 CVO 愿景信号：
        1. 解析声明性文档（YAML frontmatter / markdown sections）
        2. 派生 metric（如 latency_target / accuracy_target）
        3. 派生 signal_id（UUID v7，幂等键：cvo:cycle:metric:forgekin）
        """


class FrictionInterviewCollector(SignalCollector):
    """Forgekin结构化采访采集器"""

    @abstractmethod
    async def conduct_interview(
        self, forgekin_id: str, cycle_id: str, question_bank_uri: str
    ) -> FrictionInterview:
        """
        执行结构化采访：
        1. 从 question_bank_uri 加载预设问题列表
        2. 询问 forgekin（结构化选项，禁止自由散文）
        3. 返回 FrictionInterview（forbid_free_form=True 硬约束）
        4. 将每个 selected 选项转换为 Signal
        """


class RuntimeSignalCollector(SignalCollector):
    """runtime 观测信号采集器（复用 F009）"""

    @abstractmethod
    async def collect_from_f009(
        self, forgekin_id: str, cycle_id: str, time_window: "TimeWindow"
    ) -> list[Signal]:
        """
        从 F009 FrictionSignal 流采集 runtime 信号：
        1. 订阅 F009 事件流
        2. 按 time_window 过滤
        3. 将 FrictionSignal 转换为 Signal（metric_name 对齐）
        """


class SignalCrossValidator(ABC):
    """三方信号交叉验证器"""

    @abstractmethod
    async def cross_validate(self, cycle_id: str) -> CrossValidationResult:
        """
        三方交叉验证主流程：
        1. 并发采集三方信号（asyncio.gather，三采集器隔离超时）
        2. 按 metric_name 分组
        3. 调用 detect_conflicts 检测冲突
        4. 调用 dispatch_to_f020 派发冲突到 F020
        5. 返回 CrossValidationResult
        """

    @abstractmethod
    async def detect_conflicts(
        self, signals: list[Signal]
    ) -> list[SignalConflict]:
        """
        冲突检测算法：
        1. 按 metric_name 分组
        2. 每组内三方信号两两计算 delta
        3. delta > conflict_threshold 标记冲突
        """

    @abstractmethod
    async def dispatch_to_f020(
        self, conflicts: list[SignalConflict]
    ) -> int:
        """
        派发冲突到 F020 归因器（异步事件，非阻塞）：
        1. 写入 EventBus（topic: f020.attribution.request）
        2. 标记 dispatched_to_f020=True
        返回成功派发的冲突数
        """


class SignalRepository(ABC):
    """信号持久化 Repository"""

    @abstractmethod
    async def insert_signal(self, signal: Signal) -> str:
        """插入信号；幂等键去重"""

    @abstractmethod
    async def query_by_cycle(self, cycle_id: str) -> list[Signal]:
        """按 cycle_id 查询所有信号"""

    @abstractmethod
    async def dedup_by_idempotency_key(self, key: str) -> bool:
        """幂等键去重；已存在返回 True，否则插入并返回 False"""

    @abstractmethod
    async def query_by_metric(
        self, cycle_id: str, metric_name: str
    ) -> list[Signal]:
        """按 metric_name 查询（供冲突检测使用）"""
```

### 2.3 数据结构 Pydantic Models（配置与上下文）

```python
# flowforge/core/eval/cross/config.py
from __future__ import annotations
from typing import Optional
from datetime import timedelta
from pydantic import BaseModel, Field, model_validator


class CollectContext(BaseModel):
    """采集上下文"""
    cycle_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    vision_uri: str = Field(min_length=1)
    roadmap_uri: Optional[str] = None
    question_bank_uri: str = Field(min_length=1)
    time_window_seconds: int = Field(default=3600, ge=60, le=86400)
    forbid_free_form_reflection: bool = True  # 硬约束

    @model_validator(mode="after")
    def _validate_forbid_free_form(self) -> "CollectContext":
        if self.forbid_free_form_reflection is not True:
            raise ValueError(
                "forbid_free_form_reflection must be True (hard constraint)"
            )
        return self


class TimeWindow(BaseModel):
    """runtime 采集时间窗口"""
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def _validate_range(self) -> "TimeWindow":
        if self.end <= self.start:
            raise ValueError("time_window.end must be after start")
        return self


class CrossValidationConfig(BaseModel):
    """YAML 配置加载结果"""
    conflict_threshold: float = Field(default=0.3, ge=0.0, le=1.0)
    severity_low_max: float = Field(default=0.3, ge=0.0, le=1.0)
    severity_medium_max: float = Field(default=0.6, ge=0.0, le=1.0)
    collector_timeout_seconds: int = Field(default=30, ge=5, le=120)
    collector_retry: int = Field(default=2, ge=0, le=5)
    collector_concurrency: int = Field(default=3, ge=1, le=5)  # 三采集器并发
    forbid_free_form_reflection: bool = True  # 硬约束
    dispatch_mode: str = "async"  # async | sync（async 默认，避免阻塞）
    question_bank_uri: str = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_thresholds(self) -> "CrossValidationConfig":
        if not (self.severity_low_max <= self.severity_medium_max <= 1.0):
            raise ValueError("severity thresholds must be low <= medium <= 1.0")
        if self.forbid_free_form_reflection is not True:
            raise ValueError(
                "forbid_free_form_reflection must be True (hard constraint)"
            )
        return self


class QuestionBank(BaseModel):
    """结构化采访问题库"""
    bank_id: str = Field(min_length=1)
    version: str = Field(min_length=1)
    questions: list["QuestionBankEntry"] = Field(min_length=1)


class QuestionBankEntry(BaseModel):
    """问题库条目"""
    question_id: str = Field(min_length=1)
    metric_name: str = Field(min_length=1)
    question_text: str = Field(min_length=1)
    options: list[str] = Field(min_length=2)
    forbid_free_text: bool = True  # 硬约束
```

### 2.4 关键算法伪代码

#### 2.4.1 三方并发采集算法

```
function cross_validate(cycle_id: str) -> CrossValidationResult:

    context = build_collect_context(cycle_id)

    # 三采集器并发，每个采集器独立超时与重试
    tasks = [
        cvo_collector.collect(context),
        friction_collector.collect(context),
        runtime_collector.collect(context),
    ]

    # asyncio.gather + return_exceptions 隔离失败
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_signals = []
    failed_collectors = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            failed_collectors.append(i)
            logger.warning(f"collector {i} failed: {result}")
            continue
        all_signals.extend(result)

    # 幂等去重（按 idempotency_key）
    unique_signals = dedup_by_idempotency_key(all_signals)

    # 持久化所有信号到 Repository
    for signal in unique_signals:
        await signal_repository.insert_signal(signal)

    # 检测冲突
    conflicts = await detect_conflicts(unique_signals)

    # 派发冲突到 F020（异步事件，非阻塞）
    dispatched = await dispatch_to_f020(conflicts)

    return CrossValidationResult(
        cycle_id=cycle_id,
        total_signals=len(unique_signals),
        conflicts=conflicts,
        passed=(len(conflicts) == 0),
        dispatched_count=dispatched,
        validated_at=now,
    )
```

#### 2.4.2 冲突检测算法

```
function detect_conflicts(signals: list[Signal]) -> list[SignalConflict]:

    # 按 metric_name 分组
    groups = group_by(signals, key=lambda s: s.metric_name)

    conflicts = []
    for metric_name, group_signals in groups.items:
        # 至少需要 2 个不同来源的信号才有冲突可能
        sources = set(s.source for s in group_signals)
        if len(sources) < 2:
            continue

        # 计算两两 delta
        for i in range(len(group_signals)):
            for j in range(i + 1, len(group_signals)):
                s1, s2 = group_signals[i], group_signals[j]
                delta = compute_delta(s1, s2)

                if delta > config.conflict_threshold:
                    severity = classify_severity(delta)
                    conflict = SignalConflict(
                        conflict_id=uuid_v7,
                        metric_name=metric_name,
                        signals=[s1, s2],
                        severity=severity,
                        delta=delta,
                        dispatched_to_f020=False,
                        detected_at=now,
                    )
                    conflicts.append(conflict)

    return conflicts


function compute_delta(s1: Signal, s2: Signal) -> float:
    if s1.value_type == NUMERIC and s2.value_type == NUMERIC:
        # 数值维度：归一化差异（0~1）
        max_val = max(abs(s1.value), abs(s2.value), 1e-9)
        return abs(s1.value - s2.value) / max_val
    elif s1.value_type == CATEGORICAL and s2.value_type == CATEGORICAL:
        # 分类维度：相同=0，不同=1
        return 0.0 if s1.value == s2.value else 1.0
    else:
        # 类型不一致：视为最大冲突
        return 1.0


function classify_severity(delta: float) -> ConflictSeverity:
    if delta < config.severity_low_max:
        return ConflictSeverity.LOW
    elif delta < config.severity_medium_max:
        return ConflictSeverity.MEDIUM
    else:
        return ConflictSeverity.HIGH
```

#### 2.4.3 冲突派发 F020 算法

```
function dispatch_to_f020(conflicts: list[SignalConflict]) -> int:

    if config.dispatch_mode == "sync":
        # 同步阻塞派发（仅测试用）
        for conflict in conflicts:
            await event_bus.publish_sync(
                topic="f020.attribution.request",
                payload=conflict,
            )
            conflict.dispatched_to_f020 = True
    else:
        # 异步事件派发（默认，避免阻塞 Eval 流程）
        await event_bus.publish_batch(
            topic="f020.attribution.request",
            payloads=conflicts,
        )
        for conflict in conflicts:
            conflict.dispatched_to_f020 = True

    return len(conflicts)
```

#### 2.4.4 CVO 愿景信号派生算法

```
function collect_from_vision(vision_uri: str, cycle_id: str) -> list[Signal]:

    # 解析 VISION.md（YAML frontmatter + markdown sections）
    doc = parse_markdown_with_frontmatter(vision_uri)

    signals = []
    for section in doc.sections:
        # 从声明性指标派生 signal
        if section.has_metric:
            metric_name = standardize_metric_name(section.metric_name)
            signal = Signal(
                signal_id=uuid_v7,
                source=SignalSource.CVO_VISION,
                forgekin_id="system_vision",  # 愿景信号无具体 forgekin
                eval_cycle_id=cycle_id,
                metric_name=metric_name,
                value=section.target_value,
                value_type=classify_value_type(section.target_value),
                captured_at=now,
                provenance_uri=f"{vision_uri}#{section.id}",
                idempotency_key=f"cvo:{cycle_id}:{metric_name}:system_vision",
            )
            signals.append(signal)

    return signals
```

#### 2.4.5 结构化采访执行算法

```
function conduct_interview(
    forgekin_id: str, cycle_id: str, question_bank_uri: str
) -> FrictionInterview:

    # 1. 从 question_bank_uri 加载预设问题列表
    bank = load_question_bank(question_bank_uri)

    # 2. 强约束：每个问题必须 forbid_free_text=True
    for entry in bank.questions:
        assert entry.forbid_free_text is True  # 硬约束校验

    # 3. 询问 forgekin（结构化选项，禁止自由散文）
    selected_answers = []
    for entry in bank.questions:
        # 调用 LLM，但限制输出为 options 之一
        selected = await ask_forgekin_structured(
            forgekin_id=forgekin_id,
            question_text=entry.question_text,
            options=entry.options,
        )
        assert selected in entry.options  # 必须是预设选项
        answer = StructuredQuestion(
            question_id=entry.question_id,
            metric_name=entry.metric_name,
            question_text=entry.question_text,
            options=entry.options,
            selected=selected,
            forbid_free_text=True,
        )
        selected_answers.append(answer)

    # 4. 构造 FrictionInterview（free_form_reflection 必须为空）
    interview = FrictionInterview(
        interview_id=uuid_v7,
        forgekin_id=forgekin_id,
        eval_cycle_id=cycle_id,
        questions=selected_answers,
        free_form_reflection="",  # 硬约束：必须为空
        forbid_free_form=True,
        conducted_at=now,
    )

    return interview
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/eval/cross/validator.py
from __future__ import annotations
import asyncio
import logging
from datetime import datetime, timezone
from typing import Iterable
import uuid

from .models import (
    Signal, SignalConflict, CrossValidationResult, ConflictSeverity,
    SignalValueType,
)
from .interfaces import (
    SignalCrossValidator, SignalRepository,
    CvoSignalCollector, FrictionInterviewCollector, RuntimeSignalCollector,
)
from .config import CrossValidationConfig
from ...core.events.event_bus import EventBus

logger = logging.getLogger(__name__)


class DefaultSignalCrossValidator(SignalCrossValidator):
    """三方信号交叉验证器默认实现"""

    def __init__(
        self,
        cvo_collector: CvoSignalCollector,
        friction_collector: FrictionInterviewCollector,
        runtime_collector: RuntimeSignalCollector,
        repository: SignalRepository,
        event_bus: EventBus,
        config: CrossValidationConfig,
    ):
        self._cvo = cvo_collector
        self._friction = friction_collector
        self._runtime = runtime_collector
        self._repo = repository
        self._bus = event_bus
        self._cfg = config

    async def cross_validate(self, cycle_id: str) -> CrossValidationResult:
        # 1. 三采集器并发，return_exceptions 隔离失败
        cvo_task = self._cvo.collect_from_vision(
            vision_uri="vision://VISION.md", cycle_id=cycle_id
        )
        friction_task = self._friction.conduct_interview(
            forgekin_id="default", cycle_id=cycle_id,
            question_bank_uri=self._cfg.question_bank_uri,
        )
        runtime_task = self._runtime.collect_from_f009(
            forgekin_id="default", cycle_id=cycle_id,
            time_window=self._build_default_window,
        )

        tasks = [cvo_task, friction_task, runtime_task]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # 2. 合并信号
        all_signals: list[Signal] = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                logger.warning(
                    f"collector {i} failed in cycle {cycle_id}: {r}"
                )
                continue
            if i == 1:  # friction_collector 返回 FrictionInterview
                interview = r
                all_signals.extend(self._interview_to_signals(interview, cycle_id))
            else:
                all_signals.extend(r)

        # 3. 幂等去重 + 持久化
        unique_signals: list[Signal] = []
        for s in all_signals:
            if await self._repo.dedup_by_idempotency_key(s.idempotency_key):
                continue  # 已存在，跳过
            await self._repo.insert_signal(s)
            unique_signals.append(s)

        # 4. 冲突检测
        conflicts = await self.detect_conflicts(unique_signals)

        # 5. 派发到 F020
        dispatched = await self.dispatch_to_f020(conflicts)

        result = CrossValidationResult(
            cycle_id=cycle_id,
            total_signals=len(unique_signals),
            conflicts=conflicts,
            passed=(len(conflicts) == 0),
            dispatched_count=dispatched,
            validated_at=datetime.now(timezone.utc),
        )
        logger.info(
            f"cross_validate cycle={cycle_id} total={result.total_signals} "
            f"conflicts={len(conflicts)} dispatched={dispatched}"
        )
        return result

    async def detect_conflicts(
        self, signals: list[Signal]
    ) -> list[SignalConflict]:
        # 按 metric_name 分组
        groups: dict[str, list[Signal]] = {}
        for s in signals:
            groups.setdefault(s.metric_name, []).append(s)

        conflicts: list[SignalConflict] = []
        for metric_name, group_signals in groups.items:
            sources = {s.source for s in group_signals}
            if len(sources) < 2:
                continue

            # 两两计算 delta
            for i in range(len(group_signals)):
                for j in range(i + 1, len(group_signals)):
                    s1, s2 = group_signals[i], group_signals[j]
                    delta = self._compute_delta(s1, s2)
                    if delta > self._cfg.conflict_threshold:
                        conflicts.append(SignalConflict(
                            conflict_id=str(uuid.uuid1),
                            metric_name=metric_name,
                            signals=[s1, s2],
                            severity=self._classify_severity(delta),
                            delta=delta,
                            dispatched_to_f020=False,
                            detected_at=datetime.now(timezone.utc),
                        ))
        return conflicts

    async def dispatch_to_f020(
        self, conflicts: list[SignalConflict]
    ) -> int:
        if not conflicts:
            return 0

        if self._cfg.dispatch_mode == "sync":
            for c in conflicts:
                await self._bus.publish_sync(
                    topic="f020.attribution.request", payload=c.model_dump
                )
                c._internal_set("dispatched_to_f020", True)  # type: ignore
        else:
            await self._bus.publish_batch(
                topic="f020.attribution.request",
                payloads=[c.model_dump for c in conflicts],
            )
            for c in conflicts:
                c._internal_set("dispatched_to_f020", True)  # type: ignore
        return len(conflicts)

    def _compute_delta(self, s1: Signal, s2: Signal) -> float:
        if s1.value_type == SignalValueType.NUMERIC and s2.value_type == SignalValueType.NUMERIC:
            max_val = max(abs(s1.value), abs(s2.value), 1e-9)  # type: ignore
            return abs(s1.value - s2.value) / max_val  # type: ignore
        elif s1.value_type == SignalValueType.CATEGORICAL and s2.value_type == SignalValueType.CATEGORICAL:
            return 0.0 if s1.value == s2.value else 1.0
        return 1.0  # 类型不一致视为最大冲突

    def _classify_severity(self, delta: float) -> ConflictSeverity:
        if delta < self._cfg.severity_low_max:
            return ConflictSeverity.LOW
        elif delta < self._cfg.severity_medium_max:
            return ConflictSeverity.MEDIUM
        return ConflictSeverity.HIGH

    def _interview_to_signals(
        self, interview, cycle_id: str
    ) -> list[Signal]:
        signals = []
        for q in interview.questions:
            # 选项转换为 categorical signal
            signal = Signal(
                signal_id=str(uuid.uuid1),
                source=SignalSource.AGENT_FRICTION,
                forgekin_id=interview.forgekin_id,
                eval_cycle_id=cycle_id,
                metric_name=q.metric_name,
                value=q.selected,
                value_type=SignalValueType.CATEGORICAL,
                captured_at=interview.conducted_at,
                provenance_uri=f"interview://{interview.interview_id}#{q.question_id}",
                idempotency_key=(
                    f"agent_friction:{cycle_id}:{q.metric_name}:"
                    f"{interview.forgekin_id}:{q.question_id}"
                ),
            )
            signals.append(signal)
        return signals

    def _build_default_window(self):
        from .config import TimeWindow
        from datetime import datetime, timedelta, timezone
        end = datetime.now(timezone.utc)
        start = end - timedelta(seconds=3600)
        return TimeWindow(start=start, end=end)
```

### 3.2 关键流程时序图

```
[三方交叉验证时序图]

  Forgekin.verify    cross_validator    CvoCollector   FrictionCollector  RuntimeCollector   EventBus    F020归因器
        │                    │                  │                 │                  │                │             │
        │ cross_validate   │                  │                 │                  │                │             │
        ├───────────────────>│                  │                 │                  │                │             │
        │                    │ collect_from_vision                │                  │                │             │
        │                    ├─────────────────>│                   │                  │                │             │
        │                    │                  │ return [Signal]  │                  │                │             │
        │                    │<─────────────────┤                   │                  │                │             │
        │                    │ conduct_interview                  │                  │                │             │
        │                    ├─────────────────────────────────────>│                  │                │             │
        │                    │                                      │ return Interview │                │             │
        │                    │<─────────────────────────────────────┤                  │                │             │
        │                    │ collect_from_f009                                     │                │             │
        │                    ├────────────────────────────────────────────────────────>│                │             │
        │                    │                                                          │ return [Sig]  │             │
        │                    │<────────────────────────────────────────────────────────┤                │             │
        │                    │                                                          │                │             │
        │                    │ dedup + insert_signal (Repository)                                       │             │
        │                    │ detect_conflicts                                                       │             │
        │                    │ dispatch_to_f020                                                       │             │
        │                    ├──────────────────────────────────────────────────────────────────────────>│             │
        │                    │                                                                          │ publish    │
        │                    │                                                                          ├───────────>│
        │                    │                                                                          │            │ attribution_classify
        │                    │                                                                          │            │
        │                    │<─────────────────── CrossValidationResult ──────────────────────────────┤             │
        │<───────────────────┤                                                                                          │
        │                    │                                                                                          │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 重试次数 |
|---------|---------|---------|---------|
| `CollectorTimeoutError` | 单采集器超过 `collector_timeout_seconds` | asyncio.gather return_exceptions 隔离，其他采集器继续 | 2（指数退避） |
| `CollectorRetryExhaustedError` | 重试次数耗尽 | 标记该采集器失败，继续其他采集器 | 不再重试 |
| `FrictionInterviewViolationError` | `free_form_reflection` 非空 / `forbid_free_text=False` | 拒绝该采访，记录违规到 F040 | 不重试（硬约束违规） |
| `QuestionBankLoadError` | 问题库 YAML 加载失败 | 阻塞 cross_validate，返回 failed result | 3（配置错误） |
| `IdempotencyKeyConflictError` | 幂等键冲突（理论不应发生） | 跳过该 signal，记录警告 | 不重试 |
| `F009StreamUnavailableError` | runtime 采集器订阅 F009 失败 | 标记 runtime 采集器失败，CVO + Friction 继续 | 2 |
| `DispatchError` | EventBus publish 失败 | 持久化到 Repository 待重试队列，后台 worker 重试 | 5（指数退避） |
| `MetricNameMismatchError` | metric_name 与 F018 契约不一致 | 拒绝该 signal，记录到 F040 评估告警 | 不重试 |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| 三方并发采集总时延 | < 5s | `asyncio.gather` 并发 + 每采集器独立超时 |
| 单采集器时延 | < 30s | 超时硬切断 + 指数退避重试 |
| 冲突检测延迟（1000 信号） | < 200ms | 按 metric_name 分组 + 两两 O(n^2) 仅在小组内 |
| 派发延迟（100 冲突） | < 50ms | EventBus batch publish |
| 持久化延迟（1000 信号） | < 500ms | 批量 insert + 幂等键索引 |
| Repository 查询延迟 | < 100ms | cycle_id + metric_name 复合索引 |
| 内存占用（10000 信号） | < 100MB | 流式处理 + 分批持久化 |
| signal_id 全局唯一性 | 100% | UUID v1 时序排序 + idempotency_key 兜底 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

- **F018 Eval Contract**：`FrictionMetric.friction_source` 字段被本设计的 FrictionInterviewCollector 转换为 Signal。调用方需保证 metric_name 与 F018 契约一致。
- **F007/F008 VISION.md / ROADMAP.md**：CVO 采集器从这两个文档派生愿景信号。调用方需保证文档存在且 schema 可解析。
- **F009 FrictionSignal**：RuntimeSignalCollector 订阅 F009 事件流，复用其 metric 定义。调用方需保证 F009 已部署且事件流可用。
- **F008 Durable State Surfaces**：CrossValidationResult 持久化到 F008 durable_record，作为 Eval 周期的状态快照。
- **DI 容器**：`signal_cross_validator` 通过 `inject("signal_cross_validator")` 获取。

### 4.2 下游影响如何被调用

- **F020 七类归因**：通过 EventBus 订阅 `f020.attribution.request` 主题接收冲突。F020 异步消费，不阻塞 Eval 流程。
- **F040 控制面**：所有信号、冲突、违规事件写入 F040 Eval Hub。F040 控制面订阅 `eval.cross.signal.collected` / `eval.cross.conflict.detected` 事件。
- **F012 退役**：当 `superseded_by` 类型的冲突信号触发时，F012 退役流程启动。F012 订阅 `f012.retire.request` 事件。
- **Forgekin.verify**：Forgekin 自检接口在 verify 中调用 `cross_validate`，作为可进化门禁之一。
- **EAC v1 契约**：本设计是 EAC v1 七契约中的"评估契约"物理承载，提供三方信号交叉验证能力。

### 4.3 集成测试点

| 测试点 ID | 测试场景 | 验证点 | 责任方 |
|----------|---------|--------|--------|
| IT-D019-001 | 三方并发采集正常流程 | 3 个采集器均成功，signals 总数 = 三方之和 | 测试员Forgekin（蜜獾·平头哥） |
| IT-D019-002 | 单采集器超时隔离 | 1 个采集器超时，其他 2 个继续，result.total_signals 反映成功采集器 | 测试员Forgekin |
| IT-D019-003 | 单采集器重试耗尽 | 1 个采集器重试耗尽后失败，不阻塞其他采集器 | 测试员Forgekin |
| IT-D019-004 | 幂等去重 | 同一 idempotency_key 的 signal 仅入库一次 | 测试员Forgekin |
| IT-D019-005 | 冲突检测（数值维度） | latency 数值差异 > 0.3 标记冲突 | 测试员Forgekin |
| IT-D019-006 | 冲突检测（分类维度） | categorical 选项不同标记冲突（delta=1.0） | 测试员Forgekin |
| IT-D019-007 | 冲突派发到 F020 | EventBus 收到 `f020.attribution.request` 事件 | 测试员Forgekin |
| IT-D019-008 | forbid_free_form_reflection 硬约束 | FrictionInterview.free_form_reflection 非空时拒绝 | 测试员Forgekin |
| IT-D019-009 | 结构化采访禁止自由文本 | StructuredQuestion.forbid_free_text=False 时拒绝 | 测试员Forgekin |
| IT-D019-010 | CVO 愿景派生幂等 | 同一 VISION.md 多次采集派生相同 signal_id（同 idempotency_key） | 测试员Forgekin |
| IT-D019-011 | runtime 复用 F009 | RuntimeSignalCollector 不重复定义 metric，复用 F009 定义 | 测试员Forgekin |
| IT-D019-012 | metric_name 与 F018 契约对齐 | 不一致时 MetricNameMismatchError 抛出 | 测试员Forgekin |
| IT-D019-013 | severity 分类正确 | delta < 0.3 LOW，0.3~0.6 MEDIUM，>= 0.6 HIGH | 测试员Forgekin |
| IT-D019-014 | 异步派发不阻塞 Eval | dispatch_mode=async 时 cross_validate 总时延 < 5s | 测试员Forgekin |
| IT-D019-015 | Repository 查询性能 | 1000 信号下 cycle_id 查询 < 100ms | 测试员Forgekin |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-D019-001**: 三方并发采集正常流程通过（IT-D019-001）
- [ ] **AC-D019-002**: 单采集器超时隔离生效（IT-D019-002）
- [ ] **AC-D019-003**: 单采集器重试耗尽不阻塞其他采集器（IT-D019-003）
- [ ] **AC-D019-004**: 幂等去重正确（IT-D019-004）
- [ ] **AC-D019-005**: 数值维度冲突检测正确（IT-D019-005）
- [ ] **AC-D019-006**: 分类维度冲突检测正确（IT-D019-006）
- [ ] **AC-D019-007**: 冲突派发到 F020 通过 EventBus（IT-D019-007）
- [ ] **AC-D019-008**: forbid_free_form_reflection 硬约束生效（IT-D019-008）
- [ ] **AC-D019-009**: 结构化采访禁止自由文本硬约束生效（IT-D019-009）
- [ ] **AC-D019-010**: CVO 愿景派生幂等（IT-D019-010）

### 5.2 性能验收 AC

- [ ] **AC-D019-011**: 三方并发采集总时延 < 5s（IT-D019-014）
- [ ] **AC-D019-012**: 单采集器时延 < 30s
- [ ] **AC-D019-013**: 冲突检测延迟（1000 信号）< 200ms
- [ ] **AC-D019-014**: 派发延迟（100 冲突）< 50ms
- [ ] **AC-D019-015**: Repository 查询延迟 < 100ms（IT-D019-015）
- [ ] **AC-D019-016**: signal_id 全局唯一性 100%
- [ ] **AC-D019-017**: 内存占用（10000 信号）< 100MB

### 5.3 安全验收 AC

- [ ] **AC-D019-018**: `forbid_free_form_reflection=true` 硬约束在所有采集器与配置中强制（静态扫描确认）
- [ ] **AC-D019-019**: `forbid_free_text=true` 硬约束在所有 StructuredQuestion 中强制（运行时校验）
- [ ] **AC-D019-020**: 信号不可变（Pydantic frozen=True）
- [ ] **AC-D019-021**: 幂等键去重生效，无重复信号入库
- [ ] **AC-D019-022**: metric_name 与 F018 契约对齐，不一致时拒绝
- [ ] **AC-D019-023**: 采集失败隔离，单点失败不拖累整体
- [ ] **AC-D019-024**: Repository 层抽象，不直操作数据库

### 5.4 Eval 验收 AC

- [ ] **AC-D019-025**: 三方信号采集覆盖率 >= 90%（至少 2 个来源覆盖每 metric）
- [ ] **AC-D019-026**: 冲突检测准确率 >= 95%（人工标注对照）
- [ ] **AC-D019-027**: F020 派发成功率 100%（EventBus 持久化保证）
- [ ] **AC-D019-028**: Eval 周期内冲突派发延迟 < 50ms
- [ ] **AC-D019-029**: 结构化采访覆盖 14 个 friction_metric（与 F018 对齐）

---

## 6. 引用

- [doc:../spec.md#§3.5]
- [doc:../arch.md#§3.5]
- [doc:../architecture/A019-three-signal-cross.md]
- [doc:../features/F007-vision-roadmap.md]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F009-friction-signal.md]
- [doc:../features/F012-sunset.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F019-three-signal-cross.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/009-eval-self-metabolism.md]
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（三方信号模型 + 交叉验证算法 + 冲突派发 F020 + forbid_free_form_reflection 硬约束 + 15 集成测试点 + 4 类 AC） | 开发者 Forgekin（猎犬·夏洛克） |

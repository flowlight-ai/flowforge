# D009: Evidence & Sensors 详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.3]
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]
> **对应 Feature**: [doc:../features/F009-evidence-sensors.md]
> **对应 Architecture**: [doc:../architecture/A009-evidence-sensors.md]
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A009 架构层定义了"6 类证据 + 二态裁决 + 先红后绿 + 自审拒绝 + DOM_DIFF 强制"骨架，本详细设计需要回答下列"如何落地"问题：

1. **D-Q1**：6 类 EvidenceType 如何在 Pydantic 模型层统一抽象，又能保留每类特异字段（如 `TEST_RED_GREEN` 必须含红+绿两次运行记录）？
2. **D-Q2**：`ReviewVerdict.decision` 仅允许 `approve` / `blocking`，第三态如何在 Pydantic 层硬约束？`follow_up_notes` 非空时如何自动降级为 `blocking`？
3. **D-Q3**：`VerdictValidator` 如何校验"reviewer_forgekin_id != evidence.forgekin_id"以禁自审？
4. **D-Q4**：`TEST_RED_GREEN` 证据如何硬校验"修复前红 + 修复后绿"两个测试运行记录都存在？
5. **D-Q5**：Web 功能证据如何强制含 `DOM_DIFF`（T8 铁律），仅看退出码如何被拒绝？
6. **D-Q6**：`EvidenceCollector` 与 `SensorRegistry` 如何通过 DI 容器协作，证据写入 D008 Durable Surface 的 `task_queue` 或 `thread_trace`？
7. **D-Q7**：D007 Push Back 的 `evidence_refs` 如何锚定到本模块的 `evidence_id`，保证不可锚定到不存在的证据？

### 1.2 设计约束

| 编号 | 约束 | 来源 |
|------|------|------|
| C1 | `flowforge/core/harness/evidence.py` 不可 import forgemind 或 *Forge 模块 | 单向依赖 |
| C2 | EvidenceCollector / SensorRegistry / VerdictValidator 通过 `@inject` 注入 | DI 容器 |
| C3 | Evidence / ReviewVerdict 通过 Repository 持久化到 D008 Durable Surface | Repository 层 |
| C4 | `allowed_decisions` / `sensors` 配置外置到 `flowforge/config/harness.yaml` | 配置驱动 |
| C5 | `ReviewVerdict.decision` 仅允许 `approve` / `blocking`，禁第三态 | A009 决策 1 |
| C6 | `follow_up_notes` 非空时强制 `decision=blocking`（避免模棱两可） | A009 决策 2 |
| C7 | `TEST_RED_GREEN` 证据必须包含"修复前红 + 修复后绿"两个测试运行记录 | A009 决策 3 |
| C8 | `reviewer_forgekin_id == evidence.forgekin_id` 时拒绝写入 verdict（禁自审） | A009 决策 4 |
| C9 | Web 功能证据必须含 `DOM_DIFF`（T8 铁律），禁只看退出码 | A009 决策 5 |
| C10 | Evidence `verifiable=true` 强制（不可写入不可验证的证据） | A009 不变量 |
| C11 | 所有 Evidence / Verdict 写入走 WAL，进程崩溃可重放 | F021 联动 |
| C13 | 觉醒阶标注：E1-E3 进化阶Forgekin可作为 reviewer；E4+ 觉醒阶Forgekin作 reviewer 需 MindCouncil 二次确认 | naming-contract.md §4 |

### 1.3 设计影响

| 编号 | 影响 | 关联模块 |
|------|------|---------|
| I1 | D002 TeamAct EVIDENCE 步调用 `EvidenceCollector.collect` 采集证据 | D002 / A002 |
| I2 | D002 TeamAct VERDICT 步调用 `VerdictValidator.validate` 校验裁决 | D002 / A002 |
| I3 | D007 Push Back 的 `evidence_refs` 锚定到本模块的 `evidence_id` | D007 / A007 |
| I4 | D008 Durable Surface 持久化证据（`task_queue` 或 `thread_trace`） | D008 / A008 |
| I5 | D001 CapabilityProfile 用证据累积历史表现 | D001 / A001 |
| I6 | D018 Eval Contract 采集 trace 信号（来自 `TRACE_LOG` 证据） | D018 / A018 |
| I7 | D021 Side Effect WAL 联动证据写入 | D021 / A021 |

---

## 2. 详细设计

### 2.1 类图

```
┌──────────────────────────────────────────────────────────────────────┐
│                     flowforge/core/harness/evidence.py               │
├──────────────────────────────────────────────────────────────────────┤
│  «enum» EvidenceType                                                 │
│    + COMMIT              (git commit)                                │
│    + TEST_RED_GREEN      (先红后绿, 必须含红+绿两次运行)             │
│    + QUALITY_GATE        (lint/type check/test/review)               │
│    + TRACE_LOG           (trace 信号)                                │
│    + SCREENSHOT          (截图)                                      │
│    + DOM_DIFF            (Web 功能 DOM 验证, T8 铁律)                │
│                                                                      │
│  «enum» VerdictDecision                                              │
│    + APPROVE             (通过)                                      │
│    + BLOCKING            (阻断, follow_up_notes 非空强制降级)        │
│                                                                      │
│  «Pydantic» Evidence                                                 │
│    + evidence_id: str                                                │
│    + evidence_type: EvidenceType                                     │
│    + forgekin_id: str          (产出者)                              │
│    + payload_ref: str          (commit sha / 测试 ID / trace ID)     │
│    + payload: dict             (完整 payload)                        │
│    + produced_at: datetime                                          │
│    + verifiable: bool = True  (必须可独立验证)                       │
│    + schema_version: str = "v1"                                      │
│    + wal_lsn: int = 0                                                │
│    + decay_tag: DecayTag = BUILT_TO_PERSIST                          │
│    + authority_level: int = 3                                        │
│                                                                      │
│  «Pydantic» TestRedGreenPayload                                      │
│    + red_run: TestRun         (修复前红)                             │
│    + green_run: TestRun       (修复后绿)                             │
│                                                                      │
│  «Pydantic» TestRun                                                  │
│    + run_id: str                                                     │
│    + status: Literal["red", "green"]                                 │
│    + timestamp: datetime                                             │
│    + failure_summary: Optional[str]                                  │
│                                                                      │
│  «Pydantic» DomDiffPayload                                           │
│    + url: str                                                        │
│    + before_html: str        (操作前 DOM)                            │
│    + after_html: str         (操作后 DOM)                            │
│    + diff_summary: str                                                │
│    + http_status: int        (HTTP 状态码)                           │
│                                                                      │
│  «Pydantic» ReviewVerdict                                            │
│    + verdict_id: str                                                 │
│    + reviewer_forgekin_id: str                                       │
│    + target_evidence_ids: list[str]                                  │
│    + decision: VerdictDecision                                       │
│    + rationale: str            (必须非空)                            │
│    + follow_up_notes: Optional[str]   (非空强制降级)                 │
│    + decided_at: datetime                                            │
│    + schema_version: str = "v1"                                      │
│    + wal_lsn: int = 0                                                │
│                                                                      │
│  «ABC» EvidenceCollector                                             │
│    + collect(etype, forgekin_id, payload) -> str                     │
│    + verify(evidence_id) -> bool                                     │
│                                                                      │
│  «ABC» SensorRegistry                                                │
│    + register(sensor) -> None                                        │
│    + read(sensor_id) -> SensorReading                                │
│                                                                      │
│  «ABC» VerdictValidator                                              │
│    + validate(verdict, evidence_store) -> ValidationResult           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│            infra/repo/sqlite_evidence_store.py                       │
│  «implements EvidenceStore» SqliteEvidenceStore                      │
│    + async save(evidence) -> str                                     │
│    + async save_verdict(verdict) -> str                              │
│    + async load(evidence_id) -> Optional[Evidence]                   │
│    + async verify(evidence_id) -> bool                               │
│    + async list_by_forgekin(forgekin_id) -> list[Evidence]           │
│    + async checkpoint -> None                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口与 Pydantic 模型

```python
# flowforge/core/harness/evidence.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from flowforge.core.plugin.di_container import inject
from flowforge.core.harness.decay_tag import DecayTag


# ───────────────────────────── 枚举 ─────────────────────────────

class EvidenceType(str, Enum):
    """6 类证据"""
    COMMIT = "commit"
    TEST_RED_GREEN = "test_red_green"
    QUALITY_GATE = "quality_gate"
    TRACE_LOG = "trace_log"
    SCREENSHOT = "screenshot"
    DOM_DIFF = "dom_diff"


class VerdictDecision(str, Enum):
    """二态裁决（禁第三态, A009 决策 1）"""
    APPROVE = "approve"
    BLOCKING = "blocking"


# ───────────────────────────── 异常 ─────────────────────────────

class EvidenceError(Exception):
    """Evidence 基础异常"""


class InvalidEvidenceError(EvidenceError):
    """证据格式非法"""


class NotVerifiableError(EvidenceError):
    """证据不可独立验证"""


class SelfReviewError(EvidenceError):
    """reviewer == author, 禁自审"""


class TestRedGreenIncompleteError(EvidenceError):
    """TEST_RED_GREEN 证据缺红或绿运行"""


class DomDiffMissingError(EvidenceError):
    """Web 功能证据缺 DOM_DIFF（违反 T8 铁律）"""


class ThirdVerdictStateError(EvidenceError):
    """裁决第三态被拒绝"""


# ───────────────────────────── Pydantic 模型 ─────────────────────────────

class TestRun(BaseModel):
    """单次测试运行"""
    run_id: str = Field(..., min_length=1)
    status: Literal["red", "green"]
    timestamp: datetime
    failure_summary: Optional[str] = None


class TestRedGreenPayload(BaseModel):
    """TEST_RED_GREEN 证据 payload（必须含红+绿两次运行）"""
    red_run: TestRun
    green_run: TestRun

    @model_validator(mode="after")
    def _red_then_green(self) -> "TestRedGreenPayload":
        if self.red_run.status != "red":
            raise TestRedGreenIncompleteError("red_run.status 必须为 'red'")
        if self.green_run.status != "green":
            raise TestRedGreenIncompleteError("green_run.status 必须为 'green'")
        if self.green_run.timestamp < self.red_run.timestamp:
            raise TestRedGreenIncompleteError("green_run.timestamp 必须晚于 red_run.timestamp")
        return self


class DomDiffPayload(BaseModel):
    """DOM_DIFF 证据 payload（T8 铁律）"""
    url: str = Field(..., min_length=1)
    before_html: str = Field(..., min_length=1)
    after_html: str = Field(..., min_length=1)
    diff_summary: str = Field(..., min_length=1)
    http_status: int = Field(..., ge=100, le=599)


class Evidence(BaseModel):
    """单条证据"""
    evidence_id: str = Field(..., min_length=1)
    evidence_type: EvidenceType
    forgekin_id: str = Field(..., min_length=1)
    payload_ref: str = Field(..., min_length=1)
    payload: dict[str, Any]
    produced_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    verifiable: bool = True
    schema_version: str = Field(default="v1")
    wal_lsn: int = Field(default=0, ge=0)
    decay_tag: DecayTag = Field(default=DecayTag.BUILT_TO_PERSIST)
    authority_level: int = Field(default=3, ge=1, le=5)

    @field_validator("verifiable")
    @classmethod
    def _must_be_verifiable(cls, v: bool) -> bool:
        if not v:
            raise NotVerifiableError("Evidence 必须可独立验证 (verifiable=true)")
        return v

    @model_validator(mode="after")
    def _payload_matches_type(self) -> "Evidence":
        """按 evidence_type 校验 payload 结构"""
        if self.evidence_type == EvidenceType.TEST_RED_GREEN:
            # payload 必须含 red_run + green_run
            TestRedGreenPayload.model_validate(self.payload)
        elif self.evidence_type == EvidenceType.DOM_DIFF:
            DomDiffPayload.model_validate(self.payload)
        return self


class ReviewVerdict(BaseModel):
    """跨 agent review 裁决（二态硬约束）"""
    verdict_id: str = Field(..., min_length=1)
    reviewer_forgekin_id: str = Field(..., min_length=1)
    target_evidence_ids: list[str] = Field(..., min_length=1)
    decision: VerdictDecision
    rationale: str = Field(..., min_length=1)
    follow_up_notes: Optional[str] = None
    decided_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    schema_version: str = Field(default="v1")
    wal_lsn: int = Field(default=0, ge=0)

    @field_validator("rationale")
    @classmethod
    def _rationale_non_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ThirdVerdictStateError("ReviewVerdict rationale 不可为空")
        return v.strip

    @model_validator(mode="after")
    def _follow_up_forces_blocking(self) -> "ReviewVerdict":
        """follow_up_notes 非空 → 强制 decision=blocking（A009 决策 2）"""
        if self.follow_up_notes and self.follow_up_notes.strip:
            if self.decision != VerdictDecision.BLOCKING:
                # 自动降级
                self.decision = VerdictDecision.BLOCKING
        return self


class ValidationResult(BaseModel):
    """校验结果"""
    ok: bool
    errors: list[str] = Field(default_factory=list)


class SensorReading(BaseModel):
    """传感器读数"""
    sensor_id: str
    value: Any
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: dict[str, Any] = Field(default_factory=dict)


# ───────────────────────────── 抽象基类 ─────────────────────────────

class EvidenceStore(ABC):
    """证据持久化仓储"""

    @abstractmethod
    async def save(self, evidence: Evidence) -> str:
        """保存证据, 返回 evidence_id（WAL 写入）"""

    @abstractmethod
    async def save_verdict(self, verdict: ReviewVerdict) -> str:
        """保存裁决, 返回 verdict_id（WAL 写入）"""

    @abstractmethod
    async def load(self, evidence_id: str) -> Optional[Evidence]:
        """按 id 装载证据"""

    @abstractmethod
    async def verify(self, evidence_id: str) -> bool:
        """独立验证证据存在 + 可验证"""

    @abstractmethod
    async def list_by_forgekin(self, forgekin_id: str) -> list[Evidence]:
        """按产出者列出证据（供 CapabilityProfile 累积历史表现）"""


class EvidenceCollector(ABC):
    """证据采集器"""

    @abstractmethod
    async def collect(
        self,
        etype: EvidenceType,
        forgekin_id: str,
        payload: dict[str, Any],
    ) -> str:
        """采集证据, 返回 evidence_id

        架构契约:
        - TEST_RED_GREEN 必须含 red_run + green_run（先红后绿）
        - Web 功能证据必须含 DOM_DIFF（T8 铁律）
        - 持久化到 D008 Durable Surface（task_queue / thread_trace）
        - WAL 可重放（F021 联动）
        - 返回的 evidence_id 供 D007 Push Back evidence_refs 锚定
        """

    @abstractmethod
    async def verify(self, evidence_id: str) -> bool:
        """独立验证证据"""


class SensorRegistry(ABC):
    """传感器注册中心"""

    @abstractmethod
    def register(self, sensor_id: str, sensor: Any) -> None:
        """注册传感器"""

    @abstractmethod
    async def read(self, sensor_id: str) -> SensorReading:
        """读取传感器数据"""


class VerdictValidator(ABC):
    """裁决校验器"""

    @abstractmethod
    async def validate(
        self,
        verdict: ReviewVerdict,
        evidence_store: EvidenceStore,
    ) -> ValidationResult:
        """校验裁决

        架构契约:
        - decision 仅允许 approve / blocking（Pydantic 已硬约束）
        - follow_up_notes 非空时强制 decision=blocking（Pydantic 已硬约束）
        - reviewer_forgekin_id == evidence.forgekin_id 时拒绝（禁自审）
        - TEST_RED_GREEN 证据必须包含红+绿两次运行（Pydantic 已硬约束）
        - Web 功能证据必须含 DOM_DIFF（T8 铁律）
        """
```

### 2.3 默认实现

```python
# flowforge/core/harness/evidence.py（续）

class DefaultEvidenceCollector(EvidenceCollector):
    """证据采集器默认实现"""

    @inject
    def __init__(
        self, *,
        store: EvidenceStore,
        durable_state_registry,    # D008 Registry
        event_bus,
        eval_signal_writer,
    ) -> None:
        self._store = store
        self._durable_state_registry = durable_state_registry
        self._event_bus = event_bus
        self._eval_signal_writer = eval_signal_writer

    async def collect(
        self,
        etype: EvidenceType,
        forgekin_id: str,
        payload: dict[str, Any],
    ) -> str:
        # 1. 构造 Evidence（Pydantic 校验自动触发）
        evidence = Evidence(
            evidence_id=f"ev-{etype.value}-{forgekin_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
            evidence_type=etype,
            forgekin_id=forgekin_id,
            payload_ref=payload.get("ref", ""),
            payload=payload,
        )

        # 2. T8 铁律: Web 功能证据必须含 DOM_DIFF
        #    判定方式: payload 中带 "is_web_function": true 时强制 etype=DOM_DIFF
        if payload.get("is_web_function") and etype != EvidenceType.DOM_DIFF:
            raise DomDiffMissingError(
                "Web 功能证据必须为 DOM_DIFF 类型（T8 铁律）"
            )

        # 3. 持久化到 EvidenceStore
        evidence_id = await self._store.save(evidence)

        # 4. 同步写入 D008 Durable Surface（task_queue）
        from flowforge.core.harness.durable_state import (
            DurableSurface, StateSurfaceType,
        )
        surface = DurableSurface(
            surface_id=f"ev-surface-{evidence_id}",
            surface_type=StateSurfaceType.TASK_QUEUE,
            key=f"evidence:{evidence_id}",
            payload=evidence.model_dump,
            authority_level=3,
            compression_immune=True,
            decay_tag=DecayTag.BUILT_TO_PERSIST,
            authored_by=forgekin_id,
        )
        await self._durable_state_registry.write(surface)

        # 5. 发布事件 + Eval 信号
        await self._event_bus.publish_async(
            "evidence.collected",
            {
                "evidence_id": evidence_id,
                "evidence_type": etype.value,
                "forgekin_id": forgekin_id,
            },
        )
        self._eval_signal_writer.write_trace(
            signal_type="evidence_collected",
            payload={"evidence_id": evidence_id, "type": etype.value},
        )
        return evidence_id

    async def verify(self, evidence_id: str) -> bool:
        return await self._store.verify(evidence_id)


class DefaultSensorRegistry(SensorRegistry):
    """传感器注册中心"""

    @inject
    def __init__(self) -> None:
        self._sensors: dict[str, Any] = {}

    def register(self, sensor_id: str, sensor: Any) -> None:
        if sensor_id in self._sensors:
            raise InvalidEvidenceError(f"sensor_id '{sensor_id}' 已注册")
        self._sensors[sensor_id] = sensor

    async def read(self, sensor_id: str) -> SensorReading:
        if sensor_id not in self._sensors:
            raise InvalidEvidenceError(f"sensor_id '{sensor_id}' 未注册")
        sensor = self._sensors[sensor_id]
        # 传感器协议: async def read -> Any
        value = await sensor.read
        return SensorReading(
            sensor_id=sensor_id,
            value=value,
            metadata={"sensor_class": type(sensor).__name__},
        )


class DefaultVerdictValidator(VerdictValidator):
    """裁决校验器默认实现"""

    @inject
    def __init__(self) -> None:
        pass

    async def validate(
        self,
        verdict: ReviewVerdict,
        evidence_store: EvidenceStore,
    ) -> ValidationResult:
        errors: list[str] = []

        # 1. 校验 target_evidence_ids 都存在
        author_forgekin_ids: set[str] = set
        has_web_function = False
        has_dom_diff = False
        for ev_id in verdict.target_evidence_ids:
            evidence = await evidence_store.load(ev_id)
            if evidence is None:
                errors.append(f"target_evidence_id '{ev_id}' 不存在")
                continue
            author_forgekin_ids.add(evidence.forgekin_id)

            # 2. 禁自审: reviewer 不可等于任何 evidence 的 author
            if evidence.forgekin_id == verdict.reviewer_forgekin_id:
                errors.append(
                    f"reviewer_forgekin_id == evidence.forgekin_id "
                    f"({verdict.reviewer_forgekin_id}), 禁自审"
                )

            # 3. T8 铁律: Web 功能证据必须含 DOM_DIFF
            if evidence.payload.get("is_web_function"):
                has_web_function = True
                if evidence.evidence_type == EvidenceType.DOM_DIFF:
                    has_dom_diff = True

        # 4. Web 功能无 DOM_DIFF → 拒绝
        if has_web_function and not has_dom_diff:
            errors.append(
                "Web 功能证据必须含 DOM_DIFF（T8 铁律）, "
                "禁只看退出码"
            )

        # 5. 多个 evidence 必须来自同一 author（一致性）
        if len(author_forgekin_ids) > 1:
            errors.append(
                f"target_evidence_ids 来自多个 forgekin: {author_forgekin_ids}, "
                f"verdict 应针对单一 author"
            )

        return ValidationResult(ok=(not errors), errors=errors)
```

### 2.4 关键算法伪代码

**算法 1：collect TEST_RED_GREEN 证据**

```
function collect_test_red_green(forgekin_id, red_run, green_run) -> str:
    payload = {
        "red_run": red_run,
        "green_run": green_run,
        "ref": f"test:{red_run.run_id}->{green_run.run_id}",
    }
    # Pydantic TestRedGreenPayload 校验:
    #   - red_run.status == "red"
    #   - green_run.status == "green"
    #   - green_run.timestamp >= red_run.timestamp
    evidence = Evidence(type=TEST_RED_GREEN, payload=payload)
    return store.save(evidence)
```

**算法 2：collect DOM_DIFF 证据（T8 铁律）**

```
function collect_dom_diff(forgekin_id, url, before_html, after_html) -> str:
    payload = {
        "url": url,
        "before_html": before_html,
        "after_html": after_html,
        "diff_summary": compute_diff(before_html, after_html),
        "http_status": 200,
        "is_web_function": True,
        "ref": f"dom:{url}",
    }
    evidence = Evidence(type=DOM_DIFF, payload=payload)
    return store.save(evidence)
```

**算法 3：validate verdict（禁自审 + 二态 + T8）**

```
function validate(verdict, evidence_store) -> ValidationResult:
    errors = []
    author_ids = set
    has_web_function = False
    has_dom_diff = False

    for ev_id in verdict.target_evidence_ids:
        evidence = evidence_store.load(ev_id)
        if evidence is None:
            errors.append("evidence 不存在")
            continue
        author_ids.add(evidence.forgekin_id)
        if evidence.forgekin_id == verdict.reviewer_forgekin_id:
            errors.append("禁自审")
        if evidence.payload.get("is_web_function"):
            has_web_function = True
            if evidence.evidence_type == DOM_DIFF:
                has_dom_diff = True

    if has_web_function and not has_dom_diff:
        errors.append("Web 功能证据缺 DOM_DIFF (T8)")

    if len(author_ids) > 1:
        errors.append("verdict 应针对单一 author")

    return ValidationResult(ok=not errors, errors=errors)
```

**算法 4：follow_up_notes 非空强制降级**

```
function ReviewVerdict._follow_up_forces_blocking(self):
    if self.follow_up_notes and self.follow_up_notes.strip:
        if self.decision != BLOCKING:
            self.decision = BLOCKING  # 自动降级
    return self
```

---

## 3. 模块实现

### 3.1 SQLite WAL 持久化实现

```python
# flowforge/infra/repo/sqlite_evidence_store.py
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from flowforge.core.harness.evidence import (
    Evidence, EvidenceStore, EvidenceType, ReviewVerdict, VerdictDecision,
)
from flowforge.core.harness.decay_tag import DecayTag


class SqliteEvidenceStore(EvidenceStore):
    """SQLite + WAL 实现证据 + 裁决持久化"""

    DDL = """
    CREATE TABLE IF NOT EXISTS evidences (
        evidence_id TEXT PRIMARY KEY,
        evidence_type TEXT NOT NULL,
        forgekin_id TEXT NOT NULL,
        payload_ref TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        produced_at TEXT NOT NULL,
        verifiable INTEGER NOT NULL DEFAULT 1,
        schema_version TEXT NOT NULL DEFAULT 'v1',
        wal_lsn INTEGER NOT NULL DEFAULT 0,
        decay_tag TEXT NOT NULL DEFAULT 'BUILT_TO_PERSIST',
        authority_level INTEGER NOT NULL DEFAULT 3
    );

    CREATE TABLE IF NOT EXISTS review_verdicts (
        verdict_id TEXT PRIMARY KEY,
        reviewer_forgekin_id TEXT NOT NULL,
        target_evidence_ids_json TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT NOT NULL,
        follow_up_notes TEXT,
        decided_at TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT 'v1',
        wal_lsn INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_ev_forgekin ON evidences(forgekin_id);
    CREATE INDEX IF NOT EXISTS idx_ev_type ON evidences(evidence_type);
    CREATE INDEX IF NOT EXISTS idx_ev_produced_at ON evidences(produced_at);
    CREATE INDEX IF NOT EXISTS idx_verdict_reviewer ON review_verdicts(reviewer_forgekin_id);
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None

    async def _ensure_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self._db_path)
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.execute("PRAGMA foreign_keys=ON")
            await self._conn.executescript(self.DDL)
            await self._conn.commit
        return self._conn

    async def save(self, evidence: Evidence) -> str:
        conn = await self._ensure_conn
        if not evidence.evidence_id:
            evidence.evidence_id = f"ev-{uuid.uuid4.hex[:12]}"
        await conn.execute(
            """
            INSERT INTO evidences
                (evidence_id, evidence_type, forgekin_id, payload_ref,
                 payload_json, produced_at, verifiable, schema_version,
                 wal_lsn, decay_tag, authority_level)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                evidence.evidence_id, evidence.evidence_type.value,
                evidence.forgekin_id, evidence.payload_ref,
                json.dumps(evidence.payload, ensure_ascii=False),
                evidence.produced_at.isoformat,
                int(evidence.verifiable), evidence.schema_version,
                evidence.wal_lsn, evidence.decay_tag.value,
                evidence.authority_level,
            ),
        )
        await conn.commit
        await self._checkpoint_if_needed
        return evidence.evidence_id

    async def save_verdict(self, verdict: ReviewVerdict) -> str:
        conn = await self._ensure_conn
        if not verdict.verdict_id:
            verdict.verdict_id = f"vrd-{uuid.uuid4.hex[:12]}"
        await conn.execute(
            """
            INSERT INTO review_verdicts
                (verdict_id, reviewer_forgekin_id, target_evidence_ids_json,
                 decision, rationale, follow_up_notes, decided_at,
                 schema_version, wal_lsn)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                verdict.verdict_id, verdict.reviewer_forgekin_id,
                json.dumps(verdict.target_evidence_ids),
                verdict.decision.value, verdict.rationale,
                verdict.follow_up_notes, verdict.decided_at.isoformat,
                verdict.schema_version, verdict.wal_lsn,
            ),
        )
        await conn.commit
        return verdict.verdict_id

    async def load(self, evidence_id: str) -> Optional[Evidence]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT * FROM evidences WHERE evidence_id = ?",
            (evidence_id,),
        ) as cur:
            row = await cur.fetchone
        if row is None:
            return None
        return self._deserialize_evidence(row)

    async def verify(self, evidence_id: str) -> bool:
        evidence = await self.load(evidence_id)
        return evidence is not None and evidence.verifiable

    async def list_by_forgekin(self, forgekin_id: str) -> list[Evidence]:
        conn = await self._ensure_conn
        async with conn.execute(
            "SELECT * FROM evidences WHERE forgekin_id = ? "
            "ORDER BY produced_at DESC",
            (forgekin_id,),
        ) as cur:
            rows = await cur.fetchall
        return [self._deserialize_evidence(r) for r in rows]

    @staticmethod
    def _deserialize_evidence(row: tuple) -> Evidence:
        (
            evidence_id, evidence_type, forgekin_id, payload_ref,
            payload_json, produced_at, verifiable, schema_version,
            wal_lsn, decay_tag, authority_level,
        ) = row
        return Evidence(
            evidence_id=evidence_id,
            evidence_type=EvidenceType(evidence_type),
            forgekin_id=forgekin_id,
            payload_ref=payload_ref,
            payload=json.loads(payload_json),
            produced_at=datetime.fromisoformat(produced_at),
            verifiable=bool(verifiable),
            schema_version=schema_version,
            wal_lsn=wal_lsn,
            decay_tag=DecayTag(decay_tag),
            authority_level=authority_level,
        )

    async def _checkpoint_if_needed(self) -> None:
        conn = await self._ensure_conn
        await conn.execute("PRAGMA wal_checkpoint(FULL)")
```

### 3.2 关键时序图

**时序图 1：采集 TEST_RED_GREEN 证据**

```
TeamAct EVIDENCE    Collector           Store              D008 Registry
     │                  │                  │                     │
     │ collect(         │                  │                     │
     │   TEST_RED_GREEN,│                  │                     │
     │   forgekin_id,   │                  │                     │
     │   payload)       │                  │                     │
     ├─────────────────>│                  │                     │
     │                  │ Evidence(...)    │                     │
     │                  │ Pydantic 校验:   │                     │
     │                  │  red_run.status=="red"?                │
     │                  │  green_run.status=="green"?            │
     │                  │  green.timestamp >= red.timestamp?     │
     │                  │ <── 校验通过                          │
     │                  │ save(evidence)   │                     │
     │                  ├─────────────────>│                     │
     │                  │ <────────────────┤ evidence_id         │
     │                  │ write DurableSurface(TASK_QUEUE)       │
     │                  ├─────────────────────────────────────────>│
     │                  │ <────────────────────────────────────────┤
     │                  │ publish_async("evidence.collected")    │
     │ <────────────────┤ evidence_id     │                     │
     │                  │                  │                     │
     │  → evidence_id 写入 TeamActState.evidence_refs            │
```

**时序图 2：validate verdict（禁自审 + T8）**

```
TeamAct VERDICT     Validator            Store
     │                  │                    │
     │ validate(verdict,│                    │
     │          store)  │                    │
     ├─────────────────>│                    │
     │                  │ for ev_id in verdict.target_evidence_ids:
     │                  │   load(ev_id)      │
     │                  ├───────────────────>│
     │                  │ <──────────────────┤ Evidence
     │                  │                    │
     │                  │ 检查:              │
     │                  │  - evidence 存在?  │
     │                  │  - reviewer != author? (禁自审)         │
     │                  │  - Web 功能 → 必须含 DOM_DIFF (T8)     │
     │                  │  - 多 evidence → 同一 author?           │
     │                  │ <── 校验完成      │
     │ <────────────────┤ ValidationResult   │
     │                  │                    │
     │  → ok=true: 写入 verdict              │
     │  → ok=false: 抛 SelfReviewError /     │
     │              DomDiffMissingError      │
```

### 3.3 错误处理策略

| # | 异常 / 场景 | 处理策略 | 用户可见行为 |
|---|------------|---------|-------------|
| E1 | `InvalidEvidenceError` payload 格式非法 | 拒绝写入, 返回 422 | caller 看到"Evidence payload 校验失败" |
| E2 | `NotVerifiableError` verifiable=false | 拒绝写入 | caller 看到"Evidence 必须可独立验证" |
| E3 | `SelfReviewError` reviewer == author | 拒绝写入 verdict | caller 看到"禁自审" |
| E4 | `TestRedGreenIncompleteError` 缺红或绿运行 | 拒绝写入 | caller 看到"TEST_RED_GREEN 必须含红+绿两次运行" |
| E5 | `DomDiffMissingError` Web 功能无 DOM_DIFF | 拒绝写入 | caller 看到"Web 功能证据必须含 DOM_DIFF（T8 铁律）" |
| E6 | `ThirdVerdictStateError` 裁决第三态 | 拒绝写入 verdict | caller 看到"decision 仅允许 approve/blocking" |
| E7 | `follow_up_notes` 非空 + decision=approve | 自动降级为 blocking | reviewer 看到"follow_up_notes 非空, 已降级为 blocking" |
| E8 | `aiosqlite.OperationalError` DB 锁 | 指数退避重试 3 次 | 服务返回 503 |
| E9 | `aiosqlite.IntegrityError` 主键冲突 | 不重试, 抛出 | 服务返回 500 |
| E10 | `event_bus.publish_async` 失败 | 不阻塞主流程, 仅 warning | 用户无感知 |
| E11 | `eval_signal_writer.write_trace` 失败 | 不阻塞主流程, 仅 warning | Eval 数据可能缺失 |
| E12 | `durable_state_registry.write` 失败 | 不阻塞 Evidence 主流程, 仅 warning | Durable Surface 同步失败 |

### 3.4 性能指标与优化

| # | 指标 | 目标 | 优化手段 |
|---|------|------|---------|
| P1 | `collect` 延迟 | P99 < 50ms | WAL + NORMAL 同步, 异步 event_bus |
| P2 | `verify` 延迟 | P99 < 5ms | 主键索引 |
| P3 | `load` 延迟 | P99 < 5ms | 主键索引 |
| P4 | `list_by_forgekin` 延迟（100 条） | P99 < 20ms | `idx_ev_forgekin` 索引 |
| P5 | `validate` 延迟（5 条 evidence） | P99 < 30ms | 并行 load |
| P6 | WAL checkpoint 频率 | 每 100 次写入或 5 分钟 | `_checkpoint_if_needed` 节流 |
| P7 | 单条 Evidence 内存占用 | < 10KB | payload JSON 限制 8KB（DOM_DIFF 的 before/after_html 可较大） |
| P8 | 并发 collect 吞吐 | > 100 QPS | aiosqlite 连接池 + WAL 并发读 |

### 3.5 YAML 配置示例

```yaml
# flowforge/config/harness.yaml
evidence_sensors:
  # 6 类证据类型（不可扩展第七类）
  evidence_types:
    - commit
    - test_red_green
    - quality_gate
    - trace_log
    - screenshot
    - dom_diff

  # 二态裁决约束
  verdict:
    allowed_decisions:
      - approve
      - blocking
    forbidden_decisions:
      - "approve_but_follow_up"   # 第三态, 禁用
      - "defer"
      - "再看看"
    follow_up_notes_force_blocking: true  # 非空强制降级

  # 自审拒绝约束
  self_review:
    enabled: true
    error_class: SelfReviewError

  # T8 铁律: Web 功能证据必须含 DOM_DIFF
  t8_dom_diff:
    enabled: true
    web_function_flag: "is_web_function"
    required_evidence_type: dom_diff

  # 先红后绿测试硬校验
  test_red_green:
    require_red_run: true
    require_green_run: true
    require_green_after_red: true   # green.timestamp >= red.timestamp

  # 觉醒阶约束（E4+ 作 reviewer 需 MindCouncil token）
  awakening_stage_constraints:
    E1: allow_reviewer
    E2: allow_reviewer
    E3: allow_reviewer
    E4: require_mind_council_token
    E5: require_mind_council_token
    E6: require_mind_council_token

  # WAL 配置
  wal:
    journal_mode: WAL
    synchronous: NORMAL
    checkpoint_interval_writes: 100
    checkpoint_interval_seconds: 300
```

---

## 4. 跨模块协作实现

### 4.1 上游调用：D002 TeamAct EVIDENCE 步采集证据

```python
# flowforge/loop/executor.py（片段）
class TeamActLoopExecutor:
    @inject
    def __init__(self, *, evidence_collector, verdict_validator, ...) -> None:
        self._evidence_collector = evidence_collector
        self._verdict_validator = verdict_validator
        ...

    async def _execute_evidence_step(self, state: TeamActState) -> TeamActState:
        # 持球Forgekin产出 (commit / 测试 / trace / 截图 / DOM diff)
        action_output = state.action_output

        # 根据 action 类型采集对应证据
        if action_output.is_commit:
            ev_id = await self._evidence_collector.collect(
                EvidenceType.COMMIT, state.owner,
                {"commit_sha": action_output.commit_sha, "ref": action_output.commit_sha},
            )
        elif action_output.is_test:
            ev_id = await self._evidence_collector.collect(
                EvidenceType.TEST_RED_GREEN, state.owner,
                {
                    "red_run": action_output.red_run.model_dump,
                    "green_run": action_output.green_run.model_dump,
                    "ref": f"test:{action_output.red_run.run_id}",
                },
            )
        elif action_output.is_web_function:
            # T8 铁律: Web 功能必须采集 DOM_DIFF
            ev_id = await self._evidence_collector.collect(
                EvidenceType.DOM_DIFF, state.owner,
                {
                    "url": action_output.url,
                    "before_html": action_output.before_html,
                    "after_html": action_output.after_html,
                    "diff_summary": action_output.diff_summary,
                    "http_status": action_output.http_status,
                    "is_web_function": True,
                    "ref": f"dom:{action_output.url}",
                },
            )

        state.evidence_refs.append(ev_id)
        return state

    async def _execute_verdict_step(self, state: TeamActState) -> TeamActState:
        verdict = await self._produce_verdict(state)
        result = await self._verdict_validator.validate(
            verdict, self._evidence_store
        )
        if not result.ok:
            raise SelfReviewError(f"Verdict 校验失败: {result.errors}")
        await self._evidence_store.save_verdict(verdict)
        return state.with_verdict(verdict)
```

### 4.2 上游调用：D007 Push Back evidence_refs 锚定

```python
# flowforge/core/harness/push_back.py（片段, D007）
class DefaultPushBackValidator:
    async def validate(self, pb: PushBack) -> ValidationResult:
        for ev_id in pb.evidence_refs:
            # 锚定到 D009 Evidence Store 中已存在的 evidence_id
            if not await self._evidence_store.verify(ev_id):
                errors.append(f"evidence_ref '{ev_id}' 在 D009 Evidence Store 中不存在")
        ...
```

### 4.3 下游影响：D001 CapabilityProfile 累积历史表现

```python
# flowforge/core/harness/capability.py（片段, D001）
class CapabilityRepository:
    async def accumulate_evidence(self, forgekin_id: str) -> None:
        """从 D009 Evidence Store 拉取历史证据, 更新 Wilson score"""
        evidences = await self._evidence_store.list_by_forgekin(forgekin_id)
        # 统计 approve / blocking 比例, 更新 capability.wilson_score_lower_bound
        ...
```

### 4.4 下游影响：D008 Durable Surface 持久化

```python
# D009 EvidenceCollector.collect 内部调用 D008 Registry.write（见 §2.3 DefaultEvidenceCollector）
# 写入 task_queue surface, authority_level=3, compression_immune=true
```

### 4.5 下游影响：D018 Eval Contract 采集 trace 信号

```python
# flowforge/core/eval/eval_contract.py（片段, D018）
class EvalContractWriter:
    async def consume_trace_evidence(self):
        """从 D009 拉取 TRACE_LOG 类型证据, 转换为 Eval 信号"""
        evidences = await self._evidence_store.list_by_type(EvidenceType.TRACE_LOG)
        for ev in evidences:
            await self._write_eval_signal(ev.payload)
```

### 4.6 集成测试点

| # | 测试点 | 验证内容 | 关联 AC |
|---|--------|---------|---------|
| T1 | 写 COMMIT 证据成功 | evidence 持久化 | AC-F1 |
| T2 | 写 TEST_RED_GREEN 含红+绿 → 成功 | Pydantic 校验通过 | AC-F2 |
| T3 | 写 TEST_RED_GREEN 缺绿 → 拒绝 | TestRedGreenIncompleteError | AC-F3 |
| T4 | 写 DOM_DIFF 证据成功 | evidence 持久化 | AC-F4 |
| T5 | Web 功能（is_web_function=true）etype != DOM_DIFF → 拒绝 | DomDiffMissingError | AC-F5 |
| T6 | 写 verifiable=false → 拒绝 | NotVerifiableError | AC-F6 |
| T7 | 写 verdict decision=approve + follow_up_notes 非空 → 自动降级为 blocking | decision=BLOCKING | AC-F8 |
| T8 | 写 verdict 第三态（如 "approve_but_follow_up"）→ 拒绝 | Pydantic Literal 校验 | AC-F7 |
| T9 | validate 时 reviewer == author → SelfReviewError | 校验失败 | AC-F9 |
| T10 | validate 时 target_evidence_ids 多个 author → 拒绝 | 校验失败 | AC-F11 |
| T11 | validate 时 Web 功能无 DOM_DIFF → DomDiffMissingError | 校验失败 | AC-F10 |
| T12 | WAL 写入后进程崩溃 → 重启 verify 返回 true | 持久化恢复 | AC-P3 |
| T13 | D007 Push Back evidence_refs 锚定不存在的 evidence_id → 拒绝 | D007 校验失败 | AC-F12 |

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

| AC | 描述 |
|----|------|
| AC-F1 | 写 COMMIT 证据成功持久化 |
| AC-F2 | 写 TEST_RED_GREEN 含红+绿两次运行 → 成功 |
| AC-F3 | 写 TEST_RED_GREEN 缺红或绿 → TestRedGreenIncompleteError |
| AC-F4 | 写 DOM_DIFF 证据成功持久化 |
| AC-F5 | Web 功能（is_web_function=true）etype != DOM_DIFF → DomDiffMissingError |
| AC-F6 | 写 verifiable=false → NotVerifiableError |
| AC-F7 | 写 verdict decision 第三态 → Pydantic Literal 校验失败 |
| AC-F8 | 写 verdict decision=approve + follow_up_notes 非空 → 自动降级为 blocking |
| AC-F9 | validate 时 reviewer == author → SelfReviewError |
| AC-F10 | validate 时 Web 功能无 DOM_DIFF → DomDiffMissingError |
| AC-F11 | validate 时 target_evidence_ids 来自多个 author → 拒绝 |
| AC-F12 | D007 Push Back evidence_refs 锚定不存在的 evidence_id → 拒绝 |
| AC-F13 | `verify(evidence_id)` 正确返回存在性 + verifiable |
| AC-F14 | `list_by_forgekin` 按 forgekin_id 列出证据 |
| AC-F15 | Evidence 写入触发 D008 Durable Surface 同步写入 |
| AC-F16 | 6 类 EvidenceType 不可扩展第七类 |
| AC-F17 | E4+ 觉醒阶作 reviewer 需 MindCouncil token |
| AC-F18 | TEST_RED_GREEN 校验 green.timestamp >= red.timestamp |

### 5.2 性能验收（Performance AC）

| AC | 描述 |
|----|------|
| AC-P1 | `collect` P99 延迟 < 50ms |
| AC-P2 | `verify` P99 延迟 < 5ms |
| AC-P3 | WAL 写入后进程崩溃, 重启后 `verify` 可恢复完整数据 |
| AC-P4 | `list_by_forgekin` 100 条 P99 < 20ms |
| AC-P5 | `validate` 5 条 evidence P99 < 30ms |
| AC-P6 | 并发 collect 吞吐 > 100 QPS |

### 5.3 安全验收（Security AC）

| AC | 描述 |
|----|------|
| AC-S1 | `flowforge/core/harness/evidence.py` 不 import forgemind 或 *Forge 模块 |
| AC-S2 | Collector / Registry / Validator 通过 `@inject` 注入, 无直接实例化 |
| AC-S3 | 所有 DB 操作通过 Repository, 无 `cursor.execute` |
| AC-S4 | 禁自审（reviewer != author）强制生效 |
| AC-S5 | T8 铁律: Web 功能证据必须含 DOM_DIFF |
| AC-S6 | E4+ 觉醒阶作 reviewer 需 MindCouncil 二次确认 |

### 5.4 Eval 验收（Eval AC）

| AC | 描述 |
|----|------|
| AC-E1 | 每次 collect 写 eval_signal "evidence_collected" |
| AC-E2 | 每次 validate 写 eval_signal "verdict_validated" |
| AC-E3 | 禁自审触发写 eval_signal "self_review_blocked" |
| AC-E4 | T8 铁律触发写 eval_signal "dom_diff_required" |
| AC-E5 | approve vs blocking 比例作为 F040 控制面指标 |

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003, FR-CORE-009 Evidence & Sensors）
- [doc:../arch.md#§3.3]（Harness 七层现实表面, L3 Evidence & Sensors）
- [doc:../features/F009-evidence-sensors.md]（同号 Feature 级 SRS）
- [doc:../architecture/A009-evidence-sensors.md]（架构权威源）
- [doc:../architecture/A002-teamact-loop.md]（EVIDENCE / VERDICT 步触发）
- [doc:../architecture/A007-push-back-protocol.md]（evidence_refs 锚定）
- [doc:../architecture/A001-capability-profile.md]（历史表现累积）
- [doc:../architecture/A008-durable-state-surfaces.md]（task_queue 持久化）
- [doc:../architecture/A018-eval-contract.md]（TRACE_LOG 证据采集）
- [doc:../architecture/A021-side-effect-wal.md]（WAL 可重放）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架, 对应 F009 / A009） | 开发者 Forgekin（猎犬·夏洛克） |

# A009: Evidence & Sensors 架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，对应 FR-CORE-020）
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）
> **对应 Feature**: [doc:../features/F009-evidence-sensors.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D009-evidence-sensors.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"做了不等于做对了"的根本问题。当前 v7.0 有 `merge_gate.py`，但：

1. 未禁止"approve 附带后续建议"的模棱两可结论，reviewer 经常给模糊裁决
2. 缺乏先红后绿测试的硬校验，bug 修复可能没有真实测试支撑
3. 自审允许（reviewer == author），违反 roleagent.md 跨 agent 交叉验证原则
4. Web 功能缺少 DOM 验证证据（违反 T8 铁律）

Evidence & Sensors 在架构层是 Harness 七层的验证证据层（L3），是 TeamAct EVIDENCE/VERDICT 步的协议依据。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/harness/evidence.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：EvidenceCollector 与 SensorRegistry 通过构造函数注入
- **Repository 层约束**：证据必须通过 Repository 持久化到 Durable Surface（F008）
- **配置驱动约束**：allowed_decisions / sensors 配置外置到 `flowforge/config/harness.yaml`
- **二态约束**：decision 仅允许 approve 或 blocking，禁第三态
- **自审拒绝约束**：reviewer_forgekin_id == evidence.forgekin_id 时拒绝写入 verdict
- **T8 铁律约束**：Web 功能证据必须含 DOM_DIFF，禁只看退出码

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：EVIDENCE 步采集证据，VERDICT 步验证证据，是"证据已附"终止条件依据
- **对 Push Back（A007）的影响**：Push Back 的 evidence_refs 锚定到 Evidence Store
- **对 Durable State（A008）的影响**：证据写入 task_queue 或 thread_trace
- **对 Eval 自代谢（A018-A020）的影响**：trace 信号主要来源
- **对分布式可靠性（A021-A025）的影响**：证据走 WAL，进程崩溃可恢复
- **对 CapabilityProfile（A001）的影响**：证据是历史表现累积的输入

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              TeamAct EVIDENCE 步 (A002)                            │
│   持球灵智体产出 (commit / 测试 / trace / 截图 / DOM diff)         │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ Evidence
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│          flowforge/core/harness/evidence.py (本 Feature)           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ EvidenceCollector│  │ SensorRegistry   │  │ VerdictValidator│  │
│  │ (采集+验证)      │  │ (传感器注册)     │  │ (二态+降级+自审)│  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   Evidence Types (6 类证据)                                  │  │
│  │   - COMMIT (git commit)                                      │  │
│  │   - TEST_RED_GREEN (先红后绿)                                │  │
│  │   - QUALITY_GATE (lint/type check/test/review)              │  │
│  │   - TRACE_LOG (trace 信号)                                  │  │
│  │   - SCREENSHOT (截图)                                        │  │
│  │   - DOM_DIFF (Web 功能 DOM 验证, T8 铁律)                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              TeamAct VERDICT 步 (A002)                             │
│   跨 agent review (reviewer != author)                             │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ VerdictValidator.validate(verdict)                        │   │
│   │ - decision 仅允许 approve / blocking (禁第三态)            │   │
│   │ - follow_up_notes 非空 → 强制降级为 blocking                │   │
│   │ - reviewer == author → 拒绝写入 verdict                    │   │
│   │ - TEST_RED_GREEN 必须包含红+绿两次运行                     │   │
│   │ - Web 功能证据必须含 DOM_DIFF (T8)                         │   │
│   └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：approve/blocking 二态硬约束**
  理由：roleagent.md 第 3 章明确"跨 agent review 要 approve 或 blocking，不允许'approve 但后续再说'"。第三态会让 reviewer 给模糊结论，author 不知是否真的通过。

- **决策 2：follow_up_notes 非空强制降级为 blocking**
  理由：reviewer 写 follow_up_notes 说明还有未决问题，应自动降级为 blocking，避免"approve 但有后续建议"的模棱两可。

- **决策 3：先红后绿测试硬校验**
  理由：bug 修复必须有"修复前红 + 修复后绿"两个测试运行记录，证明测试真的覆盖了 bug。否则修复可能没真实测试支撑。

- **决策 4：自审拒绝（reviewer != author）**
  理由：roleagent.md 明确"不能自己 review 自己"。同厂商 agent 共享盲点，跨厂商 review 是结构性必需。

- **决策 5：Web 功能证据必须含 DOM_DIFF（T8 铁律）**
  理由：T8 铁律明确"Web 功能必须操控浏览器验证 DOM"。禁只看退出码，必须操控浏览器查看 DOM 确认真实成功。

- **决策 6：证据是 Build to Persist 资产**
  理由：证据编码"做了不等于做对了"的工程规则，模型越强越需要可验证输出，不会因模型升级而退役。

### 2.3 架构不变量

- ReviewVerdict.decision 仅允许 "approve" 或 "blocking"，第三态被拒绝
- follow_up_notes 非空时强制 decision=blocking
- TEST_RED_GREEN 证据必须包含"修复前红 + 修复后绿"两个测试运行记录
- reviewer_forgekin_id == evidence.forgekin_id 时拒绝写入 verdict（禁自审）
- Web 功能证据必须含 DOM_DIFF（T8 铁律）
- 证据必须通过 Repository 持久化到 Durable Surface（F008）
- 证据走 WAL，进程崩溃可恢复
- 证据必须可独立验证（verifiable=true）

---

## 3. 模块设计

### 3.1 模块边界

- **evidence.py::EvidenceType** — 6 类证据枚举（COMMIT / TEST_RED_GREEN / QUALITY_GATE / TRACE_LOG / SCREENSHOT / DOM_DIFF）。
- **evidence.py::Evidence** — 单条证据数据模型（type + forgekin_id + payload_ref + verifiable）。
- **evidence.py::ReviewVerdict** — 裁决数据模型（decision 二态 + follow_up_notes 降级）。
- **evidence.py::EvidenceCollector** — 采集器（collect + verify）。
- **evidence.py::SensorRegistry (ABC)** — 传感器注册中心（register + read）。
- **evidence.py::VerdictValidator** — 裁决校验器（二态 + 降级 + 自审 + 红绿 + DOM）。
- **infra/repo/sqlite_evidence_store.py** — SQLite 实现（WAL 可重放）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal, Optional
from pydantic import BaseModel, Field, validator
from datetime import datetime
from enum import Enum


class EvidenceType(str, Enum):
    """6 类证据"""
    COMMIT = "commit"                          # git commit
    TEST_RED_GREEN = "test_red_green"          # 先红后绿测试
    QUALITY_GATE = "quality_gate"              # lint/type check/test/review
    TRACE_LOG = "trace_log"                    # trace 信号
    SCREENSHOT = "screenshot"                  # 截图
    DOM_DIFF = "dom_diff"                      # Web 功能 DOM 验证 (T8)


class Evidence(BaseModel):
    """单条证据"""
    evidence_id: str
    evidence_type: EvidenceType
    forgekin_id: str                           # 产出者
    payload_ref: str                           # payload 引用 (commit sha/测试 ID/trace ID)
    produced_at: datetime = Field(default_factory=datetime.now)
    verifiable: bool = True                    # 是否可独立验证

    @validator("verifiable")
    def must_be_verifiable(cls, v: bool) -> bool:
        if not v:
            raise ValueError("Evidence 必须可独立验证")
        return v


class ReviewVerdict(BaseModel):
    """跨 agent review 裁决"""
    verdict_id: str
    reviewer_forgekin_id: str
    target_evidence_ids: list[str]
    decision: Literal["approve", "blocking"]   # 仅二态，禁第三态
    rationale: str                              # 必须非空
    follow_up_notes: Optional[str] = None       # 若非空则强制降级为 blocking

    @validator("rationale")
    def rationale_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("ReviewVerdict rationale 不可为空")
        return v


class EvidenceCollector(ABC):
    """证据采集器"""

    @abstractmethod
    async def collect(
        self,
        etype: EvidenceType,
        forgekin_id: str,
        payload: dict,
    ) -> str:
        """采集证据，返回 evidence_id

        架构契约:
        - TEST_RED_GREEN 必须包含修复前红 + 修复后绿
        - Web 功能证据必须含 DOM_DIFF (T8 铁律)
        - 持久化到 Durable Surface (F008)
        - WAL 可重放 (F021 联动)
        """

    @abstractmethod
    async def verify(self, evidence_id: str) -> bool:
        """独立验证证据"""


class SensorRegistry(ABC):
    """传感器注册中心"""

    @abstractmethod
    def register(self, sensor: "Sensor") -> None:
        """注册传感器"""

    @abstractmethod
    async def read(self, sensor_id: str) -> "SensorReading":
        """读取传感器数据"""


class VerdictValidator(ABC):
    """裁决校验器"""

    @abstractmethod
    async def validate(
        self,
        verdict: ReviewVerdict,
        evidence_store: "EvidenceStore",
    ) -> "ValidationResult":
        """校验裁决

        架构契约:
        - decision 仅允许 approve 或 blocking (第三态被拒绝)
        - follow_up_notes 非空时强制 decision=blocking
        - TEST_RED_GREEN 证据必须包含红+绿两次运行
        - reviewer == author 时拒绝写入 verdict (禁自审)
        - Web 功能证据必须含 DOM_DIFF (T8 铁律)
        """
```

### 3.3 数据流

```
TeamAct ACTION 步: 持球灵智体执行动作
                  │
                  │ 产出 (commit/测试/trace/截图/DOM diff)
                  ▼
TeamAct EVIDENCE 步: EvidenceCollector.collect(etype, forgekin_id, payload)
                  │
                  │ - TEST_RED_GREEN: 校验红+绿两次运行
                  │ - Web 功能: 校验 DOM_DIFF 存在 (T8)
                  │ - 持久化到 Durable Surface (F008)
                  │ - WAL 写入 (F021 联动)
                  ▼
              evidence_id 写入 TeamActState.evidence_refs
                  │
                  ▼
TeamAct VERDICT 步: 跨 agent review (reviewer != author)
                  │
                  │ ReviewVerdict (decision + rationale + follow_up_notes)
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ VerdictValidator.validate(verdict, evidence_store)          │
│    - decision 仅允许 approve / blocking?                     │
│    - follow_up_notes 非空 → 强制降级为 blocking?             │
│    - TEST_RED_GREEN 证据包含红+绿?                           │
│    - reviewer == author → 拒绝写入 (禁自审)?                 │
│    - Web 功能证据含 DOM_DIFF (T8)?                           │
└──────────────────────────┬───────────────────────────────────┘
                           │ 校验通过
                           ▼
              ┌────────────┴────────────┐
              │  decision = ?           │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
            approve                 blocking
              │                         │
              ▼                         ▼
       TeamAct 可推进            触发 Push Back 协议 (F007)
       (或终止条件判定)          author 可带证据 push back
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — EVIDENCE/VERDICT 步触发采集与校验
- **F008 Durable State Surfaces** — 证据持久化到 task_queue / thread_trace
- **F021 Side Effect WAL** — 证据走 WAL 可重放

### 4.2 下游影响

- **F002 TeamAct Loop** — "证据已附"终止条件判定依据
- **F007 Push Back Protocol** — evidence_refs 锚定到 Evidence Store
- **F018 Eval Contract** — trace 信号主要来源
- **F019 Three Signal Cross** — trace 信号源
- **F001 CapabilityProfile** — 历史表现累积的输入

### 4.3 跨模块不变量

- TeamActState.evidence_refs 必须与 Evidence Store 中的记录一致
- ReviewVerdict.target_evidence_ids 必须在 Evidence Store 中存在
- 跨厂商 review 的 reviewer 必须满足 BlindSpotOverlapReport.overlap_score < 0.3
- 禁自审（reviewer_forgekin_id != evidence.forgekin_id）
- Web 功能证据必须含 DOM_DIFF

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/harness/evidence.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: EvidenceCollector 与 SensorRegistry 通过 DI 容器注入，无直接实例化
- [ ] AC-3: 证据通过 Repository 持久化到 Durable Surface（无 cursor.execute）
- [ ] AC-4: allowed_decisions / sensors 配置外置到 `flowforge/config/harness.yaml`
- [ ] AC-5: 证据走 WAL（F021 联动）

### 5.2 架构不变量验收

- [ ] AC-6: decision 仅允许 approve 或 blocking，第三态被拒绝
- [ ] AC-7: follow_up_notes 非空时强制降级为 blocking
- [ ] AC-8: TEST_RED_GREEN 证据必须包含红+绿两次运行
- [ ] AC-9: reviewer == author 时 verdict 被拒绝
- [ ] AC-10: Web 功能证据必须含 DOM_DIFF（T8 铁律）
- [ ] AC-11: 证据可独立验证（verifiable=true）

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-020 Evidence & Sensors）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L3 Evidence & Sensors）
- [doc:../features/F009-evidence-sensors.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]（TeamAct EVIDENCE/VERDICT 步）
- [doc:../features/F007-push-back-protocol.md]（evidence_refs 锚定目标）
- [doc:../features/F008-durable-state-surfaces.md]（证据持久化目标）
- [doc:../features/F018-eval-contract.md]（trace 信号源）
- [doc:../features/F019-three-signal-cross.md]（trace 信号源）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F009 Feature 级 SRS） | 架构师灵智体（猫头鹰·鲁班） |

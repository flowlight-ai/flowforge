# Feature F009: Evidence & Sensors（验证证据层）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-018] + [doc:roleagent.md#第3章]
> **关联 ADR**: [doc:decisions/007-harness-engineering.md]
> **类型**: harness
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

Evidence & Sensors 是 Harness 七层的验证证据层：roleagent.md 第 3 章强调"做了不等于做对了"。代码修改要有 commit、bug 修复要有先红后绿的测试、合入前要过 quality gate、自己写的代码不能自己 review、跨 agent review 要 approve 或 blocking（不允许"approve 但后续再说"）。

本 Feature 实现证据采集器、传感器注册表、approve 语义硬约束，以及"模棱两可结论"的拒绝写入。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-018]` 指出：v7.0 有 merge_gate.py，但未实现"approve 附带后续建议"的明确禁止，reviewer 经常给模棱两可的结论。roleagent.md 第 3 章要求"跨 agent review 要 approve 或 blocking（不允许 approve 但后续再说）"。

不做这个 Feature，F002 TeamAct 的"证据已附"终止条件无法验证，F007 Push Back 缺乏证据锚点，F019 三方信号交叉缺少 trace 信号源。这是 Build to Persist 的可验证边界资产。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class EvidenceType(str, Enum):
    COMMIT = "commit"
    TEST_RED_GREEN = "test_red_green"    # 先红后绿
    QUALITY_GATE = "quality_gate"
    TRACE_LOG = "trace_log"
    SCREENSHOT = "screenshot"
    DOM_DIFF = "dom_diff"                # Web 功能 DOM 验证（T8）

class Evidence(BaseModel):
    evidence_id: str
    evidence_type: EvidenceType
    forgekin_id: str                     # 产出者
    payload_ref: str                     # payload 引用（commit sha/测试 ID/trace ID）
    produced_at: datetime
    verifiable: bool                     # 是否可独立验证

class ReviewVerdict(BaseModel):
    verdict_id: str
    reviewer_forgekin_id: str
    target_evidence_ids: list[str]
    decision: Literal["approve", "blocking"]  # 不允许第三态
    rationale: str                       # 必须非空
    follow_up_notes: Optional[str] = None     # 若非空则强制降级为 blocking
```

### 3.2 核心接口

```python
class EvidenceCollector:
    async def collect(self, etype: EvidenceType, forgekin_id: str, payload: dict) -> str: ...
    async def verify(self, evidence_id: str) -> bool: ...

class SensorRegistry(ABC):
    @abstractmethod
    def register(self, sensor: Sensor) -> None: ...
    @abstractmethod
    async def read(self, sensor_id: str) -> SensorReading: ...

class VerdictValidator:
    """approve/blocking 二态校验 + follow_up_notes 降级"""
    def validate(self, verdict: ReviewVerdict) -> ValidationResult: ...
```

### 3.3 关键算法

- **approve/blocking 二态**：decision 字段仅允许 approve 或 blocking，无 "approve_but_later"。
- **follow_up 降级**：follow_up_notes 非空时强制 decision=blocking。
- **先红后绿校验**：TEST_RED_GREEN 证据需包含"修复前红 + 修复后绿"两个测试运行记录。
- **自审拒绝**：reviewer_forgekin_id == evidence.forgekin_id 时拒绝写入 verdict。

### 3.4 配置外置（YAML 示例）

```yaml
evidence_sensors:
  allowed_decisions: [approve, blocking]
  follow_up_notes_downgrades_to: blocking
  require_red_before_green: true
  forbid_self_review: true
  sensors:
    - {id: git_commit, type: commit}
    - {id: pytest_runner, type: test_red_green}
    - {id: quality_gate, type: quality_gate}
    - {id: trace_logger, type: trace_log}
    - {id: browser_dom, type: dom_diff}
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: decision 仅允许 approve 或 blocking，第三态被拒绝
- [ ] AC-2: follow_up_notes 非空时强制降级为 blocking
- [ ] AC-3: TEST_RED_GREEN 证据必须包含红+绿两次运行
- [ ] AC-4: reviewer == author 时 verdict 被拒绝
- [ ] AC-5: Web 功能证据必须含 DOM_DIFF（T8 铁律）

## 5. 测试策略

### 5.1 单元测试

- 二态校验、follow_up 降级、先红后绿、自审拒绝。

### 5.2 集成测试

- 接入 F002 TeamAct Evidence 步、F007 Push Back 证据锚定、F019 trace 信号采集。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体完成代码修复，真实运行 pytest 验证红绿，真实 review 给出 approve/blocking。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用，Web 功能操控浏览器验证 DOM。

## 6. 引用

- [doc:roleagent.md#第3章]
- [doc:review/review.md#第八章/RA-018]
- [doc:decisions/007-harness-engineering.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F002-teamact-loop.md]
- [doc:features/F007-push-back-protocol.md]
- [doc:features/F019-three-signal-cross.md]
- [doc:project_rules.md#T1-T8]

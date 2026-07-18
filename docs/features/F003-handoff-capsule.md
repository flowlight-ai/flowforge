# Feature F003: 交接胶囊（Handoff Capsule）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-011] + [doc:roleagent.md#第2章]
> **关联 ADR**: [doc:decisions/002-collaboration-protocol.md]
> **类型**: collaboration
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

交接胶囊（Handoff Capsule）是 TeamAct 六步循环中 Route 步的协议层硬要求：前一个灵智体（Forgekin）传球时必须留下 5 段结构化摘要——What / Why / Tradeoff / Open / Next。它不是可选礼貌，而是接手 Forgekin 快速 bootstrap 的唯一入口。

本 Feature 在 F002 TeamAct 状态机之上，把 `HandoffCapsule` 从骨架字段升级为带 Schema 校验、版本化、可审计、可回放的协议对象，并接入跨厂商 review 的盲点提示（依赖 F001 CapabilityProfile）。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-011]` 指出：v7.0 的 `handoff.py` 只传递任务 ID 和状态枚举，未实现交接胶囊的结构化内容，导致接手 Forgekin 必须重读完整上下文。roleagent.md 第 2 章明确："交接胶囊是协议层硬要求：前一个 agent 传球时必须留下 What/Why/Tradeoff/Open/Next 五段结构化摘要"。

不做这个 Feature，TeamAct 五项终止条件中的"无悬空任务归属"无法验证，接手 Forgekin 无法区分"作者已决"与"作者未决"的开放问题，会反复重做已决策的权衡。跨厂商 review 也会因为缺少 rationale 而误判 author 的设计意图。

交接胶囊还承载 Build to Persist 属性：它编码的是 agent 之间的协作规则，模型越强越值钱，不会因为单个模型升级而退役。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class HandoffCapsule(BaseModel):
    capsule_id: str
    author_forgekin_id: str           # 作者灵智体 ID
    team_id: str                       # TeamAct team_id
    iteration: int                     # 第几轮迭代
    what: str                          # 做了什么（事实陈述）
    why: str                           # 为什么这样做（设计意图）
    tradeoffs: str                     # 权衡了什么（放弃的选项）
    open_questions: list[str]          # 留下什么开放问题
    next_step: str                     # 下一步该做什么
    evidence_refs: list[str]           # 关联 commit/测试/trace ID
    blind_spot_hints: list[str]        # 作者已知的盲点提示
    created_at: datetime
    schema_version: str = "1.0"
```

### 3.2 核心接口

```python
class HandoffCapsuleStore(ABC):
    @abstractmethod
    async def write(self, capsule: HandoffCapsule) -> str: ...
    @abstractmethod
    async def read_latest(self, team_id: str) -> Optional[HandoffCapsule]: ...
    @abstractmethod
    async def list_chain(self, team_id: str) -> list[HandoffCapsule]: ...

class HandoffCapsuleValidator:
    """五段非空校验 + 开放问题可追溯校验"""
    def validate(self, capsule: HandoffCapsule) -> ValidationResult: ...
```

### 3.3 关键算法

- **五段非空校验**：what/why/tradeoffs/open_questions/next_step 任一为空即拒绝写入。
- **开放问题去重**：与链上前一胶囊的 open_questions 比对，标记"已解决 / 仍开放 / 新增"。
- **盲点提示注入**：从 F001 CapabilityProfile 读取 author 的 blind_spots，自动附加到 blind_spot_hints，供接手 reviewer 参考。

### 3.4 配置外置（YAML 示例）

```yaml
handoff_capsule:
  schema_version: "1.0"
  max_open_questions: 7
  enforce_blind_spot_hints: true
  storage_backend: sqlite
  retention_days: 90
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 写入交接胶囊时五段字段任一为空即抛 SchemaError
- [ ] AC-2: 可按 team_id 读取最新胶囊与完整链
- [ ] AC-3: blind_spot_hints 自动从 author CapabilityProfile 注入
- [ ] AC-4: 开放问题可标记"已解决/仍开放/新增"状态
- [ ] AC-5: 胶囊通过 Repository 层持久化，禁直操作数据库

## 5. 测试策略

### 5.1 单元测试

- 五段非空校验、Schema 序列化、开放问题去重、盲点提示注入。

### 5.2 集成测试

- 接入 F002 TeamActState.advance()，验证 Route 步强制写胶囊。
- 接入 F001 CapabilityProfile，验证盲点提示正确注入。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 3 个不同厂商灵智体协作完成一个 Feature，验证胶囊在三者间正确传递且开放问题状态正确流转。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用，LLM 生成内容经 LLM 审核。

## 6. 引用

- [doc:roleagent.md#第2章]
- [doc:review/review.md#第八章/RA-011]
- [doc:decisions/002-collaboration-protocol.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F001-capability-profile.md]
- [doc:features/F002-teamact-loop.md]
- [doc:project_rules.md#T1-T8]

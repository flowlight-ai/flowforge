# A007: Generator Push Back 协议架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2] + [doc:../spec.md#§3.7]（FR-CORE-002 + FR-CORE-007）
> **对应 arch.md**: [doc:../arch.md#§3.2] + [doc:../arch.md#§3.7]
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **对应 Feature**: [doc:../features/F007-push-back-protocol.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D007-push-back-protocol.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md] + [doc:../decisions/011-partnership-math.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"reviewer 错判时 author 如何纠错"的根本问题。当前 v7.0 review 协议是单向的（reviewer → author 修改），导致：

1. reviewer 错判时 author 无纠错机制，被迫执行错误修改
2. 缺乏双向辩论协议，reviewer 的盲点（F001）无法被 author 识别和反驳
3. F019 三方信号交叉无法识别"reviewer 盲点 vs author 盲点"
4. 伙伴系统下限公式中的"reviewer 没抓住"层无纠错机制，错误直接传导到代码

Generator Push Back 协议在架构层是 TeamAct VERDICT 步的双向辩论协议，是 Build to Persist 的协作协议资产。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/teamact/push_back.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：DebateOrchestrator 通过构造函数注入 TeamActState 与 EvidenceCollector
- **Repository 层约束**：Push Back 链必须通过 Repository 持久化（可审计可回放）
- **配置驱动约束**：max_debate_rounds / response_deadline_seconds 外置到 `flowforge/config/teamact.yaml`
- **三要素约束**：evidence_refs + applicability_argument + alternative_proposal 三要素任一为空必须拒绝
- **证据锚定约束**：evidence_refs 必须指向 F009 Evidence Store 已存在证据，禁自由文本主张
- **Magic Words 约束**：Push Back 不可绕过 Magic Words 逃生舱（F011）

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：VERDICT 步触发双向辩论协议，辩论未决时阻止终止
- **对 Evidence & Sensors（A009）的影响**：Push Back 的 evidence_refs 锚定到 Evidence Store
- **对 CapabilityProfile（A001）的影响**：Push Back 是 reviewer 与 author 盲点碰撞的主要场景
- **对 Partnership Math（A007 §3.7）的影响**：Push Back 是下限公式中"reviewer 没抓住"层的纠错机制
- **对 Eval 自代谢（A018-A020）的影响**：Push Back 频率与成功率是 Eval 信号
- **对分布式可靠性（A021-A025）的影响**：Push Back 链走 WAL，进程崩溃可恢复

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              TeamAct VERDICT 步 (A002)                            │
│   reviewer 给出裁决 (approve / blocking)                           │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ ReviewVerdict
                               ▼
              ┌────────────────┴────────────────┐
              │  author 是否同意 reviewer 裁决?  │
              └────────────────┬────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
            同意                              不同意 (Push Back)
              │                                 │
              ▼                                 ▼
        裁决生效           ┌────────────────────────────────────────┐
                            │ flowforge/core/teamact/push_back.py    │
                            │  ┌──────────┐  ┌────────────────────┐  │
                            │  │ PushBack │  │ DebateOrchestrator │  │
                            │  │ (三要素) │  │ (辩论链+超时升级)  │  │
                            │  └────┬─────┘  └─────────┬──────────┘  │
                            │       │                   │             │
                            │       ▼                   ▼             │
                            │  ┌──────────────────────────────────┐  │
                            │  │ PushBackValidator (三要素校验)   │  │
                            │  │ - evidence_refs 非空             │  │
                            │  │ - applicability_argument 非空     │  │
                            │  │ - alternative_proposal 非空       │  │
                            │  │ - evidence_refs 必须在 F009 已存  │  │
                            │  └──────────────────────────────────┘  │
                            └────────────────────────┬────────────────┘
                                                     │
                                                     ▼
              ┌────────────────────────────────────────────────────┐
              │  reviewer 必须在 response_deadline 内回应            │
              │  (不可 silently dismiss)                            │
              └────────────────────────┬───────────────────────────┘
                                       │
                  ┌────────────────────┴────────────────────┐
                  │                                           │
              接受 Push Back                              拒绝 Push Back
                  │                                           │
                  ▼                                           ▼
            裁决修改                          辩论轮次 +1 (上限 3 轮)
            (reviewer 撤回原裁决)                       │
                                                        ▼
                                            ┌──────────────────────┐
                                            │ 超过 3 轮 / 超时     │
                                            │ → 升级 CVO 仲裁      │
                                            └──────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：三要素齐全才合法（evidence + applicability + alternative）**
  理由：roleagent.md 第 2 章明确"没有证据的 push back 不合法；有证据的 push back 必须被正视"。三要素确保 push back 是建设性辩论而非推卸责任。

- **决策 2：evidence_refs 必须锚定到 F009 Evidence Store**
  理由：禁自由文本主张。证据必须可独立验证，否则 push back 沦为"我觉得"口水战。

- **决策 3：reviewer 不可 silently dismiss**
  理由：有证据的 push back 必须被正视。reviewer 必须在 response_deadline 内正式回应（接受 / 拒绝 / 升级），不可静默忽略。

- **决策 4：辩论轮次上限 3 轮（超限升级 CVO）**
  理由：辩论无上限则变成新一轮乒乓球。3 轮足够让双方充分论证，超限由 CVO 仲裁。

- **决策 5：超时自动升级 CVO（response_deadline 默认 1 小时）**
  理由：reviewer 不回应会拖延团队。超时自动升级 CVO 仲裁，避免 Push Back 滥用。

- **决策 6：无证据 Push Back 反向计入该Forgekin的"坏直觉"画像**
  理由：roleagent.md 第 2 章明确"无证据 push back 反向计入该 agent 的'坏直觉'画像"。Push Back 滥用应有成本。

### 2.3 架构不变量

- Push Back 三要素（evidence_refs / applicability_argument / alternative_proposal）任一为空必须拒绝提交
- evidence_refs 必须指向 F009 Evidence Store 中已存在的证据 ID
- reviewer 必须在 response_deadline 内正式回应，禁 silently dismiss
- 同一 verdict 的 Push Back 链最多 3 轮，超限强制升级 CVO
- 超时未回应自动升级 CVO 仲裁
- Push Back 链必须通过 Repository 持久化，走 WAL 可重放
- 无证据 Push Back 反向计入该Forgekin的"坏直觉"画像（F001 BlindSpot）
- Push Back 期间 TeamAct 终止条件判定暂停（辩论未决）

---

## 3. 模块设计

### 3.1 模块边界

- **push_back.py::PushBack** — Push Back 数据模型（三要素 + 状态机）。
- **push_back.py::DebateChain** — 辩论链数据模型（原 verdict + pushbacks + final_resolution）。
- **push_back.py::PushBackValidator** — 校验器（三要素非空 + 证据锚定）。
- **push_back.py::DebateOrchestrator** — 辩论编排器（提交 / 回应 / 升级 / 解决）。
- **push_back.py::ReviewerResponse** — reviewer 回应数据模型。
- **infra/repo/sqlite_pushback_store.py** — SQLite 实现（WAL 可重放）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal, Optional
from pydantic import BaseModel, Field, validator
from datetime import datetime


class PushBack(BaseModel):
    """Push Back — 双向辩论协议"""
    pushback_id: str
    team_id: str
    author_forgekin_id: str         # 发起 push back 的 author
    reviewer_forgekin_id: str       # 被 push back 的 reviewer
    original_verdict_id: str        # 原裁决 ID
    evidence_refs: list[str]        # 证据 (必须指向 F009 已存在证据)
    applicability_argument: str      # 适用性论证 (为何原裁决不适用)
    alternative_proposal: str        # 替代方案
    status: Literal["submitted", "accepted", "rejected", "escalated"] = "submitted"
    schema_version: str = "1.0"
    created_at: datetime = Field(default_factory=datetime.now)
    responded_at: Optional[datetime] = None

    @validator("evidence_refs")
    def evidence_must_not_be_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("PushBack evidence_refs 不可为空")
        return v

    @validator("applicability_argument", "alternative_proposal")
    def args_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("PushBack 三要素任一不可为空")
        return v


class DebateChain(BaseModel):
    """辩论链 — 同一 verdict 的所有 Push Back"""
    original_verdict_id: str
    pushbacks: list[PushBack] = Field(default_factory=list)
    final_resolution: Optional[str] = None
    resolved_at: Optional[datetime] = None
    escalated_to_cvo: bool = False

    def round_count(self) -> int:
        """辩论轮次计数"""
        return len(self.pushbacks)


class ReviewerResponse(BaseModel):
    """reviewer 对 Push Back 的回应"""
    pushback_id: str
    reviewer_forgekin_id: str
    decision: Literal["accept", "reject", "escalate"]
    rationale: str
    responded_at: datetime = Field(default_factory=datetime.now)


class PushBackValidator(ABC):
    """Push Back 合法性校验器"""

    @abstractmethod
    async def validate(
        self,
        pb: PushBack,
        evidence_store: "EvidenceStore",
    ) -> "ValidationResult":
        """校验三要素 + 证据锚定

        架构契约:
        - evidence_refs 非空
        - applicability_argument 非空
        - alternative_proposal 非空
        - evidence_refs 必须在 F009 Evidence Store 已存在
        """


class DebateOrchestrator(ABC):
    """辩论编排器"""

    @abstractmethod
    async def submit(self, pb: PushBack) -> str:
        """提交 Push Back

        架构契约:
        - 必须通过 PushBackValidator 校验
        - 启动 response_deadline 计时
        - 暂停 TeamAct 终止条件判定
        - 持久化到 Repository (WAL)
        """

    @abstractmethod
    async def respond(
        self,
        pushback_id: str,
        response: ReviewerResponse,
    ) -> None:
        """reviewer 回应

        架构契约:
        - 不可 silently dismiss (必须在 deadline 内回应)
        - accept → 撤回原裁决, 应用 Push Back
        - reject → 辩论轮次 +1
        - escalate → 升级 CVO 仲裁
        """

    @abstractmethod
    async def escalate(self, pushback_id: str, reason: str) -> None:
        """升级 CVO 仲裁

        架构契约:
        - 辩论轮次超过 3 轮自动触发
        - response_deadline 超时自动触发
        - operator 显式触发
        """

    @abstractmethod
    async def resolve(self, chain_id: str, resolution: str) -> None:
        """解决辩论链"""
```

### 3.3 数据流

```
TeamAct VERDICT 步: reviewer 给出 verdict (approve/blocking)
                  │
                  │ author 不同意 verdict
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. PushBackValidator.validate(pb, evidence_store)           │
│    - evidence_refs 非空?                                     │
│    - applicability_argument 非空?                            │
│    - alternative_proposal 非空?                              │
│    - evidence_refs 必须在 F009 Evidence Store 已存在?        │
└──────────────────────────┬───────────────────────────────────┘
                           │ 校验通过
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. DebateOrchestrator.submit(pb)                            │
│    - 启动 response_deadline 计时 (默认 1 小时)                │
│    - 暂停 TeamAct 终止条件判定 (辩论未决)                    │
│    - 持久化到 SQLite (WAL 可重放)                            │
│    - 通知 reviewer                                            │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
              ┌────────────┴────────────┐
              │  reviewer 必须在        │
              │  response_deadline 内   │
              │  正式回应                │
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
      accept             reject             超时
        │                  │                  │
        ▼                  ▼                  ▼
  撤回原裁决       辩论轮次 +1         自动升级 CVO
  应用 Push Back         │
                  ┌──────┴──────┐
                  │ 轮次 > 3?    │
                  └──────┬──────┘
                         │
              ┌──────────┴──────────┐
              │                    │
            否                    是
              │                    │
              ▼                    ▼
        继续 TeamAct          升级 CVO 仲裁
                              (operator 决策)
                                │
                                ▼
                        ┌──────────────┐
                        │ CVO 仲裁     │
                        │ - 撤回 verdict│
                        │ - 或维持     │
                        │ - 或换 reviewer│
                        └──────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — VERDICT 步触发 Push Back
- **F009 Evidence & Sensors** — evidence_refs 锚定的目标
- **F001 CapabilityProfile** — author 与 reviewer 的盲点碰撞场景

### 4.2 下游影响

- **F002 TeamAct Loop** — Push Back 期间终止条件判定暂停
- **F001 CapabilityProfile** — 无证据 Push Back 反向计入"坏直觉"画像
- **F011 Magic Words** — "星星罐子"可强制升级 CVO（绕过辩论）
- **F018 Eval Contract** — Push Back 频率与成功率是 Eval 信号
- **F019 Three Signal Cross** — Push Back 是 reviewer 盲点 vs author 盲点的主要识别场景
- **F021 Side Effect WAL** — Push Back 链走 WAL 可回放
- **伙伴系统数学（§3.7）** — Push Back 是下限公式中"reviewer 没抓住"层的纠错机制

### 4.3 跨模块不变量

- PushBack.author_forgekin_id 必须与原 verdict 的 target author 一致
- PushBack.reviewer_forgekin_id 必须与原 verdict 的 reviewer 一致
- PushBack.evidence_refs 必须在 F009 Evidence Store 中存在
- 辩论期间 TeamActState.termination.cross_agent_verified 必须为 false
- 同一 verdict 的 Push Back 链最多 3 轮，超限强制升级

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/teamact/push_back.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: DebateOrchestrator 通过 DI 容器注入，无直接实例化
- [ ] AC-3: Push Back 链通过 Repository 持久化（无 cursor.execute）
- [ ] AC-4: max_debate_rounds / response_deadline_seconds 外置到 `flowforge/config/teamact.yaml`
- [ ] AC-5: Push Back 链走 WAL（F021 联动）

### 5.2 架构不变量验收

- [ ] AC-6: 三要素任一为空的 Push Back 被拒绝提交
- [ ] AC-7: evidence_refs 必须指向 F009 已记录证据
- [ ] AC-8: 同一 verdict 辩论超 3 轮强制升级 CVO
- [ ] AC-9: reviewer 超时未回应自动升级 CVO 仲裁
- [ ] AC-10: reviewer 不可 silently dismiss（必须在 deadline 内正式回应）
- [ ] AC-11: 无证据 Push Back 反向计入该Forgekin的"坏直觉"画像（F001 BlindSpot）
- [ ] AC-12: Push Back 链可被追溯（DebateChain 完整记录）

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002 TeamAct 六步循环）
- [doc:../spec.md#§3.7]（FR-CORE-007 伙伴系统数学，下限纠错）
- [doc:../arch.md#§3.2]（TeamAct VERDICT 步，Push Back 协议）
- [doc:../arch.md#§3.7]（伙伴系统数学，Push Back 是下限纠错机制）
- [doc:../features/F007-push-back-protocol.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]（TeamAct VERDICT 步触发 Push Back）
- [doc:../features/F009-evidence-sensors.md]（evidence_refs 锚定目标）
- [doc:../features/F001-capability-profile.md]（无证据 Push Back 反向计入盲点）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../decisions/011-partnership-math.md]（伙伴系统数学 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F007 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |

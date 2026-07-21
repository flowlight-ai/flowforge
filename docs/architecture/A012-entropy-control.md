# A012: Entropy Control 退役架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，对应 FR-CORE-022）
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）
> **对应 Feature**: [doc:../features/F012-entropy-control.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D012-entropy-control.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"脚手架代码无限期占用注意力预算"的根本问题。当前 v7.0：

1. `scripts/scan_deprecated.py` 只扫描废弃标记，未实现 hotfix 两周 sunset 强制审查
2. Build to Delete 资产无 sunset 信号，无法识别"哪块机制正在折旧"
3. hotfix 合入后无三选一裁决（正式修复/接受永久方案/已不再相关），常用"再看看"拖延
4. 治理规则无降级机制，已失效 guardrail 无法降级为 default

Entropy Control 在架构层是 Harness 七层的清理层（L6），是 Build to Delete 资产退役的协议依据。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/harness/entropy.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：HotfixTagger 与 SunsetScheduler 通过构造函数注入
- **Repository 层约束**：HotfixTag 与 EntropyReviewVerdict 必须通过 Repository 持久化到 Durable Surface（F008）
- **配置驱动约束**：sunset_days / allowed_decisions / forbidden_decisions 配置外置到 `flowforge/config/harness.yaml`
- **三选一约束**：decision 仅允许 formal_fix / permanent / no_longer_relevant，禁第四项"再看看"
- **非作者约束**：reviewer_forgekin_id != commit.forgekin_id（禁自审）
- **过期升级约束**：sunset_review_due 到期未 review 自动升级 CVO

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：Entropy Review 是 TeamAct 的"清理 ROUTE"分支
- **对 Durable State（A008）的影响**：HotfixTag 持久化到 git + thread_trace
- **对 Governance Boundary（A010）的影响**：已失效 guardrail 可降级为 default，触发 sunset review
- **对 Evidence & Sensors（A009）的影响**：no_longer_relevant 决策写入退役信号
- **对 Eval 自代谢（A018-A020）的影响**：退役信号主要来源
- **对 Harness Eval 控制面（F040）的影响**：识别"哪块机制正在折旧"

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              Commit 提交 (含 [hotfix] 标记)                         │
│   forgekin_id 提交: commit message 含 "[hotfix]"                   │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ HotfixTagger.tag(commit_sha, forgekin_id)
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│         flowforge/core/harness/entropy.py (本 Feature)             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ HotfixTagger     │  │ SunsetScheduler  │  │ EntropyReviewGate│  │
│  │ (自动打 tag)     │  │ (两周强制 review) │  │ (三选一硬约束)   │  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   HotfixTag                                                   │  │
│  │   - commit_sha                                                │  │
│  │   - forgekin_id                                               │  │
│  │   - merged_at                                                 │  │
│  │   - sunset_review_due (merged_at + 14 天)                    │  │
│  │   - status: pending_review / formal_fix / permanent /        │  │
│  │           no_longer_relevant                                  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  约束:                                                              │
│  - decision 仅允许 formal_fix / permanent / no_longer_relevant     │
│  - reviewer != author (禁自审)                                      │
│  - 到期未 review 自动升级 CVO                                        │
│  - forbidden_decisions: [再看看, defer, later]                      │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              SunsetScheduler 调度 (APScheduler)                    │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ sunset_review_due 到期:                                     │   │
│   │ - 自动创建 review 任务                                       │   │
│   │ - 分配给非作者Forgekin                                         │   │
│   │ - 触发 EntropyReviewGate                                     │   │
│   └────────────────────────────────────────────────────────────┘   │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ overdue_escalation: CVO                                      │   │
│   │ - 到期未 review 自动升级 CVO                                  │   │
│   └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              EntropyReviewGate 三选一裁决                           │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ decision = formal_fix:                                     │   │
│   │ - 升级为正式修复方案, 移除 hotfix 标记                       │   │
│   │ - 改为 Built to Persist 资产                                │   │
│   ├────────────────────────────────────────────────────────────┤   │
│   │ decision = permanent:                                      │   │
│   │ - 接受永久方案, hotfix 退役                                  │   │
│   │ - 改为 Built to Persist 资产                                │   │
│   ├────────────────────────────────────────────────────────────┤   │
│   │ decision = no_longer_relevant:                              │   │
│   │ - 已不再相关, 删除 hotfix 代码                                │   │
│   │ - 写入退役信号到 F018 Eval Contract                          │   │
│   │ - 触发 F040 控制面 sunset review                             │   │
│   └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：commit message 含 `[hotfix]` 自动打 tag + 启动 14 天计时**
  理由：roleagent.md 明确"hotfix 合入后两周自动触发升级 review"。自动 tag 防止遗漏。

- **决策 2：两周强制 review，三选一硬约束**
  理由：roleagent.md 明确"正式修复、接受永久方案、已不再相关，三选一，没有第四项叫'再看看'"。第四项会导致脚手架代码无限期占用注意力预算。

- **决策 3：reviewer != author（禁自审）**
  理由：与 Evidence & Sensors 一致，同厂商 agent 共享盲点，跨厂商 review 是结构性必需。

- **决策 4：到期未 review 自动升级 CVO**
  理由：到期未 review 说明流程被阻塞，必须升级 CVO 介入仲裁，防止拖延。

- **决策 5：no_longer_relevant 决策写入退役信号**
  理由：退役信号是 Eval 自代谢的输入，让 F040 控制面识别"哪块机制正在折旧"。

- **决策 6：已失效 guardrail 可降级为 default**
  理由：与 Governance Boundary（A010）联动，guardrail 加严策略可能导致单调膨胀，Entropy Control 周期 review 已失效 guardrail 可降级。

- **决策 7：Entropy Control 是 Build to Persist 治理资产**
  理由：编码"脚手架代码不能无限期占用注意力预算"的工程规则，是 Harness 周期代谢机制。

### 2.3 架构不变量

- commit message 含 `[hotfix]` 标记时必须自动打 HotfixTag + 启动 14 天计时
- sunset_review_due = merged_at + sunset_days（默认 14 天，可配置）
- decision 仅允许 formal_fix / permanent / no_longer_relevant，禁第四项"再看看"
- reviewer_forgekin_id != commit.forgekin_id（禁自审）
- 到期未 review 自动升级 CVO
- no_longer_relevant 决策必须写入 F018 退役信号
- HotfixTag 必须持久化到 Durable Surface（F008），走 WAL 可恢复
- forbidden_decisions 必须包含 [再看看, defer, later]

---

## 3. 模块设计

### 3.1 模块边界

- **entropy.py::HotfixTag** — hotfix 标记数据模型（tag_id + commit_sha + forgekin_id + merged_at + sunset_review_due + status）。
- **entropy.py::EntropyReviewVerdict** — review 裁决（verdict_id + hotfix_tag_id + reviewer_forgekin_id + decision 三选一 + rationale）。
- **entropy.py::HotfixTagger (ABC)** — 标记器（tag commit + 启动计时）。
- **entropy.py::SunsetScheduler (ABC)** — 调度器（schedule_review + list_overdue）。
- **entropy.py::EntropyReviewGate (ABC)** — 裁决门（validate verdict 三选一）。
- **infra/repo/sqlite_entropy_store.py** — SQLite 实现（WAL 可重放）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal
from pydantic import BaseModel, Field, validator
from datetime import datetime, timedelta


class HotfixStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    FORMAL_FIX = "formal_fix"
    PERMANENT = "permanent"
    NO_LONGER_RELEVANT = "no_longer_relevant"


class HotfixTag(BaseModel):
    """hotfix 标记"""
    tag_id: str
    commit_sha: str
    forgekin_id: str                            # 提交者 (后续 reviewer 不可为同一 forgekin)
    merged_at: datetime
    sunset_review_due: datetime                 # merged_at + 14 天
    status: HotfixStatus = HotfixStatus.PENDING_REVIEW

    @validator("sunset_review_due")
    def due_must_be_14_days_after_merge(cls, v: datetime, values) -> datetime:
        merged = values.get("merged_at")
        if merged and v < merged + timedelta(days=14):
            raise ValueError("sunset_review_due 必须 >= merged_at + 14 天")
        return v


class EntropyReviewVerdict(BaseModel):
    """Entropy Review 裁决"""
    verdict_id: str
    hotfix_tag_id: str
    reviewer_forgekin_id: str
    decision: Literal[
        "formal_fix", "permanent", "no_longer_relevant"
    ]                                            # 三选一, 禁第四项
    rationale: str                               # 必须非空
    reviewed_at: datetime = Field(default_factory=datetime.now)

    @validator("rationale")
    def rationale_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("EntropyReviewVerdict rationale 不可为空")
        return v


class HotfixTagger(ABC):
    """hotfix 标记器"""

    @abstractmethod
    async def tag(
        self,
        commit_sha: str,
        forgekin_id: str,
        commit_message: str,
    ) -> str:
        """提交 hotfix 时自动打 tag + 启动 sunset 计时器

        架构契约:
        - commit_message 含 "[hotfix]" 标记时触发
        - sunset_review_due = merged_at + 14 天
        - 持久化到 Durable Surface (F008)
        - WAL 可重放 (F021 联动)
        - 返回 tag_id
        """


class SunsetScheduler(ABC):
    """两周强制 review 调度"""

    @abstractmethod
    def schedule_review(self, hotfix_tag_id: str) -> None:
        """调度 sunset review 任务

        架构契约:
        - sunset_review_due 到期自动创建 review 任务
        - 分配给非作者Forgekin (reviewer != author)
        - 到期未 review 自动升级 CVO
        """

    @abstractmethod
    def list_overdue(self) -> list[HotfixTag]:
        """列出所有已过期未 review 的 hotfix"""


class EntropyReviewGate(ABC):
    """三选一硬约束"""

    @abstractmethod
    async def validate(
        self,
        verdict: EntropyReviewVerdict,
        hotfix_tag: HotfixTag,
    ) -> "ValidationResult":
        """校验裁决

        架构契约:
        - decision 仅允许 formal_fix / permanent / no_longer_relevant
        - 拒绝"再看看" / "defer" / "later" (forbidden_decisions)
        - reviewer_forgekin_id != commit.forgekin_id (禁自审)
        - rationale 必须非空
        - no_longer_relevant 触发退役信号写入 F018
        """
```

### 3.3 数据流

```
Forgekin 提交 commit (含 [hotfix] 标记)
                  │
                  │ HotfixTagger.tag(commit_sha, forgekin_id, msg)
                  ▼
            HotfixTag (status=pending_review)
            sunset_review_due = merged_at + 14 天
                  │
                  │ 持久化到 Durable Surface (F008)
                  │ SunsetScheduler.schedule_review(tag_id)
                  ▼
┌──────────────────────────────────────────────────────┐
│ APScheduler 调度                                      │
│  - sunset_review_due 到期触发                          │
│  - 自动创建 review 任务                                 │
│  - 分配给非作者Forgekin (reviewer != author)             │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
            Reviewer Forgekin执行 review
                         │
                         │ EntropyReviewVerdict (decision + rationale)
                         ▼
┌──────────────────────────────────────────────────────┐
│ EntropyReviewGate.validate(verdict, hotfix_tag)       │
│  - decision 仅允许三选一?                              │
│  - 拒绝"再看看"/"defer"/"later"?                      │
│  - reviewer != author?                                │
│  - rationale 非空?                                    │
└────────────────────────┬─────────────────────────────┘
                         │ 校验通过
                         ▼
              ┌────────────┴────────────┐
              │  decision = ?           │
              └────────────┬────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
    formal_fix        permanent         no_longer_relevant
        │                  │                  │
        │ 升级正式修复     │ 接受永久方案      │ 已不再相关
        │ 改为 Built       │ 改为 Built       │ 删除 hotfix 代码
        │ to Persist      │ to Persist      │ 写入退役信号 (F018)
        │                  │                  │ 触发 F040 控制面 review
        ▼                  ▼                  ▼
            HotfixTag.status 更新 + 持久化
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F008 Durable State Surfaces** — HotfixTag 持久化到 git + thread_trace
- **F002 TeamAct Loop** — Entropy Review 是 TeamAct 的"清理 ROUTE"分支
- **F021 Side Effect WAL** — HotfixTag 走 WAL 可重放

### 4.2 下游影响

- **F010 Governance Boundary** — 已失效 guardrail 可降级为 default，触发 sunset review
- **F009 Evidence & Sensors** — no_longer_relevant 决策写入退役信号
- **F018 Eval Contract** — 退役信号主要来源
- **F040 Harness Eval 控制面** — 识别"哪块机制正在折旧"
- **CVO** — 到期未 review 自动升级 CVO 仲裁

### 4.3 跨模块不变量

- HotfixTag 必须持久化到 Durable Surface（F008），走 WAL 可恢复
- sunset_review_due = merged_at + 14 天（可配置但不可少于 14 天）
- reviewer_forgekin_id != commit.forgekin_id（禁自审）
- no_longer_relevant 决策必须写入 F018 退役信号
- 到期未 review 必须自动升级 CVO
- forbidden_decisions 必须包含 [再看看, defer, later]

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/harness/entropy.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: HotfixTagger 与 SunsetScheduler 通过 DI 容器注入，无直接实例化
- [ ] AC-3: HotfixTag 通过 Repository 持久化到 Durable Surface（无 cursor.execute）
- [ ] AC-4: sunset_days / allowed_decisions / forbidden_decisions 配置外置到 `flowforge/config/harness.yaml`
- [ ] AC-5: HotfixTag 走 WAL（F021 联动），进程崩溃可恢复

### 5.2 架构不变量验收

- [ ] AC-6: 含 `[hotfix]` 标记的 commit 自动打 tag + 启动 14 天计时
- [ ] AC-7: sunset_review_due >= merged_at + 14 天
- [ ] AC-8: decision 仅允许 formal_fix / permanent / no_longer_relevant，"再看看"被拒绝
- [ ] AC-9: reviewer != author（禁自审）
- [ ] AC-10: 到期未 review 自动升级 CVO
- [ ] AC-11: no_longer_relevant 决策写入 F018 退役信号
- [ ] AC-12: forbidden_decisions 包含 [再看看, defer, later]

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-022 Entropy Control）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L6 Entropy Control）
- [doc:../features/F012-entropy-control.md]（同号 Feature 级 SRS）
- [doc:../features/F008-durable-state-surfaces.md]（HotfixTag 持久化目标）
- [doc:../features/F009-evidence-sensors.md]（退役信号写入）
- [doc:../features/F010-governance-boundary.md]（guardrail 降级为 default）
- [doc:../features/F018-eval-contract.md]（退役信号采集）
- [doc:../features/F021-side-effect-wal.md]（WAL 可重放）
- [doc:../features/F040-harness-eval-control-plane.md]（控制面 sunset review）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../decisions/009-eval-self-metabolism.md]（Eval 自代谢联动）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F012 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |

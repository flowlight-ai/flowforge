# A005: 行首 @ 路由（At-Mention Routing）架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，对应 FR-CORE-017）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **对应 Feature**: [doc:../features/F005-at-mention-routing.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D005-at-mention-routing.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"Forgekin（Evolvable Agent，社区社交称'灵智体'）协作时如何可靠地从对话中提取路由指令"的根本问题。当前 v7.0 A2A 协议无此约束，导致：

1. `@` 提及和路由指令混在一起无法区分，任务归属不明，球经常掉地上
2. 跨厂商协作时叙述性提及（如"我和 @architect 讨论过"）被误判为路由，导致非预期的任务转移
3. TeamAct Owner 步无法可靠地从对话中提取持球者变更
4. F006 Ball Custody Lease 无法判断"谁该接管球"

行首 @ 路由在架构层是 TeamAct Owner/ROUTE 步的解析协议，是把"@ 指令"从叙述文本中可靠分离的工程实现。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/teamact/at_mention.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：RoutingDispatcher 通过构造函数注入 TeamActState 与 BallCustodyRegistry
- **Repository 层约束**：路由指令日志必须通过 Repository 持久化（可审计）
- **配置驱动约束**：default_intent / supported_intents / ambiguous_fallback 外置到 `flowforge/config/teamact.yaml`
- **行首判定约束**：必须使用 `line.lstrip.startswith("@")`，禁宽松匹配
- **歧义回退约束**：重名/不存在的目标必须走 ambiguous_fallback，禁静默丢弃

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：Owner 步直接消费 RoutingDispatcher 输出，ROUTE 步产出路由指令
- **对 Ball Custody Lease（A006）的影响**：take 意图触发 lease 注册
- **对 CapabilityProfile（A001）的影响**：路由目标合法性校验依赖 CapabilityRepository
- **对 Handoff Capsule（A003）的影响**：路由指令变更必须写入胶囊 next_step 字段
- **对 Push Back（A007）的影响**：Push Back 的 escalate 意图通过行首 @ 升级 CVO
- **对分布式可靠性（A021-A025）的影响**：路由指令日志走 WAL，可回放

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              Forgekin对话 (TeamAct ACTION/ROUTE 步)                  │
│   "@<forge_project>:<forgekin> 请把这段重写"  ← 路由 (行首 @)        │
│   "我和 @<forge_project>:<forgekin> 讨论了"   ← 叙述 (句中 @, 不路由)│
└──────────────────────────────┬─────────────────────────────────────┘
                               │ message + source_forgekin_id
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│          flowforge/core/teamact/at_mention.py (本 Feature)         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ AtMentionParser  │  │ RoutingDispatcher│  │ RoutingDirective│  │
│  │ (行首判定+意图)  │  │ (分发+lease联动) │  │ (指令数据模型)  │  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   IntentRecognizer (意图识别: take/pass/escalate/broadcast) │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ DispatchResult
                                 ▼
              ┌──────────────────┴──────────────────┐
              │                                     │
       行首 @ 路由                            句中 @ 叙述
              │                                     │
              ▼                                     ▼
   ┌─────────────────────┐              仅记录 trace, 不触发路由
   │ 1. validate_target   │
   │ 2. dispatch 意图      │
   │    - take → lease 注册 (F006)        │
   │    - pass → 球给下一个               │
   │    - escalate → 升级 CVO            │
   │    - broadcast → 多目标分发          │
   │ 3. 写入 TeamActState (A002)         │
   └─────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：路由指令必须出现在行首**
  理由：roleagent.md 第 2 章明确"句中的 @ 是叙述，不是路由"。行首判定让解析器可机械区分，避免 LLM 在线判断的不可靠性。

- **决策 2：意图识别基于行首 @ 后关键词**
  理由：`@forgekin take` / `@forgekin pass` / `@forgekin escalate` / `@forgekin broadcast`。无关键词默认 pass，避免歧义。

- **决策 3：条件路由支持（`@forgekin take when CI_GREEN`）**
  理由：CI 等待场景下，路由指令需挂起等待条件满足后触发。与 F006 lease 联动。

- **决策 4：叙述隔离（句中 @ 仅记录 trace）**
  理由：跨厂商协作时叙述性提及（如"我和 @architect 讨论过"）不应触发路由变更。但需记录 trace 供 Eval 信号分析。

- **决策 5：歧义目标走 ambiguous_fallback（禁静默丢弃）**
  理由：重名或不存在的目标必须显式回退到 notify_cvo，避免静默丢球。

- **决策 6：路由变更同步写入 TeamActState**
  理由：TeamActState.current_owner 是单一真相源，路由指令必须同步更新此字段，避免状态不一致。

### 2.3 架构不变量

- 路由指令必须出现在行首（`line.lstrip.startswith("@")`），句中 @ 仅记录不触发路由
- 路由意图必须识别为 take/pass/escalate/broadcast 之一，无关键词默认 pass
- 路由目标必须通过 validate_target 校验（重名/不存在走 ambiguous_fallback）
- 路由变更必须同步写入 TeamActState.current_owner
- take 意图必须触发 F006 BallCustodyLease.acquire
- escalate 意图必须升级 CVO 仲裁
- 路由指令日志必须通过 Repository 持久化（可审计）
- 条件路由挂起等待条件满足后触发，禁静默丢弃

---

## 3. 模块设计

### 3.1 模块边界

- **at_mention.py::AtMentionToken** — 单条 @ 提及数据模型（行首判定 + 意图）。
- **at_mention.py::RoutingDirective** — 路由指令数据模型（target + intent + condition）。
- **at_mention.py::AtMentionParser** — 解析器（行首判定 + 意图识别 + 叙述隔离）。
- **at_mention.py::RoutingDispatcher** — 分发器（目标校验 + lease 联动 + 状态同步）。
- **at_mention.py::IntentRecognizer** — 意图识别器（关键词匹配 + 默认 pass）。
- **infra/repo/sqlite_routing_log.py** — 路由指令日志 SQLite 实现（可审计）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Literal
from pydantic import BaseModel, Field
from datetime import datetime


class AtMentionToken(BaseModel):
    """单条 @ 提及"""
    raw_line: str                        # 原始行
    target_forgekin_id: str              # @ 的目标Forgekin
    is_routing: bool                     # 是否为路由指令（行首判定）
    routing_intent: Optional[str]        # 路由意图 (take/pass/escalate/broadcast)
    line_number: int
    source_forgekin_id: str
    condition: Optional[str] = None      # 条件路由（如 CI_GREEN）


class RoutingDirective(BaseModel):
    """路由指令（行首 @ 触发）"""
    target: str
    intent: Literal["take", "pass", "escalate", "broadcast"]
    condition: Optional[str] = None       # 条件路由
    issued_at: datetime = Field(default_factory=datetime.now)
    source_forgekin_id: str


class AtMentionParser(ABC):
    """行首 @ 解析器"""

    @abstractmethod
    async def parse(
        self,
        message: str,
        source_forgekin_id: str,
    ) -> list[AtMentionToken]:
        """解析消息中的所有 @ 提及

        架构契约:
        - 行首 @ 标记 is_routing=true
        - 句中 @ 标记 is_routing=false (仅记录 trace)
        - 意图识别基于行首 @ 后关键词
        - 条件路由解析 (@forgekin take when CI_GREEN)
        """


class RoutingDispatcher(ABC):
    """路由分发器"""

    @abstractmethod
    async def dispatch(self, directive: RoutingDirective) -> "DispatchResult":
        """分发路由指令

        架构契约:
        - validate_target 校验目标合法性 (重名/不存在走 ambiguous_fallback)
        - take → 触发 F006 BallCustodyLease.acquire
        - pass → 球给下一个 (更新 TeamActState.current_owner)
        - escalate → 升级 CVO 仲裁
        - broadcast → 多目标分发
        - 条件路由挂起等待条件满足
        - 路由变更同步写入 TeamActState
        """

    @abstractmethod
    async def validate_target(self, target_id: str) -> bool:
        """校验路由目标合法性"""


class IntentRecognizer(ABC):
    """意图识别器"""

    @abstractmethod
    def recognize(self, token: AtMentionToken) -> str:
        """识别路由意图 (take/pass/escalate/broadcast)

        架构契约:
        - 基于行首 @ 后关键词
        - 无关键词默认 pass
        - 不识别的意图走 ambiguous_fallback
        """


class DispatchResult(BaseModel):
    """路由分发结果"""
    success: bool
    new_owner: Optional[str] = None
    lease_id: Optional[str] = None
    escalated_to_cvo: bool = False
    pending_condition: Optional[str] = None
    error: Optional[str] = None
```

### 3.3 数据流

```
Forgekin对话消息 (TeamAct ACTION/ROUTE 步)
                  │
                  │ message + source_forgekin_id
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. AtMentionParser.parse(message, source)                   │
│    - 逐行扫描                                                │
│    - 行首 @ → is_routing=true                               │
│    - 句中 @ → is_routing=false (仅记录)                     │
│    - 条件路由解析 (@forgekin take when CI_GREEN)            │
└──────────────────────────┬───────────────────────────────────┘
                           │ list[AtMentionToken]
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. IntentRecognizer.recognize(token)                        │
│    - 识别 take/pass/escalate/broadcast                      │
│    - 无关键词默认 pass                                       │
│    - 不识别走 ambiguous_fallback                             │
└──────────────────────────┬───────────────────────────────────┘
                           │ RoutingDirective
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. RoutingDispatcher.dispatch(directive)                    │
│    - validate_target (重名/不存在走 ambiguous_fallback)     │
│    - take → F006 BallCustodyLease.acquire                │
│    - pass → 更新 TeamActState.current_owner                │
│    - escalate → 升级 CVO                                    │
│    - broadcast → 多目标分发                                  │
│    - 条件路由挂起等待                                        │
└──────────────────────────┬───────────────────────────────────┘
                           │ DispatchResult
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. 持久化路由指令日志 (Repository 层)                        │
│    - WAL 可重放 (F021 联动)                                 │
│    - 写 Eval 信号 (trace 信号)                              │
│    - 广播事件到 EventBus                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — Owner/ROUTE 步消费路由指令
- **F001 CapabilityProfile** — validate_target 校验目标合法性
- **F006 Ball Custody Lease** — take 意图触发 lease 注册

### 4.2 下游影响

- **F002 TeamAct Loop** — 路由变更同步写入 TeamActState.current_owner
- **F003 Handoff Capsule** — 路由指令变更写入胶囊 next_step
- **F006 Ball Custody Lease** — take 意图触发 lease 注册，pass 意图触发 lease 释放
- **F007 Push Back Protocol** — escalate 意图升级 CVO 仲裁
- **F018 Eval Contract** — 路由指令日志是 trace 信号源
- **F021 Side Effect WAL** — 路由指令日志走 WAL 可回放

### 4.3 跨模块不变量

- 路由指令的目标 forgekin_id 必须在 CapabilityRepository 中存在
- take 意图必须先释放原 lease 再注册新 lease（禁同时持多球）
- 路由变更必须同步 TeamActState.current_owner 与 HandoffCapsule.next_step
- 条件路由挂起时必须持久化（进程崩溃后可恢复）
- 歧义目标走 ambiguous_fallback，禁静默丢弃

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/teamact/at_mention.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: RoutingDispatcher 通过 DI 容器注入，无直接实例化
- [ ] AC-3: 路由指令日志通过 Repository 持久化（无 cursor.execute）
- [ ] AC-4: default_intent / supported_intents / ambiguous_fallback 外置到 `flowforge/config/teamact.yaml`
- [ ] AC-5: 路由指令日志走 WAL（F021 联动）

### 5.2 架构不变量验收

- [ ] AC-6: 行首 @ 触发路由，句中 @ 仅记录不触发路由
- [ ] AC-7: 路由意图可识别 take/pass/escalate/broadcast，无关键词默认 pass
- [ ] AC-8: 条件路由可挂起等待条件满足后触发
- [ ] AC-9: 歧义目标（重名/不存在）走 ambiguous_fallback 不静默丢弃
- [ ] AC-10: 路由变更同步写入 TeamActState.current_owner
- [ ] AC-11: take 意图触发 F006 BallCustodyLease.acquire

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-017 行首 @ 路由 + Push Back 协议）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，行首 @ 路由协议）
- [doc:../features/F005-at-mention-routing.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]（TeamAct Owner/ROUTE 步消费路由）
- [doc:../features/F006-ball-custody-lease.md]（take 意图触发 lease 注册）
- [doc:../features/F007-push-back-protocol.md]（escalate 意图升级 CVO）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F005 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |

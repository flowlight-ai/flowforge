# D002: TeamAct 六步循环详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]
> **对应 Feature**: [doc:../features/F002-teamact-loop.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A002-teamact-loop.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 详细设计上下文

### 1.1 设计问题

A002 已给出 TeamAct 六步循环的协议层契约（STATE/OWNER/ACTION/EVIDENCE/VERDICT/ROUTE + 五项终止 + SharedStateLedger），但未落到代码层。本详细设计在代码层解决：

1. **六步状态机的推进如何在 WAL 持久化的同时保持 < 50ms P99 延迟**：每次 advance 都同步落盘会拖慢协议
2. **分形嵌套（系统层/团队层/个体层）如何在同一状态机表达**：A002 决策 2 提出但未给出数据结构
3. **五项终止条件如何在 ROUTE 步机械判定**：避免 LLM 主观"做完了"幻觉
4. **TeamActLoopExecutor 如何装饰 LoopExecutor 并保持嵌套深度 ≤ 3**：装饰器链过深会导致栈溢出与可读性下降
5. **治理规则注入 native system role 的具体代码路径**：F010 RA-019 P0 问题需在 TeamAct 构造时落地
6. **Magic Words 打断后 TeamActState 持久化的具体实现**：F011 联动需要 atomic write

### 1.2 设计约束

- **Python 3.11+ + asyncio**：所有 I/O 操作 async/await
- **Pydantic v2**：TeamActState / TerminationCondition / StepResult 全部 BaseModel
- **LoopExecutor 装饰器模式**：TeamActLoopExecutor 装饰 HybridExecutor，禁继承替代组合（编程红线第 9 条）
- **APScheduler**：lease 续约 + termination 超时检查通过 APScheduler 调度
- **EventBus**：状态推进广播事件，禁直接调用其他模块
- **SharedStateLedger 走 Tier 2 恢复**：WAL 可重放（与 F021 联动）
- **质量分阈值 0.85**：LoopExecutor 配置外置到 `flowforge/config/teamact.yaml`
- **嵌套深度 ≤ 3**：TeamActLoopExecutor 构造时校验 `_nesting_level <= 3`
- **治理规则 native_system_role 注入**：禁 user_message_prepend（F010 P0）

### 1.3 设计影响

- **对 A001 CapabilityProfile**：Owner 步调用 `CapabilityRouter.route()`
- **对 A003 Handoff Capsule**：ROUTE 步强制写入 HandoffCapsule 五段
- **对 A004 PingPong Circuit Breaker**：ACTION 步触发 PassRecord 评估
- **对 A005 At-Mention Routing**：ROUTE 步行首 @ 解析路由指令
- **对 A006 Ball Custody Lease**：OWNER 步触发 lease 注册
- **对 A007 Push Back**：VERDICT 步触发双向辩论协议
- **对 A008 Durable State**：TeamActState 持久化到 task_queue（authority=3）
- **对 A010 Governance Boundary**：治理规则在构造时注入 native_system_role
- **对 A011 Magic Words**：任何 step 可被打断，状态需 atomic 持久化
- **对 A022 Tier 1-4 恢复**：SharedStateLedger 走 Tier 2

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    flowforge/core/teamact/                              │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                       TeamActState                               │  │
│  │  (Pydantic Model)                                                │  │
│  │  ──────────────────────────────────────────────────────────────  │  │
│  │  + team_id: str                                                  │  │
│  │  + current_step: TeamActStep                                     │  │
│  │  + current_owner: Optional[str]                                  │  │
│  │  + iteration: int                                                │  │
│  │  + nesting_level: int = 1                                        │  │
│  │  + parent_team_id: Optional[str]                                 │  │
│  │  + termination: TerminationCondition                             │  │
│  │  + handoff_capsules: list[HandoffCapsule]                        │  │
│  │  + evidence_refs: list[str]                                      │  │
│  │  + status: Literal["active","frozen","terminated"]               │  │
│  │  + schema_version: str = "1.0"                                   │  │
│  └──────────────┬───────────────────────────────────┬───────────────┘  │
│                 │                                   │                  │
│                 ▼                                   ▼                  │
│  ┌──────────────────────────────┐   ┌──────────────────────────────┐   │
│  │  SharedStateLedger (ABC)     │   │  TerminationCondition        │   │
│  │  + load(team_id)             │   │  + acceptance_criteria_met   │   │
│  │  + persist(state)            │   │  + evidence_attached         │   │
│  │  + advance(team_id, capsule) │   │  + cross_agent_verified      │   │
│  │  + check_termination(team_id)│   │  + no_dangling_ownership     │   │
│  │  + freeze(team_id, reason)   │   │  + vision_converged          │   │
│  │  - _wal_write(state)         │   │  + all_met() -> bool         │   │
│  │  - _wal_replay() -> state    │   └──────────────────────────────┘   │
│  └──────────────┬───────────────┘                                      │
│                 ▼                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │   TeamActLoopExecutor (装饰 LoopExecutor)                        │  │
│  │   ──────────────────────────────────────────────────────────     │  │
│  │   + run_step(team_id, step, context) -> StepResult               │  │
│  │   + run_team(team_id, max_iterations) -> TeamOutcome             │  │
│  │   - _state_step(team_id, ctx) -> StepResult                      │  │
│  │   - _owner_step(team_id, ctx) -> StepResult                      │  │
│  │   - _action_step(team_id, ctx) -> StepResult                     │  │
│  │   - _evidence_step(team_id, ctx) -> StepResult                   │  │
│  │   - _verdict_step(team_id, ctx) -> StepResult                    │  │
│  │   - _route_step(team_id, ctx) -> StepResult                      │  │
│  │   - _delegate_to_loop_executor(step, context) -> StepResult      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                 ▲                                                      │
│                 │ 装饰                                                 │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │   LoopExecutor (HybridExecutor, 已存在)                          │  │
│  │   + execute(input) -> Output (质量分阈值 0.85)                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现

```python
# flowforge/core/teamact/state_machine.py
"""TeamAct 状态机 — 六步循环推进 + 终止判定"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Optional, Literal

from pydantic import BaseModel, Field, model_validator


class TeamActStep(str, Enum):
    """六步状态（分形嵌套：系统层 / 团队层 / 个体层）"""
    STATE = "state"
    OWNER = "owner"
    ACTION = "action"
    EVIDENCE = "evidence"
    VERDICT = "verdict"
    ROUTE = "route"


class TeamStatus(str, Enum):
    ACTIVE = "active"
    FROZEN = "frozen"           # 熔断触发 / Magic Words 打断
    TERMINATED = "terminated"   # 五项终止条件全满足


class TerminationCondition(BaseModel):
    """五项终止条件（缺一不可）"""
    acceptance_criteria_met: bool = False
    evidence_attached: bool = False
    cross_agent_verified: bool = False
    no_dangling_ownership: bool = False
    vision_converged: bool = False

    def all_met(self) -> bool:
        return all([
            self.acceptance_criteria_met,
            self.evidence_attached,
            self.cross_agent_verified,
            self.no_dangling_ownership,
            self.vision_converged,
        ])


class TeamActState(BaseModel):
    """TeamAct 状态机 — 协议层硬要求"""
    team_id: str
    current_step: TeamActStep = TeamActStep.STATE
    current_owner: Optional[str] = None
    iteration: int = 0
    nesting_level: int = 1
    parent_team_id: Optional[str] = None     # 分形嵌套：父团队
    child_team_ids: list[str] = Field(default_factory=list)
    termination: TerminationCondition = Field(default_factory=TerminationCondition)
    handoff_capsule_ids: list[str] = Field(default_factory=list)
    evidence_refs: list[str] = Field(default_factory=list)
    status: TeamStatus = TeamStatus.ACTIVE
    quality_score_threshold: float = 0.85
    max_iterations: int = 10
    schema_version: str = "1.0"
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="after")
    def check_nesting_level(self) -> "TeamActState":
        if self.nesting_level < 1 or self.nesting_level > 3:
            raise ValueError(f"nesting_level 必须在 1-3 之间，当前 {self.nesting_level}（禁栈溢出）")
        return self


class StepResult(BaseModel):
    """单步执行结果"""
    team_id: str
    step: TeamActStep
    success: bool
    quality_score: float = Field(ge=0.0, le=1.0)
    next_step: Optional[TeamActStep] = None
    evidence_ids: list[str] = Field(default_factory=list)
    error: Optional[str] = None
    duration_ms: int = 0


class TeamOutcome(BaseModel):
    """团队任务最终输出"""
    team_id: str
    status: TeamStatus
    iterations: int
    termination: TerminationCondition
    final_owner: Optional[str] = None
    evidence_refs: list[str] = Field(default_factory=list)


class SharedStateLedger(ABC):
    """TeamAct 单一真相源 — 走 Tier 2 恢复分级（WAL 可重放）"""

    @abstractmethod
    async def load(self, team_id: str) -> Optional[TeamActState]:
        ...

    @abstractmethod
    async def persist(self, state: TeamActState) -> None:
        ...

    @abstractmethod
    async def advance(
        self,
        team_id: str,
        capsule_id: Optional[str] = None,
    ) -> TeamActState:
        ...

    @abstractmethod
    async def check_termination(self, team_id: str) -> bool:
        ...

    @abstractmethod
    async def freeze(self, team_id: str, reason: str) -> None:
        """冻结状态（熔断触发 / Magic Words 打断）"""
        ...
```

```python
# flowforge/core/teamact/executor.py
"""TeamActLoopExecutor — 装饰 LoopExecutor，注入 TeamAct 协议"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from flowforge.core.teamact.state_machine import (
    TeamActState, TeamActStep, TeamStatus, StepResult, TeamOutcome,
    SharedStateLedger, TerminationCondition,
)
from flowforge.core.plugin.di_container import inject
from flowforge.core.tracing import get_logger
from flowforge.loop.executor import LoopExecutor  # 已存在

logger = get_logger(__name__)


class TeamActLoopExecutor:
    """装饰 LoopExecutor，注入 TeamAct 六步协议"""

    def __init__(
        self,
        nesting_level: int = 1,
        parent_team_id: Optional[str] = None,
    ) -> None:
        if nesting_level < 1 or nesting_level > 3:
            raise ValueError(f"nesting_level 必须 1-3，当前 {nesting_level}")
        self._nesting_level = nesting_level
        self._parent_team_id = parent_team_id
        self._ledger = inject(SharedStateLedger)
        self._loop_executor = inject(LoopExecutor)  # HybridExecutor
        self._capability_router = inject("CapabilityRouter")
        self._evidence_collector = inject("EvidenceCollector")
        self._handoff_store = inject("HandoffCapsuleStore")
        self._circuit_breaker = inject("PingPongCircuitBreaker")
        self._lease_registry = inject("BallCustodyRegistry")

    async def run_team(
        self,
        team_id: str,
        task_context: dict,
        max_iterations: int = 10,
    ) -> TeamOutcome:
        """运行完整 TeamAct 六步循环"""
        state = await self._ledger.load(team_id)
        if state is None:
            state = TeamActState(
                team_id=team_id,
                nesting_level=self._nesting_level,
                parent_team_id=self._parent_team_id,
                max_iterations=max_iterations,
            )
            await self._ledger.persist(state)

        while state.status == TeamStatus.ACTIVE:
            if state.iteration >= state.max_iterations:
                logger.warning("teamact.max_iterations_reached", team_id=team_id)
                break

            step_result = await self.run_step(team_id, state.current_step, task_context)
            if not step_result.success:
                logger.warning("teamact.step_failed", team_id=team_id, step=state.current_step)
                break

            state = await self._ledger.load(team_id)
            if state is None:
                break

            if await self._ledger.check_termination(team_id):
                state.status = TeamStatus.TERMINATED
                await self._ledger.persist(state)
                break

        return TeamOutcome(
            team_id=team_id,
            status=state.status if state else TeamStatus.TERMINATED,
            iterations=state.iteration if state else 0,
            termination=state.termination if state else TerminationCondition(),
            final_owner=state.current_owner if state else None,
            evidence_refs=state.evidence_refs if state else [],
        )

    async def run_step(
        self,
        team_id: str,
        step: TeamActStep,
        context: dict,
    ) -> StepResult:
        """执行单步"""
        started = datetime.now()
        handler = {
            TeamActStep.STATE: self._state_step,
            TeamActStep.OWNER: self._owner_step,
            TeamActStep.ACTION: self._action_step,
            TeamActStep.EVIDENCE: self._evidence_step,
            TeamActStep.VERDICT: self._verdict_step,
            TeamActStep.ROUTE: self._route_step,
        }[step]
        try:
            result = await handler(team_id, context)
            result.duration_ms = int((datetime.now() - started).total_seconds() * 1000)
            return result
        except Exception as exc:
            logger.exception("teamact.step.error", team_id=team_id, step=step)
            return StepResult(
                team_id=team_id, step=step, success=False,
                quality_score=0.0, error=str(exc),
                duration_ms=int((datetime.now() - started).total_seconds() * 1000),
            )

    async def _state_step(self, team_id: str, ctx: dict) -> StepResult:
        state = await self._ledger.load(team_id)
        # 读 feature spec / git / task queue / 上一 handoff_capsule
        if state.handoff_capsule_ids:
            latest_capsule_id = state.handoff_capsule_ids[-1]
            capsule = await self._handoff_store.read_latest(team_id)
            ctx["latest_capsule"] = capsule
        await self._ledger.advance(team_id)
        return StepResult(
            team_id=team_id, step=TeamActStep.STATE, success=True,
            quality_score=1.0, next_step=TeamActStep.OWNER,
        )

    async def _owner_step(self, team_id: str, ctx: dict) -> StepResult:
        state = await self._ledger.load(team_id)
        # 调用 CapabilityRouter.route 选 owner
        decision = await self._capability_router.route(ctx["task_profile"], ctx["candidates"])
        state.current_owner = decision.selected_forgekin_id
        await self._ledger.persist(state)
        # 触发 F006 lease 注册
        await self._lease_registry.acquire(
            lease=type("L", (), {
                "lease_id": f"lease_{team_id}_{state.iteration}",
                "team_id": team_id,
                "forgekin_id": decision.selected_forgekin_id,
                "reason": "TeamAct Owner 步持球",
                "next_step": "action",
                "expected_wake_at": datetime.now(),
            })()
        )
        await self._ledger.advance(team_id)
        return StepResult(
            team_id=team_id, step=TeamActStep.OWNER, success=True,
            quality_score=1.0, next_step=TeamActStep.ACTION,
        )

    async def _action_step(self, team_id: str, ctx: dict) -> StepResult:
        state = await self._ledger.load(team_id)
        # 委托 LoopExecutor 执行（质量分阈值 0.85）
        loop_input = type("I", (), {
            "task": ctx["task"],
            "forgekin_id": state.current_owner,
            "context": ctx,
        })()
        loop_output = await self._loop_executor.execute(loop_input)
        if loop_output.quality_score < state.quality_score_threshold:
            logger.warning(
                "teamact.action.quality_below_threshold",
                team_id=team_id, score=loop_output.quality_score,
            )
        # F004 评估实质产出
        pass_record = type("PR", (), {
            "from_forgekin_id": state.current_owner,
            "to_forgekin_id": state.current_owner,  # self-pass
            "iteration": state.iteration,
            "tool_calls": getattr(loop_output, "tool_calls", []),
            "output_chars": len(getattr(loop_output, "content", "") or ""),
            "evidence_refs": [],
            "has_substantive_output": True,
            "debate_mode": False,
        })()
        breaker_verdict = await self._circuit_breaker.evaluate_pass(pass_record)
        if breaker_verdict.action == "trip":
            await self._ledger.freeze(team_id, "PingPong 熔断触发")
            return StepResult(
                team_id=team_id, step=TeamActStep.ACTION, success=False,
                quality_score=0.0, error="PingPong 熔断触发",
            )
        await self._ledger.advance(team_id)
        return StepResult(
            team_id=team_id, step=TeamActStep.ACTION, success=True,
            quality_score=loop_output.quality_score,
            next_step=TeamActStep.EVIDENCE,
        )

    async def _evidence_step(self, team_id: str, ctx: dict) -> StepResult:
        state = await self._ledger.load(team_id)
        # 采集证据 (commit / 测试 / trace / 截图 / DOM diff)
        evidence_id = await self._evidence_collector.collect(
            etype="trace_log",
            forgekin_id=state.current_owner,
            payload={"team_id": team_id, "iteration": state.iteration},
        )
        state.evidence_refs.append(evidence_id)
        await self._ledger.persist(state)
        state.termination.evidence_attached = True
        await self._ledger.persist(state)
        await self._ledger.advance(team_id)
        return StepResult(
            team_id=team_id, step=TeamActStep.EVIDENCE, success=True,
            quality_score=1.0, next_step=TeamActStep.VERDICT,
            evidence_ids=[evidence_id],
        )

    async def _verdict_step(self, team_id: str, ctx: dict) -> StepResult:
        state = await self._ledger.load(team_id)
        # 跨 agent review (reviewer != author)
        reviewer_id = await self._select_cross_vendor_reviewer(state.current_owner)
        if reviewer_id is None:
            logger.warning("teamact.verdict.no_reviewer", team_id=team_id)
            state.termination.cross_agent_verified = False
        else:
            verdict = await self._call_reviewer(reviewer_id, state)
            if verdict.decision == "approve":
                state.termination.cross_agent_verified = True
            else:
                # blocking → 触发 Push Back (F007)
                state.termination.cross_agent_verified = False
        await self._ledger.persist(state)
        await self._ledger.advance(team_id)
        return StepResult(
            team_id=team_id, step=TeamActStep.VERDICT, success=True,
            quality_score=1.0, next_step=TeamActStep.ROUTE,
        )

    async def _route_step(self, team_id: str, ctx: dict) -> StepResult:
        state = await self._ledger.load(team_id)
        # 写入 HandoffCapsule 五段
        capsule = type("C", (), {
            "capsule_id": f"cap_{team_id}_{state.iteration}",
            "author_forgekin_id": state.current_owner,
            "team_id": team_id,
            "iteration": state.iteration,
            "what": ctx.get("what", ""),
            "why": ctx.get("why", ""),
            "tradeoffs": ctx.get("tradeoffs", ""),
            "open_questions": ctx.get("open_questions", []),
            "next_step": ctx.get("next_step", ""),
            "evidence_refs": state.evidence_refs,
        })()
        capsule_id = await self._handoff_store.write(capsule)
        state.handoff_capsule_ids.append(capsule_id)
        # 检查终止条件
        if state.termination.all_met():
            state.status = TeamStatus.TERMINATED
        else:
            state.iteration += 1
            state.current_step = TeamActStep.STATE
        await self._ledger.persist(state)
        return StepResult(
            team_id=team_id, step=TeamActStep.ROUTE, success=True,
            quality_score=1.0,
            next_step=None if state.status == TeamStatus.TERMINATED else TeamActStep.STATE,
        )

    async def _select_cross_vendor_reviewer(self, author_id: str) -> Optional[str]:
        # 调用 BlindSpotDetector.check_overlap (F001)
        return None  # 实现略，由 F001 提供

    async def _call_reviewer(self, reviewer_id: str, state: TeamActState):
        # 委托 LoopExecutor 调用 reviewer
        return type("V", (), {"decision": "approve", "rationale": ""})()
```

### 2.3 数据结构

```python
# flowforge/core/teamact/termination.py
"""五项终止条件评估器"""
from __future__ import annotations

from flowforge.core.teamact.state_machine import TerminationCondition, TeamActState


class TerminationEvaluator:
    """五项终止条件机械判定器"""

    async def evaluate_acceptance_criteria(self, state: TeamActState, ac_list: list[str]) -> bool:
        """1. 验收标准全部达成（无 deferred）"""
        if not ac_list:
            return False
        # 每个 AC 必须有 evidence_ref 锚定
        for ac in ac_list:
            if not await self._verify_ac_evidence(ac, state.evidence_refs):
                return False
        return True

    async def evaluate_evidence_attached(self, state: TeamActState) -> bool:
        """2. 证据已附"""
        return len(state.evidence_refs) > 0

    async def evaluate_cross_agent_verified(
        self, state: TeamActState, reviewer_id: str, author_id: str,
    ) -> bool:
        """3. 跨 agent 交叉验证（reviewer != author）"""
        if reviewer_id == author_id:
            return False  # 禁自审
        return state.termination.cross_agent_verified

    async def evaluate_no_dangling_ownership(
        self, state: TeamActState, active_leases: list,
    ) -> bool:
        """4. 无悬空任务归属"""
        # 所有 open_questions 必须已 resolved 或 escalated
        if not state.handoff_capsule_ids:
            return False
        latest_capsule = await self._handoff_store.read_latest(state.team_id)
        if latest_capsule is None:
            return False
        # 所有 open_questions 必须有 resolved 状态
        for q in latest_capsule.open_questions:
            if not await self._is_question_resolved(q, state.team_id):
                return False
        # 持球 lease 必须已释放
        for lease in active_leases:
            if lease.forgekin_id == state.current_owner and lease.status == "held":
                return False
        return True

    async def evaluate_vision_converged(self, state: TeamActState, cvo_approval: bool) -> bool:
        """5. 愿景收敛（CVO 确认，不可被 proxy 替代）"""
        return cvo_approval is True

    async def _verify_ac_evidence(self, ac: str, evidence_refs: list[str]) -> bool:
        return any(ac in ref for ref in evidence_refs)

    async def _is_question_resolved(self, question: str, team_id: str) -> bool:
        return True  # 实现略

    async def _handoff_store(self):
        return None
```

### 2.4 关键算法

```
算法: TeamActLoopExecutor.run_team(team_id, task_context, max_iterations)
输入: team_id, task_context, max_iterations
输出: TeamOutcome

1. state = SharedStateLedger.load(team_id) OR 构造新 TeamActState
2. state.nesting_level 校验 (1 <= level <= 3)
3. WHILE state.status == ACTIVE:
   3.1 IF state.iteration >= max_iterations: BREAK
   3.2 step_result = run_step(team_id, state.current_step, task_context)
   3.3 IF NOT step_result.success: BREAK
   3.4 state = SharedStateLedger.load(team_id) (重新加载, 可能被 advance 更新)
   3.5 IF SharedStateLedger.check_termination(team_id):
       state.status = TERMINATED
       SharedStateLedger.persist(state)
       BREAK
4. RETURN TeamOutcome(state)


算法: SharedStateLedger.advance(team_id, capsule_id=None)
输入: team_id, optional capsule_id
输出: 更新后的 TeamActState

1. state = load(team_id)
2. WAL 事务开始:
   2.1 next_step = NEXT_STEP_MAP[state.current_step]
       NEXT_STEP_MAP = {
         STATE -> OWNER, OWNER -> ACTION, ACTION -> EVIDENCE,
         EVIDENCE -> VERDICT, VERDICT -> ROUTE, ROUTE -> STATE (or TERMINATED)
       }
   2.2 state.current_step = next_step
   2.3 state.updated_at = now()
   2.4 IF capsule_id: state.handoff_capsule_ids.append(capsule_id)
   2.5 persist(state) -- WAL 写入
3. 广播事件 TeamActAdvanced(team_id, next_step)
4. RETURN state


算法: TerminationEvaluator.all_met(state, ac_list, reviewer_id, active_leases, cvo_approval)
1. c1 = evaluate_acceptance_criteria(state, ac_list)
2. c2 = evaluate_evidence_attached(state)
3. c3 = evaluate_cross_agent_verified(state, reviewer_id, state.current_owner)
4. c4 = evaluate_no_dangling_ownership(state, active_leases)
5. c5 = evaluate_vision_converged(state, cvo_approval)
6. RETURN c1 AND c2 AND c3 AND c4 AND c5
   (任一 False 即未终止，禁跳过)


算法: Magic Words 打断处理 (F011 联动)
1. MagicWordsDetector 检测到 "星星罐子"
2. SharedStateLedger.freeze(team_id, reason="Magic Words: 星星罐子")
   2.1 state.status = FROZEN
   2.2 WAL 原子写入 (保证状态不丢)
3. 上下文快照写入 thread_trace (F008)
4. 升级 CVO 仲裁
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/infra/repo/sqlite_shared_state_ledger.py
"""SharedStateLedger SQLite 实现 — WAL 可重放"""
from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Optional

from flowforge.core.teamact.state_machine import (
    TeamActState, TeamActStep, TeamStatus,
    SharedStateLedger,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class SqliteSharedStateLedger(SharedStateLedger):
    """SQLite + WAL 模式"""

    SCHEMA = """
    CREATE TABLE IF NOT EXISTS teamact_state (
        team_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        status TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teamact_wal (
        wal_id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        written_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wal_team ON teamact_wal(team_id, wal_id);
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn = sqlite3.connect(db_path, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.executescript(self.SCHEMA)

    async def load(self, team_id: str) -> Optional[TeamActState]:
        row = self._conn.execute(
            "SELECT state_json FROM teamact_state WHERE team_id = ?",
            (team_id,),
        ).fetchone()
        if row is None:
            return None
        return TeamActState.model_validate_json(row["state_json"])

    async def persist(self, state: TeamActState) -> None:
        # WAL 写入
        self._conn.execute("BEGIN")
        try:
            self._conn.execute(
                """
                INSERT OR REPLACE INTO teamact_state
                    (team_id, state_json, status, iteration, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    state.team_id, state.model_dump_json(),
                    state.status.value, state.iteration,
                    datetime.now().isoformat(),
                ),
            )
            self._conn.execute(
                """
                INSERT INTO teamact_wal (team_id, operation, payload, written_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    state.team_id, "persist",
                    state.model_dump_json(),
                    datetime.now().isoformat(),
                ),
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    async def advance(
        self,
        team_id: str,
        capsule_id: Optional[str] = None,
    ) -> TeamActState:
        state = await self.load(team_id)
        if state is None:
            raise RuntimeError(f"TeamActState not found: {team_id}")
        if state.status == TeamStatus.FROZEN:
            raise RuntimeError(f"TeamActState 已冻结，不可推进: {team_id}")
        next_step_map = {
            TeamActStep.STATE: TeamActStep.OWNER,
            TeamActStep.OWNER: TeamActStep.ACTION,
            TeamActStep.ACTION: TeamActStep.EVIDENCE,
            TeamActStep.EVIDENCE: TeamActStep.VERDICT,
            TeamActStep.VERDICT: TeamActStep.ROUTE,
            TeamActStep.ROUTE: TeamActStep.STATE,
        }
        state.current_step = next_step_map[state.current_step]
        state.updated_at = datetime.now()
        if capsule_id:
            state.handoff_capsule_ids.append(capsule_id)
        await self.persist(state)
        return state

    async def check_termination(self, team_id: str) -> bool:
        state = await self.load(team_id)
        if state is None:
            return False
        return state.termination.all_met()

    async def freeze(self, team_id: str, reason: str) -> None:
        state = await self.load(team_id)
        if state is None:
            return
        state.status = TeamStatus.FROZEN
        await self.persist(state)
        logger.warning("teamact.frozen", team_id=team_id, reason=reason)

    async def wal_replay(self, team_id: str) -> Optional[TeamActState]:
        """进程崩溃后 WAL 重放，恢复最新状态"""
        rows = self._conn.execute(
            "SELECT payload FROM teamact_wal WHERE team_id = ? ORDER BY wal_id DESC LIMIT 1",
            (team_id,),
        ).fetchall()
        if not rows:
            return None
        return TeamActState.model_validate_json(rows[0]["payload"])
```

### 3.2 关键流程时序图

```
[完整 TeamAct 六步循环时序]

Operator 触发任务
       │
       ▼
TeamActLoopExecutor.run_team(team_id, task_context)
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│ STATE 步                                                         │
│  - SharedStateLedger.load(team_id)                              │
│  - 读 feature_spec / git / task_queue / 上一 handoff_capsule   │
│  - advance(team_id) → current_step = OWNER                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ OWNER 步                                                         │
│  - CapabilityRouter.route(task, candidates) [F001]             │
│  - state.current_owner = decision.selected_forgekin_id         │
│  - BallCustodyLease.acquire() [F006]                            │
│  - advance(team_id) → current_step = ACTION                    │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ ACTION 步                                                        │
│  - LoopExecutor.execute(input) [质量分阈值 0.85]                │
│  - PingPongCircuitBreaker.evaluate_pass(record) [F004]          │
│    - 若 trip → freeze(team_id) + 升级 CVO                       │
│  - advance(team_id) → current_step = EVIDENCE                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ EVIDENCE 步                                                      │
│  - EvidenceCollector.collect() [F009]                           │
│    - TEST_RED_GREEN: 校验红+绿两次运行                          │
│    - Web 功能: 校验 DOM_DIFF 存在 (T8)                          │
│  - state.evidence_refs.append(evidence_id)                      │
│  - state.termination.evidence_attached = True                   │
│  - advance(team_id) → current_step = VERDICT                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ VERDICT 步                                                       │
│  - 跨厂商 reviewer 选择 (基于盲点不重叠, F001)                   │
│  - reviewer 给出 verdict (approve / blocking)                   │
│    - blocking → 触发 Push Back [F007]                           │
│  - state.termination.cross_agent_verified = True/False          │
│  - advance(team_id) → current_step = ROUTE                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ ROUTE 步                                                         │
│  - HandoffCapsule.write(五段) [F003]                            │
│    - blind_spot_hints 自动从 CapabilityProfile 注入              │
│  - AtMentionParser 行首 @ 路由指令解析 [F005]                   │
│  - TerminationEvaluator.all_met():                              │
│    1. acceptance_criteria_met                                   │
│    2. evidence_attached                                         │
│    3. cross_agent_verified                                      │
│    4. no_dangling_ownership                                     │
│    5. vision_converged                                          │
│  - 全满足 → state.status = TERMINATED                           │
│  - 否则 → state.iteration += 1, current_step = STATE           │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                  ┌───────┴───────┐
                  │               │
              TERMINATED       继续循环
                  │           (iteration+1)
                  ▼
            TeamOutcome


[Magic Words 打断时序]
Operator 输入 "星星罐子"
       │
       ▼
MagicWordsDetector.detect() → MagicWord.STAR_JAR
       │
       ▼
MagicWordsExecutor.emergency_stop()
       │
       ▼
SharedStateLedger.freeze(team_id, "Magic Words: 星星罐子")
       │ (WAL 原子写入，状态不丢)
       ▼
TeamActState.status = FROZEN
       │
       ▼
上下文快照写入 thread_trace (F008)
       │
       ▼
升级 CVO 仲裁
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 |
|------|---------|---------|
| `ValidationError("nesting_level 必须在 1-3 之间")` | 构造 TeamActLoopExecutor 时 nesting_level > 3 | 拒绝构造，提示用子团队而非深嵌套 |
| `RuntimeError("TeamActState 已冻结，不可推进")` | 在 FROZEN 状态调用 advance | 拒绝推进，等待 Magic Words 恢复或 CVO 仲裁 |
| `RuntimeError("TeamActState not found")` | advance 时 state 不存在 | 拒绝推进，要求显式 create |
| `QualityBelowThreshold` | LoopExecutor 输出质量分 < 0.85 | 记录警告，不直接失败（Push Back 可介入） |
| `PingPongTripped` | F004 检测连续空传 >= 3 | freeze(team_id) + 升级 CVO |
| `NoReviewerAvailable` | 无满足盲点不重叠的 reviewer | 终止条件 cross_agent_verified = False，团队不可终止 |
| `MaxIterationsReached` | iteration >= max_iterations | 终止循环，状态留 ACTIVE 等待 operator 决策 |
| `MagicWordsInterrupt` | F011 检测到 Magic Words | freeze + 持久化 + 升级 CVO |

### 3.4 性能优化

| 指标 | 目标 | 优化手段 |
|------|:----:|---------|
| 状态推进 P99 延迟 | < 50ms | SQLite WAL + 内存缓存最近 state + 批量 WAL 写入 |
| run_step 调度开销 | < 5ms | dict 查表分发 + 无反射 |
| MAX_ITERATIONS 限制 | 默认 10 | 配置外置 `flowforge/config/teamact.yaml` |
| WAL 重放速度 | < 1s (1000 个 team) | 索引 (team_id, wal_id) + 仅取最新 |
| 嵌套深度限制 | <= 3 | 构造时校验，禁栈溢出 |
| 质量分阈值 | 0.85 | LoopExecutor 配置外置，可在 Loop config 覆盖 |

```yaml
# flowforge/config/teamact.yaml
teamact:
  max_iterations: 10
  quality_score_threshold: 0.85
  max_nesting_level: 3
  default_step_timeout_seconds: 300
  termination:
    require_cvo_approval: true
    require_cross_vendor_review: true
  circuit_breaker:
    max_empty_passes: 3
    min_output_chars: 50
  lease:
    default_ttl_seconds: 1800
    max_renewals: 3
  push_back:
    max_debate_rounds: 3
    response_deadline_seconds: 3600
  governance:
    injection_layer: native_system_role
    forbidden_layers: [user_message_prepend]
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

**Forgemind ForgekinEngine 调用 TeamAct**（应用层）：

```python
# flowforge/forgemind/engine.py
from flowforge.core.teamact.executor import TeamActLoopExecutor


class ForgekinEngine:
    """灵智体引擎 — 装饰 HybridExecutor + HarnessOrchestrator"""

    def __init__(self, forgekin_id: str) -> None:
        self._forgekin_id = forgekin_id
        self._teamact = TeamActLoopExecutor(nesting_level=1)

    async def run_team_task(self, team_id: str, task: dict) -> dict:
        outcome = await self._teamact.run_team(
            team_id=team_id,
            task_context=task,
            max_iterations=10,
        )
        return outcome.model_dump()
```

**GovernanceInjector 注入治理规则到 native_system_role**（构造时）：

```python
# flowforge/core/harness/governance.py
class GovernanceInjector:
    async def inject_to_teamact(self, team_id: str) -> None:
        """注入治理规则到 TeamAct 灵智体的 native_system_role"""
        bundle = await self._loader.load("flowforge/config/harness.yaml")
        # hard 规则注入 native_system_role (压缩免疫)
        for rule in bundle.rules:
            if rule.authority == "hard":
                await self._inject_native_system_role(team_id, rule.rule_text)
            else:
                await self._inject_developer_role(team_id, rule.rule_text)
        # 禁: user_message_prepend (F010 RA-019 P0)
```

### 4.2 下游影响如何被调用

**F003 Handoff Capsule 在 ROUTE 步被强制写入**：

```python
# flowforge/core/teamact/handoff.py
class HandoffCapsuleStore:
    async def write(self, capsule) -> str:
        # 五段非空校验
        if not all([capsule.what, capsule.why, capsule.tradeoffs, capsule.next_step]):
            raise ValueError("HandoffCapsule 五段字段任一为空抛 SchemaError")
        # blind_spot_hints 自动注入
        await self._blind_spot_injector.inject(capsule, capsule.author_forgekin_id)
        # 持久化 + WAL
        ...
```

**F004 PingPongCircuitBreaker 在 ACTION 步被调用**：

```python
# flowforge/core/teamact/circuit_breaker.py
class PingPongCircuitBreaker:
    async def evaluate_pass(self, record) -> "BreakerVerdict":
        has_output = await self._detector.detect(record)
        state = await self._load_state(record.team_id)
        if has_output or record.debate_mode:
            state.consecutive_empty_passes = 0
        else:
            state.consecutive_empty_passes += 1
        if state.consecutive_empty_passes >= state.max_empty_passes:
            await self.trip(record.team_id, "连续空传 >= 3")
            return BreakerVerdict(action="trip", escalate_to_cvo=True)
        return BreakerVerdict(action="pass" if has_output else "warning")
```

### 4.3 集成测试点

```python
# flowforge/core/teamact/tests/test_teamact_integration.py
"""集成测试 — T1-T8 铁律"""
import pytest
from flowforge.core.teamact.executor import TeamActLoopExecutor
from flowforge.core.teamact.state_machine import TeamActState, TeamActStep, TeamStatus


@pytest.mark.asyncio
async def test_teamact_six_step_loop_completes(real_llm_client, real_db):
    """T1 真实 LLM + T2 真实数据 + T3 具体断言"""
    executor = TeamActLoopExecutor(nesting_level=1)
    outcome = await executor.run_team(
        team_id="team_test_001",
        task_context={
            "task": "为 FlowForge 实现一个 SQLite Repository",
            "task_profile": ...,
            "candidates": [...],
            "what": "实现 SqliteCapabilityRepository",
            "why": "持久化 CapabilityProfile",
            "tradeoffs": "选 SQLite 而非 Postgres（轻量优先）",
            "open_questions": [],
            "next_step": "review by 跨厂商 reviewer",
        },
        max_iterations=5,
    )
    assert outcome.status == TeamStatus.TERMINATED
    assert outcome.iterations >= 1
    assert outcome.termination.all_met() is True
    assert len(outcome.evidence_refs) > 0  # T3 具体断言


@pytest.mark.asyncio
async def test_teamact_freezes_on_magic_words(real_db):
    """Magic Words 打断后状态 FROZEN"""
    executor = TeamActLoopExecutor(nesting_level=1)
    # 模拟 Magic Words 触发
    await executor._ledger.freeze("team_test_002", "Magic Words: 星星罐子")
    state = await executor._ledger.load("team_test_002")
    assert state.status == TeamStatus.FROZEN
    with pytest.raises(RuntimeError, match="已冻结"):
        await executor._ledger.advance("team_test_002")


@pytest.mark.asyncio
async def test_termination_rejects_self_review(real_db):
    """终止条件 3: 跨 agent 交叉验证 reviewer != author"""
    state = TeamActState(team_id="team_test_003", current_owner="forgekin_A")
    evaluator = TerminationEvaluator()
    # reviewer == author (自审)
    result = await evaluator.evaluate_cross_agent_verified(state, "forgekin_A", "forgekin_A")
    assert result is False  # T3 具体断言，禁自审
```

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-1: `TeamActLoopExecutor.run_team` 可完整跑完六步循环
- [ ] AC-2: 五项终止条件任一未满足时 `TerminationCondition.all_met() == False`
- [ ] AC-3: `nesting_level` > 3 时构造抛 `ValidationError`
- [ ] AC-4: `SharedStateLedger.freeze` 后 `advance` 抛 RuntimeError
- [ ] AC-5: Magic Words 打断后 TeamActState 持久化到 WAL（不丢）
- [ ] AC-6: TeamAct 治理规则注入 `native_system_role`，无 `user_message_prepend`
- [ ] AC-7: VERDICT 步 reviewer == author 时 `cross_agent_verified = False`
- [ ] AC-8: ROUTE 步强制写入 HandoffCapsule 五段
- [ ] AC-9: 嵌套深度 ≤ 3（构造时校验）
- [ ] AC-10: WAL 可重放，进程崩溃后状态可恢复

### 5.2 性能验收

- [ ] AC-11: 状态推进 P99 延迟 < 50ms
- [ ] AC-12: `run_step` 调度开销 < 5ms
- [ ] AC-13: WAL 重放 1000 个 team 状态 < 1s
- [ ] AC-14: 质量分阈值 0.85（LoopExecutor 配置外置）
- [ ] AC-15: max_iterations 默认 10，可在 `teamact.yaml` 覆盖

### 5.3 安全验收

- [ ] AC-16: SharedStateLedger 通过 DI 容器注入，无直接实例化
- [ ] AC-17: 所有 DB 操作通过 Repository 层，无 `cursor.execute` 直操作
- [ ] AC-18: TeamAct 状态走 WAL（F021 联动，进程崩溃可恢复）
- [ ] AC-19: Magic Words 逃生舱在任何 step 都可触发，不可绕过
- [ ] AC-20: 治理规则压缩免疫（`compression_immune=true`）

### 5.4 Eval 验收

- [ ] AC-21: TeamAct 终止条件达成率 >= 90%（基于 Eval 信号）
- [ ] AC-22: 交接胶囊完整率 100%（五段字段全非空）
- [ ] AC-23: 跨 agent review 配对成功率 >= 70%（盲点不重叠）
- [ ] AC-24: TeamAct 失败模式归因到 F020 七类归因矩阵
- [ ] AC-25: 状态推进日志（trace 信号）写入 F009 Evidence Store

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002 TeamAct 六步循环）
- [doc:../arch.md#§3.2]（TeamAct 六步循环 + 五项终止条件）
- [doc:../features/F002-teamact-loop.md]（同号 Feature 级 SRS）
- [doc:../architecture/A002-teamact-loop.md]（同号 Feature 级 SAD）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../decisions/010-distributed-reliability.md]（SharedStateLedger Tier 2 恢复）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）
- [doc:../../../hiclaw/rules.md#编程红线]（第 9 条：禁用继承替代组合/插件）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F002/A002） | 开发者灵智体（猎犬·夏洛克） |

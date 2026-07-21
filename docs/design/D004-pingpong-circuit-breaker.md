# D004: 乒乓球熔断器（PingPong Circuit Breaker）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-018）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]
> **对应 Feature**: [doc:../features/F004-pingpong-circuit-breaker.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A004-pingpong-circuit-breaker.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A004 已给出 PingPongCircuitBreaker 的架构契约（实质产出判定 + 空传计数 + 熔断升级 + WAL 可重放），但未落到代码层。本详细设计在代码层解决以下问题：

1. **"实质产出"判定如何避免Forgekin自评欺骗**：Forgekin可能撒谎说"我有产出"，必须基于工具调用记录与产出字符数等客观信号
2. **连续空传计数的"连续"语义如何在状态机层严格定义**：中间一次有产出的传球是否归零，A004 决策 6 已明确归零，但代码层需保证原子性
3. **熔断触发后的冻结如何与 TeamActState 联动**：熔断器与状态机是两个对象，需保证冻结原子性，避免熔断触发时 TeamAct 仍推进
4. **debate_mode 豁免如何防止滥用**：豁免必须显式声明，仍记录 trace，但代码层需校验豁免合理性（不能所有传球都声明 debate_mode）
5. **CVO 确认 reset 的鉴权如何在代码层落地**：`cvo_confirmed=true` 不能仅靠参数，必须有签名/令牌验证
6. **WAL 重放在熔断状态恢复时如何避免重复触发熔断**：进程崩溃时若已 tripped，重启后不能再次广播 Eval 信号
7. **熔断器在多团队并发场景下如何隔离**：每个 team_id 独立状态机，不可串扰

### 1.2 设计约束

- **Python 3.11+ 强制类型注解**：所有 public 接口必须带类型注解
- **Pydantic v2 BaseModel**：所有数据结构基于 Pydantic v2，校验器使用 `@field_validator` / `@model_validator`
- **async/await 强制**：所有 I/O 操作（DB 读写 / EventBus / Eval 信号）必须 async
- **DI 容器注入**：`PingPongCircuitBreaker` / `SubstantiveOutputDetector` / `PingPongStateStore` 通过 `flowforge/core/plugin/di_container.py` 注入，禁直接实例化
- **Repository 层抽象**：熔断状态持久化必须通过 `PingPongStateStore` ABC，禁 `cursor.execute`
- **配置外置**：`max_empty_passes` / `min_output_chars` / `min_tool_calls` / `debate_ratio_threshold` 外置到 `flowforge/config/teamact.yaml`
- **日志注入 trace_id**：所有日志通过 `core/tracing.py` 的 `get_logger`，自动注入 `trace_id`
- **提示词外置**：CVO 升级通知与 reset 确认的提示词外置到 `flowforge/config/teamact_prompts.yaml`，禁 .py 文件硬编码
- **单向依赖**：`flowforge/core/teamact/circuit_breaker.py` 只能 import `core/interfaces/` 与共享内核，禁 import forgemind / *Forge
- **半角问号约束**：所有正则 pattern 必须使用半角 `?`，禁全角 `？`
- **测试铁律 T1-T8**：E2E 测试必须真实 LLM 调用 + 真实数据 + 真实工具调用

### 1.3 设计影响

- **对 A002 TeamAct Loop**：ACTION/ROUTE 步触发 `evaluate_pass(record)`，熔断触发时冻结 TeamActState
- **对 A003 Handoff Capsule**：胶囊 `has_substantive_output` 是熔断器实质产出判定的输入之一
- **对 A006 Ball Custody Lease**：lease held 期间无工具调用 + 无产出计入空传
- **对 A009 Evidence & Sensors**：工具调用记录与产出字符数由 F009 提供证据
- **对 A018 Eval Contract**：熔断触发写 Eval 信号，归因矩阵消费
- **对 A021 Side Effect WAL**：熔断状态走 WAL，进程崩溃可恢复
- **对 A011 Magic Words**：熔断状态不可绕过 Magic Words 逃生舱，operator 可随时拉闸
- **对 CVO**：熔断触发升级 CVO 仲裁，reset 必须 CVO 确认

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                flowforge/core/teamact/circuit_breaker.py                │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                       PassRecord                                 │  │
│   │   (Pydantic v2 BaseModel, 不可变)                                │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + record_id: str                                                │  │
│   │  + team_id: str                                                  │  │
│   │  + from_forgekin_id: str                                         │  │
│   │  + to_forgekin_id: str                                           │  │
│   │  + iteration: int (>= 1)                                         │  │
│   │  + tool_calls: list[str]  [工具调用 ID]                          │  │
│   │  + output_chars: int  (>= 0)                                     │  │
│   │  + evidence_refs: list[str]  [F009 证据 ID]                      │  │
│   │  + debate_mode: bool = False                                     │  │
│   │  + has_substantive_output: bool = False  [由 Detector 判定]      │  │
│   │  + created_at: datetime                                          │  │
│   └────────────────────────────┬─────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                    SubstantiveOutputDetector (ABC)               │  │
│   │  + detect(record) -> bool                                       │  │
│   │              ▲                                                   │  │
│   │              │ implements                                        │  │
│   │   ┌──────────┴───────────────┐                                   │  │
│   │   │ DefaultSubstantiveOutput │                                   │  │
│   │   │ Detector                 │                                   │  │
│   │   │ - _min_output_chars      │                                   │  │
│   │   │ - _min_tool_calls        │                                   │  │
│   │   └──────────────────────────┘                                   │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                       PingPongState                              │  │
│   │   (Pydantic v2 BaseModel, 状态机)                               │  │
│   │  + team_id: str                                                  │  │
│   │  + consecutive_empty_passes: int = 0                             │  │
│   │  + max_empty_passes: int = 3                                     │  │
│   │  + history: list[PassRecord]  (最近 N 条)                        │  │
│   │  + status: Literal["open","warning","tripped"] = "open"          │  │
│   │  + tripped_at: Optional[datetime]                                │  │
│   │  + tripped_reason: Optional[str]                                 │  │
│   │  + debate_ratio: float  [debate 占比, 防滥用]                    │  │
│   │  + reset -> Self                                               │  │
│   │  + is_frozen -> bool                                           │  │
│   └────────────────────────────┬─────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  PingPongCircuitBreaker (ABC)                    │  │
│   │  + evaluate_pass(record) -> BreakerVerdict                       │  │
│   │  + should_trip(team_id) -> bool                                  │  │
│   │  + trip(team_id, reason) -> None                                 │  │
│   │  + reset(team_id, cvo_confirmed) -> None                         │  │
│   │  + get_state(team_id) -> PingPongState                           │  │
│   │              ▲                                                   │  │
│   │              │ implements                                        │  │
│   │   ┌──────────┴────────────────┐                                  │  │
│   │   │ DefaultPingPongCircuit    │                                  │  │
│   │   │ Breaker                   │                                  │  │
│   │   │ - _detector               │                                  │  │
│   │   │ - _store                  │                                  │  │
│   │   │ - _teamact_state_repo     │                                  │  │
│   │   │ - _event_bus              │                                  │  │
│   │   │ - _cvo_notifier           │                                  │  │
│   │   └───────────────────────────┘                                  │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │           PingPongStateStore (ABC, Repository 层)                │  │
│   │  + save(state) -> None                                           │  │
│   │  + load(team_id) -> Optional[PingPongState]                      │  │
│   │  + list_tripped -> list[PingPongState]                         │  │
│   │  + wal_replay(log_path) -> list[PingPongState]                   │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口契约实现

```python
# flowforge/core/teamact/circuit_breaker.py
from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from flowforge.core.tracing import get_logger
from flowforge.core.plugin.di_container import inject

logger = get_logger(__name__)


# ────────────────────────── 枚举与异常 ──────────────────────────

class BreakerStatus(str, Enum):
    """熔断器状态机"""
    OPEN = "open"          # 正常，空传计数 < max_empty_passes
    WARNING = "warning"    # 警告，空传计数 >= 2（接近熔断）
    TRIPPED = "tripped"    # 已熔断，TeamAct 冻结


class BreakerAction(str, Enum):
    """熔断判定输出动作"""
    PASS = "pass"          # 通过，继续 TeamAct
    WARNING = "warning"    # 警告，记录但仍继续
    TRIP = "trip"          # 熔断，冻结 TeamAct


class CircuitBreakerError(Exception):
    """熔断器业务异常"""


class CvoConfirmationRequired(CircuitBreakerError):
    """reset 必须由 CVO 确认"""


# ────────────────────────── 数据模型 ──────────────────────────

class PassRecord(BaseModel):
    """持球期产出记录（一次 Route 步对应一条）

    不可变记录，记录一次持球期间的工具调用、产出字符数、证据引用。
    has_substantive_output 由 SubstantiveOutputDetector 判定，禁Forgekin自评。
    """

    record_id: str = Field(..., min_length=1)
    team_id: str = Field(..., min_length=1)
    from_forgekin_id: str = Field(..., min_length=1)
    to_forgekin_id: str = Field(..., min_length=1)
    iteration: int = Field(..., ge=1, description="TeamAct 迭代号")

    tool_calls: list[str] = Field(
        default_factory=list,
        description="本次持球期间工具调用 ID 列表",
    )
    output_chars: int = Field(
        default=0, ge=0,
        description="本次持球期间产出字符数",
    )
    evidence_refs: list[str] = Field(
        default_factory=list,
        description="关联 F009 Evidence ID",
    )
    debate_mode: bool = Field(
        default=False,
        description="显式声明辩论豁免（仍记录 trace）",
    )
    has_substantive_output: bool = Field(
        default=False,
        description="由 SubstantiveOutputDetector 判定，禁Forgekin自评",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
    )

    @field_validator("from_forgekin_id")
    @classmethod
    def _check_not_self_pass(cls, v: str, info) -> str:
        """禁止自己传给自己（乒乓球互传检测）"""
        to = info.data.get("to_forgekin_id")
        if to and v == to:
            raise CircuitBreakerError(
                f"from_forgekin_id={v} 不可等于 to_forgekin_id（禁自传）"
            )
        return v

    @model_validator(mode="after")
    def _check_record_id_format(self) -> "PassRecord":
        """record_id 格式校验：pass-{team_id}-{iteration}-{hash8}"""
        expected_prefix = f"pass-{self.team_id}-{self.iteration}-"
        if not self.record_id.startswith(expected_prefix):
            raise CircuitBreakerError(
                f"record_id={self.record_id} 必须以 {expected_prefix} 开头"
            )
        return self


class PingPongState(BaseModel):
    """熔断状态机（每个 team_id 独立实例）

    状态转换:
        open -> warning:  consecutive_empty_passes >= 2
        warning -> tripped: consecutive_empty_passes >= max_empty_passes (3)
        tripped -> open:   reset(cvo_confirmed=True)
    """

    team_id: str = Field(..., min_length=1)
    consecutive_empty_passes: int = Field(default=0, ge=0)
    max_empty_passes: int = Field(default=3, ge=1, le=10)

    history: list[PassRecord] = Field(
        default_factory=list,
        description="最近 N 条 PassRecord，默认 N=20",
    )
    history_max_size: int = Field(default=20, ge=1, le=100)

    status: BreakerStatus = Field(default=BreakerStatus.OPEN)
    tripped_at: Optional[datetime] = None
    tripped_reason: Optional[str] = None

    debate_count: int = Field(default=0, ge=0)
    total_count: int = Field(default=0, ge=0)
    debate_ratio_threshold: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="debate_mode 占比超过此阈值则告警",
    )

    @model_validator(mode="after")
    def _check_status_consistency(self) -> "PingPongState":
        """status 与 tripped_at/reason 一致性"""
        if self.status == BreakerStatus.TRIPPED:
            if not self.tripped_at or not self.tripped_reason:
                raise CircuitBreakerError(
                    "status=TRIPPED 时 tripped_at 与 tripped_reason 必须非空"
                )
        else:
            if self.tripped_at or self.tripped_reason:
                raise CircuitBreakerError(
                    f"status={self.status.value} 时 tripped_at 与 "
                    f"tripped_reason 必须为空"
                )
        return self

    @property
    def debate_ratio(self) -> float:
        """debate_mode 占比"""
        if self.total_count == 0:
            return 0.0
        return self.debate_count / self.total_count

    def is_frozen(self) -> bool:
        """是否冻结 TeamActState"""
        return self.status == BreakerStatus.TRIPPED

    def reset(self) -> "PingPongState":
        """重置状态（必须由 CVO 确认后调用）"""
        self.consecutive_empty_passes = 0
        self.status = BreakerStatus.OPEN
        self.tripped_at = None
        self.tripped_reason = None
        # history 保留（供 trace 与归因分析）
        return self


class BreakerVerdict(BaseModel):
    """熔断判定输出"""
    action: BreakerAction
    consecutive_empty_passes: int = Field(ge=0)
    max_empty_passes: int = Field(ge=1)
    reason: Optional[str] = None
    escalate_to_cvo: bool = False
    debate_ratio_warning: bool = False
    team_id: str


# ────────────────────────── 实质产出判定器 ──────────────────────────

class SubstantiveOutputDetector(ABC):
    """实质产出判定器

    判定标准（任一满足即视为有实质产出）:
    - tool_calls 数量 >= min_tool_calls（默认 1）
    - OR output_chars >= min_output_chars（默认 200）
    - debate_mode=true 时直接返回 True（但仍记录 trace）
    """

    @abstractmethod
    async def detect(self, record: PassRecord) -> bool:
        """判定本次传球是否有实质产出"""


class DefaultSubstantiveOutputDetector(SubstantiveOutputDetector):
    """默认实质产出判定器"""

    def __init__(
        self,
        min_output_chars: int = 200,
        min_tool_calls: int = 1,
    ):
        self._min_output_chars = min_output_chars
        self._min_tool_calls = min_tool_calls

    async def detect(self, record: PassRecord) -> bool:
        if record.debate_mode:
            return True
        if len(record.tool_calls) >= self._min_tool_calls:
            return True
        if record.output_chars >= self._min_output_chars:
            return True
        return False


# ────────────────────────── Repository 抽象 ──────────────────────────

class PingPongStateStore(ABC):
    """熔断状态 Repository — 唯一持久化入口

    架构契约:
    - 通过 DI 容器注入，禁直接实例化
    - 持久化到 Durable Surface (WAL 可重放)
    - 每个 team_id 独立状态，不可串扰
    """

    @abstractmethod
    async def save(self, state: PingPongState) -> None:
        """保存熔断状态"""

    @abstractmethod
    async def load(self, team_id: str) -> Optional[PingPongState]:
        """加载团队熔断状态"""

    @abstractmethod
    async def list_tripped(self) -> list[PingPongState]:
        """列出所有已熔断团队（CVO 仲裁队列）"""

    @abstractmethod
    async def wal_replay(self, log_path: str) -> list[PingPongState]:
        """WAL 重放，进程崩溃后恢复"""


# ────────────────────────── 熔断器主类 ──────────────────────────

class PingPongCircuitBreaker(ABC):
    """乒乓球熔断器 — 实质产出判定 + 空传计数 + 熔断升级"""

    @abstractmethod
    async def evaluate_pass(self, record: PassRecord) -> BreakerVerdict:
        """评估本次传球是否计入空传"""

    @abstractmethod
    async def should_trip(self, team_id: str) -> bool:
        """检查是否应触发熔断"""

    @abstractmethod
    async def trip(self, team_id: str, reason: str) -> None:
        """触发熔断（冻结 TeamActState + 写 Eval 信号 + 升级 CVO）"""

    @abstractmethod
    async def reset(
        self, team_id: str, cvo_confirmed: bool = False,
    ) -> None:
        """恢复熔断状态（必须 CVO 确认）"""

    @abstractmethod
    async def get_state(self, team_id: str) -> PingPongState:
        """获取团队熔断状态"""


class DefaultPingPongCircuitBreaker(PingPongCircuitBreaker):
    """默认乒乓球熔断器实现"""

    def __init__(
        self,
        detector: SubstantiveOutputDetector,
        store: PingPongStateStore,
        teamact_state_repo: Any,
        event_bus: Any,
        cvo_notifier: Any,
        eval_signal_writer: Any,
        debate_ratio_threshold: float = 0.5,
        history_max_size: int = 20,
    ):
        self._detector = detector
        self._store = store
        self._teamact_state_repo = teamact_state_repo
        self._event_bus = event_bus
        self._cvo_notifier = cvo_notifier
        self._eval_signal_writer = eval_signal_writer
        self._debate_ratio_threshold = debate_ratio_threshold
        self._history_max_size = history_max_size

    async def evaluate_pass(self, record: PassRecord) -> BreakerVerdict:
        """评估本次传球"""
        # 1. 加载状态
        state = await self._store.load(record.team_id)
        if state is None:
            state = PingPongState(
                team_id=record.team_id,
                history_max_size=self._history_max_size,
                debate_ratio_threshold=self._debate_ratio_threshold,
            )

        # 2. 判定实质产出
        has_output = await self._detector.detect(record)
        record.has_substantive_output = has_output

        # 3. 更新计数（有产出归零，无产出 +1）
        if has_output:
            state.consecutive_empty_passes = 0
        else:
            state.consecutive_empty_passes += 1

        # 4. 更新 debate 统计
        state.total_count += 1
        if record.debate_mode:
            state.debate_count += 1

        # 5. 追加 history
        state.history.append(record)
        if len(state.history) > state.history_max_size:
            state.history = state.history[-state.history_max_size:]

        # 6. 判定状态转换
        verdict_action: BreakerAction = BreakerAction.PASS
        reason: Optional[str] = None
        escalate = False
        debate_warning = False

        if state.consecutive_empty_passes >= state.max_empty_passes:
            state.status = BreakerStatus.TRIPPED
            state.tripped_at = datetime.now(timezone.utc)
            reason = (
                f"连续空传 {state.consecutive_empty_passes} 次，"
                f"达到上限 {state.max_empty_passes}"
            )
            state.tripped_reason = reason
            verdict_action = BreakerAction.TRIP
            escalate = True
        elif state.consecutive_empty_passes >= 2:
            state.status = BreakerStatus.WARNING
            verdict_action = BreakerAction.WARNING
            reason = (
                f"连续空传 {state.consecutive_empty_passes} 次，"
                f"接近上限 {state.max_empty_passes}"
            )

        if state.debate_ratio > state.debate_ratio_threshold:
            debate_warning = True
            logger.warning(
                "team_id=%s debate_ratio=%.2f 超过阈值 %.2f",
                record.team_id, state.debate_ratio,
                state.debate_ratio_threshold,
                extra={"trace_id": record.record_id},
            )

        # 7. 持久化
        await self._store.save(state)

        # 8. 熔断触发
        if verdict_action == BreakerAction.TRIP:
            await self.trip(record.team_id, reason or "未提供原因")

        verdict = BreakerVerdict(
            action=verdict_action,
            consecutive_empty_passes=state.consecutive_empty_passes,
            max_empty_passes=state.max_empty_passes,
            reason=reason,
            escalate_to_cvo=escalate,
            debate_ratio_warning=debate_warning,
            team_id=record.team_id,
        )

        await self._event_bus.publish(
            event_type="pingpong.breaker.evaluated",
            payload=verdict.model_dump(mode="json"),
            trace_id=record.record_id,
        )

        logger.info(
            "熔断器评估 team_id=%s action=%s empty=%d/%d",
            record.team_id, verdict_action.value,
            state.consecutive_empty_passes, state.max_empty_passes,
            extra={"trace_id": record.record_id},
        )
        return verdict

    async def should_trip(self, team_id: str) -> bool:
        state = await self._store.load(team_id)
        if state is None:
            return False
        return state.consecutive_empty_passes >= state.max_empty_passes

    async def trip(self, team_id: str, reason: str) -> None:
        """触发熔断"""
        await self._teamact_state_repo.freeze(team_id, reason=reason)
        await self._eval_signal_writer.write_signal(
            signal_type="pingpong.tripped",
            team_id=team_id,
            reason=reason,
            timestamp=datetime.now(timezone.utc),
        )
        await self._cvo_notifier.notify_escalation(
            team_id=team_id,
            escalation_type="pingpong_circuit_breaker_tripped",
            reason=reason,
            required_action="cvo_arbitration",
        )
        await self._event_bus.publish(
            event_type="pingpong.breaker.tripped",
            payload={
                "team_id": team_id,
                "reason": reason,
                "tripped_at": datetime.now(timezone.utc).isoformat,
            },
            trace_id=f"trip-{team_id}",
        )
        logger.error(
            "熔断触发 team_id=%s reason=%s 已升级 CVO",
            team_id, reason,
            extra={"trace_id": f"trip-{team_id}"},
        )

    async def reset(
        self, team_id: str, cvo_confirmed: bool = False,
    ) -> None:
        """恢复熔断状态（必须 CVO 确认）"""
        if not cvo_confirmed:
            raise CvoConfirmationRequired(
                f"reset team_id={team_id} 必须由 CVO 确认"
            )
        state = await self._store.load(team_id)
        if state is None:
            raise CircuitBreakerError(
                f"team_id={team_id} 无熔断状态可恢复"
            )
        if state.status != BreakerStatus.TRIPPED:
            raise CircuitBreakerError(
                f"team_id={team_id} status={state.status.value} 非 tripped"
            )
        state.reset
        await self._store.save(state)
        await self._teamact_state_repo.unfreeze(team_id)
        await self._event_bus.publish(
            event_type="pingpong.breaker.reset",
            payload={
                "team_id": team_id,
                "reset_at": datetime.now(timezone.utc).isoformat,
                "cvo_confirmed": True,
            },
            trace_id=f"reset-{team_id}",
        )
        logger.info(
            "熔断恢复 team_id=%s (CVO 确认)", team_id,
            extra={"trace_id": f"reset-{team_id}"},
        )

    async def get_state(self, team_id: str) -> PingPongState:
        state = await self._store.load(team_id)
        if state is None:
            state = PingPongState(
                team_id=team_id,
                history_max_size=self._history_max_size,
                debate_ratio_threshold=self._debate_ratio_threshold,
            )
        return state
```

### 2.3 关键算法伪代码

#### 算法 1：evaluate_pass（熔断器评估流程）

```
INPUT:  record (PassRecord)
        team_id

OUTPUT: BreakerVerdict

STEPS:
1. state = await store.load(team_id)
   IF state IS None:
       state = PingPongState(team_id=team_id)

2. has_output = await detector.detect(record)
   # 判定标准:
   #   debate_mode=true → True (豁免)
   #   len(tool_calls) >= 1 → True
   #   output_chars >= 200 → True
   #   else → False

3. record.has_substantive_output = has_output

4. IF has_output:
       state.consecutive_empty_passes = 0  # 归零（非递减）
   ELSE:
       state.consecutive_empty_passes += 1

5. state.total_count += 1
   IF record.debate_mode:
       state.debate_count += 1
   IF state.debate_ratio > 0.5:
       WARN("debate_mode 可能滥用")

6. state.history.append(record)
   IF len(state.history) > 20:
       state.history = state.history[-20:]

7. IF state.consecutive_empty_passes >= 3:
       state.status = TRIPPED
       verdict_action = TRIP
       escalate = True
   ELIF state.consecutive_empty_passes >= 2:
       state.status = WARNING
       verdict_action = WARNING
   ELSE:
       state.status = OPEN
       verdict_action = PASS

8. await store.save(state)

9. IF verdict_action == TRIP:
       await self.trip(team_id, reason)

10. await event_bus.publish("pingpong.breaker.evaluated", verdict)
    RETURN verdict
```

#### 算法 2：trip（熔断触发后的升级流程）

```
INPUT:  team_id, reason

STEPS:
1. await teamact_state_repo.freeze(team_id, reason)
   # TeamActState.status = FROZEN

2. await eval_signal_writer.write_signal(
       signal_type="pingpong.tripped",
       team_id, reason, timestamp=now_utc,
   )

3. await cvo_notifier.notify_escalation(
       team_id, escalation_type, reason,
       required_action="cvo_arbitration",
   )

4. await event_bus.publish("pingpong.breaker.tripped", payload)

5. LOG_ERROR("熔断触发 team_id=X reason=Y 已升级 CVO")
```

#### 算法 3：reset（CVO 确认恢复）

```
INPUT:  team_id, cvo_confirmed

STEPS:
1. IF NOT cvo_confirmed:
       RAISE CvoConfirmationRequired

2. state = await store.load(team_id)
   IF state IS None:
       RAISE CircuitBreakerError
   IF state.status != TRIPPED:
       RAISE CircuitBreakerError

3. state.reset
   # consecutive_empty_passes = 0, status = OPEN
   # tripped_at = None, tripped_reason = None
   # history 保留

4. await store.save(state)

5. await teamact_state_repo.unfreeze(team_id)

6. await event_bus.publish("pingpong.breaker.reset", payload)

7. LOG_INFO("熔断恢复 team_id=X (CVO 确认)")
```

#### 算法 4：record_id 生成

```
INPUT:  team_id, iteration, from_forgekin_id, to_forgekin_id

OUTPUT: record_id = "pass-{team_id}-{iteration}-{hash8}"

STEPS:
1. raw = f"{team_id}|{iteration}|{from_forgekin_id}|{to_forgekin_id}|{utc_now_ns}"
2. hash8 = sha256(raw).hexdigest[:8]
3. record_id = f"pass-{team_id}-{iteration}-{hash8}"
4. RETURN record_id
```

#### 算法 5：debate_mode 滥用检测

```
INPUT:  state (PingPongState)

OUTPUT: bool (是否滥用)

STEPS:
1. IF state.total_count < 5:
       RETURN False  # 样本不足

2. ratio = state.debate_count / state.total_count

3. IF ratio > 0.5:
       WARN("debate_mode 占比超阈值，可能滥用")
       RETURN True

4. RETURN False
```

---

## 3. 模块实现

### 3.1 SQLite 持久化实现（WAL 可重放）

```python
# flowforge/infra/repo/sqlite_pingpong_store.py
from __future__ import annotations

import asyncio
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from flowforge.core.teamact.circuit_breaker import (
    BreakerStatus,
    PassRecord,
    PingPongState,
    PingPongStateStore,
)
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class SqlitePingPongStateStore(PingPongStateStore):
    """SQLite 持久化实现（WAL 可重放，与 F021 联动）

    表结构:
        pingpong_states (
            team_id TEXT PRIMARY KEY,
            consecutive_empty_passes INTEGER NOT NULL,
            max_empty_passes INTEGER NOT NULL,
            history_json TEXT,
            history_max_size INTEGER NOT NULL,
            status TEXT NOT NULL,
            tripped_at TEXT,
            tripped_reason TEXT,
            debate_count INTEGER NOT NULL,
            total_count INTEGER NOT NULL,
            debate_ratio_threshold REAL NOT NULL,
            updated_at TEXT NOT NULL
        )

        pingpong_pass_records (独立表，用于详细 trace)
            record_id TEXT PRIMARY KEY,
            team_id TEXT NOT NULL,
            from_forgekin_id TEXT NOT NULL,
            to_forgekin_id TEXT NOT NULL,
            iteration INTEGER NOT NULL,
            tool_calls_json TEXT,
            output_chars INTEGER NOT NULL,
            evidence_refs_json TEXT,
            debate_mode INTEGER NOT NULL,
            has_substantive_output INTEGER NOT NULL,
            created_at TEXT NOT NULL
    """

    DDL = """
    CREATE TABLE IF NOT EXISTS pingpong_states (
        team_id TEXT PRIMARY KEY,
        consecutive_empty_passes INTEGER NOT NULL,
        max_empty_passes INTEGER NOT NULL,
        history_json TEXT,
        history_max_size INTEGER NOT NULL,
        status TEXT NOT NULL,
        tripped_at TEXT,
        tripped_reason TEXT,
        debate_count INTEGER NOT NULL,
        total_count INTEGER NOT NULL,
        debate_ratio_threshold REAL NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pingpong_pass_records (
        record_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        from_forgekin_id TEXT NOT NULL,
        to_forgekin_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        tool_calls_json TEXT,
        output_chars INTEGER NOT NULL,
        evidence_refs_json TEXT,
        debate_mode INTEGER NOT NULL,
        has_substantive_output INTEGER NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ppr_team_iter
        ON pingpong_pass_records(team_id, iteration);
    """

    def __init__(
        self,
        db_path: str | Path,
        wal_dir: Optional[str | Path] = None,
    ):
        self._db_path = str(db_path)
        self._wal_dir = str(wal_dir) if wal_dir else str(Path(db_path).parent)
        self._lock = asyncio.Lock
        self._init_db

    def _init_db(self) -> None:
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self._db_path) as conn:
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.executescript(self.DDL)
            conn.commit
        logger.info(
            "SqlitePingPongStateStore 初始化完成 db=%s", self._db_path,
        )

    @staticmethod
    def _serialize_history(history: list[PassRecord]) -> str:
        return json.dumps(
            [r.model_dump(mode="json") for r in history],
            ensure_ascii=False,
        )

    @staticmethod
    def _deserialize_history(raw: str) -> list[PassRecord]:
        if not raw:
            return []
        return [PassRecord(**item) for item in json.loads(raw)]

    async def save(self, state: PingPongState) -> None:
        async with self._lock:
            def _do_save -> None:
                with sqlite3.connect(self._db_path) as conn:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO pingpong_states
                            (team_id, consecutive_empty_passes, max_empty_passes,
                             history_json, history_max_size, status,
                             tripped_at, tripped_reason, debate_count,
                             total_count, debate_ratio_threshold, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            state.team_id,
                            state.consecutive_empty_passes,
                            state.max_empty_passes,
                            self._serialize_history(state.history),
                            state.history_max_size,
                            state.status.value,
                            state.tripped_at.isoformat if state.tripped_at else None,
                            state.tripped_reason,
                            state.debate_count,
                            state.total_count,
                            state.debate_ratio_threshold,
                            datetime.now(timezone.utc).isoformat,
                        ),
                    )
                    for record in state.history[-5:]:
                        conn.execute(
                            """
                            INSERT OR REPLACE INTO pingpong_pass_records
                                (record_id, team_id, from_forgekin_id,
                                 to_forgekin_id, iteration, tool_calls_json,
                                 output_chars, evidence_refs_json, debate_mode,
                                 has_substantive_output, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                record.record_id,
                                record.team_id,
                                record.from_forgekin_id,
                                record.to_forgekin_id,
                                record.iteration,
                                json.dumps(record.tool_calls, ensure_ascii=False),
                                record.output_chars,
                                json.dumps(record.evidence_refs, ensure_ascii=False),
                                1 if record.debate_mode else 0,
                                1 if record.has_substantive_output else 0,
                                record.created_at.isoformat,
                            ),
                        )
                    conn.commit

            await asyncio.to_thread(_do_save)
            logger.info(
                "保存熔断状态 team_id=%s status=%s empty=%d",
                state.team_id, state.status.value,
                state.consecutive_empty_passes,
                extra={"trace_id": f"pp-save-{state.team_id}"},
            )

    async def load(self, team_id: str) -> Optional[PingPongState]:
        async with self._lock:
            def _do_load -> Optional[PingPongState]:
                with sqlite3.connect(self._db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    row = conn.execute(
                        "SELECT * FROM pingpong_states WHERE team_id = ?",
                        (team_id,),
                    ).fetchone
                return self._row_to_state(row) if row else None

            return await asyncio.to_thread(_do_load)

    async def list_tripped(self) -> list[PingPongState]:
        async with self._lock:
            def _do_list -> list[PingPongState]:
                with sqlite3.connect(self._db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    rows = conn.execute(
                        "SELECT * FROM pingpong_states WHERE status = ?",
                        (BreakerStatus.TRIPPED.value,),
                    ).fetchall
                return [self._row_to_state(r) for r in rows]

            return await asyncio.to_thread(_do_list)

    async def wal_replay(self, log_path: str) -> list[PingPongState]:
        async with self._lock:
            def _do_replay -> list[PingPongState]:
                with sqlite3.connect(self._db_path) as conn:
                    conn.execute("PRAGMA wal_checkpoint(FULL);")
                    conn.commit
                with sqlite3.connect(self._db_path) as conn:
                    conn.row_factory = sqlite3.Row
                    rows = conn.execute(
                        "SELECT * FROM pingpong_states ORDER BY team_id"
                    ).fetchall
                return [self._row_to_state(r) for r in rows]

            return await asyncio.to_thread(_do_replay)

    @staticmethod
    def _row_to_state(row: sqlite3.Row) -> PingPongState:
        tripped_at = None
        if row["tripped_at"]:
            tripped_at = datetime.fromisoformat(row["tripped_at"])
        return PingPongState(
            team_id=row["team_id"],
            consecutive_empty_passes=row["consecutive_empty_passes"],
            max_empty_passes=row["max_empty_passes"],
            history=SqlitePingPongStateStore._deserialize_history(
                row["history_json"] or "[]"
            ),
            history_max_size=row["history_max_size"],
            status=BreakerStatus(row["status"]),
            tripped_at=tripped_at,
            tripped_reason=row["tripped_reason"],
            debate_count=row["debate_count"],
            total_count=row["total_count"],
            debate_ratio_threshold=row["debate_ratio_threshold"],
        )
```

### 3.2 关键流程时序图

#### 时序图 1：TeamAct ROUTE 步触发熔断器评估

```
TeamActLoop    Author       CircuitBreaker   Substantive    PingPong
 (A002)        Forgekin     (D004)           OutputDet      StateStore
    │              │              │              │              │
    │ ACTION 步   │              │              │              │
    ├─────────────►│              │              │              │
    │              │ 执行动作     │              │              │
    │              │ (tool_calls/ │              │              │
    │              │  output_chars)              │              │
    │              │              │              │              │
    │ ROUTE 步     │              │              │              │
    │ PassRecord   │              │              │              │
    ├──────────────┼─────────────►│              │              │
    │              │              │ load(team_id)│              │
    │              │              ├──────────────┼─────────────►│
    │              │              │              │              │ SELECT
    │              │              │◄─────────────┼─────────────┤
    │              │              │ state        │              │
    │              │              │              │              │
    │              │              │ detect(record)              │
    │              │              ├─────────────►│              │
    │              │              │              │ debate_mode? │
    │              │              │              │ tool_calls?  │
    │              │              │              │ output_chars?│
    │              │              │◄─────────────┤              │
    │              │              │ has_output   │              │
    │              │              │              │              │
    │              │              │ 更新计数     │              │
    │              │              │ (归零 or +1) │              │
    │              │              │              │              │
    │              │              │ save(state)  │              │
    │              │              ├──────────────┼─────────────►│
    │              │              │              │              │ INSERT/REPLACE
    │              │              │◄─────────────┼─────────────┤
    │              │              │              │              │
    │              │              │ 判定状态转换 │              │
    │              │              │ (open/warn/  │              │
    │              │              │  tripped)    │              │
    │              │              │              │              │
    │              │   ┌──────────┴────────┐     │              │
    │              │   │ verdict=PASS?     │     │              │
    │              │   │ WARNING?          │     │              │
    │              │   │ TRIP?             │     │              │
    │              │   └──────────┬────────┘     │              │
    │              │              │              │              │
    │              │   [TRIP]     │              │              │
    │              │              │ trip       │              │
    │              │              │ → freeze     │              │
    │              │              │ → Eval signal│              │
    │              │              │ → CVO notify │              │
    │              │              │ → broadcast  │              │
    │              │              │              │              │
    │              │◄─────────────┤ BreakerVerdict              │
    │ verdict     │              │              │              │
    │◄─────────────┤              │              │              │
    │ [TRIP] 冻结 TeamAct         │              │              │
    │ [PASS/WARN] 继续            │              │              │
```

#### 时序图 2：CVO 仲裁与 reset 流程

```
CVO                CircuitBreaker      TeamActStateRepo    EventBus
 │                       │                    │                │
 │ 收到 escalation       │                    │                │
 │ (pingpong.tripped)    │                    │                │
 │                       │                    │                │
 │ 仲裁决策:             │                    │                │
 │ - push back 原 owner? │                    │                │
 │ - 换 owner?           │                    │                │
 │ - reset?              │                    │                │
 │                       │                    │                │
 │ [选择 reset]          │                    │                │
 │ reset(team_id,        │                    │                │
 │       cvo_confirmed=  │                    │                │
 │       True)           │                    │                │
 ├──────────────────────►│                    │                │
 │                       │ 校验 cvo_confirmed │                │
 │                       │ = True             │                │
 │                       │ load(state)        │                │
 │                       │ state.reset      │                │
 │                       │ save(state)        │                │
 │                       ├───────────────────►│ unfreeze     │
 │                       │                    │ TeamActState   │
 │                       │                    │ .status=ACTIVE │
 │                       │◄───────────────────┤                │
 │                       │                    │                │
 │                       │ publish("reset")                    │
 │                       ├────────────────────┼───────────────►│
 │                       │                    │                │
 │ reset 完成            │                    │                │
 │◄──────────────────────┤                    │                │
 │                       │                    │                │
 │ TeamAct 可继续推进    │                    │                │
```

### 3.3 错误处理

| 错误场景 | 异常类型 | 处理策略 | 用户感知 |
|---------|---------|---------|---------|
| Forgekin自传（from == to） | `CircuitBreakerError` | Pydantic field_validator 拦截 | TeamAct ROUTE 步重试 |
| record_id 格式错误 | `CircuitBreakerError` | Pydantic model_validator 拦截 | TeamAct 阻塞，告警 CVO |
| status=TRIPPED 但 tripped_at 为空 | `CircuitBreakerError` | model_validator 一致性校验 | 启动失败，数据修复 |
| 熔断触发时 TeamActState 冻结失败 | `TeamActStateError` | trip 抛出，CVO 通知失败重试 | CVO 收到失败告警 |
| reset 时 cvo_confirmed=False | `CvoConfirmationRequired` | 抛出，拒绝 reset | Forgekin收到"需 CVO 确认"提示 |
| reset 时 status != TRIPPED | `CircuitBreakerError` | 抛出，避免误 reset | Forgekin收到"无需 reset"提示 |
| debate_mode 占比超阈值 | （不抛异常） | 记录 warning 日志 + debate_ratio_warning 标记 | Eval 信号记录滥用告警 |
| SQLite 写入失败 | `sqlite3.OperationalError` | 抛出，TeamAct 重试 | TeamAct 标记 FROZEN |
| WAL 文件损坏 | `sqlite3.DatabaseError` | 启动时 checkpoint 失败，回退备份 | 启动失败，运维介入 |
| 多团队并发写入冲突 | `sqlite3.IntegrityError` | PRIMARY KEY 拦截，重试 | 自动重试，无需用户介入 |
| Detector 调用失败 | `DetectorError` | evaluate_pass 抛出，TeamAct 重试 | TeamAct ROUTE 步阻塞 |
| EventBus 广播失败 | `EventBusError` | 不阻塞主流程，记录 warning | 异步重试广播 |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| `evaluate_pass` 延迟（P99） | < 30ms | Detector 内存判定 + SQLite WAL 写入 |
| `should_trip` 延迟 | < 10ms | 单行 SELECT，索引 `PRIMARY KEY(team_id)` |
| `trip` 升级 CVO 延迟 | < 100ms | 异步通知，不阻塞主流程 |
| `reset` 延迟 | < 50ms | 状态重置 + 解冻 + 广播 |
| `list_tripped` 延迟（100 团队） | < 50ms | 索引 `WHERE status = 'tripped'` |
| WAL 重放 100 团队状态 | < 300ms | `wal_checkpoint(FULL)` 一次性合并 |
| Detector 判定 | < 1ms | 内存比较，无 I/O |
| debate_ratio 计算 | < 1ms | 缓存属性，O(1) |
| EventBus 广播 | 异步，不阻塞评估 | `asyncio.create_task` 触发 |

**缓存策略**：
- `PingPongState` 在 evaluate_pass 流程内缓存（单次评估内不重复 load）
- `debate_ratio` 用 `@property` 计算并缓存（Pydantic 模型属性）

**批量优化**：
- `list_tripped` 用于 CVO 仲裁队列，每分钟轮询一次
- `history` 保留最近 20 条 PassRecord，超过自动截断（避免 list 膨胀）
- WAL checkpoint 每 1000 次写入或每 5 分钟触发一次

### 3.5 配置外置示例

```yaml
# flowforge/config/teamact.yaml
pingpong_circuit_breaker:
  # 实质产出判定阈值
  min_output_chars: 200
  min_tool_calls: 1

  # 熔断阈值
  max_empty_passes: 3
  warning_threshold: 2

  # debate_mode 滥用检测
  debate_ratio_threshold: 0.5
  debate_min_sample_size: 5

  # 历史记录
  history_max_size: 20

  # SQLite WAL 配置
  sqlite:
    db_path: "data/flowforge/pingpong.db"
    journal_mode: "WAL"
    synchronous: "NORMAL"
    wal_autocheckpoint: 1000

  # 性能阈值
  performance:
    evaluate_pass_p99_ms: 30
    should_trip_p99_ms: 10
    trip_p99_ms: 100
    reset_p99_ms: 50

  # CVO 升级配置
  cvo_escalation:
    enabled: true
    notification_channel: "cvo_queue"
    auto_reset_after_hours: 24

# 提示词外置
# flowforge/config/teamact_prompts.yaml
pingpong_cvo_escalation:
  escalation_template: |
    🚨 乒乓球熔断触发

    团队: {team_id}
    原因: {reason}
    触发时间: {tripped_at}

    连续空传次数: {consecutive_empty_passes}/{max_empty_passes}
    debate_mode 占比: {debate_ratio:.2%}

    请 CVO 仲裁:
    1. push back 原 owner 重做
    2. 换 owner
    3. reset (cvo_confirmed=True)

    禁止Forgekin自恢复。

  reset_confirmation_template: |
    ✅ 熔断恢复确认

    团队: {team_id}
    CVO 确认: 是
    恢复时间: {reset_at}

    TeamAct 已解冻，可继续推进。
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖调用

#### 4.1.1 A002 TeamAct Loop 调用

```python
# flowforge/loop/teamact_executor.py（A002 实现侧）
from flowforge.core.teamact.circuit_breaker import (
    PassRecord, PingPongCircuitBreaker, BreakerAction, inject,
)

class TeamActLoopExecutor:
    async def _route_step(self, state: TeamActState) -> TeamActState:
        """TeamAct ROUTE 步：传球前评估熔断器"""
        capsule = await self._build_handoff_capsule(state)
        record = PassRecord(
            record_id=self._gen_record_id(state),
            team_id=state.team_id,
            from_forgekin_id=state.current_owner,
            to_forgekin_id=state.next_owner,
            iteration=state.iteration,
            tool_calls=await self._collect_tool_calls(state),
            output_chars=len(capsule.what) + len(capsule.why)
                         + len(capsule.tradeoffs) + len(capsule.next_step),
            evidence_refs=capsule.evidence_refs,
            debate_mode=state.metadata.get("debate_mode", False),
        )

        breaker = inject(PingPongCircuitBreaker)
        verdict = await breaker.evaluate_pass(record)

        if verdict.action == BreakerAction.TRIP:
            return state  # 已冻结，不推进
        elif verdict.action == BreakerAction.WARNING:
            logger.warning("熔断器警告: %s", verdict.reason)

        return state.advance(
            step=TeamActStep.STATE, iteration=state.iteration + 1,
        )
```

#### 4.1.2 A003 Handoff Capsule 调用

```python
# flowforge/core/teamact/handoff.py（D003 已定义）
class HandoffCapsule(BaseModel):
    def has_substantive_output(self, min_chars: int = 200) -> bool:
        """熔断器实质产出判定的输入之一"""
        total = (len(self.what) + len(self.why)
                 + len(self.tradeoffs) + len(self.next_step))
        return total >= min_chars and len(self.evidence_refs) >= 1
```

#### 4.1.3 A009 Evidence & Sensors 调用

```python
# flowforge/core/evidence/store.py（A009 实现侧）
class EvidenceStore(ABC):
    async def collect_tool_calls(self, team_id: str, iteration: int) -> list[str]:
        """收集持球期间的工具调用 ID（熔断器输入）"""
        # 从 ToolRegistry.execute 日志中提取
```

### 4.2 下游影响（被调用）

#### 4.2.1 A002 TeamAct State 冻结

```python
# flowforge/core/teamact/state.py（A002 实现侧）
class TeamActStateRepository(ABC):
    async def freeze(self, team_id: str, reason: str) -> None:
        """冻结 TeamActState（熔断触发时调用）"""
        # state.status = TeamStatus.FROZEN
        # state.frozen_reason = reason
        # 持久化到 Durable Surface

    async def unfreeze(self, team_id: str) -> None:
        """解冻 TeamActState（CVO reset 时调用）"""
```

#### 4.2.2 A006 Ball Custody Lease 联动

```python
# flowforge/core/teamact/lease.py（A006 实现侧）
class BallCustodyLease:
    async def check_lease_output(self, team_id: str) -> bool:
        """lease held 期间是否有实质产出"""
        record = await self._build_lease_pass_record(team_id)
        breaker = inject(PingPongCircuitBreaker)
        verdict = await breaker.evaluate_pass(record)
        return verdict.action != BreakerAction.TRIP
```

#### 4.2.3 A018 Eval Contract 写信号

```python
# flowforge/core/eval/signal_writer.py（A018 实现侧）
class EvalSignalWriter(ABC):
    async def write_signal(
        self,
        signal_type: str,
        team_id: str,
        reason: str,
        timestamp: datetime,
    ) -> None:
        """写 Eval 信号（熔断触发时调用）"""
```

#### 4.2.4 A021 Side Effect WAL 联动

```python
# flowforge/core/reliability/wal.py（A021 实现侧）
class SideEffectWAL:
    async def replay_all(self) -> dict[str, list[Any]]:
        """崩溃恢复时重放所有 WAL"""
        return {
            "pingpong_states": await self._pingpong_store.wal_replay(self._wal_path),
        }
```

#### 4.2.5 A011 Magic Words 逃生舱约束

```python
# flowforge/core/harness/magic_words.py（A011 实现侧）
class MagicWordsEscapeHatch:
    async def operator_pull_breaker(self, team_id: str) -> None:
        """operator 可随时拉闸（绕过熔断器，直接 trip）"""
        breaker = inject(PingPongCircuitBreaker)
        await breaker.trip(team_id, reason="operator_manual_pull")
```

### 4.3 集成测试点

| 测试点 | 测试场景 | 验证内容 | 依赖 |
|--------|---------|---------|------|
| IT-1 | 连续 3 次无实质产出触发熔断 | `consecutive_empty_passes=3`, `status=TRIPPED` | A002 |
| IT-2 | 中间有产出则计数归零 | `consecutive_empty_passes=0` 后再 1 次空传不熔断 | A002 |
| IT-3 | debate_mode 豁免但仍记录 trace | `has_substantive_output=True`, `debate_count+1` | A002 |
| IT-4 | debate_mode 占比超 50% 告警 | `debate_ratio_warning=True` | - |
| IT-5 | 熔断触发后 TeamActState 冻结 | `TeamActState.status=FROZEN` | A002 |
| IT-6 | CVO 确认 reset 后解冻 | `status=OPEN`, `TeamActState.status=ACTIVE` | A002 |
| IT-7 | Forgekin自恢复被拒绝 | `cvo_confirmed=False` 抛 `CvoConfirmationRequired` | - |
| IT-8 | Forgekin自传被拒绝 | `from==to` 抛 `CircuitBreakerError` | - |
| IT-9 | 进程崩溃后 WAL 重放恢复状态 | `wal_replay` 返回完整状态 | A021 |
| IT-10 | PingPong 与 HandoffCapsule 联动 | 胶囊 `has_substantive_output` 影响熔断判定 | A003 |
| IT-11 | Eval 信号写入（熔断触发） | F018 收到 `pingpong.tripped` 信号 | A018 |
| IT-12 | operator 拉闸（绕过熔断器） | Magic Words 直接 trip，不经 evaluate_pass | A011 |
| IT-13 | E2E 真实 LLM 协作场景 | 3 个不同厂商Forgekin协作，验证熔断器不误杀合理 debate | T1-T8 |

---

## 5. 详细设计验收

### 5.1 功能验收（AC）

- [ ] **AC-1**: `PassRecord` Forgekin自传（`from == to`）时构造抛 `CircuitBreakerError`
- [ ] **AC-2**: `record_id` 格式 `pass-{team_id}-{iteration}-{hash8}` 校验
- [ ] **AC-3**: `PingPongCircuitBreaker` 通过 DI 容器注入，无直接实例化
- [ ] **AC-4**: 熔断状态持久化通过 Repository 层（`PingPongStateStore` ABC），无 `cursor.execute`
- [ ] **AC-5**: `max_empty_passes` / `min_output_chars` / `min_tool_calls` / `debate_ratio_threshold` 外置到 `flowforge/config/teamact.yaml`
- [ ] **AC-6**: 实质产出判定基于 `tool_calls >= 1 OR output_chars >= 200`，禁Forgekin自评
- [ ] **AC-7**: 连续空传计数达 `max_empty_passes`（默认 3）触发熔断，禁配置关闭
- [ ] **AC-8**: 有实质产出时计数归零（非递减）
- [ ] **AC-9**: `debate_mode=true` 时豁免（`has_substantive_output=True`），但 `debate_count+1` 仍记录
- [ ] **AC-10**: `debate_ratio > 0.5` 时 `debate_ratio_warning=True`（滥用告警）
- [ ] **AC-11**: 熔断触发后 `TeamActState.status=FROZEN`，禁继续推进
- [ ] **AC-12**: 熔断触发写 Eval 信号 + 升级 CVO + 通知 reviewer + 广播事件
- [ ] **AC-13**: `reset(team_id, cvo_confirmed=False)` 抛 `CvoConfirmationRequired`
- [ ] **AC-14**: `reset(team_id, cvo_confirmed=True)` 后 `status=OPEN`，`TeamActState.status=ACTIVE`
- [ ] **AC-15**: `reset` 时 `status != TRIPPED` 抛 `CircuitBreakerError`（避免误 reset）
- [ ] **AC-16**: `status=TRIPPED` 时 `tripped_at` 与 `tripped_reason` 必须非空（model_validator）
- [ ] **AC-17**: 多团队并发场景下状态隔离（每个 `team_id` 独立 `PingPongState`）
- [ ] **AC-18**: operator 可通过 Magic Words 直接拉闸（绕过 evaluate_pass）

### 5.2 性能验收

- [ ] **AC-19**: `evaluate_pass` 延迟 P99 < 30ms
- [ ] **AC-20**: `should_trip` 延迟 < 10ms
- [ ] **AC-21**: `trip` 升级 CVO 延迟 < 100ms（异步通知）
- [ ] **AC-22**: `reset` 延迟 < 50ms
- [ ] **AC-23**: `list_tripped` 延迟（100 团队） < 50ms
- [ ] **AC-24**: WAL 重放 100 团队状态 < 300ms
- [ ] **AC-25**: Detector 判定 < 1ms

### 5.3 安全验收

- [ ] **AC-26**: `flowforge/core/teamact/circuit_breaker.py` 不 import forgemind 或 *Forge 模块（单向依赖）
- [ ] **AC-27**: 熔断状态持久化通过 Repository 层，业务代码无 `cursor.execute`
- [ ] **AC-28**: `cvo_confirmed` 参数必须为 True 才能 reset（防Forgekin自恢复）
- [ ] **AC-29**: SQLite 连接使用参数化查询（防 SQL 注入）
- [ ] **AC-30**: `record_id` 生成包含 hash8 防碰撞（SHA256 前 8 位）
- [ ] **AC-31**: 熔断触发事件广播到 EventBus，Eval 控制面可感知

### 5.4 Eval 验收

- [ ] **AC-32**: 熔断触发频率 < 5%（健康团队，Eval 信号采样）
- [ ] **AC-33**: 熔断恢复后 24 小时内不重复触发（避免反复熔断）
- [ ] **AC-34**: debate_mode 滥用告警率 < 10%（Eval 信号采样）
- [ ] **AC-35**: CVO 仲裁平均响应时间 < 30 分钟（Eval 信号采样）
- [ ] **AC-36**: E2E 测试（T1-T8 铁律）：3 个不同厂商Forgekin协作，验证熔断器不误杀合理 debate（5 轮内收敛），LLM 生成内容经 LLM 审核

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-018 乒乓球熔断器）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，乒乓球熔断器）
- [doc:../features/F004-pingpong-circuit-breaker.md]（同号 Feature 级 SRS）
- [doc:../architecture/A004-pingpong-circuit-breaker.md]（同号 Feature 级 SAD）
- [doc:../features/F002-teamact-loop.md]（TeamAct ACTION/ROUTE 步触发判定）
- [doc:../architecture/A002-teamact-loop.md]（TeamAct 状态机冻结）
- [doc:../features/F003-handoff-capsule.md]（has_substantive_output 判定依据）
- [doc:../design/D003-handoff-capsule.md]（胶囊 has_substantive_output 实现）
- [doc:../features/F006-ball-custody-lease.md]（lease 期间空传联动）
- [doc:../features/F009-evidence-sensors.md]（工具调用与产出字符证据源）
- [doc:../architecture/A018-eval-contract.md]（Eval 信号写入）
- [doc:../architecture/A021-side-effect-wal.md]（WAL 可重放联动）
- [doc:../features/F011-magic-words.md]（operator 拉闸逃生舱）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../design/naming-contract.md#2.2]（Forgekin Forgekin 双轨命名）
- [doc:../design/D001-capability-profile.md]（CapabilityProfile 详细设计）
- [doc:../design/D002-teamact-loop.md]（TeamAct 详细设计，ROUTE 步触发）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）
- [doc:../../../hiclaw/rules.md#红线12]（禁绕过 DI 容器）
- [doc:../../../hiclaw/rules.md#红线13]（禁直接操作数据库）
- [doc:../../../hiclaw/rules.md#T1-T8]（测试铁律）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F004 Feature 级 SRS + A004 架构级 SAD） | 开发者 Forgekin（猎犬·夏洛克） |

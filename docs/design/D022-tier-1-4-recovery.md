# D022: Tier 1-4 恢复分级详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]
> **对应 Feature**: [doc:../features/F022-tier-1-4-recovery.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A022-tier-1-4-recovery.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

分布式可靠性（§3.6）的恢复分级子系统需要将故障按严重度分为 5 个 Tier，A022 架构设计已确认五级分层：
1. **Tier 0**：可忽略故障（瞬时抖动），无需恢复
2. **Tier 1**：可重放故障（WAL 回放即可恢复）
3. **Tier 2**：需探测后重放（先探测系统状态，再决定是否回放）
4. **Tier 3**：需恢复卡（用户介入 + Magic Words 触发的恢复卡）
5. **Tier 4**：不可恢复故障（硬拒，需人工介入或重启）

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **Tier 分类决策树**：如何根据故障信号（异常类型 / 失败次数 / 副作用类型）决策 Tier 级别。
2. **Tier 0/4 硬拒实现**：Tier 0 不需恢复（直接返回），Tier 4 不可恢复（硬拒，需人工介入）。
3. **Tier 2 探测后重放**：探测系统状态（liveness / 一致性 / WAL 完整性），探测通过后才回放。
4. **Tier 3 恢复卡**：恢复卡是 Magic Words 触发的交互式恢复，需 F011 Magic Words 守护。
5. **Magic Words 守护集成**：F011 Magic Words 守护器如何嵌入 Tier 分类流程，识别 magic words 触发恢复卡。
6. **恢复动作的幂等**：同一故障多次触发恢复时如何幂等（避免重复恢复造成副作用放大）。
7. **跨 Tier 升级**：Tier 1 恢复失败后是否自动升级到 Tier 2/3，升级策略如何配置。
8. **恢复历史与归因**：每次恢复必须记录到历史，供 F020 归因使用。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/reliability/recovery/` 禁止 import F025/F040 任何模块（编程红线第 10 条延伸）。F025 通过 EventBus 接收恢复请求。
- **DI 容器约束**：`RecoveryExecutor` 通过 DI 容器注入，绑定生命周期为 `singleton`，禁止直接实例化（编程红线第 12 条）。
- **Repository 层约束**：恢复历史持久化必须经 `RecoveryRepository` 抽象，禁止直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：Tier 分类规则 / 升级策略 / Magic Words 列表 / 探测超时外置 YAML（编程红线第 11 条）。
- **Tier 0/4 硬拒约束**：Tier 0 直接返回（无恢复动作），Tier 4 硬拒（不可自动恢复）。
- **幂等约束**：同一故障（按 idempotency_key）多次触发恢复时仅执行一次。
- **Magic Words 守护约束**：Tier 3 恢复卡必须由 F011 Magic Words 守护器识别 magic words 触发。
- **异步约束**：所有 I/O 操作使用 `async/await`，恢复主流程同步执行（决策树需顺序判定）。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。
- **提示词外置约束**：恢复卡提示词外置到 `config/recovery/prompts.yaml`（编程红线第 11 条 + P16）。

### 1.3 设计影响

- **对 F021 副作用 WAL**：Tier 1/2 通过 `WalReplayer.replay` 回放未确认 entry。本设计需调用 F021 接口。
- **对 F023 liveness 规范读**：Tier 2 探测阶段调用 F023 `CanonicalReadModel.canonical_read` 获取系统真实状态。本设计需调用 F023 接口。
- **对 F024 强 workflow**：强 workflow 的 rejectable 步骤对应 Tier 0/4，replayable 步骤对应 Tier 1/2。本设计需调用 F024 接口。
- **对 F025 跨 provider 宿主抽象**：provider 故障触发 Tier 4 provider failover。本设计需调用 F025 接口。
- **对 F011 Magic Words**：Tier 3 恢复卡由 F011 Magic Words 守护器识别触发。本设计需嵌入 F011 守护器。
- **对 F020 七类归因**：恢复历史记录写入 F020 归因器的输入。本设计需派发 `recovery.completed` 事件。
- **对 F040 控制面**：所有恢复动作写入 F040 Eval Hub。本设计需派发恢复事件。
- **对 Forgekin.act**：Forgekin 执行失败时调用 `RecoveryExecutor.recover` 触发恢复。
- **对 DI 容器**：需新增 `tier_classifier` / `recovery_executor` / `magic_words_guard` / `recovery_repository` 四个绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     <<module>> reliability.recovery                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  <<enum>> RecoveryTier (固定 5 级)                                          │
│  + TIER_0_IGNORE           可忽略                                          │
│  + TIER_1_REPLAY            可重放                                          │
│  + TIER_2_PROBE_THEN_REPLAY 探测后重放                                      │
│  + TIER_3_RECOVERY_CARD     恢复卡                                          │
│  + TIER_4_HARD_REJECT       硬拒                                            │
│                                                                            │
│  <<enum>> RecoveryAction                                                    │
│  + NO_OP                   无动作（Tier 0）                                │
│  + WAL_REPLAY              WAL 回放（Tier 1/2）                             │
│  + RECOVERY_CARD           恢复卡（Tier 3）                                 │
│  + HARD_REJECT             硬拒（Tier 4）                                  │
│                                                                            │
│  <<model>> RecoveryDecision                                                 │
│  + decision_id: str                                                       │
│  + fault_id: str                                                          │
│  + tier: RecoveryTier                                                     │
│  + action: RecoveryAction                                                  │
│  + reason: str                                                            │
│  + evidence: list[str]                                                    │
│  + decided_at: datetime                                                   │
│                                                                            │
│  <<model>> RecoveryCard                                                    │
│  + card_id: str                                                            │
│  + forgekin_id: str                                                       │
│  + fault_id: str                                                          │
│  + magic_word: str                                                        │
│  + user_input: Optional[str]                                               │
│  + status: str  # pending / approved / rejected / executed                 │
│  + created_at: datetime                                                   │
│  + resolved_at: Optional[datetime]                                         │
│                                                                            │
│  <<model>> RecoveryRecord                                                  │
│  + record_id: str                                                         │
│  + fault_id: str                                                          │
│  + tier: RecoveryTier                                                     │
│  + action: RecoveryAction                                                  │
│  + outcome: str  # success / failed / escalated / skipped                 │
│  + idempotency_key: str                                                   │
│  + started_at: datetime                                                   │
│  + completed_at: Optional[datetime]                                       │
│  + error: Optional[str]                                                   │
│                                                                            │
│  <<interface>> TierClassifier (ABC)                                        │
│  + classify(fault) -> RecoveryDecision                                    │
│                                                                            │
│  <<interface>> RecoveryExecutor (ABC)                                     │
│  + recover(fault) -> RecoveryRecord                                       │
│  + execute_tier_0(fault) -> RecoveryRecord                                │
│  + execute_tier_1(fault) -> RecoveryRecord                                │
│  + execute_tier_2(fault) -> RecoveryRecord                                │
│  + execute_tier_3(fault) -> RecoveryRecord                                │
│  + execute_tier_4(fault) -> RecoveryRecord                                │
│  + escalate(fault, from_tier) -> RecoveryRecord                           │
│                                                                            │
│  <<interface>> MagicWordsGuard (ABC)                                       │
│  + detect_magic_word(input) -> Optional[str]                              │
│  + create_recovery_card(forgekin_id, fault, magic_word) -> RecoveryCard    │
│  + await_user_decision(card_id, timeout) -> str                            │
│                                                                            │
│  <<interface>> RecoveryRepository (ABC)                                    │
│  + insert_record(record) -> str                                            │
│  + query_by_fault(fault_id) -> list[RecoveryRecord]                       │
│  + query_by_idempotency(key) -> Optional[RecoveryRecord]                  │
│  + insert_card(card) -> str                                               │
│  + update_card_status(card_id, status) -> None                            │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/reliability/recovery/models.py
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from enum import Enum


class RecoveryTier(str, Enum):
    TIER_0_IGNORE = "tier_0_ignore"
    TIER_1_REPLAY = "tier_1_replay"
    TIER_2_PROBE_THEN_REPLAY = "tier_2_probe_then_replay"
    TIER_3_RECOVERY_CARD = "tier_3_recovery_card"
    TIER_4_HARD_REJECT = "tier_4_hard_reject"


class RecoveryAction(str, Enum):
    NO_OP = "no_op"
    WAL_REPLAY = "wal_replay"
    RECOVERY_CARD = "recovery_card"
    HARD_REJECT = "hard_reject"


class FaultSignal(BaseModel):
    """故障信号"""
    model_config = ConfigDict(frozen=True)

    fault_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    fault_type: str = Field(min_length=1)  # exception class name
    failure_count: int = Field(ge=1)
    last_error: str
    wal_entry_id: Optional[str] = None
    workflow_id: Optional[str] = None
    occurred_at: datetime
    context_uri: str = Field(min_length=1)


class RecoveryDecision(BaseModel):
    """恢复决策"""
    model_config = ConfigDict(frozen=True)

    decision_id: str = Field(min_length=1)
    fault_id: str = Field(min_length=1)
    tier: RecoveryTier
    action: RecoveryAction
    reason: str
    evidence: list[str] = Field(default_factory=list)
    decided_at: datetime


class RecoveryCard(BaseModel):
    """恢复卡（Tier 3）"""
    model_config = ConfigDict(frozen=True)

    card_id: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)
    fault_id: str = Field(min_length=1)
    magic_word: str = Field(min_length=1)
    user_input: Optional[str] = None
    status: str = "pending"  # pending / approved / rejected / executed
    created_at: datetime
    resolved_at: Optional[datetime] = None


class RecoveryRecord(BaseModel):
    """恢复记录"""
    model_config = ConfigDict(frozen=True)

    record_id: str = Field(min_length=1)
    fault_id: str = Field(min_length=1)
    tier: RecoveryTier
    action: RecoveryAction
    outcome: str  # success / failed / escalated / skipped
    idempotency_key: str = Field(min_length=1)
    started_at: datetime
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


# flowforge/core/reliability/recovery/interfaces.py
from abc import ABC, abstractmethod
from typing import Optional


class TierClassifier(ABC):
    """Tier 分类器"""

    @abstractmethod
    async def classify(self, fault: FaultSignal) -> RecoveryDecision:
        """
        Tier 分类决策树：
        1. 检查故障类型是否在 ignore_list（Tier 0）
        2. 检查 wal_entry_id 是否存在 + 可重放（Tier 1）
        3. 检查 magic_word 是否触发（Tier 3）
        4. 检查 failure_count >= hard_reject_threshold（Tier 4）
        5. 默认 Tier 2（探测后重放）
        """


class RecoveryExecutor(ABC):
    """恢复执行器"""

    @abstractmethod
    async def recover(self, fault: FaultSignal) -> RecoveryRecord:
        """
        恢复主流程：
        1. tier_classifier.classify(fault)
        2. 按 tier 分发到 execute_tier_X
        3. 失败时 escalate(fault, from_tier)
        4. 持久化到 Repository
        5. 派发 recovery.completed 事件
        """

    @abstractmethod
    async def execute_tier_0(self, fault: FaultSignal) -> RecoveryRecord: ...

    @abstractmethod
    async def execute_tier_1(self, fault: FaultSignal) -> RecoveryRecord: ...

    @abstractmethod
    async def execute_tier_2(self, fault: FaultSignal) -> RecoveryRecord: ...

    @abstractmethod
    async def execute_tier_3(self, fault: FaultSignal) -> RecoveryRecord: ...

    @abstractmethod
    async def execute_tier_4(self, fault: FaultSignal) -> RecoveryRecord: ...

    @abstractmethod
    async def escalate(
        self, fault: FaultSignal, from_tier: RecoveryTier
    ) -> RecoveryRecord:
        """跨 Tier 升级：from_tier 恢复失败后升级到 from_tier + 1"""


class MagicWordsGuard(ABC):
    """Magic Words 守护器"""

    @abstractmethod
    def detect_magic_word(self, user_input: str) -> Optional[str]:
        """检测用户输入中的 magic word"""

    @abstractmethod
    async def create_recovery_card(
        self, forgekin_id: str, fault: FaultSignal, magic_word: str
    ) -> RecoveryCard:
        """创建恢复卡"""

    @abstractmethod
    async def await_user_decision(
        self, card_id: str, timeout_seconds: int
    ) -> str:
        """等待用户决策：approved / rejected / timeout"""


class RecoveryRepository(ABC):
    """恢复历史 Repository"""

    @abstractmethod
    async def insert_record(self, record: RecoveryRecord) -> str: ...

    @abstractmethod
    async def query_by_fault(self, fault_id: str) -> list[RecoveryRecord]: ...

    @abstractmethod
    async def query_by_idempotency(
        self, key: str
    ) -> Optional[RecoveryRecord]: ...

    @abstractmethod
    async def insert_card(self, card: RecoveryCard) -> str: ...

    @abstractmethod
    async def update_card_status(self, card_id: str, status: str) -> None: ...
```

### 2.3 数据结构 Pydantic Models（配置）

```python
# flowforge/core/reliability/recovery/config.py
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class TierClassificationRule(BaseModel):
    """Tier 分类规则"""
    tier: str  # RecoveryTier value
    fault_type_patterns: list[str] = Field(default_factory=list)  # 正则匹配 fault_type
    failure_count_max: Optional[int] = None  # 失败次数上限
    failure_count_min: Optional[int] = None
    requires_wal_entry: bool = False
    requires_magic_word: bool = False
    priority: int  # 优先级（数字小先匹配）


class EscalationRule(BaseModel):
    """跨 Tier 升级规则"""
    from_tier: str
    to_tier: str
    max_retries: int = Field(default=1, ge=1, le=3)


class MagicWordsConfig(BaseModel):
    """Magic Words 配置"""
    enabled: bool = True
    magic_words: list[str] = Field(min_length=1)
    card_timeout_seconds: int = Field(default=300, ge=30, le=3600)
    prompts_uri: str = Field(min_length=1)


class RecoveryConfig(BaseModel):
    """YAML 配置加载结果"""
    classification_rules: list[TierClassificationRule] = Field(min_length=5)
    escalation_rules: list[EscalationRule] = Field(default_factory=list)
    magic_words: MagicWordsConfig
    probe_timeout_seconds: int = Field(default=30, ge=5, le=120)
    wal_replay_batch_size: int = Field(default=100, ge=1, le=1000)
    max_recovery_attempts: int = Field(default=3, ge=1, le=10)

    @model_validator(mode="after")
    def _validate_classification_rules(self) -> "RecoveryConfig":
        # 必须覆盖全部 5 个 Tier
        tiers_in_rules = {r.tier for r in self.classification_rules}
        expected = {
            "tier_0_ignore", "tier_1_replay", "tier_2_probe_then_replay",
            "tier_3_recovery_card", "tier_4_hard_reject",
        }
        if tiers_in_rules != expected:
            raise ValueError(
                f"classification_rules must cover all 5 tiers, "
                f"missing: {expected - tiers_in_rules}"
            )
        # 升级规则必须按 from_tier 排序
        if self.escalation_rules:
            escalations = {r.from_tier for r in self.escalation_rules}
            expected_escalations = {
                "tier_0_ignore", "tier_1_replay",
                "tier_2_probe_then_replay", "tier_3_recovery_card",
            }  # tier_4_hard_reject 不可升级
            if not escalations.issubset(expected_escalations):
                raise ValueError(
                    f"escalation_rules from_tier must be in {expected_escalations}, "
                    f"got {escalations}"
                )
        return self
```

### 2.4 关键算法伪代码

#### 2.4.1 Tier 分类决策树

```
function classify(fault: FaultSignal) -> RecoveryDecision:

    # 按优先级排序规则
    sorted_rules = sorted(config.classification_rules, key=lambda r: r.priority)

    for rule in sorted_rules:
        if matches(fault, rule):
            return RecoveryDecision(
                decision_id=uuid_v7,
                fault_id=fault.fault_id,
                tier=RecoveryTier(rule.tier),
                action=map_tier_to_action(rule.tier),
                reason=f"matched rule priority={rule.priority}",
                evidence=collect_evidence(fault, rule),
                decided_at=now,
            )

    # 默认 Tier 2（探测后重放）
    return RecoveryDecision(
        decision_id=uuid_v7,
        fault_id=fault.fault_id,
        tier=RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
        action=RecoveryAction.WAL_REPLAY,
        reason="default: no specific rule matched",
        evidence=["fallback to tier_2"],
        decided_at=now,
    )


function matches(fault: FaultSignal, rule: TierClassificationRule) -> bool:

    # 1. fault_type 模式匹配
    if rule.fault_type_patterns:
        if not any(re.match(p, fault.fault_type) for p in rule.fault_type_patterns):
            return False

    # 2. 失败次数检查
    if rule.failure_count_min is not None:
        if fault.failure_count < rule.failure_count_min:
            return False
    if rule.failure_count_max is not None:
        if fault.failure_count > rule.failure_count_max:
            return False

    # 3. WAL entry 检查
    if rule.requires_wal_entry and not fault.wal_entry_id:
        return False

    # 4. magic word 检查（由 MagicWordsGuard 调用方提供）
    if rule.requires_magic_word:
        # 该规则需配合 MagicWordsGuard 使用
        pass

    return True


function map_tier_to_action(tier: str) -> RecoveryAction:
    return {
        "tier_0_ignore": RecoveryAction.NO_OP,
        "tier_1_replay": RecoveryAction.WAL_REPLAY,
        "tier_2_probe_then_replay": RecoveryAction.WAL_REPLAY,
        "tier_3_recovery_card": RecoveryAction.RECOVERY_CARD,
        "tier_4_hard_reject": RecoveryAction.HARD_REJECT,
    }[tier]
```

#### 2.4.2 Tier 0/4 硬拒算法

```
function execute_tier_0(fault: FaultSignal) -> RecoveryRecord:
    # Tier 0: 无动作，直接返回
    record = RecoveryRecord(
        record_id=uuid_v7,
        fault_id=fault.fault_id,
        tier=RecoveryTier.TIER_0_IGNORE,
        action=RecoveryAction.NO_OP,
        outcome="skipped",
        idempotency_key=f"recovery:{fault.fault_id}:tier_0",
        started_at=now,
        completed_at=now,
    )
    await repository.insert_record(record)
    return record


function execute_tier_4(fault: FaultSignal) -> RecoveryRecord:
    # Tier 4: 硬拒，不可自动恢复
    record = RecoveryRecord(
        record_id=uuid_v7,
        fault_id=fault.fault_id,
        tier=RecoveryTier.TIER_4_HARD_REJECT,
        action=RecoveryAction.HARD_REJECT,
        outcome="failed",
        idempotency_key=f"recovery:{fault.fault_id}:tier_4",
        started_at=now,
        completed_at=now,
        error=f"hard reject: fault_type={fault.fault_type} "
              f"failure_count={fault.failure_count}",
    )
    await repository.insert_record(record)
    # 告警 F040 控制面
    await event_bus.publish(
        topic="recovery.hard_rejected",
        payload=record.model_dump,
    )
    return record
```

#### 2.4.3 Tier 2 探测后重放算法

```
function execute_tier_2(fault: FaultSignal) -> RecoveryRecord:

    record = RecoveryRecord(
        record_id=uuid_v7,
        fault_id=fault.fault_id,
        tier=RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
        action=RecoveryAction.WAL_REPLAY,
        outcome="success",  # 默认成功，失败时覆盖
        idempotency_key=f"recovery:{fault.fault_id}:tier_2",
        started_at=now,
    )

    try:
        # 1. 探测系统状态（liveness / 一致性 / WAL 完整性）
        liveness = await canonical_read_model.canonical_read(
            forgekin_id=fault.forgekin_id
        )
        if liveness.state == "zombie":
            record = record.model_copy(update={
                "outcome": "failed",
                "error": "probe: liveness zombie detected",
            })
            await repository.insert_record(record)
            return record

        # 2. 检查 WAL 完整性
        wal_pending = await wal_repository.query_pending(since_ts=fault.occurred_at)
        if not wal_pending:
            record = record.model_copy(update={
                "outcome": "skipped",
                "error": "probe: no pending WAL entries",
            })
            await repository.insert_record(record)
            return record

        # 3. 探测通过后回放 WAL
        replayed = await wal_replayer.replay(since_ts=fault.occurred_at)
        record = record.model_copy(update={
            "completed_at": now,
            "error": f"replayed {replayed} entries",
        })

    except Exception as e:
        record = record.model_copy(update={
            "outcome": "failed",
            "completed_at": now,
            "error": str(e),
        })

    await repository.insert_record(record)
    return record
```

#### 2.4.4 Tier 3 恢复卡算法

```
function execute_tier_3(fault: FaultSignal) -> RecoveryRecord:

    # 1. 检测 magic word（由调用方传入或从最近用户输入读取）
    user_input = await get_recent_user_input(fault.forgekin_id)
    magic_word = magic_words_guard.detect_magic_word(user_input)

    if magic_word is None:
        # 无 magic word，无法创建恢复卡，升级到 Tier 4
        return await escalate(fault, RecoveryTier.TIER_3_RECOVERY_CARD)

    # 2. 创建恢复卡
    card = await magic_words_guard.create_recovery_card(
        forgekin_id=fault.forgekin_id,
        fault=fault,
        magic_word=magic_word,
    )

    # 3. 等待用户决策
    decision = await magic_words_guard.await_user_decision(
        card.card_id,
        timeout_seconds=config.magic_words.card_timeout_seconds,
    )

    record = RecoveryRecord(
        record_id=uuid_v7,
        fault_id=fault.fault_id,
        tier=RecoveryTier.TIER_3_RECOVERY_CARD,
        action=RecoveryAction.RECOVERY_CARD,
        outcome="success" if decision == "approved" else "failed",
        idempotency_key=f"recovery:{fault.fault_id}:tier_3:{card.card_id}",
        started_at=now,
        completed_at=now,
        error=f"user_decision={decision}",
    )

    if decision == "approved":
        # 用户批准后执行恢复动作（如 WAL 回放）
        await wal_replayer.replay(since_ts=fault.occurred_at)

    await repository.insert_record(record)
    return record
```

#### 2.4.5 跨 Tier 升级算法

```
function escalate(
    fault: FaultSignal, from_tier: RecoveryTier
) -> RecoveryRecord:

    # Tier 4 不可升级
    if from_tier == RecoveryTier.TIER_4_HARD_REJECT:
        raise ValueError("cannot escalate from tier_4")

    # 查找升级规则
    rule = find_escalation_rule(from_tier, config.escalation_rules)
    if rule is None:
        # 默认升级到下一级
        next_tier = next_tier_of(from_tier)
    else:
        next_tier = RecoveryTier(rule.to_tier)

    logger.warning(
        f"escalate fault {fault.fault_id} from {from_tier.value} "
        f"to {next_tier.value}"
    )

    # 递归调用 recover，但跳过 from_tier（避免循环）
    new_fault = fault.model_copy(update={
        "failure_count": fault.failure_count + 1,
    })

    # 按 next_tier 分发
    if next_tier == RecoveryTier.TIER_0_IGNORE:
        return await execute_tier_0(new_fault)
    elif next_tier == RecoveryTier.TIER_1_REPLAY:
        return await execute_tier_1(new_fault)
    elif next_tier == RecoveryTier.TIER_2_PROBE_THEN_REPLAY:
        return await execute_tier_2(new_fault)
    elif next_tier == RecoveryTier.TIER_3_RECOVERY_CARD:
        return await execute_tier_3(new_fault)
    elif next_tier == RecoveryTier.TIER_4_HARD_REJECT:
        return await execute_tier_4(new_fault)
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/reliability/recovery/executor.py
from __future__ import annotations
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from .models import (
    RecoveryTier, RecoveryAction, FaultSignal,
    RecoveryDecision, RecoveryRecord, RecoveryCard,
)
from .interfaces import (
    TierClassifier, RecoveryExecutor, MagicWordsGuard, RecoveryRepository,
)
from .config import RecoveryConfig
from ...core.events.event_bus import EventBus
from ...core.reliability.wal.interfaces import WalReplayer, WalRepository
from ...core.reliability.liveness.interfaces import CanonicalReadModel

logger = logging.getLogger(__name__)


class RecoveryExecutionError(Exception):
    """恢复执行失败"""
    pass


class EscalationLoopError(Exception):
    """升级循环"""
    pass


TIER_NEXT = {
    RecoveryTier.TIER_0_IGNORE: RecoveryTier.TIER_1_REPLAY,
    RecoveryTier.TIER_1_REPLAY: RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
    RecoveryTier.TIER_2_PROBE_THEN_REPLAY: RecoveryTier.TIER_3_RECOVERY_CARD,
    RecoveryTier.TIER_3_RECOVERY_CARD: RecoveryTier.TIER_4_HARD_REJECT,
}


class DefaultTierClassifier(TierClassifier):
    """Tier 分类器默认实现"""

    def __init__(self, config: RecoveryConfig):
        self._cfg = config

    async def classify(self, fault: FaultSignal) -> RecoveryDecision:
        sorted_rules = sorted(self._cfg.classification_rules, key=lambda r: r.priority)
        for rule in sorted_rules:
            if self._matches(fault, rule):
                return RecoveryDecision(
                    decision_id=str(uuid.uuid1),
                    fault_id=fault.fault_id,
                    tier=RecoveryTier(rule.tier),
                    action=self._map_tier_to_action(rule.tier),
                    reason=f"matched rule priority={rule.priority}",
                    evidence=[f"rule.tier={rule.tier}", f"fault.type={fault.fault_type}"],
                    decided_at=datetime.now(timezone.utc),
                )
        # 默认 Tier 2
        return RecoveryDecision(
            decision_id=str(uuid.uuid1),
            fault_id=fault.fault_id,
            tier=RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
            action=RecoveryAction.WAL_REPLAY,
            reason="default: no specific rule matched",
            evidence=["fallback to tier_2"],
            decided_at=datetime.now(timezone.utc),
        )

    def _matches(self, fault: FaultSignal, rule) -> bool:
        import re
        if rule.fault_type_patterns:
            if not any(re.match(p, fault.fault_type) for p in rule.fault_type_patterns):
                return False
        if rule.failure_count_min is not None and fault.failure_count < rule.failure_count_min:
            return False
        if rule.failure_count_max is not None and fault.failure_count > rule.failure_count_max:
            return False
        if rule.requires_wal_entry and not fault.wal_entry_id:
            return False
        return True

    def _map_tier_to_action(self, tier: str) -> RecoveryAction:
        return {
            "tier_0_ignore": RecoveryAction.NO_OP,
            "tier_1_replay": RecoveryAction.WAL_REPLAY,
            "tier_2_probe_then_replay": RecoveryAction.WAL_REPLAY,
            "tier_3_recovery_card": RecoveryAction.RECOVERY_CARD,
            "tier_4_hard_reject": RecoveryAction.HARD_REJECT,
        }[tier]


class DefaultRecoveryExecutor(RecoveryExecutor):
    """恢复执行器默认实现"""

    def __init__(
        self,
        classifier: TierClassifier,
        magic_words_guard: MagicWordsGuard,
        repository: RecoveryRepository,
        event_bus: EventBus,
        wal_replayer: WalReplayer,
        wal_repository: WalRepository,
        canonical_read_model: CanonicalReadModel,
        config: RecoveryConfig,
    ):
        self._classifier = classifier
        self._guard = magic_words_guard
        self._repo = repository
        self._bus = event_bus
        self._wal_replayer = wal_replayer
        self._wal_repo = wal_repository
        self._canonical = canonical_read_model
        self._cfg = config

    async def recover(self, fault: FaultSignal) -> RecoveryRecord:
        # 幂等去重
        idempotency_key = f"recovery:{fault.fault_id}"
        existing = await self._repo.query_by_idempotency(idempotency_key)
        if existing is not None:
            logger.info(f"recovery already executed for fault {fault.fault_id}")
            return existing

        # 1. Tier 分类
        decision = await self._classifier.classify(fault)
        logger.info(
            f"recover fault={fault.fault_id} tier={decision.tier.value} "
            f"action={decision.action.value}"
        )

        # 2. 分发到对应 execute_tier_X
        dispatch = {
            RecoveryTier.TIER_0_IGNORE: self.execute_tier_0,
            RecoveryTier.TIER_1_REPLAY: self.execute_tier_1,
            RecoveryTier.TIER_2_PROBE_THEN_REPLAY: self.execute_tier_2,
            RecoveryTier.TIER_3_RECOVERY_CARD: self.execute_tier_3,
            RecoveryTier.TIER_4_HARD_REJECT: self.execute_tier_4,
        }
        handler = dispatch[decision.tier]
        record = await handler(fault)

        # 3. 失败时升级
        if record.outcome == "failed" and decision.tier != RecoveryTier.TIER_4_HARD_REJECT:
            try:
                record = await self.escalate(fault, decision.tier)
            except EscalationLoopError as e:
                logger.error(f"escalation loop: {e}")
                record = record.model_copy(update={
                    "error": f"escalation loop: {e}",
                })

        # 4. 派发事件
        await self._bus.publish(
            topic="recovery.completed",
            payload=record.model_dump,
        )
        return record

    async def execute_tier_0(self, fault: FaultSignal) -> RecoveryRecord:
        now = datetime.now(timezone.utc)
        record = RecoveryRecord(
            record_id=str(uuid.uuid1),
            fault_id=fault.fault_id,
            tier=RecoveryTier.TIER_0_IGNORE,
            action=RecoveryAction.NO_OP,
            outcome="skipped",
            idempotency_key=f"recovery:{fault.fault_id}:tier_0",
            started_at=now,
            completed_at=now,
        )
        await self._repo.insert_record(record)
        return record

    async def execute_tier_1(self, fault: FaultSignal) -> RecoveryRecord:
        started = datetime.now(timezone.utc)
        try:
            replayed = await self._wal_replayer.replay(since_ts=fault.occurred_at)
            record = RecoveryRecord(
                record_id=str(uuid.uuid1),
                fault_id=fault.fault_id,
                tier=RecoveryTier.TIER_1_REPLAY,
                action=RecoveryAction.WAL_REPLAY,
                outcome="success",
                idempotency_key=f"recovery:{fault.fault_id}:tier_1",
                started_at=started,
                completed_at=datetime.now(timezone.utc),
                error=f"replayed {replayed} entries",
            )
        except Exception as e:
            record = RecoveryRecord(
                record_id=str(uuid.uuid1),
                fault_id=fault.fault_id,
                tier=RecoveryTier.TIER_1_REPLAY,
                action=RecoveryAction.WAL_REPLAY,
                outcome="failed",
                idempotency_key=f"recovery:{fault.fault_id}:tier_1",
                started_at=started,
                completed_at=datetime.now(timezone.utc),
                error=str(e),
            )
        await self._repo.insert_record(record)
        return record

    async def execute_tier_2(self, fault: FaultSignal) -> RecoveryRecord:
        started = datetime.now(timezone.utc)
        try:
            # 1. 探测 liveness
            liveness = await self._canonical.canonical_read(
                forgekin_id=fault.forgekin_id
            )
            if liveness.state == "zombie":
                record = RecoveryRecord(
                    record_id=str(uuid.uuid1),
                    fault_id=fault.fault_id,
                    tier=RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
                    action=RecoveryAction.WAL_REPLAY,
                    outcome="failed",
                    idempotency_key=f"recovery:{fault.fault_id}:tier_2",
                    started_at=started,
                    completed_at=datetime.now(timezone.utc),
                    error="probe: liveness zombie detected",
                )
                await self._repo.insert_record(record)
                return record

            # 2. WAL 完整性检查
            wal_pending = await self._wal_repo.query_pending(since_ts=fault.occurred_at)
            if not wal_pending:
                record = RecoveryRecord(
                    record_id=str(uuid.uuid1),
                    fault_id=fault.fault_id,
                    tier=RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
                    action=RecoveryAction.WAL_REPLAY,
                    outcome="skipped",
                    idempotency_key=f"recovery:{fault.fault_id}:tier_2",
                    started_at=started,
                    completed_at=datetime.now(timezone.utc),
                    error="probe: no pending WAL entries",
                )
                await self._repo.insert_record(record)
                return record

            # 3. 探测通过后回放
            replayed = await self._wal_replayer.replay(since_ts=fault.occurred_at)
            record = RecoveryRecord(
                record_id=str(uuid.uuid1),
                fault_id=fault.fault_id,
                tier=RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
                action=RecoveryAction.WAL_REPLAY,
                outcome="success",
                idempotency_key=f"recovery:{fault.fault_id}:tier_2",
                started_at=started,
                completed_at=datetime.now(timezone.utc),
                error=f"replayed {replayed} entries",
            )
        except Exception as e:
            record = RecoveryRecord(
                record_id=str(uuid.uuid1),
                fault_id=fault.fault_id,
                tier=RecoveryTier.TIER_2_PROBE_THEN_REPLAY,
                action=RecoveryAction.WAL_REPLAY,
                outcome="failed",
                idempotency_key=f"recovery:{fault.fault_id}:tier_2",
                started_at=started,
                completed_at=datetime.now(timezone.utc),
                error=str(e),
            )
        await self._repo.insert_record(record)
        return record

    async def execute_tier_3(self, fault: FaultSignal) -> RecoveryRecord:
        started = datetime.now(timezone.utc)
        # 1. 检测 magic word（从最近用户输入）
        user_input = await self._get_recent_user_input(fault.forgekin_id)
        magic_word = self._guard.detect_magic_word(user_input)

        if magic_word is None:
            # 无 magic word，升级到 Tier 4
            return await self.escalate(fault, RecoveryTier.TIER_3_RECOVERY_CARD)

        # 2. 创建恢复卡
        card = await self._guard.create_recovery_card(
            forgekin_id=fault.forgekin_id,
            fault=fault,
            magic_word=magic_word,
        )

        # 3. 等待用户决策
        decision = await self._guard.await_user_decision(
            card.card_id,
            timeout_seconds=self._cfg.magic_words.card_timeout_seconds,
        )

        outcome = "success" if decision == "approved" else "failed"
        if decision == "approved":
            try:
                await self._wal_replayer.replay(since_ts=fault.occurred_at)
            except Exception as e:
                outcome = "failed"

        record = RecoveryRecord(
            record_id=str(uuid.uuid1),
            fault_id=fault.fault_id,
            tier=RecoveryTier.TIER_3_RECOVERY_CARD,
            action=RecoveryAction.RECOVERY_CARD,
            outcome=outcome,
            idempotency_key=f"recovery:{fault.fault_id}:tier_3:{card.card_id}",
            started_at=started,
            completed_at=datetime.now(timezone.utc),
            error=f"user_decision={decision}",
        )
        await self._repo.insert_record(record)
        return record

    async def execute_tier_4(self, fault: FaultSignal) -> RecoveryRecord:
        now = datetime.now(timezone.utc)
        record = RecoveryRecord(
            record_id=str(uuid.uuid1),
            fault_id=fault.fault_id,
            tier=RecoveryTier.TIER_4_HARD_REJECT,
            action=RecoveryAction.HARD_REJECT,
            outcome="failed",
            idempotency_key=f"recovery:{fault.fault_id}:tier_4",
            started_at=now,
            completed_at=now,
            error=f"hard reject: fault_type={fault.fault_type} "
                  f"failure_count={fault.failure_count}",
        )
        await self._repo.insert_record(record)
        await self._bus.publish(
            topic="recovery.hard_rejected",
            payload=record.model_dump,
        )
        return record

    async def escalate(
        self, fault: FaultSignal, from_tier: RecoveryTier
    ) -> RecoveryRecord:
        if from_tier == RecoveryTier.TIER_4_HARD_REJECT:
            raise EscalationLoopError("cannot escalate from tier_4")

        next_tier = TIER_NEXT.get(from_tier)
        if next_tier is None:
            raise EscalationLoopError(
                f"no escalation rule for {from_tier.value}"
            )

        logger.warning(
            f"escalate fault {fault.fault_id} from {from_tier.value} "
            f"to {next_tier.value}"
        )

        new_fault = fault.model_copy(update={
            "failure_count": fault.failure_count + 1,
        })

        dispatch = {
            RecoveryTier.TIER_0_IGNORE: self.execute_tier_0,
            RecoveryTier.TIER_1_REPLAY: self.execute_tier_1,
            RecoveryTier.TIER_2_PROBE_THEN_REPLAY: self.execute_tier_2,
            RecoveryTier.TIER_3_RECOVERY_CARD: self.execute_tier_3,
            RecoveryTier.TIER_4_HARD_REJECT: self.execute_tier_4,
        }
        return await dispatch[next_tier](new_fault)

    async def _get_recent_user_input(self, forgekin_id: str) -> str:
        # 实际由调用方注入；默认返回空串
        return ""
```

### 3.2 关键流程时序图

```
[恢复主流程时序图]

  Forgekin.act   executor    classifier   repository   wal_replayer   canonical   magic_guard   EventBus   F040
        │             │            │             │             │            │            │           │          │
        │ recover(fault)           │             │             │            │            │           │          │
        ├────────────>│            │             │             │            │            │           │          │
        │             │ query_by_idempotency                  │            │            │           │          │
        │             ├────────────────────────>│              │            │            │           │          │
        │             │<────────────────────────┤ None         │            │            │           │          │
        │             │ classify(fault)                                     │            │           │          │
        │             ├───────────>│            │              │            │            │           │          │
        │             │<───────────┤ decision    │              │            │            │           │          │
        │             │ execute_tier_X(fault)                                 │            │           │          │
        │             │ (按 tier 分发)                                       │            │           │          │
        │             │ ├─ tier_0: 无动作                                    │            │           │          │
        │             │ ├─ tier_1: wal_replayer.replay                    │            │           │          │
        │             │ │              ├──────────────────────>│             │            │           │          │
        │             │ │              │<──────────────────────┤ replayed   │            │           │          │
        │             │ ├─ tier_2: canonical.canonical_read + wal_replayer.replay    │           │          │
        │             │ │              ├──────────────────────────────────────>│           │           │          │
        │             │ │              │<──────────────────────────────────────┤ liveness  │           │          │
        │             │ ├─ tier_3: magic_guard.detect_magic_word + create_recovery_card + await_user_decision        │
        │             │ │              ├──────────────────────────────────────────────────>│           │          │
        │             │ │              │<──────────────────────────────────────────────────┤ decision │          │
        │             │ ├─ tier_4: 硬拒 + 告警 F040                                                          │          │
        │             │ │                                                                                   │          │
        │             │ insert_record(record)                                                              │           │          │
        │             ├────────────────────────>│                                                          │           │          │
        │             │<────────────────────────┤ OK                                                       │           │          │
        │             │ publish("recovery.completed")                                                     │           │          │
        │             ├────────────────────────────────────────────────────────────────────────────────>│          │
        │             │                                                                                    ├────────>│
        │<────────────┤ record                                                                                        │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 重试次数 |
|---------|---------|---------|---------|
| `RecoveryExecutionError` | 恢复执行失败 | 按 outcome=failed 记录 + escalate | 由 escalate 处理 |
| `EscalationLoopError` | 升级到 Tier 4 后仍失败 | 终态，硬拒 | 不重试 |
| `MagicWordNotDetectedError` | Tier 3 无 magic word | 自动升级到 Tier 4 | 不重试 |
| `ProbeTimeoutError` | Tier 2 探测超时 | 标记 failed + escalate | 2 |
| `UserDecisionTimeoutError` | Tier 3 用户决策超时 | outcome=failed + escalate | 不重试 |
| `WalReplayError` | WAL 回放失败 | 标记 failed + escalate | 由 escalate 处理 |
| `RepositoryInsertError` | 记录持久化失败 | 阻塞 recover，返回错误 | 3（指数退避） |
| `ConfigValidationError` | 配置校验失败 | 启动失败 | 不重试（硬约束违规） |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| Tier 分类延迟 | < 5ms | 内存决策树 + 正则预编译 |
| Tier 0 处理延迟 | < 5ms | 直接返回，无 I/O |
| Tier 1 回放延迟 | < 5s（1000 entry） | 复用 F021 WalReplayer 批量 |
| Tier 2 探测延迟 | < 1s | F023 canonical_read 缓存 |
| Tier 3 用户决策等待 | < 300s（默认超时） | 异步等待 + 超时硬切 |
| Tier 4 硬拒延迟 | < 5ms | 直接返回 |
| 升级链路深度 | <= 4（最多到 Tier 4） | 静态升级图 + 循环检测 |
| Repository 查询延迟 | < 10ms | fault_id + idempotency_key 索引 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

- **Forgekin.act**：Forgekin 执行失败时调用 `RecoveryExecutor.recover(fault)` 触发恢复。
- **F024 强 workflow**：强 workflow rejectable 步骤对应 Tier 0/4，replayable 步骤对应 Tier 1/2。F024 调用本设计的 `recover` 接口。
- **F025 跨 provider 宿主抽象**：provider 故障触发 Tier 4 provider failover。F025 通过 `fault_type=ProviderFailure` 调用本设计。
- **F021 副作用 WAL**：Tier 1/2 通过 `WalReplayer.replay` 回放。本设计调用 F021 接口。
- **F023 liveness 规范读**：Tier 2 探测阶段调用 `CanonicalReadModel.canonical_read`。本设计调用 F023 接口。
- **F011 Magic Words**：Tier 3 恢复卡由 F011 MagicWordsGuard 识别触发。本设计嵌入 F011 守护器。
- **DI 容器**：`recovery_executor` 通过 `inject("recovery_executor")` 获取。

### 4.2 下游影响如何被调用

- **F020 七类归因**：恢复历史记录写入 F020 归因器的输入。F020 订阅 `recovery.completed` 事件。
- **F040 控制面**：所有恢复动作写入 F040 Eval Hub。F040 订阅 `recovery.*` 主题。
- **Forgekin.learn**：恢复历史作为 Forgekin 学习输入，更新能力画像（CapabilityProfile）。
- **archive_repository**：恢复记录归档到 archive_repository（独立表）。

### 4.3 集成测试点

| 测试点 ID | 测试场景 | 验证点 | 责任方 |
|----------|---------|--------|--------|
| IT-D022-001 | Tier 0 忽略故障 | outcome=skipped，无恢复动作 | 测试员Forgekin（蜜獾·平头哥） |
| IT-D022-002 | Tier 1 WAL 回放 | wal_replayer.replay 被调用，outcome=success | 测试员Forgekin |
| IT-D022-003 | Tier 2 探测后回放 | canonical_read 调用 + WAL 完整性检查 + 回放 | 测试员Forgekin |
| IT-D022-004 | Tier 2 探测失败（zombie） | outcome=failed + escalate 到 Tier 3 | 测试员Forgekin |
| IT-D022-005 | Tier 3 magic word 触发恢复卡 | RecoveryCard 创建 + await_user_decision | 测试员Forgekin |
| IT-D022-006 | Tier 3 无 magic word | 自动升级到 Tier 4 | 测试员Forgekin |
| IT-D022-007 | Tier 4 硬拒 | outcome=failed + 告警 F040 | 测试员Forgekin |
| IT-D022-008 | 跨 Tier 升级链路 | Tier 1 失败 → Tier 2 → Tier 3 → Tier 4 | 测试员Forgekin |
| IT-D022-009 | 幂等去重 | 同一 fault_id 多次 recover 仅执行一次 | 测试员Forgekin |
| IT-D022-010 | 升级循环检测 | Tier 4 后再升级抛 EscalationLoopError | 测试员Forgekin |
| IT-D022-011 | Magic Words 配置加载 | magic_words 列表非空 + card_timeout_seconds 范围 | 测试员Forgekin |
| IT-D022-012 | 分类规则全覆盖 | classification_rules 覆盖全部 5 个 Tier | 测试员Forgekin |
| IT-D022-013 | 用户决策超时 | Tier 3 等待超时后 outcome=failed + escalate | 测试员Forgekin |
| IT-D022-014 | 用户决策拒绝 | Tier 3 用户拒绝后 outcome=failed + escalate | 测试员Forgekin |
| IT-D022-015 | 探测超时 | Tier 2 探测超时后 outcome=failed + escalate | 测试员Forgekin |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-D022-001**: Tier 0 忽略故障通过（IT-D022-001）
- [ ] **AC-D022-002**: Tier 1 WAL 回放通过（IT-D022-002）
- [ ] **AC-D022-003**: Tier 2 探测后回放通过（IT-D022-003）
- [ ] **AC-D022-004**: Tier 2 探测失败升级生效（IT-D022-004）
- [ ] **AC-D022-005**: Tier 3 magic word 触发恢复卡通过（IT-D022-005）
- [ ] **AC-D022-006**: Tier 3 无 magic word 自动升级（IT-D022-006）
- [ ] **AC-D022-007**: Tier 4 硬拒生效（IT-D022-007）
- [ ] **AC-D022-008**: 跨 Tier 升级链路通过（IT-D022-008）
- [ ] **AC-D022-009**: 幂等去重生效（IT-D022-009）
- [ ] **AC-D022-010**: 升级循环检测生效（IT-D022-010）

### 5.2 性能验收 AC

- [ ] **AC-D022-011**: Tier 分类延迟 < 5ms
- [ ] **AC-D022-012**: Tier 0 处理延迟 < 5ms
- [ ] **AC-D022-013**: Tier 1 回放延迟 < 5s（1000 entry）
- [ ] **AC-D022-014**: Tier 2 探测延迟 < 1s
- [ ] **AC-D022-015**: Tier 4 硬拒延迟 < 5ms
- [ ] **AC-D022-016**: 升级链路深度 <= 4
- [ ] **AC-D022-017**: Repository 查询延迟 < 10ms

### 5.3 安全验收 AC

- [ ] **AC-D022-018**: Tier 0/4 硬拒约束生效
- [ ] **AC-D022-019**: 幂等去重生效（idempotency_key 全局唯一）
- [ ] **AC-D022-020**: 升级循环检测生效
- [ ] **AC-D022-021**: Magic Words 守护嵌入 Tier 3
- [ ] **AC-D022-022**: RecoveryRecord 不可变（Pydantic frozen=True）
- [ ] **AC-D022-023**: Repository 层抽象，不直操作数据库
- [ ] **AC-D022-024**: 分类规则全覆盖 5 个 Tier

### 5.4 Eval 验收 AC

- [ ] **AC-D022-025**: 恢复成功率 >= 95%（Tier 1/2 范围内）
- [ ] **AC-D022-026**: 跨 Tier 升级率 <= 10%（多数故障在 Tier 1 解决）
- [ ] **AC-D022-027**: Tier 4 硬拒率 <= 1%（极少情况才到 Tier 4）
- [ ] **AC-D022-028**: 恢复历史记录完整率 100%（所有恢复动作归档）
- [ ] **AC-D022-029**: Magic Words 触发准确率 >= 90%

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../architecture/A022-tier-1-4-recovery.md]
- [doc:../features/F011-magic-words.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F025-provider-host-abstraction.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（5 级 Tier + 4 类 Action + 决策树 + Tier 0/4 硬拒 + Tier 2 探测后重放 + Tier 3 恢复卡 + 跨 Tier 升级 + Magic Words 守护 + 15 集成测试点 + 4 类 AC） | 开发者 Forgekin（猎犬·夏洛克） |

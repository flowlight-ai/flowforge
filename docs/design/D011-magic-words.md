# D011: Magic Words 逃生舱详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.3]
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]
> **对应 Feature**: [doc:../features/F011-magic-words.md]
> **对应 Architecture**: [doc:../architecture/A011-magic-words.md]
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A011 架构层定义了"四词 + operator-only + 始终激活 + 星星罐子冻结 Tier 4"骨架，本详细设计需要回答下列"如何落地"问题：

1. **D-Q1**：4 个 Magic Words 如何在 Pydantic 模型层枚举，确保不可扩展第五词？
2. **D-Q2**：`MagicWordsDetector` 如何仅识别 operator 显式输入（line 起始匹配），防止任务内容误识别？
3. **D-Q3**：`MagicWordsExecutor` 如何按 word 分发到对应动作（complexity_audit / force_truth_source_read / forbid_defer / emergency_stop）？
4. **D-Q4**："星星罐子" 触发如何立即冻结所有 F022 Tier 4 操作（force-push/merge/release），不等待Forgekin当前 action 完成？
5. **D-Q5**："我能猜出来" 触发如何强制查询 D008 真相源（canonical_read），禁止继续推理？
6. **D-Q6**：所有觉醒阶（E1-E6）下检测器如何始终激活，禁用配置关闭？
7. **D-Q7**：触发记录如何写入 audit log + D008 thread_trace，禁删除？

### 1.2 设计约束

| 编号 | 约束 | 来源 |
|------|------|------|
| C1 | `flowforge/core/harness/magic_words.py` 不可 import forgemind 或 *Forge 模块 | 单向依赖 |
| C2 | MagicWordsDetector / MagicWordsExecutor / AuditLogger 通过 `@inject` 注入 | DI 容器 |
| C3 | MagicWordTrigger 审计记录通过 Repository 持久化到 D008 Durable Surface | Repository 层 |
| C4 | 四个 Magic Words + 不可绕过约束配置外置到 `flowforge/config/harness.yaml` | 配置驱动 |
| C5 | 四个 Magic Words 注入到 `native_system_role`（压缩免疫） | A011 决策 1 |
| C6 | operator-only 触发，Forgekin输出不检测 | A011 决策 2 |
| C7 | 所有觉醒阶（E1-E6）下检测器始终激活，禁配置关闭 | A011 决策 3 |
| C8 | "星星罐子" 触发立即冻结所有 F022 Tier 4 操作 | A011 决策 4 |
| C9 | "我能猜出来" 强制查询 D008 真相源 | A011 不变量 |
| C10 | "下次一定" 禁止"留到下次" | A011 不变量 |
| C11 | "第一性原理" 检查复杂度代偿无知 | A011 不变量 |
| C12 | 所有触发记录写入 audit log, 禁删除 | A011 决策 5 |
| C13 | 触发时上下文快照写入 D008 thread_trace | A011 不变量 |
| C15 | 觉醒阶标注：所有阶（E1-E6）下 Magic Words 始终可触发，是 operator 制动手段 | naming-contract.md §4 |

### 1.3 设计影响

| 编号 | 影响 | 关联模块 |
|------|------|---------|
| I1 | D002 TeamAct 任意步骤可被 Magic Words 强制中断 | D002 / A002 |
| I2 | D010 Governance Boundary 注入四个 Magic Words 到 native_system_role 拉闸位置 | D010 / A010 |
| I3 | D008 Durable Surface 持久化触发时上下文快照（thread_trace） | D008 / A008 |
| I4 | F022 Tier 1-4 恢复：星星罐子冻结所有 Tier 4 操作 | F022 |
| I5 | F036 forgemind：物理世界操作紧急停止 | F036 |
| I6 | D007 Push Back：星星罐子中断所有进行中 DebateChain | D007 / A007 |

---

## 2. 详细设计

### 2.1 类图

```
┌──────────────────────────────────────────────────────────────────────┐
│                    flowforge/core/harness/magic_words.py             │
├──────────────────────────────────────────────────────────────────────┤
│  «enum» MagicWord                                                    │
│    + FIRST_PRINCIPLES    ("第一性原理")                               │
│    + I_CAN_GUESS         ("我能猜出来")                               │
│    + NEXT_TIME_FOR_SURE  ("下次一定")                                 │
│    + STAR_JAR            ("星星罐子")                                 │
│                                                                      │
│  «enum» MagicWordAction                                              │
│    + COMPLEXITY_AUDIT        (检查复杂度代偿无知)                    │
│    + FORCE_TRUTH_SOURCE_READ (强制查询真相源)                        │
│    + FORBID_DEFER            (能做的现在做)                          │
│    + EMERGENCY_STOP          (P0 不可逆风险立即停止)                 │
│                                                                      │
│  «Pydantic» MagicWordTrigger                                         │
│    + trigger_id: str                                                 │
│    + word: MagicWord                                                 │
│    + operator_id: str          (operator-only, 非空)                │
│    + forgekin_id: str          (触发时持球Forgekin)                    │
│    + context_snapshot: dict   (触发时上下文快照)                     │
│    + fired_at: datetime                                              │
│    + action_taken: str                                               │
│    + schema_version: str = "v1"                                      │
│    + wal_lsn: int = 0                                                │
│    + decay_tag: DecayTag = BUILT_TO_PERSIST                          │
│    + authority_level: int = 4                                        │
│                                                                      │
│  «Pydantic» ActionResult                                             │
│    + success: bool                                                   │
│    + action: MagicWordAction                                         │
│    + details: dict                                                   │
│                                                                      │
│  «ABC» MagicWordsDetector                                            │
│    + detect(operator_input) -> Optional[MagicWord]                   │
│                                                                      │
│  «ABC» MagicWordsExecutor                                            │
│    + execute(word, context, operator_id) -> ActionResult             │
│    + emergency_stop(reason) -> None                                  │
│                                                                      │
│  «ABC» AuditLogger                                                   │
│    + log(trigger) -> None                                            │
│    + list_triggers(operator_id) -> list[MagicWordTrigger]            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│            infra/repo/sqlite_magic_words_audit.py                    │
│  «implements AuditLogger» SqliteAuditLogger                          │
│    + async log(trigger) -> None                                      │
│    + async list_triggers(operator_id) -> list[MagicWordTrigger]      │
│    + async checkpoint -> None                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口与 Pydantic 模型

```python
# flowforge/core/harness/magic_words.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from flowforge.core.plugin.di_container import inject
from flowforge.core.harness.decay_tag import DecayTag


# ───────────────────────────── 枚举 ─────────────────────────────

class MagicWord(str, Enum):
    """4 个 Magic Words（不可扩展第五词, A011 决策 1）

    产品层双轨命名:
    - "第一性原理" / "FIRST_PRINCIPLES"
    - "我能猜出来" / "I_CAN_GUESS"
    - "下次一定"   / "NEXT_TIME_FOR_SURE"
    - "星星罐子"   / "STAR_JAR"
    """
    FIRST_PRINCIPLES = "第一性原理"
    I_CAN_GUESS = "我能猜出来"
    NEXT_TIME_FOR_SURE = "下次一定"
    STAR_JAR = "星星罐子"


class MagicWordAction(str, Enum):
    """Magic Word 对应动作"""
    COMPLEXITY_AUDIT = "complexity_audit"
    FORCE_TRUTH_SOURCE_READ = "force_truth_source_read"
    FORBID_DEFER = "forbid_defer"
    EMERGENCY_STOP = "emergency_stop"


# Magic Word → Action 映射（A011 决策 1）
WORD_ACTION_MAP: dict[MagicWord, MagicWordAction] = {
    MagicWord.FIRST_PRINCIPLES: MagicWordAction.COMPLEXITY_AUDIT,
    MagicWord.I_CAN_GUESS: MagicWordAction.FORCE_TRUTH_SOURCE_READ,
    MagicWord.NEXT_TIME_FOR_SURE: MagicWordAction.FORBID_DEFER,
    MagicWord.STAR_JAR: MagicWordAction.EMERGENCY_STOP,
}


# ───────────────────────────── 异常 ─────────────────────────────

class MagicWordsError(Exception):
    """Magic Words 基础异常"""


class ForgekinTriggeredMagicWordError(MagicWordsError):
    """Forgekin输出触发 Magic Words（违反 operator-only）"""


class MagicWordDisabledError(MagicWordsError):
    """Magic Words 被配置关闭（违反 A011 决策 3 始终激活）"""


class Tier4FreezeFailedError(MagicWordsError):
    """星星罐子冻结 Tier 4 操作失败"""


# ───────────────────────────── Pydantic 模型 ─────────────────────────────

class MagicWordTrigger(BaseModel):
    """Magic Word 触发记录"""
    trigger_id: str = Field(..., min_length=1)
    word: MagicWord
    operator_id: str = Field(..., min_length=1)   # operator-only
    forgekin_id: str = Field(..., min_length=1)
    context_snapshot: dict[str, Any]
    fired_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    action_taken: str
    schema_version: str = Field(default="v1")
    wal_lsn: int = Field(default=0, ge=0)
    decay_tag: DecayTag = Field(default=DecayTag.BUILT_TO_PERSIST)
    authority_level: int = Field(default=4, ge=1, le=5)

    @field_validator("operator_id")
    @classmethod
    def _operator_non_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ForgekinTriggeredMagicWordError(
                "operator_id 不可为空 (Magic Words operator-only)"
            )
        return v.strip


class ActionResult(BaseModel):
    """Magic Word 执行结果"""
    success: bool
    action: MagicWordAction
    details: dict[str, Any] = Field(default_factory=dict)


# ───────────────────────────── 抽象基类 ─────────────────────────────

class MagicWordsDetector(ABC):
    """Magic Words 检测器"""

    @abstractmethod
    def detect(self, operator_input: str) -> Optional[MagicWord]:
        """检测 operator 输入中的 Magic Words

        架构契约:
        - 仅识别 operator 显式输入, Forgekin输出不检测
        - 四词精确匹配, 防止任务内容误识别
        - 所有觉醒阶 (E1-E6) 始终激活, 禁配置关闭
        - 行首匹配（line.lstrip(" \\t\\u3000").startswith(word)）
        """


class MagicWordsExecutor(ABC):
    """Magic Words 执行器"""

    @abstractmethod
    async def execute(
        self,
        word: MagicWord,
        context: dict[str, Any],
        operator_id: str,
    ) -> ActionResult:
        """执行 Magic Words 对应动作

        架构契约:
        - 第一性原理 → complexity_audit (检查复杂度代偿无知)
        - 我能猜出来 → force_truth_source_read (强制查询 D008)
        - 下次一定 → forbid_defer (能做的现在做)
        - 星星罐子 → emergency_stop (冻结 Tier 4, 升级 CVO)
        """

    @abstractmethod
    async def emergency_stop(self, reason: str) -> None:
        """星星罐子触发: 立即冻结所有 Tier 4 操作

        架构契约:
        - 冻结 force-push / merge / release 等不可逆操作
        - 升级 CVO 仲裁
        - 写入 audit log
        - 不等待Forgekin当前 action 完成
        """


class AuditLogger(ABC):
    """审计记录器"""

    @abstractmethod
    async def log(self, trigger: MagicWordTrigger) -> None:
        """记录 Magic Word 触发

        架构契约:
        - 所有触发记录写入 audit log
        - 禁删除 (审计可追溯)
        - 持久化到 Durable Surface (F008)
        """

    @abstractmethod
    async def list_triggers(
        self, operator_id: Optional[str] = None
    ) -> list[MagicWordTrigger]:
        """列出触发记录（禁删除, 仅供审计查询）"""
```

### 2.3 默认实现

```python
# flowforge/core/harness/magic_words.py（续）

class DefaultMagicWordsDetector(MagicWordsDetector):
    """Magic Words 检测器默认实现

    operator-only + 行首匹配 + 始终激活
    """

    # 4 个 Magic Words 文本（用于行首匹配）
    MAGIC_WORDS_TEXT = tuple(w.value for w in MagicWord)

    def detect(self, operator_input: str) -> Optional[MagicWord]:
        if not operator_input:
            return None
        # 按行扫描, 仅识别行首匹配
        for line in operator_input.splitlines:
            stripped = line.lstrip(" \t\u3000")  # 半角空格/制表符/全角空格
            for word in MagicWord:
                if stripped.startswith(word.value):
                    # 校验后面是标点 / 空白 / 行尾（防止"第一性原理思考"误匹配）
                    rest = stripped[len(word.value):]
                    if not rest or rest[0] in "，。！？,.!?" or rest[0].isspace:
                        return word
        return None


class DefaultMagicWordsExecutor(MagicWordsExecutor):
    """Magic Words 执行器默认实现"""

    @inject
    def __init__(
        self, *,
        audit_logger: AuditLogger,
        durable_state_registry,     # D008 Registry
        forgekin_host,              # ForgekinHost (中断当前 action)
        tier4_freezer,              # F022 Tier 4 冻结器
        routing_dispatcher,         # D005 (升级 CVO)
        debate_orchestrator,        # D007 (中断辩论链)
        event_bus,
        eval_signal_writer,
    ) -> None:
        self._audit_logger = audit_logger
        self._durable_state_registry = durable_state_registry
        self._forgekin_host = forgekin_host
        self._tier4_freezer = tier4_freezer
        self._routing_dispatcher = routing_dispatcher
        self._debate_orchestrator = debate_orchestrator
        self._event_bus = event_bus
        self._eval_signal_writer = eval_signal_writer

    async def execute(
        self,
        word: MagicWord,
        context: dict[str, Any],
        operator_id: str,
    ) -> ActionResult:
        action = WORD_ACTION_MAP[word]

        # 构造触发记录
        trigger = MagicWordTrigger(
            trigger_id=f"mw-{word.name}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
            word=word,
            operator_id=operator_id,
            forgekin_id=context.get("forgekin_id", "unknown"),
            context_snapshot=context,
            action_taken=action.value,
        )

        # 写入 audit log（禁删除）
        await self._audit_logger.log(trigger)

        # 写入 D008 thread_trace（上下文快照）
        from flowforge.core.harness.durable_state import (
            DurableSurface, StateSurfaceType,
        )
        surface = DurableSurface(
            surface_id=f"tt-mw-{trigger.trigger_id}",
            surface_type=StateSurfaceType.THREAD_TRACE,
            key=f"thread:magic_word:{word.value}:{trigger.trigger_id}",
            payload={
                "word": word.value,
                "context": context,
                "operator_id": operator_id,
                "action": action.value,
            },
            authority_level=2,
            compression_immune=False,
            decay_tag=DecayTag.BUILT_TO_DELETE,
            authored_by=operator_id,
        )
        await self._durable_state_registry.write(surface)

        # 按 word 分发到对应动作
        if word == MagicWord.STAR_JAR:
            await self.emergency_stop(reason=f"operator {operator_id} 触发星星罐子")
            # 同时中断所有进行中 DebateChain
            try:
                await self._debate_orchestrator.cancel_all_pending(
                    reason="star_jar_triggered"
                )
            except Exception as e:
                # 中断辩论链失败不阻塞 emergency_stop 主流程
                pass
        elif word == MagicWord.I_CAN_GUESS:
            # 强制查询 D008 真相源
            truth = await self._durable_state_registry.canonical_read(
                context.get("truth_key", "")
            )
            if truth:
                await self._forgekin_host.inject_truth_source(truth.payload)
        elif word == MagicWord.NEXT_TIME_FOR_SURE:
            # 禁止"留到下次": 强制当前完成
            await self._forgekin_host.forbid_defer
        elif word == MagicWord.FIRST_PRINCIPLES:
            # 检查复杂度代偿无知
            await self._forgekin_host.trigger_complexity_audit

        # 发布事件 + Eval 信号
        await self._event_bus.publish_async(
            "magic_word.triggered",
            {
                "trigger_id": trigger.trigger_id,
                "word": word.value,
                "action": action.value,
                "operator_id": operator_id,
            },
        )
        self._eval_signal_writer.write_trace(
            signal_type="magic_word_triggered",
            payload={"word": word.value, "action": action.value},
        )

        return ActionResult(success=True, action=action, details={
            "trigger_id": trigger.trigger_id,
            "context_snapshot_size": len(str(context)),
        })

    async def emergency_stop(self, reason: str) -> None:
        """星星罐子触发: 立即冻结所有 Tier 4 操作"""
        try:
            # 1. 冻结所有 Tier 4 操作（force-push/merge/release）
            await self._tier4_freezer.freeze_all_tier4(reason=reason)

            # 2. 不等待Forgekin当前 action 完成（强制中断）
            await self._forgekin_host.force_interrupt_current_action(
                reason=f"emergency_stop: {reason}"
            )

            # 3. 升级 CVO 仲裁
            await self._routing_dispatcher.dispatch_to_cvo(
                verdict_id="emergency",
                chain_id="star_jar",
                reason=reason,
                evidence_pack={"tier4_frozen": True},
            )
        except Exception as e:
            raise Tier4FreezeFailedError(f"emergency_stop 失败: {e}") from e


class SqliteAuditLogger(AuditLogger):
    """SQLite + WAL 实现 audit log 持久化（禁删除）"""

    DDL = """
    CREATE TABLE IF NOT EXISTS magic_word_triggers (
        trigger_id TEXT PRIMARY KEY,
        word TEXT NOT NULL,
        operator_id TEXT NOT NULL,
        forgekin_id TEXT NOT NULL,
        context_snapshot_json TEXT NOT NULL,
        fired_at TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        schema_version TEXT NOT NULL DEFAULT 'v1',
        wal_lsn INTEGER NOT NULL DEFAULT 0,
        decay_tag TEXT NOT NULL DEFAULT 'BUILT_TO_PERSIST',
        authority_level INTEGER NOT NULL DEFAULT 4
    );

    CREATE INDEX IF NOT EXISTS idx_mwt_operator ON magic_word_triggers(operator_id);
    CREATE INDEX IF NOT EXISTS idx_mwt_word ON magic_word_triggers(word);
    CREATE INDEX IF NOT EXISTS idx_mwt_fired_at ON magic_word_triggers(fired_at);

    -- 禁删除: 不提供 DELETE 接口, 仅 INSERT + SELECT
    """

    @inject
    def __init__(self, *, db_path: str) -> None:
        self._db_path = db_path
        self._conn: Any = None

    async def _ensure_conn(self):
        import aiosqlite
        if self._conn is None:
            self._conn = await aiosqlite.connect(self._db_path)
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.executescript(self.DDL)
            await self._conn.commit
        return self._conn

    async def log(self, trigger: MagicWordTrigger) -> None:
        import json
        conn = await self._ensure_conn
        await conn.execute(
            """
            INSERT INTO magic_word_triggers
                (trigger_id, word, operator_id, forgekin_id,
                 context_snapshot_json, fired_at, action_taken,
                 schema_version, wal_lsn, decay_tag, authority_level)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                trigger.trigger_id, trigger.word.value,
                trigger.operator_id, trigger.forgekin_id,
                json.dumps(trigger.context_snapshot, ensure_ascii=False, default=str),
                trigger.fired_at.isoformat,
                trigger.action_taken,
                trigger.schema_version, trigger.wal_lsn,
                trigger.decay_tag.value, trigger.authority_level,
            ),
        )
        await conn.commit

    async def list_triggers(
        self, operator_id: Optional[str] = None
    ) -> list[MagicWordTrigger]:
        import json
        conn = await self._ensure_conn
        if operator_id:
            async with conn.execute(
                "SELECT * FROM magic_word_triggers WHERE operator_id = ? "
                "ORDER BY fired_at DESC",
                (operator_id,),
            ) as cur:
                rows = await cur.fetchall
        else:
            async with conn.execute(
                "SELECT * FROM magic_word_triggers ORDER BY fired_at DESC"
            ) as cur:
                rows = await cur.fetchall
        return [self._deserialize(r) for r in rows]

    @staticmethod
    def _deserialize(row: tuple) -> MagicWordTrigger:
        import json
        from datetime import datetime
        (
            trigger_id, word, operator_id, forgekin_id,
            context_snapshot_json, fired_at, action_taken,
            schema_version, wal_lsn, decay_tag, authority_level,
        ) = row
        return MagicWordTrigger(
            trigger_id=trigger_id,
            word=MagicWord(word),
            operator_id=operator_id,
            forgekin_id=forgekin_id,
            context_snapshot=json.loads(context_snapshot_json),
            fired_at=datetime.fromisoformat(fired_at),
            action_taken=action_taken,
            schema_version=schema_version,
            wal_lsn=wal_lsn,
            decay_tag=DecayTag(decay_tag),
            authority_level=authority_level,
        )
```

### 2.4 关键算法伪代码

**算法 1：detect operator 输入中的 Magic Word**

```
function detect(operator_input: str) -> Optional[MagicWord]:
    if not operator_input: return None
    for line in operator_input.splitlines:
        stripped = line.lstrip(" \t\u3000")  # 半角空格/制表符/全角空格
        for word in MagicWord:
            if stripped.startswith(word.value):
                rest = stripped[len(word.value):]
                # 校验后面是标点/空白/行尾（防止误匹配）
                if not rest or rest[0] in "，。！？,.!?" or rest[0].isspace:
                    return word
    return None
```

**算法 2：execute Magic Word（按 word 分发）**

```
async function execute(word, context, operator_id) -> ActionResult:
    action = WORD_ACTION_MAP[word]
    trigger = MagicWordTrigger(word=word, operator_id=operator_id, ...)

    # 1. 写入 audit log（禁删除）
    audit_logger.log(trigger)

    # 2. 写入 D008 thread_trace（上下文快照）
    durable_state_registry.write(DurableSurface(
        surface_type=THREAD_TRACE,
        key=f"thread:magic_word:{word.value}:{trigger.id}",
        authority_level=2,
        compression_immune=False,
        decay_tag=BUILT_TO_DELETE,
    ))

    # 3. 按 word 分发
    if word == STAR_JAR:
        emergency_stop("operator 触发星星罐子")
        debate_orchestrator.cancel_all_pending("star_jar_triggered")
    elif word == I_CAN_GUESS:
        truth = durable_state_registry.canonical_read(context.truth_key)
        if truth: forgekin_host.inject_truth_source(truth.payload)
    elif word == NEXT_TIME_FOR_SURE:
        forgekin_host.forbid_defer
    elif word == FIRST_PRINCIPLES:
        forgekin_host.trigger_complexity_audit

    # 4. 发布事件 + Eval 信号
    event_bus.publish("magic_word.triggered", {...})
    eval_signal_writer.write_trace(...)

    return ActionResult(success=True, action=action)
```

**算法 3：emergency_stop 立即冻结 Tier 4**

```
async function emergency_stop(reason: str) -> None:
    try:
        # 1. 冻结所有 Tier 4 操作（force-push/merge/release）
        tier4_freezer.freeze_all_tier4(reason)

        # 2. 强制中断Forgekin当前 action（不等待完成）
        forgekin_host.force_interrupt_current_action(reason)

        # 3. 升级 CVO 仲裁
        routing_dispatcher.dispatch_to_cvo(
            verdict_id="emergency",
            chain_id="star_jar",
            reason=reason,
            evidence_pack={"tier4_frozen": True},
        )
    except Exception as e:
        raise Tier4FreezeFailedError(f"emergency_stop 失败: {e}")
```

**算法 4：注入 Magic Words 到 native_system_role（与 D010 联动）**

```
async function inject_magic_words_to_native_system_role:
    # 复用 D010 GovernanceInjector
    magic_word_rules = [
        GovernanceRule(
            rule_id=f"magic_word_{w.value}",
            rule_text=f"Magic Word '{w.value}' 触发时立即执行 {WORD_ACTION_MAP[w].value}",
            authority=HARD,
            injection_layer=NATIVE_SYSTEM_ROLE,
            compression_immune=True,
            version="1",
            adr_ref="ADR-007",
        )
        for w in MagicWord
    ]
    governance_injector.inject_hard(magic_word_rules)
```

---

## 3. 模块实现

### 3.1 SQLite WAL 持久化实现

见 §2.3 `SqliteAuditLogger` 完整实现。

### 3.2 关键时序图

**时序图 1：星星罐子触发完整流程**

```
Operator         Detector          Executor          Tier4Freezer     ForgekinHost     D005            D008 Registry
  │                  │                  │                  │                │              │                  │
  │ "星星罐子"        │                  │                  │                │              │                  │
  │ (operator input) │                  │                  │                │              │                  │
  ├─────────────────>│                  │                  │                │              │                  │
  │                  │ detect(input)    │                  │                │              │                  │
  │                  │ line.startswith("星星罐子")?        │                │              │                  │
  │                  │ <── 是           │                  │                │              │                  │
  │ <────────────────┤ MagicWord.STAR_JAR                │                │              │                  │
  │                  │                  │                  │                │              │                  │
  │ execute(STAR_JAR, ctx, op_id)       │                  │                │              │                  │
  ├────────────────────────────────────>│                  │                │              │                  │
  │                  │                  │ audit_logger.log(trigger)        │              │                  │
  │                  │                  │ write DurableSurface(THREAD_TRACE)│             │                  │
  │                  │                  ├───────────────────────────────────────────────────────────────────>│
  │                  │                  │ <─────────────────────────────────────────────────────────────────┤
  │                  │                  │ emergency_stop(reason)           │              │                  │
  │                  │                  ├─────────────────>│                │              │                  │
  │                  │                  │                  │ freeze_all_tier4           │                  │
  │                  │                  │                  │ <── done       │              │                  │
  │                  │                  │ force_interrupt_current_action│              │                  │
  │                  │                  ├──────────────────────────────────>│              │                  │
  │                  │                  │ <─────────────────────────────────┤              │                  │
  │                  │                  │ dispatch_to_cvo(emergency)       │              │                  │
  │                  │                  ├──────────────────────────────────────────────────>│                  │
  │                  │                  │ <─────────────────────────────────────────────────┤                  │
  │                  │                  │ cancel_all_pending DebateChain (D007)            │                  │
  │                  │                  │ publish_async("magic_word.triggered")            │                  │
  │ <───────────────────────────────────┤ ActionResult(success=True)        │              │                  │
  │                  │                  │                  │                │              │                  │
  │  → Tier 4 已冻结, Forgekin action 已中断, CVO 升级, audit log 已写入 │ │                  │
```

**时序图 2：我能猜出来强制查询真相源**

```
Operator         Detector          Executor          D008 Registry     ForgekinHost
  │                  │                  │                  │                  │
  │ "我能猜出来"      │                  │                  │                  │
  ├─────────────────>│                  │                  │                  │
  │ <────────────────┤ MagicWord.I_CAN_GUESS              │                  │
  │                  │                  │                  │                  │
  │ execute(I_CAN_GUESS, ctx, op_id)    │                  │                  │
  ├────────────────────────────────────>│                  │                  │
  │                  │                  │ audit_logger.log(trigger)          │
  │                  │                  │ write thread_trace surface         │
  │                  │                  ├─────────────────>│                  │
  │                  │                  │ <────────────────┤                  │
  │                  │                  │ canonical_read(ctx.truth_key)     │
  │                  │                  ├─────────────────>│                  │
  │                  │                  │ <────────────────┤ DurableSurface  │
  │                  │                  │ inject_truth_source(payload)      │
  │                  │                  ├───────────────────────────────────>│
  │                  │                  │ <──────────────────────────────────┤
  │ <───────────────────────────────────┤ ActionResult(success=True)         │
  │                  │                  │                  │                  │
  │  → Forgekin收到真相源, 停止推理        │                  │                  │
```

### 3.3 错误处理策略

| # | 异常 / 场景 | 处理策略 | 用户可见行为 |
|---|------------|---------|-------------|
| E1 | `ForgekinTriggeredMagicWordError` Forgekin输出触发 | 拒绝执行, 仅记录 audit log | operator 看到"Forgekin不可触发 Magic Words" |
| E2 | `MagicWordDisabledError` 配置关闭 | 拒绝部署 + audit 告警 | 启动失败"Magic Words 不可禁用" |
| E3 | `Tier4FreezeFailedError` 冻结失败 | 重试 3 次, 仍失败抛出 + audit log | CVO 收到告警, 监控告警 |
| E4 | `audit_logger.log` 失败 | 重试 3 次, 仍失败抛出 | Magic Word 触发失败, 服务返回 500 |
| E5 | `durable_state_registry.write` 失败 | 不阻塞主流程, 仅 warning | thread_trace 缺失, 监控告警 |
| E6 | `forgekin_host.force_interrupt_current_action` 失败 | 重试 3 次, 仍失败抛出 | Forgekin未中断, 监控告警 |
| E7 | `routing_dispatcher.dispatch_to_cvo` 失败 | 重试 3 次, 仍失败抛出 + audit log | CVO 未收到升级, 监控告警 |
| E8 | `debate_orchestrator.cancel_all_pending` 失败 | 不阻塞 emergency_stop 主流程 | 辩论链未中断, 监控告警 |
| E9 | `event_bus.publish_async` 失败 | 不阻塞主流程, 仅 warning | 用户无感知 |
| E10 | `eval_signal_writer.write_trace` 失败 | 不阻塞主流程, 仅 warning | Eval 数据可能缺失 |
| E11 | `aiosqlite.OperationalError` DB 锁 | 指数退避重试 3 次 | 服务返回 503 |
| E12 | 任务内容含 "第一性原理" 但行首不匹配 → 不触发 | 正常行为 | 用户无感知 |

### 3.4 性能指标与优化

| # | 指标 | 目标 | 优化手段 |
|---|------|------|---------|
| P1 | `detect` 延迟 | P99 < 1ms | 4 词前缀匹配, O(n) n=行数 |
| P2 | `execute` 延迟（含 audit + thread_trace） | P99 < 100ms | 异步 event_bus + WAL |
| P3 | `emergency_stop` 延迟 | P99 < 200ms | 并行 freeze + interrupt + dispatch |
| P4 | `audit_logger.log` 延迟 | P99 < 30ms | WAL + NORMAL 同步 |
| P5 | `list_triggers` 延迟（100 条） | P99 < 20ms | `idx_mwt_operator` 索引 |
| P6 | WAL checkpoint 频率 | 每 100 次写入或 5 分钟 | 节流 |
| P7 | 单条 MagicWordTrigger 内存占用 | < 5KB | context_snapshot 限制 4KB |
| P8 | 并发 execute 吞吐 | > 50 QPS | aiosqlite 连接池 + WAL 并发读 |

### 3.5 YAML 配置示例

```yaml
# flowforge/config/harness.yaml
magic_words:
  # 4 个 Magic Words（不可扩展第五词, A011 决策 1）
  words:
    - text: "第一性原理"
      action: complexity_audit
      description: "检查复杂度代偿无知"
    - text: "我能猜出来"
      action: force_truth_source_read
      description: "强制查询真相源（D008 canonical_read）"
    - text: "下次一定"
      action: forbid_defer
      description: "能做的现在做, 禁止留到下次"
    - text: "星星罐子"
      action: emergency_stop
      description: "P0 不可逆风险立即停止, 冻结 Tier 4"

  # 不可绕过约束（A011 决策 3 始终激活）
  bypass_protection:
    enabled: true                 # 不可设为 false
    all_awakening_stages: true    # E1-E6 始终激活
    forbidden_disable: true       # 禁止配置关闭

  # operator-only 约束（A011 决策 2）
  operator_only:
    enabled: true
    forgekin_output_not_detected: true
    line_start_match: true        # 行首匹配
    punctuation_boundary: true    # 标点边界校验

  # 星星罐子冻结 Tier 4 操作（A011 决策 4）
  star_jar_freeze:
    tier4_operations:
      - force_push                # 不可逆 git 操作
      - merge                     # 不可逆合并
      - release                   # 不可逆发布
    immediate_interrupt: true     # 不等待 action 完成
    escalate_to_cvo: true         # 升级 CVO 仲裁

  # 我能猜出来查询真相源
  i_can_guess:
    truth_source: "D008_canonical_read"
    inject_to_forgekin: true      # 注入到Forgekin上下文
    stop_reasoning: true          # 停止继续推理

  # 下次一定禁止 defer
  next_time_for_sure:
    forbid_defer: true
    force_complete_now: true

  # 第一性原理检查
  first_principles:
    trigger_complexity_audit: true

  # audit log 配置（禁删除）
  audit_log:
    table: "magic_word_triggers"
    forbid_delete: true           # 仅 INSERT + SELECT
    persist_to_durable_surface: true
    authority_level: 4

  # 触发时上下文快照
  context_snapshot:
    write_to_thread_trace: true
    authority_level: 2
    compression_immune: false
    decay_tag: BUILT_TO_DELETE

  # WAL 配置
  wal:
    journal_mode: WAL
    synchronous: NORMAL
    checkpoint_interval_writes: 100
    checkpoint_interval_seconds: 300
```

---

## 4. 跨模块协作实现

### 4.1 上游调用：D010 GovernanceInjector 注入 Magic Words 到 native_system_role

```python
# flowforge/core/harness/governance.py（片段, D010）
class DefaultGovernanceInjector:
    async def inject_magic_words(self):
        """注入 4 个 Magic Words 到 native_system_role 拉闸位置"""
        from flowforge.core.harness.magic_words import (
            MagicWord, WORD_ACTION_MAP,
        )
        magic_word_rules = [
            GovernanceRule(
                rule_id=f"magic_word_{w.value}",
                rule_text=(
                    f"Magic Word '{w.value}' 触发时立即执行 "
                    f"{WORD_ACTION_MAP[w].value}"
                ),
                authority=RuleAuthority.HARD,
                injection_layer=InjectionLayer.NATIVE_SYSTEM_ROLE,
                compression_immune=True,
                version="1",
                adr_ref="ADR-007",
            )
            for w in MagicWord
        ]
        await self.inject_hard(magic_word_rules)
```

### 4.2 上游调用：ForgekinHost 接收 operator 输入触发 Magic Words

```python
# flowforge/core/host/forgekin_host.py（片段）
class ForgekinHost:
    @inject
    def __init__(
        self, *,
        magic_words_detector: MagicWordsDetector,
        magic_words_executor: MagicWordsExecutor,
        ...
    ) -> None:
        self._mw_detector = magic_words_detector
        self._mw_executor = magic_words_executor
        ...

    async def receive_operator_input(
        self, operator_id: str, input_text: str, context: dict
    ) -> None:
        """接收 operator 输入, 检测 Magic Words"""
        word = self._mw_detector.detect(input_text)
        if word is not None:
            # 触发 Magic Word 执行
            await self._mw_executor.execute(
                word=word,
                context=context,
                operator_id=operator_id,
            )
            return
        # 非 Magic Word, 走正常 LLM 调用流程
        await self._handle_normal_input(input_text, context)
```

### 4.3 下游影响：D007 Push Back 辩论链被中断

```python
# flowforge/core/harness/push_back.py（片段, D007）
class DefaultDebateOrchestrator:
    async def cancel_all_pending(self, reason: str) -> None:
        """星星罐子触发时中断所有进行中 DebateChain"""
        async with self._lock:
            for chain_id, chain in self._active_chains.items:
                if chain.status in (ChainStatus.AWAITING_RESPONSE, ChainStatus.AWAITING_PUSH_BACK):
                    chain.status = ChainStatus.ESCALATED
                    chain.resolution = PushBackOutcome.TIMEOUT_ESCALATED
                    chain.resolved_at = datetime.now(timezone.utc)
                    await self._store.update_chain_status(
                        chain.chain_id, chain.status, chain.resolution
                    )
                    await self._event_bus.publish_async(
                        "push_back.cancelled",
                        {"chain_id": chain_id, "reason": reason},
                    )
```

### 4.4 下游影响：F022 Tier 4 冻结器接口

```python
# flowforge/core/harness/tier4_freezer.py（片段, F022）
class Tier4Freezer:
    @inject
    def __init__(self, *, git_gateway, release_gateway) -> None:
        self._git_gateway = git_gateway
        self._release_gateway = release_gateway

    async def freeze_all_tier4(self, reason: str) -> None:
        """冻结所有 Tier 4 操作"""
        await self._git_gateway.freeze_force_push(reason)
        await self._git_gateway.freeze_merge(reason)
        await self._release_gateway.freeze_release(reason)
```

### 4.5 下游影响：D008 thread_trace 持久化上下文快照

见 §2.3 `DefaultMagicWordsExecutor.execute` 中写 thread_trace surface。

### 4.6 下游影响：D005 RoutingDispatcher 升级 CVO

```python
# flowforge/core/harness/at_mention.py（片段, D005）
class DefaultRoutingDispatcher:
    async def dispatch_to_cvo(
        self, verdict_id: str, chain_id: str, reason: str, evidence_pack: dict
    ) -> None:
        # 同 D007 §4.4
        ...
```

### 4.7 集成测试点

| # | 测试点 | 验证内容 | 关联 AC |
|---|--------|---------|---------|
| T1 | detect "星星罐子" 行首 → 返回 MagicWord.STAR_JAR | 行首匹配 | AC-F1 |
| T2 | detect "任务内容含第一性原理" 行中 → 不触发 | 行首匹配 + 边界校验 | AC-F2 |
| T3 | detect Forgekin输出 → 不触发 | operator-only | AC-F3 |
| T4 | execute STAR_JAR → 冻结 Tier 4 + 中断辩论链 + 升级 CVO | emergency_stop 调用 | AC-F7 |
| T5 | execute I_CAN_GUESS → canonical_read + inject_truth_source | 强制查询真相源 | AC-F8 |
| T6 | execute NEXT_TIME_FOR_SURE → forbid_defer | 禁止 defer | AC-F9 |
| T7 | execute FIRST_PRINCIPLES → trigger_complexity_audit | 复杂度审计 | AC-F10 |
| T8 | audit log 写入后禁删除 → DELETE 操作被拒绝 | 仅 INSERT + SELECT | AC-F11 |
| T9 | 触发时上下文快照写入 thread_trace | Durable Surface 持久化 | AC-F12 |
| T10 | 配置 enabled=false → 拒绝部署 | MagicWordDisabledError | AC-F13 |
| T11 | WAL 写入后进程崩溃 → 重启 list_triggers 返回完整数据 | 持久化恢复 | AC-P3 |
| T12 | 4 个 Magic Words 注入到 native_system_role | 复用 D010 GovernanceInjector | AC-F14 |

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

| AC | 描述 |
|----|------|
| AC-F1 | `detect` 行首匹配 "星星罐子" → 返回 MagicWord.STAR_JAR |
| AC-F2 | `detect` 行中匹配 "任务含第一性原理" → 不触发（行首匹配 + 边界校验） |
| AC-F3 | Forgekin输出不触发 Magic Words（operator-only） |
| AC-F4 | 4 个 Magic Words 文本精确匹配，不可扩展第五词 |
| AC-F5 | `execute` 按 word 分发到对应 action（complexity_audit / force_truth_source_read / forbid_defer / emergency_stop） |
| AC-F6 | `MagicWordTrigger.operator_id` 为空 → ForgekinTriggeredMagicWordError |
| AC-F7 | `execute(STAR_JAR)` → 冻结 Tier 4 + 中断辩论链 + 升级 CVO |
| AC-F8 | `execute(I_CAN_GUESS)` → canonical_read + inject_truth_source |
| AC-F9 | `execute(NEXT_TIME_FOR_SURE)` → forbid_defer |
| AC-F10 | `execute(FIRST_PRINCIPLES)` → trigger_complexity_audit |
| AC-F11 | audit log 禁删除（仅 INSERT + SELECT） |
| AC-F12 | 触发时上下文快照写入 D008 thread_trace（authority_level=2） |
| AC-F13 | 配置 enabled=false → 拒绝部署 + MagicWordDisabledError |
| AC-F14 | 4 个 Magic Words 注入到 native_system_role（复用 D010 GovernanceInjector） |
| AC-F15 | 所有觉醒阶（E1-E6）下检测器始终激活 |
| AC-F16 | 星星罐子不等待Forgekin当前 action 完成（强制中断） |
| AC-F17 | Magic Words 是 Build to Persist 安全资产（decay_tag=BUILT_TO_PERSIST） |
| AC-F18 | emergency_stop 失败时抛 Tier4FreezeFailedError |

### 5.2 性能验收（Performance AC）

| AC | 描述 |
|----|------|
| AC-P1 | `detect` P99 延迟 < 1ms |
| AC-P2 | `execute` P99 延迟 < 100ms |
| AC-P3 | WAL 写入后进程崩溃, 重启后 `list_triggers` 可恢复完整数据 |
| AC-P4 | `emergency_stop` P99 延迟 < 200ms |
| AC-P5 | `audit_logger.log` P99 < 30ms |
| AC-P6 | 并发 execute 吞吐 > 50 QPS |

### 5.3 安全验收（Security AC）

| AC | 描述 |
|----|------|
| AC-S1 | `flowforge/core/harness/magic_words.py` 不 import forgemind 或 *Forge 模块 |
| AC-S2 | Detector / Executor / AuditLogger 通过 `@inject` 注入, 无直接实例化 |
| AC-S3 | 所有 DB 操作通过 Repository, 无 `cursor.execute` |
| AC-S4 | operator-only 强制生效, Forgekin输出不触发 |
| AC-S5 | audit log 禁删除, 所有触发可追溯 |
| AC-S6 | 星星罐子立即冻结 Tier 4, 不等待Forgekin action 完成 |
| AC-S7 | 4 个 Magic Words 注入到 native_system_role 拉闸位置 |

### 5.4 Eval 验收（Eval AC）

| AC | 描述 |
|----|------|
| AC-E1 | 每次 execute 写 eval_signal "magic_word_triggered" |
| AC-E2 | 星星罐子触发写 eval_signal "tier4_frozen" |
| AC-E3 | 我能猜出来触发写 eval_signal "truth_source_injected" |
| AC-E4 | 各 Magic Word 触发频次作为 F040 控制面指标 |
| AC-E5 | 星星罐子冻结 Tier 4 次数作为严重风险监控指标 |

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003, FR-CORE-011 Magic Words）
- [doc:../arch.md#§3.3]（Harness 七层现实表面, L5 Magic Words）
- [doc:../features/F011-magic-words.md]（同号 Feature 级 SRS）
- [doc:../architecture/A011-magic-words.md]（架构权威源）
- [doc:../architecture/A002-teamact-loop.md]（任意步骤可被中断）
- [doc:../architecture/A005-at-mention-routing.md]（升级 CVO 路由）
- [doc:../architecture/A007-push-back-protocol.md]（中断辩论链）
- [doc:../architecture/A008-durable-state-surfaces.md]（thread_trace 上下文快照）
- [doc:../architecture/A010-governance-boundary.md]（native_system_role 拉闸位置）
- [doc:../architecture/A021-side-effect-wal.md]（WAL 可重放）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架, 对应 F011 / A011） | 开发者 Forgekin（猎犬·夏洛克） |

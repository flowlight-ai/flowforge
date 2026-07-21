# D005: 行首 @ 路由（At-Mention Routing）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-017）
> **对应 arch.md**: [doc:../arch.md#§3.2]
> **对应 design.md**: [doc:../design.md#§3.2]
> **对应 Feature**: [doc:../features/F005-at-mention-routing.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A005-at-mention-routing.md]（同号架构设计）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]

---

## 1. 详细设计上下文

### 1.1 详细设计问题

A005 架构设计已给出"行首 @ 路由"协议层硬要求与接口契约，但落地到代码层仍需解决以下问题：

1. **行首判定的边界条件**：`line.lstrip.startswith("@")` 在 Windows CRLF / 空白符 / 全角空格 / Markdown 引用前缀 `> @xxx` 等场景下如何机械判定？需要明确解析器规则与单元测试矩阵。
2. **意图关键词识别的歧义**：`@forgekin take` 与 `@forgekin takeover` 如何区分？关键词必须按 token 边界匹配，禁子串匹配。
3. **条件路由的语法**：`@forgekin take when CI_GREEN` 中 `when` 关键字后的条件表达式是字符串枚举还是 DSL？需要确定可解析条件集合与未知条件的回退策略。
4. **路由指令的并发分发**：同一消息中多行行首 @ 触发多个 RoutingDirective 时，分发顺序与原子性如何保证？是顺序分发还是并行分发？
5. **叙述隔离的 trace 记录格式**：句中 @ 仅记录 trace，trace 写入何处？是否进入 F018 Eval 信号？
6. **路由指令日志的回放契约**：WAL 重放时如何保证 TeamActState.current_owner 与路由日志最终一致？

### 1.2 详细设计约束

- **C1 单向依赖**：`flowforge/core/teamact/at_mention.py` 不可 import forgemind 或 *Forge 模块；仅可依赖 `core/capability/`、`core/teamact/`、`core/plugin/di_container.py`、`core/tracing.py`、`core/events/`。
- **C2 DI 注入**：`RoutingDispatcher` 必须通过 `core/plugin/di_container.py::inject` 注入 `TeamActStateRepository`、`BallCustodyRegistry`、`CapabilityRepository`、`RoutingLogStore`，禁直接实例化。
- **C3 Repository 抽象**：路由指令日志必须通过 `RoutingLogStore (ABC)` 抽象，禁 `cursor.execute`，禁 `sqlite3.connect` 直连。
- **C4 配置驱动**：`default_intent`、`supported_intents`、`ambiguous_fallback`、`condition_keywords` 必须外置到 `flowforge/config/teamact.yaml`，禁硬编码。
- **C5 行首判定**：必须使用 `line.lstrip(" \t\u3000").startswith("@")`，禁宽松正则 `^.*?@`。
- **C6 歧义回退**：重名 / 不存在 / 关键词不识别的目标必须走 `ambiguous_fallback`（默认 `notify_cvo`），禁静默丢弃。
- **C7 WAL 持久化**：`SqliteRoutingLogStore` 必须启用 `PRAGMA journal_mode=WAL` + `PRAGMA synchronous=NORMAL` + 定期 `PRAGMA wal_checkpoint(FULL)`。
- **C8 异步非阻塞**：所有 I/O 操作（Repository、EventBus 广播）必须 `async/await`，阻塞调用通过 `asyncio.to_thread` 包装。
- **C9 类型注解强制**：Python 3.11+，所有公共方法返回类型与参数类型必须显式注解。
- **C10 半角问号**：所有正则 pattern 必须使用半角 `?`，禁全角 `？`（项目记忆 20260719 已记录坑）。
- **C11 双轨命名**：代码层用 `Forgekin` / `CapabilityProfile` / `RoutingDirective`；产品文案层用"Forgekin / 能力画像 / 路由指令"。

### 1.3 详细设计影响

- **I1 对 D002 TeamAct Loop 的影响**：`TeamActLoopExecutor` 在 Owner 步与 ROUTE 步必须调用 `RoutingDispatcher.dispatch`，将解析出的 RoutingDirective 同步写入 TeamActState.current_owner。
- **I2 对 D006 Ball Custody Lease 的影响**：`take` 意图触发 `BallCustodyRegistry.acquire`；`pass` 意图触发 `BallCustodyRegistry.release`；条件路由挂起期间 lease 持续 held。
- **I3 对 D003 Handoff Capsule 的影响**：路由指令变更必须写入 HandoffCapsule.next_step 字段，使接手Forgekin可见路由上下文。
- **I4 对 D007 Push Back 的影响**：`escalate` 意图通过行首 `@cvo escalate` 升级 CVO 仲裁，触发 Push Back 辩论链。
- **I5 对 D018 Eval Contract 的影响**：路由指令日志是 trace 信号源，写入 `EvalSignalWriter` 供归因矩阵消费。
- **I6 对 D021 Side Effect WAL 的影响**：路由指令日志走 WAL，进程崩溃后可从 WAL 重放恢复 TeamActState.current_owner。
- **I7 对 D001 CapabilityProfile 的影响**：`validate_target` 通过 `CapabilityRepository.get(forgekin_id)` 校验目标合法性，目标不存在走 `ambiguous_fallback`。

---

## 2. 详细设计

### 2.1 组件类图

```
┌─────────────────────────────────────────────────────────────────────┐
│                  flowforge/core/teamact/at_mention.py                │
│                                                                     │
│  ┌──────────────────────┐   ┌────────────────────────────────────┐  │
│  │ AtMentionToken       │   │ RoutingDirective                   │  │
│  │ (Pydantic 数据模型)  │   │ (Pydantic 数据模型)                │  │
│  ├──────────────────────┤   ├────────────────────────────────────┤  │
│  │ raw_line: str        │   │ target: str                        │  │
│  │ target_forgekin_id   │   │ intent: RoutingIntent              │  │
│  │ is_routing: bool     │   │ condition: Optional[str]           │  │
│  │ routing_intent       │   │ source_forgekin_id: str            │  │
│  │ line_number: int     │   │ issued_at: datetime                │  │
│  │ source_forgekin_id   │   │ team_id: str                       │  │
│  │ condition: Opt[str]  │   │ decay_tag: DecayTag                │  │
│  └──────────────────────┘   └────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ AtMentionParser (ABC)                                        │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ + parse(message, source_forgekin_id) -> list[AtMentionToken] │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                          ▲                                          │
│                          │                                          │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ DefaultAtMentionParser                                        │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ - _line_start_matcher(line) -> bool                           │    │
│  │ - _extract_target(line) -> str                                │    │
│  │ - _extract_intent(line) -> Optional[str]                      │    │
│  │ - _extract_condition(line) -> Optional[str]                   │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ IntentRecognizer (ABC)                                       │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ + recognize(token) -> RoutingIntent                          │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                          ▲                                          │
│                          │                                          │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ KeywordIntentRecognizer                                        │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ - _intent_keywords: dict[str, RoutingIntent]                 │    │
│  │ - _default_intent: RoutingIntent                             │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ RoutingDispatcher (ABC)                                       │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ + dispatch(directive) -> DispatchResult                      │    │
│  │ + validate_target(target_id) -> bool                         │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                          ▲                                          │
│                          │                                          │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ DefaultRoutingDispatcher                                       │    │
│  ├──────────────────────────────────────────────────────────────┤    │
│  │ - _teamact_repo: TeamActStateRepository                      │    │
│  │ - _lease_registry: BallCustodyRegistry                       │    │
│  │ - _capability_repo: CapabilityRepository                     │    │
│  │ - _routing_log_store: RoutingLogStore                        │    │
│  │ - _event_bus: EventBus                                       │    │
│  │ - _eval_signal_writer: EvalSignalWriter                      │    │
│  │ - _ambiguous_fallback: str                                   │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│             flowforge/infra/repo/sqlite_routing_log.py              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ RoutingLogStore (ABC)  ◄─── abstract                          │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ + append(entry) -> str                                        │   │
│  │ + list_by_team(team_id, limit) -> list[RoutingLogEntry]      │   │
│  │ + replay_from(checkpoint_id) -> list[RoutingLogEntry]        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          ▲                                          │
│                          │                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ SqliteRoutingLogStore (WAL 持久化实现)                        │   │
│  ├──────────────────────────────────────────────────────────────┤   │
│  │ - _db_path: Path                                              │   │
│  │ - _conn: aiosqlite.Connection                                 │   │
│  │ + _ensure_schema                                            │   │
│  │ + _checkpoint                                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Pydantic 数据模型

```python
# flowforge/core/teamact/at_mention.py
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class RoutingIntent(str, Enum):
    """路由意图枚举（仅 4 种，禁第五种）"""
    TAKE = "take"               # 接球：触发 lease 注册
    PASS = "pass"               # 传球：球给下一个
    ESCALATE = "escalate"       # 升级：触发 CVO 仲裁
    BROADCAST = "broadcast"     # 广播：多目标分发


class DecayTag(str, Enum):
    """半衰期标记（Build to Persist vs Build to Delete）"""
    BUILT_TO_PERSIST = "built_to_persist"
    BUILT_TO_DELETE = "built_to_delete"
    INDIVIDUAL_COMPENSATION = "individual_compensation"


class AtMentionToken(BaseModel):
    """单条 @ 提及解析结果"""
    raw_line: str = Field(..., min_length=1, description="原始行文本")
    target_forgekin_id: str = Field(..., min_length=1, description="@ 的目标Forgekin ID")
    is_routing: bool = Field(..., description="是否为行首路由指令（True）或句中叙述（False）")
    routing_intent: Optional[RoutingIntent] = Field(
        default=None,
        description="路由意图；句中 @ 为 None",
    )
    line_number: int = Field(..., ge=1, description="消息中的行号（从 1 开始）")
    source_forgekin_id: str = Field(..., min_length=1, description="发起方Forgekin ID")
    condition: Optional[str] = Field(
        default=None,
        description="条件路由表达式（如 CI_GREEN）",
    )

    @model_validator(mode="after")
    def _check_consistency(self) -> "AtMentionToken":
        if self.is_routing and self.routing_intent is None:
            raise ValueError(
                "is_routing=True 时 routing_intent 必须非空（默认 pass 也需显式赋值）"
            )
        if not self.is_routing and self.routing_intent is not None:
            raise ValueError(
                "is_routing=False（句中叙述）时 routing_intent 必须为 None"
            )
        if not self.is_routing and self.condition is not None:
            raise ValueError("句中叙述不支持 condition 字段")
        return self


class RoutingDirective(BaseModel):
    """路由指令（行首 @ 触发）"""
    directive_id: str = Field(..., min_length=1, description="指令唯一 ID")
    team_id: str = Field(..., min_length=1, description="TeamAct team_id")
    target: str = Field(..., min_length=1, description="路由目标 forgekin_id 或团队 ID")
    intent: RoutingIntent = Field(..., description="路由意图")
    condition: Optional[str] = Field(
        default=None,
        description="条件路由表达式；非空表示挂起等待条件满足",
    )
    source_forgekin_id: str = Field(..., min_length=1, description="发起方Forgekin ID")
    issued_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="指令发出时间（UTC）",
    )
    schema_version: str = Field(default="1.0", pattern=r"^\d+\.\d+$")
    decay_tag: DecayTag = Field(
        default=DecayTag.BUILT_TO_PERSIST,
        description="路由指令协议本身是 Build to Persist 资产",
    )
    authority_level: int = Field(default=3, ge=1, le=5, description="写入 task_queue，权威等级 3")
    compression_immune: bool = Field(
        default=False,
        description="指令日志本身非治理规则，无需压缩免疫",
    )

    @field_validator("target")
    @classmethod
    def _target_non_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("RoutingDirective.target 不可为空")
        return v.strip


class DispatchResult(BaseModel):
    """路由分发结果"""
    success: bool = Field(..., description="是否分发成功")
    directive_id: str = Field(..., min_length=1)
    new_owner: Optional[str] = Field(
        default=None,
        description="分发后的新持球Forgekin ID（pass/take 成功时非空）",
    )
    lease_id: Optional[str] = Field(
        default=None,
        description="take 意图触发的 lease ID",
    )
    escalated_to_cvo: bool = Field(default=False, description="是否升级 CVO 仲裁")
    pending_condition: Optional[str] = Field(
        default=None,
        description="条件路由挂起的条件表达式",
    )
    broadcast_targets: list[str] = Field(
        default_factory=list,
        description="broadcast 意图实际分发的目标列表",
    )
    error: Optional[str] = Field(default=None, description="失败原因")
    ambiguous_fallback_triggered: bool = Field(
        default=False,
        description="是否触发了歧义回退（如 notify_cvo）",
    )


class RoutingLogEntry(BaseModel):
    """路由指令日志条目（持久化）"""
    entry_id: str = Field(..., min_length=1)
    directive_id: str = Field(..., min_length=1)
    team_id: str = Field(..., min_length=1)
    target: str
    intent: RoutingIntent
    source_forgekin_id: str
    issued_at: datetime
    dispatched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    dispatch_result: DispatchResult
    schema_version: str = Field(default="1.0", pattern=r"^\d+\.\d+$")
    decay_tag: DecayTag = Field(default=DecayTag.BUILT_TO_PERSIST)
    wal_lsn: Optional[int] = Field(
        default=None,
        description="WAL 日志序列号（重放用）",
    )
```

### 2.3 异常定义

```python
# flowforge/core/teamact/at_mention.py（续）

class AtMentionError(Exception):
    """At-Mention 路由基础异常"""


class AmbiguousTargetError(AtMentionError):
    """歧义目标（重名 / 不存在）"""

    def __init__(self, target: str, reason: str, fallback: str = "notify_cvo") -> None:
        self.target = target
        self.reason = reason
        self.fallback = fallback
        super.__init__(f"ambiguous target '{target}': {reason}; fallback={fallback}")


class InvalidIntentKeywordError(AtMentionError):
    """无法识别的意图关键词"""


class ConditionParseError(AtMentionError):
    """条件路由表达式解析失败"""


class RoutingDispatchError(AtMentionError):
    """路由分发失败（如 lease 注册失败、TeamActState 更新失败）"""


class NarrativeIsolationViolationError(AtMentionError):
    """违反叙述隔离：句中 @ 被误判为路由"""
```

### 2.4 抽象接口契约

```python
# flowforge/core/teamact/at_mention.py（续）
from abc import ABC, abstractmethod


class AtMentionParser(ABC):
    """行首 @ 解析器抽象"""

    @abstractmethod
    async def parse(
        self,
        message: str,
        source_forgekin_id: str,
    ) -> list[AtMentionToken]:
        """解析消息中的所有 @ 提及

        架构契约:
        - 行首 @ 标记 is_routing=True（lstrip 后判定）
        - 句中 @ 标记 is_routing=False（仅记录 trace）
        - 条件路由解析（@forgekin take when CI_GREEN）
        - 多行消息逐行扫描
        """


class IntentRecognizer(ABC):
    """意图识别器抽象"""

    @abstractmethod
    def recognize(self, token: AtMentionToken) -> RoutingIntent:
        """识别路由意图

        架构契约:
        - 基于行首 @ 后关键词
        - 无关键词默认 pass（配置驱动）
        - 不识别的意图走 ambiguous_fallback（不抛异常，返回 default）
        """


class RoutingDispatcher(ABC):
    """路由分发器抽象"""

    @abstractmethod
    async def dispatch(self, directive: RoutingDirective) -> DispatchResult:
        """分发路由指令

        架构契约:
        - validate_target 校验目标合法性（重名/不存在走 ambiguous_fallback）
        - take → 触发 BallCustodyRegistry.acquire，更新 TeamActState.current_owner
        - pass → 更新 TeamActState.current_owner，释放原 lease
        - escalate → 升级 CVO 仲裁（事件广播）
        - broadcast → 多目标分发（按 team_id 成员列表）
        - 条件路由挂起等待条件满足（持久化挂起状态）
        - 路由变更同步写入 TeamActState
        - 路由指令日志通过 Repository 持久化（WAL 可重放）
        """

    @abstractmethod
    async def validate_target(self, target_id: str) -> bool:
        """校验路由目标合法性

        架构契约:
        - 通过 CapabilityRepository.get(forgekin_id) 校验
        - 目标不存在返回 False（dispatch 时走 ambiguous_fallback）
        """


class RoutingLogStore(ABC):
    """路由指令日志 Repository 抽象"""

    @abstractmethod
    async def append(self, entry: RoutingLogEntry) -> str:
        """追加一条路由指令日志，返回 entry_id"""

    @abstractmethod
    async def list_by_team(
        self,
        team_id: str,
        limit: int = 100,
    ) -> list[RoutingLogEntry]:
        """列出团队路由指令日志（按 issued_at 倒序）"""

    @abstractmethod
    async def replay_from(self, checkpoint_lsn: int) -> list[RoutingLogEntry]:
        """从 WAL checkpoint 重放日志（用于进程崩溃恢复）"""
```

### 2.5 默认实现

```python
# flowforge/core/teamact/at_mention.py（续）
import re
import uuid
from core.plugin.di_container import inject


_LINE_START_AT_PATTERN = re.compile(r"^[ \t\u3000]*@")
# 行首 @ 提取目标 ID（支持 namespace:forgekin 形式，如 <forge_project>:<forgekin>）
_TARGET_PATTERN = re.compile(r"^[ \t\u3000]*@([A-Za-z0-9_:\-\.]+)")
# 意图关键词（按 token 边界匹配，防 takeover 误匹配 take）
_INTENT_PATTERN = re.compile(
    r"^[ \t\u3000]*@[A-Za-z0-9_:\-\.]+[ \t]+([A-Za-z_]+)(?:[ \t]+|$)"
)
# 条件路由：@forgekin take when CI_GREEN
_CONDITION_PATTERN = re.compile(
    r"\bwhen\b[ \t]+([A-Za-z0-9_\-\.]+)\s*$",
    flags=re.IGNORECASE,
)


class DefaultAtMentionParser(AtMentionParser):
    """默认行首 @ 解析器"""

    def __init__(
        self,
        *,
        supported_targets: Optional[set[str]] = None,
        logger_name: str = "flowforge.at_mention.parser",
    ) -> None:
        self._supported_targets = supported_targets or set
        self._logger = _get_logger(logger_name)

    async def parse(
        self,
        message: str,
        source_forgekin_id: str,
    ) -> list[AtMentionToken]:
        if not message:
            return []
        tokens: list[AtMentionToken] = []
        lines = message.splitlines
        for idx, line in enumerate(lines, start=1):
            if "@" not in line:
                continue
            is_routing = bool(_LINE_START_AT_PATTERN.match(line))
            target_match = _TARGET_PATTERN.match(line)
            if not target_match:
                # @ 不在行首或格式异常 → 视为句中叙述
                tokens.append(self._build_narrative_token(line, idx, source_forgekin_id))
                continue
            target = target_match.group(1)
            intent: Optional[RoutingIntent] = None
            condition: Optional[str] = None
            if is_routing:
                intent = self._extract_intent_keyword(line)
                condition = self._extract_condition(line)
            tokens.append(
                AtMentionToken(
                    raw_line=line,
                    target_forgekin_id=target,
                    is_routing=is_routing,
                    routing_intent=intent,
                    line_number=idx,
                    source_forgekin_id=source_forgekin_id,
                    condition=condition,
                )
            )
        return tokens

    def _build_narrative_token(
        self,
        line: str,
        line_number: int,
        source_forgekin_id: str,
    ) -> AtMentionToken:
        # 句中 @ 仅记录 trace，不触发路由
        match = re.search(r"@([A-Za-z0-9_:\-\.]+)", line)
        target = match.group(1) if match else "unknown"
        return AtMentionToken(
            raw_line=line,
            target_forgekin_id=target,
            is_routing=False,
            routing_intent=None,
            line_number=line_number,
            source_forgekin_id=source_forgekin_id,
            condition=None,
        )

    def _extract_intent_keyword(self, line: str) -> Optional[RoutingIntent]:
        match = _INTENT_PATTERN.match(line)
        if not match:
            return None  # 无关键词 → 默认 pass（由 IntentRecognizer 处理）
        keyword = match.group(1).lower
        try:
            return RoutingIntent(keyword)
        except ValueError:
            return None  # 不识别的关键词 → 走 ambiguous_fallback

    def _extract_condition(self, line: str) -> Optional[str]:
        match = _CONDITION_PATTERN.search(line)
        if not match:
            return None
        return match.group(1).upper


class KeywordIntentRecognizer(IntentRecognizer):
    """关键词意图识别器"""

    def __init__(
        self,
        *,
        default_intent: RoutingIntent = RoutingIntent.PASS,
        ambiguous_fallback: str = "notify_cvo",
    ) -> None:
        self._default_intent = default_intent
        self._ambiguous_fallback = ambiguous_fallback

    def recognize(self, token: AtMentionToken) -> RoutingIntent:
        if not token.is_routing:
            raise NarrativeIsolationViolationError(
                f"句中 @ (line {token.line_number}) 不可识别为路由意图"
            )
        if token.routing_intent is None:
            self._logger_debug(
                f"line {token.line_number}: 无意图关键词，使用 default={self._default_intent}"
            )
            return self._default_intent
        return token.routing_intent

    def _logger_debug(self, msg: str) -> None:
        # 延迟导入避免循环依赖
        from core.tracing import get_logger
        get_logger("flowforge.at_mention.recognizer").debug(msg)


class DefaultRoutingDispatcher(RoutingDispatcher):
    """默认路由分发器（DI 注入依赖）"""

    @inject
    def __init__(
        self,
        *,
        teamact_repo: "TeamActStateRepository",
        lease_registry: "BallCustodyRegistry",
        capability_repo: "CapabilityRepository",
        routing_log_store: RoutingLogStore,
        event_bus: "EventBus",
        eval_signal_writer: "EvalSignalWriter",
        ambiguous_fallback: str = "notify_cvo",
        broadcast_team_resolver: Optional["BroadcastTeamResolver"] = None,
    ) -> None:
        self._teamact_repo = teamact_repo
        self._lease_registry = lease_registry
        self._capability_repo = capability_repo
        self._routing_log_store = routing_log_store
        self._event_bus = event_bus
        self._eval_signal_writer = eval_signal_writer
        self._ambiguous_fallback = ambiguous_fallback
        self._broadcast_team_resolver = broadcast_team_resolver
        from core.tracing import get_logger
        self._logger = get_logger("flowforge.at_mention.dispatcher")

    async def dispatch(self, directive: RoutingDirective) -> DispatchResult:
        self._logger.info(
            "dispatch.start directive_id=%s target=%s intent=%s condition=%s",
            directive.directive_id,
            directive.target,
            directive.intent,
            directive.condition,
        )
        # 1. 条件路由：若 condition 非空，先挂起等待
        if directive.condition is not None:
            return await self._dispatch_pending(directive)

        # 2. 目标校验
        is_valid = await self.validate_target(directive.target)
        if not is_valid:
            return await self._handle_ambiguous(directive, reason="target_not_found")

        # 3. 按意图分发
        try:
            if directive.intent == RoutingIntent.TAKE:
                result = await self._dispatch_take(directive)
            elif directive.intent == RoutingIntent.PASS:
                result = await self._dispatch_pass(directive)
            elif directive.intent == RoutingIntent.ESCALATE:
                result = await self._dispatch_escalate(directive)
            elif directive.intent == RoutingIntent.BROADCAST:
                result = await self._dispatch_broadcast(directive)
            else:  # pragma: no cover - 枚举穷尽
                raise InvalidIntentKeywordError(f"unsupported intent: {directive.intent}")
        except Exception as exc:
            self._logger.exception("dispatch.failed directive_id=%s", directive.directive_id)
            result = DispatchResult(
                success=False,
                directive_id=directive.directive_id,
                error=f"{type(exc).__name__}: {exc}",
            )

        # 4. 持久化路由指令日志（无论成功失败都记录）
        await self._append_log(directive, result)
        # 5. 广播事件 + 写 Eval 信号
        await self._event_bus.publish_async(
            "routing.directive.dispatched",
            {"directive_id": directive.directive_id, "result": result.model_dump},
        )
        self._eval_signal_writer.write_trace(
            signal_type="routing_dispatch",
            payload={
                "directive_id": directive.directive_id,
                "intent": directive.intent.value,
                "target": directive.target,
                "success": result.success,
            },
        )
        return result

    async def validate_target(self, target_id: str) -> bool:
        if not target_id:
            return False
        # 支持 team_id 形式（broadcast 场景）
        if target_id.startswith("team:"):
            return True
        try:
            profile = await self._capability_repo.get(target_id)
            return profile is not None
        except Exception:
            return False

    async def _dispatch_take(self, directive: RoutingDirective) -> DispatchResult:
        # 释放原 lease（如有）+ acquire 新 lease
        current_state = await self._teamact_repo.load(directive.team_id)
        if current_state and current_state.current_owner == directive.target:
            # 已持球，无需重复 acquire
            return DispatchResult(
                success=True,
                directive_id=directive.directive_id,
                new_owner=directive.target,
                lease_id=None,
            )
        lease_id = await self._lease_registry.acquire_for(
            forgekin_id=directive.target,
            team_id=directive.team_id,
            reason="at_mention_take",
            next_step="resumed_by_at_mention",
        )
        # 更新 TeamActState.current_owner
        await self._teamact_repo.update_owner(
            team_id=directive.team_id,
            new_owner=directive.target,
        )
        return DispatchResult(
            success=True,
            directive_id=directive.directive_id,
            new_owner=directive.target,
            lease_id=lease_id,
        )

    async def _dispatch_pass(self, directive: RoutingDirective) -> DispatchResult:
        # 释放原 lease（如有）+ 更新 owner
        current_state = await self._teamact_repo.load(directive.team_id)
        if current_state and current_state.current_owner:
            try:
                await self._lease_registry.release_for(
                    forgekin_id=current_state.current_owner,
                    team_id=directive.team_id,
                )
            except Exception as exc:
                self._logger.warning(
                    "release_for failed for previous owner: %s", exc
                )
        await self._teamact_repo.update_owner(
            team_id=directive.team_id,
            new_owner=directive.target,
        )
        return DispatchResult(
            success=True,
            directive_id=directive.directive_id,
            new_owner=directive.target,
        )

    async def _dispatch_escalate(self, directive: RoutingDirective) -> DispatchResult:
        await self._event_bus.publish_async(
            "cvo.escalate.requested",
            {
                "directive_id": directive.directive_id,
                "team_id": directive.team_id,
                "target": directive.target,
                "source": directive.source_forgekin_id,
            },
        )
        return DispatchResult(
            success=True,
            directive_id=directive.directive_id,
            escalated_to_cvo=True,
        )

    async def _dispatch_broadcast(self, directive: RoutingDirective) -> DispatchResult:
        if not self._broadcast_team_resolver:
            return DispatchResult(
                success=False,
                directive_id=directive.directive_id,
                error="broadcast_team_resolver not configured",
            )
        members = await self._broadcast_team_resolver.resolve_members(directive.target)
        for member_id in members:
            await self._event_bus.publish_async(
                "routing.broadcast.received",
                {
                    "directive_id": directive.directive_id,
                    "target_member": member_id,
                    "source": directive.source_forgekin_id,
                },
            )
        return DispatchResult(
            success=True,
            directive_id=directive.directive_id,
            broadcast_targets=members,
        )

    async def _dispatch_pending(self, directive: RoutingDirective) -> DispatchResult:
        # 条件路由：持久化挂起，等待 WakeupScheduler 触发
        await self._teamact_repo.record_pending_directive(
            team_id=directive.team_id,
            directive=directive,
        )
        return DispatchResult(
            success=True,
            directive_id=directive.directive_id,
            pending_condition=directive.condition,
        )

    async def _handle_ambiguous(
        self,
        directive: RoutingDirective,
        reason: str,
    ) -> DispatchResult:
        self._logger.warning(
            "ambiguous target directive_id=%s target=%s reason=%s fallback=%s",
            directive.directive_id,
            directive.target,
            reason,
            self._ambiguous_fallback,
        )
        if self._ambiguous_fallback == "notify_cvo":
            await self._event_bus.publish_async(
                "cvo.ambiguous_target.notify",
                {
                    "directive_id": directive.directive_id,
                    "target": directive.target,
                    "reason": reason,
                },
            )
        return DispatchResult(
            success=False,
            directive_id=directive.directive_id,
            error=f"ambiguous target: {reason}",
            ambiguous_fallback_triggered=True,
        )

    async def _append_log(
        self,
        directive: RoutingDirective,
        result: DispatchResult,
    ) -> None:
        entry = RoutingLogEntry(
            entry_id=f"rle-{uuid.uuid4.hex[:16]}",
            directive_id=directive.directive_id,
            team_id=directive.team_id,
            target=directive.target,
            intent=directive.intent,
            source_forgekin_id=directive.source_forgekin_id,
            issued_at=directive.issued_at,
            dispatch_result=result,
        )
        await self._routing_log_store.append(entry)


def _get_logger(name: str):
    from core.tracing import get_logger
    return get_logger(name)
```

### 2.6 关键算法伪代码

**算法 1：行首 @ 解析（parse）**

```
function parse(message, source_forgekin_id):
    tokens = []
    lines = message.splitlines
    for idx, line in enumerate(lines, start=1):
        if "@" not in line:
            continue
        is_routing = line.lstrip(" \t\u3000").startswith("@")
        target_match = TARGET_PATTERN.match(line)
        if not target_match:
            tokens.append(build_narrative_token(line, idx))
            continue
        target = target_match.group(1)
        intent = None
        condition = None
        if is_routing:
            intent = extract_intent_keyword(line)   # 默认 None（→ pass）
            condition = extract_condition(line)     # 默认 None
        tokens.append(AtMentionToken(
            raw_line=line, target_forgekin_id=target,
            is_routing=is_routing, routing_intent=intent,
            line_number=idx, source_forgekin_id=source_forgekin_id,
            condition=condition
        ))
    return tokens
```

**算法 2：意图识别（recognize）**

```
function recognize(token):
    if not token.is_routing:
        raise NarrativeIsolationViolationError
    if token.routing_intent is None:
        return default_intent  # 默认 RoutingIntent.PASS
    return token.routing_intent
```

**算法 3：路由分发（dispatch）**

```
async function dispatch(directive):
    if directive.condition is not None:
        return await dispatch_pending(directive)  # 挂起等待
    if not await validate_target(directive.target):
        return await handle_ambiguous(directive, "target_not_found")
    switch directive.intent:
        case TAKE:    result = await dispatch_take(directive)
        case PASS:    result = await dispatch_pass(directive)
        case ESCALATE: result = await dispatch_escalate(directive)
        case BROADCAST: result = await dispatch_broadcast(directive)
    await append_log(directive, result)
    await event_bus.publish("routing.directive.dispatched", ...)
    eval_signal_writer.write_trace(...)
    return result
```

**算法 4：WAL 重放（replay_from_checkpoint）**

```
async function replay_from_checkpoint(checkpoint_lsn):
    entries = await routing_log_store.replay_from(checkpoint_lsn)
    for entry in entries:
        # 按 issued_at 顺序重放
        if entry.dispatch_result.success and entry.dispatch_result.new_owner:
            await teamact_repo.update_owner(
                team_id=entry.team_id,
                new_owner=entry.dispatch_result.new_owner,
            )
            # 幂等：update_owner 内部按最新 issued_at 覆盖
```

---

## 3. 模块实现

### 3.1 SqliteRoutingLogStore 实现

```python
# flowforge/infra/repo/sqlite_routing_log.py
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

import aiosqlite

from core.teamact.at_mention import (
    RoutingLogEntry,
    RoutingLogStore,
)


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS routing_log (
    entry_id          TEXT PRIMARY KEY,
    directive_id      TEXT NOT NULL,
    team_id           TEXT NOT NULL,
    target            TEXT NOT NULL,
    intent            TEXT NOT NULL,
    source_forgekin_id TEXT NOT NULL,
    issued_at         TEXT NOT NULL,
    dispatched_at     TEXT NOT NULL,
    dispatch_result   TEXT NOT NULL,
    schema_version    TEXT NOT NULL DEFAULT '1.0',
    decay_tag         TEXT NOT NULL DEFAULT 'built_to_persist',
    wal_lsn           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_routing_log_team
    ON routing_log(team_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_routing_log_lsn
    ON routing_log(wal_lsn);
"""


class SqliteRoutingLogStore(RoutingLogStore):
    """路由指令日志 SQLite WAL 持久化实现"""

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None
        self._lock = asyncio.Lock

    async def _ensure_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = await aiosqlite.connect(str(self._db_path))
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.execute("PRAGMA foreign_keys=ON")
            await self._conn.executescript(_SCHEMA_SQL)
            await self._conn.commit
        return self._conn

    async def append(self, entry: RoutingLogEntry) -> str:
        conn = await self._ensure_conn
        async with self._lock:
            # 获取 WAL LSN（rowid 作为简易 LSN）
            cursor = await conn.execute(
                """
                INSERT INTO routing_log
                    (entry_id, directive_id, team_id, target, intent,
                     source_forgekin_id, issued_at, dispatched_at,
                     dispatch_result, schema_version, decay_tag, wal_lsn)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    entry.entry_id,
                    entry.directive_id,
                    entry.team_id,
                    entry.target,
                    entry.intent.value,
                    entry.source_forgekin_id,
                    entry.issued_at.isoformat,
                    entry.dispatched_at.isoformat,
                    entry.dispatch_result.model_dump_json,
                    entry.schema_version,
                    entry.decay_tag.value,
                ),
            )
            await conn.commit
            wal_lsn = cursor.lastrowid
            await cursor.close
            await self._checkpoint_if_needed(conn)
        # 回填 wal_lsn
            entry.wal_lsn = wal_lsn
            await conn.execute(
                "UPDATE routing_log SET wal_lsn=? WHERE entry_id=?",
                (wal_lsn, entry.entry_id),
            )
            await conn.commit
        return entry.entry_id

    async def list_by_team(
        self,
        team_id: str,
        limit: int = 100,
    ) -> list[RoutingLogEntry]:
        conn = await self._ensure_conn
        cursor = await conn.execute(
            """
            SELECT entry_id, directive_id, team_id, target, intent,
                   source_forgekin_id, issued_at, dispatched_at,
                   dispatch_result, schema_version, decay_tag, wal_lsn
            FROM routing_log
            WHERE team_id=?
            ORDER BY issued_at DESC
            LIMIT ?
            """,
            (team_id, limit),
        )
        rows = await cursor.fetchall
        await cursor.close
        return [self._row_to_entry(r) for r in rows]

    async def replay_from(self, checkpoint_lsn: int) -> list[RoutingLogEntry]:
        conn = await self._ensure_conn
        cursor = await conn.execute(
            """
            SELECT entry_id, directive_id, team_id, target, intent,
                   source_forgekin_id, issued_at, dispatched_at,
                   dispatch_result, schema_version, decay_tag, wal_lsn
            FROM routing_log
            WHERE wal_lsn > ?
            ORDER BY wal_lsn ASC
            """,
            (checkpoint_lsn,),
        )
        rows = await cursor.fetchall
        await cursor.close
        return [self._row_to_entry(r) for r in rows]

    async def _checkpoint_if_needed(self, conn: aiosqlite.Connection) -> None:
        # 每 100 条日志做一次 FULL checkpoint
        cursor = await conn.execute("SELECT COUNT(*) FROM routing_log")
        count = (await cursor.fetchone)[0]
        await cursor.close
        if count % 100 == 0:
            await conn.execute("PRAGMA wal_checkpoint(FULL)")

    def _row_to_entry(self, row) -> RoutingLogEntry:
        from datetime import datetime
        from core.teamact.at_mention import (
            DecayTag,
            DispatchResult,
            RoutingIntent,
        )
        return RoutingLogEntry(
            entry_id=row[0],
            directive_id=row[1],
            team_id=row[2],
            target=row[3],
            intent=RoutingIntent(row[4]),
            source_forgekin_id=row[5],
            issued_at=datetime.fromisoformat(row[6]),
            dispatched_at=datetime.fromisoformat(row[7]),
            dispatch_result=DispatchResult.model_validate_json(row[8]),
            schema_version=row[9],
            decay_tag=DecayTag(row[10]),
            wal_lsn=row[11],
        )

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close
            self._conn = None
```

### 3.2 关键流程时序图

**时序图 1：行首 @ take 路由（成功路径）**

```
ForgekinA    AtMentionParser   IntentRecognizer   RoutingDispatcher   TeamActRepo   LeaseRegistry   RoutingLogStore   EventBus
  │             │                   │                   │                │              │                │              │
  │ parse(msg)  │                   │                   │                │              │                │              │
  ├────────────>│                   │                   │                │              │                │              │
  │             │ 逐行扫描           │                   │                │              │                │              │
  │             │ 返回 tokens        │                   │                │              │                │              │
  │<────────────┤                   │                   │                │              │                │              │
  │             │                   │                   │                │              │                │              │
  │ recognize(token)                │                   │                │              │                │              │
  ├────────────────────────────────>│                   │                │              │                │              │
  │             │                   │ 返回 TAKE          │                │              │                │              │
  │<────────────────────────────────┤                   │                │              │                │              │
  │             │                   │                   │                │              │                │              │
  │ build RoutingDirective          │                   │                │              │                │              │
  │ dispatch(directive)             │                   │                │              │                │              │
  ├────────────────────────────────────────────────────>│                │              │                │              │
  │             │                   │                   │ validate_target│              │                │              │
  │             │                   │                   ├───────────────>│              │                │              │
  │             │                   │                   │<───────────────┤              │                │              │
  │             │                   │                   │ true           │              │                │              │
  │             │                   │                   │                │              │                │              │
  │             │                   │                   │ acquire_for(target)           │                │              │
  │             │                   │                   ├──────────────────────────────>│                │              │
  │             │                   │                   │<──────────────────────────────┤ lease_id       │              │
  │             │                   │                   │                │              │                │              │
  │             │                   │                   │ update_owner(team, target)    │                │              │
  │             │                   │                   ├───────────────>│              │                │              │
  │             │                   │                   │<───────────────┤ ok           │                │              │
  │             │                   │                   │                │              │                │              │
  │             │                   │                   │ append(entry)                                  │              │
  │             │                   │                   ├───────────────────────────────────────────────>│              │
  │             │                   │                   │<───────────────────────────────────────────────┤ entry_id     │
  │             │                   │                   │                │              │                │              │
  │             │                   │                   │ publish("routing.directive.dispatched")        │              │
  │             │                   │                   ├──────────────────────────────────────────────────────────────>│
  │             │                   │                   │                │              │                │              │
  │ DispatchResult(success=True, new_owner=target, lease_id=...)        │              │                │              │
  │<────────────────────────────────────────────────────┤                │              │                │              │
```

**时序图 2：歧义目标回退**

```
ForgekinA    RoutingDispatcher   CapabilityRepo   EventBus(CVO)
  │             │                   │                │
  │ dispatch(directive, target="unknown_agent")     │
  ├────────────>│                   │                │
  │             │ validate_target   │                │
  │             ├──────────────────>│                │
  │             │<──────────────────┤ False (None)   │
  │             │                   │                │
  │             │ handle_ambiguous  │                │
  │             │ publish("cvo.ambiguous_target.notify")              │
  │             ├───────────────────────────────────>│                │
  │             │                   │                │                │
  │ DispatchResult(success=False, ambiguous_fallback_triggered=True,  │
  │               error="ambiguous target: target_not_found")         │
  │<────────────┤                   │                │
```

### 3.3 错误处理策略

| # | 异常场景 | 触发条件 | 处理策略 | 重试 | 用户感知 |
|---|---------|---------|---------|:----:|---------|
| EH-1 | 目标不存在 | `capability_repo.get(target)` 返回 None | 走 `ambiguous_fallback`（默认 notify_cvo），记录 trace | 否 | DispatchResult.error="ambiguous target: target_not_found" |
| EH-2 | 重名目标 | 同一 forgekin_id 解析出多个 profile（理论上 CapabilityRepository 唯一） | 走 `ambiguous_fallback`，CVO 仲裁 | 否 | 同 EH-1，reason="duplicate_target" |
| EH-3 | 关键词不识别 | `_extract_intent_keyword` 返回 None（不在 4 种枚举内） | IntentRecognizer 使用 default_intent=PASS | 否 | DispatchResult 正常返回，但 trace 记录 "unknown_keyword_fallback_to_pass" |
| EH-4 | 条件路由表达式不识别 | `when` 后关键词不在 `condition_keywords` 配置中 | 走 `ambiguous_fallback`，记录 trace | 否 | DispatchResult.error="unknown_condition_keyword" |
| EH-5 | lease 注册失败 | `BallCustodyRegistry.acquire_for` 抛异常（如一Forgekin已持球） | DispatchResult.success=False，error 透传 | 否 | error="LeaseAlreadyHeld: forgekin_id=xxx" |
| EH-6 | TeamActState 更新失败 | `teamact_repo.update_owner` 抛异常（如 DB 锁） | DispatchResult.success=False，已 acquire 的 lease 需回滚 release | 否 | error="TeamActStateUpdateFailed" |
| EH-7 | WAL 写入失败 | `routing_log_store.append` 抛异常（如磁盘满） | 重试 3 次（指数退避 100ms/200ms/400ms）；仍失败则降级写入 fallback log 文件 + 告警 | 是（3次） | DispatchResult 仍返回成功，但 trace 标记 "log_persistence_failed" |
| EH-8 | EventBus 广播失败 | `event_bus.publish_async` 超时或异常 | 仅 log warning，不影响 DispatchResult | 否 | trace 标记 "event_bus_publish_failed" |
| EH-9 | Eval 信号写入失败 | `eval_signal_writer.write_trace` 异常 | 仅 log warning | 否 | trace 标记 "eval_signal_failed" |
| EH-10 | 条件路由挂起持久化失败 | `teamact_repo.record_pending_directive` 异常 | DispatchResult.success=False，error="PendingPersistFailed" | 否 | 用户感知指令未挂起 |
| EH-11 | 句中 @ 被误判为路由 | `IntentRecognizer.recognize` 收到 `is_routing=False` 的 token | 抛 `NarrativeIsolationViolationError`，trace 记录 | 否 | 单元测试拦截 |
| EH-12 | 重复 dispatch（同一 directive_id） | RoutingLogStore 已存在相同 directive_id | 幂等返回原 DispatchResult，不重复执行 | 否 | trace 标记 "duplicate_directive_ignored" |

### 3.4 性能优化

| # | 指标 | 目标 | 优化手段 |
|---|------|------|---------|
| P-1 | `parse` 延迟（10 行消息） | < 5ms | 预编译正则（模块级 `_TARGET_PATTERN` 等）；splitlines 一次扫描 |
| P-2 | `recognize` 延迟 | < 1ms | 纯内存枚举查找，无 I/O |
| P-3 | `validate_target` 延迟 | < 50ms | CapabilityRepository 内存 LRU 缓存（容量 1000，TTL 60s） |
| P-4 | `dispatch` 端到端延迟（take 意图，不含 lease acquire） | < 100ms | 并行：`validate_target` 与 `teamact_repo.load` 同时启动 |
| P-5 | `routing_log_store.append` 延迟 | < 20ms | WAL 模式 + `synchronous=NORMAL`；批量 checkpoint 而非每条 checkpoint |
| P-6 | `replay_from` 吞吐（1000 条日志） | < 500ms | 按 `wal_lsn` 索引扫描；批量加载到内存 |
| P-7 | 并发 dispatch 吞吐（10 团队并发） | > 50 ops/s | RoutingLogStore 内 `asyncio.Lock` 仅保护写，读不锁；EventBus 异步发布不阻塞主流程 |
| P-8 | 内存占用（10 万条路由日志） | < 50MB | 不在内存缓存日志；按需查询 DB |
| P-9 | 条件路由挂起检查延迟 | < 10ms | WakeupScheduler 定期扫描 pending_directive，按 condition 索引 |

### 3.5 YAML 配置示例

```yaml
# flowforge/config/teamact.yaml
at_mention:
  # 默认意图（行首 @ 后无关键词时）
  default_intent: pass
  # 支持的意图列表（仅 4 种，禁第五种）
  supported_intents:
    - take
    - pass
    - escalate
    - broadcast
  # 歧义回退策略（重名/不存在/不识别时）
  ambiguous_fallback: notify_cvo
  # 支持的条件路由关键词（白名单）
  condition_keywords:
    - CI_GREEN
    - CVO_CONFIRM
    - TIMER_EXPIRED
    - EXTERNAL_EVENT
  # 行首判定时需忽略的前缀字符（半角空格、Tab、全角空格）
  line_start_strip_chars: [" ", "\t", "\u3000"]
  # 叙述 @ 是否写 trace（不影响路由，仅 Eval 信号）
  trace_narrative_mentions: true
  # routing_log_store 配置
  routing_log_store:
    backend: sqlite
    db_path: data/teamact/routing_log.db
    checkpoint_every_n_writes: 100
  # broadcast 团队解析器
  broadcast_team_resolver:
    type: static_config
    teams:
      team:<forge_project_id_1>:all:
        - <forge_project_id_1>:<forgekin_1>
        - <forge_project_id_1>:<forgekin_2>
        - <forge_project_id_1>:<forgekin_3>
        - <forge_project_id_1>:<forgekin_4>
        - <forge_project_id_1>:<forgekin_5>
        - <forge_project_id_1>:<forgekin_6>
      team:<forge_project_id_2>:all:
        - <forge_project_id_2>:<forgekin_1>
        - <forge_project_id_2>:<forgekin_2>
        - <forge_project_id_2>:<forgekin_3>
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖调用

#### 4.1.1 D002 TeamAct Loop 在 Owner 步调用

```python
# flowforge/loop/executor.py（节选，仅展示与 D005 协作部分）
from core.teamact.at_mention import (
    AtMentionToken,
    DefaultAtMentionParser,
    DefaultRoutingDispatcher,
    KeywordIntentRecognizer,
    RoutingDirective,
    RoutingIntent,
)


class TeamActLoopExecutor:
    def __init__(
        self,
        parser: DefaultAtMentionParser,
        recognizer: KeywordIntentRecognizer,
        dispatcher: DefaultRoutingDispatcher,
        ...
    ) -> None:
        self._parser = parser
        self._recognizer = recognizer
        self._dispatcher = dispatcher
        ...

    async def _execute_owner_step(
        self,
        team_id: str,
        message: str,
        source_forgekin_id: str,
    ) -> str:
        # 1. 解析消息中所有 @ 提及
        tokens = await self._parser.parse(message, source_forgekin_id)
        # 2. 过滤出行首路由指令
        routing_tokens = [t for t in tokens if t.is_routing]
        # 3. 句中 @ 仅记录 trace（写 Eval 信号）
        narrative_tokens = [t for t in tokens if not t.is_routing]
        for nt in narrative_tokens:
            self._eval_signal_writer.write_trace(
                signal_type="narrative_at_mention",
                payload={
                    "line_number": nt.line_number,
                    "target": nt.target_forgekin_id,
                    "source": nt.source_forgekin_id,
                },
            )
        # 4. 逐个分发路由指令（顺序，禁并行，保证 owner 单调）
        current_owner: Optional[str] = None
        for token in routing_tokens:
            intent = self._recognizer.recognize(token)
            directive = RoutingDirective(
                directive_id=f"dir-{uuid.uuid4.hex[:16]}",
                team_id=team_id,
                target=token.target_forgekin_id,
                intent=intent,
                condition=token.condition,
                source_forgekin_id=source_forgekin_id,
            )
            result = await self._dispatcher.dispatch(directive)
            if result.success and result.new_owner:
                current_owner = result.new_owner
        return current_owner or source_forgekin_id
```

#### 4.1.2 D001 CapabilityProfile 提供 validate_target 数据源

```python
# flowforge/core/capability/router.py（节选）
from core.teamact.at_mention import RoutingDispatcher


class CapabilityRepository:
    async def get(self, forgekin_id: str) -> Optional[CapabilityProfile]:
        # 从 SQLite + LRU 缓存读取
        ...
```

### 4.2 下游影响实现

#### 4.2.1 D006 Ball Custody Lease 响应 take/pass

```python
# flowforge/core/teamact/lease.py（节选）
class BallCustodyRegistry:
    async def acquire_for(
        self,
        forgekin_id: str,
        team_id: str,
        reason: str,
        next_step: str,
    ) -> str:
        # 校验一Forgekin同时只能持有一个 lease
        existing = await self._find_active_lease_by_forgekin(forgekin_id)
        if existing:
            raise LeaseAlreadyHeld(
                f"forgekin {forgekin_id} already holds lease {existing.lease_id}"
            )
        lease = BallCustodyLease(
            lease_id=f"lease-{uuid.uuid4.hex[:16]}",
            team_id=team_id,
            forgekin_id=forgekin_id,
            reason=reason,
            next_step=next_step,
            expected_wake_at=datetime.now(timezone.utc) + timedelta(seconds=1800),
        )
        return await self._store.save(lease)

    async def release_for(
        self,
        forgekin_id: str,
        team_id: str,
    ) -> None:
        lease = await self._find_active_lease_by_forgekin(forgekin_id)
        if lease:
            await self._store.mark_released(lease.lease_id)
```

#### 4.2.2 D003 Handoff Capsule 同步 next_step

```python
# flowforge/core/teamact/handoff.py（节选）
class HandoffCapsuleStore:
    async def update_next_step_for_routing(
        self,
        team_id: str,
        directive: RoutingDirective,
    ) -> None:
        latest = await self.read_latest(team_id)
        if latest is None:
            return  # 无胶囊可更新
        latest.next_step = (
            f"[routing:{directive.intent.value}] target={directive.target}"
            f" condition={directive.condition or 'none'}"
        )
        await self.write(latest)
```

#### 4.2.3 D007 Push Back 响应 escalate 意图

```python
# flowforge/core/teamact/push_back.py（节选）
class DebateOrchestrator:
    async def handle_escalate_from_at_mention(
        self,
        directive: RoutingDirective,
    ) -> None:
        # 行首 @cvo escalate 触发，创建新的 DebateChain 升级到 CVO
        await self.escalate(
            pushback_id=f"at_mention_escalate_{directive.directive_id}",
            reason=f"at_mention_escalate from {directive.source_forgekin_id}",
        )
```

#### 4.2.4 D018 Eval Contract 写 trace 信号

```python
# flowforge/core/harness/eval_signal.py（节选）
class EvalSignalWriter:
    def write_trace(
        self,
        signal_type: str,
        payload: dict,
    ) -> None:
        # 写入 Eval 信号库（供 F019 三方信号交叉消费）
        ...
```

#### 4.2.5 D021 Side Effect WAL 重放

```python
# flowforge/infra/repo/side_effect_wal.py（节选）
class SideEffectWalReplayer:
    async def replay_routing_directives(
        self,
        dispatcher: DefaultRoutingDispatcher,
        checkpoint_lsn: int,
    ) -> None:
        # 进程崩溃恢复时重放路由指令日志
        entries = await dispatcher._routing_log_store.replay_from(checkpoint_lsn)
        for entry in entries:
            if entry.dispatch_result.success and entry.dispatch_result.new_owner:
                await dispatcher._teamact_repo.update_owner(
                    team_id=entry.team_id,
                    new_owner=entry.dispatch_result.new_owner,
                )
```

### 4.3 集成测试点

| # | 测试点 | 验证内容 | 铁律关联 |
|---|-------|---------|---------|
| IT-1 | 行首 @ take 完整链路 | parse → recognize → dispatch → lease acquire → TeamActState 更新 → 日志写入 | T1 真实 LLM 生成消息；T4 真实 lease 注册 |
| IT-2 | 句中 @ 叙述隔离 | parse 标记 is_routing=False；不触发 lease/owner 变更；写 narrative trace | T3 必须断言 is_routing=False |
| IT-3 | 条件路由挂起 | `@forgekin take when CI_GREEN` 解析出 condition=CI_GREEN；dispatch 挂起到 teamact_repo.record_pending_directive | T3 断言 pending_condition 非空 |
| IT-4 | 歧义目标回退 | `@unknown_agent take` → DispatchResult.success=False，ambiguous_fallback_triggered=True，CVO 收到 notify 事件 | T3 断言 fallback 触发 |
| IT-5 | escalate 升级 CVO | `@cvo escalate` → event_bus 发布 cvo.escalate.requested | T4 真实 EventBus |
| IT-6 | broadcast 多目标分发 | `@team:<forge_project_id>:all broadcast` → 所有成员收到 routing.broadcast.received 事件 | T3 断言 broadcast_targets 长度 |
| IT-7 | WAL 重放一致性 | 写入 100 条路由日志 → 进程崩溃（模拟）→ replay_from(0) → TeamActState.current_owner 与最后一条日志一致 | T6 MetricsCollector 采集 |
| IT-8 | 重复 directive 幂等 | 同一 directive_id dispatch 两次 → 第二次返回原 DispatchResult，不重复 acquire lease | T3 断言 lease_count 不变 |
| IT-9 | 多行消息混合路由+叙述 | 同一消息含 3 行行首 @ + 2 行句中 @ → tokens 长度 5，routing_tokens 长度 3 | T3 断言分类正确 |
| IT-10 | 全角空格行首判定 | `"　@forgekin take"`（前缀全角空格 U+3000）→ is_routing=True | T3 边界条件 |
| IT-11 | CRLF 换行符 | Windows CRLF 消息正常 splitlines，line_number 连续 | T3 跨平台 |
| IT-12 | 不识别关键词回退 | `@forgekin takeover`（takeover 不在枚举）→ recognize 返回 default_intent=PASS | T3 断言 intent=PASS |
| IT-13 | 跨厂商 review 场景 | author=DeepSeek, reviewer=Qwen 通过行首 @ 路由切换 owner，盲点不重叠 | T1 真实跨厂商 LLM |

---

## 5. 详细设计验收

### 5.1 功能验收（AC）

| AC # | 验收点 | 验证方法 |
|------|-------|---------|
| AC-F-1 | `flowforge/core/teamact/at_mention.py` 不 import forgemind 或 *Forge 模块 | 静态扫描 import 语句 |
| AC-F-2 | `RoutingDispatcher` 通过 DI 容器 `inject` 注入，无直接实例化 | 代码审查 + DI 容器单测 |
| AC-F-3 | 路由指令日志通过 `RoutingLogStore (ABC)` 持久化，无 `cursor.execute` | grep `cursor.execute` 在 at_mention 模块返回空 |
| AC-F-4 | `default_intent` / `supported_intents` / `ambiguous_fallback` / `condition_keywords` 外置到 `flowforge/config/teamact.yaml` | YAML 加载测试 |
| AC-F-5 | 路由指令日志走 WAL（`PRAGMA journal_mode=WAL`） | DB pragma 查询 |
| AC-F-6 | 行首 @ 触发路由（`is_routing=True`），句中 @ 仅记录 trace（`is_routing=False`） | 单元测试矩阵（10+ 边界用例） |
| AC-F-7 | 路由意图可识别 take/pass/escalate/broadcast，无关键词默认 pass | 单元测试 |
| AC-F-8 | 条件路由可挂起等待条件满足后触发 | 集成测试 IT-3 |
| AC-F-9 | 歧义目标（重名/不存在）走 `ambiguous_fallback` 不静默丢弃 | 集成测试 IT-4 |
| AC-F-10 | 路由变更同步写入 `TeamActState.current_owner` | 集成测试 IT-1 |
| AC-F-11 | `take` 意图触发 `BallCustodyRegistry.acquire` | 集成测试 IT-1 |
| AC-F-12 | `pass` 意图触发 `BallCustodyRegistry.release_for` 释放原 lease | 集成测试 |
| AC-F-13 | `escalate` 意图升级 CVO 仲裁（发布事件） | 集成测试 IT-5 |
| AC-F-14 | `broadcast` 意图多目标分发 | 集成测试 IT-6 |
| AC-F-15 | 路由指令日志可回放（`replay_from`）恢复 TeamActState | 集成测试 IT-7 |
| AC-F-16 | 重复 `directive_id` 幂等处理 | 集成测试 IT-8 |
| AC-F-17 | 路由变更同步写入 HandoffCapsule.next_step | 集成测试 |
| AC-F-18 | 所有正则 pattern 使用半角 `?`，禁全角 `？` | 静态扫描 |

### 5.2 性能验收

| AC # | 验收点 | 指标 |
|------|-------|------|
| AC-P-1 | `parse` 10 行消息延迟 | < 5ms（P99） |
| AC-P-2 | `validate_target` 延迟（缓存命中） | < 5ms（P99） |
| AC-P-3 | `dispatch` 端到端延迟（take，缓存命中） | < 100ms（P99） |
| AC-P-4 | `routing_log_store.append` 延迟 | < 20ms（P99） |
| AC-P-5 | `replay_from` 1000 条日志吞吐 | < 500ms |
| AC-P-6 | 10 团队并发 dispatch 吞吐 | > 50 ops/s |

### 5.3 安全验收

| AC # | 验收点 |
|------|-------|
| AC-S-1 | 路由指令日志通过 Repository 抽象，无 `cursor.execute` / `sqlite3.connect` 直连 |
| AC-S-2 | `validate_target` 拒绝未知目标，走 `ambiguous_fallback` |
| AC-S-3 | Forgekin输出不触发 Magic Words（本模块不涉及 Magic Words，但需保证Forgekin不可伪造 `source_forgekin_id`） |
| AC-S-4 | 路由指令日志写入 audit，禁删除 |
| AC-S-5 | 条件路由挂起状态持久化，进程崩溃可恢复 |
| AC-S-6 | WAL 文件权限 0600（仅 owner 读写） |

### 5.4 Eval 验收

| AC # | 验收点 |
|------|-------|
| AC-E-1 | 路由指令日志作为 trace 信号写入 `EvalSignalWriter` |
| AC-E-2 | 句中 @ 叙述也写 trace（供 F019 三方信号交叉分析） |
| AC-E-3 | 歧义回退触发频次作为 Eval 信号（高频说明解析器或目标注册有问题） |
| AC-E-4 | 条件路由挂起时长作为 Eval 信号（过长说明外部条件未满足） |
| AC-E-5 | 路由正确率（被路由目标是否适合任务）由 F018 Eval Contract 周期评估 |

---

## 6. 引用

- [doc:../spec.md#§3.2]（FR-CORE-002，FR-CORE-017 行首 @ 路由 + Push Back 协议）
- [doc:../arch.md#§3.2]（TeamAct 六步循环，行首 @ 路由协议）
- [doc:../architecture/A005-at-mention-routing.md]（同号架构设计，权威源）
- [doc:../features/F005-at-mention-routing.md]（同号 Feature 级 SRS）
- [doc:D002-teamact-loop.md]（TeamAct Owner/ROUTE 步消费路由指令）
- [doc:D001-capability-profile.md]（validate_target 数据源）
- [doc:D003-handoff-capsule.md]（next_step 同步）
- [doc:D004-pingpong-circuit-breaker.md]（lease held 期间空传联动）
- [doc:D006-ball-custody-lease.md]（take 触发 lease 注册，pass 触发释放）
- [doc:D007-push-back-protocol.md]（escalate 触发 CVO 升级）
- [doc:D018-eval-contract.md]（trace 信号源）
- [doc:D021-side-effect-wal.md]（WAL 重放契约）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）
- [doc:../../../hiclaw/rules.md#红线11]（禁止硬编码提示词）
- [doc:../../../hiclaw/rules.md#红线12]（禁止绕过 DI 容器）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 A005 架构与 F005 Feature SRS） | 开发者 Forgekin（猎犬·夏洛克） |

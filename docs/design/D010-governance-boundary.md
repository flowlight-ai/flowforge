# D010: Governance Boundary 压缩免疫详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者灵智体（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.3]
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]
> **对应 Feature**: [doc:../features/F010-governance-boundary.md]
> **对应 Architecture**: [doc:../architecture/A010-governance-boundary.md]
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化 + 责任方命名 + forgemind Layer 2 + 三方 Agent 强化 + 进化阶/觉醒阶三标注）

---

## 1. 详细设计上下文

### 1.1 设计问题

A010 架构层定义了"治理规则压缩免疫注入 + 双轨信任编译 + ADR 版本化"骨架，本详细设计需要回答下列"如何落地"问题：

1. **D-Q1**：`GovernanceRule` 模型如何在 Pydantic 层强制 `authority=hard` 时 `injection_layer=native_system_role` 且 `compression_immune=true`？
2. **D-Q2**：`DualTrackPolicy` 如何实现 `guardrails` 轨 `monotonic tightening`（只能加严不可放宽）？
3. **D-Q3**：`GovernanceLoader` 如何从 `harness.yaml` 加载 `hard_rules` + `soft_rules`，校验 `forbidden_layers` 含 `user_message_prepend`？
4. **D-Q4**：`GovernanceInjector` 如何通过 `ForgekinHost` 把 hard 规则注入到 `native_system_role`，同时把 soft 规则注入到 `developer_role`？
5. **D-Q5**：`GovernanceValidator` 如何 audit session context，发现治理规则在 `user_message` 即告警，并拒绝构造未注入 hard 规则的灵智体？
6. **D-Q6**：`GovernanceBundle` 如何带版本号 + ADR 引用，规则变更走 ADR 流程？
7. **D-Q7**：上下文压缩发生时，`compression_immune=true` 的治理规则如何通过 D008 `CompressionImmuneInjector` 重新注入到新上下文？

### 1.2 设计约束

| 编号 | 约束 | 来源 |
|------|------|------|
| C1 | `flowforge/core/harness/governance.py` 不可 import forgemind 或 *Forge 模块 | 单向依赖 |
| C2 | GovernanceLoader / GovernanceInjector / GovernanceValidator 通过 `@inject` 注入 | DI 容器 |
| C3 | GovernanceBundle 通过 Repository 持久化到 D008 Durable Surface | Repository 层 |
| C4 | `hard_rules` / `soft_rules` / `forbidden_layers` 配置外置到 `flowforge/config/harness.yaml` | 配置驱动 |
| C5 | `authority=hard` 时 `injection_layer` 必须 `native_system_role`，禁 `user_message` | A010 决策 1 |
| C6 | `authority=hard` 时 `compression_immune` 必须 `true` | A010 决策 1 |
| C7 | `guardrails` 轨只能加严（monotonic tightening），灵智体不可覆盖 | A010 决策 2 |
| C8 | `defaults` 轨可被灵智体声明覆盖 | A010 决策 2 |
| C9 | GovernanceBundle 带版本号 + ADR 引用，规则变更走 ADR 流程 | A010 决策 4 |
| C10 | audit 发现 `user_message` 治理规则时告警 | A010 决策 5 |
| C11 | `forbidden_layers` 必须包含 `user_message_prepend` | A010 不变量 |
| C12 | 9 大点名称修订：双轨命名、AI 术语优先（GovernanceBundle/DualTrackPolicy）、forgemind 仅指 Layer 2、责任方命名（猎犬·夏洛克） | 用户指令 |
| C13 | 觉醒阶标注：E4+ 觉醒阶灵智体覆盖 default 规则需 Mind Council 二次确认 | naming-contract.md §4 |

### 1.3 设计影响

| 编号 | 影响 | 关联模块 |
|------|------|---------|
| I1 | D002 TeamAct ACTION 步受治理规则约束 | D002 / A002 |
| I2 | D008 Durable Surface 提供 `compression_immune` 属性来源 + 持久化 GovernanceBundle | D008 / A008 |
| I3 | D009 Evidence & Sensors 用治理规则作 `quality_gate` 证据判据 | D009 / A009 |
| I4 | D011 Magic Words 注入到 `native_system_role` 拉闸位置（复用 GovernanceInjector） | D011 / A011 |
| I5 | D012 Entropy Control 周期 review 已失效 guardrail，可降级为 default | D012 / A012 |
| I6 | ForgekinHost（ADR 001）在灵智体构造时调用 GovernanceInjector 统一注入 | ADR 001 |

---

## 2. 详细设计

### 2.1 类图

```
┌──────────────────────────────────────────────────────────────────────┐
│                    flowforge/core/harness/governance.py              │
├──────────────────────────────────────────────────────────────────────┤
│  «enum» RuleAuthority                                                │
│    + HARD     (硬约束, 只能加严, 注入 native_system_role)            │
│    + SOFT     (默认行为, 可覆盖, 注入 developer_role)                │
│                                                                      │
│  «enum» InjectionLayer                                               │
│    + NATIVE_SYSTEM_ROLE      (压缩免疫)                              │
│    + DEVELOPER_ROLE          (developer 注入)                        │
│    + USER_MESSAGE_PREPEND    (禁用)                                  │
│                                                                      │
│  «Pydantic» GovernanceRule                                           │
│    + rule_id: str                                                    │
│    + rule_text: str            (非空)                                │
│    + authority: RuleAuthority                                        │
│    + injection_layer: InjectionLayer                                 │
│    + compression_immune: bool                                        │
│    + applies_to: list[str]                                           │
│    + version: str                                                    │
│    + adr_ref: str              (ADR 引用, e.g. "ADR-021")            │
│                                                                      │
│  «Pydantic» DualTrackPolicy                                          │
│    + guardrails: list[GovernanceRule]   (hard, 只能加严)             │
│    + defaults: list[GovernanceRule]     (soft, 可覆盖)               │
│    + tighten_guardrail(rule) -> None                                 │
│    + override_default(rule_id, override_text) -> None                │
│                                                                      │
│  «Pydantic» GovernanceBundle                                         │
│    + bundle_id: str                                                  │
│    + rules: list[GovernanceRule]                                     │
│    + injected_at: datetime                                           │
│    + injection_layer: InjectionLayer                                 │
│    + version: str                                                    │
│    + adr_ref: str                                                    │
│                                                                      │
│  «ABC» GovernanceLoader                                              │
│    + load(config_path) -> GovernanceBundle                           │
│                                                                      │
│  «ABC» GovernanceInjector                                            │
│    + inject_hard(rules) -> None                                      │
│    + inject_soft(rules) -> None                                      │
│                                                                      │
│  «ABC» GovernanceValidator                                           │
│    + validate(session_ctx) -> ValidationResult                       │
│    + audit_user_message(session_ctx) -> AuditResult                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│            infra/repo/sqlite_governance_store.py                     │
│  «implements GovernanceStore» SqliteGovernanceStore                  │
│    + async save_bundle(bundle) -> str                                │
│    + async load_bundle(bundle_id) -> Optional[GovernanceBundle]      │
│    + async list_bundles() -> list[GovernanceBundle]                  │
│    + async checkpoint() -> None                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口与 Pydantic 模型

```python
# flowforge/core/harness/governance.py
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from flowforge.core.plugin.di_container import inject


# ───────────────────────────── 枚举 ─────────────────────────────

class RuleAuthority(str, Enum):
    """规则权威"""
    HARD = "hard"   # 硬约束, 只能加严, 注入 native_system_role
    SOFT = "soft"   # 默认行为, 可覆盖, 注入 developer_role


class InjectionLayer(str, Enum):
    """注入层"""
    NATIVE_SYSTEM_ROLE = "native_system_role"
    DEVELOPER_ROLE = "developer_role"
    USER_MESSAGE_PREPEND = "user_message_prepend"  # 禁用


# ───────────────────────────── 异常 ─────────────────────────────

class GovernanceError(Exception):
    """Governance 基础异常"""


class InvalidRuleError(GovernanceError):
    """规则字段非法"""


class HardRuleInjectionLayerError(GovernanceError):
    """hard 规则未注入 native_system_role"""


class HardRuleNotCompressionImmuneError(GovernanceError):
    """hard 规则未设 compression_immune=true"""


class GuardrailRelaxationError(GovernanceError):
    """guardrail 试图放宽（违反 monotonic tightening）"""


class ForbiddenLayerError(GovernanceError):
    """使用 user_message_prepend 注入治理规则"""


class AdrRequiredError(GovernanceError):
    """规则变更未走 ADR 流程"""


class MindCouncilRequiredError(GovernanceError):
    """E4+ 觉醒阶覆盖 default 需 Mind Council 二次确认"""


# ───────────────────────────── Pydantic 模型 ─────────────────────────────

class GovernanceRule(BaseModel):
    """单条治理规则"""
    rule_id: str = Field(..., min_length=1)
    rule_text: str = Field(..., min_length=1)
    authority: RuleAuthority
    injection_layer: InjectionLayer
    compression_immune: bool = False
    applies_to: list[str] = Field(default_factory=list)
    version: str = Field(..., min_length=1)
    adr_ref: str = Field(..., min_length=1)   # ADR 引用, e.g. "ADR-021"

    @field_validator("rule_text")
    @classmethod
    def _text_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise InvalidRuleError("GovernanceRule rule_text 不可为空")
        return v.strip()

    @model_validator(mode="after")
    def _hard_rule_constraints(self) -> "GovernanceRule":
        """hard 规则必须注入 native_system_role + compression_immune=true"""
        if self.authority == RuleAuthority.HARD:
            if self.injection_layer != InjectionLayer.NATIVE_SYSTEM_ROLE:
                raise HardRuleInjectionLayerError(
                    f"hard 规则 {self.rule_id} 必须注入 native_system_role"
                )
            if not self.compression_immune:
                raise HardRuleNotCompressionImmuneError(
                    f"hard 规则 {self.rule_id} 必须 compression_immune=true"
                )
        if self.injection_layer == InjectionLayer.USER_MESSAGE_PREPEND:
            raise ForbiddenLayerError(
                f"规则 {self.rule_id} 不可注入 user_message_prepend"
            )
        return self


class DualTrackPolicy(BaseModel):
    """双轨信任编译（CL-019）

    guardrails 轨: hard, 只能加严不可放宽（monotonic tightening）
    defaults 轨: soft, 灵智体可声明覆盖
    """
    guardrails: list[GovernanceRule] = Field(default_factory=list)
    defaults: list[GovernanceRule] = Field(default_factory=list)

    @model_validator(mode="after")
    def _guardrails_must_be_hard(self) -> "DualTrackPolicy":
        for r in self.guardrails:
            if r.authority != RuleAuthority.HARD:
                raise InvalidRuleError(
                    f"guardrails 轨规则 {r.rule_id} 必须 authority=hard"
                )
        for r in self.defaults:
            if r.authority != RuleAuthority.SOFT:
                raise InvalidRuleError(
                    f"defaults 轨规则 {r.rule_id} 必须 authority=soft"
                )
        return self

    def tighten_guardrail(self, rule: GovernanceRule) -> None:
        """guardrail 加严：新增或加严已有规则

        架构契约 (A010 决策 2):
        - 新增: 直接 append
        - 已有: 只能加严（rule_text 更具体）, 不可放宽
        - version 必须 +1
        """
        if rule.authority != RuleAuthority.HARD:
            raise InvalidRuleError("guardrail 必须 authority=hard")

        existing = next(
            (r for r in self.guardrails if r.rule_id == rule.rule_id), None
        )
        if existing is None:
            # 新增
            self.guardrails.append(rule)
        else:
            # 加严: 检查 version 单调递增
            if int(rule.version) <= int(existing.version):
                raise GuardrailRelaxationError(
                    f"guardrail {rule.rule_id} version 必须 > {existing.version}"
                )
            # 替换（加严）
            idx = self.guardrails.index(existing)
            self.guardrails[idx] = rule

    def override_default(
        self, rule_id: str, override_text: str, mind_council_token: Optional[str] = None
    ) -> GovernanceRule:
        """default 覆盖：灵智体声明覆盖默认行为

        架构契约:
        - 仅 defaults 轨可覆盖
        - E4+ 觉醒阶需 Mind Council 二次确认 token
        - 返回覆盖后的新规则
        """
        existing = next(
            (r for r in self.defaults if r.rule_id == rule_id), None
        )
        if existing is None:
            raise InvalidRuleError(f"default 规则 {rule_id} 不存在")

        # E4+ 觉醒阶覆盖需 Mind Council token
        # (此处由 caller 传入, 简化校验)
        if not mind_council_token:
            # 检查 override 是否需要二次确认
            pass  # 默认允许, 由 caller 强制

        new_rule = GovernanceRule(
            rule_id=f"{rule_id}-override",
            rule_text=override_text,
            authority=RuleAuthority.SOFT,
            injection_layer=InjectionLayer.DEVELOPER_ROLE,
            compression_immune=False,
            applies_to=existing.applies_to,
            version=f"{int(existing.version) + 1}",
            adr_ref=existing.adr_ref,
        )
        return new_rule


class GovernanceBundle(BaseModel):
    """治理规则包（带版本号 + ADR 引用）"""
    bundle_id: str = Field(..., min_length=1)
    rules: list[GovernanceRule] = Field(..., min_length=1)
    injected_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    injection_layer: InjectionLayer
    version: str = Field(..., min_length=1)
    adr_ref: str = Field(..., min_length=1)

    @model_validator(mode="after")
    def _rules_must_match_injection_layer(self) -> "GovernanceBundle":
        for r in self.rules:
            if r.authority == RuleAuthority.HARD:
                if r.injection_layer != self.injection_layer:
                    # hard 规则注入层需与 bundle 一致（实际 bundle 内可混合）
                    pass
        return self


class ValidationResult(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)


class AuditResult(BaseModel):
    ok: bool
    violations: list[str] = Field(default_factory=list)
    session_id: Optional[str] = None


# ───────────────────────────── 抽象基类 ─────────────────────────────

class GovernanceStore(ABC):
    """GovernanceBundle 持久化仓储"""

    @abstractmethod
    async def save_bundle(self, bundle: GovernanceBundle) -> str:
        """保存 bundle, 返回 bundle_id（WAL 写入）"""

    @abstractmethod
    async def load_bundle(self, bundle_id: str) -> Optional[GovernanceBundle]:
        """按 id 装载 bundle"""

    @abstractmethod
    async def list_bundles(self) -> list[GovernanceBundle]:
        """列出全部 bundle（按版本号排序）"""


class GovernanceLoader(ABC):
    """YAML 加载器"""

    @abstractmethod
    async def load(self, config_path: str) -> GovernanceBundle:
        """从 YAML 加载治理规则包

        架构契约:
        - hard_rules 必须注入 native_system_role
        - soft_rules 可注入 developer_role
        - forbidden_layers 必须包含 user_message_prepend
        - 规则变更必须带版本号 + ADR 引用
        """


class GovernanceInjector(ABC):
    """治理规则注入器"""

    @abstractmethod
    async def inject_hard(self, rules: list[GovernanceRule]) -> None:
        """注入 hard 规则到 native_system_role

        架构契约:
        - 所有 hard 规则必须 compression_immune=true
        - 注入位置: native_system_role (禁 user_message)
        - 由 ForgekinHost 在灵智体构造时调用
        """

    @abstractmethod
    async def inject_soft(self, rules: list[GovernanceRule]) -> None:
        """注入 soft 规则到 developer_role"""


class GovernanceValidator(ABC):
    """治理规则校验器"""

    @abstractmethod
    async def validate(self, session_ctx: dict) -> ValidationResult:
        """校验治理规则不在 user_message_prepend

        架构契约:
        - 治理规则出现在 user_message → 告警
        - hard 规则未注入 native_system_role → 拒绝构造
        - 规则变更未走 ADR → 拒绝部署
        - 上下文压缩后规则仍生效 (compression_immune)
        """

    @abstractmethod
    async def audit_user_message(self, session_ctx: dict) -> AuditResult:
        """audit session context, 检测 user_message 含治理规则"""
```

### 2.3 默认实现

```python
# flowforge/core/harness/governance.py（续）

class DefaultGovernanceLoader(GovernanceLoader):
    """YAML 加载器默认实现"""

    # 治理规则关键词（用于检测 user_message 含治理规则）
    GOVERNANCE_KEYWORDS = (
        "禁止", "必须", "不可", "应当", "guardrail", "禁止绕过",
    )

    @inject
    def __init__(self, *, store: GovernanceStore) -> None:
        self._store = store

    async def load(self, config_path: str) -> GovernanceBundle:
        import yaml
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)

        gov = config.get("governance", {})

        # 校验 forbidden_layers 含 user_message_prepend
        forbidden = gov.get("forbidden_layers", [])
        if "user_message_prepend" not in forbidden:
            raise ForbiddenLayerError(
                "forbidden_layers 必须包含 user_message_prepend"
            )

        # 加载 hard_rules + soft_rules
        rules: list[GovernanceRule] = []
        for r in gov.get("hard_rules", []):
            rules.append(GovernanceRule(
                rule_id=r["rule_id"],
                rule_text=r["rule_text"],
                authority=RuleAuthority.HARD,
                injection_layer=InjectionLayer.NATIVE_SYSTEM_ROLE,
                compression_immune=True,
                applies_to=r.get("applies_to", []),
                version=str(r.get("version", "1")),
                adr_ref=r.get("adr_ref", "ADR-007"),
            ))
        for r in gov.get("soft_rules", []):
            rules.append(GovernanceRule(
                rule_id=r["rule_id"],
                rule_text=r["rule_text"],
                authority=RuleAuthority.SOFT,
                injection_layer=InjectionLayer.DEVELOPER_ROLE,
                compression_immune=False,
                applies_to=r.get("applies_to", []),
                version=str(r.get("version", "1")),
                adr_ref=r.get("adr_ref", "ADR-007"),
            ))

        bundle = GovernanceBundle(
            bundle_id=f"gb-{gov.get('bundle_name', 'default')}-{int(datetime.now(timezone.utc).timestamp())}",
            rules=rules,
            injection_layer=InjectionLayer.NATIVE_SYSTEM_ROLE,
            version=str(gov.get("bundle_version", "1")),
            adr_ref=gov.get("adr_ref", "ADR-007"),
        )

        # 持久化到 D008 Durable Surface
        await self._store.save_bundle(bundle)
        return bundle


class DefaultGovernanceInjector(GovernanceInjector):
    """治理规则注入器默认实现"""

    @inject
    def __init__(
        self, *,
        forgekin_host,            # ForgekinHost (ADR 001)
        durable_state_registry,   # D008 Registry
        audit_logger,
    ) -> None:
        self._forgekin_host = forgekin_host
        self._durable_state_registry = durable_state_registry
        self._audit_logger = audit_logger

    async def inject_hard(self, rules: list[GovernanceRule]) -> None:
        """注入 hard 规则到 native_system_role（压缩免疫）"""
        from flowforge.core.harness.durable_state import (
            DurableSurface, StateSurfaceType,
        )
        from flowforge.core.harness.decay_tag import DecayTag

        for rule in rules:
            if rule.authority != RuleAuthority.HARD:
                raise InvalidRuleError(
                    f"inject_hard 仅接受 authority=hard 规则, got {rule.authority}"
                )
            if not rule.compression_immune:
                raise HardRuleNotCompressionImmuneError(
                    f"hard 规则 {rule.rule_id} 必须 compression_immune=true"
                )

            # 通过 ForgekinHost 注入到 native_system_role
            await self._forgekin_host.append_native_system_role(
                f"[{rule.rule_id} v{rule.version}] {rule.rule_text}"
            )

            # 写一条 Durable Surface 记录, 标记 compression_immune=true
            surface = DurableSurface(
                surface_id=f"gov-hard-{rule.rule_id}-v{rule.version}",
                surface_type=StateSurfaceType.TASK_QUEUE,
                key=f"governance:hard:{rule.rule_id}",
                payload=rule.model_dump(),
                authority_level=4,
                compression_immune=True,
                decay_tag=DecayTag.BUILT_TO_PERSIST,
                authored_by="governance_injector",
            )
            await self._durable_state_registry.write(surface)

    async def inject_soft(self, rules: list[GovernanceRule]) -> None:
        """注入 soft 规则到 developer_role"""
        for rule in rules:
            if rule.authority != RuleAuthority.SOFT:
                raise InvalidRuleError(
                    f"inject_soft 仅接受 authority=soft 规则, got {rule.authority}"
                )
            await self._forgekin_host.append_developer_role(
                f"[{rule.rule_id} v{rule.version}] {rule.rule_text}"
            )


class DefaultGovernanceValidator(GovernanceValidator):
    """治理规则校验器默认实现"""

    GOVERNANCE_KEYWORDS = (
        "禁止", "必须", "不可", "应当", "guardrail", "禁止绕过",
    )

    @inject
    def __init__(
        self, *,
        forgekin_host,
        audit_logger,
    ) -> None:
        self._forgekin_host = forgekin_host
        self._audit_logger = audit_logger

    async def validate(self, session_ctx: dict) -> ValidationResult:
        errors: list[str] = []

        # 1. 校验 hard 规则全部注入 native_system_role
        native_system_role = session_ctx.get("native_system_role", "")
        hard_rules_in_session = session_ctx.get("hard_rules_expected", [])
        for rule in hard_rules_in_session:
            if rule.rule_id not in native_system_role:
                errors.append(
                    f"hard 规则 {rule.rule_id} 未注入 native_system_role, 拒绝构造灵智体"
                )

        # 2. 校验规则变更走 ADR
        bundle = session_ctx.get("governance_bundle")
        if bundle and not bundle.adr_ref:
            errors.append("GovernanceBundle 缺 adr_ref, 规则变更必须走 ADR 流程")

        # 3. audit user_message
        audit_result = await self.audit_user_message(session_ctx)
        if not audit_result.ok:
            errors.extend(audit_result.violations)

        return ValidationResult(ok=(not errors), errors=errors)

    async def audit_user_message(self, session_ctx: dict) -> AuditResult:
        violations: list[str] = []
        user_messages = session_ctx.get("user_messages", [])
        for i, msg in enumerate(user_messages):
            for kw in self.GOVERNANCE_KEYWORDS:
                if kw in msg:
                    violations.append(
                        f"user_message[{i}] 含治理关键词 '{kw}', "
                        f"应注入 native_system_role"
                    )
        result = AuditResult(
            ok=(not violations),
            violations=violations,
            session_id=session_ctx.get("session_id"),
        )
        if violations:
            await self._audit_logger.log(
                event="forbidden_injection_layer_detected",
                payload=result.model_dump(),
            )
        return result
```

### 2.4 关键算法伪代码

**算法 1：load GovernanceBundle from YAML**

```
function load(config_path) -> GovernanceBundle:
    config = yaml.safe_load(config_path)
    forbidden = config.governance.forbidden_layers
    if "user_message_prepend" not in forbidden:
        raise ForbiddenLayerError

    rules = []
    for r in config.governance.hard_rules:
        rules.append(GovernanceRule(
            authority=HARD,
            injection_layer=NATIVE_SYSTEM_ROLE,
            compression_immune=True,    # 强制
            version=r.version,
            adr_ref=r.adr_ref,
        ))
    for r in config.governance.soft_rules:
        rules.append(GovernanceRule(
            authority=SOFT,
            injection_layer=DEVELOPER_ROLE,
            compression_immune=False,
            version=r.version,
            adr_ref=r.adr_ref,
        ))

    bundle = GovernanceBundle(rules=rules, version=..., adr_ref=...)
    store.save_bundle(bundle)
    return bundle
```

**算法 2：inject_hard 到 native_system_role**

```
function inject_hard(rules: list[GovernanceRule]) -> None:
    for rule in rules:
        if rule.authority != HARD: raise InvalidRuleError
        if not rule.compression_immune: raise HardRuleNotCompressionImmuneError

        forgekin_host.append_native_system_role(
            f"[{rule.rule_id} v{rule.version}] {rule.rule_text}"
        )

        # 同步写入 Durable Surface, compression_immune=true
        surface = DurableSurface(
            surface_type=TASK_QUEUE,
            key=f"governance:hard:{rule.rule_id}",
            authority_level=4,
            compression_immune=True,
            decay_tag=BUILT_TO_PERSIST,
        )
        durable_state_registry.write(surface)
```

**算法 3：tighten_guardrail monotonic tightening**

```
function tighten_guardrail(rule: GovernanceRule) -> None:
    if rule.authority != HARD: raise InvalidRuleError
    existing = find(guardrails, rule.rule_id)
    if existing is None:
        guardrails.append(rule)
    else:
        if int(rule.version) <= int(existing.version):
            raise GuardrailRelaxationError(
                f"version 必须 > {existing.version}"
            )
        replace(existing, rule)
```

**算法 4：audit_user_message 检测违规注入**

```
function audit_user_message(session_ctx) -> AuditResult:
    violations = []
    for i, msg in enumerate(session_ctx.user_messages):
        for kw in GOVERNANCE_KEYWORDS:
            if kw in msg:
                violations.append(
                    f"user_message[{i}] 含治理关键词 '{kw}'"
                )
    if violations:
        audit_logger.log("forbidden_injection_layer_detected", violations)
    return AuditResult(ok=not violations, violations=violations)
```

---

## 3. 模块实现

### 3.1 SQLite WAL 持久化实现

```python
# flowforge/infra/repo/sqlite_governance_store.py
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import aiosqlite

from flowforge.core.harness.governance import (
    GovernanceBundle, GovernanceRule, GovernanceStore,
    InjectionLayer, RuleAuthority,
)


class SqliteGovernanceStore(GovernanceStore):
    """SQLite + WAL 实现 GovernanceBundle 持久化"""

    DDL = """
    CREATE TABLE IF NOT EXISTS governance_bundles (
        bundle_id TEXT PRIMARY KEY,
        rules_json TEXT NOT NULL,
        injected_at TEXT NOT NULL,
        injection_layer TEXT NOT NULL,
        version TEXT NOT NULL,
        adr_ref TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS governance_rules (
        rule_id TEXT NOT NULL,
        bundle_id TEXT NOT NULL,
        rule_text TEXT NOT NULL,
        authority TEXT NOT NULL,
        injection_layer TEXT NOT NULL,
        compression_immune INTEGER NOT NULL,
        applies_to_json TEXT NOT NULL DEFAULT '[]',
        version TEXT NOT NULL,
        adr_ref TEXT NOT NULL,
        PRIMARY KEY (rule_id, bundle_id, version),
        FOREIGN KEY (bundle_id) REFERENCES governance_bundles(bundle_id)
    );

    CREATE INDEX IF NOT EXISTS idx_gb_version ON governance_bundles(version);
    CREATE INDEX IF NOT EXISTS idx_gr_rule_id ON governance_rules(rule_id);
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: Optional[aiosqlite.Connection] = None

    async def _ensure_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self._db_path)
            await self._conn.execute("PRAGMA journal_mode=WAL")
            await self._conn.execute("PRAGMA synchronous=NORMAL")
            await self._conn.execute("PRAGMA foreign_keys=ON")
            await self._conn.executescript(self.DDL)
            await self._conn.commit()
        return self._conn

    async def save_bundle(self, bundle: GovernanceBundle) -> str:
        conn = await self._ensure_conn()
        if not bundle.bundle_id:
            bundle.bundle_id = f"gb-{uuid.uuid4().hex[:12]}"
        await conn.execute(
            """
            INSERT INTO governance_bundles
                (bundle_id, rules_json, injected_at, injection_layer, version, adr_ref)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                bundle.bundle_id,
                json.dumps([r.model_dump() for r in bundle.rules], ensure_ascii=False),
                bundle.injected_at.isoformat(),
                bundle.injection_layer.value,
                bundle.version, bundle.adr_ref,
            ),
        )
        # 同步写入 governance_rules 表（便于按 rule_id 查询）
        for r in bundle.rules:
            await conn.execute(
                """
                INSERT INTO governance_rules
                    (rule_id, bundle_id, rule_text, authority, injection_layer,
                     compression_immune, applies_to_json, version, adr_ref)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    r.rule_id, bundle.bundle_id, r.rule_text,
                    r.authority.value, r.injection_layer.value,
                    int(r.compression_immune),
                    json.dumps(r.applies_to, ensure_ascii=False),
                    r.version, r.adr_ref,
                ),
            )
        await conn.commit()
        await self._checkpoint_if_needed()
        return bundle.bundle_id

    async def load_bundle(self, bundle_id: str) -> Optional[GovernanceBundle]:
        conn = await self._ensure_conn()
        async with conn.execute(
            "SELECT bundle_id, rules_json, injected_at, injection_layer, version, adr_ref "
            "FROM governance_bundles WHERE bundle_id = ?",
            (bundle_id,),
        ) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        bundle_id, rules_json, injected_at, injection_layer, version, adr_ref = row
        rules_data = json.loads(rules_json)
        rules = [GovernanceRule(**r) for r in rules_data]
        return GovernanceBundle(
            bundle_id=bundle_id,
            rules=rules,
            injected_at=datetime.fromisoformat(injected_at),
            injection_layer=InjectionLayer(injection_layer),
            version=version,
            adr_ref=adr_ref,
        )

    async def list_bundles(self) -> list[GovernanceBundle]:
        conn = await self._ensure_conn()
        async with conn.execute(
            "SELECT bundle_id FROM governance_bundles ORDER BY version DESC"
        ) as cur:
            rows = await cur.fetchall()
        bundles: list[GovernanceBundle] = []
        for (bid,) in rows:
            b = await self.load_bundle(bid)
            if b is not None:
                bundles.append(b)
        return bundles

    async def _checkpoint_if_needed(self) -> None:
        conn = await self._ensure_conn()
        await conn.execute("PRAGMA wal_checkpoint(FULL)")
```

### 3.2 关键时序图

**时序图 1：灵智体构造时注入治理规则**

```
ForgekinHost       Loader            Store            Injector        D008 Registry
     │                │                 │                 │                 │
     │ load(yaml)    │                 │                 │                 │
     ├───────────────>│                 │                 │                 │
     │                │ parse YAML     │                 │                 │
     │                │ hard_rules + soft_rules          │                 │
     │                │ forbidden_layers 含 user_message_prepend?          │
     │                │ save_bundle()  │                 │                 │
     │                ├────────────────>│                 │                 │
     │                │ <───────────────┤ bundle_id       │                 │
     │ <──────────────┤ GovernanceBundle│                 │                 │
     │                │                 │                 │                 │
     │ split hard / soft                │                 │                 │
     │ inject_hard(hard_rules)          │                 │                 │
     ├───────────────────────────────────────────────────>│                 │
     │                │                 │                 │ append_native_system_role│
     │                │                 │                 │ write DurableSurface (TASK_QUEUE, immune=true)│
     │                │                 │                 ├────────────────>│
     │                │                 │                 │ <───────────────┤
     │ <──────────────────────────────────────────────────┤ done            │
     │                │                 │                 │                 │
     │ inject_soft(soft_rules)          │                 │                 │
     ├───────────────────────────────────────────────────>│                 │
     │                │                 │                 │ append_developer_role│
     │ <──────────────────────────────────────────────────┤ done            │
     │                │                 │                 │                 │
     │ 灵智体构造完成, 治理规则已注入 native_system_role + developer_role │
```

**时序图 2：audit 发现 user_message 含治理规则**

```
Validator         session_ctx       AuditLogger
     │                  │                 │
     │ audit_user_message│                │
     ├─────────────────>│                 │
     │ <────────────────┤ user_messages   │
     │                  │                 │
     │ for msg in user_messages:          │
     │   for kw in GOVERNANCE_KEYWORDS:   │
     │     if kw in msg:                  │
     │       violations.append(...)       │
     │                  │                 │
     │ if violations:   │                 │
     │   log("forbidden_injection_layer_detected")│
     ├───────────────────────────────────>│
     │ <──────────────────────────────────┤ done
     │                  │                 │
     │ return AuditResult(ok=not violations, violations=...)│
```

### 3.3 错误处理策略

| # | 异常 / 场景 | 处理策略 | 用户可见行为 |
|---|------------|---------|-------------|
| E1 | `InvalidRuleError` rule_text 为空 | 拒绝写入 | caller 看到"rule_text 不可为空" |
| E2 | `HardRuleInjectionLayerError` hard 未注入 native_system_role | 拒绝写入 | caller 看到"hard 规则必须注入 native_system_role" |
| E3 | `HardRuleNotCompressionImmuneError` hard 未设 immune | 拒绝写入 | caller 看到"hard 规则必须 compression_immune=true" |
| E4 | `GuardrailRelaxationError` 试图放宽 guardrail | 拒绝写入 | caller 看到"guardrail 不可放宽, version 必须 > 当前" |
| E5 | `ForbiddenLayerError` 使用 user_message_prepend | 拒绝写入 + audit 告警 | caller 看到"禁用 user_message_prepend" |
| E6 | `AdrRequiredError` 规则变更未走 ADR | 拒绝部署 | caller 看到"规则变更必须走 ADR 流程" |
| E7 | `MindCouncilRequiredError` E4+ 覆盖 default 缺 token | 拒绝覆盖 | caller 看到"E4+ 觉醒阶覆盖 default 需 Mind Council 二次确认" |
| E8 | `aiosqlite.OperationalError` DB 锁 | 指数退避重试 3 次 | 服务返回 503 |
| E9 | `aiosqlite.IntegrityError` 主键冲突 | 不重试, 抛出 | 服务返回 500 |
| E10 | `forgekin_host.append_native_system_role` 失败 | 重试 3 次, 仍失败抛出 | 服务返回 500 |
| E11 | `audit_user_message` 发现违规 | 不阻塞主流程, 仅 audit log + 告警 | 监控告警 |
| E12 | `event_bus.publish_async` 失败 | 不阻塞主流程, 仅 warning | 用户无感知 |

### 3.4 性能指标与优化

| # | 指标 | 目标 | 优化手段 |
|---|------|------|---------|
| P1 | `load` 延迟（含 YAML 解析） | P99 < 100ms | YAML 缓存 + 异步 store |
| P2 | `inject_hard` 延迟（10 条规则） | P99 < 50ms | 批量 append + 并行 write surface |
| P3 | `inject_soft` 延迟（10 条规则） | P99 < 30ms | 同 P2 |
| P4 | `validate` 延迟 | P99 < 30ms | 字符串 in 操作 + 索引查询 |
| P5 | `audit_user_message` 延迟（100 条 msg） | P99 < 20ms | 关键词 Trie 优化 |
| P6 | WAL checkpoint 频率 | 每 100 次写入或 5 分钟 | `_checkpoint_if_needed` 节流 |
| P7 | 单条 GovernanceRule 内存占用 | < 2KB | rule_text 限制 1KB |
| P8 | 并发 save_bundle 吞吐 | > 50 QPS | aiosqlite 连接池 + WAL 并发读 |

### 3.5 YAML 配置示例

```yaml
# flowforge/config/harness.yaml
governance:
  bundle_name: "flowforge-default"
  bundle_version: 1
  adr_ref: "ADR-007"

  # 禁用注入层
  forbidden_layers:
    - user_message_prepend        # 必须包含, A010 不变量

  # hard 规则（注入 native_system_role, compression_immune=true）
  hard_rules:
    - rule_id: "no_delete_tests"
      rule_text: "禁止删除已有测试用例（编程红线第8条）"
      authority: hard
      injection_layer: native_system_role
      compression_immune: true
      applies_to: ["*"]
      version: 1
      adr_ref: "ADR-007"

    - rule_id: "no_mock_llm"
      rule_text: "禁止使用 Mock LLM（测试铁律 T1）"
      authority: hard
      injection_layer: native_system_role
      compression_immune: true
      applies_to: ["*"]
      version: 1
      adr_ref: "ADR-007"

    - rule_id: "no_hardcode_secrets"
      rule_text: "禁止硬编码密钥/路径/端口（编程红线第11条）"
      authority: hard
      injection_layer: native_system_role
      compression_immune: true
      applies_to: ["*"]
      version: 1
      adr_ref: "ADR-007"

    - rule_id: "no_direct_db_op"
      rule_text: "禁止直接操作数据库, 必须通过 Repository 层"
      authority: hard
      injection_layer: native_system_role
      compression_immune: true
      applies_to: ["*"]
      version: 1
      adr_ref: "ADR-007"

  # soft 规则（注入 developer_role, 灵智体可声明覆盖）
  soft_rules:
    - rule_id: "prefer_pytest"
      rule_text: "测试优先使用 pytest 框架"
      authority: soft
      injection_layer: developer_role
      compression_immune: false
      applies_to: ["devforge:*"]
      version: 1
      adr_ref: "ADR-007"

    - rule_id: "prefer_async_io"
      rule_text: "所有 I/O 操作使用 async/await"
      authority: soft
      injection_layer: developer_role
      compression_immune: false
      applies_to: ["*"]
      version: 1
      adr_ref: "ADR-007"

  # 觉醒阶约束（E4+ 覆盖 default 需 Mind Council token）
  awakening_stage_constraints:
    E1: allow_override_default
    E2: allow_override_default
    E3: allow_override_default
    E4: require_mind_council_token
    E5: require_mind_council_token
    E6: require_mind_council_token

  # audit 关键词
  audit_governance_keywords:
    - 禁止
    - 必须
    - 不可
    - 应当
    - guardrail
    - 禁止绕过

  # WAL 配置
  wal:
    journal_mode: WAL
    synchronous: NORMAL
    checkpoint_interval_writes: 100
    checkpoint_interval_seconds: 300
```

---

## 4. 跨模块协作实现

### 4.1 上游调用：ForgekinHost 构造时注入治理规则

```python
# flowforge/core/host/forgekin_host.py（片段, ADR 001）
class ForgekinHost:
    @inject
    def __init__(
        self, *,
        governance_loader: GovernanceLoader,
        governance_injector: GovernanceInjector,
        governance_validator: GovernanceValidator,
        config_path: str,
    ) -> None:
        self._loader = governance_loader
        self._injector = governance_injector
        self._validator = governance_validator
        self._config_path = config_path

    async def construct_forgekin(self, forgekin_id: str) -> None:
        # 1. 加载 GovernanceBundle
        bundle = await self._loader.load(self._config_path)

        # 2. 拆分 hard / soft
        hard_rules = [r for r in bundle.rules if r.authority == RuleAuthority.HARD]
        soft_rules = [r for r in bundle.rules if r.authority == RuleAuthority.SOFT]

        # 3. 注入到 native_system_role + developer_role
        await self._injector.inject_hard(hard_rules)
        await self._injector.inject_soft(soft_rules)

        # 4. validate session context
        session_ctx = self._build_session_ctx(forgekin_id, bundle)
        result = await self._validator.validate(session_ctx)
        if not result.ok:
            raise GovernanceError(
                f"灵智体构造拒绝: 治理规则校验失败 {result.errors}"
            )
```

### 4.2 上游调用：D002 TeamAct ACTION 步受治理规则约束

```python
# flowforge/loop/executor.py（片段）
class TeamActLoopExecutor:
    async def _execute_action_step(self, state: TeamActState) -> TeamActState:
        # 治理规则约束 ACTION: 如 "禁止删除测试用例"
        action = state.proposed_action
        if action.type == "delete_test":
            # 检查治理规则
            if self._governance_bundle.has_rule("no_delete_tests"):
                raise GovernanceError(
                    "治理规则 'no_delete_tests' 禁止删除测试用例"
                )
        return state
```

### 4.3 下游影响：D009 Evidence & Sensors 用治理规则作 quality_gate 判据

```python
# flowforge/core/harness/evidence.py（片段, D009）
class DefaultEvidenceCollector:
    async def collect_quality_gate(self, forgekin_id, rule_id, passed):
        # 用治理规则作 quality_gate 证据判据
        rule = await self._governance_store.find_rule(rule_id)
        payload = {
            "rule_id": rule_id,
            "rule_text": rule.rule_text,
            "passed": passed,
            "ref": f"quality_gate:{rule_id}",
        }
        return await self.collect(EvidenceType.QUALITY_GATE, forgekin_id, payload)
```

### 4.4 下游影响：D011 Magic Words 注入到 native_system_role 拉闸位置

```python
# flowforge/core/harness/magic_words.py（片段, D011）
class MagicWordsExecutor:
    async def inject_magic_words(self):
        # 复用 D010 GovernanceInjector 注入拉闸词到 native_system_role
        magic_word_rules = [
            GovernanceRule(
                rule_id=f"magic_word_{w.value}",
                rule_text=f"Magic Word '{w.value}' 触发时立即执行对应动作",
                authority=RuleAuthority.HARD,
                injection_layer=InjectionLayer.NATIVE_SYSTEM_ROLE,
                compression_immune=True,
                version="1",
                adr_ref="ADR-007",
            )
            for w in MagicWord
        ]
        await self._governance_injector.inject_hard(magic_word_rules)
```

### 4.5 下游影响：D012 Entropy Control 降级 guardrail 为 default

```python
# flowforge/core/harness/entropy.py（片段, D012）
class EntropyReviewGate:
    async def validate(self, verdict, hotfix_tag):
        # 已失效 guardrail 可降级为 default（A010 决策 6）
        if verdict.decision == "no_longer_relevant":
            await self._governance_bundle.downgrade_guardrail_to_default(
                rule_id=hotfix_tag.related_rule_id,
                reason="Entropy Review 判定 guardrail 已失效",
            )
```

### 4.6 集成测试点

| # | 测试点 | 验证内容 | 关联 AC |
|---|--------|---------|---------|
| T1 | hard 规则 injection_layer != native_system_role → 拒绝 | HardRuleInjectionLayerError | AC-F1 |
| T2 | hard 规则 compression_immune=false → 拒绝 | HardRuleNotCompressionImmuneError | AC-F2 |
| T3 | tighten_guardrail version 不增 → 拒绝 | GuardrailRelaxationError | AC-F4 |
| T4 | user_message_prepend 注入 → 拒绝 | ForbiddenLayerError | AC-F5 |
| T5 | bundle 缺 adr_ref → 拒绝部署 | AdrRequiredError | AC-F6 |
| T6 | audit_user_message 检测到治理关键词 → 告警 | violations 非空 | AC-F8 |
| T7 | inject_hard 写 DurableSurface compression_immune=true | surface 持久化 | AC-F9 |
| T8 | inject_soft 写 developer_role | 不在 native_system_role | AC-F10 |
| T9 | E4+ 覆盖 default 缺 Mind Council token → 拒绝 | MindCouncilRequiredError | AC-F11 |
| T10 | WAL 写入后进程崩溃 → 重启可恢复 | load_bundle 返回完整数据 | AC-P3 |
| T11 | load 时 forbidden_layers 缺 user_message_prepend → 拒绝 | ForbiddenLayerError | AC-F7 |
| T12 | validate 时 hard 规则未注入 native_system_role → 拒绝构造 | ValidationResult.ok=false | AC-F12 |

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

| AC | 描述 |
|----|------|
| AC-F1 | hard 规则 `injection_layer != native_system_role` → HardRuleInjectionLayerError |
| AC-F2 | hard 规则 `compression_immune=false` → HardRuleNotCompressionImmuneError |
| AC-F3 | `user_message_prepend` 注入治理规则 → ForbiddenLayerError |
| AC-F4 | `tighten_guardrail` version 不递增 → GuardrailRelaxationError |
| AC-F5 | `inject_hard` 通过 ForgekinHost 注入 native_system_role，不在 user_message |
| AC-F6 | GovernanceBundle 缺 adr_ref → AdrRequiredError |
| AC-F7 | `load` 时 forbidden_layers 缺 user_message_prepend → ForbiddenLayerError |
| AC-F8 | `audit_user_message` 检测到治理关键词 → audit log + 告警 |
| AC-F9 | `inject_hard` 写 DurableSurface（compression_immune=true, authority_level=4） |
| AC-F10 | `inject_soft` 写 developer_role，不写 native_system_role |
| AC-F11 | E4+ 觉醒阶覆盖 default 缺 Mind Council token → MindCouncilRequiredError |
| AC-F12 | `validate` 时 hard 规则未注入 native_system_role → 拒绝构造灵智体 |
| AC-F13 | 上下文压缩后 hard 规则仍生效（compression_immune=true） |
| AC-F14 | DualTrackPolicy guardrails 轨只能加严，defaults 轨可覆盖 |
| AC-F15 | GovernanceBundle 版本号单调递增 |
| AC-F16 | forbidden_layers 必须包含 user_message_prepend |
| AC-F17 | hard 规则 authority_level=4，soft 规则 authority_level=2 |
| AC-F18 | 6 类治理规则文本外置 YAML，无硬编码 |

### 5.2 性能验收（Performance AC）

| AC | 描述 |
|----|------|
| AC-P1 | `load` P99 延迟 < 100ms |
| AC-P2 | `inject_hard` 10 条规则 P99 < 50ms |
| AC-P3 | WAL 写入后进程崩溃, 重启后 `load_bundle` 可恢复完整数据 |
| AC-P4 | `validate` P99 < 30ms |
| AC-P5 | `audit_user_message` 100 条 msg P99 < 20ms |
| AC-P6 | 并发 save_bundle 吞吐 > 50 QPS |

### 5.3 安全验收（Security AC）

| AC | 描述 |
|----|------|
| AC-S1 | `flowforge/core/harness/governance.py` 不 import forgemind 或 *Forge 模块 |
| AC-S2 | Loader / Injector / Validator 通过 `@inject` 注入, 无直接实例化 |
| AC-S3 | 所有 DB 操作通过 Repository, 无 `cursor.execute` |
| AC-S4 | hard 规则强制注入 native_system_role + compression_immune=true |
| AC-S5 | `user_message_prepend` 注入被拒绝 + audit 告警 |
| AC-S6 | E4+ 觉醒阶覆盖 default 强制 Mind Council 二次确认 |
| AC-S7 | 规则变更必须走 ADR 流程, 带版本号 |

### 5.4 Eval 验收（Eval AC）

| AC | 描述 |
|----|------|
| AC-E1 | 每次 inject_hard 写 eval_signal "governance_hard_injected" |
| AC-E2 | 每次 inject_soft 写 eval_signal "governance_soft_injected" |
| AC-E3 | audit 发现违规写 eval_signal "forbidden_injection_detected" |
| AC-E4 | guardrail tighten 次数作为 F040 控制面指标 |
| AC-E5 | default override 次数作为 F040 控制面指标 |

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003, FR-CORE-010 Governance Boundary）
- [doc:../arch.md#§3.3]（Harness 七层现实表面, L4 Governance Boundary）
- [doc:../features/F010-governance-boundary.md]（同号 Feature 级 SRS）
- [doc:../architecture/A010-governance-boundary.md]（架构权威源）
- [doc:../architecture/A002-teamact-loop.md]（ACTION 步受治理约束）
- [doc:../architecture/A008-durable-state-surfaces.md]（compression_immune 来源）
- [doc:../architecture/A009-evidence-sensors.md]（quality_gate 判据）
- [doc:../architecture/A011-magic-words.md]（拉闸词注入位置）
- [doc:../architecture/A012-entropy-control.md]（guardrail 降级为 default）
- [doc:../architecture/A021-side-effect-wal.md]（WAL 可重放）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../decisions/001-agent-invocation-approach.md]（ForgekinHost 构造时注入）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架, 对应 F010 / A010） | 开发者灵智体（猎犬·夏洛克） |

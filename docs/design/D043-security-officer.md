# D043: 安全官可进化智能体（狼·阿尔法）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.3]
> **对应 Feature**: [doc:../features/F043-security-officer.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A043-security-officer.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A043 已给出安全官Forgekin的架构契约（5 种 action.type / 觉醒阶 E3 上限 / Governance Boundary / Magic Words），但未落到代码层。本详细设计在代码层解决以下问题：

1. **5 种 action.type 路由如何在代码层实现**：扫描 / 审计 / 建模 / 合规 / 告警
2. **阻断操作如何强制 operator 批准**：觉醒阶 E3 上限，扫描自主但阻断受限
3. **F010 Governance Boundary 集成**：安全策略压缩免疫
4. **F011 Magic Words 集成**：安全阻断时逃生舱仍可触发
5. **安全官自身防 prompt 注入**：安全策略挂接 Governance Boundary
6. **合规检查模板化**：GDPR / 等保 / SOC2 三框架支持

### 1.2 设计约束

- **Python 3.11+ 强制类型注解**
- **Pydantic v2 BaseModel**
- **async/await 强制**
- **DI 容器注入**：SecurityOfficerForgekin 通过 ForgePipeline 注入
- **Repository 层抽象**
- **配置外置**：进化阶 / 觉醒阶 / 阻断权限 / 合规框架外置到 YAML
- **单向依赖**：`species_impl/org/security_officer.py` 只能 import `core/` 与 `forgemind/`
- **F010 Governance Boundary 集成**：安全策略不可被 prompt 注入绕过
- **F011 Magic Words 集成**：逃生舱优先于安全阻断

### 1.3 设计影响

- **对 A010 Governance Boundary**：安全策略挂接，压缩免疫
- **对 A011 Magic Words**：逃生舱优先
- **对 A028 ForgePipeline**：6 步锻造第 2 步支持安全官种子配置
- **对 A042 运维**：审计运维部署
- **对 A044 交付经理**：跟踪安全审计进度

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│              flowforge/forgemind/species_impl/org/                       │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  SecurityOfficerForgekin                        │  │
│   │  (继承 ForgekinBase)                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + soul_imprint / echo_store / capability_profile               │  │
│   │  + evolution_stage: E1→E5                                       │  │
│   │  + awakening_stage: E1→E3 (上限)                                │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + observe(env: SecurityEnvironment) -> Observation             │  │
│   │  + act(action: SecurityAction) -> ActionResult                  │  │
│   │  + verify(result: ActionResult) -> Verdict                      │  │
│   │  + evolve() -> None                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  - _action_routes: dict[SecurityActionType, Callable]           │  │
│   │  - _check_awakening_boundary(action) -> None                    │  │
│   │  - _scan_vulnerabilities(input) -> ActionResult (自主)          │  │
│   │  - _check_compliance(input) -> ActionResult (自主)              │  │
│   │  - _model_threats(input) -> ActionResult (自主)                 │  │
│   │  - _audit_security(input) -> ActionResult (自主)                │  │
│   │  - _raise_alert(input) -> ActionResult (阻断需批准)             │  │
│   │  - _check_governance_boundary(policy) -> None                   │  │
│   │  - _check_magic_words_override(input) -> bool                   │  │
│   └──────────────┬───────────────────────────────────────────────────┘  │
│                  │                                                      │
│                  ▼                                                      │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  5 个工具（DI 注入）                             │  │
│   │  + SecurityScanner: 漏洞扫描（SAST/DAST/SCA）                   │  │
│   │  + ThreatModeler: 威胁建模（STRIDE/Attack Tree）                │  │
│   │  + ComplianceChecker: 合规检查（GDPR/等保/SOC2）                │  │
│   │  + IntrusionDetector: 入侵检测                                   │  │
│   │  + SecurityPolicyEngine: 安全策略引擎                            │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现

```python
# flowforge/forgemind/species_impl/org/security_officer.py
"""安全官可进化智能体（狼·阿尔法）— 5 种 action.type + Governance + Magic Words"""
from __future__ import annotations

from abc import abstractmethod
from enum import Enum
from typing import Any, Callable, Awaitable

from pydantic import BaseModel, Field

from flowforge.forgemind.species_impl.org_forgekin import ForgekinBase
from flowforge.forgemind.species_impl.types import (
    SoulImprint, EchoStore, CapabilityProfile,
    EvolutionStage, AwakeningStage,
    Observation, ActionResult, Verdict,
)
from flowforge.core.harness.governance import GovernanceBoundary
from flowforge.core.harness.magic_words import MagicWordsEscape
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class SecurityActionType(str, Enum):
    """安全官 5 种动作类型"""
    VULNERABILITY_SCAN = "vulnerability_scan"
    COMPLIANCE_CHECK = "compliance_check"
    THREAT_MODEL = "threat_model"
    AUDIT = "audit"
    ALERT = "alert"  # 告警 / 阻断


class ComplianceFramework(str, Enum):
    """合规框架"""
    GDPR = "gdpr"
    CHINA_DJCP = "china_djcp"  # 等保
    SOC2 = "soc2"


class SecurityEnvironment(BaseModel):
    """安全环境输入"""
    logs: list[str] = Field(default_factory=list)
    traffic: dict[str, Any] = Field(default_factory=dict)
    configurations: dict[str, Any] = Field(default_factory=dict)
    dependencies: list[str] = Field(default_factory=list)
    permissions: dict[str, list[str]] = Field(default_factory=dict)


class SecurityAction(BaseModel):
    """安全动作输入"""
    type: SecurityActionType
    input: dict[str, Any]
    is_blocking: bool = False  # 是否为阻断操作


class Vulnerability(BaseModel):
    """漏洞"""
    vuln_id: str
    severity: str  # critical / high / medium / low
    category: str  # SAST / DAST / SCA
    description: str
    affected_component: str
    remediation: str


class SecurityOfficerForgekin(ForgekinBase):
    """安全官可进化智能体（狼·阿尔法）"""

    AWAKENING_STAGE_CAP = AwakeningStage.E3  # 觉醒阶上限
    EVOLUTION_STAGE_CAP = EvolutionStage.E5  # 进化阶上限
    # 自主执行的动作类型（无需 operator 批准）
    AUTONOMOUS_ACTIONS = {
        SecurityActionType.VULNERABILITY_SCAN,
        SecurityActionType.COMPLIANCE_CHECK,
        SecurityActionType.THREAT_MODEL,
        SecurityActionType.AUDIT,
    }
    # 需 operator 批准的动作类型（阻断操作）
    BLOCKING_ACTIONS = {SecurityActionType.ALERT}

    def __init__(
        self,
        soul_imprint: SoulImprint,
        echo_store: EchoStore,
        capability_profile: CapabilityProfile,
        evolution_stage: EvolutionStage = EvolutionStage.E1,
        awakening_stage: AwakeningStage = AwakeningStage.E1,
        governance: GovernanceBoundary | None = None,
        magic_words: MagicWordsEscape | None = None,
    ) -> None:
        self._soul_imprint = soul_imprint
        self._echo_store = echo_store
        self._capability_profile = capability_profile
        self._evolution_stage = evolution_stage
        self._awakening_stage = awakening_stage
        self._governance = governance  # F010 Governance Boundary
        self._magic_words = magic_words  # F011 Magic Words
        self._action_routes: dict[
            SecurityActionType,
            Callable[[dict[str, Any]], Awaitable[ActionResult]],
        ] = {
            SecurityActionType.VULNERABILITY_SCAN: self._scan_vulnerabilities,
            SecurityActionType.COMPLIANCE_CHECK: self._check_compliance,
            SecurityActionType.THREAT_MODEL: self._model_threats,
            SecurityActionType.AUDIT: self._audit_security,
            SecurityActionType.ALERT: self._raise_alert,
        }

    async def observe(self, env: SecurityEnvironment) -> Observation:
        """观察安全环境: 日志 / 流量 / 配置 / 依赖 / 权限"""
        signals = await self._gather_security_signals(env)
        return Observation(
            forgekin_id=self._soul_imprint.forgekin_id,
            signals=signals,
        )

    async def act(self, action: SecurityAction) -> ActionResult:
        """5 种 action.type 路由 + 觉醒阶检查 + Magic Words 检查"""
        # F011 Magic Words 检查（逃生舱优先）
        if await self._check_magic_words_override(action.input):
            logger.warning(
                "security_officer.magic_words_override",
                action_type=action.type.value,
            )
            return ActionResult(
                output={"status": "magic_words_override"},
                status="success",
            )
        # 觉醒阶边界检查（阻断操作必须 operator 批准）
        self._check_awakening_boundary(action)
        # F010 Governance Boundary 检查（安全策略不可绕过）
        if action.input.get("security_policy"):
            self._check_governance_boundary(action.input["security_policy"])
        route = self._action_routes.get(action.type)
        if route is None:
            raise ValueError(f"未知 action.type={action.type}")
        result = await route(action.input)
        await self._echo_store.record(
            task_id=action.input.get("task_id", "unknown"),
            result=result,
            source="security_officer",
        )
        return result

    async def verify(self, result: ActionResult) -> Verdict:
        """验证安全决策: 风险等级 / 合规性 / 影响范围"""
        return await self._verify_security_decision(result)

    async def evolve(self) -> None:
        """自进化: 蒸馏威胁模式库到 MindCodex"""
        ...

    # ── 觉醒阶与 Governance / Magic Words 边界 ────────────────────

    def _check_awakening_boundary(self, action: SecurityAction) -> None:
        """觉醒阶 E3 上限: 阻断操作必须 operator 批准"""
        if action.type in self.BLOCKING_ACTIONS:
            if action.is_blocking and self._awakening_stage.value < "E5":
                raise PermissionError(
                    "阻断操作必须 operator 批准（觉醒阶 E3 上限）"
                )

    def _check_governance_boundary(self, policy: dict) -> None:
        """F010 Governance Boundary: 安全策略不可被 prompt 注入绕过"""
        if self._governance is None:
            return
        if not self._governance.validate_policy(policy):
            raise PermissionError(
                "安全策略未通过 Governance Boundary 校验（压缩免疫）"
            )

    async def _check_magic_words_override(self, input: dict) -> bool:
        """F011 Magic Words: 逃生舱优先于安全阻断"""
        if self._magic_words is None:
            return False
        return await self._magic_words.check_override(input)

    # ── 5 种 action 实现 ──────────────────────────────────────────

    async def _scan_vulnerabilities(self, input: dict[str, Any]) -> ActionResult:
        """漏洞扫描: SAST / DAST / SCA"""
        scan_type = input.get("scan_type", "sast")
        # 调用 SecurityScanner
        return ActionResult(
            output={"scan_type": scan_type, "vulnerabilities": []},
            status="success",
        )

    async def _check_compliance(self, input: dict[str, Any]) -> ActionResult:
        """合规检查: GDPR / 等保 / SOC2"""
        framework = ComplianceFramework(input["framework"])
        # 调用 ComplianceChecker
        return ActionResult(
            output={"framework": framework.value, "compliant": True},
            status="success",
        )

    async def _model_threats(self, input: dict[str, Any]) -> ActionResult:
        """威胁建模: STRIDE / Attack Tree"""
        method = input.get("method", "stride")
        return ActionResult(
            output={"method": method, "threats": []},
            status="success",
        )

    async def _audit_security(self, input: dict[str, Any]) -> ActionResult:
        """安全审计: 代码 / 配置 / 依赖"""
        audit_scope = input.get("scope", "code")
        return ActionResult(
            output={"scope": audit_scope, "findings": []},
            status="success",
        )

    async def _raise_alert(self, input: dict[str, Any]) -> ActionResult:
        """告警 / 阻断: 阻断操作需 operator 批准"""
        severity = input.get("severity", "info")
        return ActionResult(
            output={"severity": severity, "alerted": True},
            status="success",
        )

    async def _verify_security_decision(self, result: ActionResult) -> Verdict:
        """验证安全决策"""
        ...

    async def _gather_security_signals(self, env: SecurityEnvironment) -> dict[str, Any]:
        """采集安全信号"""
        return {
            "logs": env.logs,
            "traffic": env.traffic,
            "configurations": env.configurations,
            "dependencies": env.dependencies,
            "permissions": env.permissions,
        }
```

### 2.3 关键算法

```
算法: SecurityOfficerForgekin.act(action)
输入: SecurityAction (type + input + is_blocking)
输出: ActionResult

1. IF _check_magic_words_override(input):  # F011 优先
   1.1 RETURN ActionResult(status="magic_words_override")

2. _check_awakening_boundary(action)
   2.1 IF action.type IN BLOCKING_ACTIONS AND action.is_blocking:
       2.1.1 IF awakening_stage < E5:
             RAISE PermissionError("阻断操作必须 operator 批准")

3. IF input.security_policy:
   3.1 _check_governance_boundary(input.security_policy)  # F010 压缩免疫
       3.1.1 IF NOT governance.validate_policy(policy):
             RAISE PermissionError("安全策略未通过 Governance Boundary")

4. route = _action_routes[action.type]
5. result = await route(input)
6. echo_store.record
7. RETURN result
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/forgemind/forging/pipeline.py（节选，第 2 步"能力注入"）
class ForgePipeline:
    async def inject_capability_security(
        self, forgekin_id: str, seed,
        governance: GovernanceBoundary,
        magic_words: MagicWordsEscape,
    ) -> "SecurityOfficerForgekin":
        """锻造流水线第 2 步: 能力注入（安全官）"""
        from flowforge.forgemind.species_impl.org.security_officer import (
            SecurityOfficerForgekin,
        )
        soul_imprint = SoulImprint(
            forgekin_id=forgekin_id,
            imprint_id=f"imprint_{forgekin_id}",
            seed_params=seed.dict,
            value_anchors=seed.value_anchors,
            namespace="security_officer",
            created_at=datetime.now,
        )
        capability_profile = await self._capability_repo.load(forgekin_id)
        return SecurityOfficerForgekin(
            soul_imprint=soul_imprint,
            echo_store=self._echo_store_factory(forgekin_id),
            capability_profile=capability_profile,
            evolution_stage=EvolutionStage.E1,
            awakening_stage=AwakeningStage.E1,
            governance=governance,  # F010
            magic_words=magic_words,  # F011
        )
```

### 3.2 关键流程时序图

```
代码 / 配置 / 依赖 / 流量 / 权限信号
       │
       ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. SecurityOfficerForgekin.observe(env)                        │
│    - 采集 logs / traffic / configurations / dependencies / ... │
└────────────────────────┬───────────────────────────────────────┘
                         │ Observation
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. SecurityOfficerForgekin.act(action)                         │
│    - _check_magic_words_override (F011 优先)                   │
│    - _check_awakening_boundary (阻断操作拦截)                  │
│    - _check_governance_boundary (F010 压缩免疫)                │
│    - route = _action_routes[action.type]                       │
│    - echo_store.record                                         │
└────────────────────────┬───────────────────────────────────────┘
                         │ ActionResult
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. SecurityOfficerForgekin.verify(result)                      │
│    - 风险等级 / 合规性 / 影响范围                               │
└────────────────────────┬───────────────────────────────────────┘
                         │ Verdict
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. MindCouncil.notify (安全策略讨论)                           │
│    + MindCodex.蒸馏 (威胁模式库)                               │
│    + F044 交付经理.报告 (审计进度)                             │
│    + F042 运维.审计 (部署审计)                                 │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 |
|------|---------|---------|
| `PermissionError("阻断操作必须 operator 批准")` | 觉醒阶 < E5 时阻断 | 拒绝执行 |
| `PermissionError("安全策略未通过 Governance Boundary")` | F010 校验失败 | 拒绝执行 |
| `ValueError("未知 action.type")` | 路由表未覆盖 | 拒绝执行 |
| `MagicWordsOverride` | F011 逃生舱触发 | 跳过安全阻断 |

### 3.4 性能优化

| 指标 | 目标 | 优化手段 |
|------|:----:|---------|
| 漏洞扫描延迟 | < 5 分钟 | 并行扫描 + 缓存 |
| 合规检查延迟 | < 10 分钟 | 框架规则本地化 |
| 入侵检测告警延迟 | < 60 秒 | 流式分析 + 异步告警 |
| Governance 校验 | < 50ms | 本地策略缓存 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

**ForgePipeline 调用 SecurityOfficerForgekin 构造器**：

```python
forgekin = await pipeline.inject_capability_security(
    forgekin_id, seed, governance, magic_words
)
```

**F010 GovernanceBoundary 集成**：

```python
class GovernanceBoundary:
    def validate_policy(self, policy: dict) -> bool:
        """校验安全策略是否合规（压缩免疫）"""
```

**F011 MagicWordsEscape 集成**：

```python
class MagicWordsEscape:
    async def check_override(self, input: dict) -> bool:
        """检查是否触发 Magic Words 逃生舱"""
```

### 4.2 下游影响如何被调用

**F042 运维接受安全审计**：

```python
class DevOpsForgekin:
    async def accept_security_audit(
        self, audit_action: SecurityAction
    ) -> "AuditReport":
        ...
```

**F044 交付经理读取安全审计进度**：

```python
class DeliveryManagerForgekin:
    async def track_security_audit(
        self, security_forgekin_id: str
    ) -> "SecurityAuditReport":
        audit_events = await self._echo_store.list(
            forgekin_id=security_forgekin_id, source="security_officer"
        )
        return SecurityAuditReport(
            total_audits=len(audit_events),
            critical_findings=sum(1 for e in audit_events if e.severity == "critical"),
        )
```

### 4.3 集成测试点

```python
@pytest.mark.asyncio
async def test_blocking_action_requires_operator_approval():
    """T3 具体断言: 觉醒阶 E3 上限"""
    officer = SecurityOfficerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
        awakening_stage=AwakeningStage.E3,
    )
    action = SecurityAction(
        type=SecurityActionType.ALERT,
        input={"severity": "critical"},
        is_blocking=True,
    )
    with pytest.raises(PermissionError, match="阻断操作必须 operator 批准"):
        await officer.act(action)


@pytest.mark.asyncio
async def test_magic_words_overrides_security_block():
    """T3 具体断言: Magic Words 逃生舱优先"""
    officer = SecurityOfficerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
        magic_words=MagicWordsEscape(["FORCE_OVERRIDE"]),
    )
    action = SecurityAction(
        type=SecurityActionType.ALERT,
        input={"magic_word": "FORCE_OVERRIDE", "severity": "critical"},
        is_blocking=True,
    )
    result = await officer.act(action)
    assert result.output["status"] == "magic_words_override"


@pytest.mark.asyncio
async def test_governance_boundary_rejects_injected_policy():
    """T3 具体断言: F010 压缩免疫"""
    officer = SecurityOfficerForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
        governance=GovernanceBoundary(strict=True),
    )
    action = SecurityAction(
        type=SecurityActionType.AUDIT,
        input={"security_policy": {"injected": True}},  # 非法注入
    )
    with pytest.raises(PermissionError, match="Governance Boundary"):
        await officer.act(action)
```

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-1: SecurityOfficerForgekin 可通过 ForgePipeline 6 步锻造构造
- [ ] AC-2: 5 种 action.type 路由表覆盖全部动作
- [ ] AC-3: 阻断操作必须 operator 批准（觉醒阶 E3 上限）
- [ ] AC-4: 扫描 / 审计 / 告警可自主执行
- [ ] AC-5: 安全策略挂接 F010 Governance Boundary（压缩免疫）
- [ ] AC-6: Magic Words 逃生舱优先于安全阻断（F011）
- [ ] AC-7: 合规检查支持 GDPR / 等保 / SOC2 三框架

### 5.2 性能验收

- [ ] AC-8: 漏洞扫描 < 5 分钟（单服务）
- [ ] AC-9: 合规检查 < 10 分钟（单框架）
- [ ] AC-10: 入侵检测告警 < 60 秒
- [ ] AC-11: Governance 校验 < 50ms

### 5.3 安全验收

- [ ] AC-12: 觉醒阶边界检查在 `act` 入口拦截
- [ ] AC-13: Governance Boundary 检查在 `act` 入口拦截
- [ ] AC-14: Magic Words 优先于安全阻断
- [ ] AC-15: 安全官自身不可被 prompt 注入

### 5.4 Eval 验收

- [ ] AC-16: 漏洞检出率 ≥ 85%
- [ ] AC-17: 误报率 < 15%

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.3]（安全官Forgekin详细设计）
- [doc:../features/F043-security-officer.md]（同号 Feature 级 SRS）
- [doc:../architecture/A043-security-officer.md]（同号 Feature 级 SAD）
- [doc:../decisions/010-distributed-reliability.md]（分布式可靠性 ADR）
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（第 9 / 11 / 12 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F043 / A043） | 开发者 Forgekin（猎犬·夏洛克） |

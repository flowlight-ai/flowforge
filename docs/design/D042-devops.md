# D042: 运维可进化智能体（蜂鸟·闪电）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§2.3.2]（可进化智能体定义）
> **对应 arch.md**: [doc:../arch.md#§2.7.2]（可进化智能体架构）
> **对应 design.md**: [doc:../design.md#§2.7.2]
> **对应 Feature**: [doc:../features/F042-devops.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A042-devops.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A042 已给出运维Forgekin的架构契约（5 种 action.type / 觉醒阶 E4 上限 / 自愈 WAL / Tier 限制），但未落到代码层。本详细设计在代码层解决以下问题：

1. **5 种 action.type 路由如何在代码层实现**：单方法 `act` 承担 5 种动作
2. **自愈动作如何先写 F021 WAL 再执行**：保证可回滚
3. **Tier 0-4 恢复分级如何在代码层强制**：Tier 0 禁止自愈
4. **觉醒阶 E4 上限如何在代码层强制**：重大变更必须 operator 批准
5. **金丝雀发布如何在代码层实现**：按比例放量
6. **Build to Delete vs Built to Persist 半衰期如何在配置层标记**

### 1.2 设计约束

- **Python 3.11+ 强制类型注解**
- **Pydantic v2 BaseModel**
- **async/await 强制**
- **DI 容器注入**：DevOpsForgekin 通过 ForgePipeline 注入
- **Repository 层抽象**
- **配置外置**：进化阶 / 觉醒阶 / Tier 限制 / 工具集外置到 YAML
- **单向依赖**：`species_impl/org/devops.py` 只能 import `core/` 与 `forgemind/` 内部模块
- **F021 WAL 集成**：自愈动作前必须先写 WAL
- **F022 Tier 限制**：自愈仅限 Tier 1-2

### 1.3 设计影响

- **对 A021 SideEffectWAL**：自愈动作前写 WAL，失败可回滚
- **对 A022 Tier 1-4 Recovery**：自愈动作限定 Tier 1-2
- **对 A028 ForgePipeline**：6 步锻造流水线第 2 步支持运维种子配置
- **对 A043 安全官**：安全官审计运维部署
- **对 A044 交付经理**：交付经理跟踪运维状态

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│              flowforge/forgemind/species_impl/org/                       │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  DevOpsForgekin                                 │  │
│   │  (继承 ForgekinBase)                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + soul_imprint / echo_store / capability_profile               │  │
│   │  + evolution_stage: E1→E5                                       │  │
│   │  + awakening_stage: E1→E4 (上限)                                │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + observe(env: OpsEnvironment) -> Observation                  │  │
│   │  + act(action: OpsAction) -> ActionResult                       │  │
│   │  + verify(result: ActionResult) -> Verdict                      │  │
│   │  + evolve() -> None                                             │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  - _action_routes: dict[OpsActionType, Callable]                │  │
│   │  - _check_awakening_boundary(action) -> None                    │  │
│   │  - _deploy_with_canary(input) -> ActionResult                   │  │
│   │  - _auto_heal(input) -> ActionResult (先写 WAL)                 │  │
│   │  - _scale_resources(input) -> ActionResult                      │  │
│   │  - _degrade_service(input) -> ActionResult                      │  │
│   │  - _tune_performance(input) -> ActionResult                     │  │
│   │  - _check_tier_boundary(tier) -> None (Tier 0 禁止)             │  │
│   │  - _write_wal_before_heal(action) -> WalEntry                   │  │
│   └──────────────┬───────────────────────────────────────────────────┘  │
│                  │                                                      │
│                  ▼                                                      │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  5 个工具（DI 注入）                             │  │
│   │  + DeploymentOrchestrator: 部署编排（金丝雀）                    │  │
│   │  + MonitoringStack: 监控告警                                     │  │
│   │  + IncidentResponder: 故障响应                                   │  │
│   │  + PerformanceProfiler: 性能分析                                 │  │
│   │  + CapacityPlanner: 容量规划                                     │  │
│   └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现

```python
# flowforge/forgemind/species_impl/org/devops.py
"""运维可进化智能体（蜂鸟·闪电）— 5 种 action.type 路由 + WAL + Tier 限制"""
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
from flowforge.core.reliability.wal import SideEffectWAL, WalEntry
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class OpsActionType(str, Enum):
    """运维 5 种动作类型"""
    DEPLOY = "deploy"
    AUTO_HEAL = "auto_heal"
    SCALE = "scale"
    DEGRADE = "degrade"
    TUNE = "tune"


class RecoveryTier(str, Enum):
    """恢复分级（F022）"""
    TIER_0_PHYSICAL = "tier_0"   # 物理副作用，不可逆，禁止自愈
    TIER_1_REVERSIBLE = "tier_1"  # 可逆，允许自愈
    TIER_2_DEGRADABLE = "tier_2"  # 可降级，允许自愈
    TIER_3_CROSS_SERVICE = "tier_3"  # 跨服务，必须 operator 介入
    TIER_4_CROSS_DC = "tier_4"  # 跨数据中心，必须 operator 介入


class OpsEnvironment(BaseModel):
    """运维环境输入"""
    service_status: dict[str, str]  # service_name -> healthy/degraded/down
    resource_usage: dict[str, float]  # cpu/mem/disk -> 0.0-1.0
    alerts: list[dict[str, Any]] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
    metrics: dict[str, float] = Field(default_factory=dict)


class OpsAction(BaseModel):
    """运维动作输入"""
    type: OpsActionType
    input: dict[str, Any]
    tier: RecoveryTier = RecoveryTier.TIER_1_REVERSIBLE  # 默认 Tier 1


class CanaryDeploySpec(BaseModel):
    """金丝雀发布规格"""
    service_name: str
    new_version: str
    canary_percentage: float = Field(ge=0.0, le=100.0, default=10.0)
    auto_promote_threshold: float = Field(ge=0.0, le=1.0, default=0.95)
    rollback_on_error_rate: float = Field(ge=0.0, le=1.0, default=0.05)


class DevOpsForgekin(ForgekinBase):
    """运维可进化智能体（蜂鸟·闪电）"""

    AWAKENING_STAGE_CAP = AwakeningStage.E4  # 觉醒阶上限
    EVOLUTION_STAGE_CAP = EvolutionStage.E5  # 进化阶上限
    AUTO_HEAL_ALLOWED_TIERS = {
        RecoveryTier.TIER_1_REVERSIBLE,
        RecoveryTier.TIER_2_DEGRADABLE,
    }

    def __init__(
        self,
        soul_imprint: SoulImprint,
        echo_store: EchoStore,
        capability_profile: CapabilityProfile,
        evolution_stage: EvolutionStage = EvolutionStage.E1,
        awakening_stage: AwakeningStage = AwakeningStage.E1,
        wal: SideEffectWAL | None = None,
    ) -> None:
        self._soul_imprint = soul_imprint
        self._echo_store = echo_store
        self._capability_profile = capability_profile
        self._evolution_stage = evolution_stage
        self._awakening_stage = awakening_stage
        self._wal = wal  # F021 副作用日志 WAL
        self._action_routes: dict[
            OpsActionType,
            Callable[[dict[str, Any]], Awaitable[ActionResult]],
        ] = {
            OpsActionType.DEPLOY: self._deploy_with_canary,
            OpsActionType.AUTO_HEAL: self._auto_heal,
            OpsActionType.SCALE: self._scale_resources,
            OpsActionType.DEGRADE: self._degrade_service,
            OpsActionType.TUNE: self._tune_performance,
        }

    async def observe(self, env: OpsEnvironment) -> Observation:
        """观察运维环境: 服务状态 / 资源 / 告警 / 日志 / 指标"""
        signals = await self._gather_ops_signals(env)
        return Observation(
            forgekin_id=self._soul_imprint.forgekin_id,
            signals=signals,
        )

    async def act(self, action: OpsAction) -> ActionResult:
        """5 种 action.type 路由 + 觉醒阶检查 + Tier 检查"""
        self._check_awakening_boundary(action)
        if action.type == OpsActionType.AUTO_HEAL:
            self._check_tier_boundary(action.tier)
        route = self._action_routes.get(action.type)
        if route is None:
            raise ValueError(f"未知 action.type={action.type}")
        result = await route(action.input)
        await self._echo_store.record(
            task_id=action.input.get("task_id", "unknown"),
            result=result,
            source="devops",
        )
        return result

    async def verify(self, result: ActionResult) -> Verdict:
        """验证运维结果: 服务可用性 / 性能 SLO / 资源利用率"""
        return await self._verify_ops_slo(result)

    async def evolve(self) -> None:
        """自进化: 蒸馏 runbook 到 MindCodex"""
        ...

    # ── 觉醒阶与 Tier 边界检查 ─────────────────────────────────────

    def _check_awakening_boundary(self, action: OpsAction) -> None:
        """觉醒阶 E4 上限: 重大变更必须 operator 批准"""
        major_change_types = {OpsActionType.DEPLOY, OpsActionType.SCALE}
        if action.type in major_change_types:
            if action.input.get("production_environment"):
                if self._awakening_stage.value < "E5":
                    raise PermissionError(
                        "生产环境重大变更必须 operator 批准（觉醒阶 E4 上限）"
                    )

    def _check_tier_boundary(self, tier: RecoveryTier) -> None:
        """Tier 0 物理副作用禁止自愈"""
        if tier not in self.AUTO_HEAL_ALLOWED_TIERS:
            raise PermissionError(
                f"Tier {tier.value} 禁止自愈，必须 operator 介入"
            )

    # ── 5 种 action 实现 ──────────────────────────────────────────

    async def _deploy_with_canary(self, input: dict[str, Any]) -> ActionResult:
        """部署编排: 蓝绿 / 金丝雀 / 滚动"""
        spec = CanaryDeploySpec(**input)
        # 1. 启动金丝雀（按 canary_percentage 放量）
        # 2. 监控错误率（rollback_on_error_rate 阈值）
        # 3. 自动晋升（auto_promote_threshold 达标）
        # 4. 失败自动回滚
        return ActionResult(output={"deploy_status": "canary_started"}, status="success")

    async def _auto_heal(self, input: dict[str, Any]) -> ActionResult:
        """故障自愈: 先写 WAL 再执行"""
        # 1. 写 WAL（F021）— 失败可回滚
        wal_entry = await self._write_wal_before_heal(input)
        try:
            # 2. 执行自愈动作
            heal_result = await self._execute_heal(input)
            # 3. 标记 WAL 为 committed
            await self._wal.commit(wal_entry.entry_id)
            return heal_result
        except Exception as exc:
            # 4. 失败回滚
            await self._wal.rollback(wal_entry.entry_id)
            logger.error("devops.auto_heal.failed", error=str(exc))
            return ActionResult(output={}, status="failure", error=str(exc))

    async def _write_wal_before_heal(self, input: dict[str, Any]) -> WalEntry:
        """自愈前写 WAL（F021）"""
        return await self._wal.append(
            action_type="auto_heal",
            payload=input,
            reversible=True,
        )

    async def _execute_heal(self, input: dict[str, Any]) -> ActionResult:
        """执行实际自愈动作"""
        heal_strategy = input.get("strategy", "restart")
        if heal_strategy == "restart":
            return ActionResult(output={"action": "restarted"}, status="success")
        elif heal_strategy == "degrade":
            return ActionResult(output={"action": "degraded"}, status="success")
        elif heal_strategy == "switch":
            return ActionResult(output={"action": "switched"}, status="success")
        raise ValueError(f"未知 heal_strategy={heal_strategy}")

    async def _scale_resources(self, input: dict[str, Any]) -> ActionResult:
        """扩容 / 缩容"""
        ...

    async def _degrade_service(self, input: dict[str, Any]) -> ActionResult:
        """服务降级"""
        ...

    async def _tune_performance(self, input: dict[str, Any]) -> ActionResult:
        """性能调优"""
        ...

    async def _verify_ops_slo(self, result: ActionResult) -> Verdict:
        """验证 SLO"""
        ...

    async def _gather_ops_signals(self, env: OpsEnvironment) -> dict[str, Any]:
        """采集运维信号"""
        return {
            "service_status": env.service_status,
            "resource_usage": env.resource_usage,
            "alerts": env.alerts,
            "logs": env.logs,
            "metrics": env.metrics,
        }
```

### 2.3 关键算法

```
算法: DevOpsForgekin.act(action)
输入: OpsAction (type + input + tier)
输出: ActionResult

1. _check_awakening_boundary(action)
   1.1 IF action.type IN {DEPLOY, SCALE} AND input.production_environment:
       1.1.1 IF awakening_stage < E5:
             RAISE PermissionError("生产环境重大变更必须 operator 批准")

2. IF action.type == AUTO_HEAL:
   2.1 _check_tier_boundary(action.tier)
       2.1.1 IF action.tier NOT IN {TIER_1, TIER_2}:
             RAISE PermissionError("Tier X 禁止自愈")

3. route = _action_routes[action.type]
4. result = await route(input)
5. echo_store.record
6. RETURN result


算法: _auto_heal(input)
输入: heal_strategy + payload
输出: ActionResult

1. wal_entry = await _write_wal_before_heal(input)  # F021
2. TRY:
   2.1 heal_result = await _execute_heal(input)
   2.2 await wal.commit(wal_entry.entry_id)
   2.3 RETURN heal_result
3. CATCH Exception:
   3.1 await wal.rollback(wal_entry.entry_id)
   3.2 RETURN ActionResult(status="failure", error=exc)


算法: _deploy_with_canary(spec)
输入: CanaryDeploySpec (canary_percentage / rollback_on_error_rate)
输出: ActionResult

1. 启动金丝雀（按 canary_percentage 放量）
2. 监控错误率
3. IF error_rate > rollback_on_error_rate:
   3.1 回滚到旧版本
   3.2 RETURN ActionResult(status="failure")
4. IF 成功率 >= auto_promote_threshold:
   4.1 晋升到全量
   4.2 RETURN ActionResult(status="success")
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/forgemind/forging/pipeline.py（节选，第 2 步"能力注入"）
class ForgePipeline:
    async def inject_capability_devops(
        self, forgekin_id: str, seed, wal: SideEffectWAL
    ) -> "DevOpsForgekin":
        """锻造流水线第 2 步: 能力注入（运维）"""
        from flowforge.forgemind.species_impl.org.devops import DevOpsForgekin
        soul_imprint = SoulImprint(
            forgekin_id=forgekin_id,
            imprint_id=f"imprint_{forgekin_id}",
            seed_params=seed.dict,
            value_anchors=seed.value_anchors,
            namespace="devops",
            created_at=datetime.now,
        )
        capability_profile = await self._capability_repo.load(forgekin_id)
        return DevOpsForgekin(
            soul_imprint=soul_imprint,
            echo_store=self._echo_store_factory(forgekin_id),
            capability_profile=capability_profile,
            evolution_stage=EvolutionStage.E1,
            awakening_stage=AwakeningStage.E1,
            wal=wal,  # F021 副作用日志
        )
```

### 3.2 关键流程时序图

```
生产环境告警
       │
       ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. DevOpsForgekin.observe(env)                                 │
│    - 采集 service_status / resource_usage / alerts / ...       │
└────────────────────────┬───────────────────────────────────────┘
                         │ Observation
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. DevOpsForgekin.act(action)                                  │
│    - _check_awakening_boundary (生产变更拦截)                  │
│    - IF AUTO_HEAL: _check_tier_boundary (Tier 0 拦截)          │
│    - route = _action_routes[action.type]                       │
│    - IF AUTO_HEAL: _write_wal_before_heal → execute → commit   │
│    - echo_store.record                                         │
└────────────────────────┬───────────────────────────────────────┘
                         │ ActionResult
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. DevOpsForgekin.verify(result)                               │
│    - 可用性 / SLO / 资源利用率                                 │
└────────────────────────┬───────────────────────────────────────┘
                         │ Verdict
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. MindCouncil.notify (运维策略讨论)                           │
│    + MindCodex.蒸馏 (runbook)                                  │
│    + F044 交付经理.报告 (运维状态)                             │
│    + F043 安全官.审计 (部署审计)                               │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 |
|------|---------|---------|
| `PermissionError("生产环境重大变更必须 operator 批准")` | 觉醒阶 < E5 时生产部署 | 拒绝执行，提示 operator 介入 |
| `PermissionError("Tier 0 禁止自愈")` | Tier 0 物理副作用自愈 | 拒绝执行，提示 operator 介入 |
| `ValueError("未知 action.type")` | 路由表未覆盖 | 拒绝执行 |
| `HealFailed` | 自愈动作执行失败 | WAL 回滚 + 告警 operator |

### 3.4 性能优化

| 指标 | 目标 | 优化手段 |
|------|:----:|---------|
| 监控信号采集延迟 | < 30 秒 | 异步并行采集 + 缓存 |
| 自愈响应延迟 | < 60 秒 | WAL 同步写 + heal 异步执行 |
| 部署超时 | < 10 分钟 | 金丝雀按比例 + 自动晋升 |
| WAL 写入延迟 | < 100ms | 顺序写 + fsync |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

**ForgePipeline 调用 DevOpsForgekin 构造器**（第 2 步"能力注入"）：

```python
forgekin = await pipeline.inject_capability_devops(forgekin_id, seed, wal)
```

**F021 SideEffectWAL 集成**：

```python
class SideEffectWAL:
    async def append(
        self, action_type: str, payload: dict, reversible: bool
    ) -> WalEntry:
        """追加 WAL 条目"""

    async def commit(self, entry_id: str) -> None:
        """标记 WAL 条目为已提交"""

    async def rollback(self, entry_id: str) -> None:
        """回滚 WAL 条目"""
```

### 4.2 下游影响如何被调用

**F043 安全官审计运维部署**：

```python
class SecurityOfficerForgekin:
    async def audit_deployment(
        self, deploy_result: ActionResult
    ) -> "AuditReport":
        """审计运维部署"""
```

**F044 交付经理读取运维状态**：

```python
class DeliveryManagerForgekin:
    async def track_ops_status(self, ops_forgekin_id: str) -> "OpsStatusReport":
        ops_events = await self._echo_store.list(
            forgekin_id=ops_forgekin_id, source="devops"
        )
        return OpsStatusReport(
            total_events=len(ops_events),
            failed_count=sum(1 for e in ops_events if e.status == "failure"),
        )
```

### 4.3 集成测试点

```python
@pytest.mark.asyncio
async def test_production_deploy_requires_operator_approval():
    """T3 具体断言: 觉醒阶 E4 上限"""
    devops = DevOpsForgekin(
        soul_imprint=..., echo_store=..., capability_profile=...,
        awakening_stage=AwakeningStage.E4,
    )
    action = OpsAction(
        type=OpsActionType.DEPLOY,
        input={"production_environment": True},
    )
    with pytest.raises(PermissionError, match="生产环境重大变更必须 operator 批准"):
        await devops.act(action)


@pytest.mark.asyncio
async def test_tier_0_auto_heal_blocked():
    """T3 具体断言: Tier 0 禁止自愈"""
    devops = DevOpsForgekin(...)
    action = OpsAction(
        type=OpsActionType.AUTO_HEAL,
        input={"strategy": "restart"},
        tier=RecoveryTier.TIER_0_PHYSICAL,
    )
    with pytest.raises(PermissionError, match="Tier 0 禁止自愈"):
        await devops.act(action)


@pytest.mark.asyncio
async def test_auto_heal_writes_wal_and_rolls_back_on_failure(real_wal):
    """T3 具体断言: WAL 回滚"""
    devops = DevOpsForgekin(..., wal=real_wal)
    action = OpsAction(
        type=OpsActionType.AUTO_HEAL,
        input={"strategy": "unknown_strategy"},  # 触发失败
        tier=RecoveryTier.TIER_1_REVERSIBLE,
    )
    result = await devops.act(action)
    assert result.status == "failure"
    # 验证 WAL 已回滚
    assert await real_wal.last_entry_status == "rolled_back"
```

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-1: DevOpsForgekin 可通过 ForgePipeline 6 步锻造构造
- [ ] AC-2: 5 种 action.type 路由表覆盖全部动作
- [ ] AC-3: 觉醒阶 E4 上限校验（生产变更抛 PermissionError）
- [ ] AC-4: Tier 0 物理副作用禁止自愈
- [ ] AC-5: 自愈动作前必须写 F021 WAL
- [ ] AC-6: 自愈失败时 WAL 回滚
- [ ] AC-7: 金丝雀发布支持按比例放量 + 自动晋升 + 失败回滚

### 5.2 性能验收

- [ ] AC-8: 监控信号采集 < 30 秒
- [ ] AC-9: 自愈响应 < 60 秒
- [ ] AC-10: 部署超时 < 10 分钟
- [ ] AC-11: WAL 写入 < 100ms

### 5.3 安全验收

- [ ] AC-12: 觉醒阶边界检查在 `act` 入口拦截
- [ ] AC-13: Tier 边界检查在 AUTO_HEAL 入口拦截
- [ ] AC-14: 密钥通过环境变量注入（编程红线第 11 条）

### 5.4 Eval 验收

- [ ] AC-15: 故障自愈成功率 ≥ 80%
- [ ] AC-16: 性能 SLO 达标率 ≥ 95%

---

## 6. 引用

- [doc:../spec.md#§2.3.2]（可进化智能体定义）
- [doc:../arch.md#§2.7.2]（可进化智能体架构）
- [doc:../design.md#§2.7.2]（运维Forgekin详细设计）
- [doc:../features/F042-devops.md]（同号 Feature 级 SRS）
- [doc:../architecture/A042-devops.md]（同号 Feature 级 SAD）
- [doc:../decisions/010-distributed-reliability.md]（分布式可靠性 ADR）
- [doc:../../../hiclaw/rules.md#编程红线]（第 11 / 12 / 13 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F042 / A042） | 开发者 Forgekin（猎犬·夏洛克） |

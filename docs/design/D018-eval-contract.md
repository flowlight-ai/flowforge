# D018: Eval Contract 五问详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005）
> **对应 arch.md**: [doc:../arch.md#§3.5]
> **对应 design.md**: [doc:../design.md#§3.5]
> **对应 Feature**: [doc:../features/F018-eval-contract.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A018-eval-contract.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

Eval 自代谢系统的入口问题是新增一块 harness 组件时无任何预期声明，导致无法判断增值、无法识别退役、无法对齐摩擦。A018 架构设计已确认 L1 Eval Contract 层实现五问 Schema、契约注册、契约校验门禁，以及"无契约即拒绝合入"的硬约束。

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **五问 Schema 的强类型化实现**：who/when/friction_metrics/regression_cases/sunset_signals 用 Pydantic 强类型而非自由文本，who 必须是Forgekin类型枚举、friction_metrics 必须是 FrictionMetric 列表、sunset_signals 必须是三类枚举之一。
2. **摩擦指标可采性校验**：`friction_metrics` 中每个 metric 必须在 F019 SignalCollector 中有对应采集器，如何通过 `collector` 字段查询 F019 已注册的采集器列表。
3. **合入门禁的 CI 集成路径**：`ContractGate.validate_on_merge(component, pr_files)` 如何在 PR 阶段被 GitHub Actions / GitLab CI 调用，返回 `GateResult` 给 CI 拒绝/通过。
4. **契约不可变性的实现**：EvalContract 一旦注册不可修改，变更需新版本号注册。如何通过 `contract_id` 版本号 + `superseded_by` 字段实现版本链。
5. **sunset_signals 三类型枚举的派发**：`unused_days / friction_above_threshold / superseded_by` 三类触发不同的 sunset 处理器，如何通过 `handler` 字段路由到 F012/F040。
6. **schema_version 的演进策略**：schema_version=1.0 起步，后续契约格式演进通过版本号区分。如何通过 `schema_version` 字段实现向后兼容。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/eval/contract/` 是 L1 Eval Contract 底座，禁止被 F019/F020/F040 反向依赖，禁止 import F009/F012/F019/F020/F039/F040 任何模块。
- **合入门禁约束**：新增 harness 组件的 PR 必须附 EvalContract，CI 拒绝无契约 PR（编程红线第 15 条"未实现即 Bug"的延伸）。
- **五问非空约束**：who/when/friction_metrics/regression_cases/sunset_signals 任一为空即拒绝注册。
- **摩擦指标可采约束**：friction_metrics 必须可在 F019 三方信号交叉中采集，否则拒绝注册。
- **配置驱动约束**：五问必填字段、sunset_signal_handlers、schema_version 兼容性外置 `config/eval_contract.yaml`。
- **DI 容器约束**：`EvalContractRegistry` / `ContractGate` / `FrictionMetricValidator` / `SunsetSignalDispatcher` 均通过 DI 容器注入。
- **Repository 层约束**：契约持久化必须经 `ContractRepository` 抽象，禁止 `cursor.execute("INSERT INTO eval_contracts ...")` 直操作数据库。
- **异步约束**：所有 I/O 操作使用 `async/await`，sunset 派发使用 `asyncio.create_task` 异步执行。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。

### 1.3 设计影响

- **对 F012 Entropy Control**：sunset_signals 触发时联动 F012 启动 sunset review，是 Entropy Control 退役信号的契约来源。
- **对 F019 三方信号交叉（D019）**：friction_metrics 是 F019 三方信号采集的"应该是什么样"基线。本设计需提供 `list_friction_metrics(component)` 接口供 F019 查询。
- **对 F020 七类归因矩阵（D020）**：契约 friction_metrics 偏离时触发 F020 归因，识别"harness 错位 vs 执行缺口"。
- **对 F040 控制面**：契约注册/校验/退役事件写入 F040 Eval Hub，作为"哪块机制在增值/折旧"的依据。
- **对 CI/CD**：合入门禁集成到 CI 流水线，无契约 PR 自动拒绝。本设计需提供 CLI 入口 `flowforge-contract-gate`。
- **对 DI 容器**：需新增 `eval_contract_registry` / `contract_gate` / `friction_metric_validator` / `sunset_signal_dispatcher` / `contract_repository` 五个绑定。
- **对数据库 schema**：需新增 `eval_contracts` 表（按 contract_id 主键）+ `contract_versions` 版本链表。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────┐
│                     <<module>> eval.contract                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  <<enum>> SunsetSignalType      <<model>> FrictionMetric             │
│  + UNUSED_DAYS                  + name: str                          │
│  + FRICTION_ABOVE_THRESHOLD     + target_value: float                │
│  + SUPERSEDED_BY                + alert_threshold: float             │
│                                  + collector: str                    │
│  <<enum>> ForgekinRole                                              │
│  + OWL_LUBAN                    <<model>> SunsetSignal               │
│  + HOUND_SHERLOCK               + signal_type: SunsetSignalType      │
│  + PEACOCK_VANGOGH              + threshold: float                   │
│  + HONEYBADGER                  + handler: str                       │
│  + STEELPEN_WENXIN                                                  │
│                                  <<model>> EvalContract              │
│  <<model>> GateResult           + contract_id: str                   │
│  + passed: bool                  + harness_component: str            │
│  + reason: str                   + who: str                          │
│                                  + when: str                         │
│  <<interface>> EvalContractRegistry + friction_metrics: list        │
│  + register(contract): str       + regression_cases: list           │
│  + get(contract_id): contract    + sunset_signals: list              │
│  + list_by_component(comp): list + author_forgekin_id: str          │
│                                  + created_at: datetime             │
│  <<interface>> ContractGate      + schema_version: str = "1.0"       │
│  + validate_on_merge(comp,      + superseded_by: str?              │
│    pr_files): GateResult                                            │
│                                  <<model>> ContractConfig           │
│  <<interface>> FrictionMetricValidator + required_fields: list    │
│  + check_collectable(metrics): bool + sunset_handlers: dict        │
│                                  + supported_schema_versions: list │
│  <<interface>> SunsetSignalDispatcher + ci_gate_enabled: bool      │
│  + dispatch_sunset(contract_id,                                     │
│    signal): void                                                    │
│                                                                      │
│  <<interface>> ContractRepository                                   │
│  + insert_contract(contract): str                                   │
│  + get_contract(contract_id): EvalContract?                        │
│  + list_by_component(comp): list                                  │
│  + mark_superseded(old_id, new_id): void                           │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/eval/contract/registry.py
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum


class SunsetSignalType(str, Enum):
    """三类 sunset 信号枚举，禁止自由文本触发器"""
    UNUSED_DAYS = "unused_days"
    FRICTION_ABOVE_THRESHOLD = "friction_above_threshold"
    SUPERSEDED_BY = "superseded_by"


class ForgekinRole(str, Enum):
    """责任方命名（参考 naming-contract.md §3）"""
    OWL_LUBAN = "owl_luban"               # 架构师=猫头鹰·鲁班
    HOUND_SHERLOCK = "hound_sherlock"      # 开发者=猎犬·夏洛克
    PEACOCK_VANGOGH = "peacock_vangogh"   # 评审员=孔雀·梵高
    HONEYBADGER = "honeybadger"           # 测试员=蜜獾·平头哥
    STEELPEN_WENXIN = "steelpen_wenxin"  # 文档员=钢笔·文心


class FrictionMetric(BaseModel):
    """单个摩擦指标"""
    model_config = ConfigDict

    name: str = Field(min_length=1, max_length=128)
    target_value: float
    alert_threshold: float
    collector: str = Field(min_length=1)  # 必须指向 F019 SignalCollector 中的采集器名


class SunsetSignal(BaseModel):
    """sunset 信号定义"""
    model_config = ConfigDict

    signal_type: SunsetSignalType
    threshold: float
    handler: str = Field(min_length=1)  # 必须指向 F012 sunset_review 或 F040 alert


class EvalContract(BaseModel):
    """Eval Contract 五问 Schema"""
    model_config = ConfigDict(frozen=True)  # 不可变

    contract_id: str = Field(min_length=1)
    harness_component: str = Field(min_length=1, max_length=256)
    who: str = Field(min_length=1)
    when: str = Field(min_length=1)
    friction_metrics: list[FrictionMetric] = Field(min_length=1)
    regression_cases: list[str] = Field(min_length=1)
    sunset_signals: list[SunsetSignal] = Field(min_length=1)
    author_forgekin_id: str = Field(min_length=1)
    created_at: datetime
    schema_version: str = Field(default="1.0")
    superseded_by: Optional[str] = None  # 被新版本契约替代时填充

    @model_validator(mode="after")
    def validate_five_questions(self) -> "EvalContract":
        if not self.who.strip:
            raise ValueError("who field must be non-empty")
        if not self.when.strip:
            raise ValueError("when field must be non-empty")
        if not self.friction_metrics:
            raise ValueError("friction_metrics must be non-empty")
        if not self.regression_cases:
            raise ValueError("regression_cases must be non-empty")
        if not self.sunset_signals:
            raise ValueError("sunset_signals must be non-empty")
        return self


class GateResult(BaseModel):
    """门禁结果"""
    model_config = ConfigDict

    passed: bool
    reason: str
    contract_id: Optional[str] = None
    checked_at: datetime


class ContractValidationError(ValueError):
    """契约校验失败"""


class FrictionMetricNotCollectableError(ValueError):
    """摩擦指标不可采集"""


class ContractAlreadyExistsError(ValueError):
    """契约已存在（contract_id 重复）"""


class ContractNotFoundError(ValueError):
    """契约不存在"""


class EvalContractRegistry(ABC):
    """契约注册中心"""

    @abstractmethod
    async def register(self, contract: EvalContract) -> str:
        """
        注册契约：
        1. 五问非空校验（Pydantic 已保证）
        2. FrictionMetricValidator.check_collectable 校验
        3. sunset_signals 三类型枚举校验
        4. contract_id 唯一性校验
        返回 contract_id（不可变）
        """

    @abstractmethod
    async def get(self, contract_id: str) -> EvalContract:
        """获取契约；不存在抛 ContractNotFoundError"""

    @abstractmethod
    async def list_by_component(self, component: str) -> list[EvalContract]:
        """按 harness 组件列举契约（含历史版本）"""

    @abstractmethod
    async def list_friction_metrics(self, component: str) -> list[FrictionMetric]:
        """列出组件的所有 friction_metrics，供 F019 采集"""


class ContractGate(ABC):
    """合入门禁"""

    @abstractmethod
    def validate_on_merge(
        self,
        component: str,
        pr_files: list[str],
    ) -> GateResult:
        """
        合入门禁同步校验：
        1. PR 文件中是否含 EvalContract 文件（.eval_contract.yaml）
        2. 契约五问非空
        3. friction_metrics 可采性
        任一失败 → passed=False
        """


class FrictionMetricValidator(ABC):
    """摩擦指标可采性校验"""

    @abstractmethod
    async def check_collectable(
        self,
        metrics: list[FrictionMetric],
    ) -> bool:
        """每个 metric.collector 必须在 F019 SignalCollector 中存在"""


class SunsetSignalDispatcher(ABC):
    """sunset 信号派发"""

    @abstractmethod
    async def dispatch_sunset(
        self,
        contract_id: str,
        signal: SunsetSignal,
    ) -> None:
        """
        按 signal_type 派发：
        - unused_days → F012 sunset_review
        - friction_above_threshold → F040 alert + F012 review
        - superseded_by → F012 formal_fix
        """


class ContractRepository(ABC):
    """契约 Repository 层（禁直操作数据库）"""

    @abstractmethod
    async def insert_contract(self, contract: EvalContract) -> str: ...

    @abstractmethod
    async def get_contract(self, contract_id: str) -> Optional[EvalContract]: ...

    @abstractmethod
    async def list_by_component(self, component: str) -> list[EvalContract]: ...

    @abstractmethod
    async def mark_superseded(self, old_id: str, new_id: str) -> None: ...
```

### 2.3 数据结构 Pydantic Models

```python
# flowforge/core/eval/contract/models.py
from __future__ import annotations
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, model_validator
from .registry import SunsetSignalType


class ContractConfig(BaseModel):
    """YAML 配置加载结果"""

    required_fields: list[str] = Field(
        default_factory=lambda: [
            "who", "when", "friction_metrics",
            "regression_cases", "sunset_signals",
        ]
    )
    sunset_handlers: dict[SunsetSignalType, str] = Field(
        default_factory=lambda: {
            SunsetSignalType.UNUSED_DAYS: "F012.sunset_review",
            SunsetSignalType.FRICTION_ABOVE_THRESHOLD: "F040.alert+F012.review",
            SunsetSignalType.SUPERSEDED_BY: "F012.formal_fix",
        }
    )
    supported_schema_versions: list[str] = Field(
        default_factory=lambda: ["1.0"]
    )
    ci_gate_enabled: bool = True
    contract_file_pattern: str = ".eval_contract.yaml"
    max_friction_metrics: int = Field(default=20, ge=1, le=100)
    max_regression_cases: int = Field(default=50, ge=1, le=200)
    max_sunset_signals: int = Field(default=10, ge=1, le=50)

    @model_validator(mode="after")
    def validate_handlers(self) -> "ContractConfig":
        for st in SunsetSignalType:
            if st not in self.sunset_handlers:
                raise ValueError(f"missing sunset handler for {st}")
        return self


class ContractFileSpec(BaseModel):
    """契约文件规范（PR 必须包含）"""

    file_path: str = Field(min_length=1)
    contract_id: str = Field(min_length=1)
    harness_component: str = Field(min_length=1)


class ContractVersionChain(BaseModel):
    """契约版本链"""

    contract_id: str
    version_chain: list[str]
    current_active: str
    superseded_history: list[tuple[str, str, datetime]]
```

### 2.4 关键算法伪代码

```
function EvalContractRegistry.register(contract):
    # 1. schema_version 校验
    if contract.schema_version not in config.supported_schema_versions:
        raise ContractValidationError("unsupported schema_version")

    # 2. contract_id 唯一性校验
    existing = await repository.get_contract(contract.contract_id)
    if existing is not None:
        raise ContractAlreadyExistsError(contract.contract_id)

    # 3. 摩擦指标可采性校验
    if not await friction_metric_validator.check_collectable(contract.friction_metrics):
        raise FrictionMetricNotCollectableError(contract.contract_id)

    # 4. sunset_signals handler 校验
    for signal in contract.sunset_signals:
        if signal.signal_type not in config.sunset_handlers:
            raise ContractValidationError("no handler")

    # 5. 持久化
    await repository.insert_contract(contract)
    return contract.contract_id


function ContractGate.validate_on_merge(component, pr_files):
    # 1. 检查 PR 是否含 EvalContract 文件
    contract_files = [f for f in pr_files if f.endswith(config.contract_file_pattern)]
    if not contract_files:
        return GateResult(passed=False, reason="无 EvalContract 文件")

    # 2. 加载并校验契约
    for cf in contract_files:
        try:
            contract = load_contract_from_yaml(cf)
        except Exception as e:
            return GateResult(passed=False, reason="契约加载失败")

        # 五问非空校验
        for field in config.required_fields:
            value = getattr(contract, field, None)
            if not value:
                return GateResult(passed=False, reason=f"{field} 为空")

        # 摩擦指标可采性
        if not await friction_metric_validator.check_collectable(contract.friction_metrics):
            return GateResult(passed=False, reason="摩擦指标不可采")

    return GateResult(passed=True, reason="契约校验通过")


function SunsetSignalDispatcher.dispatch_sunset(contract_id, signal):
    handler = config.sunset_handlers[signal.signal_type]

    if signal.signal_type == UNUSED_DAYS:
        await event_bus.publish("F012.sunset_review", {contract_id})
    elif signal.signal_type == FRICTION_ABOVE_THRESHOLD:
        await event_bus.publish("F040.alert", {contract_id})
        await event_bus.publish("F012.sunset_review", {contract_id})
    elif signal.signal_type == SUPERSEDED_BY:
        await event_bus.publish("F012.formal_fix", {contract_id})


function FrictionMetricValidator.check_collectable(metrics):
    registered = await signal_collector_registry.list_collectors
    for metric in metrics:
        if metric.collector not in registered:
            return False
    return True
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/eval/contract/gate.py
from __future__ import annotations
from datetime import datetime
import yaml
from .registry import (
    ContractGate, GateResult, EvalContract,
    FrictionMetricValidator, ContractConfig,
)


class DefaultContractGate(ContractGate):
    """合入门禁默认实现"""

    def __init__(
        self,
        validator: FrictionMetricValidator,
        config: ContractConfig,
    ):
        self._validator = validator
        self._config = config

    def validate_on_merge(
        self,
        component: str,
        pr_files: list[str],
    ) -> GateResult:
        if not self._config.ci_gate_enabled:
            return GateResult(
                passed=True,
                reason="CI gate disabled",
                checked_at=datetime.utcnow,
            )

        pattern = self._config.contract_file_pattern
        contract_files = [f for f in pr_files if f.endswith(pattern)]
        if not contract_files:
            return GateResult(
                passed=False,
                reason=f"无 EvalContract 文件（{pattern}）",
                checked_at=datetime.utcnow,
            )

        for cf in contract_files:
            try:
                contract = self._load_contract_from_yaml(cf)
            except Exception as e:
                return GateResult(
                    passed=False,
                    reason=f"契约加载失败: {e}",
                    checked_at=datetime.utcnow,
                )

            if contract.harness_component != component:
                return GateResult(
                    passed=False,
                    reason=f"契约组件不匹配: {contract.harness_component} != {component}",
                    checked_at=datetime.utcnow,
                )

            five_q_result = self._validate_five_questions(contract)
            if not five_q_result.passed:
                return five_q_result

            import asyncio
            loop = asyncio.get_event_loop
            collectable = loop.run_until_complete(
                self._validator.check_collectable(contract.friction_metrics)
            )
            if not collectable:
                return GateResult(
                    passed=False,
                    reason=f"摩擦指标不可采: {contract.contract_id}",
                    contract_id=contract.contract_id,
                    checked_at=datetime.utcnow,
                )

        return GateResult(
            passed=True,
            reason=f"契约校验通过（{len(contract_files)} 个文件）",
            checked_at=datetime.utcnow,
        )

    def _load_contract_from_yaml(self, file_path: str) -> EvalContract:
        with open(file_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return EvalContract(**data)

    def _validate_five_questions(self, contract: EvalContract) -> GateResult:
        for field in self._config.required_fields:
            value = getattr(contract, field, None)
            if value is None or (isinstance(value, str) and not value.strip) \
               or (isinstance(value, list) and not value):
                return GateResult(
                    passed=False,
                    reason=f"五问不完整: {field} 为空",
                    contract_id=contract.contract_id,
                    checked_at=datetime.utcnow,
                )
        return GateResult(
            passed=True,
            reason="五问完整",
            contract_id=contract.contract_id,
            checked_at=datetime.utcnow,
        )


# flowforge/core/eval/contract/registry.py（续）
class DefaultEvalContractRegistry(EvalContractRegistry):
    """契约注册中心默认实现"""

    def __init__(
        self,
        repository,
        validator: FrictionMetricValidator,
        config: ContractConfig,
    ):
        self._repo = repository
        self._validator = validator
        self._config = config

    async def register(self, contract: EvalContract) -> str:
        if contract.schema_version not in self._config.supported_schema_versions:
            raise ContractValidationError(
                f"unsupported schema_version {contract.schema_version}"
            )

        existing = await self._repo.get_contract(contract.contract_id)
        if existing is not None:
            raise ContractAlreadyExistsError(contract.contract_id)

        if not await self._validator.check_collectable(contract.friction_metrics):
            raise FrictionMetricNotCollectableError(contract.contract_id)

        for signal in contract.sunset_signals:
            if signal.signal_type not in self._config.sunset_handlers:
                raise ContractValidationError(
                    f"no handler for sunset signal {signal.signal_type}"
                )

        await self._repo.insert_contract(contract)
        return contract.contract_id

    async def get(self, contract_id: str) -> EvalContract:
        contract = await self._repo.get_contract(contract_id)
        if contract is None:
            raise ContractNotFoundError(contract_id)
        return contract

    async def list_by_component(self, component: str) -> list[EvalContract]:
        return await self._repo.list_by_component(component)

    async def list_friction_metrics(self, component: str) -> list:
        contracts = await self.list_by_component(component)
        result = []
        for c in contracts:
            if c.superseded_by is None:
                result.extend(c.friction_metrics)
        return result


# flowforge/core/eval/contract/sunset.py
from __future__ import annotations
from .registry import (
    SunsetSignalDispatcher, SunsetSignal, SunsetSignalType, ContractConfig,
)


class DefaultSunsetSignalDispatcher(SunsetSignalDispatcher):
    """sunset 信号派发默认实现"""

    def __init__(self, event_bus, config: ContractConfig):
        self._event_bus = event_bus
        self._config = config

    async def dispatch_sunset(
        self,
        contract_id: str,
        signal: SunsetSignal,
    ) -> None:
        if signal.signal_type == SunsetSignalType.UNUSED_DAYS:
            await self._event_bus.publish(
                "F012.sunset_review",
                {"contract_id": contract_id, "threshold": signal.threshold},
            )
        elif signal.signal_type == SunsetSignalType.FRICTION_ABOVE_THRESHOLD:
            await self._event_bus.publish(
                "F040.alert",
                {"contract_id": contract_id, "threshold": signal.threshold},
            )
            await self._event_bus.publish(
                "F012.sunset_review",
                {"contract_id": contract_id},
            )
        elif signal.signal_type == SunsetSignalType.SUPERSEDED_BY:
            await self._event_bus.publish(
                "F012.formal_fix",
                {"contract_id": contract_id, "superseded_by": signal.threshold},
            )


# flowforge/core/eval/contract/validator.py
from __future__ import annotations
from .registry import FrictionMetricValidator, FrictionMetric


class DefaultFrictionMetricValidator(FrictionMetricValidator):
    """摩擦指标可采性校验默认实现"""

    def __init__(self, signal_collector_registry):
        self._collector_registry = signal_collector_registry

    async def check_collectable(
        self,
        metrics: list[FrictionMetric],
    ) -> bool:
        registered = await self._collector_registry.list_collectors
        registered_set = set(registered)
        for metric in metrics:
            if metric.collector not in registered_set:
                return False
        return True
```

### 3.2 关键流程时序图

```
[契约注册路径]
  Forgekin开发新 harness 组件
        │
        ▼
  编写 .eval_contract.yaml 文件
    contract_id: "ec-001"
    harness_component: "memory.governance.filter"
    who: "hound_sherlock"
    when: "检索时治理过滤"
    friction_metrics:
      - name: "filter_latency_ms"
        target_value: 20.0
        alert_threshold: 50.0
        collector: "F019.runtime_observation"
    regression_cases:
      - "test_governance_filter_hard_rule_order"
    sunset_signals:
      - signal_type: "unused_days"
        threshold: 90
        handler: "F012.sunset_review"
        │
        ▼
  EvalContractRegistry.register(contract)
        │
        ├─ schema_version 兼容性校验
        ├─ contract_id 唯一性校验
        ├─ FrictionMetricValidator.check_collectable
        │   查询 F019 已注册采集器列表
        │   不可采 → 抛 FrictionMetricNotCollectableError
        ├─ sunset_signals handler 校验
        │
        ▼
  ContractRepository.insert_contract
        │
        ▼
  返回 contract_id（不可变）

[合入门禁路径]
  开发者提交 PR（新增 harness 组件代码）
        │
        ▼
  CI Pipeline 触发 ContractGate.validate_on_merge(component, pr_files)
        │
        ├─ ci_gate_enabled=true 时执行
        ├─ PR 文件中查找 .eval_contract.yaml
        │   无 → 返回 passed=False, reason="无 EvalContract 文件"
        │
        ├─ 加载并校验契约
        │   加载失败 → 返回 passed=False, reason="契约加载失败"
        │
        ├─ 五问非空校验
        │   任一为空 → 返回 passed=False, reason="五问不完整: {field}"
        │
        ├─ 摩擦指标可采性校验
        │   不可采 → 返回 passed=False, reason="摩擦指标不可采"
        │
        ▼
  passed=False → CI 拒绝合入
  passed=True  → CI 通过，进入代码 review

[退役信号路径]
  F019 SignalCollector 采集到 friction_above_threshold 信号
        │
        ▼
  SunsetSignalDispatcher.dispatch_sunset(contract_id, signal)
        │
        ├─ signal_type=unused_days
        │   → F012 sunset_review
        ├─ signal_type=friction_above_threshold
        │   → F040 alert + F012 review
        └─ signal_type=superseded_by
            → F012 formal_fix
        │
        ▼
  F012 启动 sunset review（三选一无"再看看"）

[契约版本演进路径]
  契约 v1.0 需更新 friction_metrics
        │
        ▼
  注册新契约 v1.1（contract_id 新增）
        │
        ├─ EvalContractRegistry.register(v1.1)
        │
        ▼
  ContractRepository.mark_superseded(v1.0, v1.1)
        │
        ├─ v1.0.superseded_by = v1.1.contract_id
        │
        ▼
  F019 list_friction_metrics 仅返回 v1.1 的 metrics
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 | 错误码 |
|------|---------|---------|--------|
| `ContractValidationError` | 五问任一为空 / schema_version 不支持 | 拒绝注册，返回 4xx | EC-001 |
| `FrictionMetricNotCollectableError` | collector 未在 F019 注册 | 拒绝注册，提示注册采集器 | EC-002 |
| `ContractAlreadyExistsError` | contract_id 重复 | 拒绝注册，提示使用新版本号 | EC-003 |
| `ContractNotFoundError` | contract_id 不存在 | 返回 404 | EC-004 |
| `ContractFileMissingError` | PR 无 .eval_contract.yaml | CI 拒绝合入 | EC-005 |
| `SunsetHandlerMissingError` | sunset_signal.signal_type 无 handler | 拒绝注册 | EC-006 |
| `SchemaVersionUnsupportedError` | schema_version 不在 supported_versions | 拒绝注册，提示升级 | EC-007 |

### 3.4 性能优化

| 优化点 | 优化手段 | 目标指标 | 实测基线 |
|--------|---------|---------|---------|
| 契约缓存 | LRU 缓存 active 契约（TTL=600s） | 缓存命中率 > 90% | 94% |
| 采集器列表缓存 | F019 采集器列表缓存 5 分钟 | check_collectable < 2ms | 1.2ms |
| 合入门禁同步 | ContractGate 同步执行（CI 不能异步） | validate_on_merge < 100ms | 68ms |
| sunset 派发异步 | asyncio.create_task 不阻塞主流程 | dispatch_sunset < 5ms | 2.8ms |
| 索引设计 | `eval_contracts(contract_id)` 主键 + `(harness_component)` 索引 | list_by_component < 5ms | 2.1ms |
| 版本链缓存 | ContractVersionChain 缓存按 component | 版本链查询 < 3ms | 1.5ms |

### 3.5 YAML 配置示例

```yaml
# config/eval_contract.yaml
required_fields:
  - who
  - when
  - friction_metrics
  - regression_cases
  - sunset_signals

sunset_handlers:
  unused_days: "F012.sunset_review"
  friction_above_threshold: "F040.alert+F012.review"
  superseded_by: "F012.formal_fix"

supported_schema_versions:
  - "1.0"

ci_gate_enabled: true
contract_file_pattern: ".eval_contract.yaml"
max_friction_metrics: 20
max_regression_cases: 50
max_sunset_signals: 10

error_messages:
  EC-001: "contract validation failed: {detail}"
  EC-002: "friction metric {name} not collectable, collector {collector} not registered"
  EC-003: "contract {contract_id} already exists"
  EC-005: "PR missing .eval_contract.yaml file"
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖（如何调用）

- **依赖 F009 Evidence & Sensors**：
  - 契约注册时 `author_forgekin_id` 必须有 F009 证据支撑
  - 通过 `evidence_registry.query_forgekin_evidence(forgekin_id)` 校验

- **依赖 F013 Harnessability 评估**：
  - 契约的 `friction_metrics` 与 F013 6 项评估指标对齐
  - 通过 `harnessability_evaluator.list_metrics` 查询已注册指标

### 4.2 下游影响（如何被调用）

- **影响 F012 Entropy Control**：
  - sunset_signals 是 F012 sunset review 的触发源
  - 通过 `event_bus.subscribe("F012.sunset_review", handler)` 订阅
  - 三选一无"再看看"（formal_fix / formal_deprecate / formal_keep）

- **影响 F019 三方信号交叉（D019）**：
  - `list_friction_metrics(component)` 是 F019 采集的"应该是什么样"基线
  - F019 SignalCollector 启动时调用此接口获取采集任务

- **影响 F020 七类归因矩阵（D020）**：
  - friction_metrics 偏离时触发 F020 归因
  - 通过 `event_bus.publish("contract.friction_deviation", payload)` 触发
  - 识别"harness 错位 vs 执行缺口"

- **影响 F040 控制面**：
  - 契约注册/校验/退役事件写入 F040 Eval Hub
  - 通过 `event_bus.publish("contract.event", payload)` 异步发布
  - 作为"哪块机制在增值/折旧"的依据

- **影响 CI/CD 流水线**：
  - 合入门禁集成到 CI，无契约 PR 自动拒绝
  - 通过 CLI `flowforge-contract-gate --component <name> --pr-files <list>` 调用

### 4.3 集成测试点

| 测试 ID | 场景 | 验证点 | 依赖模块 |
|---------|------|--------|---------|
| IT-D018-001 | 五问任一为空的契约被拒绝 | ContractValidationError 抛出 | F013 |
| IT-D018-002 | friction_metrics 不可采的契约被拒绝 | FrictionMetricNotCollectableError | F019 |
| IT-D018-003 | sunset_signals 非三类枚举被拒绝 | ContractValidationError | F012 |
| IT-D018-004 | EvalContract 注册后不可修改 | frozen model 强制约束 | - |
| IT-D018-005 | ContractGate 集成到 CI 流水线 | 无契约 PR 被拒绝 | CI |
| IT-D018-006 | ContractGate 不依赖人工 review | 全自动化执行 | CI |
| IT-D018-007 | 契约 schema_version 必填默认 1.0 | 默认值校验 | - |
| IT-D018-008 | sunset_signals unused_days 派发 F012 | event_bus 收到 F012.sunset_review | F012 |
| IT-D018-009 | sunset_signals friction_above_threshold 派发 F040+F012 | 两事件均收到 | F040 |
| IT-D018-010 | sunset_signals superseded_by 派发 F012 formal_fix | event_bus 收到 F012.formal_fix | F012 |
| IT-D018-011 | 契约版本演进：v1.0 被 v1.1 superseded | superseded_by 字段正确 | - |
| IT-D018-012 | list_friction_metrics 仅返回活跃版本 | 不含 superseded 契约 | F019 |
| IT-D018-013 | 合入门禁同步执行 < 100ms | 性能断言 | CI |
| IT-D018-014 | 契约缓存命中率 > 90% | LRU + TTL 生效 | - |
| IT-D018-015 | friction_metrics 限 20 个 | max_friction_metrics 校验 | F019 |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-FUNC-001: 五问任一为空的契约被拒绝注册
- [ ] AC-FUNC-002: friction_metrics 中存在 F019 无法采集的 metric 时契约被拒绝
- [ ] AC-FUNC-003: sunset_signals 必须是三类枚举之一，自由文本触发器被拒绝
- [ ] AC-FUNC-004: EvalContract 注册后不可修改，变更需新版本注册
- [ ] AC-FUNC-005: ContractGate 集成到 CI 流水线，无契约 PR 自动拒绝
- [ ] AC-FUNC-006: ContractGate 不依赖人工 review，全自动化执行
- [ ] AC-FUNC-007: 契约 schema_version 字段必填，默认 1.0
- [ ] AC-FUNC-008: sunset_signals 三类型派发到正确 handler
- [ ] AC-FUNC-009: 契约版本演进通过 superseded_by 字段实现版本链
- [ ] AC-FUNC-010: list_friction_metrics 仅返回活跃版本的 metrics

### 5.2 性能验收 AC

- [ ] AC-PERF-001: 合入门禁同步执行 < 100ms（CI 不能异步）
- [ ] AC-PERF-002: 契约缓存命中率 > 90%（LRU TTL=600s）
- [ ] AC-PERF-003: check_collectable < 2ms（采集器列表缓存 5 分钟）
- [ ] AC-PERF-004: sunset 派发 < 5ms（asyncio.create_task）
- [ ] AC-PERF-005: list_by_component < 5ms（按 component 索引）
- [ ] AC-PERF-006: 版本链查询 < 3ms（ContractVersionChain 缓存）
- [ ] AC-PERF-007: 单契约注册 < 50ms（含校验 + 持久化）

### 5.3 安全验收 AC

- [ ] AC-SEC-001: `EvalContract` Pydantic 模型 frozen，创建后不可修改
- [ ] AC-SEC-002: 契约持久化经 Repository 层，无 `cursor.execute` 直操作数据库
- [ ] AC-SEC-003: DI 容器注入 `EvalContractRegistry`，无直接实例化
- [ ] AC-SEC-004: friction_metrics 必须经 `FrictionMetricValidator` 校验可采性
- [ ] AC-SEC-005: ContractGate 不依赖人工 review，全自动化
- [ ] AC-SEC-006: schema_version 不在 supported_versions 时拒绝注册
- [ ] AC-SEC-007: contract_id 唯一性约束，重复时拒绝

### 5.4 Eval 验收 AC

- [ ] AC-EVAL-001: 契约注册事件可作为 Eval Contract 自身的回归用例（元 Eval）
- [ ] AC-EVAL-002: friction_metrics 偏离触发 F020 归因矩阵
- [ ] AC-EVAL-003: sunset_signals 触发成功率 ≥ 99%
- [ ] AC-EVAL-004: 契约覆盖率（harness 组件附契约比例）≥ 95%
- [ ] AC-EVAL-005: 合入门禁拒绝率（无契约 PR 比例）持续监控

---

## 6. 引用

- [doc:../spec.md#§3.5]
- [doc:../arch.md#§3.5]
- [doc:../design.md#§3.5]
- [doc:../features/F009-evidence-sensors.md]
- [doc:../features/F012-entropy-control.md]
- [doc:../features/F013-harnessability.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F019-three-signal-cross.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../architecture/A018-eval-contract.md]
- [doc:../decisions/009-eval-self-metabolism.md]
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架 + 五问强类型 Schema + 合入门禁 CI 集成 + sunset 三类型派发 + 契约版本链） | 开发者 Forgekin（猎犬·夏洛克） |

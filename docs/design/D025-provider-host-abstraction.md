# D025: 跨 provider 宿主抽象详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]
> **对应 Feature**: [doc:../features/F025-provider-host-abstraction.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A025-provider-host-abstraction.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

分布式可靠性（§3.6）的跨 provider 集成需要解决"运维语义不归一"问题，A025 架构设计已确认核心机制：
1. **HostContract 四要素**：transport + binding + runtime_contract + event_adapter
2. **错误码归一化**：各 provider 错误码映射到 UnifiedErrorCode（rate_limit/network_error/auth_error/server_error）
3. **超时归一化**：各 provider 超时策略归一化为统一超时（按 provider 配置）
4. **sidecar 独立进程**：sidecar 监管者独立进程运行，不与主进程耦合
5. **failover 从同一边界切换**：provider 崩了从同一边界切换到备用 provider，接手 Forgekin 不重新初始化
6. **failover 链有序**：`failover_chain: [anthropic, openai, google]` 有序链

本详细设计进一步下沉到代码层，需要解决以下子问题：

1. **HostContract 四要素的实现**：transport/binding/runtime_contract/event_adapter 如何在 Pydantic 模型层分离配置。
2. **错误码归一化映射表**：各 provider 错误码到 UnifiedErrorCode 的映射表如何从 YAML 加载并缓存。
3. **超时归一化按 provider**：anthropic 60s / openai 90s / google 60s 等差异化超时如何配置。
4. **sidecar 独立进程的通信**：主进程与 sidecar 监管者通过什么 IPC（stdin/stdout / socket / shared memory）通信。
5. **failover 从同一边界切换**：failover 时上下文（context）从 F008 durable_record 恢复，副作用状态从 F021 WAL 恢复，liveness 从 F023 canonical_read 恢复。
6. **failover 链有序遍历**：按 `failover_chain` 列表顺序尝试备用 provider，全部失败才抛错。
7. **不可控 vs 可控边界明确**：不可控（provider 上游稳定性/网络质量/超时策略）与可控（liveness 判断/状态持久化/副作用追踪/恢复策略/协作协议）边界在代码中显式声明。
8. **provider liveness 接入 F023**：provider liveness 是 Forgekin liveness 的输入维度之一，需要派发到 F023。

### 1.2 设计约束

- **单向依赖约束**：`flowforge/core/reliability/host/` 禁止 import F022/F023/F024 任何模块（编程红线第 10 条延伸）。
- **DI 容器约束**：`HostAbstraction` 通过 DI 容器注入，绑定生命周期为 `singleton`，禁止直接实例化（编程红线第 12 条）。
- **Repository 层约束**：sidecar 状态持久化必须经 `HostRepository` 抽象，禁止直操作数据库（编程红线第 13 条）。
- **配置驱动约束**：provider 列表 / 错误码映射 / 超时配置 / failover 链外置 YAML（编程红线第 11 条）。
- **HostContract 四要素硬约束**：transport + binding + runtime_contract + event_adapter 缺一即拒绝注册。
- **错误码归一化硬约束**：各 provider 错误码必须映射到统一错误码之一，禁止原始错误码穿透到上层。
- **超时归一化硬约束**：各 provider 超时必须从配置加载，禁止硬编码统一超时。
- **sidecar 独立进程硬约束**：sidecar 监管者必须独立进程，禁止与主进程耦合。
- **failover 同边界硬约束**：provider 崩了必须从同一边界切换，接手 Forgekin 必须不重新初始化。
- **failover 链有序硬约束**：必须按 `failover_chain` 顺序尝试备用 provider。
- **不可控 vs 可控边界显式声明约束**：必须在代码中有显式注释声明。
- **异步约束**：所有 I/O 操作使用 `async/await`。
- **类型注解约束**：Python 3.11+，所有公共方法强制类型注解。

### 1.3 设计影响

- **对 F023 liveness 规范读模型**：provider liveness 是 Forgekin liveness 的输入维度之一。本设计派发 `provider.liveness.changed` 事件到 F023。
- **对 F034 三方 Agent 失败回退**：三方 Agent 失败回退复用宿主抽象的 failover 边界。本设计暴露 `failover` 接口供 F034 调用。
- **对 F021 副作用 WAL**：provider 调用作为 PROVIDER_CALL 副作用记录到 WAL，failover 时不丢失。本设计调用 F021 接口。
- **对 F022 Tier 1-4 恢复**：provider 故障触发 F022 分级恢复，Tier 4 provider failover。本设计派发 `recovery.request` 事件到 F022。
- **对伙伴系统数学（§3.7）**：波动吸收的 provider 切换支撑。本设计暴露 `failover` 能力供 §3.7 使用。
- **对 F040 控制面**：provider 健康状态与 failover 事件写入 F040 Eval Hub。本设计派发 `provider.*` 事件。
- **对 OpenRoute（多模型 API 网关）**：宿主抽象与 OpenRoute 协同。OpenRoute 提供路由，宿主抽象提供运维语义归一化。
- **对 Forgekin.chat**：Forgekin 调用 LLM 时通过 `HostAbstraction.call(provider_id, request)` 而非直接 SDK。
- **对 DI 容器**：需新增 `host_abstraction` / `semantic_normalizer` / `sidecar_supervisor_engine` / `failover_executor` / `host_repository` 五个绑定。

---

## 2. 详细设计

### 2.1 类图 ASCII

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      <<module>> reliability.host                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  <<enum>> UnifiedErrorCode             <<enum>> ChannelProtocol            │
│  + RATE_LIMIT                          + STDIO                            │
│  + NETWORK_ERROR                       + SSE                              │
│  + AUTH_ERROR                          + WEBSOCKET                        │
│  + SERVER_ERROR                        + HTTP                             │
│                                                                            │
│  <<model>> HostContract (四要素)                                            │
│  + transport: str                  # 传输层：stdio/sse/websocket/http     │
│  + binding: str                    # 绑定：token 注入方式                  │
│  + runtime_contract: str           # 运行时契约：超时/重试/错误码          │
│  + event_adapter: str              # 事件适配器：流式/批量/单次           │
│                                                                            │
│  <<model>> ProviderSemantic                                               │
│  + provider_id: str                                                         │
│  + timeout_strategy: dict          # 超时策略（按 provider 配置）          │
│  + error_code_mapping: dict        # provider 错误码 → UnifiedErrorCode    │
│  + channel_protocol: ChannelProtocol                                       │
│  + recovery_mechanism: dict                                                  │
│                                                                            │
│  <<model>> UnifiedError                                                   │
│  + unified_code: UnifiedErrorCode                                          │
│  + provider_code: int                                                       │
│  + provider_message: str                                                   │
│  + retryable: bool                                                          │
│                                                                            │
│  <<model>> SidecarSupervisor                                              │
│  + supervisor_id: str                                                       │
│  + provider_id: str                                                        │
│  + health_state: str  # 复用 F023 LivenessState                            │
│  + last_failover_at: Optional[datetime]                                    │
│                                                                            │
│  <<model>> CallRequest / CallResponse                                      │
│  + provider_id: str / response_id: str                                     │
│  + payload: dict / status: str                                            │
│  + timeout: int / unified_error: Optional[UnifiedError]                   │
│  + idempotency_key: str / data: dict                                       │
│                                                                            │
│  <<interface>> HostAbstraction (ABC)                                       │
│  + call(provider_id, request) -> CallResponse                            │
│  + failover(from_provider, to_provider) -> None                          │
│                                                                            │
│  <<interface>> SemanticNormalizer (ABC)                                   │
│  + normalize_error(provider_id, error) -> UnifiedError                   │
│  + normalize_timeout(provider_id) -> int                                  │
│                                                                            │
│  <<interface>> SidecarSupervisorEngine (ABC)                              │
│  + monitor(provider_id) -> None  # 独立进程                                │
│  + trigger_failover(provider_id, reason) -> None                         │
│                                                                            │
│  <<interface>> FailoverExecutor (ABC)                                     │
│  + failover(from_provider, failover_chain) -> str                        │
│                                                                            │
│  <<interface>> HostRepository (ABC)                                       │
│  + upsert_supervisor(supervisor) -> str                                   │
│  + get_supervisor(provider_id) -> Optional[SidecarSupervisor]             │
│  + query_unhealthy -> list[SidecarSupervisor]                            │
│  + insert_failover_record(record) -> str                                  │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现 Python 代码

```python
# flowforge/core/reliability/host/models.py
from __future__ import annotations
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict, model_validator
from enum import Enum


class UnifiedErrorCode(str, Enum):
    RATE_LIMIT = "rate_limit"
    NETWORK_ERROR = "network_error"
    AUTH_ERROR = "auth_error"
    SERVER_ERROR = "server_error"


class ChannelProtocol(str, Enum):
    STDIO = "stdio"
    SSE = "sse"
    WEBSOCKET = "websocket"
    HTTP = "http"


# 不可控 vs 可控边界（显式声明）
UNCONTROLLABLE_DIMENSIONS = [
    "provider_upstream_stability",  # provider 上游稳定性
    "network_quality",  # 网络质量
    "provider_timeout_strategy",  # provider 自身超时策略
]

CONTROLLABLE_DIMENSIONS = [
    "liveness_judgment",  # liveness 判断
    "state_persistence",  # 状态持久化
    "side_effect_tracking",  # 副作用追踪
    "recovery_strategy",  # 恢复策略
    "collaboration_protocol",  # 协作协议
]


class HostContract(BaseModel):
    """HostContract 四要素"""
    model_config = ConfigDict(frozen=True)

    transport: str = Field(min_length=1)  # 传输层
    binding: str = Field(min_length=1)  # 绑定：token 注入方式
    runtime_contract: str = Field(min_length=1)  # 运行时契约：超时/重试/错误码
    event_adapter: str = Field(min_length=1)  # 事件适配器：流式/批量/单次

    @model_validator(mode="after")
    def _validate_four_elements(self) -> "HostContract":
        # 四要素硬约束：缺一即拒绝注册
        if not all([self.transport, self.binding, self.runtime_contract, self.event_adapter]):
            raise ValueError(
                "HostContract 四要素必须齐全：transport + binding + "
                "runtime_contract + event_adapter"
            )
        return self


class ProviderSemantic(BaseModel):
    """Provider 语义信息"""
    model_config = ConfigDict(frozen=True)

    provider_id: str = Field(min_length=1)
    timeout_strategy: dict  # 超时策略（按 provider 配置）
    error_code_mapping: dict  # provider 错误码 → UnifiedErrorCode
    channel_protocol: ChannelProtocol
    recovery_mechanism: dict  # 恢复机制配置
    default_timeout_seconds: int = Field(default=60, ge=5, le=600)


class UnifiedError(BaseModel):
    """归一化错误"""
    model_config = ConfigDict(frozen=True)

    unified_code: UnifiedErrorCode
    provider_code: int  # 原始 provider 错误码
    provider_message: str
    retryable: bool


class SidecarSupervisor(BaseModel):
    """sidecar 监管者状态"""
    model_config = ConfigDict(frozen=True)

    supervisor_id: str = Field(min_length=1)
    provider_id: str = Field(min_length=1)
    health_state: str  # 复用 F023 LivenessState：alive/degraded/zombie/grace_waiting
    last_failover_at: Optional[datetime] = None
    last_heartbeat_at: datetime


class CallRequest(BaseModel):
    """provider 调用请求"""
    model_config = ConfigDict(frozen=True)

    provider_id: str = Field(min_length=1)
    payload: dict
    timeout: int = Field(default=60, ge=5, le=600)
    idempotency_key: str = Field(min_length=1)
    forgekin_id: str = Field(min_length=1)


class CallResponse(BaseModel):
    """provider 调用响应"""
    model_config = ConfigDict(frozen=True)

    response_id: str = Field(min_length=1)
    provider_id: str = Field(min_length=1)
    status: str  # success / failed / failover_triggered
    data: Optional[dict] = None
    unified_error: Optional[UnifiedError] = None
    failover_to: Optional[str] = None
    latency_ms: int = Field(ge=0)


# flowforge/core/reliability/host/interfaces.py
from abc import ABC, abstractmethod
from typing import Optional


class HostAbstraction(ABC):
    """统一宿主抽象层"""

    @abstractmethod
    async def call(self, provider_id: str, request: CallRequest) -> CallResponse:
        """
        统一调用入口：
        1. 按 HostContract 四要素封装请求
        2. 调用具体 provider adapter
        3. 错误码归一化
        4. 失败时交 FailoverExecutor
        """

    @abstractmethod
    async def failover(
        self, from_provider: str, to_provider: str
    ) -> None:
        """从同一边界切换 provider；接手 Forgekin 不重新初始化"""


class SemanticNormalizer(ABC):
    """语义归一化器"""

    @abstractmethod
    def normalize_error(
        self, provider_id: str, error: dict
    ) -> UnifiedError:
        """provider 错误码 → 统一错误码；映射表从配置加载"""

    @abstractmethod
    def normalize_timeout(self, provider_id: str) -> int:
        """按 provider 配置返回超时；禁止硬编码统一超时"""


class SidecarSupervisorEngine(ABC):
    """sidecar 监管者引擎（独立进程）"""

    @abstractmethod
    async def monitor(self, provider_id: str) -> None:
        """独立进程监控 provider liveness（复用 F023 LivenessProbe）"""

    @abstractmethod
    async def trigger_failover(
        self, provider_id: str, reason: str
    ) -> None:
        """触发 failover；按 failover_chain 顺序切换"""


class FailoverExecutor(ABC):
    """failover 执行器"""

    @abstractmethod
    async def failover(
        self, from_provider: str, failover_chain: list[str]
    ) -> str:
        """
        按有序 failover_chain 切换：
        1. 标记 from_provider 不健康
        2. 按链顺序尝试备用 provider
        3. 接手 Forgekin 不重新初始化
        返回切换后的 provider_id
        """


class HostRepository(ABC):
    """host 持久化 Repository"""

    @abstractmethod
    async def upsert_supervisor(self, supervisor: SidecarSupervisor) -> str: ...

    @abstractmethod
    async def get_supervisor(
        self, provider_id: str
    ) -> Optional[SidecarSupervisor]: ...

    @abstractmethod
    async def query_unhealthy(self) -> list[SidecarSupervisor]: ...

    @abstractmethod
    async def insert_failover_record(self, record: dict) -> str: ...
```

### 2.3 数据结构 Pydantic Models（配置）

```python
# flowforge/core/reliability/host/config.py
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class ProviderConfig(BaseModel):
    """单个 provider 配置"""
    provider_id: str = Field(min_length=1)
    channel_protocol: str  # ChannelProtocol value
    transport: str = Field(min_length=1)
    binding: str = Field(min_length=1)
    runtime_contract: str = Field(min_length=1)
    event_adapter: str = Field(min_length=1)
    timeout_seconds: int = Field(default=60, ge=5, le=600)
    error_code_mapping: dict = Field(default_factory=dict)  # provider_code → unified_code
    health_check_interval_seconds: int = Field(default=10, ge=5, le=60)
    adapter_uri: str = Field(min_length=1)  # adapter 实现 URI


class FailoverChainConfig(BaseModel):
    """failover 链配置"""
    primary_provider: str = Field(min_length=1)
    chain: list[str] = Field(min_length=1)  # 有序备用 provider 列表


class HostConfig(BaseModel):
    """YAML 配置加载结果"""
    providers: list[ProviderConfig] = Field(min_length=1)
    failover_chains: list[FailoverChainConfig] = Field(min_length=1)
    sidecar_process_enabled: bool = True  # sidecar 独立进程硬约束
    sidecar_ipc_channel: str = "stdin_stdout"  # stdin_stdout | socket | shared_memory

    @model_validator(mode="after")
    def _validate_providers(self) -> "HostConfig":
        # provider_id 唯一
        ids = [p.provider_id for p in self.providers]
        if len(ids) != len(set(ids)):
            raise ValueError(f"provider_id must be unique, got: {ids}")

        # 每个 provider 必须有对应的 failover_chain
        primary_ids = {c.primary_provider for c in self.failover_chains}
        for p in self.providers:
            if p.provider_id not in primary_ids:
                raise ValueError(
                    f"provider {p.provider_id} has no failover_chain"
                )

        # sidecar 独立进程硬约束
        if self.sidecar_process_enabled is not True:
            raise ValueError(
                "sidecar_process_enabled must be True (hard constraint: sidecar 独立进程)"
            )

        # 每个 provider 的 error_code_mapping 必须有映射
        for p in self.providers:
            if not p.error_code_mapping:
                raise ValueError(
                    f"provider {p.provider_id} error_code_mapping must not be empty"
                )
        return self
```

### 2.4 关键算法伪代码

#### 2.4.1 provider 调用主流程

```
function call(provider_id: str, request: CallRequest) -> CallResponse:

    # 1. 按 HostContract 四要素封装请求
    provider_cfg = find_provider_config(provider_id)
    if provider_cfg is None:
        raise ProviderNotFoundError(provider_id)

    host_contract = HostContract(
        transport=provider_cfg.transport,
        binding=provider_cfg.binding,
        runtime_contract=provider_cfg.runtime_contract,
        event_adapter=provider_cfg.event_adapter,
    )

    # 2. 超时归一化（按 provider 配置）
    timeout = semantic_normalizer.normalize_timeout(provider_id)
    request = request.model_copy(update={"timeout": timeout})

    # 3. 记录到 F021 WAL（PROVIDER_CALL 副作用）
    wal_entry = build_provider_call_wal_entry(provider_id, request)
    await wal_coordinator.append_pending(wal_entry)

    # 4. 调用具体 provider adapter
    start_time = now
    try:
        raw_response = await asyncio.wait_for(
            adapter.call(provider_id, request, host_contract),
            timeout=timeout,
        )
        latency_ms = (now - start_time).total_seconds * 1000

        # 5. 成功 → 确认 WAL + 返回
        await wal_coordinator.confirm(wal_entry.entry_id)

        return CallResponse(
            response_id=uuid_v7,
            provider_id=provider_id,
            status="success",
            data=raw_response,
            latency_ms=int(latency_ms),
        )

    except Exception as e:
        # 6. 失败 → 错误码归一化 + 触发 failover
        latency_ms = (now - start_time).total_seconds * 1000
        unified_error = semantic_normalizer.normalize_error(
            provider_id, {"error": str(e), "code": getattr(e, "code", 500)}
        )

        await wal_coordinator.fail(wal_entry.entry_id, error=str(e))

        # 7. 按 unified_code 决定是否 failover
        if unified_error.unified_code in (RATE_LIMIT, NETWORK_ERROR, SERVER_ERROR):
            # 可 failover 的错误
            failover_chain = find_failover_chain(provider_id)
            new_provider = await failover_executor.failover(
                provider_id, failover_chain
            )

            return CallResponse(
                response_id=uuid_v7,
                provider_id=provider_id,
                status="failover_triggered",
                unified_error=unified_error,
                failover_to=new_provider,
                latency_ms=int(latency_ms),
            )
        else:
            # AUTH_ERROR 不可 failover，直接返回错误
            return CallResponse(
                response_id=uuid_v7,
                provider_id=provider_id,
                status="failed",
                unified_error=unified_error,
                latency_ms=int(latency_ms),
            )
```

#### 2.4.2 错误码归一化算法

```
function normalize_error(provider_id: str, error: dict) -> UnifiedError:

    provider_cfg = find_provider_config(provider_id)
    if provider_cfg is None:
        raise ProviderNotFoundError(provider_id)

    provider_code = error.get("code", 500)
    provider_message = error.get("error", "unknown")

    # 1. 从配置加载的映射表查找
    unified_code_str = provider_cfg.error_code_mapping.get(
        str(provider_code),
        "server_error"  # 默认归为 server_error
    )
    unified_code = UnifiedErrorCode(unified_code_str)

    # 2. 按 unified_code 决定 retryable
    retryable = unified_code in (UnifiedErrorCode.RATE_LIMIT, UnifiedErrorCode.NETWORK_ERROR)

    return UnifiedError(
        unified_code=unified_code,
        provider_code=provider_code,
        provider_message=provider_message,
        retryable=retryable,
    )
```

#### 2.4.3 超时归一化算法

```
function normalize_timeout(provider_id: str) -> int:

    provider_cfg = find_provider_config(provider_id)
    if provider_cfg is None:
        raise ProviderNotFoundError(provider_id)

    # 从 provider 配置加载（禁止硬编码统一超时）
    return provider_cfg.timeout_seconds
```

#### 2.4.4 failover 边界切换算法

```
function failover(
    from_provider: str, failover_chain: list[str]
) -> str:

    # 1. 标记 from_provider 不健康
    supervisor = await host_repository.get_supervisor(from_provider)
    if supervisor is not None:
        new_supervisor = supervisor.model_copy(update={
            "health_state": "zombie",
            "last_failover_at": now,
        })
        await host_repository.upsert_supervisor(new_supervisor)

    # 2. 按链顺序尝试备用 provider
    for candidate in failover_chain:
        if candidate == from_provider:
            continue  # 跳过已失败的

        candidate_supervisor = await host_repository.get_supervisor(candidate)
        if candidate_supervisor and candidate_supervisor.health_state == "alive":
            # 3. 接手 Forgekin 不重新初始化
            # - 上下文（context）从 F008 durable_record 恢复
            # - 副作用状态从 F021 WAL 恢复
            # - liveness 从 F023 canonical_read 恢复
            await restore_context_from_durable_record(candidate)
            await restore_side_effects_from_wal(candidate)
            await restore_liveness_from_canonical(candidate)

            # 4. 记录 failover 历史
            await host_repository.insert_failover_record({
                "from_provider": from_provider,
                "to_provider": candidate,
                "failover_at": now,
                "reason": "provider_unhealthy",
            })

            # 5. 派发事件
            await event_bus.publish(
                topic="provider.failover.completed",
                payload={
                    "from": from_provider,
                    "to": candidate,
                },
            )

            return candidate

    # 全部失败
    raise AllProvidersUnavailableError(failover_chain)
```

#### 2.4.5 sidecar 监管算法

```
function monitor(provider_id: str) -> None:

    # sidecar 独立进程，主循环
    while True:
        # 1. 周期性探活（health_check_interval=10s）
        await asyncio.sleep(config.health_check_interval_seconds)

        # 2. 复用 F023 LivenessProbe 探测 provider liveness
        try:
            liveness = await liveness_probe.probe(provider_id)
        except Exception as e:
            logger.warning(f"sidecar probe {provider_id} failed: {e}")
            continue

        # 3. 更新 supervisor 状态
        supervisor = await host_repository.get_supervisor(provider_id)
        if supervisor is None:
            continue

        new_supervisor = supervisor.model_copy(update={
            "health_state": liveness.state.value,
            "last_heartbeat_at": now,
        })
        await host_repository.upsert_supervisor(new_supervisor)

        # 4. 派发 liveness 事件到 F023
        await event_bus.publish(
            topic="provider.liveness.changed",
            payload={
                "provider_id": provider_id,
                "state": liveness.state.value,
            },
        )

        # 5. liveness zombie → 触发 failover
        if liveness.state == LivenessState.ZOMBIE:
            await self.trigger_failover(provider_id, reason="zombie_detected")
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/core/reliability/host/abstraction.py
from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from .models import (
    UnifiedErrorCode, ChannelProtocol, HostContract,
    ProviderSemantic, UnifiedError, SidecarSupervisor,
    CallRequest, CallResponse,
)
from .interfaces import (
    HostAbstraction, SemanticNormalizer,
    SidecarSupervisorEngine, FailoverExecutor, HostRepository,
)
from .config import HostConfig, ProviderConfig
from ...core.events.event_bus import EventBus
from ...core.reliability.wal.interfaces import WalCoordinator
from ...core.reliability.wal.models import (
    WalEntry, WalStatus, SideEffectType, Reversibility,
)

logger = logging.getLogger(__name__)


# 不可控 vs 可控边界显式声明（架构要求）
# UNCONTROLLABLE: provider 上游稳定性 / 网络质量 / provider 自身超时策略
# CONTROLLABLE: liveness 判断 / 状态持久化 / 副作用追踪 / 恢复策略 / 协作协议
UNCONTROLLABLE_DIMENSIONS = {
    "provider_upstream_stability",
    "network_quality",
    "provider_timeout_strategy",
}
CONTROLLABLE_DIMENSIONS = {
    "liveness_judgment",
    "state_persistence",
    "side_effect_tracking",
    "recovery_strategy",
    "collaboration_protocol",
}


class ProviderNotFoundError(Exception):
    """provider 未找到"""
    pass


class AllProvidersUnavailableError(Exception):
    """所有 provider 不可用"""
    pass


class DefaultSemanticNormalizer(SemanticNormalizer):
    """语义归一化器默认实现"""

    def __init__(self, config: HostConfig):
        self._cfg = config
        self._provider_map = {p.provider_id: p for p in config.providers}

    def normalize_error(
        self, provider_id: str, error: dict
    ) -> UnifiedError:
        provider_cfg = self._provider_map.get(provider_id)
        if provider_cfg is None:
            raise ProviderNotFoundError(provider_id)

        provider_code = error.get("code", 500)
        provider_message = error.get("error", "unknown")

        # 从配置加载的映射表查找（硬约束：禁止原始错误码穿透）
        unified_code_str = provider_cfg.error_code_mapping.get(
            str(provider_code),
            "server_error",
        )
        unified_code = UnifiedErrorCode(unified_code_str)

        # retryable 决策
        retryable = unified_code in (
            UnifiedErrorCode.RATE_LIMIT,
            UnifiedErrorCode.NETWORK_ERROR,
        )

        return UnifiedError(
            unified_code=unified_code,
            provider_code=provider_code,
            provider_message=provider_message,
            retryable=retryable,
        )

    def normalize_timeout(self, provider_id: str) -> int:
        # 硬约束：禁止硬编码统一超时，必须从 provider 配置加载
        provider_cfg = self._provider_map.get(provider_id)
        if provider_cfg is None:
            raise ProviderNotFoundError(provider_id)
        return provider_cfg.timeout_seconds


class DefaultFailoverExecutor(FailoverExecutor):
    """failover 执行器默认实现"""

    def __init__(
        self,
        repository: HostRepository,
        event_bus: EventBus,
        config: HostConfig,
    ):
        self._repo = repository
        self._bus = event_bus
        self._cfg = config

    async def failover(
        self, from_provider: str, failover_chain: list[str]
    ) -> str:
        # 1. 标记 from_provider 不健康
        supervisor = await self._repo.get_supervisor(from_provider)
        if supervisor is not None:
            new_supervisor = supervisor.model_copy(update={
                "health_state": "zombie",
                "last_failover_at": datetime.now(timezone.utc),
            })
            await self._repo.upsert_supervisor(new_supervisor)

        # 2. 按链顺序尝试备用 provider
        for candidate in failover_chain:
            if candidate == from_provider:
                continue

            candidate_supervisor = await self._repo.get_supervisor(candidate)
            if candidate_supervisor and candidate_supervisor.health_state == "alive":
                # 3. 接手 Forgekin 不重新初始化
                # 上下文从 F008 durable_record 恢复（由 F008 处理）
                # 副作用状态从 F021 WAL 恢复（由 F021 处理）
                # liveness 从 F023 canonical_read 恢复（由 F023 处理）
                # 这里只负责边界切换，恢复由各模块自行处理
                await self._repo.insert_failover_record({
                    "from_provider": from_provider,
                    "to_provider": candidate,
                    "failover_at": datetime.now(timezone.utc).isoformat,
                    "reason": "provider_unhealthy",
                })
                await self._bus.publish(
                    topic="provider.failover.completed",
                    payload={
                        "from": from_provider,
                        "to": candidate,
                    },
                )
                logger.info(
                    f"failover {from_provider} -> {candidate}"
                )
                return candidate

        raise AllProvidersUnavailableError(
            f"all providers in chain {failover_chain} unavailable"
        )


class DefaultHostAbstraction(HostAbstraction):
    """统一宿主抽象层默认实现"""

    def __init__(
        self,
        normalizer: SemanticNormalizer,
        failover_executor: FailoverExecutor,
        wal_coordinator: WalCoordinator,
        repository: HostRepository,
        event_bus: EventBus,
        config: HostConfig,
        adapters: dict[str, "ProviderAdapter"],
    ):
        self._normalizer = normalizer
        self._failover = failover_executor
        self._wal = wal_coordinator
        self._repo = repository
        self._bus = event_bus
        self._cfg = config
        self._adapters = adapters
        self._provider_map = {p.provider_id: p for p in config.providers}
        self._failover_chains = {
            c.primary_provider: c.chain for c in config.failover_chains
        }

    async def call(
        self, provider_id: str, request: CallRequest
    ) -> CallResponse:
        # 1. 校验 provider 存在
        provider_cfg = self._provider_map.get(provider_id)
        if provider_cfg is None:
            raise ProviderNotFoundError(provider_id)

        # 2. HostContract 四要素封装
        host_contract = HostContract(
            transport=provider_cfg.transport,
            binding=provider_cfg.binding,
            runtime_contract=provider_cfg.runtime_contract,
            event_adapter=provider_cfg.event_adapter,
        )

        # 3. 超时归一化
        timeout = self._normalizer.normalize_timeout(provider_id)
        request = request.model_copy(update={"timeout": timeout})

        # 4. 记录到 F021 WAL
        wal_entry = self._build_wal_entry(provider_id, request)
        try:
            await self._wal.append_pending(wal_entry)
        except Exception as e:
            logger.error(f"wal append failed: {e}")
            raise

        # 5. 调用 provider adapter
        adapter = self._adapters.get(provider_id)
        if adapter is None:
            raise ProviderNotFoundError(
                f"adapter for {provider_id} not found"
            )

        start_time = datetime.now(timezone.utc)
        try:
            raw_response = await asyncio.wait_for(
                adapter.call(provider_id, request, host_contract),
                timeout=timeout,
            )
            latency_ms = int(
                (datetime.now(timezone.utc) - start_time).total_seconds * 1000
            )

            # 6. 成功 → 确认 WAL
            await self._wal.confirm(wal_entry.entry_id)

            return CallResponse(
                response_id=str(uuid.uuid1),
                provider_id=provider_id,
                status="success",
                data=raw_response,
                latency_ms=latency_ms,
            )

        except asyncio.TimeoutError:
            latency_ms = int(
                (datetime.now(timezone.utc) - start_time).total_seconds * 1000
            )
            await self._wal.fail(wal_entry.entry_id, error="timeout")

            # 超时归一化为 NETWORK_ERROR
            unified_error = UnifiedError(
                unified_code=UnifiedErrorCode.NETWORK_ERROR,
                provider_code=408,
                provider_message="timeout",
                retryable=True,
            )
            return await self._handle_failover(
                provider_id, request, unified_error, latency_ms
            )

        except Exception as e:
            latency_ms = int(
                (datetime.now(timezone.utc) - start_time).total_seconds * 1000
            )
            await self._wal.fail(wal_entry.entry_id, error=str(e))

            unified_error = self._normalizer.normalize_error(
                provider_id,
                {"error": str(e), "code": getattr(e, "code", 500)},
            )
            return await self._handle_failover(
                provider_id, request, unified_error, latency_ms
            )

    async def failover(
        self, from_provider: str, to_provider: str
    ) -> None:
        # 同一边界切换
        chain = self._failover_chains.get(from_provider, [to_provider])
        new_provider = await self._failover.failover(from_provider, chain)
        if new_provider != to_provider:
            logger.warning(
                f"failover expected {to_provider}, got {new_provider}"
            )

    async def _handle_failover(
        self,
        provider_id: str,
        request: CallRequest,
        unified_error: UnifiedError,
        latency_ms: int,
    ) -> CallResponse:
        # 按 unified_code 决定是否 failover
        if unified_error.unified_code in (
            UnifiedErrorCode.RATE_LIMIT,
            UnifiedErrorCode.NETWORK_ERROR,
            UnifiedErrorCode.SERVER_ERROR,
        ):
            # 可 failover
            chain = self._failover_chains.get(provider_id, [])
            if not chain:
                return CallResponse(
                    response_id=str(uuid.uuid1),
                    provider_id=provider_id,
                    status="failed",
                    unified_error=unified_error,
                    latency_ms=latency_ms,
                )

            try:
                new_provider = await self._failover.failover(provider_id, chain)
                return CallResponse(
                    response_id=str(uuid.uuid1),
                    provider_id=provider_id,
                    status="failover_triggered",
                    unified_error=unified_error,
                    failover_to=new_provider,
                    latency_ms=latency_ms,
                )
            except AllProvidersUnavailableError:
                return CallResponse(
                    response_id=str(uuid.uuid1),
                    provider_id=provider_id,
                    status="failed",
                    unified_error=unified_error,
                    latency_ms=latency_ms,
                )
        else:
            # AUTH_ERROR 不可 failover
            return CallResponse(
                response_id=str(uuid.uuid1),
                provider_id=provider_id,
                status="failed",
                unified_error=unified_error,
                latency_ms=latency_ms,
            )

    def _build_wal_entry(self, provider_id: str, request: CallRequest) -> WalEntry:
        return WalEntry(
            entry_id=str(uuid.uuid1),
            idempotency_key=request.idempotency_key,
            forgekin_id=request.forgekin_id,
            workflow_id=None,
            effect_type=SideEffectType.PROVIDER_CALL,
            status=WalStatus.PENDING,
            action_payload={
                "provider_id": provider_id,
                "payload": request.payload,
            },
            pre_state=None,
            reversible=Reversibility.IRREVERSIBLE,  # provider 调用不可回滚
            created_at=datetime.now(timezone.utc),
        )


class DefaultSidecarSupervisorEngine(SidecarSupervisorEngine):
    """sidecar 监管者引擎默认实现（独立进程）"""

    def __init__(
        self,
        repository: HostRepository,
        event_bus: EventBus,
        config: HostConfig,
        probe_handler: "ProbeHandler",
    ):
        self._repo = repository
        self._bus = event_bus
        self._cfg = config
        self._handler = probe_handler

    async def monitor(self, provider_id: str) -> None:
        # 独立进程主循环
        provider_cfg = self._find_provider(provider_id)
        if provider_cfg is None:
            raise ProviderNotFoundError(provider_id)

        interval = provider_cfg.health_check_interval_seconds

        while True:
            await asyncio.sleep(interval)

            try:
                is_alive = await asyncio.wait_for(
                    self._handler.ping(provider_id),
                    timeout=5,
                )
                state = "alive" if is_alive else "degraded"
            except asyncio.TimeoutError:
                state = "grace_waiting"
            except Exception as e:
                logger.warning(f"sidecar probe {provider_id} failed: {e}")
                state = "degraded"

            # 更新 supervisor 状态
            supervisor = await self._repo.get_supervisor(provider_id)
            now = datetime.now(timezone.utc)
            if supervisor is None:
                new_supervisor = SidecarSupervisor(
                    supervisor_id=str(uuid.uuid1),
                    provider_id=provider_id,
                    health_state=state,
                    last_heartbeat_at=now,
                )
            else:
                new_supervisor = supervisor.model_copy(update={
                    "health_state": state,
                    "last_heartbeat_at": now,
                })
            await self._repo.upsert_supervisor(new_supervisor)

            # 派发 liveness 事件到 F023
            await self._bus.publish(
                topic="provider.liveness.changed",
                payload={
                    "provider_id": provider_id,
                    "state": state,
                    "timestamp": now.isoformat,
                },
            )

            # zombie → 触发 failover
            if state == "zombie":
                await self.trigger_failover(
                    provider_id, reason="zombie_detected"
                )

    async def trigger_failover(
        self, provider_id: str, reason: str
    ) -> None:
        chain = self._find_failover_chain(provider_id)
        if not chain:
            logger.warning(
                f"no failover chain for {provider_id}, skip failover"
            )
            return
        await self._bus.publish(
            topic="provider.failover.request",
            payload={
                "from_provider": provider_id,
                "reason": reason,
                "chain": chain,
            },
        )

    def _find_provider(self, provider_id: str) -> Optional[ProviderConfig]:
        for p in self._cfg.providers:
            if p.provider_id == provider_id:
                return p
        return None

    def _find_failover_chain(self, provider_id: str) -> list[str]:
        for c in self._cfg.failover_chains:
            if c.primary_provider == provider_id:
                return c.chain
        return []
```

### 3.2 关键流程时序图

```
[provider 调用主流程时序图]

  Forgekin.chat   host_abstraction   normalizer   wal_coord   adapter   failover_exec   EventBus   F040
        │                 │                 │            │           │            │             │          │
        │ call(provider_id, request)        │            │           │            │             │          │
        ├────────────────>│                 │            │           │            │             │          │
        │                 │ normalize_timeout         │            │            │             │          │
        │                 ├────────────────>│           │            │            │             │          │
        │                 │<────────────────┤ timeout=60 │            │            │             │          │
        │                 │ append_pending(wal_entry)                │            │             │          │
        │                 ├────────────────────────────>│            │            │             │          │
        │                 │<────────────────────────────┤ entry_id   │            │             │          │
        │                 │ adapter.call                            │            │             │          │
        │                 ├──────────────────────────────────────────>│            │             │          │
        │                 │                                                │            │             │          │
        │                 │ (success)                                     │            │             │          │
        │                 │<──────────────────────────────────────────┤ response   │             │          │
        │                 │ confirm(wal_entry_id)                                    │             │          │
        │                 ├────────────────────────────>│                            │             │          │
        │                 │<────────────────────────────┤ OK                         │             │          │
        │                 │ return CallResponse(status=success)                                  │          │
        │<────────────────┤                                                                                  │
        │                                                                                                    │          │
        │ (failed)                                                                                          │          │
        │                 │ normalize_error(error)                                                          │          │
        │                 ├────────────────>│                                                               │          │
        │                 │<────────────────┤ unified_error                                                 │          │
        │                 │ fail(from_provider, chain)                                                     │          │
        │                 ├──────────────────────────────────────────────────────────────>│             │          │
        │                 │                                                                          │ return new_provider │
        │                 │<──────────────────────────────────────────────────────────────┤             │          │
        │                 │ publish("provider.failover.completed")                                                    │          │
        │                 ├─────────────────────────────────────────────────────────────────────────>│          │
        │                 │                                                                                              ├────────>│
        │<────────────────┤ CallResponse(status=failover_triggered)                                                                │          │
```

### 3.3 错误处理

| 异常类型 | 触发场景 | 处理策略 | 重试次数 |
|---------|---------|---------|---------|
| `ProviderNotFoundError` | provider_id 未在配置中 | 拒绝调用，记录错误 | 不重试 |
| `AllProvidersUnavailableError` | failover 链全部不可用 | 返回 failed + 告警 F040 | 不重试 |
| `HostContractViolationError` | HostContract 四要素缺失 | 拒绝注册，启动失败 | 不重试（硬约束违规） |
| `AdapterNotFoundError` | provider adapter 未注册 | 拒绝调用，记录错误 | 不重试 |
| `TimeoutError` | provider 调用超时 | 归一化为 NETWORK_ERROR + failover | 不重试（已 failover） |
| `SidecarProcessError` | sidecar 进程异常 | 重启 sidecar，记录错误 | 3（指数退避） |
| `ErrorCodeMappingError` | 错误码映射缺失 | 默认归为 server_error，记录警告 | 不重试 |
| `FailoverLoopError` | failover 链形成循环 | 拒绝 failover，返回 failed | 不重试 |
| `WalAppendError` | F021 WAL append 失败 | 阻塞 call，记录错误 | 3（指数退避） |

### 3.4 性能优化

| 性能指标 | 目标值 | 优化手段 |
|---------|--------|---------|
| provider 调用延迟（成功） | < provider 自身超时 | 直接调用，无中间层 |
| 错误码归一化延迟 | < 1ms | 配置映射表内存缓存 |
| 超时归一化延迟 | < 1ms | 配置查找 |
| failover 切换延迟 | < 100ms | 状态持久化预加载 |
| sidecar 监控周期 | 10s（默认） | health_check_interval 可配 |
| Repository 查询延迟 | < 10ms | provider_id 唯一索引 |
| HostContract 校验延迟 | < 1ms | Pydantic frozen 模型 |
| WAL append 延迟 | < 10ms | 复用 F021 |

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

- **Forgekin.chat**：Forgekin 调用 LLM 时通过 `HostAbstraction.call(provider_id, request)` 而非直接 SDK。
- **F034 三方 Agent 失败回退**：F034 调用 `HostAbstraction.failover` 复用宿主抽象的 failover 边界。
- **F022 Tier 1-4 恢复**：F022 Tier 4 调用 `HostAbstraction.failover` 触发 provider failover。
- **DI 容器**：`host_abstraction` 通过 `inject("host_abstraction")` 获取。

### 4.2 下游影响如何被调用

- **F023 liveness 规范读**：provider liveness 通过 `provider.liveness.changed` 事件派发到 F023。F023 订阅该事件更新 Forgekin liveness。
- **F021 副作用 WAL**：provider 调用作为 PROVIDER_CALL 副作用记录到 WAL，failover 时不丢失。本设计调用 F021 接口。
- **F022 Tier 1-4 恢复**：provider 故障通过 `recovery.request` 事件派发到 F022。
- **F040 控制面**：provider 健康状态与 failover 事件写入 F040 Eval Hub。F040 订阅 `provider.*` 主题。
- **OpenRoute（多模型 API 网关）**：宿主抽象与 OpenRoute 协同。OpenRoute 提供路由，宿主抽象提供运维语义归一化。
- **§3.7 伙伴系统数学**：波动吸收的 provider 切换支撑。本设计暴露 `failover` 能力供 §3.7 使用。

### 4.3 集成测试点

| 测试点 ID | 测试场景 | 验证点 | 责任方 |
|----------|---------|--------|--------|
| IT-D025-001 | provider 调用成功 | status=success，data 非空 | 测试员Forgekin（蜜獾·平头哥） |
| IT-D025-002 | provider 调用失败 + 错误码归一化 | unified_code 映射正确 | 测试员Forgekin |
| IT-D025-003 | provider 超时触发 failover | status=failover_triggered | 测试员Forgekin |
| IT-D025-004 | RATE_LIMIT 触发 failover | failover_to 为链中下一个 | 测试员Forgekin |
| IT-D025-005 | NETWORK_ERROR 触发 failover | failover_to 为链中下一个 | 测试员Forgekin |
| IT-D025-006 | AUTH_ERROR 不触发 failover | status=failed，无 failover | 测试员Forgekin |
| IT-D025-007 | HostContract 四要素硬约束 | 缺一即拒绝注册 | 测试员Forgekin |
| IT-D025-008 | 超时归一化按 provider | anthropic=60s, openai=90s 差异化 | 测试员Forgekin |
| IT-D025-009 | failover 链有序遍历 | 按链顺序尝试备用 | 测试员Forgekin |
| IT-D025-010 | failover 同边界切换 | 接手 Forgekin 不重新初始化 | 测试员Forgekin |
| IT-D025-011 | failover 全部不可用 | AllProvidersUnavailableError | 测试员Forgekin |
| IT-D025-012 | sidecar 独立进程监控 | 独立进程 + 周期性探活 | 测试员Forgekin |
| IT-D025-013 | sidecar 检测 zombie 触发 failover | zombie → trigger_failover | 测试员Forgekin |
| IT-D025-014 | provider liveness 派发 F023 | provider.liveness.changed 事件 | 测试员Forgekin |
| IT-D025-015 | 不可控 vs 可控边界显式声明 | 代码中显式注释 | 测试员Forgekin |

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] **AC-D025-001**: provider 调用成功通过（IT-D025-001）
- [ ] **AC-D025-002**: 错误码归一化通过（IT-D025-002）
- [ ] **AC-D025-003**: provider 超时触发 failover 通过（IT-D025-003）
- [ ] **AC-D025-004**: RATE_LIMIT 触发 failover 通过（IT-D025-004）
- [ ] **AC-D025-005**: NETWORK_ERROR 触发 failover 通过（IT-D025-005）
- [ ] **AC-D025-006**: AUTH_ERROR 不触发 failover 通过（IT-D025-006）
- [ ] **AC-D025-007**: HostContract 四要素硬约束生效（IT-D025-007）
- [ ] **AC-D025-008**: 超时归一化按 provider 通过（IT-D025-008）
- [ ] **AC-D025-009**: failover 链有序遍历通过（IT-D025-009）
- [ ] **AC-D025-010**: failover 同边界切换通过（IT-D025-010）

### 5.2 性能验收 AC

- [ ] **AC-D025-011**: provider 调用延迟（成功）< provider 自身超时
- [ ] **AC-D025-012**: 错误码归一化延迟 < 1ms
- [ ] **AC-D025-013**: 超时归一化延迟 < 1ms
- [ ] **AC-D025-014**: failover 切换延迟 < 100ms
- [ ] **AC-D025-015**: sidecar 监控周期 10s（默认）
- [ ] **AC-D025-016**: Repository 查询延迟 < 10ms
- [ ] **AC-D025-017**: HostContract 校验延迟 < 1ms

### 5.3 安全验收 AC

- [ ] **AC-D025-018**: HostContract 四要素硬约束强制（不可绕过）
- [ ] **AC-D025-019**: 错误码归一化硬约束（原始错误码不穿透）
- [ ] **AC-D025-020**: 超时归一化硬约束（禁止硬编码统一超时）
- [ ] **AC-D025-021**: sidecar 独立进程硬约束（不与主进程耦合）
- [ ] **AC-D025-022**: failover 同边界硬约束（接手 Forgekin 不重新初始化）
- [ ] **AC-D025-023**: failover 链有序硬约束（按顺序尝试）
- [ ] **AC-D025-024**: 不可控 vs 可控边界显式声明（代码注释）

### 5.4 Eval 验收 AC

- [ ] **AC-D025-025**: provider 调用成功率 >= 99.9%（含 failover）
- [ ] **AC-D025-026**: 错误码归一化覆盖率 100%（所有 provider 错误码均映射）
- [ ] **AC-D025-027**: failover 成功率 >= 95%（同边界切换成功）
- [ ] **AC-D025-028**: sidecar 监控可用性 >= 99.9%
- [ ] **AC-D025-029**: provider liveness 派发到 F023 完整率 100%

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../architecture/A025-provider-host-abstraction.md]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F025-provider-host-abstraction.md]
- [doc:../features/F034-external-agent-fallback.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../CONTRIBUTING.md]
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（HostContract 四要素 + 错误码归一化 + 超时归一化 + sidecar 独立进程 + failover 同边界切换 + failover 链有序 + 不可控 vs 可控边界显式声明 + 15 集成测试点 + 4 类 AC） | 开发者 Forgekin（猎犬·夏洛克） |

# A025: 跨 provider 宿主抽象架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **对应 Feature**: [doc:../features/F025-provider-host-abstraction.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D025-provider-host-abstraction.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 架构上下文

### 1.1 架构问题

跨 provider 集成的架构问题是"运维语义不归一"。v7.0 LLMClient 仅做模型路由，未抽象 provider 运维语义，导致三类架构故障：

1. **错误码语义混乱**：anthropic 429 与 openai 429 在 v7.0 被同样处理为"重试"，但 anthropic 429 可能是 token 限流、openai 429 可能是 RPM 限流，重试策略不同。
2. **超时策略不一致**：anthropic 默认 60s 超时，openai 默认 90s 超时，v7.0 用统一超时导致某些 provider 误判超时。
3. **provider 故障无 failover**：一家 provider 崩了，接手的Forgekin无法从同一边界恢复，需重新初始化。

roleagent.md 第 6 章要求**统一宿主抽象：传输 × 绑定 × 运行时契约 × 事件适配器，监管者作为独立伴生进程（sidecar）**。本架构解决的核心问题：**如何实现统一宿主抽象层、provider 运维语义归一化、sidecar 监管者、failover 边界，让一家 provider 崩了接手的Forgekin可从同一边界恢复**。

### 1.2 架构约束

- **单向依赖约束**：宿主抽象层依赖 F023 liveness，禁止被 F023 反向依赖。
- **不可控 vs 可控边界约束**：不可控的是 provider 上游稳定性/网络质量/超时策略；可控的是 liveness 判断/状态持久化/副作用追踪/恢复策略/协作协议。
- **错误码归一化约束**：各 provider 错误码必须映射到统一错误码（rate_limit/network_error/auth_error/server_error）。
- **超时归一化约束**：各 provider 超时策略必须归一化为统一超时（按 provider 配置）。
- **sidecar 独立约束**：sidecar 监管者必须独立进程，不与主进程耦合。
- **配置驱动约束**：provider 列表、错误码映射、超时配置、failover 链外置 YAML。

### 1.3 架构影响

- **对 F023 liveness 规范读模型**：provider liveness 是Forgekin liveness 的输入维度之一。
- **对 F034 三方 Agent 失败回退**：三方 Agent 失败回退复用宿主抽象的 failover 边界。
- **对 F021 副作用 WAL**：provider 调用作为副作用记录到 WAL，failover 时不丢失。
- **对 F022 Tier 1-4 恢复分级**：provider 故障触发 F022 分级恢复，Tier 4 provider failover。
- **对伙伴系统数学（§3.7）**：波动吸收的 provider 切换支撑。
- **对 F040 控制面**：provider 健康状态与 failover 事件写入 F040 Eval Hub。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  Forgekin.chat  F034 ExternalAgentFallback  F022 RecoveryExec    │
└──────────┬──────────────────────────────────────────────────────────┘
           │ HostAbstraction.call(provider_id, request)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L4: HostAbstraction（统一宿主抽象层）                                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ HostContract 四要素：                                        │  │
│  │   1. transport（传输层：stdio/sse/websocket/http）           │  │
│  │   2. binding（绑定：token 注入方式）                         │  │
│  │   3. runtime_contract（运行时契约：超时/重试/错误码）        │  │
│  │   4. event_adapter（事件适配器：流式/批量/单次）             │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬──────────────────┬──────────────────┬──────────────────────────┘
    │ call              │ failover         │ monitor
    ▼                  ▼                  ▼
┌────────────┐  ┌────────────┐    ┌──────────────────┐
│Semantic    │  │Failover    │    │ SidecarSupervisor│
│Normalizer  │  │Executor    │    │ Engine           │
│（错误码 +  │  │（边界切换）│    │（独立进程监管）  │
│ 超时归一化）│  └─────┬──────┘    └────────┬─────────┘
└─────┬──────┘        │                    │
      │               │                    │
      ▼               ▼                    ▼
┌─────────────────────────────────────────────────────┐
│ 具体 Provider 适配器                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐│
│  │anthropic │ │ openai   │ │ google   │ │ others  ││
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘│
└─────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌──────────────────────────┐
              │ F023 LivenessProbe       │
              │  provider liveness 维度  │
              └──────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：HostContract 四要素而非单一抽象**。传输 + 绑定 + 运行时契约 + 事件适配器四要素分离，每个 provider 在四要素上有独立配置。理由：单一抽象会丢失 provider 差异（如 anthropic 用 stdio 通道、openai 用 http 通道），四要素分离让差异显式可配。
- **决策 2：错误码归一化映射表**。各 provider 错误码映射到统一错误码（rate_limit/network_error/auth_error/server_error），映射表从配置加载。理由：上层调用方不需要关心 provider 具体错误码，统一错误码让 F022 分级恢复与 F034 回退可决策。
- **决策 3：超时归一化按 provider 配置**。各 provider 超时策略归一化为统一超时（anthropic 60s / openai 90s / google 60s），从配置加载。理由：v7.0 统一超时导致某些 provider 误判超时，按 provider 配置是合理差异化。
- **决策 4：sidecar 独立进程**。sidecar 监管者独立进程运行，不与主进程耦合，监控 provider liveness 并触发 failover。理由：主进程崩溃时 sidecar 仍可监控并触发 failover，是分布式可靠性的关键。
- **决策 5：failover 从同一边界切换**。provider 崩了从同一边界切换到备用 provider，接手 Forgekin 不需重新初始化。理由：重新初始化会丢失上下文与状态，从同一边界切换保证业务连续性。
- **决策 6：failover 链有序**。`failover_chain: [anthropic, openai, google]` 有序链，按顺序尝试。理由：无序 failover 可能跳到次优 provider，有序链保证最优 provider 优先。
- **决策 7：不可控 vs 可控边界明确**。不可控（provider 上游稳定性/网络质量/超时策略）与可控（liveness 判断/状态持久化/副作用追踪/恢复策略/协作协议）边界在架构中显式声明。理由：roleagent.md 第 6 章 RA-042 要求边界明确，避免在不可控维度上浪费架构努力。

### 2.3 架构不变量

- 各 provider 错误码必须映射到统一错误码（rate_limit/network_error/auth_error/server_error）之一。
- 各 provider 超时必须从配置加载，必须禁止硬编码统一超时。
- sidecar 监管者必须独立进程，必须不与主进程耦合。
- provider 崩了必须从同一边界 failover，接手 Forgekin 必须不重新初始化。
- failover 链必须有序，必须按顺序尝试。
- provider liveness 必须接入 F023 规范读模型。
- 不可控 vs 可控边界必须在架构中显式声明。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| HostAbstraction | `flowforge/core/reliability/host/abstraction.py` | 统一宿主抽象层 | `call / failover` |
| SemanticNormalizer | `flowforge/core/reliability/host/normalizer.py` | 错误码 + 超时归一化 | `normalize_error / normalize_timeout` |
| SidecarSupervisorEngine | `flowforge/core/reliability/host/sidecar.py` | sidecar 监管者（独立进程） | `monitor / trigger_failover` |
| FailoverExecutor | `flowforge/core/reliability/host/failover.py` | failover 边界切换 | `failover` |
| ProviderAdapters | `flowforge/core/reliability/host/adapters/` | 具体 provider 适配器 | 不对上层暴露 |
| HostConfigLoader | `flowforge/core/reliability/host/config.py` | YAML 配置加载 | `load_host_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel, Field
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


class ProviderSemantic(BaseModel):
    provider_id: str
    timeout_strategy: dict
    error_code_mapping: dict  # provider 错误码 → UnifiedErrorCode
    channel_protocol: ChannelProtocol
    recovery_mechanism: dict


class HostContract(BaseModel):
    transport: str
    binding: str  # token 注入方式
    runtime_contract: str  # 超时/重试/错误码
    event_adapter: str  # 流式/批量/单次


class UnifiedError(BaseModel):
    unified_code: UnifiedErrorCode
    provider_code: int
    provider_message: str
    retryable: bool


class SidecarSupervisor(BaseModel):
    supervisor_id: str
    provider_id: str
    health_state: str  # 复用 F023 LivenessState
    last_failover_at: Optional[datetime] = None


class HostAbstraction(ABC):
    @abstractmethod
    async def call(self, provider_id: str, request: dict) -> dict:
        """
        统一调用入口：
        1. 按 HostContract 四要素封装请求
        2. 调用具体 provider adapter
        3. 错误码归一化
        4. 失败时交 FailoverExecutor
        """

    @abstractmethod
    async def failover(self, from_provider: str, to_provider: str) -> None:
        """从同一边界切换 provider；接手 Forgekin 不重新初始化"""


class SemanticNormalizer(ABC):
    @abstractmethod
    def normalize_error(self, provider_id: str, error: dict) -> UnifiedError:
        """provider 错误码 → 统一错误码；映射表从配置加载"""

    @abstractmethod
    def normalize_timeout(self, provider_id: str) -> int:
        """按 provider 配置返回超时；禁止硬编码统一超时"""


class SidecarSupervisorEngine(ABC):
    @abstractmethod
    async def monitor(self, provider_id: str) -> None:
        """独立进程监控 provider liveness（复用 F023）"""

    @abstractmethod
    async def trigger_failover(self, provider_id: str, reason: str) -> None:
        """触发 failover；按 failover_chain 顺序切换"""


class FailoverExecutor(ABC):
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
```

### 3.3 数据流

```
[provider 调用路径]
  Forgekin.chat / F034 ExternalAgentFallback
        │
        ▼
  HostAbstraction.call(provider_id=anthropic, request={...})
        │
        ├─ 按 HostContract 封装请求（transport/binding/runtime/event）
        │
        ▼
  调用 anthropic provider adapter
        │
        ├─ 成功 → 返回 response
        │
        └─ 失败 → SemanticNormalizer.normalize_error
                  │
                  ├─ unified_code=rate_limit → 触发 failover
                  ├─ unified_code=network_error → 触发 failover
                  ├─ unified_code=auth_error → 拒绝（不 failover）
                  └─ unified_code=server_error → 触发 failover
                  │
                  ▼
        FailoverExecutor.failover(anthropic, [openai, google])
                  │
                  ├─ 标记 anthropic 不健康
                  ├─ 按 failover_chain 顺序尝试 openai
                  │
                  ▼
        从同一边界切换到 openai（接手 Forgekin 不重新初始化）

[sidecar 监管路径]
  SidecarSupervisorEngine 独立进程
        │
        ▼
  monitor(provider_id=anthropic)
        │
        ├─ 周期性探活（health_check_interval=10s）
        ├─ 复用 F023 LivenessProbe 探测 provider liveness
        │
        ├─ liveness=degraded → 告警 F040
        ├─ liveness=zombie → trigger_failover
        │
        ▼
  trigger_failover(provider_id=anthropic, reason="zombie_detected")
        │
        ▼
  FailoverExecutor.failover(anthropic, [openai, google])

[failover 后状态保持路径]
  Failover 完成，切到 openai
        │
        ▼
  接手 Forgekin 不重新初始化
        │
        ├─ 上下文（context）从 F008 durable_record 恢复
        ├─ 副作用状态从 F021 WAL 恢复
        ├─ liveness 从 F023 canonical_read 恢复
        │
        ▼
  Forgekin 继续执行任务（从同一边界恢复）
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F023 liveness 规范读模型**：provider liveness 是Forgekin liveness 的输入维度之一。
- 依赖 **F021 副作用 WAL**：provider 调用作为副作用记录到 WAL，failover 时不丢失。
- 依赖 **F008 Durable State Surfaces**：failover 后上下文从 F008 durable_record 恢复。

### 4.2 下游影响

- 影响 **F022 Tier 1-4 恢复分级**：provider 故障触发 F022 分级恢复，Tier 4 provider failover。
- 影响 **F034 三方 Agent 失败回退**：三方 Agent 失败回退复用宿主抽象的 failover 边界。
- 影响 **伙伴系统数学（§3.7）**：波动吸收的 provider 切换支撑。
- 影响 **F040 控制面**：provider 健康状态与 failover 事件写入 F040 Eval Hub。
- 影响 **OpenRoute（多模型 API 网关）**：宿主抽象与 OpenRoute 协同，OpenRoute 提供路由，宿主抽象提供运维语义归一化。

### 4.3 跨模块不变量

- 各 provider 错误码必须映射到统一错误码之一，必须禁止 provider 原始错误码穿透到上层。
- 各 provider 超时必须从配置加载，必须禁止硬编码统一超时。
- sidecar 监管者必须独立进程，必须不与主进程耦合。
- provider failover 必须从同一边界切换，接手 Forgekin 必须不重新初始化。
- failover 链必须有序，必须按顺序尝试。
- provider liveness 必须接入 F023 规范读模型。
- 不可控 vs 可控边界必须在架构中显式声明。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/reliability/host/` 不 import F023/F021/F022/F034/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`HostAbstraction` 通过 `inject("host_abstraction")` 获取。
- [ ] AC-3: Repository 层通过——sidecar 状态持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——provider 列表 / 错误码映射 / 超时配置 / failover 链从 `config/provider_host.yaml` 加载。
- [ ] AC-5: sidecar 监管者独立进程运行（集成测试覆盖）。

### 5.2 架构不变量验收

- [ ] AC-6: 不同 provider 错误码归一化为统一错误码（单测覆盖 anthropic/openai/google）。
- [ ] AC-7: sidecar 监管者可独立监控 provider liveness（集成测试覆盖）。
- [ ] AC-8: provider 崩了可从同一边界 failover 到备用 provider（集成测试覆盖）。
- [ ] AC-9: failover 后接手 Forgekin 不重新初始化（断言遍历 context/wal/liveness 恢复）。
- [ ] AC-10: liveness 信号接入 F023 规范读模型（集成测试覆盖）。
- [ ] AC-11: 不可控 vs 可控边界在代码中有显式注释声明（静态扫描确认）。

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F025-provider-host-abstraction.md]
- [doc:../features/F034-external-agent-fallback.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + HostContract 四要素 + 错误码归一化 + sidecar 独立进程 + failover 同边界） | 架构师 Forgekin（猫头鹰·鲁班） |

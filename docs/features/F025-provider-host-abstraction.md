# Feature F025: 跨 provider 宿主抽象

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-041] + [doc:roleagent.md#第6章]
> **关联 ADR**: [doc:decisions/010-distributed-reliability.md]
> **类型**: reliability
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.6]（待创建）
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

跨 provider 宿主抽象是 roleagent.md 第 6 章的可靠性边界：不同 provider（Claude/GPT/Gemini/Antigravity）的超时策略、错误码语义、通道协议、恢复机制都不一样。需要统一宿主抽象：传输 × 绑定 × 运行时契约 × 事件适配器，监管者作为独立伴生进程（sidecar）。

本 Feature 实现统一宿主抽象层、provider 运维语义归一化、sidecar 监管者，让一家 provider 崩了接手的灵智体（Forgekin）可从同一边界恢复。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-041]` 指出：roleagent.md 第 6 章——不同 provider 的超时策略、错误码语义、通道协议、恢复机制都不一样。需要统一宿主抽象：传输 × 绑定 × 运行时契约 × 事件适配器，监管者作为独立伴生进程（sidecar）。v7.0 LLMClient 仅做模型路由，未抽象 provider 运维语义，一家 provider 崩了接手的 Forgekin 无法从同一边界恢复。

`[doc:review/review.md#RA-042]` 进一步指出不可控 vs 可控边界未在架构中体现——不可控的是 provider 上游稳定性/网络质量/超时策略；可控的是 liveness 判断/状态持久化/副作用追踪/恢复策略/协作协议。不做这个 Feature，F023 liveness 规范读模型无 provider 维度，F034 三方 Agent 失败回退无统一边界，伙伴系统数学的波动吸收缺 provider 切换支撑。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class ProviderSemantic(BaseModel):
    provider_id: str                      # anthropic/openai/google/...
    timeout_strategy: dict
    error_code_mapping: dict              # provider 错误码 → 统一错误码
    channel_protocol: Literal["stdio", "sse", "websocket", "http"]
    recovery_mechanism: dict

class HostContract(BaseModel):
    transport: str                        # 传输层
    binding: str                          # 绑定（token 注入方式）
    runtime_contract: str                 # 运行时契约
    event_adapter: str                    # 事件适配器

class SidecarSupervisor(BaseModel):
    supervisor_id: str
    provider_id: str
    health_state: LivenessState           # 复用 F023
    last_failover_at: Optional[datetime]
```

### 3.2 核心接口

```python
class HostAbstraction(ABC):
    """统一宿主抽象"""
    @abstractmethod
    async def call(self, provider_id: str, request: dict) -> Response: ...
    @abstractmethod
    async def failover(self, from_provider: str, to_provider: str) -> None: ...

class SidecarSupervisorEngine:
    """sidecar 监管者（独立进程）"""
    async def monitor(self, provider_id: str) -> None: ...
    async def trigger_failover(self, provider_id: str, reason: str) -> None: ...

class SemanticNormalizer:
    """provider 运维语义归一化"""
    def normalize_error(self, provider_id: str, error: dict) -> UnifiedError: ...
    def normalize_timeout(self, provider_id: str) -> int: ...
```

### 3.3 关键算法

- **错误码归一化**：各 provider 错误码映射到统一错误码（如 rate_limit/network_error/auth_error/server_error）。
- **超时归一化**：各 provider 超时策略归一化为统一超时（按 provider 配置）。
- **sidecar 监管**：独立进程监控 provider liveness（复用 F023），崩了触发 failover。
- **failover 边界**：provider 崩了从同一边界切换到备用 provider，接手 Forgekin 不需重新初始化。

### 3.4 配置外置（YAML 示例）

```yaml
provider_host:
  providers:
    anthropic: {timeout: 60, channel: stdio, recovery: retry_3_then_failover}
    openai: {timeout: 90, channel: http, recovery: retry_3_then_failover}
    google: {timeout: 60, channel: http, recovery: retry_3_then_failover}
  error_code_mapping:
    anthropic: {429: rate_limit, 500: server_error}
    openai: {429: rate_limit, 500: server_error}
  sidecar:
    enabled: true
    health_check_interval: 10
    failover_chain: [anthropic, openai, google]
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 不同 provider 错误码归一化为统一错误码
- [ ] AC-2: sidecar 监管者可独立监控 provider liveness
- [ ] AC-3: provider 崩了可从同一边界 failover 到备用 provider
- [ ] AC-4: failover 后接手 Forgekin 不需重新初始化
- [ ] AC-5: liveness 信号接入 F023 规范读模型

## 5. 测试策略

### 5.1 单元测试

- 错误码归一化、超时归一化、sidecar 监管、failover 切换。

### 5.2 集成测试

- 接入 F023 liveness、F034 三方 Agent 失败回退、F040 控制面。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 provider 故障（如限流），验证 sidecar 触发 failover 到备用 provider 并保持边界。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第6章]
- [doc:review/review.md#第八章/RA-041]
- [doc:review/review.md#第八章/RA-042]
- [doc:decisions/010-distributed-reliability.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F023-liveness-canonical-read.md]
- [doc:features/F034-external-agent-fallback.md]
- [doc:features/F040-harness-eval-control-plane.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.6 同号映射 | 文档员灵智体（钢笔·文心） |

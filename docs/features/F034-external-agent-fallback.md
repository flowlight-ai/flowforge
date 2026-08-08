# Feature F034: 三方 Agent 失败回退

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#EX-007] + [doc:roleagent.md#第6章]
> **关联 ADR**: [doc:decisions/006-external-agent-integration.md]
> **类型**: external-agent
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.10]（待创建）
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）

---

## 1. 概述（Overview）

三方 Agent 失败回退（External Agent Fallback）是 forgemind 应用层的可靠性保障：三方 Agent 可能失败（claude code 超时、codex 限流、opencode 服务不可用、trae IDE 崩溃），需设计跨厂商 fallback 链与降级策略。本 Feature 实现失败检测、fallback 链编排、与 F022 Tier 1-4 恢复分级联动、与 F032 能力画像联动，让Forgekin调用三方 Agent 失败后能换厂商或降级到内置 agent。

这是 Build to Persist 基础设施——编码"三方 Agent 失败可回退"的工程规则，对标 roleagent.md 第 6 章分布式可靠性主张。

## 2. 动机（Motivation）

`[doc:review/review.md#EX-007]` 指出：v7.0 无失败回退策略——claude code 失败了是重试还是换 codex？codex 失败了是降级到内置 agent 还是报错？需要设计跨厂商 fallback 链（与 LLMClient 跨厂商 fallback 思路一致）。

不做这个 Feature，F032 能力画像无失败时换厂商路径，F033 共享状态无失败时降级承载，F022 Tier 1-4 恢复分级无三方 Agent 失败分级。这是三方 Agent 集成层的可靠性底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class FallbackTrigger(str, Enum):
    """失败触发原因"""
    TIMEOUT = "timeout"                # 超时
    RATE_LIMIT = "rate_limit"          # 限流
    SERVICE_UNAVAILABLE = "unavailable"  # 服务不可用
    CRASH = "crash"                    # 进程崩溃（如 trae IDE 崩溃）
    QUALITY_BELOW_THRESHOLD = "quality_low"  # 产出质量低于 Eval 阈值

class FallbackAction(str, Enum):
    """回退动作"""
    RETRY_SAME = "retry_same"          # 同厂商重试
    SWITCH_PROVIDER = "switch_provider"  # 换厂商（按 F032 能力匹配）
    DEGRADE_TO_BUILTIN = "degrade_builtin"  # 降级到内置 agent
    ESCALATE_OPERATOR = "escalate"     # 升级给 operator
    FAIL_FAST = "fail_fast"            # 快速失败（不可恢复错误）

class FallbackChainStep(BaseModel):
    """fallback 链一步"""
    step_id: str
    provider: ExternalAgentProvider
    trigger: FallbackTrigger
    action: FallbackAction
    next_step_id: Optional[str]
    tier_classification: int           # 与 F022 Tier 1-4 联动

class FallbackExecutionRecord(BaseModel):
    """fallback 执行记录"""
    chain_id: str
    triggered_at: datetime
    trigger: FallbackTrigger
    from_provider: ExternalAgentProvider
    to_provider: Optional[ExternalAgentProvider]
    action_taken: FallbackAction
    recovery_tier: int                 # F022 Tier 1-4
    succeeded: bool
```

### 3.2 核心接口

```python
class FallbackChainExecutor(ABC):
    """fallback 链执行器"""
    @abstractmethod
    async def execute(self, chain: FallbackChain, initial_call: AgentCall) -> FallbackExecutionRecord: ...

    @abstractmethod
    async def detect_failure(self, call_result: AgentCallResult) -> Optional[FallbackTrigger]: ...

class FallbackChainBuilder(ABC):
    """fallback 链构建器（基于 F032 能力画像）"""
    @abstractmethod
    async def build_for_task(
        self, task_requirements: list[str], forgekin_profile_id: str
    ) -> FallbackChain:
        """基于能力匹配 + 盲点互补构建 fallback 链"""
        ...
```

### 3.3 关键算法

- **失败检测**：超时（>30s）/限流（429）/服务不可用（5xx）/崩溃（进程退出）/质量低（Eval < 0.85）五种触发。
- **fallback 链编排**：基于 F032 能力画像按盲点互补 + 成本排序构建多步 fallback 链。
- **与 F022 Tier 联动**：超时/限流 → Tier 1（自动重试）；服务不可用 → Tier 2（换厂商）；崩溃 → Tier 3（降级到内置 agent）；质量低 → Tier 4（升级 operator）。
- **降级到内置 agent**：当所有三方 Agent 都失败时，降级到 FlowForge 内置 agent（能力可能弱但可用）。

### 3.4 配置外置（YAML 示例）

```yaml
external_agent_fallback:
  failure_detection:
    timeout_threshold_seconds: 30
    rate_limit_status_codes: [429]
    quality_threshold: 0.85           # 与项目规则质量分阈值一致
  fallback_chains:
    code_editing_task:
      steps:
        - provider: claude_code
          on_trigger: timeout
          action: retry_same
          max_retries: 2
          tier: 1
        - provider: claude_code
          on_trigger: rate_limit
          action: switch_provider
          next: codex
          tier: 2
        - provider: codex
          on_trigger: unavailable
          action: degrade_builtin
          tier: 3
        - provider: builtin
          on_trigger: quality_low
          action: escalate
          tier: 4
  chain_builder:
    strategy: blind_spot_complementary
    prefer_low_cost: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 五种失败触发可检测（超时/限流/不可用/崩溃/质量低）
- [ ] AC-2: fallback 链基于 F032 能力画像盲点互补构建
- [ ] AC-3: 与 F022 Tier 1-4 恢复分级联动（每 trigger 对应 Tier）
- [ ] AC-4: 所有三方 Agent 失败时降级到内置 agent
- [ ] AC-5: FallbackExecutionRecord 写入 EchoStore 供 SpiritForge 蒸馏

## 5. 测试策略

### 5.1 单元测试

- 失败检测、fallback 链编排、Tier 联动、降级逻辑。

### 5.2 集成测试

- 接入 F032 能力画像、F022 Tier 1-4 恢复分级、F014 EchoStore集合。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 claude code 被模拟限流（429），Forgekin通过真实 LLM 决策触发 fallback 链换到 codex，验证 fallback 执行记录写入EchoStore、Tier 2 联动正确。再触发 codex 服务不可用，验证降级到内置 agent。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用（含真实三方 Agent，限流场景用真实厂商限流响应）。

## 6. 引用

- [doc:roleagent.md#第6章]
- [doc:review/review.md#第九章/EX-007]
- [doc:decisions/006-external-agent-integration.md]
- [doc:features/F022-tier-1-4-recovery.md]
- [doc:features/F032-external-agent-profile.md]
- [doc:features/F033-external-agent-shared-state.md]
- [doc:features/F014-memory-collection.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|

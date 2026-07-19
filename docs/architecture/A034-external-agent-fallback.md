# A034: 三方 Agent 失败回退架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10]
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）
> **对应 Feature**: [doc:../features/F034-external-agent-fallback.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D034-external-agent-fallback.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

ExternalAgentAdapter 抽象层（A031）需要为三方 Agent 失败提供跨厂商 fallback 链与降级策略，但 v7.0 无失败回退机制——claude code 失败了是重试还是换 codex?codex 失败了是降级到内置 agent 还是报错?本架构在 `core/external_agent/fallback.py` 建立三方 Agent 失败回退层，解决以下架构层问题：

1. **失败检测维度缺失**：超时/限流/服务不可用/崩溃/质量低五种失败触发未统一编码。
2. **fallback 链编排无依据**：fallback 链按固定编号顺序，而非基于 F032 能力画像盲点互补 + 成本排序。
3. **Tier 1-4 恢复分级未联动**：三方 Agent 失败未与 F022 Tier 1-4 恢复分级联动，恢复策略混乱。
4. **降级到内置 agent 缺失**：所有三方 Agent 失败时无降级机制，任务直接失败。
5. **FallbackExecutionRecord 未归档**：fallback 执行记录未写入 F014 灵忆，无法供 F035 灵锻蒸馏。
6. **五种 FallbackAction 未定义**：retry_same/switch_provider/degrade_builtin/escalate/fail_fast 五种动作无统一枚举。

### 1.2 架构约束

- **单向依赖约束**：FallbackChainExecutor 必须单向依赖 F022 Tier 1-4 + F032 能力画像 + F014 灵忆，禁止反向依赖 *Forge。
- **DI 容器约束**：FallbackChainExecutor / FallbackChainBuilder 实例必须通过 DI 容器注入到 ExternalAgentBridge。
- **Repository 层约束**：FallbackExecutionRecord 写入 F014 灵忆必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：failure_detection / fallback_chains / chain_builder 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码厂商偏好。
- **质量阈值约束**：质量检测阈值必须为 0.85（与项目规则质量分阈值一致），禁止灵智体修改。
- **Tier 联动约束**：每种 FallbackTrigger 必须对应一个 F022 Tier（1-4），跨级恢复禁止跳级。

### 1.3 架构影响

- **对 F022 Tier 1-4 恢复分级的影响**：三方 Agent 失败按 Tier 1（自动重试）/Tier 2（换厂商）/Tier 3（降级内置）/Tier 4（升级 operator）分级恢复。
- **对 F032 能力画像的影响**：FallbackChainBuilder 基于 ExternalAgentCapabilityProfile 盲点互补 + 成本排序构建 fallback 链。
- **对 F014 多域记忆的影响**：FallbackExecutionRecord 写入灵忆供 F035 灵锻蒸馏失败经验。
- **对 F018 Eval Contract 的影响**：fallback 执行结果纳入 Eval 信号，影响三方 Agent 可靠性评估。
- **对 A031 ExternalAgentBridge 的影响**：Bridge 在调用失败时调用 FallbackChainExecutor.execute() 执行 fallback 链。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |      core/external_agent/fallback.py            |
                    |                                                 |
                    |  +-------------------+   +-------------------+ |
                    |  | FallbackTrigger   |   | FallbackAction    | |
                    |  | (5 触发原因)      |   | (5 回退动作)      | |
                    |  +---------+---------+   +---------+---------+ |
                    |   TIMEOUT              |  RETRY_SAME           |
                    |   RATE_LIMIT           |  SWITCH_PROVIDER      |
                    |   SERVICE_UNAVAILABLE  |  DEGRADE_TO_BUILTIN   |
                    |   CRASH                |  ESCALATE_OPERATOR    |
                    |   QUALITY_BELOW_THRESH |  FAIL_FAST            |
                    |            |                       |           |
                    |  +---------v---------+   +---------v---------+ |
                    |  | FallbackChainStep |   | FallbackExecution  | |
                    |  | (链一步)           |   | Record (执行记录)  | |
                    |  +---------+---------+   +-------------------+ |
                    |            |                                    |
                    |  +---------v---------+   +-------------------+ |
                    |  | FallbackChain     |<->| FallbackChain     | |
                    |  | (链)              |   | Builder           | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |  +---------v---------+             |           |
                    |  | FallbackChain     |             |           |
                    |  | Executor          |<------------+           |
                    |  | (执行器)          |                         |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+                         |
                    |  | FailureDetector   |  (5 种失败检测)         |
                    |  +-------------------+                         |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  上游依赖（DI 注入）                      |
                    |  F022 Tier 1-4 Recovery (恢复分级)        |
                    |  F032 ExternalAgentProfile (能力画像)     |
                    |  F014 Memory Collection (灵忆归档)        |
                    |  F018 Eval Contract (Eval 信号)          |
                    +-------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  下游消费方                                |
                    |  A031 ExternalAgentBridge (失败时调用)    |
                    |  F035 CapabilityFusion (蒸馏失败经验)     |
                    +-------------------------------------------+
```

### 2.2 关键架构决策

- **决策 1：5 种 FallbackTrigger 统一编码**
  FallbackTrigger 固定为 TIMEOUT（>30s）/RATE_LIMIT（429）/SERVICE_UNAVAILABLE（5xx）/CRASH（进程退出）/QUALITY_BELOW_THRESHOLD（Eval < 0.85）五种。覆盖三方 Agent 全部失败场景。新增触发原因必须经 ADR 决策。

- **决策 2：5 种 FallbackAction 覆盖全部恢复路径**
  FallbackAction 固定为 RETRY_SAME（同厂商重试）/SWITCH_PROVIDER（换厂商）/DEGRADE_TO_BUILTIN（降级内置 agent）/ESCALATE_OPERATOR（升级 operator）/FAIL_FAST（快速失败）五种。前四种为可恢复动作，最后一种为不可恢复错误。

- **决策 3：fallback 链基于 F032 能力画像盲点互补 + 成本排序构建**
  FallbackChainBuilder.build_for_task() 调用 F032 CapabilityMatcher.match_for_task() 获取候选厂商，再按 cost_per_1k_tokens + avg_latency_ms 升序排序构建多步 fallback 链。这避免按固定编号顺序（如 Claude=1/Codex=2/OpenCode=3/Trae=4），保证 fallback 选择最优厂商。

- **决策 4：与 F022 Tier 1-4 恢复分级严格联动**
  每种 FallbackTrigger 对应一个 Tier：TIMEOUT/RATE_LIMIT -> Tier 1（自动重试）；SERVICE_UNAVAILABLE -> Tier 2（换厂商）；CRASH -> Tier 3（降级内置）；QUALITY_BELOW_THRESHOLD -> Tier 4（升级 operator）。跨级恢复禁止跳级（如 Tier 1 失败必须先尝试 Tier 2 而非直接 Tier 4）。

- **决策 5：全部失败降级到 FlowForge 内置 agent**
  当 fallback 链全部失败时，降级到 FlowForge 内置 agent（能力可能弱但可用）。这保证任务不会因三方 Agent 全部不可用而完全失败。

- **决策 6：FallbackExecutionRecord 写入 F014 灵忆供灵锻蒸馏**
  每次 fallback 执行记录（含 trigger / from_provider / to_provider / action_taken / recovery_tier / succeeded）写入 F014 灵忆集合，作为灵智体失败经验记忆。F035 能力融合可蒸馏这些失败经验，提升灵智体未来调用决策能力。

- **决策 7：质量阈值 0.85 与项目规则一致**
  QUALITY_BELOW_THRESHOLD 触发阈值为 0.85，与项目规则质量分阈值（v4.0 调整后默认值）一致。这保证三方 Agent 产出质量与灵智体自身产出质量标准统一。

### 2.3 架构不变量

- FallbackTrigger 枚举必须固定 5 种，禁止运行时新增触发原因。
- FallbackAction 枚举必须固定 5 种，禁止运行时新增动作。
- fallback 链必须基于 F032 能力画像盲点互补 + 成本排序构建，禁止按厂商编号顺序。
- 每种 FallbackTrigger 必须对应一个 F022 Tier，跨级恢复禁止跳级。
- 全部三方 Agent 失败必须降级到 FlowForge 内置 agent，禁止任务完全失败。
- FallbackExecutionRecord 必须写入 F014 灵忆集合，供 F035 灵锻蒸馏。
- 质量阈值必须为 0.85，禁止灵智体修改。
- failure_detection / fallback_chains / chain_builder 配置必须 YAML 外置到 `config/external_agent.yaml`。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| FallbackTrigger | `core/external_agent/fallback.py` | 5 种失败触发原因枚举 |
| FallbackAction | `core/external_agent/fallback.py` | 5 种回退动作枚举 |
| FallbackChainStep | `core/external_agent/fallback.py` | fallback 链一步数据模型 |
| FallbackChain | `core/external_agent/fallback.py` | fallback 链数据模型 |
| FallbackExecutionRecord | `core/external_agent/fallback.py` | fallback 执行记录数据模型 |
| FailureDetector | `core/external_agent/fallback.py` | 5 种失败检测器 |
| FallbackChainBuilder | `core/external_agent/fallback.py` | fallback 链构建器（基于 F032） |
| FallbackChainExecutor | `core/external_agent/fallback.py` | fallback 链执行器 |
| ExternalAgentConfig | `config/external_agent.yaml` | failure_detection / fallback_chains / chain_builder YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class FallbackTrigger(str, Enum):
    """失败触发原因（5 种）"""
    TIMEOUT = "timeout"                       # 超时（>30s）
    RATE_LIMIT = "rate_limit"                 # 限流（429）
    SERVICE_UNAVAILABLE = "unavailable"       # 服务不可用（5xx）
    CRASH = "crash"                           # 进程崩溃（如 trae IDE 崩溃）
    QUALITY_BELOW_THRESHOLD = "quality_low"   # 产出质量低于 Eval 阈值 0.85


class FallbackAction(str, Enum):
    """回退动作（5 种）"""
    RETRY_SAME = "retry_same"                 # 同厂商重试
    SWITCH_PROVIDER = "switch_provider"       # 换厂商（按 F032 能力匹配）
    DEGRADE_TO_BUILTIN = "degrade_builtin"    # 降级到内置 agent
    ESCALATE_OPERATOR = "escalate"            # 升级给 operator
    FAIL_FAST = "fail_fast"                   # 快速失败（不可恢复错误）


class FallbackChainStep(BaseModel):
    """fallback 链一步"""
    step_id: str
    provider: str                             # ExternalAgentProvider
    trigger: FallbackTrigger
    action: FallbackAction
    next_step_id: Optional[str]
    tier_classification: int                  # 与 F022 Tier 1-4 联动
    max_retries: int = 2


class FallbackChain(BaseModel):
    """fallback 链"""
    chain_id: str
    task_signature: str                       # 任务能力需求签名
    steps: list[FallbackChainStep]
    built_from_profile: bool                  # 是否基于 F032 能力画像构建


class FallbackExecutionRecord(BaseModel):
    """fallback 执行记录（写入 F014 灵忆）"""
    record_id: str
    chain_id: str
    triggered_at: datetime
    trigger: FallbackTrigger
    from_provider: str                        # ExternalAgentProvider
    to_provider: Optional[str]                # 切换到的厂商
    action_taken: FallbackAction
    recovery_tier: int                        # F022 Tier 1-4
    succeeded: bool
    duration_ms: int = 0
    echo_store_ref: str                       # 写入 F014 灵忆集合 ID


class FailureDetector(ABC):
    """失败检测器（5 种触发）"""

    @abstractmethod
    async def detect_failure(
        self, call_result: dict
    ) -> Optional[FallbackTrigger]:
        """
        检测失败原因：
        - 超时（>30s）-> TIMEOUT
        - 限流（429）-> RATE_LIMIT
        - 服务不可用（5xx）-> SERVICE_UNAVAILABLE
        - 进程崩溃（退出码非 0）-> CRASH
        - 产出质量 < 0.85 -> QUALITY_BELOW_THRESHOLD
        """
        ...


class FallbackChainBuilder(ABC):
    """fallback 链构建器（基于 F032 能力画像）"""

    @abstractmethod
    async def build_for_task(
        self,
        task_requirements: list[str],
        forgekin_profile_id: str,
    ) -> FallbackChain:
        """
        基于能力匹配 + 盲点互补 + 成本排序构建 fallback 链：
        1. 调用 F032 CapabilityMatcher.match_for_task() 获取候选厂商
        2. 调用 F032 CapabilityMatcher.rank_by_cost_latency() 按成本排序
        3. 为每个厂商配置 5 种 FallbackTrigger -> FallbackAction 映射
        4. 每步关联 F022 Tier 1-4
        """
        ...


class FallbackChainExecutor(ABC):
    """fallback 链执行器"""

    @abstractmethod
    async def execute(
        self,
        chain: FallbackChain,
        initial_call: dict,
    ) -> FallbackExecutionRecord:
        """
        执行 fallback 链：
        1. 调用 initial_call
        2. FailureDetector.detect_failure() 检测失败
        3. 按 chain.steps 顺序执行 FallbackAction
        4. 每步关联 F022 Tier 恢复策略
        5. 全部失败 -> DEGRADE_TO_BUILTIN
        6. 写入 FallbackExecutionRecord 到 F014 灵忆
        """
        ...

    @abstractmethod
    async def write_record_to_echo_store(
        self, record: FallbackExecutionRecord
    ) -> str:
        """将执行记录写入 F014 灵忆（供 F035 灵锻蒸馏）"""
        ...
```

### 3.3 数据流

```
[1] ExternalAgentBridge 调用三方 Agent 失败
    `--> FallbackChainExecutor.execute(chain, initial_call)
            |
            v
[2] FailureDetector.detect_failure(call_result)
    |-- 超时（>30s）          -> TIMEOUT        -> Tier 1
    |-- 限流（429）           -> RATE_LIMIT     -> Tier 1
    |-- 服务不可用（5xx）     -> SERVICE_UNAVAILABLE -> Tier 2
    |-- 进程崩溃（退出码非 0）-> CRASH          -> Tier 3
    `-- 产出质量 < 0.85       -> QUALITY_BELOW_THRESHOLD -> Tier 4
            |
            v
[3] 按 chain.steps 顺序执行 FallbackAction
    [Step 1] Tier 1 - RETRY_SAME (max_retries=2)
        `--> 同厂商重试 2 次
        `--> 成功: 返回 result
        `--> 失败: 进入 Step 2
    [Step 2] Tier 2 - SWITCH_PROVIDER
        `--> 换到下一个厂商（按 F032 能力画像盲点互补 + 成本排序）
        `--> 成功: 返回 result
        `--> 失败: 进入 Step 3
    [Step 3] Tier 3 - DEGRADE_TO_BUILTIN
        `--> 降级到 FlowForge 内置 agent
        `--> 成功: 返回 result（标记为 degraded）
        `--> 失败: 进入 Step 4
    [Step 4] Tier 4 - ESCALATE_OPERATOR
        `--> 升级给 operator 人工介入
        `--> operator 处理: 返回 result
        `--> operator 不处理: FAIL_FAST
            |
            v
[4] 写入 FallbackExecutionRecord 到 F014 灵忆
    `--> FallbackChainExecutor.write_record_to_echo_store(record)
        |-- record.trigger = RATE_LIMIT
        |-- record.from_provider = "claude_code"
        |-- record.to_provider = "codex"
        |-- record.action_taken = SWITCH_PROVIDER
        |-- record.recovery_tier = 2
        `-- record.succeeded = true
            |
            v
[5] Eval 信号回流
    `--> F018 Eval Contract 收到 fallback 执行结果
        `--> 更新 F032 ExternalAgentCapabilityProfile.historical_performance

[fallback 链构建阶段（预构建）]
    FallbackChainBuilder.build_for_task(task_requirements, forgekin_profile_id)
        |
        v
    F032 CapabilityMatcher.match_for_task() -> 候选厂商列表
        |
        v
    F032 CapabilityMatcher.rank_by_cost_latency() -> 按成本排序
        |
        v
    为每个厂商配置 5 种 trigger -> action 映射
        |-- TIMEOUT/RATE_LIMIT -> RETRY_SAME (Tier 1)
        |-- SERVICE_UNAVAILABLE -> SWITCH_PROVIDER (Tier 2)
        |-- CRASH -> DEGRADE_TO_BUILTIN (Tier 3)
        `-- QUALITY_BELOW_THRESHOLD -> ESCALATE_OPERATOR (Tier 4)
        |
        v
    返回 FallbackChain
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F022 Tier 1-4 Recovery**：每种 FallbackTrigger 对应一个 Tier，恢复策略由 Tier 决定。
- **依赖 F032 ExternalAgentProfile**：FallbackChainBuilder 基于 CapabilityMatcher 盲点互补 + 成本排序构建链。
- **依赖 F014 Memory Collection**：FallbackExecutionRecord 写入灵忆供灵锻蒸馏。
- **依赖 F018 Eval Contract**：fallback 执行结果纳入 Eval 信号，影响三方 Agent 可靠性评估。
- **依赖 core/interfaces**：Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 A031 ExternalAgentBridge**：Bridge 在调用失败时调用 FallbackChainExecutor.execute() 执行 fallback 链。
- **影响 F035 能力融合**：FallbackExecutionRecord 作为灵锻蒸馏原料，提升灵智体未来调用决策能力。
- **影响 F032 能力画像**：fallback 执行结果通过 Eval 信号更新 historical_performance。

### 4.3 跨模块不变量

- FallbackTrigger 枚举必须固定 5 种，禁止运行时新增触发原因。
- FallbackAction 枚举必须固定 5 种，禁止运行时新增动作。
- fallback 链必须基于 F032 能力画像盲点互补 + 成本排序构建，禁止按厂商编号顺序。
- 每种 FallbackTrigger 必须对应一个 F022 Tier，跨级恢复禁止跳级。
- 全部三方 Agent 失败必须降级到 FlowForge 内置 agent，禁止任务完全失败。
- FallbackExecutionRecord 必须写入 F014 灵忆集合，未写入时 fallback 视为未完成。
- 质量阈值必须为 0.85，禁止灵智体修改。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— `core/external_agent/fallback.py` 仅依赖 F014/F018/F022/F032，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— FallbackChainExecutor / FallbackChainBuilder 通过 DI 容器注入到 ExternalAgentBridge。
- [ ] AC-3: Repository 层通过 —— FallbackExecutionRecord 通过 Repository 写入 F014 灵忆，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— failure_detection / fallback_chains / chain_builder 配置 YAML 外置到 `config/external_agent.yaml`。
- [ ] AC-5: 质量阈值通过 —— QUALITY_BELOW_THRESHOLD 触发阈值为 0.85，与项目规则一致。

### 5.2 架构不变量验收

- [ ] AC-6: 5 触发枚举不变量通过 —— FallbackTrigger 仅含 5 种，运行时无法新增。
- [ ] AC-7: 5 动作枚举不变量通过 —— FallbackAction 仅含 5 种，运行时无法新增。
- [ ] AC-8: 能力画像构建不变量通过 —— FallbackChainBuilder 调用 F032 CapabilityMatcher，非按厂商编号顺序。
- [ ] AC-9: Tier 联动不变量通过 —— TIMEOUT/RATE_LIMIT -> Tier 1, SERVICE_UNAVAILABLE -> Tier 2, CRASH -> Tier 3, QUALITY_BELOW_THRESHOLD -> Tier 4。
- [ ] AC-10: 全部失败降级不变量通过 —— fallback 链全部失败时调用 DEGRADE_TO_BUILTIN，任务不失败。
- [ ] AC-11: 灵忆归档不变量通过 —— FallbackExecutionRecord 在 F014 EchoStore 中可查询。

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../features/F034-external-agent-fallback.md]（同号 Feature 级 SRS）
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F032-external-agent-profile.md]
- [doc:../features/F033-external-agent-shared-state.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F031-external-agent-adapter.md]
- [doc:../features/F035-external-agent-capability-fusion.md]
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（5 触发 + 5 动作 + 能力画像构建 + Tier 1-4 联动 + 降级内置 + 灵忆归档架构） | 架构师灵智体（猫头鹰·鲁班） |

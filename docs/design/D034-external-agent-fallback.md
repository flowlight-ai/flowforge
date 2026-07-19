# D034: 三方 Agent 失败回退详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10]（三方 Agent 集成）
> **对应 design.md**: [doc:../design.md#§3.10]
> **对应 Feature**: [doc:../features/F034-external-agent-fallback.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A034-external-agent-fallback.md]（同号 Architecture 级 SAD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]
> **9 大点名称修订**: 已应用（双轨命名 ForgeMind/Forgekin + AI 术语优先 + 弱化万物使用"多形态智能体 (Multi-Form Agent)" + 去 AGI 化使用"通用智能体 (General-Purpose Agent)"）
> **依赖详细设计**: [doc:D031-external-agent-adapter.md]（容器层） + [doc:D032-external-agent-profile.md]（CapabilityMatcher） + [doc:D022-tier-1-4-recovery.md]（F022 Tier 1-4 恢复分级） + [doc:D014-memory-collection.md]（F014 灵忆归档）

---

## 1. 详细设计上下文

### 1.1 设计问题

ExternalAgentAdapter 抽象层（D031）需要为三方 Agent 失败提供跨厂商 fallback 链与降级策略，但 v7.0 无失败回退机制——claude code 失败了是重试还是换 codex?codex 失败了是降级到内置 agent 还是报错?本详细设计在 `core/external_agent/fallback.py` 落地 A034 架构，解决以下详细设计层问题：

1. **5 种 FallbackTrigger 检测算法未实现**：A034 列出 TIMEOUT/RATE_LIMIT/SERVICE_UNAVAILABLE/CRASH/QUALITY_BELOW_THRESHOLD 五种触发，未给出 HTTP 状态码映射、超时阈值（30s）、退出码检测、Eval 质量分阈值（0.85）的具体实现。
2. **5 种 FallbackAction 决策矩阵未编码**：A034 列出 RETRY_SAME/SWITCH_PROVIDER/DEGRADE_TO_BUILTIN/ESCALATE_OPERATOR/FAIL_FAST 五种动作，未给出 trigger × action 映射矩阵、Tier 1-4 联动关系、跨级恢复禁止跳级校验。
3. **FallbackChain 构建算法未实现**：A034 要求基于 F032 CapabilityMatcher.match_for_task() + rank_by_cost_latency() 构建，未给出构建流程、step 间 next_step_id 链表结构、Tier 1-4 配置映射。
4. **FallbackChainExecutor 执行循环未编码**：A034 描述"按 chain.steps 顺序执行"，未给出执行循环、失败重试 max_retries 上限、全部失败降级到内置、operator 升级通知接口。
5. **FallbackExecutionRecord 写入 F014 灵忆未实现**：A034 要求写入 F014 供 F035 灵锻蒸馏，未给出记录结构、echo_store_ref 字段、原子写入保证。
6. **质量阈值 0.85 与项目规则一致性校验未实现**：A034 要求与项目规则一致，未给出常量定义、配置加载校验、运行时禁止修改保证。
7. **Tier 1-4 联动跨级恢复禁止跳级校验未实现**：A034 要求 Tier 1 失败必须先尝试 Tier 2 而非直接 Tier 4，未给出跳级检测算法、违规拒绝逻辑。

### 1.2 设计约束

- **单向依赖约束**：`core/external_agent/fallback.py` 仅依赖 F022 Tier 1-4 Recovery + F032 能力画像 + F014 灵忆 + F018 Eval Contract + core/interfaces，禁止反向依赖 *Forge。
- **DI 容器约束**：FallbackChainExecutor / FallbackChainBuilder / FailureDetector 实例必须通过 DI 容器注入到 ExternalAgentBridge（D031）。
- **Repository 层约束**：FallbackExecutionRecord 写入 F014 灵忆必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：failure_detection / fallback_chains / chain_builder 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码厂商偏好或阈值。
- **质量阈值约束**：质量检测阈值必须为 0.85（与项目规则质量分阈值一致），禁止灵智体修改。
- **Tier 联动约束**：每种 FallbackTrigger 必须对应一个 F022 Tier（1-4），跨级恢复禁止跳级。
- **5 触发枚举不可扩展约束**：FallbackTrigger 固定 5 种，运行时不可新增触发原因。
- **5 动作枚举不可扩展约束**：FallbackAction 固定 5 种，运行时不可新增动作。
- **全部失败降级约束**：fallback 链全部失败必须降级到 FlowForge 内置 agent，禁止任务完全失败。
- **9 大点名称修订约束**：所有命名严格遵循双轨命名（产品层 ForgeMind / 代码层 Forgekin），AI 术语优先（Forgekin/Multi-Form Agent），弱化万物，去 AGI 化。

### 1.3 设计影响

- **对 F022 Tier 1-4 恢复分级的影响**：三方 Agent 失败按 Tier 1（自动重试）/Tier 2（换厂商）/Tier 3（降级内置）/Tier 4（升级 operator）分级恢复。
- **对 F032 能力画像的影响**：FallbackChainBuilder 基于 CapabilityMatcher.match_for_task() + rank_by_cost_latency() 构建链；fallback 执行结果通过 Eval 信号更新 historical_performance。
- **对 F014 多域记忆的影响**：FallbackExecutionRecord 写入灵忆供 F035 灵锻蒸馏失败经验。
- **对 F018 Eval Contract 的影响**：fallback 执行结果纳入 Eval 信号，影响三方 Agent 可靠性评估。
- **对 D031 ExternalAgentBridge 的影响**：Bridge 在调用失败时调用 FallbackChainExecutor.execute() 执行 fallback 链。
- **对 D035 能力融合的影响**：FallbackExecutionRecord 作为灵锻蒸馏原料，提炼"何时不应调用某厂商"的反模式知识。

---

## 2. 详细设计

### 2.1 数据模型

#### 2.1.1 FallbackTrigger 枚举（5 种固定不可扩展）

```python
from enum import Enum


class FallbackTrigger(str, Enum):
    """失败触发原因（5 种，固定不可扩展）

    新增触发原因必须经 ADR 决策并修改此枚举源码。
    """
    TIMEOUT = "timeout"                       # 超时（>30s，与 LLM webchat 调用 30s 上限一致）
    RATE_LIMIT = "rate_limit"                 # 限流（HTTP 429）
    SERVICE_UNAVAILABLE = "unavailable"       # 服务不可用（HTTP 5xx）
    CRASH = "crash"                           # 进程崩溃（退出码非 0）
    QUALITY_BELOW_THRESHOLD = "quality_low"   # 产出质量低于 Eval 阈值 0.85
```

#### 2.1.2 FallbackAction 枚举（5 种固定不可扩展）

```python
class FallbackAction(str, Enum):
    """回退动作（5 种，固定不可扩展）"""
    RETRY_SAME = "retry_same"                 # 同厂商重试（Tier 1）
    SWITCH_PROVIDER = "switch_provider"       # 换厂商（按 F032 能力匹配）（Tier 2）
    DEGRADE_TO_BUILTIN = "degrade_builtin"    # 降级到内置 agent（Tier 3）
    ESCALATE_OPERATOR = "escalate"            # 升级给 operator（Tier 4）
    FAIL_FAST = "fail_fast"                   # 快速失败（不可恢复错误）
```

#### 2.1.3 FallbackChainStep（链一步）

```python
from pydantic import BaseModel, Field


class FallbackChainStep(BaseModel):
    """fallback 链一步

    每步对应一个 provider + 一个 trigger -> action 映射 + 一个 Tier。
    next_step_id 形成链表结构，None 表示链尾。
    """
    step_id: str
    provider: str                             # ExternalAgentProvider.value
    trigger: FallbackTrigger
    action: FallbackAction
    next_step_id: str | None = None           # 链表 next 指针
    tier_classification: int = Field(ge=1, le=4)  # 与 F022 Tier 1-4 联动
    max_retries: int = Field(
        default=2, ge=0,
        description="RETRY_SAME 动作的最大重试次数",
    )
    timeout_seconds: int = Field(
        default=30, gt=0,
        description="本步超时阈值（默认 30s，与 LLM webchat 调用上限一致）",
    )

    model_config = {"extra": "forbid"}
```

#### 2.1.4 FallbackChain（链）

```python
class FallbackChain(BaseModel):
    """fallback 链

    steps 按 Tier 升序排列（Tier 1 在前，Tier 4 在后）。
    built_from_profile=true 表示基于 F032 能力画像构建。
    """
    chain_id: str
    task_signature: str                       # 任务能力需求签名（用于缓存）
    steps: list[FallbackChainStep] = Field(
        min_length=1,
        description="链步骤（至少 1 步）",
    )
    built_from_profile: bool = True           # 是否基于 F032 能力画像构建
    created_at: datetime = Field(default_factory=datetime.now)

    model_config = {"extra": "forbid"}

    @model_validator(mode="after")
    def _validate_tier_progression(self) -> "FallbackChain":
        """校验 Tier 严格升序（禁止跳级）"""
        tiers = [s.tier_classification for s in self.steps]
        for i in range(1, len(tiers)):
            if tiers[i] < tiers[i - 1]:
                raise ValueError(
                    f"Tier progression violation: step {i-1} tier={tiers[i-1]} "
                    f"-> step {i} tier={tiers[i]} (跨级恢复禁止跳级)"
                )
        return self
```

#### 2.1.5 FallbackExecutionRecord（执行记录）

```python
class FallbackExecutionRecord(BaseModel):
    """fallback 执行记录（写入 F014 灵忆）

    供 F035 灵锻蒸馏"何时不应调用某厂商"的反模式知识。
    """
    record_id: str
    chain_id: str
    triggered_at: datetime = Field(default_factory=datetime.now)
    trigger: FallbackTrigger
    from_provider: str                        # 失败的 ExternalAgentProvider.value
    to_provider: str | None = None            # 切换到的厂商（SWITCH_PROVIDER 时填充）
    action_taken: FallbackAction
    recovery_tier: int = Field(ge=1, le=4)    # F022 Tier 1-4
    succeeded: bool                           # fallback 后是否成功
    failure_detail: str | None = None         # 失败详情（错误信息摘要）
    duration_ms: int = Field(ge=0, default=0)
    echo_store_ref: str | None = None         # F014 灵忆集合 ID（写入后填充）

    model_config = {"extra": "forbid"}
```

### 2.2 Trigger × Action × Tier 决策矩阵

```python
# 触发原因 -> (动作, Tier) 映射矩阵（铁律，不可运行时修改）

TRIGGER_ACTION_TIER_MATRIX: dict[FallbackTrigger, tuple[FallbackAction, int]] = {
    FallbackTrigger.TIMEOUT: (FallbackAction.RETRY_SAME, 1),
    FallbackTrigger.RATE_LIMIT: (FallbackAction.RETRY_SAME, 1),
    FallbackTrigger.SERVICE_UNAVAILABLE: (FallbackAction.SWITCH_PROVIDER, 2),
    FallbackTrigger.CRASH: (FallbackAction.DEGRADE_TO_BUILTIN, 3),
    FallbackTrigger.QUALITY_BELOW_THRESHOLD: (FallbackAction.ESCALATE_OPERATOR, 4),
}
"""FallbackTrigger × FallbackAction × Tier 决策矩阵

| Trigger                     | Action              | Tier |
|-----------------------------|---------------------|------|
| TIMEOUT                     | RETRY_SAME          | 1    |
| RATE_LIMIT                  | RETRY_SAME          | 1    |
| SERVICE_UNAVAILABLE         | SWITCH_PROVIDER     | 2    |
| CRASH                       | DEGRADE_TO_BUILTIN  | 3    |
| QUALITY_BELOW_THRESHOLD     | ESCALATE_OPERATOR   | 4    |
"""


QUALITY_THRESHOLD = 0.85
"""质量阈值（与项目规则 v4.0 调整后默认值一致，禁止灵智体修改）"""

DEFAULT_TIMEOUT_SECONDS = 30
"""默认超时阈值（与 LLM webchat 调用 30s 上限一致）"""

HTTP_RATE_LIMIT_STATUS = 429
"""HTTP 限流状态码"""

HTTP_SERVICE_UNAVAILABLE_RANGE = (500, 599)
"""HTTP 服务不可用状态码范围（5xx）"""
```

### 2.3 FailureDetector 检测算法

```python
def detect_failure_impl(
    call_result: dict,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    quality_threshold: float = QUALITY_THRESHOLD,
) -> FallbackTrigger | None:
    """失败检测算法

    检测顺序（首个匹配即返回）：
        1. CRASH: call_result["exit_code"] != 0
        2. TIMEOUT: call_result["duration_ms"] > timeout_seconds * 1000
        3. RATE_LIMIT: call_result["http_status"] == 429
        4. SERVICE_UNAVAILABLE: 500 <= call_result["http_status"] <= 599
        5. QUALITY_BELOW_THRESHOLD: call_result["quality_score"] < quality_threshold
        6. 无失败: 返回 None

    Args:
        call_result: 调用结果字典，可能字段：
            - exit_code: int（进程退出码）
            - duration_ms: int（实际耗时）
            - http_status: int（HTTP 状态码）
            - quality_score: float（F018 Eval 质量分）
            - success: bool（业务成功标志）
        timeout_seconds: 超时阈值
        quality_threshold: 质量阈值

    Returns:
        FallbackTrigger 或 None（无失败）
    """
    # 1. CRASH 检测
    exit_code = call_result.get("exit_code")
    if exit_code is not None and exit_code != 0:
        return FallbackTrigger.CRASH

    # 2. TIMEOUT 检测
    duration_ms = call_result.get("duration_ms", 0)
    if duration_ms > timeout_seconds * 1000:
        return FallbackTrigger.TIMEOUT

    # 3. RATE_LIMIT 检测（429）
    http_status = call_result.get("http_status")
    if http_status == HTTP_RATE_LIMIT_STATUS:
        return FallbackTrigger.RATE_LIMIT

    # 4. SERVICE_UNAVAILABLE 检测（5xx）
    if http_status is not None and HTTP_SERVICE_UNAVAILABLE_RANGE[0] <= http_status <= HTTP_SERVICE_UNAVAILABLE_RANGE[1]:
        return FallbackTrigger.SERVICE_UNAVAILABLE

    # 5. QUALITY_BELOW_THRESHOLD 检测
    quality_score = call_result.get("quality_score")
    if quality_score is not None and quality_score < quality_threshold:
        return FallbackTrigger.QUALITY_BELOW_THRESHOLD

    # 6. 显式 success=False 但无具体原因，默认归为 SERVICE_UNAVAILABLE
    if call_result.get("success") is False and not call_result.get("error_classified"):
        return FallbackTrigger.SERVICE_UNAVAILABLE

    return None
```

### 2.4 FallbackChain 构建算法

```python
async def build_fallback_chain(
    capability_matcher: "CapabilityMatcher",
    task_requirements: list[str],
    forgekin_profile_id: str,
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
) -> FallbackChain:
    """构建 fallback 链

    算法：
        1. 调用 CapabilityMatcher.match_for_task() 获取候选厂商（按盲点互补分降序）
        2. 调用 CapabilityMatcher.rank_by_cost_latency() 按成本+延迟升序重排
        3. 为每个厂商生成 5 个 step（一个厂商 × 5 个 trigger）
        4. 按 Tier 升序排列 steps（Tier 1 在前）
        5. 设置 next_step_id 形成链表

    链结构示例（4 厂商）：
        Tier 1: claude_code (RETRY_SAME, TIMEOUT/RATE_LIMIT)
        Tier 1: codex (RETRY_SAME, TIMEOUT/RATE_LIMIT)
        Tier 2: claude_code (SWITCH_PROVIDER, SERVICE_UNAVAILABLE)
        Tier 2: codex (SWITCH_PROVIDER, SERVICE_UNAVAILABLE)
        Tier 3: opencode (DEGRADE_TO_BUILTIN, CRASH)
        Tier 4: trae (ESCALATE_OPERATOR, QUALITY_BELOW_THRESHOLD)

    Args:
        capability_matcher: F032 CapabilityMatcher 实例
        task_requirements: 任务能力需求
        forgekin_profile_id: 灵智体画像 ID
        timeout_seconds: 超时阈值

    Returns:
        FallbackChain
    """
    # 1. 获取候选厂商
    candidates = await capability_matcher.match_for_task(
        forgekin_profile_id=forgekin_profile_id,
        task_capability_requirements=task_requirements,
    )
    if not candidates:
        # 无候选，构建仅含 Tier 3 DEGRADE_TO_BUILTIN 的最小链
        return FallbackChain(
            chain_id=f"chain_minimal_{forgekin_profile_id}_{hash(tuple(task_requirements))}",
            task_signature=str(task_requirements),
            steps=[
                FallbackChainStep(
                    step_id="step_degrade_builtin",
                    provider="builtin",  # FlowForge 内置 agent
                    trigger=FallbackTrigger.CRASH,
                    action=FallbackAction.DEGRADE_TO_BUILTIN,
                    next_step_id=None,
                    tier_classification=3,
                    max_retries=0,
                    timeout_seconds=timeout_seconds,
                )
            ],
            built_from_profile=False,
        )

    # 2. 按成本+延迟升序重排
    ranked = await capability_matcher.rank_by_cost_latency(candidates)

    # 3. 为每个厂商生成 5 个 step
    steps: list[FallbackChainStep] = []
    for provider_profile in ranked:
        provider_value = provider_profile.provider.value
        for trigger, (action, tier) in TRIGGER_ACTION_TIER_MATRIX.items():
            step = FallbackChainStep(
                step_id=f"step_{provider_value}_{trigger.value}",
                provider=provider_value,
                trigger=trigger,
                action=action,
                next_step_id=None,  # 稍后设置
                tier_classification=tier,
                max_retries=2 if action == FallbackAction.RETRY_SAME else 0,
                timeout_seconds=timeout_seconds,
            )
            steps.append(step)

    # 4. 按 Tier 升序排列（同 Tier 内按厂商成本升序，由 rank_by_cost_latency 保证）
    steps.sort(key=lambda s: (s.tier_classification, s.provider))

    # 5. 设置 next_step_id 链表
    for i in range(len(steps) - 1):
        steps[i].next_step_id = steps[i + 1].step_id
    steps[-1].next_step_id = None

    return FallbackChain(
        chain_id=f"chain_{forgekin_profile_id}_{hash(tuple(task_requirements))}",
        task_signature=str(task_requirements),
        steps=steps,
        built_from_profile=True,
    )
```

### 2.5 FallbackChainExecutor 执行循环

```python
async def execute_fallback_chain(
    chain: FallbackChain,
    initial_call: dict,
    adapter_registry: "ExternalAgentAdapterRegistry",
    failure_detector: "FailureDetector",
    builtin_agent_invoker: "BuiltinAgentInvoker",
    operator_notifier: "OperatorNotifier",
    shared_state_handoff: "SharedStateHandoff | None" = None,
    state_id: str | None = None,
) -> FallbackExecutionRecord:
    """执行 fallback 链

    算法：
        1. 从 chain.steps[0] 开始
        2. 调用对应 provider 的 adapter
        3. FailureDetector 检测失败
        4. 若失败，按 trigger -> action 决策：
            - RETRY_SAME: 同 provider 重试（max_retries 上限）
            - SWITCH_PROVIDER: 进入 next_step（next provider）
            - DEGRADE_TO_BUILTIN: 调用 builtin_agent_invoker
            - ESCALATE_OPERATOR: 通知 operator 等待人工介入
            - FAIL_FAST: 立即返回失败
        5. 全部失败 -> DEGRADE_TO_BUILTIN 兜底
        6. 写入 FallbackExecutionRecord 到 F014 灵忆

    Args:
        chain: fallback 链
        initial_call: 初始调用参数
        adapter_registry: Adapter 注册表
        failure_detector: 失败检测器
        builtin_agent_invoker: 内置 agent 调用器
        operator_notifier: operator 通知器
        shared_state_handoff: 共享状态交接（可选，用于 Onboarding 传递）
        state_id: 共享状态 ID（可选）

    Returns:
        FallbackExecutionRecord
    """
    triggered_at = datetime.now()
    start_ms = triggered_at.timestamp() * 1000

    current_step_idx = 0
    last_trigger: FallbackTrigger | None = None
    last_from_provider: str | None = None
    last_to_provider: str | None = None
    last_action: FallbackAction = FallbackAction.RETRY_SAME
    last_tier: int = 1
    last_failure_detail: str | None = None
    succeeded = False

    while current_step_idx < len(chain.steps):
        step = chain.steps[current_step_idx]
        last_from_provider = step.provider
        last_action = step.action
        last_tier = step.tier_classification

        # 若有 shared_state_handoff + state_id，读取 Onboarding 摘要注入调用
        call_input = dict(initial_call)
        if shared_state_handoff is not None and state_id is not None:
            try:
                onboarding = await shared_state_handoff.read_onboarding(
                    agent_id=step.provider,
                    state_id=state_id,
                )
                call_input["onboarding_summary"] = onboarding.model_dump()
            except Exception as e:
                logger.warning(
                    "read_onboarding failed, proceeding without summary",
                    extra={"state_id": state_id, "error": str(e)},
                )

        # 根据 action 执行
        if step.action == FallbackAction.RETRY_SAME:
            # Tier 1: 同厂商重试 max_retries 次
            adapter = adapter_registry.get_by_provider(step.provider)
            if adapter is None:
                current_step_idx += 1
                continue
            for attempt in range(step.max_retries + 1):
                try:
                    result = await adapter.invoke(call_input)
                    call_result = {
                        "exit_code": 0,
                        "duration_ms": int(result.duration_ms),
                        "http_status": 200,
                        "quality_score": result.output.get("quality_score", 1.0) if result.output else 1.0,
                        "success": result.success,
                    }
                    trigger = await failure_detector.detect_failure(call_result)
                    if trigger is None:
                        succeeded = True
                        last_trigger = None
                        break
                    else:
                        last_trigger = trigger
                        last_failure_detail = result.error or "quality below threshold"
                        # 若 trigger 与 step.trigger 不匹配，跳出重试进入下一步
                        if trigger != step.trigger:
                            break
                except Exception as e:
                    last_trigger = FallbackTrigger.CRASH
                    last_failure_detail = str(e)
                    break
            if succeeded:
                break
            # 重试失败，进入 next_step
            current_step_idx = _find_next_step_idx(chain, step.next_step_id)

        elif step.action == FallbackAction.SWITCH_PROVIDER:
            # Tier 2: 换厂商
            adapter = adapter_registry.get_by_provider(step.provider)
            if adapter is None:
                current_step_idx += 1
                continue
            try:
                result = await adapter.invoke(call_input)
                call_result = {
                    "exit_code": 0,
                    "duration_ms": int(result.duration_ms),
                    "http_status": 200,
                    "quality_score": result.output.get("quality_score", 1.0) if result.output else 1.0,
                    "success": result.success,
                }
                trigger = await failure_detector.detect_failure(call_result)
                if trigger is None:
                    succeeded = True
                    last_to_provider = step.provider
                    last_trigger = None
                    break
                else:
                    last_trigger = trigger
                    last_failure_detail = result.error or "quality below threshold"
            except Exception as e:
                last_trigger = FallbackTrigger.CRASH
                last_failure_detail = str(e)
            current_step_idx = _find_next_step_idx(chain, step.next_step_id)

        elif step.action == FallbackAction.DEGRADE_TO_BUILTIN:
            # Tier 3: 降级到内置 agent
            try:
                result = await builtin_agent_invoker.invoke(call_input)
                succeeded = bool(result.get("success", False))
                last_to_provider = "builtin"
                if succeeded:
                    last_trigger = None
                    break
                else:
                    last_failure_detail = result.get("error", "builtin agent failed")
            except Exception as e:
                last_failure_detail = str(e)
            current_step_idx = _find_next_step_idx(chain, step.next_step_id)

        elif step.action == FallbackAction.ESCALATE_OPERATOR:
            # Tier 4: 升级给 operator
            try:
                operator_response = await operator_notifier.notify_and_wait(
                    payload={
                        "chain_id": chain.chain_id,
                        "step_id": step.step_id,
                        "trigger": last_trigger.value if last_trigger else "unknown",
                        "from_provider": last_from_provider,
                        "failure_detail": last_failure_detail,
                    }
                )
                if operator_response.get("resolved"):
                    succeeded = True
                    last_to_provider = "operator"
                    last_trigger = None
                    break
                else:
                    last_failure_detail = "operator did not resolve"
            except Exception as e:
                last_failure_detail = f"operator notify failed: {e}"
            current_step_idx = _find_next_step_idx(chain, step.next_step_id)

        elif step.action == FallbackAction.FAIL_FAST:
            # 不可恢复错误，立即返回
            break

    # 兜底：全部失败时降级到内置 agent
    if not succeeded:
        try:
            result = await builtin_agent_invoker.invoke(initial_call)
            succeeded = bool(result.get("success", False))
            last_to_provider = "builtin"
            last_action = FallbackAction.DEGRADE_TO_BUILTIN
            last_tier = 3
            if not succeeded:
                last_failure_detail = result.get("error", "builtin agent failed (final)")
        except Exception as e:
            last_failure_detail = f"final builtin agent failed: {e}"

    end_ms = datetime.now().timestamp() * 1000
    duration_ms = int(end_ms - start_ms)

    record = FallbackExecutionRecord(
        record_id=f"fer_{chain.chain_id}_{uuid.uuid4().hex[:8]}",
        chain_id=chain.chain_id,
        triggered_at=triggered_at,
        trigger=last_trigger or FallbackTrigger.SERVICE_UNAVAILABLE,
        from_provider=last_from_provider or "unknown",
        to_provider=last_to_provider,
        action_taken=last_action,
        recovery_tier=last_tier,
        succeeded=succeeded,
        failure_detail=last_failure_detail,
        duration_ms=duration_ms,
        echo_store_ref=None,  # 稍后由 write_record_to_echo_store 填充
    )
    return record


def _find_next_step_idx(
    chain: FallbackChain, next_step_id: str | None
) -> int:
    """根据 next_step_id 找到下一步在 steps 中的索引

    若 next_step_id 为 None，返回 len(steps)（链尾，跳出循环）。
    """
    if next_step_id is None:
        return len(chain.steps)
    for i, step in enumerate(chain.steps):
        if step.step_id == next_step_id:
            return i
    return len(chain.steps)
```

---

## 3. 模块实现

### 3.1 FailureDetector 抽象与实现

#### 3.1.1 抽象基类

```python
from abc import ABC, abstractmethod


class FailureDetector(ABC):
    """失败检测器（5 种触发）"""

    @abstractmethod
    async def detect_failure(
        self, call_result: dict
    ) -> FallbackTrigger | None:
        """检测失败原因"""
        ...
```

#### 3.1.2 Harness 实现

```python
class HarnessFailureDetector(FailureDetector):
    """FailureDetector 的 Harness 实现"""

    def __init__(
        self,
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
        quality_threshold: float = QUALITY_THRESHOLD,
    ) -> None:
        self._timeout_seconds = timeout_seconds
        self._quality_threshold = quality_threshold
        logger.info(
            "HarnessFailureDetector initialized",
            extra={
                "timeout_seconds": timeout_seconds,
                "quality_threshold": quality_threshold,
            },
        )

    async def detect_failure(
        self, call_result: dict
    ) -> FallbackTrigger | None:
        trigger = detect_failure_impl(
            call_result=call_result,
            timeout_seconds=self._timeout_seconds,
            quality_threshold=self._quality_threshold,
        )
        if trigger is not None:
            logger.info(
                "Failure detected",
                extra={
                    "trigger": trigger.value,
                    "http_status": call_result.get("http_status"),
                    "duration_ms": call_result.get("duration_ms"),
                    "quality_score": call_result.get("quality_score"),
                    "exit_code": call_result.get("exit_code"),
                },
            )
        return trigger
```

### 3.2 FallbackChainBuilder 抽象与实现

#### 3.2.1 抽象基类

```python
class FallbackChainBuilder(ABC):
    """fallback 链构建器（基于 F032 能力画像）"""

    @abstractmethod
    async def build_for_task(
        self,
        task_requirements: list[str],
        forgekin_profile_id: str,
    ) -> FallbackChain:
        """基于能力匹配 + 盲点互补 + 成本排序构建 fallback 链"""
        ...
```

#### 3.2.2 Harness 实现

```python
class HarnessFallbackChainBuilder(FallbackChainBuilder):
    """FallbackChainBuilder 的 Harness 实现"""

    def __init__(
        self,
        capability_matcher: "CapabilityMatcher",  # 来自 D032
        timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._matcher = capability_matcher
        self._timeout_seconds = timeout_seconds

    async def build_for_task(
        self,
        task_requirements: list[str],
        forgekin_profile_id: str,
    ) -> FallbackChain:
        chain = await build_fallback_chain(
            capability_matcher=self._matcher,
            task_requirements=task_requirements,
            forgekin_profile_id=forgekin_profile_id,
            timeout_seconds=self._timeout_seconds,
        )
        logger.info(
            "FallbackChain built",
            extra={
                "chain_id": chain.chain_id,
                "task_signature": chain.task_signature,
                "steps_count": len(chain.steps),
                "built_from_profile": chain.built_from_profile,
            },
        )
        return chain
```

### 3.3 FallbackChainExecutor 抽象与实现

#### 3.3.1 抽象基类

```python
class FallbackChainExecutor(ABC):
    """fallback 链执行器"""

    @abstractmethod
    async def execute(
        self,
        chain: FallbackChain,
        initial_call: dict,
        state_id: str | None = None,
    ) -> FallbackExecutionRecord:
        """执行 fallback 链"""
        ...

    @abstractmethod
    async def write_record_to_echo_store(
        self, record: FallbackExecutionRecord
    ) -> str:
        """将执行记录写入 F014 灵忆（供 F035 灵锻蒸馏）"""
        ...
```

#### 3.3.2 Harness 实现

```python
class HarnessFallbackChainExecutor(FallbackChainExecutor):
    """FallbackChainExecutor 的 Harness 实现"""

    def __init__(
        self,
        adapter_registry: "ExternalAgentAdapterRegistry",
        failure_detector: FailureDetector,
        builtin_agent_invoker: "BuiltinAgentInvoker",
        operator_notifier: "OperatorNotifier",
        echo_store_repo: "Repository",  # F014 EchoStore
        shared_state_handoff: "SharedStateHandoff | None" = None,
    ) -> None:
        self._adapters = adapter_registry
        self._detector = failure_detector
        self._builtin = builtin_agent_invoker
        self._operator = operator_notifier
        self._echo_repo = echo_store_repo
        self._handoff = shared_state_handoff

    async def execute(
        self,
        chain: FallbackChain,
        initial_call: dict,
        state_id: str | None = None,
    ) -> FallbackExecutionRecord:
        record = await execute_fallback_chain(
            chain=chain,
            initial_call=initial_call,
            adapter_registry=self._adapters,
            failure_detector=self._detector,
            builtin_agent_invoker=self._builtin,
            operator_notifier=self._operator,
            shared_state_handoff=self._handoff,
            state_id=state_id,
        )
        # 写入 F014 灵忆
        echo_ref = await self.write_record_to_echo_store(record)
        updated_record = record.model_copy(
            update={"echo_store_ref": echo_ref}
        )
        logger.info(
            "FallbackChain executed",
            extra={
                "record_id": updated_record.record_id,
                "chain_id": chain.chain_id,
                "trigger": updated_record.trigger.value,
                "from_provider": updated_record.from_provider,
                "to_provider": updated_record.to_provider,
                "action_taken": updated_record.action_taken.value,
                "recovery_tier": updated_record.recovery_tier,
                "succeeded": updated_record.succeeded,
                "duration_ms": updated_record.duration_ms,
                "echo_store_ref": echo_ref,
            },
        )
        return updated_record

    async def write_record_to_echo_store(
        self, record: FallbackExecutionRecord
    ) -> str:
        echo_ref = await self._echo_repo.save(
            key=f"fallback_record_{record.record_id}",
            value=record.model_dump(),
            collection="external_agent_fallback_records",
        )
        return echo_ref
```

### 3.4 BuiltinAgentInvoker 与 OperatorNotifier 抽象

```python
class BuiltinAgentInvoker(ABC):
    """FlowForge 内置 agent 调用器（Tier 3 降级）"""

    @abstractmethod
    async def invoke(self, call: dict) -> dict:
        """调用内置 agent

        Returns:
            {"success": bool, "output": dict, "error": str | None}
        """
        ...


class OperatorNotifier(ABC):
    """operator 通知器（Tier 4 升级）"""

    @abstractmethod
    async def notify_and_wait(self, payload: dict) -> dict:
        """通知 operator 并等待响应

        Returns:
            {"resolved": bool, "resolution": str | None}
        """
        ...
```

### 3.5 配置加载器与 YAML

```python
class FallbackConfigLoader:
    """fallback 配置加载器"""

    REQUIRED_CONFIG_FIELDS = [
        "timeout_seconds",
        "quality_threshold",
        "max_retries",
        "echo_store_collection",
    ]

    def __init__(
        self,
        config_path: str = "config/external_agent.yaml",
    ) -> None:
        self._config_path = Path(config_path).resolve()

    def load(self) -> dict:
        if not self._config_path.exists():
            raise FileNotFoundError(
                f"external_agent.yaml not found: {self._config_path}"
            )
        with open(self._config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        fallback_config = config.get("fallback", {})
        self._assert_fields_complete(fallback_config)
        # 校验质量阈值不可修改
        if fallback_config["quality_threshold"] != QUALITY_THRESHOLD:
            raise ValueError(
                f"quality_threshold must be {QUALITY_THRESHOLD} (项目规则铁律), "
                f"got {fallback_config['quality_threshold']}"
            )
        return fallback_config

    def _assert_fields_complete(self, config: dict) -> None:
        missing = [f for f in self.REQUIRED_CONFIG_FIELDS if f not in config]
        if missing:
            raise ValueError(f"fallback config missing fields: {missing}")
```

### 3.6 external_agent.yaml 配置示例

```yaml
# config/external_agent.yaml（fallback 段节选）

fallback:
  timeout_seconds: 30                  # 超时阈值（与 LLM webchat 30s 上限一致）
  quality_threshold: 0.85              # 质量阈值（项目规则铁律，禁止修改）
  max_retries: 2                       # RETRY_SAME 最大重试次数
  echo_store_collection: "external_agent_fallback_records"  # F014 灵忆集合
  operator_notify_timeout_seconds: 300 # operator 响应超时（5 分钟）
  auto_degrade_on_all_fail: true       # 全部失败时自动降级到内置 agent
```

### 3.7 DI 容器注册

```python
def register_external_agent_fallback_layer(
    container: DIContainer,
    config_path: str = "config/external_agent.yaml",
) -> None:
    """注册三方 Agent 失败回退层到 DI 容器"""
    config_loader = FallbackConfigLoader(config_path=config_path)
    config = config_loader.load()

    echo_store_repo = container.resolve_repository(
        model_type="EchoStoreEntry",
        collection=config["echo_store_collection"],
    )
    adapter_registry = container.resolve("ExternalAgentAdapterRegistry")
    builtin_invoker = container.resolve("BuiltinAgentInvoker")
    operator_notifier = container.resolve("OperatorNotifier")
    capability_matcher = container.resolve("CapabilityMatcher")  # D032
    shared_state_handoff = container.resolve("SharedStateHandoff")  # D033

    failure_detector = HarnessFailureDetector(
        timeout_seconds=config["timeout_seconds"],
        quality_threshold=config["quality_threshold"],
    )
    container.register_instance(FailureDetector, failure_detector)

    chain_builder = HarnessFallbackChainBuilder(
        capability_matcher=capability_matcher,
        timeout_seconds=config["timeout_seconds"],
    )
    container.register_instance(FallbackChainBuilder, chain_builder)

    chain_executor = HarnessFallbackChainExecutor(
        adapter_registry=adapter_registry,
        failure_detector=failure_detector,
        builtin_agent_invoker=builtin_invoker,
        operator_notifier=operator_notifier,
        echo_store_repo=echo_store_repo,
        shared_state_handoff=shared_state_handoff,
    )
    container.register_instance(FallbackChainExecutor, chain_executor)
```

---

## 4. 跨模块协作实现

### 4.1 与 D031 ExternalAgentBridge 协作

```python
# core/external_agent/bridge.py（D031 节选，展示与 D034 协作）

class ExternalAgentBridge:
    def __init__(
        self,
        adapter_registry: "ExternalAgentAdapterRegistry",
        capability_matcher: CapabilityMatcher,  # D032
        profile_registry: ExternalAgentProfileRegistry,  # D032
        shared_state_store: SharedStateStore,  # D033
        shared_state_handoff: SharedStateHandoff,  # D033
        fallback_chain_builder: FallbackChainBuilder,  # D034
        fallback_chain_executor: FallbackChainExecutor,  # D034
        failure_detector: FailureDetector,  # D034
    ) -> None:
        self._adapters = adapter_registry
        self._matcher = capability_matcher
        self._profiles = profile_registry
        self._state_store = shared_state_store
        self._state_handoff = shared_state_handoff
        self._fb_builder = fallback_chain_builder
        self._fb_executor = fallback_chain_executor
        self._fb_detector = failure_detector

    async def invoke_with_fallback(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
        task_capability_requirements: list[str] | None = None,
        state_id: str | None = None,
    ) -> ExternalAgentResult:
        """带 fallback 的调用"""
        # 1. 预构建 fallback 链
        chain = await self._fb_builder.build_for_task(
            task_requirements=task_capability_requirements or [],
            forgekin_profile_id=forgekin_id,
        )

        # 2. 执行 fallback 链
        initial_call = {
            "task": task.model_dump(),
            "forgekin_id": forgekin_id,
        }
        record = await self._fb_executor.execute(
            chain=chain,
            initial_call=initial_call,
            state_id=state_id,
        )

        # 3. 通过 Eval 信号回流 PerformanceLog（D032）
        if record.to_provider and record.to_provider not in ("builtin", "operator"):
            try:
                profile = await self._profiles.get(record.to_provider)
                current = profile.historical_performance
                await self._profiles.update_performance(
                    agent_id=record.to_provider,
                    new_call_total=current.total_calls + 1,
                    new_success_count=current.success_count + (1 if record.succeeded else 0),
                    new_quality_score=current.avg_quality_score,  # 保持原值
                )
            except Exception as e:
                logger.warning(
                    "Failed to update PerformanceLog via fallback record",
                    extra={"to_provider": record.to_provider, "error": str(e)},
                )

        return ExternalAgentResult(
            task_id=task.task_id,
            success=record.succeeded,
            output={"fallback_record": record.model_dump()},
            error=None if record.succeeded else record.failure_detail,
            execution_trace=[],
            cost_incurred=0.0,
            duration_ms=record.duration_ms,
        )
```

### 4.2 与 F022 Tier 1-4 Recovery 协作

```python
# core/recovery/tier_1_4.py（F022 节选，展示与 D034 协作）

class TierRecoveryCoordinator:
    """F022 Tier 1-4 恢复分级协调器"""

    TIER_HANDLERS: dict[int, str] = {
        1: "auto_retry",           # 自动重试（同厂商）
        2: "switch_provider",      # 换厂商
        3: "degrade_builtin",      # 降级内置
        4: "escalate_operator",    # 升级 operator
    }

    async def assert_tier_progression(
        self,
        from_tier: int,
        to_tier: int,
    ) -> None:
        """校验 Tier 升级不跳级（Tier 1 -> 2 -> 3 -> 4 严格升序）"""
        if to_tier < from_tier:
            raise TierProgressionViolationError(
                from_tier=from_tier,
                to_tier=to_tier,
                reason="Tier 不可降级",
            )
        if to_tier > from_tier + 1:
            raise TierProgressionViolationError(
                from_tier=from_tier,
                to_tier=to_tier,
                reason=f"Tier 跳级禁止（{from_tier} -> {to_tier}）",
            )


class TierProgressionViolationError(Exception):
    def __init__(self, from_tier: int, to_tier: int, reason: str) -> None:
        self.from_tier = from_tier
        self.to_tier = to_tier
        super().__init__(
            f"Tier progression violation: {from_tier} -> {to_tier}: {reason}"
        )
```

### 4.3 与 F032 CapabilityMatcher 协作

FallbackChainBuilder 调用 CapabilityMatcher.match_for_task() + rank_by_cost_latency() 构建链（详见 §2.4 build_fallback_chain 算法）。

### 4.4 与 F014 EchoStore 协作（归档）

FallbackExecutionRecord 写入 F014 EchoStore 灵忆集合 `external_agent_fallback_records`，供 F035 灵锻蒸馏。

### 4.5 与 F018 Eval Contract 协作

```python
# core/eval/contract.py（F018 节选，展示与 D034 协作）

class EvalContract:
    async def score_fallback_record(
        self, record: FallbackExecutionRecord
    ) -> float:
        """对 fallback 执行记录评分

        评分逻辑：
            - succeeded=True: 0.9（fallback 成功）
            - succeeded=False but to_provider=builtin: 0.6（降级成功）
            - succeeded=False and to_provider=operator: 0.3（人工介入）
            - succeeded=False and action=FAIL_FAST: 0.0（完全失败）
        """
        if record.succeeded:
            return 0.9
        if record.to_provider == "builtin":
            return 0.6
        if record.to_provider == "operator":
            return 0.3
        return 0.0
```

### 4.6 与 D035 CapabilityFusion 协作

```python
# core/external_agent/capability_fusion.py（D035 节选，展示与 D034 协作）

class HarnessCapabilityDistiller(CapabilityDistiller):
    async def distill_from_fallback_records(
        self,
        forgekin_id: str,
        fallback_records: list[FallbackExecutionRecord],
    ) -> list[CapabilityDistillationCandidate]:
        """从 fallback 执行记录蒸馏反模式知识

        反模式示例：
            - "claude_code 在 command_line_long_task 场景下频繁 TIMEOUT"
            - "codex 在 multi_file_edit 场景下 quality_score < 0.85"
        """
        candidates = []
        # 按 provider + trigger 聚类
        clusters: dict[tuple[str, str], list[FallbackExecutionRecord]] = {}
        for record in fallback_records:
            key = (record.from_provider, record.trigger.value)
            clusters.setdefault(key, []).append(record)

        for (provider, trigger), records in clusters.items():
            if len(records) < 3:
                continue  # CL-003 L0->L1 需 3+ 相似 Episode
            candidate = CapabilityDistillationCandidate(
                candidate_id=f"anti_pattern_{provider}_{trigger}_{uuid.uuid4().hex[:8]}",
                fusion_sources=[],  # 由 D035 内部填充
                distilled_capability=f"避免在 {trigger} 场景下调用 {provider}",
                trigger_pattern=f"{provider} 在 {trigger} 场景下失败",
                procedure="换用其他厂商或降级到内置 agent",
                precondition=f"任务触发 {trigger}",
                postcondition="任务由其他厂商或内置 agent 完成",
                anti_pattern=f"不要在 {trigger} 场景下首选 {provider}",
                provenance=[r.record_id for r in records],
                confidence=min(1.0, len(records) / 10),
                maturity_level=MaturityLevel.L1_PATTERN,
            )
            candidates.append(candidate)
        return candidates
```

### 4.7 完整时序图：fallback 链执行

```
[ExternalAgentBridge] --invoke_with_fallback(forgekin_id, task)-->
    |
    | 1. FallbackChainBuilder.build_for_task()
    v
[FallbackChainBuilder (D034)]
    |
    | 2. CapabilityMatcher.match_for_task() (D032)
    v
[CapabilityMatcher] --candidates: [claude_code, codex, opencode, trae]-->
    |
    | 3. CapabilityMatcher.rank_by_cost_latency() (D032)
    v
[ranked candidates] --按成本+延迟升序-->
    |
    | 4. 为每个厂商生成 5 个 step + 设置 next_step_id 链表
    v
[FallbackChain] --返回-->

[ExternalAgentBridge]
    |
    | 5. FallbackChainExecutor.execute(chain, initial_call)
    v
[FallbackChainExecutor (D034)]
    |
    | 6. 从 step[0] 开始执行
    v
[Step 0: Tier 1 - claude_code RETRY_SAME]
    |
    | 7. ClaudeCodeAdapter.invoke(call)
    v
[ClaudeCodeAdapter] --result-->
    |
    | 8. FailureDetector.detect_failure(result)
    v
[FailureDetector (D034)]
    |
    |-- 无失败 --> 成功，跳出循环
    |-- TIMEOUT --> 重试 max_retries=2 次
    |   |-- 重试成功 --> 成功，跳出
    |   `-- 重试失败 --> 进入 next_step
    `-- 其他失败 --> 进入 next_step

[Step N: Tier 2 - codex SWITCH_PROVIDER]
    |
    | 9. CodexAdapter.invoke(call)
    v
[CodexAdapter] --result-->
    |
    | 10. detect_failure(result)
    v
    |-- 无失败 --> 成功
    `-- 失败 --> 进入 next_step

[Step M: Tier 3 - DEGRADE_TO_BUILTIN]
    |
    | 11. BuiltinAgentInvoker.invoke(call)
    v
[BuiltinAgentInvoker] --result-->
    |
    | 12. detect_failure(result)
    v
    |-- 无失败 --> 成功
    `-- 失败 --> 进入 next_step

[Step K: Tier 4 - ESCALATE_OPERATOR]
    |
    | 13. OperatorNotifier.notify_and_wait(payload)
    v
[OperatorNotifier] --response-->
    |
    |-- resolved=True --> 成功
    `-- resolved=False --> 进入 next_step

[全部失败兜底]
    |
    | 14. BuiltinAgentInvoker.invoke(initial_call)
    v
[BuiltinAgentInvoker] --result-->

[FallbackChainExecutor]
    |
    | 15. write_record_to_echo_store(record)
    v
[EchoStoreRepository (F014)] --echo_store_ref-->

[FallbackChainExecutor] --FallbackExecutionRecord-->
    |
    | 16. Eval 信号回流（update PerformanceLog）
    v
[ExternalAgentProfileRegistry (D032)] --update_performance-->
```

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

- [ ] **AC-F-01**: FallbackTrigger 枚举仅含 5 种（TIMEOUT/RATE_LIMIT/SERVICE_UNAVAILABLE/CRASH/QUALITY_BELOW_THRESHOLD），运行时无法新增。
- [ ] **AC-F-02**: FallbackAction 枚举仅含 5 种（RETRY_SAME/SWITCH_PROVIDER/DEGRADE_TO_BUILTIN/ESCALATE_OPERATOR/FAIL_FAST），运行时无法新增。
- [ ] **AC-F-03**: FallbackChain._validate_tier_progression 校验 Tier 严格升序，跳级触发 ValueError。
- [ ] **AC-F-04**: detect_failure_impl 在 exit_code != 0 时返回 CRASH。
- [ ] **AC-F-05**: detect_failure_impl 在 duration_ms > 30000 时返回 TIMEOUT。
- [ ] **AC-F-06**: detect_failure_impl 在 http_status == 429 时返回 RATE_LIMIT。
- [ ] **AC-F-07**: detect_failure_impl 在 500 <= http_status <= 599 时返回 SERVICE_UNAVAILABLE。
- [ ] **AC-F-08**: detect_failure_impl 在 quality_score < 0.85 时返回 QUALITY_BELOW_THRESHOLD。
- [ ] **AC-F-09**: detect_failure_impl 在 success=True 且无失败信号时返回 None。
- [ ] **AC-F-10**: TRIGGER_ACTION_TIER_MATRIX 含 5 个映射，TIMEOUT/RATE_LIMIT -> (RETRY_SAME, 1)。
- [ ] **AC-F-11**: build_fallback_chain 在无候选时构建最小链（仅 Tier 3 DEGRADE_TO_BUILTIN）。
- [ ] **AC-F-12**: build_fallback_chain 在 4 厂商候选时生成 20 个 step（4 × 5 trigger）。
- [ ] **AC-F-13**: execute_fallback_chain 在 RETRY_SAME 步重试 max_retries 次后失败进入 next_step。
- [ ] **AC-F-14**: execute_fallback_chain 在 SWITCH_PROVIDER 步失败进入 next_step。
- [ ] **AC-F-15**: execute_fallback_chain 在 DEGRADE_TO_BUILTIN 步成功时跳出循环。
- [ ] **AC-F-16**: execute_fallback_chain 在 ESCALATE_OPERATOR 步 operator 未响应时进入 next_step。
- [ ] **AC-F-17**: execute_fallback_chain 全部失败时调用 builtin_agent_invoker 兜底。
- [ ] **AC-F-18**: HarnessFallbackChainExecutor.execute 写入 FallbackExecutionRecord 到 F014 灵忆。
- [ ] **AC-F-19**: FallbackConfigLoader 校验 quality_threshold == 0.85，违反触发 ValueError。
- [ ] **AC-F-20**: FallbackExecutionRecord.echo_store_ref 在写入 F014 后填充。

### 5.2 性能验收（Performance AC）

- [ ] **AC-P-01**: detect_failure_impl 单次调用 < 1ms（纯字典查找 + 比较）。
- [ ] **AC-P-02**: build_fallback_chain 在 4 厂商候选下 < 50ms（含 match_for_task + rank + step 生成）。
- [ ] **AC-P-03**: execute_fallback_chain 在无失败场景下 < 100ms（首次调用即成功）。
- [ ] **AC-P-04**: execute_fallback_chain 在 1 次 TIMEOUT 重试后成功场景下 < 200ms。
- [ ] **AC-P-05**: write_record_to_echo_store 单次写入 < 30ms。
- [ ] **AC-P-06**: FallbackConfigLoader.load 加载配置 < 10ms。
- [ ] **AC-P-07**: ESCALATE_OPERATOR 默认超时 300s（operator 响应时间），不阻塞主线程（异步等待）。
- [ ] **AC-P-08**: 全部 fallback 链执行（含 4 厂商 + 内置兜底）< 30s（除 ESCALATE_OPERATOR 外）。

### 5.3 安全验收（Security AC）

- [ ] **AC-S-01**: fallback.py 无直接数据库操作（grep "cursor.execute" 为空）。
- [ ] **AC-S-02**: QUALITY_THRESHOLD 常量定义后不可运行时修改（FallbackConfigLoader 校验）。
- [ ] **AC-S-03**: FallbackExecutionRecord.failure_detail 不含敏感信息（仅含错误摘要）。
- [ ] **AC-S-04**: OperatorNotifier 通知 payload 不含 API key / endpoint / 用户敏感数据。
- [ ] **AC-S-05**: yaml.safe_load 防止 YAML 反序列化攻击。
- [ ] **AC-S-06**: 5 触发 + 5 动作枚举不可扩展，运行时无法注入新触发/动作。
- [ ] **AC-S-07**: Tier 跳级校验防止恢复策略混乱。
- [ ] **AC-S-08**: model_config extra="forbid" 防止 YAML 误加字段污染数据模型。
- [ ] **AC-S-09**: BuiltinAgentInvoker 调用与三方 Adapter 隔离，无权限提升风险。
- [ ] **AC-S-10**: logger 输出不含敏感数据（仅含 trigger / action / tier / provider 等指标）。

### 5.4 Eval 验收（Eval AC）

- [ ] **AC-E-01**: FallbackExecutionRecord 写入 F014 EchoStore 后可在 collection="external_agent_fallback_records" 中查询到。
- [ ] **AC-E-02**: FallbackExecutionRecord.succeeded=True 时 EvalContract.score_fallback_record 返回 0.9。
- [ ] **AC-E-03**: FallbackExecutionRecord.succeeded=False 但 to_provider="builtin" 时返回 0.6。
- [ ] **AC-E-04**: FallbackExecutionRecord.succeeded=False 且 to_provider="operator" 时返回 0.3。
- [ ] **AC-E-05**: FallbackExecutionRecord.action_taken=FAIL_FAST 时返回 0.0。
- [ ] **AC-E-06**: fallback 执行结果通过 Eval 信号回流到 PerformanceLog，total_calls +1。
- [ ] **AC-E-07**: 同一 provider 在 3+ 次同种 trigger 失败后，D035 灵锻可蒸馏出反模式知识。
- [ ] **AC-E-08**: Tier 升级路径严格按 1 -> 2 -> 3 -> 4，跳级被 TierProgressionViolationError 拒绝。

### 5.5 集成测试点（Integration Test Points）

| 测试 ID | 测试场景 | 验证点 |
|---------|---------|--------|
| IT-D034-001 | detect_failure exit_code != 0 | 返回 CRASH |
| IT-D034-002 | detect_failure duration_ms > 30000 | 返回 TIMEOUT |
| IT-D034-003 | detect_failure http_status == 429 | 返回 RATE_LIMIT |
| IT-D034-004 | detect_failure http_status == 500 | 返回 SERVICE_UNAVAILABLE |
| IT-D034-005 | detect_failure quality_score < 0.85 | 返回 QUALITY_BELOW_THRESHOLD |
| IT-D034-006 | detect_failure 无失败信号 | 返回 None |
| IT-D034-007 | build_fallback_chain 无候选 | 返回最小链（仅 Tier 3） |
| IT-D034-008 | build_fallback_chain 4 厂商候选 | 返回 20 step 链，Tier 严格升序 |
| IT-D034-009 | FallbackChain Tier 跳级 | 触发 ValueError |
| IT-D034-010 | execute RETRY_SAME 成功 | succeeded=True，无 next_step |
| IT-D034-011 | execute RETRY_SAME 重试 max_retries 次失败 | 进入 next_step |
| IT-D034-012 | execute SWITCH_PROVIDER 成功 | succeeded=True，to_provider=新厂商 |
| IT-D034-013 | execute DEGRADE_TO_BUILTIN 成功 | succeeded=True，to_provider="builtin" |
| IT-D034-014 | execute ESCALATE_OPERATOR resolved | succeeded=True，to_provider="operator" |
| IT-D034-015 | execute ESCALATE_OPERATOR 未响应 | 进入 next_step |
| IT-D034-016 | execute 全部失败兜底 | 调用 builtin_agent_invoker |
| IT-D034-017 | write_record_to_echo_store | echo_store_ref 填充 |
| IT-D034-018 | FallbackConfigLoader quality_threshold != 0.85 | 触发 ValueError |
| IT-D034-019 | Tier 跳级校验 | 触发 TierProgressionViolationError |
| IT-D034-020 | 单向依赖校验 | fallback.py 无 *Forge 反向 import |

### 5.6 错误处理矩阵

| 错误场景 | 异常类型 | 处理策略 | 上报层级 |
|---------|---------|---------|---------|
| 5 触发枚举运行时新增 | TypeError（枚举不可扩展） | 拒绝 | operator |
| 5 动作枚举运行时新增 | TypeError | 拒绝 | operator |
| Tier 跳级 | ValueError (FallbackChain) | 链构建被拒绝 | operator |
| Tier 升级跳级 | TierProgressionViolationError | 拒绝 | operator |
| quality_threshold 配置 != 0.85 | ValueError | 启动期失败 | operator |
| Adapter 未注册 | AdapterNotFoundError | 跳过该 step | logger.warning |
| Builtin agent 调用失败 | BuiltinAgentError | 全部失败兜底再失败 | logger.error |
| Operator 未响应 | OperatorTimeoutError | 进入 next_step | logger.warning |
| EchoStore 写入失败 | Repository 异常 | 透传到调用方 | logger.error |
| Operator 通知失败 | OperatorNotifier 异常 | 进入 next_step | logger.warning |
| 全部失败（含 builtin） | 无异常 | 返回 succeeded=False 的 record | logger.error |

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../features/F034-external-agent-fallback.md]（同号 Feature 级 SRS）
- [doc:../architecture/A034-external-agent-fallback.md]（同号 Architecture 级 SAD）
- [doc:../features/F022-tier-1-4-recovery.md]（Tier 1-4 恢复分级）
- [doc:../features/F032-external-agent-profile.md]（CapabilityMatcher）
- [doc:../features/F033-external-agent-shared-state.md]（Onboarding 传递）
- [doc:../features/F014-memory-collection.md]（EchoStore 灵忆归档）
- [doc:../features/F018-eval-contract.md]（Eval 信号）
- [doc:../features/F031-external-agent-adapter.md]（Bridge 调用）
- [doc:../features/F035-external-agent-capability-fusion.md]（反模式蒸馏）
- [doc:D031-external-agent-adapter.md]（容器层）
- [doc:D032-external-agent-profile.md]（CapabilityMatcher）
- [doc:D033-external-agent-shared-state.md]（Onboarding 传递）
- [doc:D022-tier-1-4-recovery.md]（Tier 1-4 详细设计）
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（5 触发 + 5 动作 + 决策矩阵 + 失败检测算法 + 链构建算法 + 执行循环 + Tier 1-4 联动 + 质量阈值 0.85 + 灵忆归档 + 反模式蒸馏协作 + 20 功能 AC + 8 性能 AC + 10 安全 AC + 8 Eval AC + 20 集成测试点） | 架构师灵智体（猫头鹰·鲁班） |

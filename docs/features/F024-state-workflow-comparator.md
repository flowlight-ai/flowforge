---
feature_ids: [F024]
related_features: [F021, F022, F023, F025]
topics: [reliability, workflow, state-machine, compensation, idempotency, hybrid]
doc_kind: spec
created: 2026-07-21
---

# F024: Weak State vs Strong Workflow（弱状态 vs 强工作流）

> **状态**: spec | **负责人**: 架构师灵智体 | **优先级**: P0
> **依赖 ADR**: [doc:decisions/010-distributed-reliability.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 第 6 章 分布式可靠性
> **关联 VISION**: [doc:VISION.md#6]（operator 原则第 6 条：支持自己开发自己）

## 1. 上下文

### 1.1 问题陈述

`[doc:roleagent.md#第6章]` 明确："不是'弱状态机 vs 强状态机'二选一。开放协作使用轻量状态机保留模型判断力；严肃副作用使用强 workflow 保证可审计、可回放、可拒绝。" 当前 FlowForge 通用底座没有统一的编排模式选择器——所有多步流程要么全用状态机（副作用不可回滚），要么全用 workflow engine（开放任务判断力被扼杀）。需要一个 `StateWorkflowComparator` 静态分析多步流程的 `WorkflowStep` 列表，输出 `WorkflowStrength` 分级与推荐编排模式。

### 1.2 当前痛点

- 开放协作任务被强 workflow 锁死路径，失去灵智体判断空间
- 严肃副作用用弱状态机，crash 后无法 replay，只能从头重启
- 第三方 API 依赖步骤被盲目 replay，与外部状态去同步
- 没有静态分析工具判断"这个流程该用哪种模式"
- `has_compensation` / `idempotent` / `requires_external_state` 三个关键属性无统一表达

### 1.3 不做的影响

- F021 WAL 的 replay 能力无法被正确分类（强工作流可 replay，弱状态不可）
- F022 Tier 3 Rollback 不知道哪些步骤可补偿
- `[doc:roleagent.md#第6章]` "开放协作用弱状态机，严肃副作用用强 workflow" 双轨主张无法落地
- "自己开发自己"闭环在编排模式选择上靠人工经验，无系统支持

## 2. 决策

### 2.1 核心设计

`StateWorkflowComparator.classify_workflow` 把"弱状态 vs 强工作流"二选一升级为三分法：

- **WorkflowStrength.STRONG**：每步都 `has_compensation=True` 且 `idempotent=True` 且不 `requires_external_state` → 推荐 "use workflow engine"（可重放）
- **WorkflowStrength.WEAK**：无任何步骤可补偿 → 推荐 "use state machine"（仅 checkpoint 重启）
- **WorkflowStrength.HYBRID**：混合 → 推荐 "hybrid"（workflow engine + 非可补偿步骤走状态机检查点）

`WorkflowStep` 数据类的 `requires_external_state` 字段标记第三方 API 依赖——重放会与外部状态去同步，必须显式隔离。STRONG 分类要求三个条件**全部满足**：每步可补偿 AND 全部幂等 AND 无外部状态依赖。`classify_workflow` 拒绝空 `steps` 列表，防止误分类空流程为 STRONG。静态分析与 Liveness 探针联动——`requires_external_state=True` 的步骤同时注册探针，运行时退化触发 ESCALATE。

### 2.2 关键接口

```python
from enum import Enum
from dataclasses import dataclass
from flowforge.core.errors import ReliabilityError
from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.core.reliability.state_workflow")


class WorkflowStrength(str, Enum):
    """多步流程的可恢复性分级。
    STRONG — 每步可补偿 + 幂等 + 不依赖外部状态；全量 replay 安全
    WEAK   — 无任何步骤可补偿；replay 无意义，只能 checkpoint 重启
    HYBRID — 混合；workflow engine + 状态机检查点
    """
    STRONG = "strong"
    WEAK = "weak"
    HYBRID = "hybrid"


@dataclass
class WorkflowStep:
    """多步流程中的单步。
    has_compensation        — 步骤是否可撤销（回滚）？
    idempotent              — crash 后是否可安全重执行？
    requires_external_state — 步骤是否读写 workflow engine 外部状态（如第三方 API）？
                              此类步骤无法安全 replay，需显式隔离。
    """
    name: str
    has_compensation: bool = False
    idempotent: bool = False
    requires_external_state: bool = False


class StateWorkflowComparator:
    """分类 workflow 可恢复性，推荐编排模式。
    分类规则：
    - STRONG  — 每步 has_compensation AND 全部 idempotent AND 无 requires_external_state
    - WEAK    — 无任何步骤 has_compensation
    - HYBRID  — 部分可补偿，部分不可
    """

    def classify_workflow(self, steps: list[WorkflowStep]) -> WorkflowStrength:
        """分类 workflow 强度。
        空 steps 列表抛 ReliabilityError（防止误分类空流程为 STRONG）。
        返回 STRONG / WEAK / HYBRID。
        """

    def recommend_pattern(self, strength: WorkflowStrength) -> str:
        """返回推荐编排模式：
        - STRONG → "use workflow engine"（可重放、可补偿）
        - WEAK   → "use state machine"（checkpoint 重启，无 replay）
        - HYBRID → "hybrid"（workflow engine + 状态机检查点）
        """
```

## 3. 验收标准

### Phase A（分类规则 + 推荐模式）

- [ ] AC-A1: `WorkflowStrength` 三态枚举完整（STRONG / WEAK / HYBRID），字符串值分别为 `strong` / `weak` / `hybrid`
- [ ] AC-A2: `WorkflowStep` 字段完整（name / has_compensation=False / idempotent=False / requires_external_state=False）
- [ ] AC-A3: `classify_workflow` 拒绝空 `steps` 列表，抛 `ReliabilityError`
- [ ] AC-A4: STRONG 分类——每步 `has_compensation=True` AND 全部 `idempotent=True` AND 无 `requires_external_state=True`
- [ ] AC-A5: WEAK 分类——无任何步骤 `has_compensation=True`（`compensatable` 列表为空）
- [ ] AC-A6: HYBRID 分类——部分可补偿，部分不可（`compensatable` 列表非空但未覆盖全部步骤）
- [ ] AC-A7: `recommend_pattern` 返回值：STRONG→"use workflow engine" / WEAK→"use state machine" / HYBRID→"hybrid"
- [ ] AC-A8: STRONG 分类中 `requires_external_state=True` 的步骤会导致降级到 HYBRID 或 WEAK
- [ ] AC-A9: 通过 `core/tracing.get_logger` 写结构化日志（`reliability: classify_workflow ...`），自动注入 `trace_id`

### Phase B（与 WAL/Tier/Liveness 联动 + E2E）

- [ ] AC-B1: STRONG workflow 配合 F021 WAL——crash 后 `list_uncommitted` 拿到 PENDING 条目，幂等重试执行
- [ ] AC-B2: WEAK workflow 不走 replay，仅 checkpoint 重启——与 F022 TIER_4_ESCALATE 协同
- [ ] AC-B3: HYBRID workflow——可补偿步骤走 WAL replay，非可补偿步骤走状态机检查点
- [ ] AC-B4: `requires_external_state=True` 的步骤同时注册 F023 Liveness 探针，运行时退化触发 F022 ESCALATE
- [ ] AC-B5: STRONG workflow 触发 F022 TIER_3_ROLLBACK（副作用可补偿）
- [ ] AC-B6: `classify_workflow` 端到端延迟 < 1ms（纯静态分析，无 I/O）
- [ ] AC-B7: E2E 测试——真实多步流程（如 ContentForge 发布流程：topic → research → writing → seo → factcheck → publish），分类正确，推荐模式与实际编排一致
- [ ] AC-B8: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: 无
- **Related**: F021（STRONG workflow 的 replay 依赖 WAL 终态）、F022（WEAK workflow 触发 TIER_4_ESCALATE，STRONG 触发 TIER_3_ROLLBACK）、F023（`requires_external_state=True` 的步骤注册探针）、F025（外部状态依赖 provider 时，provider failover 由 ProviderHost 处理）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| `classify_workflow` 仅做静态分析，运行时外部状态漂移不被感知 | 与 F023 Liveness 探针联动——`requires_external_state=True` 的步骤同时注册探针 |
| HYBRID 模式实现复杂度高 | P2 阶段先支持 STRONG 与 WEAK，HYBRID 在 P3 阶段补齐 |
| `WorkflowStep` 字段人工标注易错 | code review 强制检查 + 单元测试断言分类结果 |
| 第三方 API 行为变化导致 `idempotent=True` 标注失效 | 探针监控 + TierRecoveryService 退化到 ESCALATE 兜底 |
| STRONG 分类条件过严，实际流程很少达标 | 设计意图即如此——严肃副作用才用强 workflow，开放任务用弱状态机 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | HYBRID 模式下，可补偿步骤与非可补偿步骤如何编排？是否需要 sub-workflow？ | ⬜ 未定 |
| OQ-2 | `requires_external_state` 是否需要细分（读外部 vs 写外部）？ | ⬜ 未定 |
| OQ-3 | 是否支持运行时动态重新分类（如外部 API 突然不可用，STRONG 降级 HYBRID）？ | ⬜ 未定 |
| OQ-4 | `WorkflowStep` 是否需要 `timeout_seconds` 字段？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 三分法（STRONG / WEAK / HYBRID）替代二选一 | `[doc:roleagent.md#第6章]` "开放协作用弱状态机，严肃副作用用强 workflow" 双轨主张 | 2026-07-21 |
| KD-2 | `requires_external_state` 字段标记第三方依赖 | 重放会与外部状态去同步，必须显式隔离 | 2026-07-21 |
| KD-3 | 静态分析 + Liveness 探针联动 | 静态分类不感知运行时漂移，探针补齐运行时信号 | 2026-07-21 |
| KD-4 | `classify_workflow` 拒绝空 steps | 防止误分类空流程为 STRONG | 2026-07-21 |
| KD-5 | STRONG 要求三条件全部满足 | 严肃副作用才用强 workflow，任一条件不满足则降级 | 2026-07-21 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-21 | 立项，确立 Weak State vs Strong Workflow Feature 规格，术语对齐项目正式命名（灵智体 Forgekin） |

## 9. Review Gate

- Phase A: 单元测试通过，`StateWorkflowComparator` 分类规则由架构师灵智体 review
- Phase B: E2E 测试由跨厂商 reviewer 灵智体 review，与 F021/F022/F023 集成正确性、推荐模式与实际编排一致性达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/010-distributed-reliability.md` | 分布式可靠性决策（5 原语之一） |
| **Feature** | `docs/features/F021-side-effect-wal.md` | STRONG workflow replay 依赖 WAL |
| **Feature** | `docs/features/F023-liveness-probe.md` | requires_external_state 步骤注册探针 |
| **代码** | `flowforge/core/reliability/state_workflow.py` | F024 实现 |
| **roleagent** | `docs/roleagent.md#第6章` | 分布式可靠性（弱状态 vs 强工作流） |
| **VISION** | `docs/VISION.md#6` | operator 原则第 6 条（支持自己开发自己） |

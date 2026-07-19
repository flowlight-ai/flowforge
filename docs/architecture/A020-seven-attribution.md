# A020: 七类归因矩阵架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.5]（FR-CORE-005）
> **对应 arch.md**: [doc:../arch.md#§3.5]
> **对应 design.md**: [doc:../design.md#§3.5]（待创建）
> **对应 Feature**: [doc:../features/F020-seven-attribution.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D020-seven-attribution.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/009-eval-self-metabolism.md]
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 架构上下文

### 1.1 架构问题

失败归因的架构问题是"把多层系统拍扁成一维答案"。v7.0 失败归因只能到"agent 没做好"→优化 prompt→换模型，导致三类架构故障：

1. **真根因永远修不到**：如根因是"harness 错位"（如工具边界与任务不匹配），但被拍扁为"agent 没做好"，反复优化 prompt 无效。
2. **修复动作无的放矢**：所有失败都触发"换模型/调 prompt"，缺少按归因类型派发的修复路由。
3. **历史失败无分类检索**：F039 锻典无法按归因类型检索历史失败，相同根因反复出现。

roleagent.md 第 5 章七类归因：**①愿景缺口 ②翻译偏差 ③harness 错位 ④工具缺口 ⑤执行缺口 ⑥环境漂移 ⑦品味落差**。本架构解决的核心问题：**如何在 L3 七类归因矩阵层实现归因形式化、决策树遍历、主次归因输出、修复路由派发，以及"禁止一维拍扁"的硬约束**。

### 1.2 架构约束

- **单向依赖约束**：归因矩阵层依赖 F019 三方信号交叉与 F009 Evidence，禁止被它们反向依赖。
- **七类枚举约束**：归因必须是七类之一，禁止"agent 没做好"等一维答案。
- **决策树约束**：归因必须按"愿景 → 翻译 → harness → 工具 → 执行 → 环境 → 品味"顺序逐层判定，禁止跳层。
- **证据必填约束**：归因必须引用 F009 证据，无证据的归因被拒绝。
- **主次归因约束**：决策树终点为主归因，路径上其他命中为次归因，必须同时输出。

### 1.3 架构影响

- **对 F009 Evidence & Sensors**：归因引用的 evidence_refs 必须来自 F009 已采集证据。
- **对 F019 三方信号交叉**：F019 检测到的信号冲突是归因的触发源。
- **对 F012 Entropy Control**：`harness_misalign` 归因触发 F012 sunset review。
- **对 F039 锻典可检索**：归因结果写入 F039 可检索知识库，按归因类型检索历史失败。
- **对 F040 控制面**：归因统计写入 F040 Eval Hub，作为"哪类根因最频繁"的依据。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F019 SignalCrossValidator  F040 EvalHub  Forgekin                 │
└──────────┬──────────────────────────────────────────────────────────┘
           │ on_conflict(signals) / classify(failure_event)
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L3: AttributionClassifier（七类归因分类器）                          │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ 1. 收集 failure_event + signals + evidence_refs            │  │
│  │ 2. AttributionDecisionTree.traverse()                       │  │
│  │ 3. 输出主归因 + 次归因                                       │  │
│  │ 4. FixRouter.route() 派发修复动作                            │  │
│  │ 5. 写入 F039 可检索知识库                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬──────────────────┬──────────────────┬──────────────────────────┘
    │ classify         │ traverse         │ route
    ▼                  ▼                  ▼
┌────────────┐  ┌────────────────┐  ┌──────────────────┐
│Attribution │  │DecisionTree    │  │ FixRouter        │
│Repository  │  │（7 层判定顺序）│  │（按类型派发）    │
└─────┬──────┘  └────────┬───────┘  └────────┬─────────┘
      │                  │                    │
      ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────┐
│ 七类归因枚举                                          │
│  ①愿景缺口  ②翻译偏差  ③harness错位  ④工具缺口     │
│  ⑤执行缺口  ⑥环境漂移  ⑦品味落差                   │
└─────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：决策树顺序固定而非可配置**。判定顺序固定为"愿景 → 翻译 → harness → 工具 → 执行 → 环境 → 品味"，禁止跳层。理由：roleagent.md 第 5 章硬要求逐层判定，跳层会导致"愿景缺口"被误判为"执行缺口"，真根因被掩盖。
- **决策 2：主归因 + 次归因同时输出**。决策树终点为主归因，路径上其他命中为次归因。理由：单一归因会丢失次要根因，多归因让 F012 sunset review 与 F040 控制面看到完整根因图谱。
- **决策 3：禁止"agent 没做好"一维答案**。归因必须是七类之一，"agent 没做好"等模糊答案在 `classify()` 阶段被拒绝。理由：roleagent.md 第 5 章硬要求"禁止把多层系统拍扁成一维答案"。
- **决策 4：归因必须引用 F009 证据**。evidence_refs 必须非空，无证据的归因被拒绝。理由：归因是无证据的猜测，无法被 F020 后续追溯与验证。
- **决策 5：修复路由按归因类型派发**。`vision_gap → escalate_cvo`、`harness_misalign → trigger_F012_sunset_review`、`tool_gap → extend_tool_boundary` 等，每类有明确路由。理由：避免所有失败都触发"换模型/调 prompt"的无效修复。
- **决策 6：归因结果写入 F039**。归因是 Build to Persist 资产，写入 F039 可检索知识库供未来检索"相同根因如何修复过"。理由：避免相同根因反复出现。

### 2.3 架构不变量

- 归因必须是七类枚举之一，必须禁止"agent 没做好"等一维答案。
- 决策树必须按"愿景 → 翻译 → harness → 工具 → 执行 → 环境 → 品味"顺序判定，必须禁止跳层。
- 归因必须输出主归因 + 次归因，必须禁止只输出主归因。
- 归因必须引用 F009 证据，evidence_refs 必须非空。
- 修复路由必须按归因类型派发，必须禁止所有失败触发同一修复动作。
- 归因结果必须写入 F039 可检索知识库，必须可按归因类型检索。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| AttributionClassifier | `flowforge/core/eval/attribution/classifier.py` | 七类归因分类入口 | `classify` |
| AttributionDecisionTree | `flowforge/core/eval/attribution/decision_tree.py` | 7 层判定决策树 | `traverse` |
| FixRouter | `flowforge/core/eval/attribution/fix_router.py` | 按归因类型派发修复 | `route` |
| AttributionRepository | `flowforge/core/eval/attribution/repository.py` | 持久化归因结果 | 不对上层暴露 |
| AttributionSearchIndex | `flowforge/core/eval/attribution/search_index.py` | 按 type 检索历史归因 | `search_by_type` |
| AttributionConfigLoader | `flowforge/core/eval/attribution/config.py` | YAML 配置加载 | `load_attribution_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class AttributionType(str, Enum):
    VISION_GAP = "vision_gap"
    TRANSLATION_BIAS = "translation_bias"
    HARNESS_MISALIGN = "harness_misalign"
    TOOL_GAP = "tool_gap"
    EXECUTION_GAP = "execution_gap"
    ENVIRONMENT_DRIFT = "environment_drift"
    TASTE_GAP = "taste_gap"


class FailureEvent(BaseModel):
    failure_event_id: str
    forgekin_id: str
    task_id: str
    failure_summary: str
    evidence_refs: list[str] = Field(min_length=1)  # 必须非空
    signal_conflicts: list[str]  # 来自 F019


class Attribution(BaseModel):
    attribution_id: str
    failure_event_id: str
    primary_type: AttributionType
    secondary_types: list[AttributionType] = Field(default_factory=list)
    evidence_refs: list[str] = Field(min_length=1)
    signal_conflicts: list[str]
    root_cause_analysis: str
    suggested_fix: str
    attributed_at: datetime


class FixAction(BaseModel):
    action_type: str  # escalate_cvo / trigger_F012_sunset_review / extend_tool_boundary / ...
    target_module: str
    params: dict


class AttributionClassifier(ABC):
    @abstractmethod
    async def classify(
        self, failure_event: FailureEvent, signals: list
    ) -> Attribution:
        """
        1. 校验 evidence_refs 非空
        2. 调用 DecisionTree.traverse()
        3. 输出主归因 + 次归因
        4. FixRouter.route() 派发修复
        5. 写入 F039
        """


class AttributionDecisionTree(ABC):
    @abstractmethod
    def traverse(
        self, evidence: dict
    ) -> tuple[AttributionType, list[AttributionType]]:
        """
        固定顺序判定：愿景 → 翻译 → harness → 工具 → 执行 → 环境 → 品味
        终点为主归因，路径上其他命中为次归因
        禁止跳层
        """


class FixRouter(ABC):
    @abstractmethod
    def route(self, attribution: Attribution) -> FixAction:
        """
        按归因类型派发：
        vision_gap         → escalate_cvo
        translation_bias   → refactor_prompt
        harness_misalign   → trigger_F012_sunset_review
        tool_gap           → extend_tool_boundary
        execution_gap      → retry_with_hint
        environment_drift  → fix_environment
        taste_gap          → human_review
        """


class AttributionSearchIndex(ABC):
    @abstractmethod
    async def search_by_type(self, attr_type: AttributionType) -> list[Attribution]:
        """按归因类型检索历史归因（写入 F039 可检索知识库）"""
```

### 3.3 数据流

```
[归因触发路径]
  F019 SignalCrossValidator 检测到三方冲突
        │
        ▼
  AttributionClassifier.classify(failure_event, signals)
        │
        ├─ evidence_refs 非空校验 ── 空 ──▶ 抛 ValueError
        │
        ▼
  AttributionDecisionTree.traverse(evidence)
        │
        ├─ Step 1: 愿景对齐检查 ── 不对齐 ──▶ primary=vision_gap
        ├─ Step 2: 任务翻译检查 ── 翻译偏差 ──▶ primary=translation_bias
        ├─ Step 3: harness 适配检查 ── 错位 ──▶ primary=harness_misalign
        ├─ Step 4: 工具齐备检查 ── 缺口 ──▶ primary=tool_gap
        ├─ Step 5: 执行到位检查 ── 缺口 ──▶ primary=execution_gap
        ├─ Step 6: 环境稳定检查 ── 漂移 ──▶ primary=environment_drift
        └─ Step 7: 品味达标检查 ── 落差 ──▶ primary=taste_gap
        │
        ▼
  输出 (primary_type, secondary_types)
        │
        ▼
  FixRouter.route(attribution)
        │
        ├─ vision_gap         → 升级 CVO
        ├─ translation_bias   → 重构提示词
        ├─ harness_misalign   → 触发 F012 sunset review
        ├─ tool_gap           → 扩展工具边界
        ├─ execution_gap      → 带提示重试
        ├─ environment_drift  → 修复环境
        └─ taste_gap          → 人工 review
        │
        ▼
  AttributionRepository.insert()
        │
        ▼
  F039 AttributionSearchIndex 索引（可按 type 检索）

[历史检索路径]
  Forgekin 遇到失败
        │
        ▼
  AttributionSearchIndex.search_by_type(harness_misalign)
        │
        ▼
  返回历史归因列表（含 suggested_fix）
        │
        ▼
  灵智体参考历史修复动作
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F009 Evidence & Sensors**：归因引用的 evidence_refs 来自 F009 已采集证据。
- 依赖 **F019 三方信号交叉**：F019 检测到的信号冲突是归因的触发源。
- 依赖 **F018 Eval Contract**：归因派发的修复动作需对齐契约的 friction_metrics。

### 4.2 下游影响

- 影响 **F012 Entropy Control**：`harness_misalign` 归因触发 F012 sunset review，是 sunset 信号的次级来源。
- 影响 **F039 锻典可检索**：归因结果写入 F039，按归因类型检索历史失败。
- 影响 **F040 控制面**：归因统计写入 F040 Eval Hub，作为"哪类根因最频繁"的依据。
- 影响 **CVO**：`vision_gap` 归因升级到 CVO，CVO 决策保留/退役/升级愿景。
- 影响 **CapabilityProfile（F001）**：`tool_gap` 归因触发 tool_boundary 扩展，更新能力画像。

### 4.3 跨模块不变量

- 归因必须是七类之一，必须禁止一维拍扁。
- 决策树必须按固定顺序判定，必须禁止跳层。
- 归因必须同时输出主归因 + 次归因，必须禁止只输出主归因。
- evidence_refs 必须非空，无证据归因必须被拒绝。
- 修复路由必须按归因类型派发，必须禁止统一修复动作。
- 归因结果必须写入 F039，必须可按归因类型检索。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/eval/attribution/` 不 import F009/F012/F018/F019/F039/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`AttributionClassifier` 通过 `inject("attribution_classifier")` 获取。
- [ ] AC-3: Repository 层通过——归因持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——七类枚举 / 决策树顺序 / 修复路由表从 `config/seven_attribution.yaml` 加载。
- [ ] AC-5: 决策树顺序固定为 7 层，代码中无跳层逻辑（静态扫描确认）。

### 5.2 架构不变量验收

- [ ] AC-6: 归因输出必为七类枚举之一，"agent 没做好"被拒绝（单测覆盖）。
- [ ] AC-7: 决策树按愿景→翻译→harness→工具→执行→环境→品味顺序判定（断言遍历）。
- [ ] AC-8: 归因同时输出主归因 + 次归因，secondary_types 字段非 None。
- [ ] AC-9: evidence_refs 空列表归因被拒绝（单测覆盖）。
- [ ] AC-10: 修复路由按归因类型派发，7 类有 7 个不同路由（单测覆盖）。
- [ ] AC-11: 归因结果写入 F039，可按 type 检索（集成测试覆盖）。

---

## 6. 引用

- [doc:../spec.md#§3.5]
- [doc:../arch.md#§3.5]
- [doc:../features/F009-evidence-sensors.md]
- [doc:../features/F012-entropy-control.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F019-three-signal-cross.md]
- [doc:../features/F020-seven-attribution.md]
- [doc:../features/F039-mind-codex-searchable.md]
- [doc:../features/F040-harness-eval-control-plane.md]
- [doc:../decisions/009-eval-self-metabolism.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 七类枚举 + 决策树固定顺序 + 主次归因 + 修复路由） | 架构师灵智体（猫头鹰·鲁班） |

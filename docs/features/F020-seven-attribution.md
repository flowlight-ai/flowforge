# Feature F020: 七类归因矩阵

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-034] + [doc:roleagent.md#第5章]
> **关联 ADR**: [doc:decisions/009-eval-self-metabolism.md]
> **类型**: eval
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

七类归因矩阵是 roleagent.md 第 5 章的失败根因分类：①愿景缺口 ②翻译偏差 ③harness 错位 ④工具缺口 ⑤执行缺口 ⑥环境漂移 ⑦品味落差。本 Feature 实现七类归因的形式化、归因决策树、归因结果到修复动作的映射，以及"禁止把多层系统拍扁成一维答案"的硬约束。

这是 Build to Persist 基础设施——编码"失败根因分层"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-034]` 指出：roleagent.md 第 5 章七类归因——①愿景缺口②翻译偏差③harness 错位④工具缺口⑤执行缺口⑥环境漂移⑦品味落差。v7.0 失败归因只能到"agent 没做好"→优化 prompt→换模型，把多层系统拍扁成一维答案。导致真正的根因（如 harness 错位）永远修不到。

不做这个 Feature，F019 三方信号交叉的冲突无分类出口，F039 灵典可检索知识库无法按归因类型检索历史失败，F040 控制面无法识别"哪类根因最频繁"。这是 roleagent.md 第 5 章 Eval 自代谢的根因治理。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class AttributionType(str, Enum):
    VISION_GAP = "vision_gap"             # ①愿景缺口
    TRANSLATION_BIAS = "translation_bias"  # ②翻译偏差
    HARNESS_MISALIGN = "harness_misalign"  # ③harness 错位
    TOOL_GAP = "tool_gap"                 # ④工具缺口
    EXECUTION_GAP = "execution_gap"       # ⑤执行缺口
    ENVIRONMENT_DRIFT = "environment_drift"  # ⑥环境漂移
    TASTE_GAP = "taste_gap"               # ⑦品味落差

class Attribution(BaseModel):
    attribution_id: str
    failure_event_id: str
    primary_type: AttributionType          # 主归因
    secondary_types: list[AttributionType]  # 次归因（可多）
    evidence_refs: list[str]               # 证据（F009）
    signal_conflicts: list[str]            # 触发的 F019 信号冲突
    root_cause_analysis: str
    suggested_fix: str
    attributed_at: datetime
```

### 3.2 核心接口

```python
class AttributionClassifier:
    """七类归因分类器"""
    async def classify(self, failure_event: FailureEvent, signals: list[Signal]) -> Attribution: ...

class AttributionDecisionTree:
    """归因决策树（避免一维拍扁）"""
    def traverse(self, evidence: dict) -> tuple[AttributionType, list[AttributionType]]: ...

class FixRouter:
    """归因到修复动作映射"""
    def route(self, attribution: Attribution) -> FixAction: ...
```

### 3.3 关键算法

- **决策树遍历**：按"是否愿景对齐 → 是否任务翻译正确 → 是否 harness 适配 → 是否工具齐备 → 是否执行到位 → 是否环境稳定 → 是否品味达标"逐层判定。
- **主次归因**：决策树终点为主归因，路径上其他命中为次归因。
- **一维拍扁禁止**：禁止只输出"agent 没做好"，必须落到七类之一。
- **修复路由**：vision_gap → 升级 CVO；harness_misalign → 触发 F012 sunset review；tool_gap → 扩展工具边界；其余 → 修复任务。

### 3.4 配置外置（YAML 示例）

```yaml
seven_attribution:
  types: [vision_gap, translation_bias, harness_misalign, tool_gap, execution_gap, environment_drift, taste_gap]
  forbid_one_dimensional_answer: true
  decision_tree_order: [vision, translation, harness, tool, execution, environment, taste]
  fix_routing:
    vision_gap: escalate_cvo
    translation_bias: refactor_prompt
    harness_misalign: trigger_F012_sunset_review
    tool_gap: extend_tool_boundary
    execution_gap: retry_with_hint
    environment_drift: fix_environment
    taste_gap: human_review
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 失败事件必须归因到七类之一，禁止一维拍扁
- [ ] AC-2: 决策树遍历可输出主归因 + 次归因
- [ ] AC-3: 归因必须引用 F009 证据
- [ ] AC-4: 修复路由按归因类型派发对应动作
- [ ] AC-5: 归因结果写入 F039 可检索知识库

## 5. 测试策略

### 5.1 单元测试

- 七类分类、决策树遍历、主次归因、修复路由。

### 5.2 集成测试

- 接入 F009 Evidence & Sensors、F019 三方信号交叉、F039 灵典。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体执行失败任务，采集证据与信号，验证归因落到七类之一并路由修复。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第5章]
- [doc:review/review.md#第八章/RA-034]
- [doc:decisions/009-eval-self-metabolism.md]
- [doc:design/naming-contract.md#2.8]（锻典 Mind Codex）
- [doc:features/F009-evidence-sensors.md]
- [doc:features/F012-entropy-control.md]
- [doc:features/F018-eval-contract.md]
- [doc:features/F019-three-signal-cross.md]
- [doc:features/F039-mind-codex-searchable.md]
- [doc:project_rules.md#T1-T8]

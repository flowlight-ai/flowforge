# Feature F040: Harness Eval 控制面

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-036] + [doc:roleagent.md#第5章]
> **关联 ADR**: [doc:decisions/009-eval-self-metabolism.md]
> **类型**: eval
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

Harness Eval 控制面是 roleagent.md 第 5 章的 Eval 终态：统一 Eval Hub——不是指标看板，而是 harness 生命周期的控制面：哪块机制正在增值 / 折旧 / 需要行动 / 成为瓶颈。本 Feature 实现控制面 API、每日汇总任务、增值/折旧判定、行动建议派发。

这是 Build to Persist 基础设施——编码"harness 生命周期可观测"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-036]` 指出：roleagent.md 终态——统一 Eval Hub（评估中枢）——不是指标看板，而是 harness 生命周期的控制面：哪块机制正在增值/折旧/需要行动/成为瓶颈。v7.0 无此终态规划，每个 eval 线各自维护定时任务，是启动期脚手架，不是终态。

不做这个 Feature，F018 Eval Contract 的契约无统一对比面，F019 三方信号无汇总视图，F020 七类归因无趋势分析，F012 Entropy Control 的 sunset review 无折旧判定依据。这是 roleagent.md 第 5 章 Eval 自代谢的终态控制面。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class HarnessLifecycleState(str, Enum):
    APPRECIATING = "appreciating"        # 增值（产出 > 摩擦）
    DEPRECIATING = "depreciating"        # 折旧（摩擦 > 产出）
    ACTION_NEEDED = "action_needed"      # 需要行动（信号冲突或归因频发）
    BOTTLENECK = "bottleneck"            # 成为瓶颈（持续折旧 + 阻塞其他）
    STABLE = "stable"                    # 稳定

class HarnessComponentStatus(BaseModel):
    component_id: str
    contract_id: str                      # 关联 F018 契约
    lifecycle_state: HarnessLifecycleState
    appreciation_score: float             # 增值分
    friction_score: float                 # 摩擦分
    attribution_distribution: dict[str, int]  # 七类归因分布
    last_action: Optional[str]
    updated_at: datetime
```

### 3.2 核心接口

```python
class ControlPlaneAPI(ABC):
    @abstractmethod
    async def get_status(self, component_id: str) -> HarnessComponentStatus: ...
    @abstractmethod
    async def list_by_state(self, state: HarnessLifecycleState) -> list[HarnessComponentStatus]: ...
    @abstractmethod
    async def trigger_action(self, component_id: str, action: str) -> None: ...

class DailySummarizer:
    """每日汇总任务"""
    async def summarize(self) -> DailySummary: ...

class ActionRecommender:
    """行动建议派发"""
    def recommend(self, status: HarnessComponentStatus) -> list[Action]: ...
```

### 3.3 关键算法

- **增值/折旧判定**：appreciation_score - friction_score > 0 → appreciating；< 0 → depreciating；持续 depreciating 且阻塞其他 → bottleneck。
- **每日汇总**：聚合 F018 契约 + F019 信号 + F020 归因，更新每个组件的 lifecycle_state。
- **行动建议**：depreciating → 触发 F012 sunset review；action_needed → 派发 F020 修复路由；bottleneck → 升级 CVO 重构。
- **趋势分析**：归因分布按时间窗口聚合，识别"哪类根因最频繁"。

### 3.4 配置外置（YAML 示例）

```yaml
harness_eval_control_plane:
  summary_schedule: "0 2 * * *"          # 每日 02:00 汇总
  appreciation_threshold: 0.6
  friction_threshold: 0.4
  bottleneck_consecutive_days: 7
  action_routing:
    depreciating: F012_sunset_review
    action_needed: F020_fix_router
    bottleneck: escalate_cvo_refactor
  dashboard_data_source: control_plane_status
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 控制面 API 可查询组件状态与按状态列表
- [ ] AC-2: 每日汇总任务正确聚合 F018/F019/F020 数据
- [ ] AC-3: 增值/折旧/需要行动/瓶颈四态判定正确
- [ ] AC-4: 行动建议按状态派发对应处理方
- [ ] AC-5: 归因分布趋势可按时间窗口聚合

## 5. 测试策略

### 5.1 单元测试

- 四态判定、每日汇总、行动建议、趋势聚合。

### 5.2 集成测试

- 接入 F012 Entropy Control、F018 Eval Contract、F019 三方信号、F020 七类归因。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体运行一周（加速），验证控制面正确识别一个组件从增值到折旧的转变并派发行动。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第5章]
- [doc:review/review.md#第八章/RA-036]
- [doc:decisions/009-eval-self-metabolism.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F012-entropy-control.md]
- [doc:features/F018-eval-contract.md]
- [doc:features/F019-three-signal-cross.md]
- [doc:features/F020-seven-attribution.md]
- [doc:project_rules.md#T1-T8]

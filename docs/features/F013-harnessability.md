# Feature F013: Harnessability 评估

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-022] + [doc:roleagent.md#第3章]
> **关联 ADR**: [doc:decisions/007-harness-engineering.md]
> **类型**: harness
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

Harnessability 评估回答 roleagent.md 第 3 章的核心问题："不是每个系统都同样适合交给 agent"。本 Feature 实现对外部系统的 Harnessability 评分（稳定 API / 事件流回调 / 持久状态 / 可验证输出 / 操作幂等可回滚 / 权限边界清楚），让灵智体（Forgekin）接入新系统前先评估适配度，避免靠猜和点页面硬跑。

这是 Build to Persist 基础设施——编码"哪些系统值得 harness 投资"的工程判据。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-022]` 指出：roleagent.md 第 3 章提出"不是每个系统都同样适合交给 agent"——有稳定 API、有事件流回调、有持久状态、有可验证输出、操作幂等可回滚、权限边界清楚。v7.0 未对外部系统做 Harnessability 评估，导致接入低 harnessability 系统（如某些无 API 只有页面的发布平台）时 Forgekin 只能靠猜和点页面硬跑。

不做这个 Feature，F032 三方 Agent 能力画像缺少适配度维度，F029 物理 AI 传感器接入无法判别传感器可 harness 程度，F025 跨 provider 宿主抽象缺少"是否值得抽象"的判据。RA-023 低保真矩阵也依赖 Harnessability 评估做"个体补偿 vs 跨 agent 资产"判别。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class HarnessabilityDimension(str, Enum):
    STABLE_API = "stable_api"               # 稳定 API
    EVENT_CALLBACK = "event_callback"       # 事件流回调
    PERSISTENT_STATE = "persistent_state"   # 持久状态
    VERIFIABLE_OUTPUT = "verifiable_output" # 可验证输出
    IDEMPOTENT_ROLLBACK = "idempotent_rollback"  # 幂等可回滚
    CLEAR_PERMISSION = "clear_permission"   # 权限边界清楚

class HarnessabilityScore(BaseModel):
    target_system: str
    scores: dict[HarnessabilityDimension, float]  # 0.0-1.0
    overall: float                       # 加权平均
    low_dimensions: list[HarnessabilityDimension]  # 低于阈值的维度
    recommendation: Literal["full_harness", "partial_harness", "human_in_loop", "skip"]
    assessed_at: datetime
```

### 3.2 核心接口

```python
class HarnessabilityAssessor(ABC):
    @abstractmethod
    async def assess(self, target_system: str) -> HarnessabilityScore: ...

class HarnessDecisionGate:
    """根据评分决定接入策略"""
    def decide(self, score: HarnessabilityScore) -> str: ...
    def require_human_in_loop(self, score: HarnessabilityScore) -> bool: ...
```

### 3.3 关键算法

- **六维评分**：每维度 0.0-1.0，overall = 加权平均（权重可配置）。
- **低维标记**：低于 `dimension_threshold`（默认 0.6）的维度记入 low_dimensions。
- **接入策略**：overall ≥ 0.8 → full_harness；0.5-0.8 → partial_harness；0.3-0.5 → human_in_loop；<0.3 → skip。
- **低保真矩阵**：低 Harnessability 系统的治理规则标记为"个体补偿"（RA-023），不强制注入所有 Forgekin。

### 3.4 配置外置（YAML 示例）

```yaml
harnessability:
  dimensions:
    stable_api: {weight: 0.2, threshold: 0.6}
    event_callback: {weight: 0.15, threshold: 0.6}
    persistent_state: {weight: 0.2, threshold: 0.6}
    verifiable_output: {weight: 0.2, threshold: 0.6}
    idempotent_rollback: {weight: 0.15, threshold: 0.6}
    clear_permission: {weight: 0.1, threshold: 0.6}
  overall_thresholds: {full: 0.8, partial: 0.5, human_in_loop: 0.3}
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 六维评分均可独立打分
- [ ] AC-2: overall 加权平均正确
- [ ] AC-3: 低维标记触发个体补偿治理规则
- [ ] AC-4: 接入策略四档判定正确
- [ ] AC-5: 评分结果写入 F040 控制面供 sunset review 参考

## 5. 测试策略

### 5.1 单元测试

- 六维评分、加权平均、低维标记、四档判定。

### 5.2 集成测试

- 接入 F032 三方 Agent 能力画像、F025 跨 provider 宿主抽象、F040 控制面。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实评估一个低 harnessability 系统（如某发布平台无 API 只有页面），验证推荐 human_in_loop 策略并标记个体补偿。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第3章]
- [doc:review/review.md#第八章/RA-022]
- [doc:review/review.md#第八章/RA-023]（低保真矩阵）
- [doc:decisions/007-harness-engineering.md]
- [doc:design/naming-contract.md#2.12]（能力画像）
- [doc:features/F025-provider-host-abstraction.md]
- [doc:features/F032-external-agent-profile.md]
- [doc:features/F040-harness-eval-control-plane.md]
- [doc:project_rules.md#T1-T8]

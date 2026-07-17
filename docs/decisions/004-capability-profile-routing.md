# ADR 004: 能力画像路由

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师灵智体 + operator 审核
> **依赖**: `[doc:roleagent.md#第0章]` + `[doc:roleagent.md#第1章]` + `[doc:decisions/013-all-things-spirit-mind-vision.md]`
> **依据**: `[doc:review/review.md#第八章]` RA-001~RA-008

---

## 上下文

roleagent.md 第 0 章指出："role-agent 在这张图里处在哪一层？"——给 agent 分配岗位（PM/Dev/Test）是把新物种用旧坐标系测量。agent 不是人类员工，它们可以在一次对话里切换角色、加载任何领域知识、被 eval 数据实时刷新能力边界。

当前 FlowForge 设计中：
- Agent 通过 `default_llm_actors.py` 固定角色（如"你是内容创作者"），违反 roleagent.md 主张
- 没有能力画像（CapabilityProfile）机制
- 路由基于角色而非能力
- 跨厂商 review 不基于盲点画像

operator 指示（2026-07-17）："multi-agent 协作从 role-agent 走向能力画像、动态路由、共享状态、eval 和可靠性治理的工程路径"——必须把 roleagent.md 七大工程路径融入设计。

---

## 决策

### 1. role 是运行时标签，profile 才是长期主体

`[doc:roleagent.md#第0章]`：role 回答"这一步谁负责什么"，profile 回答"为什么是这只 agent"。

- **role**：TeamAct 循环里的运行时状态（owner / verifier / router 等），每次任务可变
- **profile**：长期主体画像（模型固有能力 + 认知风格 + 工具边界 + 历史表现 + 坏直觉 + 当前状态）

### 2. CapabilityProfile 六维度

```python
class CapabilityProfile:
    model_capability: ModelCapability      # 模型固有能力（常量）
    cognitive_style: CognitiveStyle        # 认知风格（常量）
    skill_packages: list[SkillPackage]     # 可加载知识包（变量）
    tool_boundary: ToolBoundary            # 工具边界（变量）
    historical_performance: PerformanceLog # 历史表现（单调积累）
    blind_spots: list[BlindSpot]           # 坏直觉 / 盲点（半常量）
    current_state: AgentState              # 当前状态（瞬时）
```

### 3. 能力画像必须写盲点

`[doc:roleagent.md#题图]`：能力画像不是简历。简历只写优点；画像必须写盲点，因为盲点决定了谁该 review 谁、谁和谁组队会翻车。

```python
class BlindSpot:
    description: str           # 盲点描述
    evidence: list[EvalTrace]  # 证据
    compensation_strategy: str # 补偿策略（如跨厂商 review）
```

### 4. 动态路由基于能力画像

任务路由不再基于固定角色，而是基于能力画像 × 任务画像的匹配度：

```python
class TaskProfile:
    required_capabilities: list[Capability]
    forbidden_blind_spots: list[BlindSpot]
    preferred_cognitive_styles: list[CognitiveStyle]
    tool_requirements: list[Tool]


class CapabilityRouter:
    def route(self, task: TaskProfile, candidates: list[CapabilityProfile]) -> str:
        # 计算每个候选的能力匹配度 × 盲点规避度
        # 返回最佳 forgekin_id
        ...
```

### 5. 跨厂商 review 基于盲点画像

`[doc:roleagent.md#第0章]`：同一家厂商的 agent 共享训练分布的偏差。Claude review Claude 漏掉同一类错误。跨厂商 review 是结构性必需，不是锦上添花。

```python
def select_reviewer(author_profile: CapabilityProfile, candidates: list[CapabilityProfile]) -> str:
    # 选择盲点不重叠的跨厂商 reviewer
    ...
```

### 6. 能力画像 × Harness 契合度

`[doc:roleagent.md#第1章]`：Agent 质量 = 模型能力 × Harness 契合度。

能力画像只有进入具体运行环境后，才会从静态描述变成可验证能力。CapabilityProfile 必须包含 `harness_fit_score` 字段，记录该 agent 在当前 harness 中的契合度。

### 7. 三个可变性层

`[doc:roleagent.md#第0章]`：能力画像维度可变性不同：
- **常量层**：model_capability / cognitive_style / blind_spots（接近模型层常量）
- **变量层**：skill_packages / tool_boundary（可加载）
- **积累层**：historical_performance（单调积累）
- **瞬时层**：current_state（瞬时信号）

---

## 后果

### 正面后果

- agent 不再被固定成"PM/Dev/Test"岗位槽位
- 路由基于能力匹配，提高任务成功率
- 跨厂商 review 基于盲点画像，结构性消除同厂商盲点
- 能力画像可随 eval 数据实时刷新

### 负面后果

- CapabilityProfile 实现复杂度增加（六维度 + 盲点 + 历史表现）
- 路由算法需要计算能力匹配度，增加延迟
- 需要维护能力画像数据库（每个灵智体一份）

### 风险

- 能力画像可能过时（缓解：eval 信号实时刷新）
- 盲点识别可能不准（缓解：跨厂商 review 信号回流）
- 路由算法可能引入偏见（缓解：算法可解释性 + 灵议审查）

---

## 替代方案

### 方案 A: 保持固定角色路由

- 优点：实现简单
- 缺点：违反 roleagent.md 核心主张，无法动态匹配能力
- 未选择原因：operator 明确要求走向能力画像

### 方案 B: 只用模型固有能力做路由

- 优点：实现简单
- 缺点：忽略盲点 / 历史表现 / 当前状态
- 未选择原因：roleagent.md 明确指出"最容易漏掉的，恰恰是常量、历史和瞬时状态这三层"

### 方案 C: 用 LLM 在线判断能力匹配

- 优点：灵活
- 缺点：每次路由都要 LLM 调用，延迟高 + 成本高
- 未选择原因：性能不可接受

---

## 引用

- `[doc:roleagent.md#第0章]` — Role-agent 在这张图里处在哪一层
- `[doc:roleagent.md#第1章]` — 核心公式：能力 × Harness 契合度
- `[doc:features/F001-capability-profile.md]` — 能力画像 Feature
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物灵智体愿景
- `[doc:review/review.md#第八章]` — roleagent 补审 RA-001~RA-008
- `[doc:project_rules.md#红线10]` — 禁止在 flowforge 中写死业务领域代码

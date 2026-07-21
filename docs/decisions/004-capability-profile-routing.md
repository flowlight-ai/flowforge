# ADR 004: 能力画像路由

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: operator + 架构师灵智体
> **依赖**: `[doc:roleagent.md#第0章]` + `[doc:roleagent.md#第1章]` + `[doc:decisions/013-all-things-spirit-mind-vision.md]`
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径

---

## 1. 上下文

`[doc:roleagent.md#第0章]` 指出："role-agent 在这张图里处在哪一层？"——给 agent 分配岗位（PM/Dev/Test）是把新物种用旧坐标系测量。agent 不是人类员工，它们可以在一次对话里切换角色、加载任何领域知识、被 eval 数据实时刷新能力边界。

当前 FlowForge（flowlight-ai/flowforge 新仓库）设计中：
- Agent 通过 `default_llm_actors.py` 固定角色（如"你是内容创作者"），违反 roleagent.md 主张
- 没有能力画像（CapabilityProfile）机制
- 路由基于角色而非能力
- 跨厂商 review 不基于盲点画像

operator 指示（2026-07-17）："multi-agent 协作从 role-agent 走向能力画像、动态路由、共享状态、eval 和可靠性治理的工程路径"——必须把 roleagent.md 七大工程路径融入设计。

本 ADR 是 P0 决策，术语对齐项目正式命名（详见 `[doc:decisions/012-naming-fusion.md]`）。

---

## 2. 决策

### 2.1 role 是运行时标签，profile 才是长期主体

`[doc:roleagent.md#第0章]`：role 回答"这一步谁负责什么"，profile 回答"为什么是这只灵智体"。

- **role**：TeamAct 循环里的运行时状态（owner / verifier / router 等），每次任务可变
- **profile**：长期主体画像（灵印 SoulImprint，含模型固有能力 + 认知风格 + 工具边界 + 历史表现 + 坏直觉 + 当前状态）

### 2.2 CapabilityProfile 六维度

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

### 2.3 能力画像必须写盲点

`[doc:roleagent.md#题图]`：能力画像不是简历。简历只写优点；画像必须写盲点，因为盲点决定了谁该 review 谁、谁和谁组队会翻车。

```python
class BlindSpot:
    description: str           # 盲点描述
    evidence: list[EvalTrace]  # 证据
    compensation_strategy: str # 补偿策略（如跨厂商 review）
```

### 2.4 动态路由基于能力画像

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

### 2.5 跨厂商 review 基于盲点画像

`[doc:roleagent.md#第0章]`：同一家厂商的 agent 共享训练分布的偏差。Claude review Claude 漏掉同一类错误。跨厂商 review 是结构性必需，不是锦上添花。

```python
def select_reviewer(author_profile: CapabilityProfile, candidates: list[CapabilityProfile]) -> str:
    # 选择盲点不重叠的跨厂商 reviewer
    ...
```

### 2.6 能力画像 × Harness 契合度

`[doc:roleagent.md#第1章]`：灵智体质量 = 模型能力 × Harness 契合度。

能力画像只有进入具体运行环境后，才会从静态描述变成可验证能力。CapabilityProfile 必须包含 `harness_fit_score` 字段，记录该灵智体在当前 harness 中的契合度。

### 2.7 三个可变性层

`[doc:roleagent.md#第0章]`：能力画像维度可变性不同：
- **常量层**：model_capability / cognitive_style / blind_spots（接近模型层常量）
- **变量层**：skill_packages / tool_boundary（可加载）
- **积累层**：historical_performance（单调积累，写入灵忆 EchoStore）
- **瞬时层**：current_state（瞬时信号）

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 能力画像六维度 + 动态路由** | 符合 roleagent.md 主张，支持盲点规避，能力画像可随 eval 实时刷新 | 实现复杂度高（六维度 + 盲点 + 历史表现），路由算法增加延迟 |
| 方案 B: 保持固定角色路由 | 实现简单 | 违反 roleagent.md 核心主张，无法动态匹配能力 |
| 方案 C: 只用模型固有能力做路由 | 实现简单 | 忽略盲点 / 历史表现 / 当前状态 |
| 方案 D: 用 LLM 在线判断能力匹配 | 灵活 | 每次路由都要 LLM 调用，延迟高 + 成本高 |

---

## 4. 理由

- operator 明确要求走向能力画像、动态路由、共享状态、eval 和可靠性治理的工程路径
- `[doc:roleagent.md#第0章]` 明确指出"role-agent 是把新物种用旧坐标系测量"，固定角色路由违反核心主张
- `[doc:roleagent.md#第1章]` 公式"能力 × Harness 契合度"要求能力画像必须包含 harness_fit_score
- 盲点画像让跨厂商 review 成为结构性必需，而非锦上添花
- 能力画像可随 eval 信号实时刷新，是灵智体（Forgekin）持续身份的基础

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 能力画像可能过时 | eval 信号实时刷新，灵忆 EchoStore 持续积累 |
| 盲点识别可能不准 | 跨厂商 review 信号回流，七类归因矩阵定位 |
| 路由算法可能引入偏见 | 算法可解释性 + 灵议 MindCouncil 审查 |
| CapabilityProfile 实现复杂度增加 | 分阶段实现：Phase 1 先实现常量层 + 变量层，Phase 4 补齐积累层 |
| 能力画像数据库维护成本 | 每个灵智体一份画像，通过灵印 SoulImprint 持久化 |

---

## 6. 否决理由

- **方案 B（固定角色路由）**：operator 明确要求走向能力画像，且违反 roleagent.md 核心主张
- **方案 C（只用模型固有能力）**：roleagent.md 明确指出"最容易漏掉的，恰恰是常量、历史和瞬时状态这三层"
- **方案 D（LLM 在线判断）**：每次路由都要 LLM 调用，性能不可接受，且无法保证路由一致性

---

## 7. 参与者

- operator（愿景锚点 + 最终决策）
- 架构师灵智体（方案设计 + 术语对齐项目正式命名）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-17 | 初始版本，确立能力画像路由决策，术语对齐项目正式命名（灵忆 EchoStore / 灵印 SoulImprint / 灵议 MindCouncil） | operator + 架构师灵智体 |

---

## 引用

- `[doc:roleagent.md#第0章]` — Role-agent 在这张图里处在哪一层
- `[doc:roleagent.md#第1章]` — 核心公式：能力 × Harness 契合度
- `[doc:features/F001-capability-profile.md]` — 能力画像 Feature
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物灵智体愿景
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表）
- `[doc:project_rules.md#红线10]` — 禁止在 flowforge 中写死业务领域代码

---
feature_ids: [F001]
related_features: [F002, F031]
topics: [capability-profile, routing, blind-spot, forgekin]
doc_kind: spec
created: 2026-07-17
---

# F001: 能力画像 CapabilityProfile

> **状态**: spec | **负责人**: 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/004-capability-profile-routing.md]
> **依赖 Feature**: 无（F001 是基础 Feature）
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径
> **关联 VISION**: [doc:VISION.md#4]（Forgekin相对其他 multi-agent 的核心优势）、[doc:VISION.md#6]（operator 原则第 5 条：命名最终为"ForgeMind"）

## 1. 上下文

### 1.1 问题陈述

flowlight-ai/flowforge 新仓库当前通过 `default_llm_actors.py` 固定角色（如"你是内容创作者"），违反 `[doc:roleagent.md#第0章]` 核心主张："role-agent 是蒸汽马车式误判"——给Forgekin分配岗位（PM/Dev/Test）是把新物种用旧坐标系测量。

需要实现 CapabilityProfile（能力画像）机制，让Forgekin不再被固定成岗位槽位，而是基于能力画像 × 任务画像的动态匹配路由。这是 operator 7 条原则中第 5 条（命名最终为"ForgeMind"，禁止废弃术语）的落地基础——能力画像必须使用SoulImprint / EchoStore 等项目正式术语。

### 1.2 当前痛点

- `default_llm_actors.py` 硬编码"你是内容创作者"（违反编程红线第 10/11 条）
- 路由基于角色而非能力，无法动态匹配
- 跨厂商 review 不基于盲点画像（同厂商Forgekin共享盲点）
- 无历史表现积累机制，Forgekin重启即失忆

### 1.3 不做的影响

- 无法实现 `[doc:roleagent.md]` 七大工程路径
- forgemind 可进化智能体无法动态路由
- 三方 Agent 能力融合无目标画像（F031 阻塞）
- TeamAct 协作无 owner 选择依据（F002 阻塞）

## 2. 决策

### 2.1 核心设计

CapabilityProfile 六维度（对应 `[doc:roleagent.md#第0章]` 三个可变性层）：

- **常量层**：model_capability（模型固有能力）+ cognitive_style（认知风格）+ blind_spots（盲点）
- **变量层**：skill_packages（可加载知识包，注册到 SkillRegistry）+ tool_boundary（工具边界）
- **积累层**：historical_performance（历史表现，写入EchoStore）
- **瞬时层**：current_state（当前状态）

CapabilityProfile 是Forgekin的**长期主体**（SoulImprint），role 是**运行时标签**——每次任务可变，不复用 profile。

### 2.2 关键接口

```python
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class CognitiveStyle(str, Enum):
    """认知风格（常量层）"""
    ANALYTICAL = "analytical"
    CREATIVE = "creative"
    PRACTICAL = "practical"
    HOLISTIC = "holistic"
    DETAIL_ORIENTED = "detail_oriented"


class BlindSpot(BaseModel):
    """盲点（半常量层）— 决定谁该 review 谁"""
    description: str
    evidence: list[str] = Field(default_factory=list)  # Eval trace ID
    compensation_strategy: str  # 补偿策略（如跨厂商 review）
    detected_at: str
    confidence: float = Field(ge=0.0, le=1.0)


class SkillPackage(BaseModel):
    """可加载知识包（变量层）"""
    skill_id: str
    domain: str
    proficiency: float = Field(ge=0.0, le=1.0)
    last_used: Optional[str] = None
    usage_count: int = 0


class ToolBoundary(BaseModel):
    """工具边界（变量层）"""
    allowed_tools: list[str]
    forbidden_tools: list[str] = Field(default_factory=list)
    tool_proficiency: dict[str, float] = Field(default_factory=dict)


class PerformanceLog(BaseModel):
    """历史表现（积累层，写入EchoStore）"""
    total_tasks: int = 0
    success_count: int = 0
    failure_count: int = 0
    avg_quality_score: float = 0.0
    recent_evals: list[str] = Field(default_factory=list)
    wilson_lower_bound: float = 0.0  # 小样本可靠性


class AgentState(str, Enum):
    """当前状态（瞬时层）"""
    IDLE = "idle"
    WORKING = "working"
    WAITING_REVIEW = "waiting_review"
    BLOCKED = "blocked"
    EVOLVING = "evolving"


class ModelCapability(BaseModel):
    """模型固有能力（常量层）"""
    vendor: str
    model_name: str
    context_window: int
    supports_tool_call: bool
    supports_vision: bool = False
    reasoning_capability: float = Field(ge=0.0, le=1.0)
    creativity_capability: float = Field(ge=0.0, le=1.0)


class CapabilityProfile(BaseModel):
    """能力画像 — Forgekin的长期主体（SoulImprint）"""
    forgekin_id: str
    model_capability: ModelCapability
    cognitive_style: CognitiveStyle
    blind_spots: list[BlindSpot] = Field(default_factory=list)
    skill_packages: list[SkillPackage] = Field(default_factory=list)
    tool_boundary: ToolBoundary
    historical_performance: PerformanceLog = Field(default_factory=PerformanceLog)
    current_state: AgentState = AgentState.IDLE
    harness_fit_score: float = Field(default=0.5, ge=0.0, le=1.0)

    def gap_analysis(self, required: "TaskProfile") -> list[str]:
        """分析能力缺口，返回需要扩展的能力列表"""
        ...

    def has_blind_spot_conflict(self, other: "CapabilityProfile") -> bool:
        """检查与另一个Forgekin的盲点是否冲突（用于跨厂商 review 配对）"""
        ...
```

## 3. 验收标准

### Phase A（核心模型 + 路由）

- [ ] AC-A1: CapabilityProfile 六维度可创建并持久化（通过 Repository 层，禁直接操作数据库）
- [ ] AC-A2: CapabilityRouter 基于能力匹配路由（不基于角色），路由算法延迟 < 100ms（10 个候选Forgekin）
- [ ] AC-A3: BlindSpot 必须写入（验证空 blind_spots 列表会报错，禁止只写优点）
- [ ] AC-A4: 跨厂商 review 配对基于盲点不重叠
- [ ] AC-A5: 历史表现可累积（每次任务后更新，Wilson 下界可靠）
- [ ] AC-A6: 能力画像更新必须通过 Eval 信号触发（不能手动改）
- [ ] AC-A7: 替换 `default_llm_actors.py` 硬编码角色

### Phase B（Eval + E2E）

- [ ] AC-B1: 路由正确率 ≥ 85%（基于 Eval 信号）
- [ ] AC-B2: 跨厂商 review 盲点检出率 ≥ 70%
- [ ] AC-B3: E2E 测试 — 创建 5 个不同厂商Forgekin（DeepSeek/Qwen/GLM/Kimi/HunYuan），给定任务画像，验证路由到最佳Forgekin
- [ ] AC-B4: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无（F001 是基础 Feature）
- **Blocked by**: 无
- **Related**: F002（TeamAct owner 选择依赖 F001）、F031（三方 Agent 能力融合依赖 F001）、F008（Durable State Surfaces 用于画像持久化）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 能力画像过时 | Eval 信号实时刷新，EchoStore 持续积累 |
| 盲点识别不准 | 跨厂商 review 信号回流，七类归因矩阵定位 |
| 路由算法偏见 | 算法可解释性 + MindCouncil 审查 |
| 实现复杂度高 | 分阶段：Phase 1 常量+变量层，Phase 4 补齐积累层 |
| 能力画像数据库维护成本 | 每Forgekin一份画像，通过SoulImprint 持久化 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | CapabilityProfile 是否需要支持版本化（每次 Eval 刷新生成新版本）？ | ⬜ 未定 |
| OQ-2 | 路由算法是否需要可插拔（多种路由策略）？ | ⬜ 未定 |
| OQ-3 | 跨厂商 review 配对的最小候选数量（2 个 vs 3 个）？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | role 是运行时标签，profile 是长期主体 | `[doc:roleagent.md#第0章]` 主张 | 2026-07-17 |
| KD-2 | 能力画像必须写盲点 | 盲点决定谁 review 谁，不是简历只写优点 | 2026-07-17 |
| KD-3 | 跨厂商 review 基于盲点不重叠 | 同厂商Forgekin共享训练偏差 | 2026-07-17 |
| KD-4 | 使用项目正式术语（SoulImprint / EchoStore） | operator 原则第 5 条 | 2026-07-17 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-17 | 立项，确立能力画像 Feature 规格，术语对齐项目正式命名 |

## 9. Review Gate

- Phase A: 单元测试 + 集成测试通过，CapabilityProfile 模型 + CapabilityRouter 由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，路由正确率与盲点检出率达标

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/004-capability-profile-routing.md` | 能力画像路由决策 |
| **Feature** | `docs/features/F002-teamact-loop.md` | TeamAct 依赖 F001 选择 owner |
| **Feature** | `docs/features/F031-external-agent-adapter.md` | 三方 Agent 能力融合依赖 F001 |
| **VISION** | `docs/VISION.md#4` | Forgekin相对其他 multi-agent 的核心优势 |
| **VISION** | `docs/VISION.md#6` | operator 原则第 5 条（命名最终为"ForgeMind"） |
| **roleagent** | `docs/roleagent.md#第0章` | role-agent 在哪一层 |
| **roleagent** | `docs/roleagent.md#第1章` | 能力 × Harness 契合度公式 |

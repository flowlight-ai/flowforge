# F001: 能力画像（CapabilityProfile）

> **状态**: ⏳ pending
> **类型**: core
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **依赖 ADR**: [doc:decisions/004-capability-profile-routing.md]
> **依赖 Feature**: 无（F001 是基础 Feature）
> **依据**: [doc:review/review.md#第八章] RA-001~RA-008
> **roleagent 章节**: [doc:roleagent.md#第0章] + [doc:roleagent.md#第1章]
> **关联 VISION**: [doc:VISION.md#4]（Forgekin相对其他 multi-agent 的核心优势）
> **对应 spec.md**: [doc:../spec.md#§3.1]（FR-CORE-001，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.1]（待创建）
> **对应 design.md**: [doc:../design.md#§3.1]（待创建）

---

## 1. 上下文

### 1.1 问题陈述

当前 FlowForge Agent 通过 `default_llm_actors.py` 固定角色（如"你是内容创作者"），违反 roleagent.md 第 0 章核心主张："role-agent 是蒸汽马车式误判"。

需要实现 CapabilityProfile（能力画像）机制，让 agent 不再被固定成岗位槽位，而是基于能力画像 × 任务画像的动态匹配路由。

### 1.2 当前痛点

- `default_llm_actors.py:45` 硬编码"你是内容创作者"（违反编程红线第 10/11 条）
- 路由基于角色而非能力
- 跨厂商 review 不基于盲点画像（同厂商 agent 共享盲点）
- 无历史表现积累机制

### 1.3 不做的影响

- 无法实现 roleagent.md 七大工程路径
- forgemind 可进化智能体无法动态路由
- 三方 Agent 能力融合无目标画像

---

## 2. 决策

### 2.1 核心设计

CapabilityProfile 六维度（对应 roleagent.md 第 0 章三个可变性层）：

```python
class CapabilityProfile:
    """Forgekin能力画像"""
    
    forgekin_id: str                       # Forgekin ID
    model_capability: ModelCapability      # 模型固有能力（常量层）
    cognitive_style: CognitiveStyle        # 认知风格（常量层）
    blind_spots: list[BlindSpot]           # 坏直觉/盲点（半常量层）
    skill_packages: list[SkillPackage]     # 可加载知识包（变量层）
    tool_boundary: ToolBoundary            # 工具边界（变量层）
    historical_performance: PerformanceLog # 历史表现（积累层）
    current_state: AgentState              # 当前状态（瞬时层）
    harness_fit_score: float               # Harness 契合度（0.0-1.0）
```

### 2.2 关键接口

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class CognitiveStyle(str, Enum):
    """认知风格（常量层）"""
    ANALYTICAL = "analytical"       # 分析型
    CREATIVE = "creative"           # 创造型
    PRACTICAL = "practical"         # 实践型
    HOLISTIC = "holistic"           # 整体型
    DETAIL_ORIENTED = "detail_oriented"  # 细节型


class BlindSpot(BaseModel):
    """盲点（半常量层）"""
    description: str                # 盲点描述
    evidence: list[str] = Field(default_factory=list)  # 证据（Eval trace ID）
    compensation_strategy: str      # 补偿策略
    detected_at: str                # 检测时间
    confidence: float = Field(ge=0.0, le=1.0)  # 置信度


class SkillPackage(BaseModel):
    """可加载知识包（变量层）"""
    skill_id: str
    domain: str                     # 领域
    proficiency: float = Field(ge=0.0, le=1.0)  # 熟练度
    last_used: Optional[str] = None
    usage_count: int = 0


class ToolBoundary(BaseModel):
    """工具边界（变量层）"""
    allowed_tools: list[str]        # 允许调用的工具
    forbidden_tools: list[str] = Field(default_factory=list)
    tool_proficiency: dict[str, float] = Field(default_factory=dict)


class PerformanceLog(BaseModel):
    """历史表现（积累层）"""
    total_tasks: int = 0
    success_count: int = 0
    failure_count: int = 0
    avg_quality_score: float = 0.0
    recent_evals: list[str] = Field(default_factory=list)  # 最近 Eval ID
    wilson_lower_bound: float = 0.0  # Wilson 下界（小样本可靠性）


class AgentState(str, Enum):
    """当前状态（瞬时层）"""
    IDLE = "idle"
    WORKING = "working"
    WAITING_REVIEW = "waiting_review"
    BLOCKED = "blocked"
    EVOLVING = "evolving"


class ModelCapability(BaseModel):
    """模型固有能力（常量层）"""
    vendor: str                     # 厂商（anthropic/openai/google/...）
    model_name: str
    context_window: int             # 上下文窗口
    supports_tool_call: bool
    supports_vision: bool = False
    reasoning_capability: float = Field(ge=0.0, le=1.0)
    creativity_capability: float = Field(ge=0.0, le=1.0)


class CapabilityProfile(BaseModel):
    """能力画像 — Forgekin的长期主体画像"""
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
        gaps = []
        # 实现略
        return gaps
    
    def has_blind_spot_conflict(self, other: "CapabilityProfile") -> bool:
        """检查与另一个Forgekin的盲点是否冲突"""
        # 用于跨厂商 review 配对
        ...
```

### 2.3 关键不变量

- CapabilityProfile 是**长期主体**，跨 session 持续
- role 是**运行时标签**，每次任务可变（不复用 profile）
- 盲点必须写入（不只写优点）
- 历史表现只能积累，不能回退

---

## 3. 实现路径

### 3.1 代码位置

- `flowforge/core/capability/profile.py` — CapabilityProfile 数据模型
- `flowforge/core/capability/router.py` — CapabilityRouter 路由器
- `flowforge/core/capability/blind_spot.py` — BlindSpot 检测器
- `flowforge/core/capability/storage.py` — 能力画像存储（Repository 层）
- `flowforge/core/capability/tests/test_profile.py` — 单元测试

### 3.2 实现步骤

1. 定义 Pydantic 数据模型（profile.py）
2. 实现 CapabilityRouter.route 路由算法
3. 实现 BlindSpot 检测器（基于 Eval 信号）
4. 实现能力画像存储（Repository 层，禁直操作数据库）
5. 替换 `default_llm_actors.py` 硬编码角色
6. 集成到 ForgekinEngine

### 3.3 依赖关系

- 依赖 ADR 004（能力画像路由决策）
- 被 F002 TeamAct 依赖（用于选择 owner）
- 被 F031 三方 Agent Adapter 依赖（用于 gap_analysis）

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: CapabilityProfile 可创建并持久化
- [ ] AC-2: CapabilityRouter 基于能力匹配路由（不基于角色）
- [ ] AC-3: BlindSpot 必须写入（验证空 blind_spots 列表会报错）
- [ ] AC-4: 跨厂商 review 配对基于盲点不重叠
- [ ] AC-5: 历史表现可累积（每次任务后更新）

### 4.2 性能验收

- [ ] AC-6: 路由算法延迟 < 100ms（10 个候选Forgekin）

### 4.3 安全验收

- [ ] AC-7: 能力画像通过 Repository 层存储（禁直操作数据库）
- [ ] AC-8: 能力画像更新必须通过 Eval 信号触发

### 4.4 Eval 验收

- [ ] AC-9: 路由正确率 ≥ 85%（基于 Eval 信号）
- [ ] AC-10: 跨厂商 review 盲点检出率 ≥ 70%

---

## 5. 测试计划

### 5.1 单元测试

- 测试 CapabilityProfile 创建/序列化
- 测试 CapabilityRouter 路由算法
- 测试 BlindSpot 检测
- 测试 Wilson 下界计算

### 5.2 集成测试

- 测试能力画像存储到 SQLite（通过 Repository）
- 测试 ForgekinEngine 集成能力画像

### 5.3 E2E 测试

- 创建 5 个不同厂商的Forgekin（DeepSeek/Qwen/GLM/Kimi/HunYuan）
- 给定任务画像，验证路由到最佳Forgekin
- 验证跨厂商 review 配对盲点不重叠
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 跨厂商 reviewer Forgekin（非作者）
- 自动探针（路由正确率检测）

### 6.2 评估什么

- 路由正确率（被路由的Forgekin是否适合任务）
- 盲点检出率（同厂商盲点是否被跨厂商 review 发现）
- 历史表现积累有效性（Wilson 下界是否可靠）

### 6.3 何时评估

- 每次任务完成后
- 每周汇总路由正确率

### 6.4 评估信号

- trace 信号：路由决策日志
- 用户信号：任务成功/失败反馈
- 探针信号：定期跑路由基准测试

### 6.5 评估后做什么

- 通过 → 持续累积历史表现
- 失败 → 归因到七类矩阵（通常是 harness 错位或模型盲点）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：**Built to Persist（复利型基础设施）**

### 7.2 理由

能力画像是 roleagent.md 第 1 章"Built to Persist"明确列出的复利型基础设施（agent 交接协议与路由）。模型越强，能力画像越值钱——因为画像编码的是 agent 与外部现实的关系，不是补模型缺陷。

### 7.3 sunset 触发条件

无（基础设施永久维护）。但具体实现细节（如路由算法）可能随模型升级而调整。

---

## 8. 后果

### 8.1 正面后果

- agent 不再被固定成岗位槽位
- 路由基于能力匹配，提高任务成功率
- 跨厂商 review 结构性消除同厂商盲点

### 8.2 负面后果

- 实现复杂度增加
- 路由算法延迟（缓解：缓存 + 预计算）

### 8.3 风险

- 能力画像过时（缓解：Eval 信号实时刷新）
- 路由算法偏见（缓解：可解释性 + MindCouncil 审查）

---

## 9. 替代方案

### 9.1 方案 A: 保持固定角色

- 优点：零工作量
- 缺点：违反 roleagent.md 主张
- 未选择原因：operator 明确要求

### 9.2 方案 B: 用 LLM 在线判断

- 优点：灵活
- 缺点：延迟高 + 成本高
- 未选择原因：性能不可接受

---

## 10. 引用

- [doc:roleagent.md#第0章]
- [doc:roleagent.md#第1章]
- [doc:decisions/004-capability-profile-routing.md]
- [doc:VISION.md#4]
- [doc:project_rules.md#红线10]
- [doc:project_rules.md#红线12]

---

## 11. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-17 | v0.1 | 初始创建 | 架构师 Forgekin |

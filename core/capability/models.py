"""CapabilityProfile data models — Forgekin能力画像数据模型。

本模块定义 CapabilityProfile 六维度（对应 roleagent.md 第 0 章三个可变性层）：
    - 常量层：ModelCapability / CognitiveStyle / BlindSpot
    - 变量层：SkillPackage / ToolBoundary
    - 积累层：PerformanceLog
    - 瞬时层：AgentState
    - 契合度层：HarnessFitScore

设计依据：
    - F001-capability-profile.md §2.1
    - ADR 004 §2（六个维度）
    - roleagent.md §1（能力 × Harness 契合度公式）

铁律遵守：
    - 铁律 3：模型仅声明依赖，不在构造期直接实例化外部服务
    - 铁律 5：无硬编码路径/密钥
    - 编程红线 9：使用组合（Pydantic 字段）而非继承表达六维度

License: MIT
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field, field_validator


# ──────────────────────────────────────────────────────────────────────────────
# 常量层：模型固有能力 + 认知风格 + 盲点
# ──────────────────────────────────────────────────────────────────────────────


class ModelCapability(BaseModel):
    """模型固有能力（常量层）。

    描述底层 LLM 厂商与模型的固有属性，跨 session 不变。
    对应 roleagent.md §1.2 权重状态层（厂商控制）。

    Attributes:
        provider: 模型厂商标识（anthropic / openai / google / deepseek / ...）。
            用于跨厂商 review 配对的厂商判别。
        model_name: 模型名称（如 claude-sonnet-4 / gpt-5 / gemini-2-pro）。
        context_window: 上下文窗口大小（token 数）。
        strengths: 模型擅长能力列表（如 code_generation / long_context_reasoning）。
        limitations: 模型已知能力限制列表（如 math_computation / vision）。
        supports_tool_call: 是否原生支持工具调用。
        supports_vision: 是否支持多模态视觉输入。
        reasoning_capability: 推理能力评分（0.0-1.0）。
        creativity_capability: 创造力评分（0.0-1.0）。
    """

    provider: str = Field(..., description="模型厂商标识")
    model_name: str = Field(..., description="模型名称")
    context_window: int = Field(..., gt=0, description="上下文窗口大小（token）")
    strengths: list[str] = Field(default_factory=list, description="模型擅长能力列表")
    limitations: list[str] = Field(default_factory=list, description="已知能力限制列表")
    supports_tool_call: bool = Field(default=True, description="是否支持工具调用")
    supports_vision: bool = Field(default=False, description="是否支持视觉输入")
    reasoning_capability: float = Field(
        default=0.5, ge=0.0, le=1.0, description="推理能力评分"
    )
    creativity_capability: float = Field(
        default=0.5, ge=0.0, le=1.0, description="创造力评分"
    )


class CognitiveStyle(BaseModel):
    """认知风格（常量层）。

    描述Forgekin在推理 / 抽象 / 风险 / 解释四个维度的认知偏好。
    对应 roleagent.md §0：profile 描述"为什么是这只 agent"。

    Attributes:
        reasoning_depth: 推理深度倾向（0.0 浅层直觉 → 1.0 深度链式推理）。
        abstraction_level: 抽象层级偏好（0.0 具体实例 → 1.0 抽象建模）。
        risk_appetite: 风险偏好（0.0 保守稳健 → 1.0 激进尝试）。
        explanation_style: 解释风格枚举（structured / narrative / concise / verbose）。
    """

    reasoning_depth: float = Field(
        default=0.5, ge=0.0, le=1.0, description="推理深度倾向"
    )
    abstraction_level: float = Field(
        default=0.5, ge=0.0, le=1.0, description="抽象层级偏好"
    )
    risk_appetite: float = Field(
        default=0.5, ge=0.0, le=1.0, description="风险偏好"
    )
    explanation_style: str = Field(
        default="structured",
        description="解释风格：structured / narrative / concise / verbose",
    )

    @field_validator("explanation_style")
    @classmethod
    def _validate_style(cls, v: str) -> str:
        allowed = {"structured", "narrative", "concise", "verbose"}
        if v not in allowed:
            raise ValueError(
                f"explanation_style must be one of {allowed}, got '{v}'"
            )
        return v


class BlindSpotCategory(str, Enum):
    """盲点类别枚举（用于跨厂商 review 配对的类别判别）。

    同类别盲点 + 同厂商 → 冲突 → 必须跨厂商 review。
    """

    SELF_REFERENTIAL_LOGIC = "self_referential_logic"
    MATH_COMPUTATION = "math_computation"
    TEMPORAL_REASONING = "temporal_reasoning"
    SPATIAL_REASONING = "spatial_reasoning"
    COUNTERFACTUAL = "counterfactual"
    EDGE_CASE_BLINDNESS = "edge_case_blindness"
    HALLUCINATION_PRONE = "hallucination_prone"
    OVER_CONFIDENCE = "over_confidence"
    CONTEXT_COMPRESSION_LOSS = "context_compression_loss"
    OTHER = "other"


class BlindSpot(BaseModel):
    """盲点（半常量层）。

    能力画像不是简历——必须写盲点。盲点决定谁该 review 谁、谁和谁组队会翻车。
    对应 ADR 004 §3："能力画像必须写盲点"。

    Attributes:
        category: 盲点类别（用于跨厂商 review 配对）。
        description: 盲点描述。
        example: 触发盲点的具体示例。
        scenario: 该盲点最容易暴露的场景（如 code_review / math_proof）。
        detected_at: 检测时间（ISO 8601 字符串）。
        evidence: 证据 trace ID 列表（Eval 信号）。
        compensation_strategy: 补偿策略（如跨厂商 review / 工具交叉验证）。
        confidence: 置信度（0.0-1.0）。
    """

    category: BlindSpotCategory = Field(..., description="盲点类别")
    description: str = Field(..., description="盲点描述")
    example: Optional[str] = Field(default=None, description="触发盲点的示例")
    scenario: Optional[str] = Field(default=None, description="易暴露场景")
    detected_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="检测时间 ISO 8601",
    )
    evidence: list[str] = Field(default_factory=list, description="证据 trace ID 列表")
    compensation_strategy: str = Field(
        default="cross_vendor_review", description="补偿策略"
    )
    confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="置信度"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 变量层：可加载知识包 + 工具边界
# ──────────────────────────────────────────────────────────────────────────────


class SkillPackage(BaseModel):
    """可加载知识包（变量层）。

    描述Forgekin可动态加载的领域知识包。对应 roleagent.md §4.3 L3 Skill 层。

    Attributes:
        name: 知识包名称（唯一标识）。
        domain: 所属领域（如 programming / finance / medicine）。
        version: 知识包版本。
        loader: 加载器标识（如模块路径 "flowforge.skills.PythonAsyncLoader"）。
        load_fn: 可选的加载回调函数（运行时注入，不参与序列化）。
        proficiency: 熟练度（0.0-1.0）。
        last_used: 上次使用时间 ISO 8601（None 表示未使用过）。
        usage_count: 累计使用次数。
    """

    name: str = Field(..., description="知识包名称")
    domain: str = Field(..., description="所属领域")
    version: str = Field(default="0.1.0", description="知识包版本")
    loader: Optional[str] = Field(default=None, description="加载器标识")
    load_fn: Optional[Callable[..., Any]] = Field(
        default=None,
        exclude=True,
        description="加载回调函数（运行时注入，不序列化）",
    )
    proficiency: float = Field(
        default=0.5, ge=0.0, le=1.0, description="熟练度"
    )
    last_used: Optional[str] = Field(default=None, description="上次使用时间 ISO 8601")
    usage_count: int = Field(default=0, ge=0, description="累计使用次数")


class ToolBoundary(BaseModel):
    """工具边界（变量层）。

    描述Forgekin可调用工具的允许 / 禁止 / 偏好集合。
    对应 roleagent.md §3.2 Tool Mediation 层。

    Attributes:
        allowed_tools: 允许调用的工具列表（白名单）。
        forbidden_tools: 禁止调用的工具列表（黑名单，优先级高于白名单）。
        prefer_tools: 优先使用的工具列表（同等条件下优先选择）。
        tool_proficiency: 工具熟练度映射 {tool_name: proficiency 0.0-1.0}。
    """

    allowed_tools: list[str] = Field(default_factory=list, description="允许工具白名单")
    forbidden_tools: list[str] = Field(default_factory=list, description="禁止工具黑名单")
    prefer_tools: list[str] = Field(default_factory=list, description="优先工具列表")
    tool_proficiency: dict[str, float] = Field(
        default_factory=dict, description="工具熟练度映射"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 积累层：历史表现
# ──────────────────────────────────────────────────────────────────────────────


class PerformanceLog(BaseModel):
    """历史表现日志条目（积累层）。

    按任务类型分类记录历史表现，单调积累，不可回退。
    对应 roleagent.md §4 消费加权排序的输入信号。

    Attributes:
        task_type: 任务类型（如 code_generation / article_writing / review）。
        success_rate: 成功率（0.0-1.0）。
        avg_latency: 平均延迟（秒）。
        token_usage: 累计 token 消耗。
        last_updated: 最后更新时间 ISO 8601。
        sample_count: 样本数（用于 Wilson 下界可靠性判断）。
        wilson_lower_bound: Wilson 下界（小样本可靠性，0.0-1.0）。
    """

    task_type: str = Field(..., description="任务类型")
    success_rate: float = Field(default=0.0, ge=0.0, le=1.0, description="成功率")
    avg_latency: float = Field(default=0.0, ge=0.0, description="平均延迟（秒）")
    token_usage: int = Field(default=0, ge=0, description="累计 token 消耗")
    last_updated: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="最后更新时间 ISO 8601",
    )
    sample_count: int = Field(default=0, ge=0, description="样本数")
    wilson_lower_bound: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Wilson 下界"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 瞬时层：当前状态
# ──────────────────────────────────────────────────────────────────────────────


class AgentState(BaseModel):
    """Forgekin当前状态（瞬时层）。

    跨推理调用的瞬时信号，单 session 内可变。
    对应 roleagent.md §1.2 计算状态 + 现实状态层。

    Attributes:
        current_load: 当前负载（0.0 空闲 → 1.0 满载）。
        fatigue: 疲劳度（0.0 清醒 → 1.0 极度疲劳）。
        mood: 当前情绪标签（focused / tired / stressed / fresh）。
        active_tasks: 当前活跃任务数。
        last_break: 上次休息时间 ISO 8601。
    """

    current_load: float = Field(default=0.0, ge=0.0, le=1.0, description="当前负载")
    fatigue: float = Field(default=0.0, ge=0.0, le=1.0, description="疲劳度")
    mood: str = Field(default="focused", description="情绪标签")
    active_tasks: int = Field(default=0, ge=0, description="活跃任务数")
    last_break: Optional[str] = Field(default=None, description="上次休息时间 ISO 8601")

    @field_validator("mood")
    @classmethod
    def _validate_mood(cls, v: str) -> str:
        allowed = {"focused", "tired", "stressed", "fresh", "neutral"}
        if v not in allowed:
            raise ValueError(
                f"mood must be one of {allowed}, got '{v}'"
            )
        return v


# ──────────────────────────────────────────────────────────────────────────────
# 契合度层：Harness 契合度
# ──────────────────────────────────────────────────────────────────────────────


class HarnessFitScore(BaseModel):
    """Harness 契合度评分（契合度层）。

    对应 roleagent.md §1 核心公式：Agent 质量 = 模型能力 × Harness 契合度。
    能力画像只有进入具体运行环境后，才会从静态描述变成可验证能力。

    Attributes:
        overall: 总体契合度（0.0-1.0）。
        durable_state: 持久状态面契合度（Durable State Surfaces, F008）。
        tool_mediation: 工具中介契合度（Tool Mediation）。
        governance: 治理边界契合度（Governance Boundary, F010）。
        retrieval: 检索入口契合度（Three Retrieval Entry, F015）。
        observability: 可观测性契合度（Observability）。
    """

    overall: float = Field(default=0.5, ge=0.0, le=1.0, description="总体契合度")
    durable_state: float = Field(
        default=0.5, ge=0.0, le=1.0, description="持久状态面契合度"
    )
    tool_mediation: float = Field(
        default=0.5, ge=0.0, le=1.0, description="工具中介契合度"
    )
    governance: float = Field(
        default=0.5, ge=0.0, le=1.0, description="治理边界契合度"
    )
    retrieval: float = Field(default=0.5, ge=0.0, le=1.0, description="检索入口契合度")
    observability: float = Field(
        default=0.5, ge=0.0, le=1.0, description="可观测性契合度"
    )

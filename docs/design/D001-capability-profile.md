# D001: 能力画像（CapabilityProfile）详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 开发者 Forgekin（猎犬·夏洛克）
> **对应 spec.md**: [doc:../spec.md#§3.1]（FR-CORE-001）
> **对应 arch.md**: [doc:../arch.md#§3.1]
> **对应 design.md**: [doc:../design.md#§3.1]
> **对应 Feature**: [doc:../features/F001-capability-profile.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A001-capability-profile.md]（同号 Feature 级 SAD）
> **依赖 ADR**: [doc:../decisions/004-capability-profile-routing.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

A001 已给出 CapabilityProfile 的架构契约（六维 + 五可变性层 + harness_fit_score + 盲点不重叠），但未落到代码层。本详细设计在代码层解决以下问题：

1. **数据模型如何同时承载"常量/半常量/变量/累积/瞬时"五可变性层而不混乱**：单一 Pydantic 模型字段众多，缺乏可变性标记会导致更新策略误用
2. **路由算法延迟 < 100ms（10 候选，P99）如何在 Python 中实现**：纯 LLM 在线判断不可行，必须基于本地向量匹配 + Wilson 下界预计算
3. **盲点冲突判定（跨厂商 review 配对）的语义如何形式化**：A001 只给出 `overlap_score < 0.3`，未定义 overlap_score 的计算口径
4. **能力画像更新与 Eval 信号回流如何解耦**：直接在 Eval 完成时同步更新画像会导致 Eval 流程被画像写入阻塞
5. **ExternalAgentProfile（F031）融合到 CapabilityProfile 时如何保留厂商溯源**：不可降级为"内部能力"，否则三方 Agent 失去监管
6. **Build to Delete vs Built to Persist 半衰期如何在 Schema 层标记**：A001 决策 6 提出但未落地到字段

### 1.2 设计约束

- **Python 3.11+ 强制类型注解**：所有 public 接口必须带类型注解（编程红线 + rules.md 第二部分）
- **Pydantic v2 BaseModel**：所有数据结构基于 Pydantic v2，校验器使用 `@field_validator` / `@model_validator`
- **async/await 强制**：所有 I/O 操作（DB 读写 / EventBus / LLMClient）必须 async
- **DI 容器注入**：CapabilityRouter / CapabilityRepository / BlindSpotDetector 通过 `flowforge/core/plugin/di_container.py` 注入，禁直接实例化
- **Repository 层抽象**：所有 SQLite 读写通过 `CapabilityRepository` 抽象基类，禁 `cursor.execute("INSERT INTO capability_profiles...")`
- **配置外置**：路由权重 / 阈值 / 维度配置外置到 `flowforge/config/capability.yaml`
- **日志注入 trace_id**：所有日志通过 `core/tracing.py` 的 `get_logger`，自动注入 `trace_id`
- **提示词外置**：盲点检测/路由解释的提示词外置到 `flowforge/config/capability_prompts.yaml`，禁 .py 文件硬编码
- **单向依赖**：`flowforge/core/capability/` 只能 import `core/interfaces/` 与共享内核，禁 import forgemind / *Forge

### 1.3 设计影响

- **对 A002 TeamAct Loop**：Owner 步直接调用 `CapabilityRouter.route(task, candidates)`，路由算法延迟决定 TeamAct 启动延迟
- **对 A003 Handoff Capsule**：`BlindSpotHintInjector` 读取 `CapabilityProfile.blind_spots` 自动注入到胶囊
- **对 A007 Push Back**：Push Back 提交时调用 `CapabilityProfile.has_blind_spot_conflict(reviewer, author)` 判定是否是 reviewer 盲点 vs author 盲点
- **对 A018 Eval Contract**：`CapabilityRepository.update_performance(forgekin_id, eval_signal)` 是 Eval 信号回流到画像的唯一入口
- **对 A031 ExternalAgentAdapter**：`ExternalAgentProfile` 融合到 `CapabilityProfile.skill_packages`，标记 `source = "external"`
- **对 A028 ForgePipeline**：第 2 步"能力注入"调用 `CapabilityProfile` 构造器，初始化常量层

---

## 2. 详细设计

### 2.1 类图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        flowforge/core/capability/                       │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                       CapabilityProfile                         │  │
│   │  (Pydantic Model, 五可变性层)                                   │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + forgekin_id: str                                             │  │
│   │  + model_capability: ModelCapability     [常量层]               │  │
│   │  + cognitive_style: CognitiveStyle       [常量层]               │  │
│   │  + blind_spots: list[BlindSpot]          [半常量层, 非空]       │  │
│   │  + skill_packages: list[SkillPackage]    [变量层]               │  │
│   │  + tool_boundary: ToolBoundary           [变量层]               │  │
│   │  + historical_performance: PerformanceLog [累积层]              │  │
│   │  + current_state: AgentState             [瞬时层]               │  │
│   │  + harness_fit_score: float              [0.0-1.0]              │  │
│   │  + decay_tag: DecayTag                   [Build to Delete 标记] │  │
│   │  + schema_version: str = "1.0"                                 │  │
│   │  ─────────────────────────────────────────────────────────────  │  │
│   │  + gap_analysis(required: TaskProfile) -> list[str]             │  │
│   │  + has_blind_spot_conflict(other) -> bool                       │  │
│   │  + mutate_field(field, value, mutability_layer) -> Self         │  │
│   └──────────────┬───────────────────────────────┬───────────────────┘  │
│                  │                               │                      │
│                  ▼                               ▼                      │
│   ┌──────────────────────────┐    ┌──────────────────────────────┐     │
│   │   CapabilityRouter       │    │   BlindSpotDetector          │     │
│   │   (ABC + Default Impl)   │    │   (ABC + LLMBacked Impl)     │     │
│   │  ──────────────────────  │    │  ──────────────────────────  │     │
│   │  + route(task,           │    │  + detect(forgekin_id,       │     │
│   │    candidates) ->        │    │    eval_history) ->          │     │
│   │    RoutingDecision       │    │    list[BlindSpot]           │     │
│   │  - _compute_skill_match  │    │  + check_overlap(author_id,  │     │
│   │  - _compute_blind_avoid │    │    reviewer_id) ->            │     │
│   │  - _compute_wilson_lb   │    │    BlindSpotOverlapReport     │     │
│   │  - _compute_harness_fit │    │  - _llm_classify_blind_spot  │     │
│   └──────────┬───────────────┘    └──────────────┬───────────────┘     │
│              │                                   │                     │
│              ▼                                   ▼                     │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │           CapabilityRepository (ABC)                         │     │
│   │  + save(profile) -> profile_id                               │     │
│   │  + load(forgekin_id) -> Optional[CapabilityProfile]          │     │
│   │  + update_performance(forgekin_id, eval_signal) -> None      │     │
│   │  + list_by_capability(required) -> list[CapabilityProfile]   │     │
│   │  + bulk_upsert(profiles) -> int                              │     │
│   └──────────────────────────────┬───────────────────────────────┘     │
│                                  ▼                                     │
│            ┌─────────────────────────────────────────┐                 │
│            │  SqliteCapabilityRepository             │                 │
│            │  (infra/repo/sqlite_capability_repo.py) │                 │
│            │  + WAL 持久化                           │                 │
│            │  + 索引: forgekin_id, vendor            │                 │
│            └─────────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 接口实现

```python
# flowforge/core/capability/router.py
"""能力画像路由器 — 基于 capability × task 匹配度路由"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional
from datetime import datetime

from pydantic import BaseModel, Field

from flowforge.core.capability.profile import (
    CapabilityProfile,
    TaskProfile,
    RoutingDecision,
)
from flowforge.core.tracing import get_logger
from flowforge.core.plugin.di_container import inject

logger = get_logger(__name__)


class CapabilityRouter(ABC):
    """能力画像路由器 ABC"""

    @abstractmethod
    async def route(
        self,
        task: TaskProfile,
        candidates: list[CapabilityProfile],
    ) -> RoutingDecision:
        """返回最佳 forgekin_id + 候选评分 + 盲点冲突报告"""


class DefaultCapabilityRouter(CapabilityRouter):
    """默认路由实现: 本地向量匹配 + Wilson 下界 + harness_fit_score"""

    def __init__(
        self,
        weights: dict[str, float],
        blind_overlap_threshold: float = 0.3,
        cache_ttl_seconds: int = 300,
    ) -> None:
        # 权重外置到 capability.yaml
        self._weights = weights
        self._blind_overlap_threshold = blind_overlap_threshold
        self._cache_ttl = cache_ttl_seconds
        self._cache: dict[str, tuple[RoutingDecision, datetime]] = {}

    async def route(
        self,
        task: TaskProfile,
        candidates: list[CapabilityProfile],
    ) -> RoutingDecision:
        cache_key = f"{task.task_id}:{hash(tuple(c.forgekin_id for c in candidates))}"
        cached = self._cache.get(cache_key)
        if cached and (datetime.now - cached[1]).total_seconds < self._cache_ttl:
            logger.debug("capability.route.cache_hit", task_id=task.task_id)
            return cached[0]

        scored: list[tuple[CapabilityProfile, dict[str, float]]] = []
        for candidate in candidates:
            breakdown = {
                "skill_match": self._compute_skill_match(task, candidate),
                "blind_avoid": self._compute_blind_avoid(task, candidate),
                "wilson_lb": self._compute_wilson_lb(candidate),
                "harness_fit": candidate.harness_fit_score,
                "tool_fit": self._compute_tool_fit(task, candidate),
            }
            scored.append((candidate, breakdown))

        # 加权总分
        def total(breakdown: dict[str, float]) -> float:
            return sum(breakdown[k] * self._weights.get(k, 0.0) for k in breakdown)

        scored.sort(key=lambda x: total(x[1]), reverse=True)
        best, best_breakdown = scored[0]
        runner_up = scored[1][0].forgekin_id if len(scored) > 1 else None

        warnings: list[str] = []
        for cand, breakdown in scored[1:3]:
            if breakdown["blind_avoid"] < self._blind_overlap_threshold:
                warnings.append(
                    f"forgekin={cand.forgekin_id} blind_avoid={breakdown['blind_avoid']:.2f} "
                    f"低于阈值 {self._blind_overlap_threshold}（跨厂商 review 风险）"
                )

        decision = RoutingDecision(
            selected_forgekin_id=best.forgekin_id,
            score=total(best_breakdown),
            score_breakdown=best_breakdown,
            blind_spot_warnings=warnings,
            runner_up_id=runner_up,
        )
        self._cache[cache_key] = (decision, datetime.now)
        logger.info(
            "capability.route.decision",
            task_id=task.task_id,
            selected=best.forgekin_id,
            score=decision.score,
        )
        return decision

    def _compute_skill_match(self, task: TaskProfile, candidate: CapabilityProfile) -> float:
        if not task.required_skills:
            return 0.5
        matched = 0.0
        total_weight = 0.0
        for req in task.required_skills:
            weight = req.importance
            total_weight += weight
            for sp in candidate.skill_packages:
                if sp.skill_id == req.skill_id:
                    matched += weight * sp.proficiency
                    break
        return matched / total_weight if total_weight > 0 else 0.5

    def _compute_blind_avoid(self, task: TaskProfile, candidate: CapabilityProfile) -> float:
        if not candidate.blind_spots:
            return 1.0
        overlap = 0
        for bs in candidate.blind_spots:
            for req in task.required_skills:
                if req.skill_id in bs.description or bs.description in req.skill_id:
                    overlap += 1
                    break
        return max(0.0, 1.0 - overlap / max(1, len(candidate.blind_spots)))

    def _compute_wilson_lb(self, candidate: CapabilityProfile) -> float:
        perf = candidate.historical_performance
        if perf.total_tasks == 0:
            return 0.5
        # Wilson score interval lower bound (z=1.96 for 95% CI)
        n = perf.total_tasks
        p = perf.success_count / n
        z = 1.96
        denominator = 1 + z * z / n
        center = (p + z * z / (2 * n)) / denominator
        margin = z * ((p * (1 - p) + z * z / (4 * n)) / n) ** 0.5 / denominator
        return max(0.0, center - margin)

    def _compute_tool_fit(self, task: TaskProfile, candidate: CapabilityProfile) -> float:
        if not task.required_tools:
            return 0.5
        allowed = set(candidate.tool_boundary.allowed_tools)
        forbidden = set(candidate.tool_boundary.forbidden_tools)
        fit = 0
        for tool in task.required_tools:
            if tool in forbidden:
                continue
            if tool in allowed:
                fit += 1
        return fit / len(task.required_tools)
```

### 2.3 数据结构

```python
# flowforge/core/capability/profile.py
"""能力画像数据模型 — 五可变性层"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class MutabilityLayer(str, Enum):
    """可变性层标记"""
    CONSTANT = "constant"           # 常量层（模型固有能力）
    SEMI_CONSTANT = "semi_constant" # 半常量层（盲点）
    VARIABLE = "variable"           # 变量层（技能包/工具边界）
    ACCUMULATING = "accumulating"   # 累积层（历史表现）
    INSTANTANEOUS = "instantaneous" # 瞬时层（当前状态）


class DecayTag(str, Enum):
    """Build to Delete vs Built to Persist 标记"""
    BUILT_TO_PERSIST = "built_to_persist"   # 复利型基础设施
    BUILD_TO_DELETE = "build_to_delete"     # 折旧中，sunset 后退役
    SUNSET_REVIEW_DUE = "sunset_review_due" # 待 review


class CognitiveStyle(str, Enum):
    ANALYTICAL = "analytical"
    CREATIVE = "creative"
    PRACTICAL = "practical"
    HOLISTIC = "holistic"
    DETAIL_ORIENTED = "detail_oriented"


class AgentState(str, Enum):
    IDLE = "idle"
    WORKING = "working"
    WAITING_REVIEW = "waiting_review"
    BLOCKED = "blocked"
    EVOLVING = "evolving"


class ModelCapability(BaseModel):
    """模型固有能力（常量层）"""
    vendor: Literal["anthropic", "openai", "google", "deepseek", "qwen", "glm", "kimi", "hunyuan", "external"]
    model_name: str
    context_window: int = Field(gt=0)
    supports_tool_call: bool = True
    supports_vision: bool = False
    reasoning_capability: float = Field(ge=0.0, le=1.0)
    creativity_capability: float = Field(ge=0.0, le=1.0)

    @field_validator("model_name")
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("model_name 不可为空")
        return v


class BlindSpot(BaseModel):
    """盲点（半常量层）"""
    blind_spot_id: str
    description: str
    evidence_refs: list[str] = Field(default_factory=list)
    compensation_strategy: str
    detected_at: datetime = Field(default_factory=datetime.now)
    confidence: float = Field(ge=0.0, le=1.0)
    source: Literal["eval_signal", "llm_classification", "operator_asserted"] = "eval_signal"


class SkillPackage(BaseModel):
    """可加载知识包（变量层）"""
    skill_id: str
    domain: str
    proficiency: float = Field(ge=0.0, le=1.0)
    last_used: Optional[datetime] = None
    usage_count: int = Field(ge=0, default=0)
    source: Literal["native", "external", "distilled"] = "native"
    external_vendor: Optional[str] = None  # 当 source=external 时记录原厂商溯源


class ToolBoundary(BaseModel):
    """工具边界（变量层）"""
    allowed_tools: list[str] = Field(default_factory=list)
    forbidden_tools: list[str] = Field(default_factory=list)
    tool_proficiency: dict[str, float] = Field(default_factory=dict)


class PerformanceLog(BaseModel):
    """历史表现（累积层）— 单调累积，禁回退"""
    total_tasks: int = Field(ge=0, default=0)
    success_count: int = Field(ge=0, default=0)
    failure_count: int = Field(ge=0, default=0)
    avg_quality_score: float = Field(ge=0.0, le=1.0, default=0.0)
    recent_eval_ids: list[str] = Field(default_factory=list, max_length=20)
    wilson_lower_bound: float = Field(ge=0.0, le=1.0, default=0.0)

    @model_validator(mode="after")
    def check_counts_consistent(self) -> "PerformanceLog":
        if self.success_count + self.failure_count > self.total_tasks:
            raise ValueError("success_count + failure_count 不可超过 total_tasks")
        return self


class CapabilityProfile(BaseModel):
    """Forgekin能力画像 — 长期主体画像（跨 session 持续）"""

    forgekin_id: str
    model_capability: ModelCapability                    # 常量层
    cognitive_style: CognitiveStyle                      # 常量层
    blind_spots: list[BlindSpot]                         # 半常量层（必填，空列表报错）
    skill_packages: list[SkillPackage] = Field(default_factory=list)
    tool_boundary: ToolBoundary                          # 变量层
    historical_performance: PerformanceLog = Field(default_factory=PerformanceLog)
    current_state: AgentState = AgentState.IDLE          # 瞬时层
    harness_fit_score: float = Field(default=0.5, ge=0.0, le=1.0)
    decay_tag: DecayTag = DecayTag.BUILT_TO_PERSIST
    schema_version: str = "1.0"
    updated_at: datetime = Field(default_factory=datetime.now)

    @field_validator("blind_spots")
    @classmethod
    def blind_spots_must_not_be_empty(cls, v: list[BlindSpot]) -> list[BlindSpot]:
        if not v:
            raise ValueError("blind_spots 不可为空（半常量层必填，roleagent.md 第 0 章硬要求）")
        return v

    def gap_analysis(self, required: "TaskProfile") -> list[str]:
        """分析能力缺口，返回需要扩展的能力列表"""
        gaps: list[str] = []
        for req in required.required_skills:
            matched = any(sp.skill_id == req.skill_id for sp in self.skill_packages)
            if not matched:
                gaps.append(f"skill_id={req.skill_id}")
        for tool in required.required_tools:
            if tool in self.tool_boundary.forbidden_tools:
                gaps.append(f"forbidden_tool={tool}")
            elif tool not in self.tool_boundary.allowed_tools:
                gaps.append(f"missing_tool={tool}")
        return gaps

    def has_blind_spot_conflict(self, other: "CapabilityProfile") -> bool:
        """检查与另一Forgekin的盲点是否冲突（用于跨厂商 review 配对）"""
        # 同厂商必冲突（共享训练分布偏差）
        if self.model_capability.vendor == other.model_capability.vendor:
            return True
        # 描述相似度（Jaccard on tokens）
        def tokenize(desc: str) -> set[str]:
            return set(desc.lower.split)

        for bs_self in self.blind_spots:
            t_self = tokenize(bs_self.description)
            for bs_other in other.blind_spots:
                t_other = tokenize(bs_other.description)
                if not t_self or not t_other:
                    continue
                jaccard = len(t_self & t_other) / len(t_self | t_other)
                if jaccard >= 0.5:
                    return True
        return False

    def mutate_field(
        self,
        field_name: str,
        value,
        expected_layer: MutabilityLayer,
    ) -> "CapabilityProfile":
        """按可变性层校验后修改字段"""
        layer_map = {
            "model_capability": MutabilityLayer.CONSTANT,
            "cognitive_style": MutabilityLayer.CONSTANT,
            "blind_spots": MutabilityLayer.SEMI_CONSTANT,
            "skill_packages": MutabilityLayer.VARIABLE,
            "tool_boundary": MutabilityLayer.VARIABLE,
            "historical_performance": MutabilityLayer.ACCUMULATING,
            "current_state": MutabilityLayer.INSTANTANEOUS,
        }
        actual_layer = layer_map.get(field_name)
        if actual_layer != expected_layer:
            raise ValueError(
                f"字段 {field_name} 属于 {actual_layer} 层，"
                f"不可作为 {expected_layer} 层修改"
            )
        setattr(self, field_name, value)
        self.updated_at = datetime.now
        return self


class SkillRequirement(BaseModel):
    skill_id: str
    importance: float = Field(ge=0.0, le=1.0)


class TaskProfile(BaseModel):
    """任务画像（路由输入）"""
    task_id: str
    description: str
    required_skills: list[SkillRequirement] = Field(default_factory=list)
    required_tools: list[str] = Field(default_factory=list)
    forbidden_blind_spots: list[str] = Field(default_factory=list)
    domain: Optional[str] = None


class RoutingDecision(BaseModel):
    """路由决策输出"""
    selected_forgekin_id: str
    score: float = Field(ge=0.0, le=1.0)
    score_breakdown: dict[str, float]
    blind_spot_warnings: list[str] = Field(default_factory=list)
    runner_up_id: Optional[str] = None
    decided_at: datetime = Field(default_factory=datetime.now)


class BlindSpotOverlapReport(BaseModel):
    """盲点重叠报告（跨厂商 review 配对依据）"""
    author_id: str
    reviewer_id: str
    overlap_score: float = Field(ge=0.0, le=1.0)
    overlapping_descriptions: list[str] = Field(default_factory=list)
    same_vendor: bool = False
    can_pair: bool = True

    @model_validator(mode="after")
    def check_can_pair(self) -> "BlindSpotOverlapReport":
        if self.same_vendor:
            self.can_pair = False
        elif self.overlap_score >= 0.3:
            self.can_pair = False
        return self
```

### 2.4 关键算法

```
算法: CapabilityRouter.route(task, candidates)
输入: TaskProfile, list[CapabilityProfile] (10 个候选)
输出: RoutingDecision

1. cache_key = hash(task.task_id + candidates.forgekin_id 列表)
2. IF cache 命中 (TTL 内) THEN 返回缓存结果

3. FOR EACH candidate IN candidates:
   3.1 skill_match = Σ(req.importance × sp.proficiency for matched skills) / Σ(req.importance)
   3.2 blind_avoid = 1.0 - (overlap_count / |candidate.blind_spots|)
   3.3 wilson_lb = WilsonScoreLowerBound(success_count, total_tasks, z=1.96)
   3.4 harness_fit = candidate.harness_fit_score
   3.5 tool_fit = |allowed ∩ required| / |required|
   3.6 total = Σ(weight[k] × breakdown[k] for k in keys)
   3.7 记录 (candidate, breakdown, total)

4. 按 total 降序排序
5. best = sorted[0]
6. runner_up = sorted[1].forgekin_id (若存在)
7. warnings = [blind_avoid < 0.3 的候选 top-3]

8. 构造 RoutingDecision
9. 写入 cache (key=cache_key, ttl=300s)
10. 写入 trace 日志 (decision, selected, score)
11. 返回 RoutingDecision


算法: WilsonScoreLowerBound(success, total, z)
输入: success_count, total_count, z 分位数
输出: 下界 [0.0, 1.0]

IF total == 0: RETURN 0.5
p = success / total
denominator = 1 + z² / total
center = (p + z² / (2*total)) / denominator
margin = z × √((p(1-p) + z²/(4*total)) / total) / denominator
RETURN max(0.0, center - margin)


算法: BlindSpotDetector.check_overlap(author_id, reviewer_id)
输入: author_id, reviewer_id
输出: BlindSpotOverlapReport

1. author = CapabilityRepository.load(author_id)
2. reviewer = CapabilityRepository.load(reviewer_id)
3. IF author.vendor == reviewer.vendor:
   RETURN OverlapReport(overlap_score=1.0, same_vendor=True, can_pair=False)
4. overlap_count = 0
5. overlapping_descs = []
6. FOR EACH bs_a IN author.blind_spots:
   6.1 t_a = tokenize(bs_a.description)
   6.2 FOR EACH bs_r IN reviewer.blind_spots:
       6.2.1 t_r = tokenize(bs_r.description)
       6.2.2 jaccard = |t_a ∩ t_r| / |t_a ∪ t_r|
       6.2.3 IF jaccard >= 0.5:
             overlap_count += 1
             overlapping_descs.append((bs_a, bs_r))
7. overlap_score = overlap_count / max(1, len(author.blind_spots))
8. can_pair = overlap_score < 0.3
9. RETURN OverlapReport(overlap_score, overlapping_descs, same_vendor=False, can_pair)
```

---

## 3. 模块实现

### 3.1 关键代码片段

```python
# flowforge/infra/repo/sqlite_capability_repo.py
"""SQLite 实现 — CapabilityRepository"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from typing import Optional

from flowforge.core.capability.profile import (
    CapabilityProfile,
    TaskProfile,
    RoutingDecision,
)
from flowforge.core.capability.storage import CapabilityRepository, EvalSignal
from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class SqliteCapabilityRepository(CapabilityRepository):
    """SQLite 持久化实现（WAL 模式）"""

    SCHEMA_SQL = """
    CREATE TABLE IF NOT EXISTS capability_profiles (
        forgekin_id TEXT PRIMARY KEY,
        vendor TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        harness_fit_score REAL NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cp_vendor ON capability_profiles(vendor);
    CREATE INDEX IF NOT EXISTS idx_cp_score ON capability_profiles(harness_fit_score DESC);
    CREATE TABLE IF NOT EXISTS capability_perf_log (
        forgekin_id TEXT NOT NULL,
        eval_id TEXT NOT NULL,
        success INTEGER NOT NULL,
        quality_score REAL NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (forgekin_id, eval_id)
    );
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db

    def _init_db(self) -> None:
        self._conn = sqlite3.connect(self._db_path, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.executescript(self.SCHEMA_SQL)

    async def save(self, profile: CapabilityProfile) -> str:
        if self._conn is None:
            raise RuntimeError("DB connection not initialized")
        payload = profile.model_dump_json
        self._conn.execute(
            """
            INSERT OR REPLACE INTO capability_profiles
                (forgekin_id, vendor, profile_json, harness_fit_score, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                profile.forgekin_id,
                profile.model_capability.vendor,
                payload,
                profile.harness_fit_score,
                datetime.now.isoformat,
            ),
        )
        logger.info("capability.profile.saved", forgekin_id=profile.forgekin_id)
        return profile.forgekin_id

    async def load(self, forgekin_id: str) -> Optional[CapabilityProfile]:
        if self._conn is None:
            return None
        row = self._conn.execute(
            "SELECT profile_json FROM capability_profiles WHERE forgekin_id = ?",
            (forgekin_id,),
        ).fetchone
        if row is None:
            return None
        return CapabilityProfile.model_validate_json(row["profile_json"])

    async def update_performance(
        self,
        forgekin_id: str,
        eval_signal: EvalSignal,
    ) -> None:
        if self._conn is None:
            return
        # 单调累积：禁回退
        self._conn.execute(
            """
            INSERT OR IGNORE INTO capability_perf_log
                (forgekin_id, eval_id, success, quality_score, recorded_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                forgekin_id,
                eval_signal.eval_id,
                1 if eval_signal.success else 0,
                eval_signal.quality_score,
                datetime.now.isoformat,
            ),
        )
        profile = await self.load(forgekin_id)
        if profile is None:
            logger.warning("capability.update.unknown_forgekin", forgekin_id=forgekin_id)
            return
        perf = profile.historical_performance
        perf.total_tasks += 1
        if eval_signal.success:
            perf.success_count += 1
        else:
            perf.failure_count += 1
        # 滚动平均
        n = perf.total_tasks
        perf.avg_quality_score = (perf.avg_quality_score * (n - 1) + eval_signal.quality_score) / n
        perf.recent_eval_ids = (perf.recent_eval_ids + [eval_signal.eval_id])[-20:]
        # Wilson 下界
        z = 1.96
        p = perf.success_count / n
        denom = 1 + z * z / n
        center = (p + z * z / (2 * n)) / denom
        margin = z * ((p * (1 - p) + z * z / (4 * n)) / n) ** 0.5 / denom
        perf.wilson_lower_bound = max(0.0, center - margin)
        await self.save(profile)
        logger.info(
            "capability.performance.updated",
            forgekin_id=forgekin_id,
            total=perf.total_tasks,
            success=perf.success_count,
        )

    async def list_by_capability(
        self,
        required: TaskProfile,
    ) -> list[CapabilityProfile]:
        if self._conn is None:
            return []
        # 简单筛选：先按 vendor 全量加载，再 Python 过滤
        rows = self._conn.execute(
            "SELECT profile_json FROM capability_profiles"
        ).fetchall
        candidates: list[CapabilityProfile] = []
        for row in rows:
            try:
                profile = CapabilityProfile.model_validate_json(row["profile_json"])
            except Exception as exc:
                logger.warning("capability.load.failed", error=str(exc))
                continue
            # 候选过滤：禁用 forbidden_tools
            if any(t in profile.tool_boundary.forbidden_tools for t in required.required_tools):
                continue
            candidates.append(profile)
        return candidates
```

### 3.2 关键流程时序图

```
TeamAct Owner 步 (A002)
       │
       │ team_id, TaskProfile
       ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. CapabilityRepository.list_by_capability(task)              │
│    - SQL: SELECT profile_json FROM capability_profiles        │
│    - Python 过滤 forbidden_tools                              │
│    - 返回 list[CapabilityProfile] (≤ 10 候选)                  │
└────────────────────────┬───────────────────────────────────────┘
                         │ candidates
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 2. CapabilityRouter.route(task, candidates)                   │
│    - 检查缓存 (cache_key, TTL=300s)                            │
│    - FOR EACH candidate:                                       │
│        compute skill_match / blind_avoid / wilson_lb /         │
│        harness_fit / tool_fit                                  │
│    - 加权排序选 best                                           │
│    - 写入缓存 + trace 日志                                     │
└────────────────────────┬───────────────────────────────────────┘
                         │ RoutingDecision
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 3. BlindSpotDetector.check_overlap(author_id, reviewer_id)    │
│    - 同厂商直接 can_pair=False                                 │
│    - 异厂商: Jaccard token 相似度 (阈值 0.5)                   │
│    - overlap_score < 0.3 才能 review 配对                       │
└────────────────────────┬───────────────────────────────────────┘
                         │ BlindSpotOverlapReport
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ 4. TeamActState.current_owner = decision.selected_forgekin_id │
│    - 写入 Evidence (F009): RoutingDecision 作为路由证据         │
│    - 触发 F006 BallCustodyLease.acquire                      │
└────────────────────────────────────────────────────────────────┘

[任务完成后异步]
       │
       ▼
┌────────────────────────────────────────────────────────────────┐
│ 5. Eval 信号回流                                              │
│    - EvalContract (F018) 发出 EvalSignal                       │
│    - CapabilityRepository.update_performance(forgekin_id, sig) │
│    - 单调累积 total_tasks / success_count / avg_quality_score  │
│    - 重新计算 Wilson 下界                                      │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 错误处理

| 异常 | 触发场景 | 处理策略 |
|------|---------|---------|
| `ValidationError("blind_spots 不可为空")` | 构造 CapabilityProfile 时未填盲点 | 拒绝构造，要求操作员显式声明盲点（即使是"未识别"也需写明） |
| `ValidationError("success_count + failure_count > total_tasks")` | 数据损坏或并发写入冲突 | 拒绝写入，回滚到上一版本，触发审计日志 |
| `RuntimeError("DB connection not initialized")` | Repository 未初始化 | DI 容器启动失败，禁启动 FlowForge 进程 |
| `sqlite3.IntegrityError` | 主键冲突（forgekin_id 重复） | 转为 INSERT OR REPLACE，但保留 updated_at 审计 |
| `CacheMiss` | 路由缓存未命中 | 走完整路由算法，并写入缓存 |
| `OverlapThresholdExceeded` | 跨厂商 review 配对 overlap_score >= 0.3 | 拒绝配对，要求重新选 reviewer |
| `MutabilityLayerViolation` | 试图把常量层字段作为瞬时层修改 | 拒绝修改，提示正确的可变性层 |

### 3.4 性能优化

| 指标 | 目标 | 优化手段 |
|------|:----:|---------|
| 路由延迟 P99 | < 100ms (10 候选) | 本地向量匹配（无 LLM 调用）+ 5min TTL 缓存 + 预计算 Wilson 下界 |
| 画像加载延迟 P99 | < 30ms | SQLite WAL 模式 + JSON 反序列化 + LRU 缓存（max=1000 profiles） |
| 历史表现更新延迟 | < 50ms | 单调累积 SQL（INSERT OR IGNORE） + 异步重算 Wilson |
| 跨厂商 review 判定 | < 20ms | Jaccard 简单实现 + 同厂商短路 |
| 内存占用 | < 200MB (10000 profiles) | LRU 缓存上限 1000 + 大列表懒加载 |
| 并发安全 | 100 QPS 路由 | SQLite 读多写少 + 写入串行化（isolation_level=None + WAL） |

```python
# flowforge/core/capability/cache.py
"""LRU 缓存实现"""
from collections import OrderedDict
from threading import Lock
from typing import Generic, TypeVar, Optional

K = TypeVar("K")
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """线程安全 LRU 缓存"""

    def __init__(self, maxsize: int = 1000) -> None:
        self._maxsize = maxsize
        self._data: OrderedDict[K, V] = OrderedDict
        self._lock = Lock

    def get(self, key: K) -> Optional[V]:
        with self._lock:
            if key not in self._data:
                return None
            self._data.move_to_end(key)
            return self._data[key]

    def put(self, key: K, value: V) -> None:
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
            self._data[key] = value
            if len(self._data) > self._maxsize:
                self._data.popitem(last=False)
```

---

## 4. 跨模块协作实现

### 4.1 上游依赖如何调用

**F002 TeamAct Loop 调用 CapabilityRouter**（Owner 步）：

```python
# flowforge/loop/teamact/executor.py
from flowforge.core.capability.router import CapabilityRouter
from flowforge.core.capability.storage import CapabilityRepository
from flowforge.core.plugin.di_container import inject


class TeamActLoopExecutor:
    def __init__(self) -> None:
        self._router = inject(CapabilityRouter)
        self._repo = inject(CapabilityRepository)

    async def owner_step(self, team_id: str, task_profile) -> str:
        candidates = await self._repo.list_by_capability(task_profile)
        if not candidates:
            raise RuntimeError(f"无候选Forgekin可承担 task={task_profile.task_id}")
        decision = await self._router.route(task_profile, candidates)
        # 同步到 TeamActState
        await self._shared_state.update_owner(team_id, decision.selected_forgekin_id)
        # 写入路由证据 (F009)
        await self._evidence_collector.collect(
            etype="trace_log",
            forgekin_id=decision.selected_forgekin_id,
            payload={"routing_decision": decision.model_dump},
        )
        return decision.selected_forgekin_id
```

**F028 ForgePipeline 调用 CapabilityProfile 构造器**（第 2 步"能力注入"）：

```python
# flowforge/forgemind/forging/pipeline.py
from flowforge.core.capability.profile import (
    CapabilityProfile, ModelCapability, CognitiveStyle, BlindSpot,
    ToolBoundary, DecayTag,
)


class ForgePipeline:
    async def inject_capability(self, forgekin_id: str, seed) -> CapabilityProfile:
        """锻造流水线第 2 步: 能力注入"""
        profile = CapabilityProfile(
            forgekin_id=forgekin_id,
            model_capability=ModelCapability(
                vendor=seed.vendor,
                model_name=seed.model_name,
                context_window=seed.context_window,
                supports_tool_call=seed.supports_tool_call,
                supports_vision=seed.supports_vision,
                reasoning_capability=seed.reasoning,
                creativity_capability=seed.creativity,
            ),
            cognitive_style=seed.cognitive_style,
            blind_spots=[
                BlindSpot(
                    blind_spot_id=f"bs_init_{forgekin_id}",
                    description="初始化盲点: 未在实战中识别",
                    compensation_strategy="通过 Eval 信号逐步识别并补全",
                    source="operator_asserted",
                )
            ],
            tool_boundary=ToolBoundary(
                allowed_tools=seed.allowed_tools,
                forbidden_tools=seed.forbidden_tools,
            ),
            decay_tag=DecayTag.BUILT_TO_PERSIST,
        )
        return await self._capability_repo.save(profile)
```

### 4.2 下游影响如何被调用

**F003 Handoff Capsule 调用 BlindSpotHintInjector**（ROUTE 步）：

```python
# flowforge/core/teamact/handoff.py
from flowforge.core.capability.storage import CapabilityRepository


class BlindSpotHintInjector:
    def __init__(self) -> None:
        self._repo = inject(CapabilityRepository)

    async def inject(self, capsule, author_id: str) -> None:
        author_profile = await self._repo.load(author_id)
        if author_profile is None:
            raise RuntimeError(f"作者画像未找到: {author_id}")
        # 自动注入 author 盲点（author 不可手工填写）
        capsule.blind_spot_hints = [bs.description for bs in author_profile.blind_spots]
```

**F007 Push Back 调用 has_blind_spot_conflict**（VERDICT 步）：

```python
# flowforge/core/teamact/push_back.py
class PushBackValidator:
    async def validate(self, pb, evidence_store) -> "ValidationResult":
        # ... 三要素校验 ...
        # 检查是否是 reviewer 盲点 vs author 盲点
        author = await self._capability_repo.load(pb.author_forgekin_id)
        reviewer = await self._capability_repo.load(pb.reviewer_forgekin_id)
        if author.has_blind_spot_conflict(reviewer):
            return ValidationResult(
                valid=False,
                reason="author 与 reviewer 盲点重叠，Push Back 不可由该 reviewer 仲裁",
            )
        return ValidationResult(valid=True)
```

**F031 ExternalAgentAdapter 融合 ExternalAgentProfile**：

```python
# flowforge/core/external_agent/adapter.py
class ExternalAgentAdapter:
    async def fuse_profile(self, forgekin_id: str, ext_profile) -> None:
        """三方 Agent 能力融合到 CapabilityProfile"""
        native = await self._capability_repo.load(forgekin_id)
        if native is None:
            raise RuntimeError(f"内部画像未找到: {forgekin_id}")
        # 标记 source=external + 保留厂商溯源
        for ext_skill in ext_profile.skill_packages:
            native.skill_packages.append(
                SkillPackage(
                    skill_id=f"ext::{ext_profile.vendor}::{ext_skill.skill_id}",
                    domain=ext_skill.domain,
                    proficiency=ext_skill.proficiency,
                    source="external",
                    external_vendor=ext_profile.vendor,  # 保留原厂商溯源
                )
            )
        # 不修改 blind_spots（半常量层，仅由 Eval 信号更新）
        await self._capability_repo.save(native)
```

### 4.3 集成测试点

```python
# flowforge/core/capability/tests/test_integration.py
"""集成测试 — 遵守 T1-T8 铁律"""
import pytest
from flowforge.core.capability.profile import (
    CapabilityProfile, ModelCapability, CognitiveStyle, BlindSpot,
    ToolBoundary, SkillPackage, TaskProfile, SkillRequirement,
)
from flowforge.core.capability.router import DefaultCapabilityRouter
from flowforge.core.capability.storage import EvalSignal


@pytest.mark.asyncio
async def test_route_picks_best_skill_match(real_llm_client, real_db):
    """T1 真实 LLM + T2 真实场景数据 + T3 具体断言"""
    # Arrange: 5 个不同厂商的Forgekin (DeepSeek/Qwen/GLM/Kimi/HunYuan)
    candidates = [
        CapabilityProfile(
            forgekin_id=f"forgekin_{vendor}",
            model_capability=ModelCapability(
                vendor=vendor, model_name=f"{vendor}-pro",
                context_window=128000, supports_tool_call=True,
                reasoning_capability=0.85, creativity_capability=0.7,
            ),
            cognitive_style=CognitiveStyle.ANALYTICAL,
            blind_spots=[BlindSpot(
                blind_spot_id=f"bs_{vendor}",
                description="长上下文检索精确度下降",
                compensation_strategy="分段检索 + RRF 融合",
            )],
            skill_packages=[SkillPackage(
                skill_id="python_coding", domain="dev",
                proficiency=0.9 if vendor == "deepseek" else 0.6,
            )],
            tool_boundary=ToolBoundary(allowed_tools=["code_editor", "test_runner"]),
            harness_fit_score=0.8 if vendor == "deepseek" else 0.6,
        )
        for vendor in ["deepseek", "qwen", "glm", "kimi", "hunyuan"]
    ]
    task = TaskProfile(
        task_id="task_py_impl",
        description="实现 Python 数据处理模块",
        required_skills=[SkillRequirement(skill_id="python_coding", importance=1.0)],
        required_tools=["code_editor", "test_runner"],
    )

    router = DefaultCapabilityRouter(
        weights={"skill_match": 0.4, "blind_avoid": 0.2, "wilson_lb": 0.15,
                 "harness_fit": 0.15, "tool_fit": 0.1},
    )
    decision = await router.route(task, candidates)

    # Assert: 选择 DeepSeek (proficiency 0.9, harness_fit 0.8)
    assert decision.selected_forgekin_id == "forgekin_deepseek"
    assert decision.score > 0.7
    assert "skill_match" in decision.score_breakdown
    # T3 禁止 status in (...) 类弱断言


@pytest.mark.asyncio
async def test_blind_spot_overlap_blocks_same_vendor_pairing(real_db):
    """跨厂商 review 配对: 同厂商必须拒绝"""
    author = await real_db.load("forgekin_deepseek")
    reviewer = await real_db.load("forgekin_deepseek_v2")
    # 同厂商 (deepseek)
    assert author.model_capability.vendor == reviewer.model_capability.vendor
    report = await blind_spot_detector.check_overlap("forgekin_deepseek", "forgekin_deepseek_v2")
    assert report.same_vendor is True
    assert report.can_pair is False  # T3 具体断言
```

---

## 5. 详细设计验收

### 5.1 功能验收 AC

- [ ] AC-1: `CapabilityProfile` 可创建并持久化到 SQLite（通过 `CapabilityRepository.save`）
- [ ] AC-2: `blind_spots` 为空列表时构造抛 `ValidationError`
- [ ] AC-3: `mutate_field` 拒绝跨可变性层修改（如把常量层当瞬时层修改）
- [ ] AC-4: `CapabilityRouter.route` 返回 `RoutingDecision` 含 `score_breakdown`（5 维明细）
- [ ] AC-5: 路由算法基于能力匹配而非角色（验证 `skill_match` 权重最高）
- [ ] AC-6: `has_blind_spot_conflict` 同厂商返回 True（必冲突）
- [ ] AC-7: `update_performance` 后 `total_tasks` 单调递增，禁回退
- [ ] AC-8: `ExternalAgentProfile` 融合后 `source="external"` + `external_vendor` 字段保留
- [ ] AC-9: `decay_tag` 字段可标记 `BUILD_TO_DELETE` / `BUILT_TO_PERSIST`
- [ ] AC-10: `gap_analysis` 正确识别缺失 skill 与 forbidden tool

### 5.2 性能验收

- [ ] AC-11: 路由算法 P99 延迟 < 100ms（10 候选，基准测试）
- [ ] AC-12: 画像加载 P99 延迟 < 30ms（SQLite WAL + LRU 缓存命中）
- [ ] AC-13: 历史表现更新延迟 < 50ms
- [ ] AC-14: 100 QPS 并发路由无写冲突
- [ ] AC-15: 10000 profiles 内存占用 < 200MB

### 5.3 安全验收

- [ ] AC-16: 所有 DB 操作通过 `CapabilityRepository` 抽象，无 `cursor.execute("INSERT INTO capability_profiles...")` 直操作
- [ ] AC-17: 画像更新必须由 `EvalSignal` 触发（禁Forgekin主动修改自己的画像）
- [ ] AC-18: 跨厂商 review 配对 `overlap_score >= 0.3` 时配对被拒绝
- [ ] AC-19: ExternalAgentProfile 融合后保留原厂商溯源，不可降级为"内部能力"
- [ ] AC-20: `decay_tag=SUNSET_REVIEW_DUE` 的画像必须经 ADR 流程才可彻底退役

### 5.4 Eval 验收

- [ ] AC-21: 路由正确率 >= 85%（基于 Eval 信号 100 次任务基准）
- [ ] AC-22: 跨厂商 review 盲点检出率 >= 70%
- [ ] AC-23: Wilson 下界在小样本（n<5）时保守，避免误判
- [ ] AC-24: Eval 信号回流后 `historical_performance.avg_quality_score` 滚动平均正确
- [ ] AC-25: 路由决策日志（trace 信号）写入 F009 Evidence Store

---

## 6. 引用

- [doc:../spec.md#§3.1]（FR-CORE-001 能力画像）
- [doc:../arch.md#§3.1]（CapabilityProfile × Harness 契合度）
- [doc:../features/F001-capability-profile.md]（同号 Feature 级 SRS）
- [doc:../architecture/A001-capability-profile.md]（同号 Feature 级 SAD）
- [doc:../decisions/004-capability-profile-routing.md]（能力画像路由 ADR）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议 ADR，跨厂商 review 链）
- [doc:../design/naming-contract.md#2.12]（能力画像命名定义）
- [doc:../../CONTRIBUTING.md]（文档分层规范）
- [doc:../../CONTRIBUTING.md#31-15-条编程红线违反即拒绝合入]（第 10/11/12/13 条）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（详细设计骨架，对应 F001/A001） | 开发者 Forgekin（猎犬·夏洛克） |

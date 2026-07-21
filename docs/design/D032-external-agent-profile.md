# D032: 三方 Agent 能力画像详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10]（三方 Agent 集成）
> **对应 design.md**: [doc:../design.md#§3.10]
> **对应 Feature**: [doc:../features/F032-external-agent-profile.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A032-external-agent-profile.md]（同号 Architecture 级 SAD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]
> **依赖详细设计**: [doc:D031-external-agent-adapter.md]（容器层） + [doc:D014-memory-collection.md]（PerformanceLog 复用 F001 EchoStore）

---

## 1. 详细设计上下文

### 1.1 设计问题

ExternalAgentAdapter 抽象层（D031）需要为三方 Agent 建立能力画像，使Forgekin（多形态智能体）基于能力匹配选择合适的三方 Agent，而非按"配置默认值"或固定编号顺序调用。本详细设计在 `core/external_agent/profile.py` 落地 A032 架构，解决以下详细设计层问题：

1. **能力画像数据模型未落地**：A032 仅定义六维字段，未给出 Pydantic 完整模型、字段约束、校验器、模型不可变性保证。
2. **Wilson 下界算法未实现**：A032 引用 Wilson 下界但未给出实现，需明确小样本阈值（< 30 次）、置信度（z=1.96）、公式与边界处理。
3. **盲点互补配对算法未编码**：A032 描述"Forgekin盲点 ∩ 三方 Agent 擅长 = 高匹配分"，未给出集合运算、归一化评分、阈值过滤的具体算法。
4. **跨厂商 review 配对盲点不重叠校验未实现**：A032 要求 primary 与 complementary 盲点不重叠，未给出 Jaccard 距离 + 阈值的具体实现。
5. **YAML 配置加载与启动期注册未实现**：A032 要求 4 厂商画像 YAML 外置，未给出 ConfigLoader 启动期加载流程、字段完整性校验、DI 容器注入路径。
6. **历史表现更新链路未编码**：A032 要求 fallback 执行结果通过 Eval 信号更新 historical_performance，未给出 PerformanceLog 增量更新接口与 Repository 落盘路径。
7. **rank_by_cost_latency 多维排序未实现**：A032 要求按 cost_per_1k_tokens + avg_latency_ms 升序排序，未给出加权归一化算法与同等优先级平局处理。

### 1.2 设计约束

- **单向依赖约束**：`core/external_agent/profile.py` 仅依赖 F001 CapabilityProfile 抽象 + F002 TeamAct + F014 EchoStore + F018 Eval Contract + core/interfaces，禁止反向依赖 *Forge。
- **DI 容器约束**：ExternalAgentProfileRegistry / CapabilityMatcher 实例必须通过 DI 容器注入到 ExternalAgentBridge（D031），禁止在 Bridge 内部直接实例化。
- **Repository 层约束**：ExternalAgentCapabilityProfile 持久化必须通过 ExternalAgentProfileRepository 抽象，禁止直接操作数据库。
- **配置驱动约束**：4 厂商（claude_code/codex/opencode/trae）的 strengths/blind_spots/proficiency/cost/latency 必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码厂商偏好。
- **Wilson 下界约束**：小样本（< 30 次调用）历史表现评估必须使用 Wilson 下界，禁止直接用平均值。
- **盲点互补约束**：CapabilityMatcher 必须基于盲点互补配对，禁止按厂商编号顺序匹配。
- **跨厂商 review 盲点不重叠约束**：find_complementary_pair 必须满足 primary 与 complementary 盲点交集为空（Jaccard=0），违反即配对被拒绝。
- **4 厂商枚举不可扩展约束**：ExternalAgentProvider 固定 4 厂商，运行时不可动态新增厂商，新增必须经 ADR 决策。
- **六维字段完整性约束**：ExternalAgentCapabilityProfile 六维字段缺一即注册被拒绝。

### 1.3 设计影响

- **对 F001 能力画像的影响**：ExternalAgentCapabilityProfile 与 CapabilityProfile 数据模型对齐，复用 PerformanceLog 数据结构与 Wilson 下界计算。
- **对 F002 TeamAct 的影响**：跨厂商 review 配对联动 F002 跨厂商 review 逻辑，primary/complementary 配对结果作为 TeamAct 编排输入。
- **对 D031 ExternalAgentBridge 的影响**：Bridge 在选择 Adapter 时调用 CapabilityMatcher.match_for_task 决策最优厂商；register_adapter 调用 ExternalAgentProfileRegistry.get 校验画像存在。
- **对 D034 失败回退的影响**：FallbackChainBuilder.build_for_task 基于 CapabilityMatcher.match_for_task + rank_by_cost_latency 构建 fallback 链。
- **对 D035 能力融合的影响**：ExternalAgentCapabilityProfile 作为能力融合来源画像，FusionSource.external_agent_profile_ref 引用 agent_id。
- **对 F018 Eval Contract 的影响**：fallback 执行结果通过 Eval 信号回流到 PerformanceLog.historical_performance。

---

## 2. 详细设计

### 2.1 数据模型

#### 2.1.1 ExternalAgentProvider 枚举（4 厂商固定不可扩展）

```python
from enum import Enum


class ExternalAgentProvider(str, Enum):
    """三方 Agent 厂商（4 个，固定不可扩展）

    新增厂商必须经 ADR 决策（doc:../decisions/006-external-agent-integration.md）。
    运行时动态新增厂商会被 _assert_provider_in_enum 拒绝。
    """
    CLAUDE_CODE = "claude_code"   # 擅长复杂重构，盲点：长上下文易漂移
    CODEX = "codex"               # 擅长推理，盲点：工具调用弱
    OPENCODE = "opencode"         # 擅长开源协作，盲点：企业场景弱
    TRAE = "trae"                 # 擅长 IDE 集成，盲点：命令行长任务弱
```

枚举值固定为 4 个，覆盖业界主流编程 Agent。str + Enum 双继承便于 YAML 序列化与 JSON 响应。新增厂商必须经 ADR 决策并修改此枚举源码，禁止运行时动态注册。

#### 2.1.2 PerformanceLog Pydantic 模型（Wilson 下界）

```python
from datetime import datetime
from pydantic import BaseModel, Field, model_validator


class PerformanceLog(BaseModel):
    """历史表现记录（复用 F001 PerformanceLog，含 Wilson 下界）

    Wilson 下界用于小样本（< 30 次）可靠性评估，避免平均值高估。
    置信度 z=1.96（95% 置信区间）。
    """
    total_calls: int = Field(ge=0, description="历史调用总次数")
    success_count: int = Field(ge=0, description="成功调用次数")
    wilson_lower_bound: float = Field(
        ge=0.0, le=1.0,
        description="Wilson 下界（小样本可靠性估计，0.0-1.0）",
    )
    avg_quality_score: float = Field(
        ge=0.0, le=1.0,
        description="历史平均质量分（基于 F018 Eval Contract）",
    )
    last_updated_at: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="after")
    def _validate_counts(self) -> "PerformanceLog":
        """校验 success_count <= total_calls"""
        if self.success_count > self.total_calls:
            raise ValueError(
                f"success_count ({self.success_count}) 不能大于 "
                f"total_calls ({self.total_calls})"
            )
        return self
```

#### 2.1.3 ExternalAgentCapabilityProfile 六维画像模型

```python
from typing import Optional


class ExternalAgentCapabilityProfile(BaseModel):
    """三方 Agent 能力画像（六维，对标 F001 CapabilityProfile）

    六维字段缺一即注册被拒绝（_assert_six_dimensions_complete）。
    historical_performance 复用 PerformanceLog（含 Wilson 下界）。
    """
    provider: ExternalAgentProvider
    agent_id: str                              # 厂商内 agent 实例 ID（如 "claude_code_main"）
    display_name: str                          # 展示名（如 "Claude Code 主实例"）
    strengths: list[str] = Field(
        min_length=1,
        description="擅长能力标签（至少 1 个）",
    )
    blind_spots: list[str] = Field(
        min_length=1,
        description="盲点标签（至少 1 个，用于跨厂商互补配对）",
    )
    tool_calling_proficiency: float = Field(
        ge=0.0, le=1.0,
        description="工具调用熟练度（0.0-1.0）",
    )
    long_context_stability: float = Field(
        ge=0.0, le=1.0,
        description="长上下文稳定性（0.0-1.0）",
    )
    cost_per_1k_tokens: float = Field(
        gt=0.0,
        description="每 1000 token 成本（美元，> 0）",
    )
    avg_latency_ms: int = Field(
        gt=0,
        description="平均延迟（毫秒，> 0）",
    )
    historical_performance: PerformanceLog
    capability_domains: list[str] = Field(
        default_factory=list,
        description="能力域标签（如 'code_refactor'/'code_review'/'deploy'）",
    )

    model_config = {"extra": "forbid"}  # 禁止额外字段，保证六维严格性
```

六维字段定义：

| 维度 | 字段 | 类型 | 说明 |
|:----:|------|------|------|
| 1 | strengths | list[str] | 擅长能力（定性） |
| 2 | blind_spots | list[str] | 盲点（定性，用于互补配对） |
| 3 | tool_calling_proficiency | float | 工具调用熟练度（定量 0.0-1.0） |
| 4 | long_context_stability | float | 长上下文稳定性（定量 0.0-1.0） |
| 5 | cost_per_1k_tokens | float | 每千 token 成本（美元） |
| 6 | avg_latency_ms | int | 平均延迟（毫秒） |

`model_config = {"extra": "forbid"}` 防止 YAML 配置误加字段导致六维污染。

### 2.2 Wilson 下界算法

Wilson 下界用于小样本（< 30 次）可靠性评估，避免平均值高估。

```python
import math


def compute_wilson_lower_bound(
    success_count: int,
    total_calls: int,
    z: float = 1.96,
) -> float:
    """计算 Wilson 下界（95% 置信区间下界，z=1.96）

    数学公式：
        p_hat = success_count / total_calls
        n = total_calls
        denominator = 1 + z^2 / n
        center = (p_hat + z^2 / (2*n)) / denominator
        spread = z * sqrt(p_hat*(1-p_hat)/n + z^2/(4*n^2)) / denominator
        wilson_lower = center - spread

    边界处理：
        - total_calls == 0: 返回 0.0（无样本时可靠性为 0）
        - success_count == 0: 返回 0.0
        - success_count == total_calls: 返回接近 1.0 的下界
        - total_calls >= 30: 仍返回 Wilson 下界（小样本保护），但接近平均值

    Args:
        success_count: 成功调用次数
        total_calls: 总调用次数
        z: z 分数（默认 1.96，95% 置信区间）

    Returns:
        Wilson 下界（0.0-1.0）
    """
    if total_calls == 0:
        return 0.0
    if success_count == 0:
        return 0.0

    p_hat = success_count / total_calls
    n = total_calls
    denominator = 1 + (z ** 2) / n
    center = (p_hat + (z ** 2) / (2 * n)) / denominator
    spread = (
        z * math.sqrt((p_hat * (1 - p_hat)) / n + (z ** 2) / (4 * (n ** 2)))
        / denominator
    )
    wilson_lower = center - spread
    # 边界裁剪（防止浮点误差超出 [0, 1])
    return max(0.0, min(1.0, wilson_lower))


WILSON_SMALL_SAMPLE_THRESHOLD = 30
"""小样本阈值：total_calls < 30 时强制使用 Wilson 下界"""
```

**算法选型理由**：
- 平均值在小样本下高估可靠性（如 3 次成功 3 次得出 1.0 不可靠）。
- Wilson 下界在 95% 置信区间下给出保守估计，3 次成功 3 次约给出 0.46 而非 1.0。
- 总样本数 ≥ 30 时 Wilson 下界与平均值接近，可平滑过渡。

### 2.3 盲点互补配对算法

盲点互补配对是 CapabilityMatcher 的核心算法：Forgekin盲点 ∩ 三方 Agent 擅长 = 高匹配分；Forgekin擅长 ∩ 三方 Agent 盲点 = 低匹配分。

```python
def compute_blind_spot_complement_score(
    forgekin_strengths: list[str],
    forgekin_blind_spots: list[str],
    agent_strengths: list[str],
    agent_blind_spots: list[str],
) -> float:
    """计算盲点互补配对分（0.0-1.0）

    评分公式：
        complement = |forgekin_blind_spots ∩ agent_strengths| / |forgekin_blind_spots|
        conflict = |forgekin_strengths ∩ agent_blind_spots| / |forgekin_strengths|
        score = complement - 0.5 * conflict

    解释：
        - complement 高（Agent 擅长Forgekin的盲点）-> 高分
        - conflict 高（Agent 盲点恰好是Forgekin擅长，浪费 Agent 价值）-> 低分
        - 冲突权重 0.5（不能完全抵消互补收益）

    Args:
        forgekin_strengths: Forgekin擅长能力
        forgekin_blind_spots: Forgekin盲点
        agent_strengths: 三方 Agent 擅长能力
        agent_blind_spots: 三方 Agent 盲点

    Returns:
        匹配分（0.0-1.0），低于 COMPLEMENT_SCORE_THRESHOLD 的候选被过滤
    """
    if not forgekin_blind_spots:
        # Forgekin无盲点，无法互补，返回中性分
        return 0.5

    if not forgekin_strengths:
        # Forgekin无擅长，无法判定冲突，仅看互补
        complement = len(set(forgekin_blind_spots) & set(agent_strengths)) / len(forgekin_blind_spots)
        return complement

    complement = (
        len(set(forgekin_blind_spots) & set(agent_strengths))
        / len(forgekin_blind_spots)
    )
    conflict = (
        len(set(forgekin_strengths) & set(agent_blind_spots))
        / len(forgekin_strengths)
    )
    score = complement - 0.5 * conflict
    return max(0.0, min(1.0, score))


COMPLEMENT_SCORE_THRESHOLD = 0.3
"""盲点互补配对阈值：score < 0.3 的候选被过滤"""
```

### 2.4 跨厂商 review 配对盲点不重叠校验

```python
def assert_blind_spots_not_overlapping(
    primary_blind_spots: list[str],
    complementary_blind_spots: list[str],
) -> None:
    """校验 primary 与 complementary 盲点不重叠（Jaccard=0）

    违反即抛 BlindSpotsOverlapError，配对被拒绝。
    跨厂商 review 场景：双方盲点若重叠，会同时漏检同一类问题。

    Args:
        primary_blind_spots: primary Agent 盲点
        complementary_blind_spots: complementary Agent 盲点

    Raises:
        BlindSpotsOverlapError: 盲点交集非空时抛出
    """
    intersection = set(primary_blind_spots) & set(complementary_blind_spots)
    if intersection:
        raise BlindSpotsOverlapError(
            primary_blind_spots=primary_blind_spots,
            complementary_blind_spots=complementary_blind_spots,
            overlap=list(intersection),
        )


class BlindSpotsOverlapError(Exception):
    """盲点重叠错误（跨厂商 review 配对违反不变量）"""

    def __init__(
        self,
        primary_blind_spots: list[str],
        complementary_blind_spots: list[str],
        overlap: list[str],
    ) -> None:
        self.primary_blind_spots = primary_blind_spots
        self.complementary_blind_spots = complementary_blind_spots
        self.overlap = overlap
        super.__init__(
            f"primary 与 complementary 盲点重叠: {overlap}；"
            f"primary={primary_blind_spots}, complementary={complementary_blind_spots}"
        )
```

### 2.5 rank_by_cost_latency 多维排序算法

```python
def rank_by_cost_latency_impl(
    candidates: list[ExternalAgentCapabilityProfile],
    cost_weight: float = 0.6,
    latency_weight: float = 0.4,
) -> list[ExternalAgentCapabilityProfile]:
    """按 cost_per_1k_tokens + avg_latency_ms 升序排序

    算法：
        1. 找出最大 cost 与最大 latency（用于归一化）
        2. 对每个候选计算归一化 cost 与归一化 latency（0.0-1.0）
        3. 加权综合 score = cost_weight * norm_cost + latency_weight * norm_latency
        4. 按 score 升序排序（score 越小越优）

    平局处理：score 相同时按 provider 字典序排序（确定性输出）

    Args:
        candidates: 候选厂商画像列表
        cost_weight: 成本权重（默认 0.6，成本优先）
        latency_weight: 延迟权重（默认 0.4）

    Returns:
        排序后的候选列表（最优在前）
    """
    if not candidates:
        return []
    if len(candidates) == 1:
        return candidates

    max_cost = max(c.cost_per_1k_tokens for c in candidates)
    max_latency = max(c.avg_latency_ms for c in candidates)

    def _score(c: ExternalAgentCapabilityProfile) -> tuple[float, str]:
        norm_cost = c.cost_per_1k_tokens / max_cost if max_cost > 0 else 0.0
        norm_latency = c.avg_latency_ms / max_latency if max_latency > 0 else 0.0
        return (
            cost_weight * norm_cost + latency_weight * norm_latency,
            c.provider.value,
        )

    return sorted(candidates, key=_score)
```

---

## 3. 模块实现

### 3.1 ExternalAgentProfileRegistry 抽象与实现

#### 3.1.1 抽象基类

```python
from abc import ABC, abstractmethod


class ExternalAgentProfileRegistry(ABC):
    """三方 Agent 能力画像注册表（YAML 配置驱动）"""

    @abstractmethod
    async def register(
        self, profile: ExternalAgentCapabilityProfile
    ) -> str:
        """注册能力画像（仅启动时由 YAML 加载调用）

        Args:
            profile: 三方 Agent 能力画像

        Returns:
            agent_id（注册成功后返回）

        Raises:
            ProviderNotInEnumError: provider 不在 4 厂商枚举中
            SixDimensionsIncompleteError: 六维字段缺失
            AgentIdConflictError: agent_id 已注册
        """
        ...

    @abstractmethod
    async def get(self, agent_id: str) -> ExternalAgentCapabilityProfile:
        """获取能力画像

        Raises:
            AgentProfileNotFoundError: agent_id 未注册
        """
        ...

    @abstractmethod
    async def list_by_provider(
        self, provider: ExternalAgentProvider
    ) -> list[ExternalAgentCapabilityProfile]:
        """按厂商列出能力画像"""
        ...

    @abstractmethod
    async def list_all(self) -> list[ExternalAgentCapabilityProfile]:
        """列出全部能力画像（供 CapabilityMatcher 使用）"""
        ...

    @abstractmethod
    async def update_performance(
        self,
        agent_id: str,
        new_call_total: int,
        new_success_count: int,
        new_quality_score: float,
    ) -> PerformanceLog:
        """更新历史表现（由 F034 fallback 执行后通过 F018 Eval 信号调用）

        重新计算 Wilson 下界后落盘。

        Raises:
            AgentProfileNotFoundError: agent_id 未注册
        """
        ...
```

#### 3.1.2 Harness 实现

```python
from core.tracing import get_logger
from core.interfaces.repository import Repository

logger = get_logger(__name__)


class HarnessExternalAgentProfileRegistry(ExternalAgentProfileRegistry):
    """ExternalAgentProfileRegistry 的 Harness 实现

    使用 Repository 层持久化（基于 F008 Durable State Surfaces）
    使用 DI 容器注入 Repository 实例。
    """

    def __init__(
        self,
        profile_repository: Repository[ExternalAgentCapabilityProfile],
    ) -> None:
        # DI 容器注入 Repository
        self._repo = profile_repository
        logger.info(
            "HarnessExternalAgentProfileRegistry initialized",
            extra={"repository_type": type(profile_repository).__name__},
        )

    async def register(
        self, profile: ExternalAgentCapabilityProfile
    ) -> str:
        # 硬门 1: provider 必须在 4 厂商枚举中
        self._assert_provider_in_enum(profile.provider)
        # 硬门 2: 六维字段必须完整（Pydantic 校验已保证，这里二次校验）
        self._assert_six_dimensions_complete(profile)
        # 硬门 3: agent_id 不能冲突
        existing = await self._repo.find_by_id(profile.agent_id)
        if existing is not None:
            raise AgentIdConflictError(
                agent_id=profile.agent_id,
                message=f"agent_id '{profile.agent_id}' already registered",
            )
        await self._repo.save(profile.agent_id, profile)
        logger.info(
            "ExternalAgentCapabilityProfile registered",
            extra={
                "agent_id": profile.agent_id,
                "provider": profile.provider.value,
                "strengths_count": len(profile.strengths),
                "blind_spots_count": len(profile.blind_spots),
            },
        )
        return profile.agent_id

    async def get(self, agent_id: str) -> ExternalAgentCapabilityProfile:
        profile = await self._repo.find_by_id(agent_id)
        if profile is None:
            raise AgentProfileNotFoundError(
                agent_id=agent_id,
                message=f"agent_id '{agent_id}' not registered",
            )
        return profile

    async def list_by_provider(
        self, provider: ExternalAgentProvider
    ) -> list[ExternalAgentCapabilityProfile]:
        all_profiles = await self._repo.list_all
        return [p for p in all_profiles if p.provider == provider]

    async def list_all(self) -> list[ExternalAgentCapabilityProfile]:
        return await self._repo.list_all

    async def update_performance(
        self,
        agent_id: str,
        new_call_total: int,
        new_success_count: int,
        new_quality_score: float,
    ) -> PerformanceLog:
        profile = await self.get(agent_id)
        new_log = PerformanceLog(
            total_calls=new_call_total,
            success_count=new_success_count,
            wilson_lower_bound=compute_wilson_lower_bound(
                success_count=new_success_count,
                total_calls=new_call_total,
            ),
            avg_quality_score=new_quality_score,
        )
        # Pydantic v2: 使用 model_copy 更新不可变字段
        updated = profile.model_copy(
            update={"historical_performance": new_log}
        )
        await self._repo.save(agent_id, updated)
        logger.info(
            "PerformanceLog updated",
            extra={
                "agent_id": agent_id,
                "total_calls": new_call_total,
                "success_count": new_success_count,
                "wilson_lower_bound": new_log.wilson_lower_bound,
            },
        )
        return new_log

    @staticmethod
    def _assert_provider_in_enum(
        provider: ExternalAgentProvider,
    ) -> None:
        if provider not in ExternalAgentProvider:
            raise ProviderNotInEnumError(
                provider=str(provider),
                allowed=[p.value for p in ExternalAgentProvider],
            )

    @staticmethod
    def _assert_six_dimensions_complete(
        profile: ExternalAgentCapabilityProfile,
    ) -> None:
        required_fields = [
            "strengths",
            "blind_spots",
            "tool_calling_proficiency",
            "long_context_stability",
            "cost_per_1k_tokens",
            "avg_latency_ms",
        ]
        missing = [
            f for f in required_fields
            if getattr(profile, f) is None
            or (isinstance(getattr(profile, f), list) and len(getattr(profile, f)) == 0)
        ]
        if missing:
            raise SixDimensionsIncompleteError(
                agent_id=profile.agent_id,
                missing_fields=missing,
            )
```

### 3.2 CapabilityMatcher 抽象与实现

#### 3.2.1 抽象基类

```python
class CapabilityMatcher(ABC):
    """能力匹配器（Forgekin能力画像 × 三方 Agent 能力画像）"""

    @abstractmethod
    async def match_for_task(
        self,
        forgekin_profile_id: str,
        task_capability_requirements: list[str],
    ) -> list[ExternalAgentCapabilityProfile]:
        """基于盲点互补 + 任务能力需求匹配

        算法：
            1. 读取Forgekin CapabilityProfile（F001）获取 strengths + blind_spots
            2. 遍历 ExternalAgentProfileRegistry.list_all
            3. 对每个 Agent 计算盲点互补分
            4. 过滤 score < COMPLEMENT_SCORE_THRESHOLD 的候选
            5. 过滤不满足 task_capability_requirements 的候选
            6. 按 score 降序排序
        """
        ...

    @abstractmethod
    async def find_complementary_pair(
        self, primary_agent_id: str
    ) -> Optional[ExternalAgentCapabilityProfile]:
        """找盲点互补的 review 配对（与 F002 跨厂商 review 联动）

        约束：
            - primary 与 complementary 必须不同厂商
            - primary 与 complementary 盲点不重叠（Jaccard=0）
            - complementary 的 strengths 必须覆盖 primary 的 blind_spots
        """
        ...

    @abstractmethod
    async def rank_by_cost_latency(
        self, candidates: list[ExternalAgentCapabilityProfile]
    ) -> list[ExternalAgentCapabilityProfile]:
        """按 cost_per_1k_tokens + avg_latency_ms 升序排序（F034 fallback 决策）"""
        ...
```

#### 3.2.2 Harness 实现

```python
class HarnessCapabilityMatcher(CapabilityMatcher):
    """CapabilityMatcher 的 Harness 实现

    依赖：
        - forgekin_profile_repo: Repository[CapabilityProfile]（F001 Forgekin画像）
        - agent_profile_registry: ExternalAgentProfileRegistry
    """

    def __init__(
        self,
        forgekin_profile_repo: Repository,  # Repository[F001 CapabilityProfile]
        agent_profile_registry: ExternalAgentProfileRegistry,
        cost_weight: float = 0.6,
        latency_weight: float = 0.4,
    ) -> None:
        self._forgekin_repo = forgekin_profile_repo
        self._registry = agent_profile_registry
        self._cost_weight = cost_weight
        self._latency_weight = latency_weight
        logger.info(
            "HarnessCapabilityMatcher initialized",
            extra={
                "cost_weight": cost_weight,
                "latency_weight": latency_weight,
            },
        )

    async def match_for_task(
        self,
        forgekin_profile_id: str,
        task_capability_requirements: list[str],
    ) -> list[ExternalAgentCapabilityProfile]:
        # 1. 读取Forgekin CapabilityProfile
        forgekin_profile = await self._forgekin_repo.find_by_id(forgekin_profile_id)
        if forgekin_profile is None:
            raise ForgekinProfileNotFoundError(
                forgekin_id=forgekin_profile_id,
                message=f"forgekin profile '{forgekin_profile_id}' not found",
            )

        forgekin_strengths = list(getattr(forgekin_profile, "strengths", []))
        forgekin_blind_spots = list(getattr(forgekin_profile, "blind_spots", []))

        # 2. 遍历全部三方 Agent 画像
        all_agents = await self._registry.list_all

        # 3. 计算盲点互补分 + 过滤
        scored: list[tuple[float, ExternalAgentCapabilityProfile]] = []
        for agent in all_agents:
            score = compute_blind_spot_complement_score(
                forgekin_strengths=forgekin_strengths,
                forgekin_blind_spots=forgekin_blind_spots,
                agent_strengths=agent.strengths,
                agent_blind_spots=agent.blind_spots,
            )
            if score < COMPLEMENT_SCORE_THRESHOLD:
                logger.debug(
                    "Agent filtered by complement score",
                    extra={
                        "agent_id": agent.agent_id,
                        "score": score,
                        "threshold": COMPLEMENT_SCORE_THRESHOLD,
                    },
                )
                continue

            # 4. 任务能力需求过滤
            if task_capability_requirements:
                agent_capabilities = set(agent.strengths) | set(agent.capability_domains)
                if not all(
                    req in agent_capabilities for req in task_capability_requirements
                ):
                    logger.debug(
                        "Agent filtered by task requirements",
                        extra={
                            "agent_id": agent.agent_id,
                            "requirements": task_capability_requirements,
                            "agent_capabilities": list(agent_capabilities),
                        },
                    )
                    continue

            scored.append((score, agent))

        # 5. 按 score 降序排序（同分按 agent_id 字典序，确定性输出）
        scored.sort(key=lambda x: (-x[0], x[1].agent_id))

        logger.info(
            "match_for_task completed",
            extra={
                "forgekin_profile_id": forgekin_profile_id,
                "task_requirements": task_capability_requirements,
                "candidate_count": len(scored),
            },
        )
        return [agent for _, agent in scored]

    async def find_complementary_pair(
        self, primary_agent_id: str
    ) -> Optional[ExternalAgentCapabilityProfile]:
        primary = await self._registry.get(primary_agent_id)

        # 候选必须是不同厂商
        candidates = await self._registry.list_all
        cross_provider_candidates = [
            c for c in candidates if c.provider != primary.provider
        ]

        # 过滤：盲点不重叠 + strengths 覆盖 primary 盲点
        valid_pairs: list[tuple[float, ExternalAgentCapabilityProfile]] = []
        for candidate in cross_provider_candidates:
            try:
                assert_blind_spots_not_overlapping(
                    primary_blind_spots=primary.blind_spots,
                    complementary_blind_spots=candidate.blind_spots,
                )
            except BlindSpotsOverlapError as e:
                logger.debug(
                    "Complementary pair rejected: blind spots overlap",
                    extra={
                        "primary_agent_id": primary_agent_id,
                        "candidate_agent_id": candidate.agent_id,
                        "overlap": e.overlap,
                    },
                )
                continue

            # complementary.strengths 必须覆盖 primary.blind_spots 的至少 1 项
            coverage = (
                len(set(primary.blind_spots) & set(candidate.strengths))
                / max(1, len(primary.blind_spots))
            )
            if coverage <= 0.0:
                continue

            valid_pairs.append((coverage, candidate))

        if not valid_pairs:
            logger.info(
                "No complementary pair found",
                extra={"primary_agent_id": primary_agent_id},
            )
            return None

        # 按 coverage 降序，同分按 cost 升序
        valid_pairs.sort(
            key=lambda x: (-x[0], x[1].cost_per_1k_tokens)
        )
        return valid_pairs[0][1]

    async def rank_by_cost_latency(
        self, candidates: list[ExternalAgentCapabilityProfile]
    ) -> list[ExternalAgentCapabilityProfile]:
        return rank_by_cost_latency_impl(
            candidates=candidates,
            cost_weight=self._cost_weight,
            latency_weight=self._latency_weight,
        )
```

### 3.3 异常类

```python
class ProviderNotInEnumError(Exception):
    """provider 不在 4 厂商枚举中"""

    def __init__(self, provider: str, allowed: list[str]) -> None:
        self.provider = provider
        self.allowed = allowed
        super.__init__(
            f"provider '{provider}' not in enum; allowed: {allowed}"
        )


class SixDimensionsIncompleteError(Exception):
    """六维字段缺失"""

    def __init__(self, agent_id: str, missing_fields: list[str]) -> None:
        self.agent_id = agent_id
        self.missing_fields = missing_fields
        super.__init__(
            f"agent_id '{agent_id}' missing required fields: {missing_fields}"
        )


class AgentIdConflictError(Exception):
    """agent_id 已注册"""

    def __init__(self, agent_id: str, message: str) -> None:
        self.agent_id = agent_id
        super.__init__(message)


class AgentProfileNotFoundError(Exception):
    """agent_id 未注册"""

    def __init__(self, agent_id: str, message: str) -> None:
        self.agent_id = agent_id
        super.__init__(message)


class ForgekinProfileNotFoundError(Exception):
    """Forgekin画像未找到"""

    def __init__(self, forgekin_id: str, message: str) -> None:
        self.forgekin_id = forgekin_id
        super.__init__(message)
```

### 3.4 配置加载器

```python
from pathlib import Path
import yaml
import importlib


class ExternalAgentProfileConfigLoader:
    """三方 Agent 画像 YAML 配置加载器

    加载 config/external_agent.yaml 中 profiles 段，
    构造 4 厂商 ExternalAgentCapabilityProfile 并注册到 Registry。
    """

    REQUIRED_PROFILE_FIELDS = [
        "provider",
        "agent_id",
        "display_name",
        "strengths",
        "blind_spots",
        "tool_calling_proficiency",
        "long_context_stability",
        "cost_per_1k_tokens",
        "avg_latency_ms",
        "historical_performance",
        "capability_domains",
    ]

    def __init__(
        self,
        config_path: str = "config/external_agent.yaml",
        registry: ExternalAgentProfileRegistry | None = None,
    ) -> None:
        self._config_path = Path(config_path).resolve
        self._registry = registry

    async def load_and_register(
        self,
        registry: ExternalAgentProfileRegistry | None = None,
    ) -> list[str]:
        """加载 YAML 并注册全部画像

        Returns:
            注册成功的 agent_id 列表
        """
        target_registry = registry or self._registry
        if target_registry is None:
            raise ValueError("registry must be provided")

        if not self._config_path.exists:
            raise FileNotFoundError(
                f"external_agent.yaml not found: {self._config_path}"
            )

        with open(self._config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)

        profiles_section = config.get("profiles", [])
        if not profiles_section:
            logger.warning(
                "No profiles section in external_agent.yaml",
                extra={"config_path": str(self._config_path)},
            )
            return []

        registered_ids: list[str] = []
        for entry in profiles_section:
            self._assert_fields_complete(entry)
            perf_data = entry["historical_performance"]
            # 启动期重新计算 Wilson 下界（防止配置陈旧）
            wilson = compute_wilson_lower_bound(
                success_count=perf_data["success_count"],
                total_calls=perf_data["total_calls"],
            )
            performance_log = PerformanceLog(
                total_calls=perf_data["total_calls"],
                success_count=perf_data["success_count"],
                wilson_lower_bound=wilson,
                avg_quality_score=perf_data.get("avg_quality_score", 0.0),
            )
            profile = ExternalAgentCapabilityProfile(
                provider=ExternalAgentProvider(entry["provider"]),
                agent_id=entry["agent_id"],
                display_name=entry["display_name"],
                strengths=entry["strengths"],
                blind_spots=entry["blind_spots"],
                tool_calling_proficiency=entry["tool_calling_proficiency"],
                long_context_stability=entry["long_context_stability"],
                cost_per_1k_tokens=entry["cost_per_1k_tokens"],
                avg_latency_ms=entry["avg_latency_ms"],
                historical_performance=performance_log,
                capability_domains=entry.get("capability_domains", []),
            )
            agent_id = await target_registry.register(profile)
            registered_ids.append(agent_id)

        logger.info(
            "All profiles loaded and registered",
            extra={
                "registered_count": len(registered_ids),
                "agent_ids": registered_ids,
            },
        )
        return registered_ids

    def _assert_fields_complete(self, entry: dict) -> None:
        missing = [
            f for f in self.REQUIRED_PROFILE_FIELDS if f not in entry
        ]
        if missing:
            raise ValueError(
                f"profile entry missing fields: {missing}; entry={entry}"
            )
```

### 3.5 external_agent.yaml 配置示例

```yaml
# config/external_agent.yaml
# 三方 Agent 画像 YAML 配置（外置，禁止 .py 硬编码厂商偏好）

profiles:
  - provider: claude_code
    agent_id: claude_code_main
    display_name: "Claude Code 主实例"
    strengths:
      - code_refactor
      - architecture_design
      - multi_file_edit
      - long_context_reasoning
    blind_spots:
      - command_line_long_task
      - enterprise_compliance
    tool_calling_proficiency: 0.92
    long_context_stability: 0.78
    cost_per_1k_tokens: 0.012
    avg_latency_ms: 1800
    historical_performance:
      total_calls: 12
      success_count: 11
      avg_quality_score: 0.88
    capability_domains:
      - code_refactor
      - architecture_design
      - code_review

  - provider: codex
    agent_id: codex_main
    display_name: "Codex 主实例"
    strengths:
      - code_reasoning
      - algorithm_design
      - code_review
      - test_generation
    blind_spots:
      - tool_calling
      - multi_file_edit
    tool_calling_proficiency: 0.65
    long_context_stability: 0.85
    cost_per_1k_tokens: 0.009
    avg_latency_ms: 2200
    historical_performance:
      total_calls: 8
      success_count: 7
      avg_quality_score: 0.86
    capability_domains:
      - code_review
      - algorithm_design
      - test_generation

  - provider: opencode
    agent_id: opencode_main
    display_name: "OpenCode 主实例"
    strengths:
      - open_source_collaboration
      - git_workflow
      - pr_review
    blind_spots:
      - enterprise_compliance
      - proprietary_ide_integration
    tool_calling_proficiency: 0.72
    long_context_stability: 0.70
    cost_per_1k_tokens: 0.006
    avg_latency_ms: 1500
    historical_performance:
      total_calls: 5
      success_count: 4
      avg_quality_score: 0.82
    capability_domains:
      - open_source_collaboration
      - pr_review

  - provider: trae
    agent_id: trae_main
    display_name: "Trae 主实例"
    strengths:
      - ide_integration
      - real_time_completion
      - quick_fix
      - proprietary_ide_integration
    blind_spots:
      - command_line_long_task
      - multi_file_edit
    tool_calling_proficiency: 0.88
    long_context_stability: 0.65
    cost_per_1k_tokens: 0.008
    avg_latency_ms: 800
    historical_performance:
      total_calls: 15
      success_count: 13
      avg_quality_score: 0.87
    capability_domains:
      - ide_integration
      - quick_fix
      - real_time_completion

# CapabilityMatcher 配置
capability_matcher:
  cost_weight: 0.6
  latency_weight: 0.4
  complement_score_threshold: 0.3
  wilson_small_sample_threshold: 30
```

### 3.6 DI 容器注册

```python
# core/di/container.py（节选，注册 ExternalAgentProfile 相关依赖）

from core.di.container import DIContainer
from core.external_agent.profile import (
    ExternalAgentProfileRegistry,
    HarnessExternalAgentProfileRegistry,
    CapabilityMatcher,
    HarnessCapabilityMatcher,
    ExternalAgentProfileConfigLoader,
)


def register_external_agent_profile_layer(
    container: DIContainer,
    config_path: str = "config/external_agent.yaml",
) -> None:
    """注册三方 Agent 能力画像层到 DI 容器

    注册顺序：
        1. Repository[ExternalAgentCapabilityProfile]（基于 F008）
        2. ExternalAgentProfileRegistry（Harness 实现）
        3. CapabilityMatcher（Harness 实现，依赖 Registry + Forgekin Repository）
        4. ExternalAgentProfileConfigLoader（启动期加载）
    """
    # 1. Repository（基于 F008 DurableStateSurfaces）
    profile_repo = container.resolve_repository(
        model_type="ExternalAgentCapabilityProfile",
    )

    # 2. Registry
    registry = HarnessExternalAgentProfileRegistry(
        profile_repository=profile_repo,
    )
    container.register_instance(
        ExternalAgentProfileRegistry, registry
    )

    # 3. CapabilityMatcher
    forgekin_repo = container.resolve_repository(
        model_type="CapabilityProfile",  # F001
    )
    matcher = HarnessCapabilityMatcher(
        forgekin_profile_repo=forgekin_repo,
        agent_profile_registry=registry,
        cost_weight=0.6,
        latency_weight=0.4,
    )
    container.register_instance(CapabilityMatcher, matcher)

    # 4. ConfigLoader
    loader = ExternalAgentProfileConfigLoader(
        config_path=config_path,
        registry=registry,
    )
    container.register_instance(
        ExternalAgentProfileConfigLoader, loader
    )
```

### 3.7 启动期加载流程

```python
# app/main.py（节选，启动期加载 external_agent.yaml）

async def startup_load_external_agent_profiles(
    container: DIContainer,
) -> None:
    """启动期加载 external_agent.yaml 中 4 厂商画像

    必须在 ExternalAgentBridge（D031）初始化前完成。
    """
    loader = container.resolve(ExternalAgentProfileConfigLoader)
    registered_ids = await loader.load_and_register
    logger.info(
        "Startup external agent profiles loaded",
        extra={"registered_count": len(registered_ids)},
    )
```

---

## 4. 跨模块协作实现

### 4.1 与 D031 ExternalAgentBridge 协作

ExternalAgentBridge 在选择 Adapter 时调用 CapabilityMatcher.match_for_task 决策最优厂商。

```python
# core/external_agent/bridge.py（D031 节选，展示与 D032 协作）

class ExternalAgentBridge:
    def __init__(
        self,
        adapter_registry: "ExternalAgentAdapterRegistry",
        capability_matcher: CapabilityMatcher,  # 来自 D032
        profile_registry: ExternalAgentProfileRegistry,  # 来自 D032
        # ... 其他依赖
    ) -> None:
        self._adapters = adapter_registry
        self._matcher = capability_matcher
        self._profiles = profile_registry

    async def invoke(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
        task_capability_requirements: list[str] | None = None,
    ) -> ExternalAgentResult:
        # 1. CapabilityMatcher 决策候选厂商链
        candidates = await self._matcher.match_for_task(
            forgekin_profile_id=forgekin_id,
            task_capability_requirements=task_capability_requirements or [],
        )
        if not candidates:
            # 无候选，降级到内置 agent（D034 处理）
            return await self._degrade_to_builtin(task)

        # 2. 按候选顺序尝试（首个即最优）
        for candidate in candidates:
            adapter = self._adapters.get_by_agent_id(candidate.agent_id)
            if adapter is None:
                continue
            try:
                result = await adapter.invoke(task)
                # 3. 调用成功后通过 Eval 信号回流 PerformanceLog
                await self._update_performance_via_eval(
                    agent_id=candidate.agent_id,
                    result=result,
                )
                return result
            except Exception as e:
                logger.warning(
                    "Adapter invoke failed, will try next candidate",
                    extra={
                        "agent_id": candidate.agent_id,
                        "error": str(e),
                    },
                )
                continue

        # 4. 全部失败，降级到内置（D034 fallback 链处理）
        return await self._degrade_to_builtin(task)

    async def _update_performance_via_eval(
        self,
        agent_id: str,
        result: ExternalAgentResult,
    ) -> None:
        """通过 F018 Eval 信号更新 PerformanceLog"""
        # 调用 F018 Eval Contract 收集质量分
        quality_score = await self._eval_contract.score(result)
        # 读取当前 PerformanceLog
        profile = await self._profiles.get(agent_id)
        current = profile.historical_performance
        # 增量更新
        await self._profiles.update_performance(
            agent_id=agent_id,
            new_call_total=current.total_calls + 1,
            new_success_count=current.success_count + (1 if result.success else 0),
            new_quality_score=quality_score,
        )
```

### 4.2 与 F001 CapabilityProfile 协作

ExternalAgentCapabilityProfile 与 F001 CapabilityProfile 数据模型对齐，便于盲点互补配对。

```python
# F001 CapabilityProfile 节选（仅供对齐参考）
# class CapabilityProfile(BaseModel):
#     profile_id: str
#     forgekin_id: str
#     strengths: list[str]
#     blind_spots: list[str]
#     proficiency: dict[str, float]
#     historical_performance: PerformanceLog  # 复用同一数据结构
```

对齐点：
- `strengths` / `blind_spots` 字段名一致，集合运算直接进行。
- `historical_performance` 复用 PerformanceLog，Wilson 下界计算逻辑共用。
- `proficiency` 与 `tool_calling_proficiency` / `long_context_stability` 语义对齐（前者是字典，后者是分维标量，互不冲突）。

### 4.3 与 F002 TeamAct 跨厂商 review 配对协作

```python
# workers/teamact/cross_vendor_review.py（F002 节选，展示与 D032 协作）

class CrossVendorReviewOrchestrator:
    def __init__(
        self,
        capability_matcher: CapabilityMatcher,  # 来自 D032
        bridge: ExternalAgentBridge,  # 来自 D031
    ) -> None:
        self._matcher = capability_matcher
        self._bridge = bridge

    async def orchestrate(
        self,
        primary_agent_id: str,
        review_target: dict,
    ) -> dict:
        # 1. 找盲点互补的 complementary agent
        complementary = await self._matcher.find_complementary_pair(
            primary_agent_id=primary_agent_id,
        )
        if complementary is None:
            return {
                "status": "skipped",
                "reason": "no complementary agent found",
            }

        # 2. primary 写代码 / 产出
        primary_result = await self._bridge.invoke(
            forgekin_id="...",
            task=ExternalAgentTask(...),
        )

        # 3. complementary review primary 的产出
        review_task = ExternalAgentTask(
            task_id=f"review_{primary_result.task_id}",
            description=f"Review primary agent output",
            input_data={"target": primary_result.output},
            expected_output={"review_comments": "list[str]"},
        )
        review_result = await self._bridge.invoke(
            forgekin_id="...",
            task=review_task,
        )

        return {
            "status": "completed",
            "primary_agent_id": primary_agent_id,
            "complementary_agent_id": complementary.agent_id,
            "primary_result": primary_result.dict,
            "review_result": review_result.dict,
        }
```

### 4.4 与 D034 FallbackChainBuilder 协作

```python
# core/external_agent/fallback.py（D034 节选，展示与 D032 协作）

class HarnessFallbackChainBuilder(FallbackChainBuilder):
    def __init__(
        self,
        capability_matcher: CapabilityMatcher,  # 来自 D032
    ) -> None:
        self._matcher = capability_matcher

    async def build_for_task(
        self,
        task_requirements: list[str],
        forgekin_profile_id: str,
    ) -> FallbackChain:
        # 1. CapabilityMatcher.match_for_task 获取候选厂商
        candidates = await self._matcher.match_for_task(
            forgekin_profile_id=forgekin_profile_id,
            task_capability_requirements=task_requirements,
        )
        # 2. rank_by_cost_latency 按成本排序
        ranked = await self._matcher.rank_by_cost_latency(candidates)
        # 3. 为每个厂商配置 5 种 trigger -> action 映射
        steps = self._build_steps_from_ranked(ranked)
        return FallbackChain(
            chain_id=f"chain_{forgekin_profile_id}_{hash(tuple(task_requirements))}",
            task_signature=str(task_requirements),
            steps=steps,
            built_from_profile=True,
        )
```

### 4.5 与 D035 CapabilityFusion 协作

```python
# core/external_agent/capability_fusion.py（D035 节选，展示与 D032 协作）

class HarnessFusionSourceCollector(FusionSourceCollector):
    def __init__(
        self,
        profile_registry: ExternalAgentProfileRegistry,  # 来自 D032
    ) -> None:
        self._profiles = profile_registry

    async def collect(
        self,
        call_record: dict,
        quality_score: float,
    ) -> Optional[FusionSource]:
        if quality_score < 0.85:
            return None  # 质量分不足，不采集
        # 通过 ExternalAgentCapabilityProfile.agent_id 引用画像
        agent_id = call_record["agent_id"]
        profile = await self._profiles.get(agent_id)
        return FusionSource(
            source_id=f"fs_{call_record['task_id']}",
            forgekin_id=call_record["forgekin_id"],
            external_agent_id=agent_id,
            external_agent_profile_ref=profile.agent_id,
            task_context=call_record["task_context"],
            call_artifacts=call_record.get("artifacts", []),
            call_quality_score=quality_score,
            call_timestamp=datetime.now,
        )
```

### 4.6 完整时序图：match_for_task 调用决策

```
[Forgekin] --invoke(forgekin_id, task, requirements)--> [ExternalAgentBridge]
                                                              |
                                                              | 1. match_for_task
                                                              v
                                                        [CapabilityMatcher]
                                                              |
                                                              | 2. find_by_id(forgekin_id)
                                                              v
                                                        [ForgekinProfileRepo (F001)]
                                                              |
                                                              | <--- Forgekin CapabilityProfile
                                                              v
                                                        [CapabilityMatcher]
                                                              |
                                                              | 3. list_all
                                                              v
                                                        [ExternalAgentProfileRegistry]
                                                              |
                                                              | <--- 4 个 ExternalAgentCapabilityProfile
                                                              v
                                                        [CapabilityMatcher]
                                                              |
                                                              | 4. compute_blind_spot_complement_score
                                                              |    (forgekin_blind_spots ∩ agent_strengths)
                                                              v
                                                        [CapabilityMatcher]
                                                              |
                                                              | 5. 过滤 score < 0.3 + 任务能力需求
                                                              v
                                                        [CapabilityMatcher]
                                                              |
                                                              | 6. 按 score 降序排序
                                                              v
[ExternalAgentBridge] <---candidates: [best, second, third]-- [CapabilityMatcher]
        |
        | 7. 按候选顺序尝试 invoke(task)
        v
[ClaudeCodeAdapter] ---success---> [ExternalAgentBridge]
                                       |
                                       | 8. update_performance_via_eval
                                       v
                                 [ExternalAgentProfileRegistry.update_performance]
                                       |
                                       | 9. compute_wilson_lower_bound
                                       v
                                 [Repository.save]
                                       |
                                       v
[ExternalAgentBridge] <---result--- [ExternalAgentProfileRegistry]
```

---

## 5. 详细设计验收

### 5.1 功能验收（Functional AC）

- [ ] **AC-F-01**: ExternalAgentProvider 枚举仅含 4 厂商（claude_code/codex/opencode/trae），运行时尝试新增厂商触发 ProviderNotInEnumError。
- [ ] **AC-F-02**: ExternalAgentCapabilityProfile 六维字段完整，缺任一字段（如 strengths 为空列表）触发 SixDimensionsIncompleteError。
- [ ] **AC-F-03**: ExternalAgentCapabilityProfile.model_config 禁止额外字段（extra="forbid"），YAML 误加字段触发 ValidationError。
- [ ] **AC-F-04**: PerformanceLog 校验 success_count <= total_calls，违反触发 ValueError。
- [ ] **AC-F-05**: compute_wilson_lower_bound(0, 0) 返回 0.0；compute_wilson_lower_bound(3, 3) 返回约 0.46（非 1.0）。
- [ ] **AC-F-06**: compute_wilson_lower_bound(30, 28) 返回值与平均值 0.933 接近（差异 < 0.1）。
- [ ] **AC-F-07**: compute_blind_spot_complement_score 在 forgekin_blind_spots 与 agent_strengths 完全互补时返回 1.0。
- [ ] **AC-F-08**: compute_blind_spot_complement_score 在 forgekin_strengths 与 agent_blind_spots 完全冲突时返回 0.0。
- [ ] **AC-F-09**: assert_blind_spots_not_overlapping 在盲点交集非空时抛 BlindSpotsOverlapError。
- [ ] **AC-F-10**: rank_by_cost_latency_impl 在单候选时返回该候选；在多候选时按归一化 cost+latency 加权升序排序。
- [ ] **AC-F-11**: HarnessExternalAgentProfileRegistry.register 重复注册同 agent_id 触发 AgentIdConflictError。
- [ ] **AC-F-12**: HarnessExternalAgentProfileRegistry.get 未注册 agent_id 触发 AgentProfileNotFoundError。
- [ ] **AC-F-13**: HarnessCapabilityMatcher.match_for_task 在Forgekin画像未找到时触发 ForgekinProfileNotFoundError。
- [ ] **AC-F-14**: HarnessCapabilityMatcher.match_for_task 过滤 score < COMPLEMENT_SCORE_THRESHOLD (0.3) 的候选。
- [ ] **AC-F-15**: HarnessCapabilityMatcher.match_for_task 过滤不满足 task_capability_requirements 的候选。
- [ ] **AC-F-16**: HarnessCapabilityMatcher.find_complementary_pair 仅在同候选为不同厂商时返回，同厂商候选被排除。
- [ ] **AC-F-17**: HarnessCapabilityMatcher.find_complementary_pair 在所有候选盲点与 primary 重叠时返回 None。
- [ ] **AC-F-18**: ExternalAgentProfileConfigLoader.load_and_register 加载 4 厂商画像并返回 4 个 agent_id。
- [ ] **AC-F-19**: ExternalAgentProfileConfigLoader 在 YAML 缺失 profile 字段时抛 ValueError。
- [ ] **AC-F-20**: update_performance 增量更新 historical_performance 并重新计算 Wilson 下界。

### 5.2 性能验收（Performance AC）

- [ ] **AC-P-01**: compute_wilson_lower_bound 单次调用 < 1ms（纯数学计算）。
- [ ] **AC-P-02**: compute_blind_spot_complement_score 单次调用 < 1ms（集合运算 + O(n) 比较）。
- [ ] **AC-P-03**: HarnessExternalAgentProfileRegistry.list_all 100 个画像返回 < 50ms（Repository 抽象，单次查询）。
- [ ] **AC-P-04**: HarnessCapabilityMatcher.match_for_task 在 4 厂商画像下完成 < 30ms（4 次集合运算 + 排序）。
- [ ] **AC-P-05**: HarnessCapabilityMatcher.find_complementary_pair 在 4 厂商画像下完成 < 30ms。
- [ ] **AC-P-06**: ExternalAgentProfileConfigLoader.load_and_register 加载 4 厂商画像 < 100ms（YAML 解析 + 4 次 register）。
- [ ] **AC-P-07**: rank_by_cost_latency_impl 100 候选排序 < 5ms。
- [ ] **AC-P-08**: update_performance 单次更新 < 20ms（包含 Wilson 下界重算 + Repository save）。

### 5.3 安全验收（Security AC）

- [ ] **AC-S-01**: external_agent.yaml 中无 API key / endpoint / port 硬编码（这些应在 separate 段或环境变量）。
- [ ] **AC-S-02**: ExternalAgentCapabilityProfile 字段类型严格（Pydantic 校验），无法注入恶意字符串。
- [ ] **AC-S-03**: Repository 层抽象保证无直接数据库操作（grep "cursor.execute" / "session.add" 在 profile.py 中为空）。
- [ ] **AC-S-04**: 4 厂商枚举不可扩展，运行时无法通过 YAML 注入第 5 厂商。
- [ ] **AC-S-05**: ExternalAgentProfileConfigLoader 使用 yaml.safe_load（非 yaml.load），防止 YAML 反序列化攻击。
- [ ] **AC-S-06**: BlindSpotsOverlapError 错误信息不泄漏敏感数据（仅含盲点标签列表）。
- [ ] **AC-S-07**: cost_per_1k_tokens / avg_latency_ms 字段有 gt=0 约束，防止 0 或负数导致排序异常。
- [ ] **AC-S-08**: model_config extra="forbid" 防止 YAML 误加字段污染数据模型。
- [ ] **AC-S-09**: DI 容器注入保证 Repository 实例唯一性，避免重复实例化导致状态不一致。
- [ ] **AC-S-10**: logger 输出不含敏感信息（仅含 agent_id / provider / score 等指标）。

### 5.4 Eval 验收（Eval AC）

- [ ] **AC-E-01**: 调用成功后通过 F018 Eval Contract 评分，质量分回流到 PerformanceLog.avg_quality_score。
- [ ] **AC-E-02**: PerformanceLog.wilson_lower_bound 在小样本（< 30 次）下严格小于平均值（保守估计）。
- [ ] **AC-E-03**: PerformanceLog.wilson_lower_bound 在大样本（>= 30 次）下接近平均值（差异 < 0.1）。
- [ ] **AC-E-04**: update_performance 调用后 wilson_lower_bound 自动重算（不依赖配置陈旧值）。
- [ ] **AC-E-05**: CapabilityMatcher 排序结果在相同输入下确定性输出（同分按 agent_id 字典序）。
- [ ] **AC-E-06**: 启动期 ConfigLoader 重新计算 Wilson 下界，防止 YAML 配置陈旧导致偏差。

### 5.5 集成测试点（Integration Test Points）

| 测试 ID | 测试场景 | 验证点 |
|---------|---------|--------|
| IT-D032-001 | 启动期加载 external_agent.yaml 4 厂商画像 | 4 个 agent_id 注册成功，list_all 返回 4 个画像 |
| IT-D032-002 | 重复注册同 agent_id | 触发 AgentIdConflictError |
| IT-D032-003 | 注册 provider 不在枚举 | 触发 ProviderNotInEnumError |
| IT-D032-004 | 注册六维字段缺失 | 触发 SixDimensionsIncompleteError |
| IT-D032-005 | YAML 误加额外字段 | 触发 Pydantic ValidationError |
| IT-D032-006 | match_for_task 完全互补场景 | 返回候选列表按 score 降序 |
| IT-D032-007 | match_for_task 完全冲突场景 | 返回空列表（所有候选被过滤） |
| IT-D032-008 | match_for_task 任务能力需求过滤 | 不满足需求的候选被过滤 |
| IT-D032-009 | find_complementary_pair 不同厂商互补 | 返回 complementary 画像 |
| IT-D032-010 | find_complementary_pair 盲点重叠 | 跳过该候选，继续找下一个 |
| IT-D032-011 | find_complementary_pair 无可用候选 | 返回 None |
| IT-D032-012 | rank_by_cost_latency 单候选 | 返回该候选 |
| IT-D032-013 | rank_by_cost_latency 多候选 | 按归一化 cost+latency 加权升序 |
| IT-D032-014 | update_performance 增量更新 | total_calls +1，wilson_lower_bound 重算 |
| IT-D032-015 | compute_wilson_lower_bound(0, 0) | 返回 0.0 |
| IT-D032-016 | compute_wilson_lower_bound(3, 3) | 返回约 0.46（非 1.0） |
| IT-D032-017 | compute_wilson_lower_bound(30, 28) | 与平均值 0.933 接近 |
| IT-D032-018 | DI 容器注入校验 | Bridge 通过容器获取 CapabilityMatcher 实例 |
| IT-D032-019 | 单向依赖校验 | profile.py 无 *Forge 反向 import |
| IT-D032-020 | Repository 层抽象校验 | profile.py 无直接数据库操作 |

### 5.6 错误处理矩阵

| 错误场景 | 异常类型 | 处理策略 | 上报层级 |
|---------|---------|---------|---------|
| provider 不在 4 厂商枚举 | ProviderNotInEnumError | 拒绝注册，启动期失败 | operator |
| 六维字段缺失 | SixDimensionsIncompleteError | 拒绝注册，启动期失败 | operator |
| agent_id 已注册 | AgentIdConflictError | 拒绝注册，启动期失败 | operator |
| agent_id 未注册 | AgentProfileNotFoundError | 调用方处理（如 Bridge 跳过） | logger.warning |
| Forgekin画像未找到 | ForgekinProfileNotFoundError | match_for_task 失败，Bridge 降级 | logger.error |
| 跨厂商 review 盲点重叠 | BlindSpotsOverlapError | 跳过该候选，继续找下一个 | logger.debug |
| YAML 文件不存在 | FileNotFoundError | 启动期失败 | operator |
| YAML 字段缺失 | ValueError | 启动期失败 | operator |
| YAML 反序列化攻击 | yaml.safe_load 拒绝 | 启动期失败 | operator |
| Repository 写入失败 | Repository 异常 | 透传到调用方 | logger.error |
| Wilson 下界浮点误差 | max(0.0, min(1.0, x)) 裁剪 | 静默处理 | 无 |
| 排序平局 | 按 agent_id 字典序 | 确定性输出 | 无 |

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../features/F032-external-agent-profile.md]（同号 Feature 级 SRS）
- [doc:../architecture/A032-external-agent-profile.md]（同号 Architecture 级 SAD）
- [doc:../features/F001-capability-profile.md]（CapabilityProfile 对齐）
- [doc:../features/F002-teamact-loop.md]（跨厂商 review 配对）
- [doc:../features/F014-memory-collection.md]（PerformanceLog EchoStore归档）
- [doc:../features/F018-eval-contract.md]（Eval 信号回流）
- [doc:D031-external-agent-adapter.md]（ExternalAgentBridge 容器）
- [doc:D034-external-agent-fallback.md]（FallbackChainBuilder 基于 match_for_task）
- [doc:D035-external-agent-capability-fusion.md]（FusionSource 引用 agent_id）
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../design/naming-contract.md]（双轨命名 ForgeMind/Forgekin）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（4 厂商枚举 + 六维画像 + Wilson 下界算法 + 盲点互补配对 + 跨厂商 review 配对 + rank_by_cost_latency + ConfigLoader + DI 注入 + 20 集成测试点 + 20 功能 AC + 8 性能 AC + 10 安全 AC + 6 Eval AC） | 架构师 Forgekin（猫头鹰·鲁班） |

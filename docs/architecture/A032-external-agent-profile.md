# A032: 三方 Agent 能力画像架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）
> **对应 arch.md**: [doc:../arch.md#§3.10]
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）
> **对应 Feature**: [doc:../features/F032-external-agent-profile.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D032-external-agent-profile.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]

---

## 1. 架构上下文

### 1.1 架构问题

ExternalAgentAdapter 抽象层（A031）需要为三方 Agent 建立能力画像，使Forgekin基于能力匹配选择合适的三方 Agent，而非按"配置默认值"或固定编号顺序调用。本架构在 `core/external_agent/profile.py` 建立三方 Agent 能力画像层，解决以下架构层问题：

1. **能力画像数据模型缺失**：三方 Agent 无 strengths/blind_spots/tool_calling_proficiency/long_context_stability 等结构化字段。
2. **盲点互补配对未编码**：Forgekin盲点与三方 Agent 擅长无匹配机制，导致调用选择次优。
3. **跨厂商 review 配对缺失**：primary agent 与 complementary agent 配对未约束盲点不重叠，可能导致 review 质量低。
4. **历史表现无 Wilson 下界**：小样本下三方 Agent 可靠性评估未使用 Wilson 下界，存在小样本偏差。
5. **成本/延迟信号未纳入决策**：F034 fallback 决策时无 cost_per_1k_tokens + avg_latency_ms 排序依据。

### 1.2 架构约束

- **单向依赖约束**：ExternalAgentProfileRegistry 必须单向依赖 F001 CapabilityProfile 抽象 + F002 TeamAct，禁止反向依赖 *Forge。
- **DI 容器约束**：ExternalAgentProfileRegistry / CapabilityMatcher 实例必须通过 DI 容器注入到 ExternalAgentBridge。
- **Repository 层约束**：ExternalAgentCapabilityProfile 持久化必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：4 厂商（claude_code/codex/opencode/trae）的 strengths/blind_spots/proficiency/cost/latency 必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码厂商偏好。
- **Wilson 下界约束**：小样本（< 30 次）历史表现评估必须使用 Wilson 下界，禁止直接用平均值。
- **盲点互补约束**：CapabilityMatcher 必须基于盲点互补配对，Forgekin盲点 ∩ 三方 Agent 擅长 = 高匹配分。

### 1.3 架构影响

- **对 F001 能力画像的影响**：ExternalAgentCapabilityProfile 与 CapabilityProfile 数据模型对齐，复用 PerformanceLog。
- **对 F002 TeamAct 的影响**：跨厂商 review 配对联动 F002 跨厂商 review 逻辑。
- **对 F034 失败回退的影响**：FallbackChainBuilder 基于 ExternalAgentCapabilityProfile 盲点互补 + 成本排序构建 fallback 链。
- **对 F035 能力融合的影响**：ExternalAgentCapabilityProfile 作为能力融合来源画像。
- **对 A031 ExternalAgentBridge 的影响**：Bridge 在选择 Adapter 时调用 CapabilityMatcher.match_for_task 决策最优厂商。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |        core/external_agent/profile.py           |
                    |                                                 |
                    |  +-------------------+                          |
                    |  | ExternalAgent     |  4 厂商枚举              |
                    |  | Provider (Enum)   |  (claude_code/codex/     |
                    |  +---------+---------+  opencode/trae)          |
                    |            |                                    |
                    |            v                                    |
                    |  +-------------------+   +-------------------+ |
                    |  | ExternalAgent     |<->| ExternalAgent     | |
                    |  | CapabilityProfile |   | ProfileRegistry   | |
                    |  | (六维画像 + 盲点)  |   | (YAML 配置驱动)   | |
                    |  +---------+---------+   +---------+---------+ |
                    |            |                       |           |
                    |  +---------v---------+             |           |
                    |  | PerformanceLog    |             |           |
                    |  | (复用 F001)       |             |           |
                    |  +-------------------+             |           |
                    |                                    v           |
                    |  +------------------------------------------+ |
                    |  | CapabilityMatcher                        | |
                    |  | (Forgekin画像 × 三方 Agent 画像 匹配)       | |
                    |  +------------------------------------------+ |
                    |   |-- match_for_task                       | |
                    |   |   `--> 盲点互补 + 任务能力需求匹配        | |
                    |   `-- find_complementary_pair              | |
                    |       `--> 跨厂商 review 配对（盲点不重叠）   | |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  上游依赖（DI 注入）                      |
                    |  F001 CapabilityProfile (Forgekin 画像)   |
                    |  F002 TeamAct (跨厂商 review)             |
                    +-------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  下游消费方                                |
                    |  A031 ExternalAgentBridge (调用决策)       |
                    |  F034 FallbackChainBuilder (链构建)        |
                    |  F035 CapabilityFusion (融合来源)          |
                    +-------------------------------------------+
```

### 2.2 关键架构决策

- **决策 1：六维能力画像数据模型（对标 F001 CapabilityProfile）**
  ExternalAgentCapabilityProfile 包含 strengths / blind_spots / tool_calling_proficiency / long_context_stability / cost_per_1k_tokens / avg_latency_ms 六维。前两维是定性能力描述，中间两维是定量熟练度（0.0-1.0），后两维是成本/延迟信号。与 F001 CapabilityProfile 数据模型对齐，便于盲点互补配对。

- **决策 2：4 厂商枚举固定不可扩展**
  ExternalAgentProvider 固定为 claude_code/codex/opencode/trae 四厂商，覆盖业界主流编程 Agent。新增厂商必须经 ADR 决策。这避免运行时动态注册导致画像字段缺失。

- **决策 3：盲点互补配对算法**
  CapabilityMatcher.match_for_task 基于盲点互补：Forgekin盲点 ∩ 三方 Agent 擅长 = 高匹配分；Forgekin擅长 ∩ 三方 Agent 盲点 = 低匹配分（不选）。任务能力需求作为额外过滤条件。这保证选择最能补齐Forgekin盲点的厂商。

- **决策 4：跨厂商 review 配对盲点不重叠**
  CapabilityMatcher.find_complementary_pair 为 primary agent 找盲点互补的 complementary agent，且 primary 与 complementary 盲点不重叠。这联动 F002 跨厂商 review 逻辑，保证 review 质量不因双方盲点重叠而失效。

- **决策 5：Wilson 下界处理小样本偏差**
  PerformanceLog 的 Wilson 下界用于小样本可靠性评估（< 30 次调用时）。与 F001 CapabilityProfile 一致。这避免小样本下平均值高估可靠性。

- **决策 6：成本/延迟信号供 F034 fallback 决策**
  cost_per_1k_tokens + avg_latency_ms 作为 F034 FallbackChainBuilder 决策信号，按成本升序 + 延迟升序构建 fallback 链。这使 fallback 选择成本最优厂商。

### 2.3 架构不变量

- ExternalAgentProvider 枚举必须固定 4 厂商，禁止运行时动态新增厂商。
- ExternalAgentCapabilityProfile 必须包含六维字段（strengths/blind_spots/tool_calling_proficiency/long_context_stability/cost_per_1k_tokens/avg_latency_ms），缺一即注册被拒绝。
- CapabilityMatcher 必须基于盲点互补配对，禁止按厂商编号顺序匹配。
- 跨厂商 review 配对必须满足盲点不重叠约束，违反即配对被拒绝。
- 小样本（< 30 次）历史表现评估必须使用 Wilson 下界，禁止直接用平均值。
- 4 厂商画像配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码厂商偏好。
- ExternalAgentCapabilityProfile 持久化必须通过 Repository 层，禁止直接操作数据库。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| ExternalAgentProvider | `core/external_agent/profile.py` | 4 厂商枚举（不可扩展） |
| ExternalAgentCapabilityProfile | `core/external_agent/profile.py` | 三方 Agent 能力画像数据模型（六维） |
| ExternalAgentProfileRegistry | `core/external_agent/profile.py` | 能力画像注册表（YAML 配置驱动） |
| CapabilityMatcher | `core/external_agent/profile.py` | 能力匹配器（盲点互补 + 跨厂商 review 配对） |
| PerformanceLog | 复用 F001 | 历史表现记录（Wilson 下界） |
| ExternalAgentConfig | `config/external_agent.yaml` | 4 厂商画像 YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class ExternalAgentProvider(str, Enum):
    """三方 Agent 厂商（4 个，不可扩展）"""
    CLAUDE_CODE = "claude_code"   # 擅长复杂重构，盲点：长上下文易漂移
    CODEX = "codex"               # 擅长推理，盲点：工具调用弱
    OPENCODE = "opencode"         # 擅长开源协作，盲点：企业场景弱
    TRAE = "trae"                 # 擅长 IDE 集成，盲点：命令行长任务弱


class PerformanceLog(BaseModel):
    """历史表现记录（复用 F001 PerformanceLog，含 Wilson 下界）"""
    total_calls: int
    success_count: int
    wilson_lower_bound: float = Field(ge=0.0, le=1.0)
    avg_quality_score: float = Field(ge=0.0, le=1.0)


class ExternalAgentCapabilityProfile(BaseModel):
    """三方 Agent 能力画像（六维，对标 F001 CapabilityProfile）"""
    provider: ExternalAgentProvider
    agent_id: str                              # 厂商内 agent 实例 ID
    strengths: list[str]                       # 擅长能力
    blind_spots: list[str]                     # 盲点（用于跨厂商互补配对）
    tool_calling_proficiency: float = Field(ge=0.0, le=1.0)
    long_context_stability: float = Field(ge=0.0, le=1.0)
    cost_per_1k_tokens: float
    avg_latency_ms: int
    historical_performance: PerformanceLog


class ExternalAgentProfileRegistry(ABC):
    """三方 Agent 能力画像注册表（YAML 配置驱动）"""

    @abstractmethod
    async def register(
        self, profile: ExternalAgentCapabilityProfile
    ) -> str:
        """注册能力画像（仅启动时由 YAML 加载调用）"""
        ...

    @abstractmethod
    async def get(self, agent_id: str) -> ExternalAgentCapabilityProfile:
        """获取能力画像"""
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


class CapabilityMatcher(ABC):
    """能力匹配器（Forgekin能力画像 × 三方 Agent 能力画像）"""

    @abstractmethod
    async def match_for_task(
        self,
        forgekin_profile_id: str,
        task_capability_requirements: list[str],
    ) -> list[ExternalAgentCapabilityProfile]:
        """
        基于盲点互补 + 任务能力需求匹配
        - Forgekin盲点 ∩ 三方 Agent 擅长 = 高匹配分
        - Forgekin擅长 ∩ 三方 Agent 盲点 = 低匹配分（不选）
        - 任务能力需求作为额外过滤条件
        """
        ...

    @abstractmethod
    async def find_complementary_pair(
        self, primary_agent_id: str
    ) -> Optional[ExternalAgentCapabilityProfile]:
        """
        找盲点互补的 review 配对（与 F002 跨厂商 review 联动）
        - primary 与 complementary 盲点不重叠
        - 用于跨厂商 review 场景
        """
        ...

    @abstractmethod
    async def rank_by_cost_latency(
        self, candidates: list[ExternalAgentCapabilityProfile]
    ) -> list[ExternalAgentCapabilityProfile]:
        """按 cost_per_1k_tokens + avg_latency_ms 升序排序（F034 fallback 决策）"""
        ...
```

### 3.3 数据流

```
[启动阶段]
    config/external_agent.yaml
    |-- claude_code_main: strengths/blind_spots/proficiency/...
    |-- codex_main: strengths/blind_spots/proficiency/...
    |-- opencode_main: strengths/blind_spots/proficiency/...
    `-- trae_main: strengths/blind_spots/proficiency/...
        |
        v
    ExternalAgentProfileRegistry.register(profile) [4 厂商]
        |
        v
    注册表就绪

[Forgekin调用决策阶段（A031 Bridge 调用）]
    ExternalAgentBridge.invoke(forgekin_id, task)
        |
        v
    CapabilityMatcher.match_for_task(forgekin_profile_id, task_capability_requirements)
        |
        v
    读取Forgekin CapabilityProfile (F001) -> 拿到Forgekin strengths + blind_spots
        |
        v
    遍历 ExternalAgentProfileRegistry.list_all
        |
        v
    计算盲点互补分：
    - Forgekin盲点 ∩ 三方 Agent 擅长 -> 高分
    - Forgekin擅长 ∩ 三方 Agent 盲点 -> 低分（排除）
    - 任务能力需求过滤
        |
        v
    返回排序列表 [best, second, third, ...]
        |
        v
    ExternalAgentBridge 按 fallback 链调用

[跨厂商 review 配对阶段（F002 联动）]
    CapabilityMatcher.find_complementary_pair(primary_agent_id)
        |
        v
    读取 primary ExternalAgentCapabilityProfile.blind_spots
        |
        v
    遍历其他厂商画像，找 blind_spots 不重叠的画像
        |
        v
    返回 complementary ExternalAgentCapabilityProfile
        |
        v
    F002 跨厂商 review 编排（primary 写代码, complementary review）

[F034 fallback 链构建阶段]
    FallbackChainBuilder.build_for_task(task_requirements, forgekin_profile_id)
        |
        v
    CapabilityMatcher.match_for_task -> candidates
        |
        v
    CapabilityMatcher.rank_by_cost_latency(candidates)
        `--> 按 cost + latency 升序构建 fallback 链
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F001 CapabilityProfile**：Forgekin能力画像作为盲点互补匹配输入；复用 PerformanceLog 数据模型。
- **依赖 F002 TeamAct**：跨厂商 review 配对联动 F002 跨厂商 review 逻辑。
- **依赖 core/interfaces**：Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 A031 ExternalAgentBridge**：Bridge 在选择 Adapter 时调用 CapabilityMatcher.match_for_task 决策最优厂商。
- **影响 F034 失败回退**：FallbackChainBuilder 基于 ExternalAgentCapabilityProfile 盲点互补 + 成本排序构建 fallback 链。
- **影响 F035 能力融合**：ExternalAgentCapabilityProfile 作为能力融合来源画像。
- **影响 F033 状态共享**：ExternalAgentSharedState 的 modification_log 中 agent_id 字段引用 ExternalAgentCapabilityProfile.agent_id。

### 4.3 跨模块不变量

- 4 厂商枚举必须固定，禁止运行时新增厂商。
- ExternalAgentCapabilityProfile 六维字段必须完整，缺一即注册被拒绝。
- CapabilityMatcher 必须基于盲点互补配对，禁止按厂商编号顺序匹配。
- 跨厂商 review 配对必须满足盲点不重叠约束。
- 小样本（< 30 次）历史表现评估必须使用 Wilson 下界。
- 4 厂商画像配置必须 YAML 外置，禁止 .py 硬编码厂商偏好。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— `core/external_agent/profile.py` 仅依赖 F001/F002，无 *Forge 反向 import。
- [ ] AC-2: DI 容器注入通过 —— ExternalAgentProfileRegistry / CapabilityMatcher 通过 DI 容器注入到 ExternalAgentBridge。
- [ ] AC-3: Repository 层通过 —— ExternalAgentCapabilityProfile 持久化通过 Repository，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— 4 厂商画像 YAML 外置到 `config/external_agent.yaml`。
- [ ] AC-5: Wilson 下界通过 —— PerformanceLog 含 wilson_lower_bound 字段且小样本时被使用。

### 5.2 架构不变量验收

- [ ] AC-6: 4 厂商枚举不变量通过 —— ExternalAgentProvider 仅含 4 厂商，运行时无法新增。
- [ ] AC-7: 六维字段不变量通过 —— 缺任一字段的 ExternalAgentCapabilityProfile 注册被拒绝。
- [ ] AC-8: 盲点互补不变量通过 —— CapabilityMatcher 匹配结果按盲点互补分排序，非厂商编号顺序。
- [ ] AC-9: 跨厂商 review 配对不变量通过 —— primary 与 complementary 盲点不重叠，违反即配对被拒绝。
- [ ] AC-10: 成本排序不变量通过 —— rank_by_cost_latency 返回结果按 cost + latency 升序。

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）
- [doc:../arch.md#§3.10]（三方 Agent 集成）
- [doc:../features/F032-external-agent-profile.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]
- [doc:../features/F002-teamact-loop.md]
- [doc:../features/F031-external-agent-adapter.md]
- [doc:../features/F033-external-agent-shared-state.md]
- [doc:../features/F034-external-agent-fallback.md]
- [doc:../features/F035-external-agent-capability-fusion.md]
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../design/naming-contract.md]（能力画像 Capability Profile）
- [doc:../../../hiclaw/rules.md#第十一部分]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（六维能力画像 + 盲点互补 + 跨厂商 review 配对 + Wilson 下界架构） | 架构师 Forgekin（猫头鹰·鲁班） |

# Feature F032: 三方 Agent 能力画像

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#EX-002] + [doc:roleagent.md#第0章]
> **关联 ADR**: [doc:decisions/006-external-agent-integration.md]
> **类型**: external-agent
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

三方 Agent 能力画像（External Agent Capability Profile）是 forgemind 应用层对三方 Agent（claude code / codex / opencode / trae 等）的能力建模：每个三方 Agent 有自己的 CapabilityProfile（擅长 + 盲点），灵智体（Forgekin）基于能力匹配选择合适的三方 Agent 而非"配置默认值"。本 Feature 实现三方 Agent 能力画像数据模型、能力匹配查询、与 F001 灵智体能力画像的盲点互补配对。

这是 Build to Persist 基础设施——编码"三方 Agent 是能力扩展非工具调用"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#EX-002]` 指出：v7.0 无三方 Agent 能力画像，灵智体无法基于能力匹配选择合适的三方 Agent，只能按"配置默认值"调用。按 RA-001 能力画像思路：claude code 擅长复杂重构/盲点是长上下文易漂移；codex 擂长推理/盲点是工具调用弱；opencode 擅长开源协作/盲点是企业场景弱；trae 擅长 IDE 集成/盲点是命令行长任务弱。

不做这个 Feature，F033 状态共享无能力画像作为协作上下文，F034 fallback 仅按顺序而非能力匹配，F035 能力融合无目标画像。这是三方 Agent 集成层的能力底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class ExternalAgentProvider(str, Enum):
    """三方 Agent 厂商"""
    CLAUDE_CODE = "claude_code"   # 擅长复杂重构，盲点：长上下文易漂移
    CODEX = "codex"               # 擅长推理，盲点：工具调用弱
    OPENCODE = "opencode"         # 擅长开源协作，盲点：企业场景弱
    TRAE = "trae"                 # 擅长 IDE 集成，盲点：命令行长任务弱

class ExternalAgentCapabilityProfile(BaseModel):
    """三方 Agent 能力画像（对标 F001 CapabilityProfile）"""
    provider: ExternalAgentProvider
    agent_id: str                              # 厂商内 agent 实例 ID
    strengths: list[str]                       # 擅长能力
    blind_spots: list[str]                     # 盲点（用于跨厂商互补配对）
    tool_calling_proficiency: float            # 工具调用熟练度 0.0-1.0
    long_context_stability: float              # 长上下文稳定性 0.0-1.0
    cost_per_1k_tokens: float                  # 成本（用于 F034 fallback 决策）
    avg_latency_ms: int                        # 平均延迟
    historical_performance: PerformanceLog     # 复用 F001 PerformanceLog
```

### 3.2 核心接口

```python
class ExternalAgentProfileRegistry(ABC):
    """三方 Agent 能力画像注册表"""
    @abstractmethod
    async def register(self, profile: ExternalAgentCapabilityProfile) -> str: ...
    @abstractmethod
    async def get(self, agent_id: str) -> ExternalAgentCapabilityProfile: ...
    @abstractmethod
    async def list_by_provider(self, provider: ExternalAgentProvider) -> list[ExternalAgentCapabilityProfile]: ...

class CapabilityMatcher(ABC):
    """能力匹配器（灵智体能力画像 × 三方 Agent 能力画像）"""
    @abstractmethod
    async def match_for_task(
        self, forgekin_profile_id: str, task_capability_requirements: list[str]
    ) -> list[ExternalAgentCapabilityProfile]:
        """基于盲点互补 + 任务能力需求匹配"""
        ...

    @abstractmethod
    async def find_complementary_pair(
        self, primary_agent_id: str
    ) -> Optional[ExternalAgentCapabilityProfile]:
        """找盲点互补的 review 配对（与 F002 跨厂商 review 联动）"""
        ...
```

### 3.3 关键算法

- **盲点互补配对**：灵智体盲点 ∩ 三方 Agent 擅长 = 高匹配分；灵智体擅长 ∩ 三方 Agent 盲点 = 低匹配分（不选）。
- **跨厂商 review 配对**：基于 F002 跨厂商 review 逻辑，primary agent 与 complementary agent 必须盲点不重叠。
- **历史表现加权**：PerformanceLog 的 Wilson 下界用于小样本可靠性（与 F001 一致）。
- **成本/延迟信号**：F034 fallback 链决策时按 cost_per_1k_tokens + avg_latency_ms 排序。

### 3.4 配置外置（YAML 示例）

```yaml
external_agent_profiles:
  claude_code_main:
    provider: claude_code
    strengths: [complex_refactor, multi_file_edit, mcp_tool_use]
    blind_spots: [long_context_drift, command_line_long_task]
    tool_calling_proficiency: 0.92
    long_context_stability: 0.65
    cost_per_1k_tokens: 0.012
    avg_latency_ms: 3500
  codex_main:
    provider: codex
    strengths: [reasoning, math_proof, code_review]
    blind_spots: [tool_calling_weak, enterprise_context]
    tool_calling_proficiency: 0.55
    long_context_stability: 0.85
    cost_per_1k_tokens: 0.008
    avg_latency_ms: 2200
  matching_strategy:
    prefer_complementary_blind_spots: true
    min_wilson_lower_bound: 0.6
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 三方 Agent 能力画像数据模型字段完整（含盲点、成本、延迟）
- [ ] AC-2: CapabilityMatcher 基于盲点互补配对
- [ ] AC-3: 跨厂商 review 配对（与 F002 联动）盲点不重叠
- [ ] AC-4: 历史表现用 Wilson 下界（与 F001 一致）
- [ ] AC-5: 能力画像通过 YAML 配置驱动（禁止硬编码厂商偏好）

## 5. 测试策略

### 5.1 单元测试

- 能力画像字段校验、盲点互补匹配、跨厂商 review 配对、Wilson 下界计算。

### 5.2 集成测试

- 接入 F001 灵智体能力画像、F002 TeamAct 跨厂商 review、F034 fallback 决策。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实 claude code + codex 注册能力画像，灵智体有"长上下文需求"任务时通过真实 LLM 决策调用 codex 而非 claude code（因 claude code 长上下文盲点）。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用（含真实三方 Agent）。

## 6. 引用

- [doc:roleagent.md#第0章]
- [doc:review/review.md#第九章/EX-002]
- [doc:decisions/006-external-agent-integration.md]
- [doc:design/naming-contract.md#2.12]（能力画像 Capability Profile）
- [doc:features/F001-capability-profile.md]
- [doc:features/F002-teamact-loop.md]
- [doc:features/F033-external-agent-shared-state.md]
- [doc:features/F034-external-agent-fallback.md]
- [doc:features/F035-external-agent-capability-fusion.md]
- [doc:project_rules.md#T1-T8]

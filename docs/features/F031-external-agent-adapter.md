---
feature_ids: [F031]
related_features: [F001, F026, F032, F033, F034, F035]
topics: [external-agent, adapter, capability-fusion, fallback, guardrails]
doc_kind: spec
created: 2026-07-17
---

# F031: 三方 Agent 适配层

> **状态**: spec | **负责人**: operator + 架构师Forgekin | **优先级**: P0
> **依赖 ADR**: [doc:decisions/006-external-agent-integration.md]
> **依赖 Feature**: [doc:features/F001-capability-profile.md] + [doc:features/F026-forgemind-app-layer.md]
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径
> **关联 VISION**: [doc:VISION.md#5]（三方 Agent 集成）、[doc:VISION.md#6]（operator 原则第 3 条：三方 Agent 是能力扩展不是工具）

## 1. 上下文

### 1.1 问题陈述

operator 指示（2026-07-17）：

> 我们的Forgekin除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent 的（这个也是我们的强大优势，比喻目前设计接入的编程 Agent：claude code、codex、opencode、trae，将来可扩展接入更多的编程 Agent 和其他的 Agent 的，这些都是可以给Forgekin调用），目前你这块的设计感觉也比较弱，请加强。

flowlight-ai/flowforge 新仓库设计中，三方 Agent 集成被弱化为 ToolRegistry 中的普通工具调用。这导致：

- 三方 Agent 的能力画像未纳入Forgekin能力画像融合
- 三方 Agent 执行状态未写入Forgekin共享状态（EchoStore）
- 三方 Agent 失败时无 fallback 链
- 三方 Agent 执行轨迹未纳入 Eval 信号

本 Feature 是 operator 愿景锚点第 3 条（三方 Agent 是能力扩展不是工具）的落地基础——三方 Agent 不是工具，而是Forgekin能力画像的扩展。

### 1.2 当前痛点

- 三方 Agent 调用走 `ToolRegistry.execute()`，能力画像无法融合（违反 operator 原则第 3 条）
- 无 ExternalAgentProfile 机制，三方 Agent 的能力差异（Claude Code 强于代码理解、Codex 强于推理、Trae 强于 IDE 集成）未建模
- 三方 Agent 失败无回退链，单点依赖导致可用性差
- 三方 Agent 在主进程执行，无 worktree 隔离，存在安全风险
- 三方 Agent 执行轨迹未写入EchoStore，Forgekin重启即失忆

### 1.3 不做的影响

- Forgekin能力被限制在 FlowForge 内置能力（违反 operator 愿景锚点第 3 条）
- 无法实现"自己开发自己"闭环（ForgeMindEngine 缺少三方 Agent 协作）
- 单点依赖导致可用性差（任一三方 Agent API 宕机即阻塞）
- 三方 Agent 执行无法审计，违反六层 Guardrails 治理要求

## 2. 决策

### 2.1 核心设计

ExternalAgentAdapter 抽象层位于核心框架层（`flowforge/core/external_agent/`），是 operator 原则第 3 条的落地——三方 Agent 不是工具，而是能力扩展：

```
flowforge/core/external_agent/
├── __init__.py
├── adapter.py             # ExternalAgentAdapter 抽象基类
├── bridge.py              # ExternalAgentBridge（Forgekin调用入口）
├── profile.py             # ExternalAgentProfile（三方 Agent 能力画像）
├── shared_state.py        # ExternalAgentSharedState（状态共享，写入EchoStore）
├── fallback.py            # ExternalAgentFallback（失败回退链）
├── capability_fusion.py   # ExternalAgentCapabilityFusion（能力融合到SoulImprint）
└── adapters/              # 具体三方 Agent 适配器
    ├── __init__.py
    ├── claude_code.py     # Claude Code Adapter（fallback 优先级 1）
    ├── codex.py           # Codex Adapter（fallback 优先级 2）
    ├── opencode.py        # OpenCode Adapter（fallback 优先级 3）
    └── trae.py            # Trae Adapter（fallback 优先级 4）
```

**调用流程（九步）**：

```
1. Forgekin发起 ExternalAgentBridge.invoke(agent_id, task)
   ↓
2. Forgekin能力画像 gap_analysis 判断需要三方 Agent
   ↓
3. ExternalAgentAdapter 路由到对应三方 Agent
   ↓
4. 三方 Agent 在独立 worktree 执行（隔离 + 审计）
   ↓
5. 执行状态写入 ExternalAgentSharedState（同步到EchoStore）
   ↓
6. Forgekin读取共享状态，融合到自身能力画像（SoulImprint）
   ↓
7. 若失败，ExternalAgentFallback 链回退到下一个三方 Agent
   ↓
8. 全部失败 → 回退到 FlowForge 内置能力（ForgeMindEngine）
   ↓
9. 执行轨迹写入Forgekin Eval 信号
```

### 2.2 关键接口

```python
from abc import ABC, abstractmethod
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class ExternalAgentVendor(str, Enum):
    """三方 Agent 厂商"""
    ANTHROPIC = "anthropic"        # Claude Code
    OPENAI = "openai"              # Codex
    OPEN_SOURCE = "open_source"    # OpenCode
    BYTEDANCE = "bytedance"        # Trae


class ExternalAgentAccessMode(str, Enum):
    """接入方式"""
    CLI = "cli"
    SDK = "sdk"
    API = "api"
    IDE = "ide"


class ExternalAgentProfile(BaseModel):
    """三方 Agent 能力画像（F032 详细定义）"""
    agent_id: str                          # 如 "claude_code_v1"
    vendor: ExternalAgentVendor
    access_mode: ExternalAgentAccessMode
    capability_tags: list[str]             # 如 ["code_understanding", "refactor"]
    cognitive_style: str                   # 与 F001 CapabilityProfile 对齐
    blind_spots: list[str]                 # 与 F001 对齐，用于跨厂商 review
    fallback_priority: int = Field(ge=1)   # 1=最高优先级
    cost_per_call: float = 0.0             # 用于 L6 成本上限治理
    rate_limit: Optional[int] = None       # 每分钟调用上限


class ExternalAgentSharedState(BaseModel):
    """三方 Agent 状态共享（F033 详细定义，写入EchoStore）"""
    invocation_id: str
    agent_id: str
    forgekin_id: str                       # 发起调用的Forgekin ID
    task_summary: str
    started_at: datetime = Field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    status: str = "pending"                # pending / running / success / failed
    artifacts: list[str] = Field(default_factory=list)   # 产出 commit / 文件路径
    evidence_refs: list[str] = Field(default_factory=list)  # Eval trace ID
    error_message: Optional[str] = None


class ExternalAgentFallback(BaseModel):
    """失败回退链（F034 详细定义）"""
    primary_agent_id: str
    fallback_chain: list[str]              # 按 priority 排序的 agent_id 列表
    max_retries: int = 1
    last_failed_agent: Optional[str] = None

    def next_agent(self) -> Optional[str]:
        """返回下一个 fallback Agent"""
        if self.last_failed_agent is None:
            return self.primary_agent_id
        try:
            idx = self.fallback_chain.index(self.last_failed_agent)
            if idx + 1 < len(self.fallback_chain):
                return self.fallback_chain[idx + 1]
        except ValueError:
            return self.primary_agent_id
        return None  # 全部失败，回退到 ForgeMindEngine


class ExternalAgentCapabilityFusion(BaseModel):
    """能力画像融合（F035 详细定义，融合到ForgekinSoulImprint）"""
    forgekin_id: str
    source_agent_id: str
    fused_capabilities: list[str]          # 融合进来的能力标签
    fused_blind_spots: list[str]           # 融合进来的盲点（用于跨厂商 review）
    fusion_confidence: float = Field(ge=0.0, le=1.0)
    fused_at: datetime = Field(default_factory=datetime.now)


class ExternalAgentAdapter(ABC):
    """三方 Agent 适配器抽象基类"""

    @abstractmethod
    def profile(self) -> ExternalAgentProfile:
        """返回该三方 Agent 的能力画像"""
        ...

    @abstractmethod
    async def invoke(
        self,
        task: str,
        worktree_path: str,
        shared_state: ExternalAgentSharedState,
    ) -> ExternalAgentSharedState:
        """
        在独立 worktree 中调用三方 Agent。

        Args:
            task: 任务描述
            worktree_path: 隔离的 worktree 路径（受限网络 + 仅 read/write_code/run_tests 权限）
            shared_state: 共享状态（执行过程会更新此对象）

        Returns:
            更新后的共享状态（含产出 artifacts 和 evidence_refs）
        """
        ...

    @abstractmethod
    async def health_check(self) -> bool:
        """健康检查（用于 fallback 决策）"""
        ...


class ExternalAgentBridge:
    """Forgekin调用三方 Agent 的入口（核心 API）"""

    def __init__(
        self,
        adapters: dict[str, ExternalAgentAdapter],
        shared_state_writer: Any,   # 写入EchoStore 的 Repository
        eval_collector: Any,        # Eval 信号采集器
        fallback_registry: dict[str, ExternalAgentFallback],
    ):
        self._adapters = adapters
        self._shared_state_writer = shared_state_writer
        self._eval_collector = eval_collector
        self._fallback_registry = fallback_registry

    async def invoke(
        self,
        agent_id: str,
        task: str,
        forgekin_id: str,
        worktree_path: str,
    ) -> ExternalAgentSharedState:
        """
        Forgekin调用三方 Agent（含 fallback 链 + 共享状态写入 + Eval 采集）。

        流程：
            1. 创建 ExternalAgentSharedState
            2. 路由到 adapter.invoke()
            3. 失败则走 fallback_chain
            4. 全部失败则回退到 ForgeMindEngine（由调用方处理）
            5. 写入EchoStore
            6. 采集 Eval 信号
        """
        ...


# ---------- L1-L6 Guardrails ----------

class ExternalAgentGuardrails(BaseModel):
    """六层 Guardrails 治理配置"""
    l1_input_schema: str                   # 输入 Schema 校验规则 ID
    l2_system_prompt_constraint: str       # system role 注入的约束 ID
    l3_tool_allow_list: list[str]          # 三方 Agent 可调用工具白名单
    l4_output_validation: str              # 输出 lint + 测试规则 ID
    l5_operator_confirm_actions: list[str] # 不可逆操作（如 merge/release）
    l6_cost_ceiling_per_call: float        # 单次调用成本上限
    l6_cost_ceiling_per_forgekin: float    # 单Forgekin日成本上限
```

### 2.3 边界规则（TIP-044）

flowforge 是纯通用框架，ExternalAgentAdapter 抽象层位于核心框架层，但**不感知** *Forge / content / opensieve / openroute 内部实现：

- ✅ flowforge 定义 `ExternalAgentAdapter` 抽象基类和 `ExternalAgentBridge` 入口
- ✅ *Forge 项目可通过继承 `ExternalAgentAdapter` 实现自己的三方 Agent 集成
- ❌ flowforge 禁止 import 任何 *Forge / content / opensieve / openroute 模块
- ❌ flowforge 不内置 *Forge 专属的三方 Agent 适配器

### 2.4 worktree 隔离

每个三方 Agent 调用必须创建独立 worktree：

| 隔离维度 | 规则 |
|---------|------|
| 网络隔离 | 受限网络访问（白名单域名） |
| 权限控制 | 仅 `read` + `write_code` + `run_tests` |
| 审计追踪 | 全部记录到 `harness-feedback/external-agent-traces/` |
| 资源限额 | CPU / 内存 / 磁盘配额，超限自动终止 |
| 超时控制 | 单次调用默认 30 分钟，可配置 |

## 3. 验收标准

### Phase A（抽象层 + Plugin 注册）

- [ ] AC-A1: `flowforge/core/external_agent/` 目录骨架完整（adapter/bridge/profile/shared_state/fallback/capability_fusion + adapters/）
- [ ] AC-A2: `ExternalAgentAdapter` 抽象基类可被继承（profile/invoke/health_check 三方法）
- [ ] AC-A3: `ExternalAgentBridge.invoke()` 实现九步调用流程
- [ ] AC-A4: `ExternalAgentFallback.next_agent()` 可按 priority 推进 fallback 链
- [ ] AC-A5: 六层 Guardrails 配置通过 Pydantic Schema 强校验
- [ ] AC-A6: 调用状态通过 Repository 层持久化到EchoStore（禁直接操作数据库）
- [ ] AC-A7: 调用轨迹写入 `harness-feedback/external-agent-traces/`（JSON Lines 格式）
- [ ] AC-A8: flowforge 不 import 任何 *Forge / content / opensieve / openroute 模块（边界验证 TIP-044）

### Phase B（首批 4 个 Adapter + E2E）

- [ ] AC-B1: 4 个 Adapter 实现完整（ClaudeCodeAdapter / CodexAdapter / OpenCodeAdapter / TraeAdapter）
- [ ] AC-B2: 每个 Adapter 的 `profile()` 返回正确的 ExternalAgentProfile（vendor / access_mode / capability_tags / blind_spots / fallback_priority）
- [ ] AC-B3: 每个 Adapter 的 `health_check()` 可正确检测三方 Agent 可用性
- [ ] AC-B4: worktree 隔离生效（网络/权限/审计/资源/超时五维度）
- [ ] AC-B5: fallback 链 E2E 测试 — Claude Code 不可用时自动回退到 Codex，依此类推
- [ ] AC-B6: 全部三方 Agent 失败时回退到 ForgeMindEngine（不抛异常给Forgekin）
- [ ] AC-B7: 能力融合 E2E 测试 — 三方 Agent 执行完成后，能力画像融合到ForgekinSoulImprint
- [ ] AC-B8: L6 成本上限触发时自动终止调用并记录告警
- [ ] AC-B9: 单次调用延迟 < 30s（不含三方 Agent 自身执行时间）
- [ ] AC-B10: E2E 测试 — Forgekin调用 Claude Code 完成一个真实编程任务（如新增单元测试），worktree 隔离 + fallback 链 + 能力融合 + Eval 采集全部生效
- [ ] AC-B11: 遵守 T1-T8 测试铁律（真实 LLM 调用、真实场景数据、不跳过验证、不 Mock 工具、采集完整指标、LLM 生成内容经 LLM 审核、Web 功能操控浏览器验证 DOM）

## 4. 依赖

- **Evolved from**: 无
- **Blocked by**: F001（CapabilityProfile 用于能力画像融合）、F026（forgemind 应用层是首批调用方）、Plugin V3 协议（核心框架层注册机制）
- **Related**: F032（ExternalAgentProfile）、F033（ExternalAgentSharedState）、F034（ExternalAgentFallback）、F035（ExternalAgentCapabilityFusion）

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 三方 Agent API 不稳定 | fallback 链 + 重试机制 + Tier 1-4 恢复分级（F022） |
| 三方 Agent 能力画像融合可能引入盲点 | 跨厂商 review + 盲点画像识别（F001 blind_spots） |
| worktree 隔离可能被绕过 | 审计追踪 + L5 操作确认 + MindCouncil 审查 |
| 三方 Agent 调用成本较高 | L6 成本上限 + 配额管理 + Token 账本 |
| 三方 Agent API key 泄露风险 | 配置外置（编程红线第 11 条）+ 密钥管理服务 |
| 单点 Adapter 实现质量参差 | 抽象基类强约束 + 跨厂商 review + Eval 信号反馈 |
| flowforge 越界引用 *Forge（TIP-044） | flowforge 只提供抽象基类，*Forge 自己实现适配器 |

## 6. Open Questions

| # | 问题 | 状态 |
|---|------|------|
| OQ-1 | 三方 Agent 的 API key 是否通过 `${ENV_VAR}` 注入，还是通过密钥管理服务？ | ⬜ 未定 |
| OQ-2 | worktree 隔离是否使用 Docker 容器还是 git worktree + 权限隔离？ | ⬜ 未定 |
| OQ-3 | fallback 链是否需要支持运行时动态调整（基于历史成功率）？ | ⬜ 未定 |
| OQ-4 | 能力融合的 `fusion_confidence` 如何计算？基于历史成功率还是单次执行质量？ | ⬜ 未定 |
| OQ-5 | 三方 Agent 调用是否需要MindCouncil 审查？还是仅 L5 操作确认？ | ⬜ 未定 |

## 7. Key Decisions

| # | 决策 | 理由 | 日期 |
|---|------|------|------|
| KD-1 | 三方 Agent 作为能力扩展而非工具 | operator 愿景锚点第 3 条（三方 Agent 是能力扩展不是工具） | 2026-07-17 |
| KD-2 | ExternalAgentAdapter 抽象层位于核心框架层 | 核心能力应放核心框架层，*Forge 垂直业务层也需要使用 | 2026-07-17 |
| KD-3 | 首批接入 4 个三方 Agent（Claude Code/Codex/OpenCode/Trae） | operator 明确指示首批接入清单 | 2026-07-17 |
| KD-4 | fallback 链按 priority 推进，全部失败回退到 ForgeMindEngine | 避免单点依赖，保证可用性 | 2026-07-17 |
| KD-5 | 六层 Guardrails 强约束（L1-L6） | 三方 Agent 调用必须安全可控 | 2026-07-17 |
| KD-6 | worktree 隔离 + 审计追踪 | 三方 Agent 在隔离环境执行，全部记录到 traces/ | 2026-07-17 |
| KD-7 | flowforge 只提供抽象基类，*Forge 自己实现适配器 | TIP-044 边界隔离规则 | 2026-07-17 |
| KD-8 | 使用项目正式术语（EchoStore / SoulImprint / MindCouncil / ForgeMindEngine） | ADR-012 命名融合 | 2026-07-17 |

## 8. Timeline

| 日期 | 事件 |
|------|------|
| 2026-07-17 | 立项，确立三方 Agent 适配层 Feature 规格，术语对齐项目正式命名 |

## 9. Review Gate

- Phase A: 单元测试通过，ExternalAgentBridge 九步流程由架构师Forgekin review
- Phase B: E2E 测试由跨厂商 reviewer Forgekin review，fallback 链和六层 Guardrails 全部生效

## 10. Links

| 类型 | 路径 | 说明 |
|------|------|------|
| **ADR** | `docs/decisions/006-external-agent-integration.md` | 三方 Agent 集成决策 |
| **Feature** | `docs/features/F001-capability-profile.md` | 能力画像（融合目标） |
| **Feature** | `docs/features/F026-forgemind-app-layer.md` | forgemind 应用层（首批调用方） |
| **Feature** | `docs/features/F032-external-agent-profile.md` | 三方 Agent 能力画像 |
| **Feature** | `docs/features/F033-external-agent-shared-state.md` | 三方 Agent 状态共享 |
| **Feature** | `docs/features/F034-external-agent-fallback.md` | 三方 Agent 失败回退 |
| **Feature** | `docs/features/F035-external-agent-capability-fusion.md` | 三方 Agent 能力融合 |
| **VISION** | `docs/VISION.md#5` | 三方 Agent 集成 |
| **VISION** | `docs/VISION.md#6` | operator 原则第 3 条（三方 Agent 是能力扩展） |
| **TIPS** | `docs/TIPS.md#TIP-044` | flowforge 边界隔离规则 |

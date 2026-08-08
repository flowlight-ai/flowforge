# F031: 三方 Agent 适配层（ExternalAgentAdapter）

> **状态**: ⏳ pending
> **类型**: external_agent
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **依赖 ADR**: [doc:decisions/006-external-agent-integration.md]
> **依赖 Feature**: [doc:features/F001-capability-profile.md]
> **依据**: [doc:review/review.md#第九章] EX-001~EX-010
> **关联 VISION**: [doc:VISION.md#5]（三方 Agent 集成：Forgekin的能力扩展）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.10]（待创建）
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）

---

## 1. 上下文

### 1.1 问题陈述

当前 FlowForge 三方 Agent 集成被弱化为 ToolRegistry 普通工具调用。operator 指示（2026-07-17）：

> 我们的Forgekin除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent 的（这个也是我们的强大优势，比喻目前设计接入的编程 Agent：claude code、codex、opencode、trae，将来可扩展接入更多的编程 Agent 和其他的 Agent 的，这些都是可以给Forgekin调用），目前你这块的设计感觉也比较弱，请加强。

### 1.2 当前痛点

- 三方 Agent 能力画像未纳入Forgekin能力画像融合
- 三方 Agent 执行状态未写入Forgekin共享状态
- 三方 Agent 失败时无 fallback 链
- 三方 Agent 执行轨迹未纳入 Eval 信号

### 1.3 不做的影响

- Forgekin能力受限（不能接入顶级编程 Agent）
- 三方 Agent 失败导致任务失败
- 无法体现"能力扩展"vs"工具调用"的区别

---

## 2. 决策

### 2.1 核心设计

ExternalAgentAdapter 抽象层 + 4 大机制（能力画像 / 共享状态 / 失败回退 / 能力融合）+ 4 个具体 Adapter（Claude Code / Codex / OpenCode / Trae）。

**EAC v1 七契约（External Agent Contract v1）**——所有三方 Agent Adapter 必须实现以下七个契约才能纳入 ExternalAgentBridge：

1. **Invocation Contract**：同步调用契约（`invoke(task) -> result`），定义任务输入/输出 schema、超时、错误码。
2. **Stream Contract**：流式输出契约（SSE/WebSocket），支持增量 token、工具调用事件、思考过程事件。
3. **Session Contract**：会话契约，三方 Agent 必须支持 session_id 复用、上下文延续、会话级取消。
4. **Capability Contract**：能力声明契约，三方 Agent 必须暴露 `get_profile` 返回能力画像（capabilities / proficiency / cost / latency / reliability）。
5. **Collaboration Contract**：协作契约，三方 Agent 必须支持与 FlowForge Forgekin的 Handoff Capsule（F003）交接、Ping-Pong 心跳（F004）、@-mention 路由（F005）。
6. **Safety Contract**：安全契约，三方 Agent 必须接受六层 Guardrails 包裹（详见下文），并暴露 `health_check` 与审计日志 hook。
7. **Avatar Sync + System Prompt Configuration Map**：化身同步与系统提示词配置契约，三方 Agent 必须接受 FlowForge 下发的 System Prompt 配置图（包含 Role Mask 五层 / Core Identity / World Setting 引用），并在执行期间保持化身一致性（Avatar Sync）。

**六层 Guardrails（Six-Layer Guardrails）**——三方 Agent 调用必须穿过以下六层防护，缺一不可：

1. **Input Validation**：输入校验层，校验 task.input_data 的 schema、长度、敏感字段、注入风险。
2. **System Prompt Constraints**：系统提示词约束层，通过 System Prompt Configuration Map 注入 Core Identity / Role Mask / World Setting / 不可越界指令。
3. **Tool Allow-Lists**：工具白名单层，三方 Agent 仅可调用 allow-list 中的工具/文件路径/网络出口，禁止越权。
4. **Output Validation**：输出校验层，校验 result.output 的 schema、内容安全、PII 脱敏、有害内容过滤。
5. **Action Confirmation**：操作确认层，对副作用操作（写入文件 / 提交代码 / 发送消息）必须经 operator 或评审员Forgekin二次确认。
6. **Cost Ceiling**：成本上限层，单次调用 cost_incurred 不得超过预算上限，超限自动熔断并触发 fallback。

### 2.2 关键接口

```python
from abc import ABC, abstractmethod
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class ExternalAgentType(str, Enum):
    """三方 Agent 类型"""
    CLAUDE_CODE = "claude_code"
    CODEX = "codex"
    OPENCODE = "opencode"
    TRAE = "trae"


class ExternalAgentProfile(BaseModel):
    """三方 Agent 能力画像"""
    agent_id: str
    agent_type: ExternalAgentType
    vendor: str
    capabilities: list[str]      # 能力列表
    proficiency: dict[str, float]  # 能力熟练度
    cost_per_call: float         # 调用成本
    avg_latency_ms: int          # 平均延迟
    reliability: float = Field(ge=0.0, le=1.0)  # 可靠性


class ExternalAgentTask(BaseModel):
    """三方 Agent 任务"""
    task_id: str
    description: str
    input_data: dict
    expected_output: dict
    worktree_path: Optional[str] = None  # 独立 worktree 路径
    timeout_seconds: int = 300


class ExternalAgentResult(BaseModel):
    """三方 Agent 执行结果"""
    task_id: str
    success: bool
    output: Optional[dict] = None
    error: Optional[str] = None
    execution_trace: list[dict] = Field(default_factory=list)
    cost_incurred: float = 0.0
    duration_ms: int = 0


class ExternalAgentAdapter(ABC):
    """三方 Agent 适配器抽象"""
    
    @abstractmethod
    async def invoke(self, task: ExternalAgentTask) -> ExternalAgentResult:
        """调用三方 Agent"""
        ...
    
    @abstractmethod
    def get_profile(self) -> ExternalAgentProfile:
        """获取三方 Agent 能力画像"""
        ...
    
    @abstractmethod
    async def health_check(self) -> bool:
        """健康检查"""
        ...


class ExternalAgentBridge:
    """Forgekin调用三方 Agent 的入口"""
    
    def __init__(
        self,
        adapters: dict[ExternalAgentType, ExternalAgentAdapter],
        fallback_chain: list[ExternalAgentType],
        shared_state: "ExternalAgentSharedState",
        fusion: "ExternalAgentCapabilityFusion",
    ):
        self.adapters = adapters
        self.fallback_chain = fallback_chain
        self.shared_state = shared_state
        self.fusion = fusion
    
    async def invoke(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
    ) -> ExternalAgentResult:
        """
        Forgekin调用三方 Agent：
        1. 检查 forgekin 能力画像 gap_analysis
        2. 选择最佳三方 Agent
        3. 创建独立 worktree
        4. 调用三方 Agent
        5. 写入共享状态
        6. 失败 → fallback 链
        7. 全部失败 → 回退到 FlowForge 内置能力
        8. 执行轨迹写入 Eval 信号
        """
        for agent_type in self.fallback_chain:
            adapter = self.adapters[agent_type]
            result = await adapter.invoke(task)
            await self.shared_state.write(forgekin_id, task.task_id, result)
            if result.success:
                await self.fusion.fuse(forgekin_id, adapter.get_profile)
                return result
        # 全部失败 → 回退
        return ExternalAgentResult(
            task_id=task.task_id,
            success=False,
            error="all_external_agents_failed",
        )


class ExternalAgentSharedState:
    """三方 Agent 执行状态写入Forgekin共享状态"""
    
    async def write(self, forgekin_id: str, task_id: str, result: ExternalAgentResult) -> None:
        """写入共享状态（通过 Repository 层）"""
        ...
    
    async def read(self, forgekin_id: str, task_id: str) -> Optional[ExternalAgentResult]:
        """读取共享状态"""
        ...


class ExternalAgentFallback:
    """三方 Agent 失败回退链"""
    
    def __init__(self, chain: list[ExternalAgentType]):
        self.chain = chain  # 默认: [CLAUDE_CODE, CODEX, OPENCODE, TRAE]
    
    def next_agent(self, current: ExternalAgentType) -> Optional[ExternalAgentType]:
        """获取下一个 fallback Agent"""
        try:
            idx = self.chain.index(current)
            if idx + 1 < len(self.chain):
                return self.chain[idx + 1]
        except ValueError:
            pass
        return None


class ExternalAgentCapabilityFusion:
    """三方 Agent 能力画像融合到Forgekin能力画像"""
    
    async def fuse(self, forgekin_id: str, external_profile: ExternalAgentProfile) -> None:
        """
        融合流程：
        1. 读取 forgekin 原 CapabilityProfile
        2. 将 external_profile.capabilities 添加到 skill_packages
        3. 更新 tool_boundary（三方 Agent 作为扩展工具）
        4. 更新 historical_performance（三方 Agent 成功率）
        5. 持久化新 CapabilityProfile
        """
        ...
```

### 2.3 具体三方 Agent Adapter

| Adapter | 文件 | 接入方式 |
|---------|------|---------|
| ClaudeCodeAdapter | `adapters/claude_code.py` | CLI / SDK |
| CodexAdapter | `adapters/codex.py` | CLI / API |
| OpenCodeAdapter | `adapters/opencode.py` | CLI |
| TraeAdapter | `adapters/trae.py` | IDE / API |

### 2.4 关键不变量

- 三方 Agent 调用必须创建独立 worktree（隔离 + 审计）
- 三方 Agent 失败必须 fallback
- 三方 Agent 能力画像必须融合到Forgekin主画像
- 三方 Agent 执行轨迹必须写入 Eval 信号
- 三方 Agent 调用必须通过六层 Guardrails

---

## 3. 实现路径

### 3.1 代码位置

```
flowforge/core/external_agent/
├── __init__.py
├── adapter.py             # ExternalAgentAdapter 抽象
├── bridge.py              # ExternalAgentBridge
├── profile.py             # ExternalAgentProfile
├── shared_state.py        # ExternalAgentSharedState
├── fallback.py            # ExternalAgentFallback
├── capability_fusion.py   # ExternalAgentCapabilityFusion
└── adapters/
    ├── __init__.py
    ├── claude_code.py
    ├── codex.py
    ├── opencode.py
    └── trae.py
```

### 3.2 实现步骤

1. 定义 Pydantic 数据模型（profile.py / shared_state.py）
2. 实现 ExternalAgentAdapter 抽象（adapter.py）
3. 实现 4 个具体 Adapter（adapters/*.py）
4. 实现 ExternalAgentBridge 调用入口（bridge.py）
5. 实现 ExternalAgentFallback 回退链（fallback.py）
6. 实现 ExternalAgentCapabilityFusion 融合（capability_fusion.py）
7. 实现 worktree 隔离机制
8. 集成到 ForgekinEngine

### 3.3 依赖关系

- 依赖 ADR 006（三方 Agent 集成决策）
- 依赖 F001 CapabilityProfile（能力画像融合目标）
- 被 F032-F035 依赖（具体机制）

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: 4 个三方 Agent Adapter 全部可调用
- [ ] AC-2: ExternalAgentBridge 选择最佳 Agent（基于 gap_analysis）
- [ ] AC-3: 三方 Agent 执行状态写入共享状态
- [ ] AC-4: 失败时 fallback 链按顺序回退
- [ ] AC-5: 全部失败时回退到 FlowForge 内置能力

### 4.2 性能验收

- [ ] AC-6: 三方 Agent 调用延迟 < 60s（含 LLM 推理）
- [ ] AC-7: worktree 创建延迟 < 1s

### 4.3 安全验收

- [ ] AC-8: 三方 Agent 在独立 worktree 执行（隔离）
- [ ] AC-9: 三方 Agent 调用通过六层 Guardrails
- [ ] AC-10: 三方 Agent 执行轨迹写入审计日志

### 4.4 Eval 验收

- [ ] AC-11: 三方 Agent 调用成功率 ≥ 85%
- [ ] AC-12: 能力画像融合正确率 100%

---

## 5. 测试计划

### 5.1 单元测试

- 测试 4 个 Adapter 健康检查
- 测试 ExternalAgentBridge 调用流程
- 测试 Fallback 链回退
- 测试能力画像融合

### 5.2 集成测试

- 测试 worktree 隔离
- 测试六层 Guardrails
- 测试审计日志

### 5.3 E2E 测试

- Forgekin调用 Claude Code 完成一个代码生成任务
- 模拟 Claude Code 失败，验证 fallback 到 Codex
- 验证能力画像融合
- **遵守 T1-T8 铁律**：真实 LLM、真实数据、真实工具调用

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- 自动探针（调用成功率）
- 跨厂商 reviewer Forgekin（能力画像融合正确性）

### 6.2 评估什么

- 4 个 Adapter 调用成功率
- Fallback 链有效性
- 能力画像融合正确性
- worktree 隔离有效性

### 6.3 何时评估

- 每次三方 Agent 调用后
- 每周汇总调用成功率

### 6.4 评估信号

- trace 信号：三方 Agent 执行轨迹
- 用户信号：任务结果反馈
- 探针信号：定期健康检查

### 6.5 评估后做什么

- 通过 → 持续使用
- 失败 → 归因到七类矩阵（通常是工具缺口或资源耗尽）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

**Built to Persist（复利型基础设施）**

### 7.2 理由

ExternalAgentAdapter 是 roleagent.md 第 1 章明确的"agent 交接协议与路由"扩展——编码Forgekin与三方 Agent 的协作关系，不会因为单个模型更聪明而消失。

具体 Adapter（如 ClaudeCodeAdapter）可能随厂商 API 变化而调整，但抽象层（ExternalAgentAdapter）是永久维护。

---

## 8. 后果

### 8.1 正面后果

- Forgekin能力大幅扩展
- 三方 Agent 失败有 fallback 保证
- 能力画像融合让Forgekin能力画像更完整

### 8.2 负面后果

- 实现复杂度增加
- 三方 Agent 调用成本较高
- worktree 隔离增加 I/O 开销

### 8.3 风险

- 三方 Agent API 不稳定（缓解：fallback 链 + 重试）
- worktree 隔离可能被绕过（缓解：审计 + 操作确认）

---

## 9. 替代方案

### 9.1 方案 A: 把三方 Agent 作为 ToolRegistry 普通工具

- 优点：实现简单
- 缺点：能力画像无法融合，无 fallback
- 未选择原因：operator 指示"目前你这块的设计感觉也比较弱，请加强"

### 9.2 方案 B: 只接入 Claude Code

- 优点：实现简单
- 缺点：单点依赖
- 未选择原因：违反 fallback 设计

---

## 10. 引用

- [doc:VISION.md#5]
- [doc:decisions/006-external-agent-integration.md]
- [doc:features/F001-capability-profile.md]
- [doc:features/F032-external-agent-profile.md]
- [doc:features/F033-external-agent-shared-state.md]
- [doc:features/F034-external-agent-fallback.md]
- [doc:features/F035-external-agent-capability-fusion.md]
- [doc:SOP.md#3]
- [doc:project_rules.md#红线11]

---

## 11. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-17 | v0.1 | 初始创建 | 架构师 Forgekin |

# A031: 三方 Agent 适配层架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）+ [doc:../spec.md#§2.9]
> **对应 arch.md**: [doc:../arch.md#§3.10]
> **对应 design.md**: [doc:../design.md#§3.10]（待创建）
> **对应 Feature**: [doc:../features/F031-external-agent-adapter.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D031-external-agent-adapter.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 三方 Agent 集成此前被弱化为 ToolRegistry 普通工具调用，Forgekin无法将三方 Agent 视为"能力扩展"而非"工具调用"。operator 指示（2026-07-17）明确要求加强三方 Agent 集成设计，支持 claude code / codex / opencode / trae 等编程 Agent 接入，并扩展到其他类型 Agent。本架构在 core/external_agent/ 建立 ExternalAgentAdapter 抽象层，解决以下架构层问题：

1. **三方 Agent 与工具调用混淆**：v7.0 把三方 Agent 当 ToolRegistry 普通工具，导致能力画像无法融合、无 fallback、无共享状态。
2. **EAC v1 七契约未定义**：Invocation / Stream / Session / Capability / Collaboration / Safety / Avatar Sync 七契约无统一规范，三方 Agent 接入接口散乱。
3. **六层 Guardrails 未编码**：Input Validation / System Prompt Constraints / Tool Allow-Lists / Output Validation / Action Confirmation / Cost Ceiling 六层防护缺失，三方 Agent 调用存在安全风险。
4. **worktree 隔离缺失**：三方 Agent 直接在主仓库执行，无网络白名单/权限控制/审计追踪/操作回滚四项隔离。
5. **fallback 链未编排**：三方 Agent 失败无跨厂商回退机制，单点失败导致任务失败。
6. **能力画像未融合**：三方 Agent 调用是"用完即走"，Forgekin无法从调用中"学到"能力（与前期差距）。
7. **System Prompt Configuration Map 缺失**：三方 Agent 无法接受 FlowForge 下发的 Role Mask 五层 / Core Identity / World Setting 引用，化身不一致。

### 1.2 架构约束

- **单向依赖约束**：ExternalAgentAdapter 位于 `flowforge/core/external_agent/`，单向依赖 F001/F002/F003/F008/F014/F018/F022/F032-F035，禁止反向依赖 *Forge。
- **DI 容器约束**：ExternalAgentAdapter / ExternalAgentBridge / 六层 Guardrails 实例必须通过 DI 容器注入，禁止直接实例化。
- **Repository 层约束**：ExternalAgentSharedState 写入必须通过 Repository 层，禁止直接操作数据库。
- **配置驱动约束**：EAC v1 七契约配置 + 六层 Guardrails 配置 + 4 Adapter 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码 API key / 端口 / 厂商偏好。
- **EAC v1 七契约约束**：所有三方 Agent Adapter 必须实现七契约才能纳入 ExternalAgentBridge，缺一即拒绝注册。
- **六层 Guardrails 约束**：三方 Agent 调用必须穿过六层防护，缺一即调用被拒绝。
- **worktree 隔离约束**：三方 Agent 必须在独立 worktree 执行，含网络白名单 + 权限控制 + 审计追踪 + 操作回滚四项。
- **fallback 约束**：三方 Agent 失败必须按 fallback 链回退，全部失败必须降级到 FlowForge 内置能力。

### 1.3 架构影响

- **对 F001 能力画像的影响**：ExternalAgentCapabilityFusion 将三方 Agent 能力融合到 CapabilityProfile。
- **对 F002 TeamAct 的影响**：ExternalAgentSharedState 与 TeamActState 一一关联。
- **对 F003 HandoffCapsule 的影响**：三方 Agent 支持 Handoff Capsule 交接（Collaboration Contract）。
- **对 F008 持久状态层的影响**：ExternalAgentSharedState 写入持久状态层。
- **对 F014 多域记忆的影响**：FallbackExecutionRecord 写入EchoStore供SpiritForge蒸馏。
- **对 F018 Eval Contract 的影响**：三方 Agent 执行轨迹纳入 Eval 信号。
- **对 F022 Tier 1-4 恢复分级的影响**：三方 Agent 失败按 Tier 1-4 分级恢复。
- **对 F032-F035 的影响**：本架构作为容器，承载 F032 能力画像 / F033 状态共享 / F034 失败回退 / F035 能力融合四大机制。

---

## 2. 架构设计

### 2.1 组件架构图

```
                    +-------------------------------------------------+
                    |        flowforge/core/external_agent/           |
                    |                                                 |
                    |  +-------------------+                          |
                    |  | ExternalAgent     |  Forgekin调用三方 Agent     |
                    |  | Bridge            |  的入口                   |
                    |  +---------+---------+                          |
                    |            |                                    |
                    |  +---------v---------+                          |
                    |  | EAC v1 七契约     |                          |
                    |  | (Adapter 必实现)  |                          |
                    |  +-------------------+                          |
                    |   1. Invocation   (同步调用)                     |
                    |   2. Stream       (SSE/WebSocket)               |
                    |   3. Session      (session_id 复用)             |
                    |   4. Capability   (get_profile)                 |
                    |   5. Collaboration(Handoff+PingPong+@mention)   |
                    |   6. Safety       (health_check + 审计)         |
                    |   7. Avatar Sync + System Prompt Config Map    |
                    |            |                                    |
                    |  +---------v---------+                          |
                    |  | 六层 Guardrails    |  调用必穿六层             |
                    |  +-------------------+                          |
                    |   L1 Input Validation  (schema + 注入风险)       |
                    |   L2 System Prompt     (Core Identity + 边界)   |
                    |   L3 Tool Allow-Lists  (白名单 + 路径)           |
                    |   L4 Output Validation (schema + PII 脱敏)      |
                    |   L5 Action Confirmation (副作用二次确认)        |
                    |   L6 Cost Ceiling      (单次调用预算)            |
                    |            |                                    |
                    |  +---------v---------+                          |
                    |  | worktree 隔离     |  4 项隔离                 |
                    |  +-------------------+                          |
                    |   - 网络白名单 (egress filter)                   |
                    |   - 权限控制   (read/write/exec)                  |
                    |   - 审计追踪   (audit log)                       |
                    |   - 操作回滚   (rollback)                        |
                    |            |                                    |
                    |  +---------v---------+   +-------------------+ |
                    |  | ExternalAgent     |<->| ExternalAgent     | |
                    |  | Adapter (abstract)|   | Profile (F032)    | |
                    |  +---------+---------+   +-------------------+ |
                    |            |              +-------------------+ |
                    |  +---------v---------+    | ExternalAgent     | |
                    |  | 4 具体 Adapter    |    | SharedState (F033)| |
                    |  |  - ClaudeCodeAdp  |    +-------------------+ |
                    |  |  - CodexAdapter   |    +-------------------+ |
                    |  |  - OpenCodeAdp    |    | ExternalAgent     | |
                    |  |  - TraeAdapter    |    | Fallback (F034)   | |
                    |  +-------------------+    +-------------------+ |
                    |                           +-------------------+ |
                    |                           | CapabilityFusion   | |
                    |                           | (F035)             | |
                    |                           +-------------------+ |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  上游核心框架（DI 注入）                  |
                    |  F001 CapabilityProfile                   |
                    |  F002 TeamAct                             |
                    |  F003 HandoffCapsule                      |
                    |  F008 DurableStateSurfaces                |
                    |  F014 Memory Collection                   |
                    |  F018 Eval Contract                       |
                    |  F022 Tier 1-4 Recovery                   |
                    +-------------------------------------------+
```

### 2.2 关键架构决策

- **决策 1：ExternalAgentAdapter 抽象层 + Bridge 入口模式**
  ExternalAgentAdapter 抽象定义七契约接口，ExternalAgentBridge 作为Forgekin调用三方 Agent 的唯一入口。Bridge 编排 4 大机制（Profile/SharedState/Fallback/CapabilityFusion）+ 七契约 + 六层 Guardrails + worktree 隔离。这避免Forgekin直接调用 Adapter 绕过 Guardrails。

- **决策 2：EAC v1 七契约作为 Adapter 注册硬门**
  所有三方 Agent Adapter 必须实现七契约（Invocation/Stream/Session/Capability/Collaboration/Safety/Avatar Sync + System Prompt Configuration Map）才能纳入 ExternalAgentBridge。缺一即拒绝注册。七契约覆盖同步调用、流式输出、会话管理、能力声明、协作交接、安全审计、化身同步全维度。

- **决策 3：六层 Guardrails 强制穿过**
  三方 Agent 调用必须按序穿过 L1 Input Validation -> L2 System Prompt Constraints -> L3 Tool Allow-Lists -> L4 Output Validation -> L5 Action Confirmation -> L6 Cost Ceiling 六层。任一层失败即调用被拒绝。这满足 rules.md AI 编程优秀实践"六层 Guardrails"主张。

- **决策 4：worktree 隔离四项**
  三方 Agent 必须在独立 git worktree 中执行，含网络白名单（egress filter 限制可访问域名）+ 权限控制（read/write/exec 细粒度）+ 审计追踪（所有副作用记录）+ 操作回滚（失败时 git reset）四项隔离。这避免三方 Agent 越权修改主仓库代码。

- **决策 5：fallback 链按 EAC v1 Capability Contract 能力画像编排**
  Fallback 链不按固定顺序（如 Claude -> Codex -> OpenCode -> Trae），而是基于 F032 CapabilityProfile 的盲点互补 + 成本排序构建。这保证 fallback 选择最优厂商而非按编号顺序。

- **决策 6：System Prompt Configuration Map 联动 F030 Role Mask 五层**
  Avatar Sync + System Prompt Configuration Map 契约要求三方 Agent 接受 FlowForge 下发的 Role Mask 五层（L1-L5）+ Core Identity + World Setting 引用。三方 Agent 在执行期间保持化身一致性（Avatar Sync），避免角色漂移。

- **决策 7：全部失败降级到 FlowForge 内置能力**
  当 fallback 链全部失败时，降级到 FlowForge 内置 agent（能力可能弱但可用）。这保证任务不会因三方 Agent 全部不可用而完全失败。

- **决策 8：调用语义统一（同步/异步/流式/委托）**
  ExternalAgentBridge.invoke 统一封装四种调用语义：同步（invoke）/异步（invoke_async）/流式（invoke_stream）/委托（delegate）。Adapter 内部实现差异由 Bridge 屏蔽。

### 2.3 架构不变量

- 所有三方 Agent Adapter 必须实现 EAC v1 七契约，缺一即拒绝注册到 ExternalAgentBridge。
- 三方 Agent 调用必须穿过六层 Guardrails，任一层失败即调用被拒绝。
- 三方 Agent 必须在独立 worktree 中执行，含网络白名单 + 权限控制 + 审计追踪 + 操作回滚四项隔离。
- 三方 Agent 失败必须按 fallback 链回退，全部失败必须降级到 FlowForge 内置能力。
- 三方 Agent 能力画像必须融合到Forgekin CapabilityProfile（通过 F035 CapabilityFusion）。
- 三方 Agent 执行状态必须写入 ExternalAgentSharedState（F033），与 F002 TeamActState 一一关联。
- 三方 Agent 执行轨迹必须写入 Eval 信号（F018）+ EchoStore（F014）供SpiritForge蒸馏。
- ExternalAgentBridge 必须是Forgekin调用三方 Agent 的唯一入口，禁止Forgekin直接调用 Adapter。
- 三方 Agent 必须接受 System Prompt Configuration Map（含 Role Mask 五层 + Core Identity + World Setting 引用），保持 Avatar Sync。
- 三方 Agent 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 .py 硬编码 API key / 端口 / 厂商偏好。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 |
|------|------|------|
| ExternalAgentBridge | `core/external_agent/bridge.py` | Forgekin调用三方 Agent 的唯一入口 |
| ExternalAgentAdapter | `core/external_agent/adapter.py` | 三方 Agent 适配器抽象（EAC v1 七契约） |
| ExternalAgentType | `core/external_agent/adapter.py` | 三方 Agent 类型枚举（claude_code/codex/opencode/trae） |
| ExternalAgentTask | `core/external_agent/adapter.py` | 三方 Agent 任务数据模型 |
| ExternalAgentResult | `core/external_agent/adapter.py` | 三方 Agent 执行结果数据模型 |
| ClaudeCodeAdapter | `core/external_agent/adapters/claude_code.py` | Claude Code Adapter |
| CodexAdapter | `core/external_agent/adapters/codex.py` | Codex Adapter |
| OpenCodeAdapter | `core/external_agent/adapters/opencode.py` | OpenCode Adapter |
| TraeAdapter | `core/external_agent/adapters/trae.py` | Trae Adapter |
| InputValidation | `core/external_agent/guardrails/input_validation.py` | L1 输入校验层 |
| SystemPromptConstraints | `core/external_agent/guardrails/system_prompt.py` | L2 系统提示词约束层 |
| ToolAllowLists | `core/external_agent/guardrails/tool_allowlist.py` | L3 工具白名单层 |
| OutputValidation | `core/external_agent/guardrails/output_validation.py` | L4 输出校验层 |
| ActionConfirmation | `core/external_agent/guardrails/action_confirm.py` | L5 操作确认层 |
| CostCeiling | `core/external_agent/guardrails/cost_ceiling.py` | L6 成本上限层 |
| WorktreeIsolation | `core/external_agent/worktree.py` | worktree 隔离（网络/权限/审计/回滚） |
| ExternalAgentConfig | `config/external_agent.yaml` | 三方 Agent YAML 配置（外置） |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Any, AsyncIterator
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
    """三方 Agent 能力画像（F032 详细定义）"""
    agent_id: str
    agent_type: ExternalAgentType
    vendor: str
    capabilities: list[str]
    proficiency: dict[str, float]
    cost_per_call: float
    avg_latency_ms: int
    reliability: float = Field(ge=0.0, le=1.0)


class ExternalAgentTask(BaseModel):
    """三方 Agent 任务"""
    task_id: str
    description: str
    input_data: dict
    expected_output: dict
    worktree_path: Optional[str] = None
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


class SystemPromptConfigurationMap(BaseModel):
    """System Prompt 配置图（EAC v1 契约 7）"""
    core_identity_ref: str                     # Core Identity 引用（F030）
    role_mask_layers: dict[str, str]           # Role Mask 五层（L1-L5）
    world_setting_ref: Optional[str]           # 虚拟世界设定引用（F030）
    immutable_directives: list[str]            # 不可越界指令
    avatar_sync_token: str                     # 化身同步令牌


class ExternalAgentAdapter(ABC):
    """三方 Agent 适配器抽象（EAC v1 七契约）"""

    # === 契约 1: Invocation Contract ===
    @abstractmethod
    async def invoke(self, task: ExternalAgentTask) -> ExternalAgentResult:
        """同步调用契约：invoke(task) -> result"""
        ...

    # === 契约 2: Stream Contract ===
    @abstractmethod
    async def invoke_stream(
        self, task: ExternalAgentTask
    ) -> AsyncIterator[dict]:
        """流式输出契约（SSE/WebSocket）：增量 token / 工具调用事件 / 思考过程事件"""
        ...

    # === 契约 3: Session Contract ===
    @abstractmethod
    async def create_session(self, forgekin_id: str) -> str:
        """会话契约：创建 session_id（支持复用 / 上下文延续 / 会话级取消）"""
        ...

    @abstractmethod
    async def cancel_session(self, session_id: str) -> None:
        """会话级取消"""
        ...

    # === 契约 4: Capability Contract ===
    @abstractmethod
    def get_profile(self) -> ExternalAgentProfile:
        """能力声明契约：返回能力画像（capabilities / proficiency / cost / latency / reliability）"""
        ...

    # === 契约 5: Collaboration Contract ===
    @abstractmethod
    async def handoff_to(
        self, next_agent_type: ExternalAgentType, capsule: dict
    ) -> None:
        """协作契约：支持 Handoff Capsule (F003) / Ping-Pong (F004) / @-mention (F005)"""
        ...

    # === 契约 6: Safety Contract ===
    @abstractmethod
    async def health_check(self) -> bool:
        """安全契约：健康检查 + 暴露审计日志 hook"""
        ...

    @abstractmethod
    async def emit_audit_log(self) -> list[dict]:
        """暴露审计日志"""
        ...

    # === 契约 7: Avatar Sync + System Prompt Configuration Map ===
    @abstractmethod
    async def apply_system_prompt_config(
        self, config_map: SystemPromptConfigurationMap
    ) -> None:
        """接受 FlowForge 下发的 System Prompt 配置图（含 Role Mask 五层 / Core Identity / World Setting）"""
        ...

    @abstractmethod
    async def sync_avatar(self, avatar_token: str) -> None:
        """化身同步：执行期间保持化身一致性"""
        ...


class Guardrail(ABC):
    """六层 Guardrails 抽象基类"""

    @abstractmethod
    async def check(self, context: dict) -> tuple[bool, str]:
        """校验，返回 (通过, 拒绝原因)"""
        ...


class ExternalAgentBridge:
    """Forgekin调用三方 Agent 的唯一入口"""

    def __init__(
        self,
        adapters: dict[ExternalAgentType, ExternalAgentAdapter],
        guardrails: list[Guardrail],          # 六层 Guardrails
        fallback_chain: list[ExternalAgentType],
        shared_state: "ExternalAgentSharedState",
        fusion: "ExternalAgentCapabilityFusion",
        worktree_isolation: "WorktreeIsolation",
    ):
        self.adapters = adapters
        self.guardrails = guardrails
        self.fallback_chain = fallback_chain
        self.shared_state = shared_state
        self.fusion = fusion
        self.worktree_isolation = worktree_isolation

    async def invoke(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
    ) -> ExternalAgentResult:
        """
        Forgekin调用三方 Agent 全流程：
        1. 穿过六层 Guardrails
        2. 创建独立 worktree
        3. 按 fallback 链调用三方 Agent
        4. 写入共享状态
        5. 失败 -> fallback 链
        6. 全部失败 -> 降级到 FlowForge 内置能力
        7. 执行轨迹写入 Eval 信号 + EchoStore
        """
        # 步骤 1: 六层 Guardrails
        for guardrail in self.guardrails:
            passed, reason = await guardrail.check({"task": task, "forgekin_id": forgekin_id})
            if not passed:
                return ExternalAgentResult(
                    task_id=task.task_id,
                    success=False,
                    error=f"guardrail_rejected: {reason}",
                )

        # 步骤 2: worktree 隔离
        worktree_path = await self.worktree_isolation.create_isolated
        task.worktree_path = worktree_path

        # 步骤 3-6: fallback 链
        for agent_type in self.fallback_chain:
            adapter = self.adapters[agent_type]
            if not await adapter.health_check:
                continue
            result = await adapter.invoke(task)
            await self.shared_state.write(forgekin_id, task.task_id, result)
            if result.success:
                await self.fusion.fuse(forgekin_id, adapter.get_profile)
                await self.worktree_isolation.cleanup(worktree_path)
                return result

        # 步骤 6: 全部失败 -> 降级
        await self.worktree_isolation.cleanup(worktree_path)
        return ExternalAgentResult(
            task_id=task.task_id,
            success=False,
            error="all_external_agents_failed_degrade_to_builtin",
        )


class WorktreeIsolation(ABC):
    """worktree 隔离四项"""

    @abstractmethod
    async def create_isolated(self) -> str:
        """创建独立 worktree（含网络白名单 + 权限控制）"""
        ...

    @abstractmethod
    async def audit_log(self, worktree_path: str) -> list[dict]:
        """审计追踪"""
        ...

    @abstractmethod
    async def rollback(self, worktree_path: str) -> None:
        """操作回滚"""
        ...

    @abstractmethod
    async def cleanup(self, worktree_path: str) -> None:
        """清理 worktree"""
        ...
```

### 3.3 数据流

```
[1] Forgekin 提出三方 Agent 调用请求
    `--> ExternalAgentBridge.invoke(forgekin_id, task)
            |
            v
[2] 穿过六层 Guardrails（按序）
    L1 Input Validation:  校验 task.input_data schema / 长度 / 敏感字段 / 注入风险
        `--> 失败: 拒绝调用
    L2 System Prompt Constraints: 注入 Core Identity + Role Mask + World Setting + 不可越界指令
        `--> 失败: 拒绝调用
    L3 Tool Allow-Lists: 限定三方 Agent 可调用工具 / 文件路径 / 网络出口
        `--> 失败: 拒绝调用
    L4 Output Validation: 校验 result.output schema / 内容安全 / PII 脱敏 / 有害内容过滤
        `--> 失败: 拒绝调用
    L5 Action Confirmation: 副作用操作（写文件 / 提交代码 / 发消息）必须 operator 或评审员确认
        `--> 失败: 拒绝调用
    L6 Cost Ceiling: 单次调用 cost_incurred 不得超过预算上限
        `--> 失败: 拒绝调用并触发 fallback
            |
            v
[3] worktree 隔离四项
    `--> WorktreeIsolation.create_isolated
        - 网络白名单: egress filter 限制可访问域名
        - 权限控制: read/write/exec 细粒度
        - 审计追踪: 所有副作用记录到 audit log
        - 操作回滚: 失败时 git reset
            |
            v
[4] fallback 链调用
    for agent_type in fallback_chain (基于 F032 能力画像盲点互补 + 成本排序):
        `--> adapter.health_check -> true
            `--> adapter.invoke(task)
                `--> 成功:
                    |-- shared_state.write(forgekin_id, task_id, result) [F033]
                    |-- fusion.fuse(forgekin_id, adapter.get_profile) [F035]
                    `--> 返回 result
                `--> 失败: 继续下一个 agent_type
            |
            v
[5] 全部失败 -> 降级
    `--> 返回 ExternalAgentResult(success=False, error="degrade_to_builtin")
    `--> FlowForge 内置 agent 接管任务
            |
            v
[6] 执行轨迹回流
    `--> Eval 信号写入 F018 Eval Contract
    `--> FallbackExecutionRecord 写入 F014 EchoStore（供 F035 SpiritForge蒸馏）
    `--> 审计日志归档
    `--> worktree cleanup
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **依赖 F001 CapabilityProfile**：能力画像融合目标。
- **依赖 F002 TeamAct**：ExternalAgentSharedState 与 TeamActState 一一关联。
- **依赖 F003 HandoffCapsule**：Collaboration Contract 支持交接胶囊。
- **依赖 F004 Ping-Pong Circuit Breaker**：Collaboration Contract 支持心跳。
- **依赖 F005 At-Mention Routing**：Collaboration Contract 支持 @-mention 路由。
- **依赖 F008 Durable State Surfaces**：ExternalAgentSharedState 持久化目标。
- **依赖 F014 Memory Collection**：FallbackExecutionRecord 写入EchoStore。
- **依赖 F018 Eval Contract**：三方 Agent 执行轨迹纳入 Eval 信号。
- **依赖 F022 Tier 1-4 Recovery**：三方 Agent 失败按 Tier 1-4 分级恢复。
- **依赖 F030 Virtual World Setting**：System Prompt Configuration Map 引用 World Setting + Role Mask 五层。
- **依赖 core/interfaces**：Repository / DI 容器抽象。

### 4.2 下游影响

- **影响 F032 三方 Agent 能力画像**：本架构作为容器，F032 在 profile.py 落地 CapabilityProfile 数据模型与匹配器。
- **影响 F033 三方 Agent 状态共享**：本架构作为容器，F033 在 shared_state.py 落地 SharedStateStore 与 Handoff 接口。
- **影响 F034 三方 Agent 失败回退**：本架构作为容器，F034 在 fallback.py 落地 FallbackChainExecutor 与 Builder。
- **影响 F035 三方 Agent 能力融合**：本架构作为容器，F035 在 capability_fusion.py 落地 FusionSourceCollector 与 Distiller。
- **影响 ForgekinBase.act**：Forgekin可通过 ExternalAgentBridge 调用三方 Agent 作为能力扩展。

### 4.3 跨模块不变量

- ExternalAgentBridge 必须是Forgekin调用三方 Agent 的唯一入口，禁止Forgekin直接调用 Adapter。
- EAC v1 七契约必须全部实现，缺一即 Adapter 注册被拒绝。
- 六层 Guardrails 必须按序穿过，任一层失败即调用被拒绝。
- worktree 隔离四项（网络/权限/审计/回滚）必须全部生效，禁止在主仓库直接执行。
- fallback 链必须基于 F032 能力画像盲点互补 + 成本排序构建，禁止按固定编号顺序。
- 全部三方 Agent 失败必须降级到 FlowForge 内置能力，禁止任务完全失败。
- 三方 Agent 执行轨迹必须同时写入 F018 Eval 信号 + F014 EchoStore，供SpiritForge蒸馏。
- System Prompt Configuration Map 必须包含 Role Mask 五层 + Core Identity + World Setting 引用，保持 Avatar Sync。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过 —— `core/external_agent/` 不 import *Forge 任何模块。
- [ ] AC-2: DI 容器注入通过 —— ExternalAgentAdapter / Bridge / 六层 Guardrails 通过 DI 容器注入。
- [ ] AC-3: Repository 层通过 —— ExternalAgentSharedState 通过 Repository 写入 F008，无直接数据库操作。
- [ ] AC-4: 配置驱动通过 —— EAC v1 七契约 + 六层 Guardrails + 4 Adapter 配置 YAML 外置到 `config/external_agent.yaml`，无 .py 硬编码 API key / 端口。
- [ ] AC-5: EAC v1 七契约注册门通过 —— 4 个 Adapter 均实现七契约，注册到 ExternalAgentBridge 成功。

### 5.2 架构不变量验收

- [ ] AC-6: 七契约硬门不变量通过 —— 缺任一契约的 Adapter 注册被拒绝。
- [ ] AC-7: 六层 Guardrails 不变量通过 —— 任一层失败时调用被拒绝，错误信息含 guardrail 名称。
- [ ] AC-8: worktree 隔离不变量通过 —— 三方 Agent 在独立 worktree 执行，主仓库代码未被越权修改。
- [ ] AC-9: fallback 链不变量通过 —— fallback 链基于 F032 能力画像构建，非固定编号顺序。
- [ ] AC-10: 全部失败降级不变量通过 —— 全部三方 Agent 失败时降级到 FlowForge 内置能力，返回 degrade_to_builtin。
- [ ] AC-11: 能力融合不变量通过 —— 三方 Agent 调用成功后能力画像融合到 CapabilityProfile（F035）。
- [ ] AC-12: 共享状态不变量通过 —— ExternalAgentSharedState 与 F002 TeamActState 一一关联。
- [ ] AC-13: 执行轨迹回流不变量通过 —— 三方 Agent 执行轨迹同时写入 F018 Eval 信号 + F014 EchoStore。
- [ ] AC-14: System Prompt Configuration Map 不变量通过 —— 三方 Agent 接受 Role Mask 五层 + Core Identity + World Setting 引用，Avatar Sync 一致。
- [ ] AC-15: Bridge 唯一入口不变量通过 —— Forgekin无直接调用 Adapter 的代码路径。

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）+ [doc:../spec.md#§2.9]（三方 Agent 集成）
- [doc:../arch.md#§3.10]（三方 Agent 集成 ExternalAgentAdapter 抽象层）
- [doc:../arch.md#§4.4]（三方 Agent EAC 接口）
- [doc:../features/F031-external-agent-adapter.md]（同号 Feature 级 SRS）
- [doc:../features/F001-capability-profile.md]
- [doc:../features/F002-teamact-loop.md]
- [doc:../features/F003-handoff-capsule.md]
- [doc:../features/F004-pingpong-circuit-breaker.md]
- [doc:../features/F005-at-mention-routing.md]
- [doc:../features/F008-durable-state-surfaces.md]
- [doc:../features/F014-memory-collection.md]
- [doc:../features/F018-eval-contract.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F030-virtual-world-setting.md]
- [doc:../features/F032-external-agent-profile.md]
- [doc:../features/F033-external-agent-shared-state.md]
- [doc:../features/F034-external-agent-fallback.md]
- [doc:../features/F035-external-agent-capability-fusion.md]
- [doc:../decisions/006-external-agent-integration.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#AI编程优秀实践]（六层 Guardrails 主张）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（EAC v1 七契约 + 六层 Guardrails + worktree 隔离 + fallback + 能力融合 + System Prompt Configuration Map 全维度架构） | 架构师 Forgekin（猫头鹰·鲁班） |

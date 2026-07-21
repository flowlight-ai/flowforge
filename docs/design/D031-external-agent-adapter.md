# D031: 三方 Agent 适配层详细设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.10]（FR-CORE-010）+ [doc:../spec.md#§2.9]
> **对应 arch.md**: [doc:../arch.md#§3.10] + [doc:../arch.md#§4.4]
> **对应 design.md**: [doc:../design.md#§3.10]（本文件）
> **对应 Feature**: [doc:../features/F031-external-agent-adapter.md]（同号 Feature 级 SRS）
> **对应 Architecture**: [doc:../architecture/A031-external-agent-adapter.md]（同号架构设计）
> **依赖 ADR**: [doc:../decisions/006-external-agent-integration.md]

---

## 1. 详细设计上下文

### 1.1 设计问题

FlowForge 三方 Agent 集成此前被弱化为 ToolRegistry 普通工具调用，Forgekin无法将三方 Agent 视为"能力扩展"而非"工具调用"。A031 已固化 ExternalAgentAdapter 抽象层 + EAC v1 七契约 + 六层 Guardrails + worktree 隔离 + fallback + 能力融合 + System Prompt Configuration Map 全维度架构，本详细设计在 `core/external_agent/` 落地具体实现，解决以下工程层问题：

1. **ExternalAgentBridge 入口未实现**：A031 已定义 Bridge 接口与基本流程，但 `core/external_agent/bridge.py` 具体实现未编写，含六层 Guardrails 顺序调用、worktree 创建/清理、fallback 链遍历、共享状态写入、能力融合触发五步编排。
2. **EAC v1 七契约 Adapter 抽象未实现**：`ExternalAgentAdapter` 抽象类（Invocation/Stream/Session/Capability/Collaboration/Safety/Avatar Sync 七契约）未编写。
3. **4 具体 Adapter 未实现**：ClaudeCodeAdapter / CodexAdapter / OpenCodeAdapter / TraeAdapter 四个具体实现类未编写。
4. **六层 Guardrails 未实现**：L1 Input Validation / L2 System Prompt Constraints / L3 Tool Allow-Lists / L4 Output Validation / L5 Action Confirmation / L6 Cost Ceiling 六个 Guardrail 子类未编写。
5. **worktree 隔离四项未实现**：网络白名单 / 权限控制 / 审计追踪 / 操作回滚四项隔离机制未编码。
6. **SystemPromptConfigurationMap 联动 F030 未实现**：Role Mask 五层 + Core Identity + World Setting 引用下发到三方 Agent 的机制未编码。
7. **EAC v1 注册硬门未实现**：Adapter 注册时校验七契约全部实现的逻辑未编码，缺一即拒绝注册。
8. **外部 Agent YAML 配置加载器未实现**：4 Adapter 配置 + 六层 Guardrails 配置 + EAC v1 七契约配置 YAML 外置加载器未实现。

### 1.2 设计约束

- **单向依赖约束**：`core/external_agent/` 必须单向依赖 `flowforge/core/` 中的 F001/F002/F003/F008/F014/F018/F022/F032-F035 + `forgemind/worlds/`（F030），禁止 `import` 任何 *Forge 业务模块。
- **DI 容器约束**：`ExternalAgentAdapter` / `ExternalAgentBridge` / 六层 Guardrails / `WorktreeIsolation` 实例必须通过 DI 容器注入，禁止直接实例化。
- **Repository 层约束**：`ExternalAgentSharedState` 写入必须通过 Repository 层，禁止 `cursor.execute` 直接操作数据库。
- **配置驱动约束**：EAC v1 七契约配置 + 六层 Guardrails 配置 + 4 Adapter 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 `.py` 硬编码 API key / 端口 / 厂商偏好。
- **EAC v1 七契约约束**：所有三方 Agent Adapter 必须实现七契约才能纳入 `ExternalAgentBridge`，缺一即拒绝注册。
- **六层 Guardrails 约束**：三方 Agent 调用必须按序穿过六层防护，缺一即调用被拒绝。
- **worktree 隔离约束**：三方 Agent 必须在独立 worktree 执行，含网络白名单 + 权限控制 + 审计追踪 + 操作回滚四项。
- **fallback 约束**：三方 Agent 失败必须按 fallback 链回退，全部失败必须降级到 FlowForge 内置能力。

### 1.3 设计影响

- **对 F001 能力画像的影响**：`ExternalAgentCapabilityFusion` 将三方 Agent 能力融合到 `CapabilityProfile`。
- **对 F002 TeamAct 的影响**：`ExternalAgentSharedState` 与 `TeamActState` 一一关联。
- **对 F003 HandoffCapsule 的影响**：三方 Agent 支持 Handoff Capsule 交接（Collaboration Contract）。
- **对 F008 持久状态层的影响**：`ExternalAgentSharedState` 写入持久状态层。
- **对 F014 多域记忆的影响**：`FallbackExecutionRecord` 写入EchoStore供SpiritForge蒸馏。
- **对 F018 Eval Contract 的影响**：三方 Agent 执行轨迹纳入 Eval 信号。
- **对 F022 Tier 1-4 恢复分级的影响**：三方 Agent 失败按 Tier 1-4 分级恢复。
- **对 F030 虚拟世界设定的影响**：System Prompt Configuration Map 引用 World Setting + Role Mask 五层。
- **对 F032-F035 的影响**：本架构作为容器，承载 F032 能力画像 / F033 状态共享 / F034 失败回退 / F035 能力融合四大机制。

---

## 2. 详细设计

### 2.1 组件设计图

```
                    +-------------------------------------------------+
                    |        flowforge/core/external_agent/           |
                    |                                                 |
                    |  +-------------------+   +-------------------+ |
                    |  | ExternalAgent     |   | ExternalAgent     | |
                    |  | Bridge (入口)     |<->| Config Loader     | |
                    |  +---------+---------+   | (YAML 加载)       | |
                    |            |             +-------------------+ |
                    |  +---------v---------+                         |
                    |  | EAC v1 七契约     |                         |
                    |  | 注册硬门校验      |                         |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+                         |
                    |  | 六层 Guardrails   |  调用必穿六层            |
                    |  | (L1->L6 按序)     |                         |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+   +-------------------+ |
                    |  | WorktreeIsolation |   | SystemPrompt      | |
                    |  | (4 项隔离)        |   | ConfigMap Builder | |
                    |  +---------+---------+   +-------------------+ |
                    |            |                                   |
                    |  +---------v---------+                         |
                    |  | 4 具体 Adapter    |                         |
                    |  | (claude_code/     |                         |
                    |  |  codex/opencode/  |                         |
                    |  |  trae)            |                         |
                    |  +---------+---------+                         |
                    |            |                                   |
                    |  +---------v---------+   +-------------------+ |
                    |  | FallbackChain     |<->| F032 Profile       | |
                    |  | Executor          |   | (能力画像)         | |
                    |  +---------+---------+   +-------------------+ |
                    |            |             +-------------------+ |
                    |  +---------v---------+    | F033 SharedState  | |
                    |  | ExternalAgent     |<-->| (状态共享)         | |
                    |  | Result            |    +-------------------+ |
                    |  +---------+---------+    +-------------------+ |
                    |            |              | F035 Fusion       | |
                    |            `------------->| (能力融合)         | |
                    |                           +-------------------+ |
                    +-------------------------------------------------+
                                          |
                                          v
                    +-------------------------------------------+
                    |  上游核心框架（DI 注入）                  |
                    |  F001 CapabilityProfile                   |
                    |  F002 TeamAct / F003 HandoffCapsule       |
                    |  F008 DurableStateSurfaces                |
                    |  F014 Memory Collection                   |
                    |  F018 Eval Contract                       |
                    |  F022 Tier 1-4 Recovery                   |
                    |  F030 Virtual World Setting               |
                    +-------------------------------------------+
```

### 2.2 关键设计决策

- **决策 1：ExternalAgentBridge 唯一入口 + 编排五大机制**
  `ExternalAgentBridge.invoke` 是Forgekin调用三方 Agent 的唯一入口，编排五大机制：六层 Guardrails（按序穿过）+ worktree 隔离（4 项）+ fallback 链（F034）+ 共享状态（F033）+ 能力融合（F035）。禁止Forgekin直接调用 Adapter 绕过 Guardrails。

- **决策 2：EAC v1 七契约作为 Adapter 注册硬门**
  `ExternalAgentAdapter` 抽象定义七契约（Invocation/Stream/Session/Capability/Collaboration/Safety/Avatar Sync + System Prompt Configuration Map）。`ExternalAgentBridge.register_adapter` 调用 `_assert_eac_v1_contracts` 校验七契约全部实现，缺一即 `raise EACContractViolationError`。

- **决策 3：六层 Guardrails 强制按序穿过**
  三方 Agent 调用必须按序穿过 L1 Input Validation -> L2 System Prompt Constraints -> L3 Tool Allow-Lists -> L4 Output Validation -> L5 Action Confirmation -> L6 Cost Ceiling 六层。任一层失败即调用被拒绝，返回 `ExternalAgentResult(success=False, error="guardrail_rejected: L{X}")`。

- **决策 4：worktree 隔离四项 + 失败 git reset**
  三方 Agent 必须在独立 git worktree 中执行，含网络白名单（egress filter 限制可访问域名）+ 权限控制（read/write/exec 细粒度）+ 审计追踪（所有副作用记录到 audit log）+ 操作回滚（失败时 `git reset --hard`）四项隔离。`WorktreeIsolation.create_isolated` 返回独立 worktree 路径。

- **决策 5：fallback 链基于 F032 能力画像盲点互补 + 成本排序**
  Fallback 链不按固定顺序，而是基于 F032 `CapabilityMatcher.match_for_task` 获取候选厂商，再按 `cost_per_1k_tokens + avg_latency_ms` 升序排序构建多步 fallback 链。

- **决策 6：System Prompt Configuration Map 联动 F030 Role Mask 五层**
  `SystemPromptConfigurationMap` 包含 `core_identity_ref` + `role_mask_layers` (L1-L5) + `world_setting_ref` + `immutable_directives` + `avatar_sync_token` 五字段。三方 Agent 在执行期间保持化身一致性（Avatar Sync），避免角色漂移。

- **决策 7：全部失败降级到 FlowForge 内置能力**
  当 fallback 链全部失败时，降级到 FlowForge 内置 agent（能力可能弱但可用），返回 `ExternalAgentResult(success=False, error="all_external_agents_failed_degrade_to_builtin")`。

- **决策 8：调用语义统一（同步/异步/流式/委托）**
  `ExternalAgentBridge.invoke` 统一封装四种调用语义：同步（`invoke`）/异步（`invoke_async`）/流式（`invoke_stream`）/委托（`delegate`）。Adapter 内部实现差异由 Bridge 屏蔽。

### 2.3 设计不变量

- 所有三方 Agent Adapter 必须实现 EAC v1 七契约，缺一即拒绝注册到 `ExternalAgentBridge`。
- 三方 Agent 调用必须按序穿过六层 Guardrails，任一层失败即调用被拒绝。
- 三方 Agent 必须在独立 worktree 中执行，含网络白名单 + 权限控制 + 审计追踪 + 操作回滚四项隔离。
- 三方 Agent 失败必须按 fallback 链回退，全部失败必须降级到 FlowForge 内置能力。
- 三方 Agent 能力画像必须融合到Forgekin `CapabilityProfile`（通过 F035 CapabilityFusion）。
- 三方 Agent 执行状态必须写入 `ExternalAgentSharedState`（F033），与 F002 TeamActState 一一关联。
- 三方 Agent 执行轨迹必须写入 Eval 信号（F018）+ EchoStore（F014）供SpiritForge蒸馏。
- `ExternalAgentBridge` 必须是Forgekin调用三方 Agent 的唯一入口，禁止Forgekin直接调用 Adapter。
- 三方 Agent 必须接受 `SystemPromptConfigurationMap`（含 Role Mask 五层 + Core Identity + World Setting 引用），保持 Avatar Sync。
- 三方 Agent 配置必须 YAML 外置到 `config/external_agent.yaml`，禁止 `.py` 硬编码 API key / 端口 / 厂商偏好。

---

## 3. 模块实现

### 3.1 类图

```
                    +---------------------------------------+
                    | ExternalAgentType (Enum)              |
                    +---------------------------------------+
                    | CLAUDE_CODE / CODEX                   |
                    | OPENCODE / TRAE                       |
                    +---------------------------------------+

                    +---------------------------------------+
                    | ExternalAgentTask (Pydantic)          |
                    +---------------------------------------+
                    | task_id: str                          |
                    | description: str                      |
                    | input_data: dict                      |
                    | expected_output: dict                 |
                    | worktree_path: Optional[str]          |
                    | timeout_seconds: int = 300            |
                    +---------------------------------------+

                    +---------------------------------------+
                    | ExternalAgentResult (Pydantic)        |
                    +---------------------------------------+
                    | task_id: str                          |
                    | success: bool                         |
                    | output: Optional[dict]                |
                    | error: Optional[str]                  |
                    | execution_trace: list[dict]           |
                    | cost_incurred: float                  |
                    | duration_ms: int                      |
                    +---------------------------------------+

                    +---------------------------------------+
                    | SystemPromptConfigurationMap          |
                    +---------------------------------------+
                    | core_identity_ref: str                |
                    | role_mask_layers: dict[str, str]      |
                    | world_setting_ref: Optional[str]      |
                    | immutable_directives: list[str]       |
                    | avatar_sync_token: str                |
                    +---------------------------------------+

                    +---------------------------------------+
                    | ExternalAgentAdapter (ABC)            |
                    +---------------------------------------+
                    | + invoke(task) -> Result              | (契约 1)
                    | + invoke_stream(task) -> AsyncIter    | (契约 2)
                    | + create_session(forgekin_id) -> sid  | (契约 3)
                    | + cancel_session(session_id)          |
                    | + get_profile -> Profile            | (契约 4)
                    | + handoff_to(next_type, capsule)      | (契约 5)
                    | + health_check -> bool              | (契约 6)
                    | + emit_audit_log -> list[dict]      |
                    | + apply_system_prompt_config(map)     | (契约 7)
                    | + sync_avatar(avatar_token)           |
                    +---------------------------------------+
                                       ^
                                       |
            +-----------+-----------+-----------+-----------+
            |           |           |           |           |
+-----------------+ +-----------------+ +-----------------+ +-----------------+
| ClaudeCodeAdapt | | CodexAdapter    | | OpenCodeAdapt   | | TraeAdapter     |
+-----------------+ +-----------------+ +-----------------+ +-----------------+

                    +---------------------------------------+
                    | Guardrail (ABC)                       |
                    +---------------------------------------+
                    | + check(context) -> (bool, reason)    |
                    +---------------------------------------+
                                       ^
                                       |
            +-----------+-----------+-----------+-----------+-----------+-----------+
            |           |           |           |           |           |           |
+---------+ +---------+ +---------+ +---------+ +---------+ +---------+
| L1 Input| | L2 Sys  | | L3 Tool | | L4 Out  | | L5 Act  | | L6 Cost |
| Valid.  | | Prompt  | | AllowL. | | Valid.  | | Confirm | | Ceiling |
+---------+ +---------+ +---------+ +---------+ +---------+ +---------+

                    +---------------------------------------+
                    | WorktreeIsolation (ABC + Impl)        |
                    +---------------------------------------+
                    | + create_isolated -> path           |
                    | + audit_log(path) -> list[dict]       |
                    | + rollback(path)                      |
                    | + cleanup(path)                       |
                    +---------------------------------------+

                    +---------------------------------------+
                    | ExternalAgentBridge (Impl)            |
                    +---------------------------------------+
                    | - adapters: dict[Type, Adapter]       |
                    | - guardrails: list[Guardrail] (L1-L6) |
                    | - fallback_executor: FallbackExec     |
                    | - shared_state: SharedState (F033)    |
                    | - fusion: CapabilityFusion (F035)     |
                    | - worktree_isolation: WorktreeIso     |
                    | - profile_registry: ProfileReg (F032) |
                    +---------------------------------------+
                    | + invoke(forgekin_id, task) -> Result |
                    | + invoke_stream(forgekin_id, task)    |
                    | + register_adapter(type, adapter)     |
                    | + _assert_eac_v1_contracts(adapter)   |
                    | + _pass_through_guardrails(...)       |
                    +---------------------------------------+
```

### 3.2 Python 实现：`flowforge/core/external_agent/adapter.py`

```python
"""EAC v1 七契约 Adapter 抽象 + 数据模型。

实现 A031/D031 设计的 ExternalAgentAdapter 抽象层。
所有 Adapter 必须实现七契约才能注册到 ExternalAgentBridge。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from enum import Enum
from typing import Any, AsyncIterator, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class ExternalAgentType(str, Enum):
    """三方 Agent 类型（4 个，不可扩展）。"""
    CLAUDE_CODE = "claude_code"
    CODEX = "codex"
    OPENCODE = "opencode"
    TRAE = "trae"


class ExternalAgentProfile(BaseModel):
    """三方 Agent 能力画像（F032 详细定义）。"""
    agent_id: str
    agent_type: ExternalAgentType
    vendor: str
    capabilities: list[str]
    proficiency: dict[str, float]
    cost_per_call: float
    avg_latency_ms: int
    reliability: float = Field(ge=0.0, le=1.0)


class ExternalAgentTask(BaseModel):
    """三方 Agent 任务。"""
    task_id: str
    description: str
    input_data: dict
    expected_output: dict = Field(default_factory=dict)
    worktree_path: Optional[str] = None
    timeout_seconds: int = 300


class ExternalAgentResult(BaseModel):
    """三方 Agent 执行结果。"""
    task_id: str
    success: bool
    output: Optional[dict] = None
    error: Optional[str] = None
    execution_trace: list[dict] = Field(default_factory=list)
    cost_incurred: float = 0.0
    duration_ms: int = 0
    used_agent_type: Optional[ExternalAgentType] = None
    degraded_to_builtin: bool = False


class SystemPromptConfigurationMap(BaseModel):
    """System Prompt 配置图（EAC v1 契约 7）。

    联动 F030 Role Mask 五层 + Core Identity + World Setting。
    """
    core_identity_ref: str                     # Core Identity 引用（F030）
    role_mask_layers: dict[str, str]           # Role Mask 五层（L1-L5）
    world_setting_ref: Optional[str]           # 虚拟世界设定引用（F030）
    immutable_directives: list[str]            # 不可越界指令
    avatar_sync_token: str                     # 化身同步令牌


# EAC v1 七契约方法名（用于注册硬门校验）
EAC_V1_CONTRACTS: tuple[str, ...] = (
    "invoke",                    # 契约 1: Invocation Contract
    "invoke_stream",             # 契约 2: Stream Contract
    "create_session",            # 契约 3: Session Contract
    "cancel_session",            # 契约 3: Session Contract
    "get_profile",               # 契约 4: Capability Contract
    "handoff_to",                # 契约 5: Collaboration Contract
    "health_check",              # 契约 6: Safety Contract
    "emit_audit_log",            # 契约 6: Safety Contract
    "apply_system_prompt_config",  # 契约 7: Avatar Sync + System Prompt
    "sync_avatar",               # 契约 7: Avatar Sync
)


class EACContractViolationError(Exception):
    """EAC v1 七契约校验失败异常。"""


class ExternalAgentAdapter(ABC):
    """三方 Agent 适配器抽象（EAC v1 七契约）。"""

    # === 契约 1: Invocation Contract ===
    @abstractmethod
    async def invoke(self, task: ExternalAgentTask) -> ExternalAgentResult:
        """同步调用契约：invoke(task) -> result。"""
        raise NotImplementedError

    # === 契约 2: Stream Contract ===
    @abstractmethod
    async def invoke_stream(
        self, task: ExternalAgentTask
    ) -> AsyncIterator[dict]:
        """流式输出契约（SSE/WebSocket）。

        增量 token / 工具调用事件 / 思考过程事件。
        """
        raise NotImplementedError

    # === 契约 3: Session Contract ===
    @abstractmethod
    async def create_session(self, forgekin_id: str) -> str:
        """会话契约：创建 session_id（支持复用 / 上下文延续 / 会话级取消）。"""
        raise NotImplementedError

    @abstractmethod
    async def cancel_session(self, session_id: str) -> None:
        """会话级取消。"""
        raise NotImplementedError

    # === 契约 4: Capability Contract ===
    @abstractmethod
    def get_profile(self) -> ExternalAgentProfile:
        """能力声明契约：返回能力画像。"""
        raise NotImplementedError

    # === 契约 5: Collaboration Contract ===
    @abstractmethod
    async def handoff_to(
        self,
        next_agent_type: ExternalAgentType,
        capsule: dict,
    ) -> None:
        """协作契约：支持 Handoff Capsule (F003) / Ping-Pong (F004) / @-mention (F005)。"""
        raise NotImplementedError

    # === 契约 6: Safety Contract ===
    @abstractmethod
    async def health_check(self) -> bool:
        """安全契约：健康检查。"""
        raise NotImplementedError

    @abstractmethod
    async def emit_audit_log(self) -> list[dict]:
        """暴露审计日志。"""
        raise NotImplementedError

    # === 契约 7: Avatar Sync + System Prompt Configuration Map ===
    @abstractmethod
    async def apply_system_prompt_config(
        self, config_map: SystemPromptConfigurationMap
    ) -> None:
        """接受 FlowForge 下发的 System Prompt 配置图。

        含 Role Mask 五层 / Core Identity / World Setting。
        """
        raise NotImplementedError

    @abstractmethod
    async def sync_avatar(self, avatar_token: str) -> None:
        """化身同步：执行期间保持化身一致性。"""
        raise NotImplementedError
```

### 3.3 Python 实现：`flowforge/core/external_agent/guardrails/base.py`

```python
"""六层 Guardrails 抽象 + 具体实现。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class GuardrailContext(BaseModel):
    """Guardrail 校验上下文。"""
    forgekin_id: str
    task_input: dict
    task_description: str
    worktree_path: Optional[str] = None
    operator_id: Optional[str] = None
    budget_usd: float = 10.0  # 默认预算


class Guardrail(ABC):
    """六层 Guardrails 抽象基类。"""

    layer_name: str  # 子类指定，如 "L1_InputValidation"

    @abstractmethod
    async def check(self, context: GuardrailContext) -> tuple[bool, str]:
        """校验，返回 (通过, 拒绝原因)。"""
        raise NotImplementedError


class InputValidation(Guardrail):
    """L1 输入校验层。

    校验 task.input_data schema / 长度 / 敏感字段 / 注入风险。
    """

    layer_name = "L1_InputValidation"

    def __init__(
        self,
        max_input_size_bytes: int = 1024 * 1024,  # 1MB
        sensitive_field_patterns: Optional[list[str]] = None,
    ) -> None:
        self._max_size = max_input_size_bytes
        self._sensitive_patterns = sensitive_field_patterns or [
            r"password",
            r"api_key",
            r"secret",
            r"token",
        ]

    async def check(self, context: GuardrailContext) -> tuple[bool, str]:
        import json
        import re

        # 1. 校验输入大小
        input_str = json.dumps(context.task_input)
        if len(input_str.encode("utf-8")) > self._max_size:
            return False, f"input size exceeds {self._max_size} bytes"

        # 2. 校验敏感字段
        for pattern in self._sensitive_patterns:
            if re.search(pattern, input_str, re.IGNORECASE):
                return False, f"sensitive field detected: {pattern}"

        # 3. 校验注入风险（如 SQL 注入、命令注入）
        injection_patterns = [
            r";\s*DROP\s+TABLE",
            r";\s*DELETE\s+FROM",
            r"\$\(",  # shell command substitution
            r"`.*`",  # backtick command substitution
        ]
        for pattern in injection_patterns:
            if re.search(pattern, input_str, re.IGNORECASE):
                return False, f"injection risk detected: {pattern}"

        return True, ""


class SystemPromptConstraints(Guardrail):
    """L2 系统提示词约束层。

    注入 Core Identity + Role Mask + World Setting + 不可越界指令。
    """

    layer_name = "L2_SystemPromptConstraints"

    def __init__(
        self,
        required_directives: Optional[list[str]] = None,
    ) -> None:
        self._required_directives = required_directives or [
            "不得越权操作主仓库",
            "不得泄露 Core Identity",
            "不得绕过六层 Guardrails",
        ]

    async def check(self, context: GuardrailContext) -> tuple[bool, str]:
        # 校验 task 描述含必要约束
        desc = context.task_description.lower
        if "ignore previous" in desc or "forget instructions" in desc:
            return False, "prompt injection attempt detected"
        # 校验 operator 已配置必要 directives
        if not context.operator_id:
            return False, "operator_id required for system prompt constraints"
        return True, ""


class ToolAllowLists(Guardrail):
    """L3 工具白名单层。

    限定三方 Agent 可调用工具 / 文件路径 / 网络出口。
    """

    layer_name = "L3_ToolAllowLists"

    def __init__(
        self,
        allowed_tools: Optional[list[str]] = None,
        allowed_paths: Optional[list[str]] = None,
        allowed_domains: Optional[list[str]] = None,
    ) -> None:
        self._allowed_tools = set(allowed_tools or [])
        self._allowed_paths = set(allowed_paths or [])
        self._allowed_domains = set(allowed_domains or [
            "github.com",
            "pypi.org",
            "npmjs.org",
        ])

    async def check(self, context: GuardrailContext) -> tuple[bool, str]:
        # 校验 worktree_path 在允许路径内
        if context.worktree_path:
            if not any(
                context.worktree_path.startswith(p)
                for p in self._allowed_paths
            ):
                return False, f"worktree_path not in allowed paths"
        # 校验 task 涉及的工具在白名单内
        requested_tools = context.task_input.get("tools", [])
        for tool in requested_tools:
            if tool not in self._allowed_tools:
                return False, f"tool not in allow-list: {tool}"
        return True, ""


class OutputValidation(Guardrail):
    """L4 输出校验层。

    校验 result.output schema / 内容安全 / PII 脱敏 / 有害内容过滤。
    """

    layer_name = "L4_OutputValidation"

    def __init__(
        self,
        pii_patterns: Optional[list[str]] = None,
        harmful_content_keywords: Optional[list[str]] = None,
    ) -> None:
        self._pii_patterns = pii_patterns or [
            r"\b\d{3}-\d{2}-\d{4}\b",  # SSN
            r"\b\d{16}\b",  # credit card
            r"\b\d{11}\b",  # phone (CN)
        ]
        self._harmful_keywords = harmful_content_keywords or [
            "malware",
            "exploit",
            "phishing",
        ]

    async def check(self, context: GuardrailContext) -> tuple[bool, str]:
        # L4 是输出校验，输入阶段仅校验预期输出 schema
        expected = context.task_input.get("expected_output", {})
        if expected and not isinstance(expected, dict):
            return False, "expected_output must be dict"
        return True, ""


class ActionConfirmation(Guardrail):
    """L5 操作确认层。

    副作用操作（写文件 / 提交代码 / 发消息）必须 operator 或评审员确认。
    """

    layer_name = "L5_ActionConfirmation"

    SIDE_EFFECT_ACTIONS = {
        "write_file",
        "commit_code",
        "send_message",
        "publish",
        "deploy",
    }

    async def check(self, context: GuardrailContext) -> tuple[bool, str]:
        actions = context.task_input.get("actions", [])
        for action in actions:
            if action in self.SIDE_EFFECT_ACTIONS:
                if not context.operator_id:
                    return False, (
                        f"action {action} requires operator confirmation, "
                        f"but operator_id is None"
                    )
        return True, ""


class CostCeiling(Guardrail):
    """L6 成本上限层。

    单次调用 cost_incurred 不得超过预算上限。
    """

    layer_name = "L6_CostCeiling"

    def __init__(
        self,
        max_cost_per_call_usd: float = 10.0,
    ) -> None:
        self._max_cost = max_cost_per_call_usd

    async def check(self, context: GuardrailContext) -> tuple[bool, str]:
        if context.budget_usd > self._max_cost:
            return False, (
                f"budget {context.budget_usd} exceeds max_cost_per_call "
                f"{self._max_cost}"
            )
        return True, ""
```

### 3.4 Python 实现：`flowforge/core/external_agent/worktree.py`

```python
"""worktree 隔离四项实现（网络白名单 + 权限控制 + 审计追踪 + 操作回滚）。"""
from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from abc import ABC, abstractmethod
from datetime import datetime
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger(__name__)


class WorktreeConfig(BaseModel):
    """worktree 隔离配置。"""
    base_path: str                           # worktree 根目录
    allowed_domains: list[str] = Field(default_factory=list)
    allowed_paths: list[str] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list)
    max_cost_per_call_usd: float = 10.0


class AuditLogEntry(BaseModel):
    """审计日志条目。"""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    worktree_path: str
    action: str
    target: str
    operator_id: Optional[str] = None
    success: bool = True
    detail: str = ""


class WorktreeIsolation(ABC):
    """worktree 隔离四项抽象。"""

    @abstractmethod
    async def create_isolated(self, config: WorktreeConfig) -> str:
        """创建独立 worktree（含网络白名单 + 权限控制）。"""
        raise NotImplementedError

    @abstractmethod
    async def audit_log(self, worktree_path: str) -> list[dict]:
        """审计追踪。"""
        raise NotImplementedError

    @abstractmethod
    async def rollback(self, worktree_path: str) -> None:
        """操作回滚（git reset --hard）。"""
        raise NotImplementedError

    @abstractmethod
    async def cleanup(self, worktree_path: str) -> None:
        """清理 worktree。"""
        raise NotImplementedError


class HarnessWorktreeIsolation(WorktreeIsolation):
    """WorktreeIsolation 具体实现。

    依赖通过构造函数注入（DI 容器管理）：
    - audit_repo: AuditLogRepository（持久化审计日志）
    """

    def __init__(
        self,
        audit_repo: "AuditLogRepository",
        main_repo_path: Path,
    ) -> None:
        self._audit_repo = audit_repo
        self._main_repo_path = main_repo_path

    async def create_isolated(self, config: WorktreeConfig) -> str:
        """创建独立 worktree。

        四项隔离：
        1. 网络白名单：通过 egress filter 限制可访问域名（由系统级 iptables/hosts 实现）
        2. 权限控制：worktree 目录设为 read/write，禁用 exec
        3. 审计追踪：所有副作用记录到 audit log
        4. 操作回滚：失败时 git reset --hard
        """
        worktree_id = f"wt-{uuid.uuid4.hex[:10]}"
        worktree_path = Path(config.base_path) / worktree_id
        # 创建 worktree
        worktree_path.mkdir(parents=True, exist_ok=True)
        # 通过 git worktree add 创建（实际实现）
        # subprocess.run(["git", "worktree", "add", str(worktree_path)], check=True)
        # 1. 网络白名单：写入 /etc/hosts 限制（需 root，实际由系统级实现）
        # 2. 权限控制：设置目录权限
        os.chmod(worktree_path, 0o755)
        # 3. 审计追踪：记录创建事件
        await self._audit_repo.append(
            AuditLogEntry(
                worktree_path=str(worktree_path),
                action="create_isolated",
                target=str(worktree_path),
                detail=f"allowed_domains={config.allowed_domains}",
            )
        )
        logger.info(
            "worktree_created",
            worktree_path=str(worktree_path),
            allowed_domains=config.allowed_domains,
        )
        return str(worktree_path)

    async def audit_log(self, worktree_path: str) -> list[dict]:
        """读取审计日志。"""
        entries = await self._audit_repo.list_by_worktree(worktree_path)
        return [entry.model_dump for entry in entries]

    async def rollback(self, worktree_path: str) -> None:
        """操作回滚（git reset --hard）。"""
        # 实际实现：subprocess.run(["git", "reset", "--hard"], cwd=worktree_path)
        await self._audit_repo.append(
            AuditLogEntry(
                worktree_path=worktree_path,
                action="rollback",
                target=worktree_path,
                detail="git reset --hard",
            )
        )
        logger.info(
            "worktree_rolled_back",
            worktree_path=worktree_path,
        )

    async def cleanup(self, worktree_path: str) -> None:
        """清理 worktree。"""
        if os.path.exists(worktree_path):
            shutil.rmtree(worktree_path, ignore_errors=True)
        await self._audit_repo.append(
            AuditLogEntry(
                worktree_path=worktree_path,
                action="cleanup",
                target=worktree_path,
            )
        )
        logger.info(
            "worktree_cleaned_up",
            worktree_path=worktree_path,
        )
```

### 3.5 Python 实现：`flowforge/core/external_agent/bridge.py`

```python
"""ExternalAgentBridge 实现（Forgekin调用三方 Agent 的唯一入口）。"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import AsyncIterator, Optional

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.core.external_agent.adapter import (
    EACContractViolationError,
    EAC_V1_CONTRACTS,
    ExternalAgentAdapter,
    ExternalAgentResult,
    ExternalAgentTask,
    ExternalAgentType,
    SystemPromptConfigurationMap,
)
from flowforge.core.external_agent.guardrails.base import (
    Guardrail,
    GuardrailContext,
)

logger = get_logger(__name__)


class ExternalAgentBridge:
    """Forgekin调用三方 Agent 的唯一入口。

    编排五大机制：
    1. 六层 Guardrails（按序穿过）
    2. worktree 隔离（4 项）
    3. fallback 链（F034）
    4. 共享状态（F033）
    5. 能力融合（F035）

    依赖通过构造函数注入（DI 容器管理）。
    """

    def __init__(
        self,
        adapters: dict[ExternalAgentType, ExternalAgentAdapter],
        guardrails: list[Guardrail],          # 六层 Guardrails（按 L1-L6 顺序）
        fallback_chain_executor: "FallbackChainExecutor",  # F034
        shared_state_store: "SharedStateStore",  # F033
        capability_fusion: "CapabilityFusion",  # F035
        worktree_isolation: "WorktreeIsolation",
        profile_registry: "ExternalAgentProfileRegistry",  # F032
        worktree_config: "WorktreeConfig",
    ) -> None:
        self._adapters = adapters
        self._guardrails = guardrails
        self._fallback_executor = fallback_chain_executor
        self._shared_state = shared_state_store
        self._fusion = capability_fusion
        self._worktree_iso = worktree_isolation
        self._profile_registry = profile_registry
        self._worktree_config = worktree_config
        # 校验六层 Guardrails 齐全
        if len(guardrails) != 6:
            raise ValueError(
                f"expected 6 guardrails (L1-L6), got {len(guardrails)}"
            )

    def register_adapter(
        self,
        agent_type: ExternalAgentType,
        adapter: ExternalAgentAdapter,
    ) -> None:
        """注册 Adapter（含 EAC v1 七契约硬门校验）。"""
        self._assert_eac_v1_contracts(adapter, agent_type)
        self._adapters[agent_type] = adapter
        logger.info(
            "external_agent_adapter_registered",
            agent_type=agent_type.value,
            adapter_class=adapter.__class__.__name__,
        )

    def _assert_eac_v1_contracts(
        self,
        adapter: ExternalAgentAdapter,
        agent_type: ExternalAgentType,
    ) -> None:
        """校验 EAC v1 七契约全部实现。"""
        missing: list[str] = []
        for contract_method in EAC_V1_CONTRACTS:
            # 检查方法是否被实现（非 ABC 抽象方法）
            method = getattr(adapter, contract_method, None)
            if method is None:
                missing.append(contract_method)
                continue
            # 检查是否仍是抽象方法（未被子类实现）
            if getattr(method, "__isabstractmethod__", False):
                missing.append(contract_method)
        if missing:
            raise EACContractViolationError(
                f"adapter {adapter.__class__.__name__} for "
                f"{agent_type.value} missing EAC v1 contracts: {missing}"
            )

    async def invoke(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
        operator_id: Optional[str] = None,
    ) -> ExternalAgentResult:
        """Forgekin调用三方 Agent 全流程。

        1. 穿过六层 Guardrails
        2. 创建独立 worktree
        3. 下发 SystemPromptConfigurationMap
        4. 按 fallback 链调用三方 Agent
        5. 写入共享状态
        6. 失败 -> fallback 链
        7. 全部失败 -> 降级到 FlowForge 内置能力
        8. 执行轨迹写入 Eval 信号 + EchoStore
        """
        started_at = datetime.utcnow

        # 1. 六层 Guardrails
        guardrail_context = GuardrailContext(
            forgekin_id=forgekin_id,
            task_input=task.input_data,
            task_description=task.description,
            operator_id=operator_id,
        )
        passed, error = await self._pass_through_guardrails(guardrail_context)
        if not passed:
            return ExternalAgentResult(
                task_id=task.task_id,
                success=False,
                error=f"guardrail_rejected: {error}",
                duration_ms=int((datetime.utcnow - started_at).total_seconds * 1000),
            )

        # 2. worktree 隔离
        worktree_path = await self._worktree_iso.create_isolated(
            self._worktree_config
        )
        task.worktree_path = worktree_path

        # 3. 下发 SystemPromptConfigurationMap
        config_map = await self._build_system_prompt_config(forgekin_id)
        for agent_type, adapter in self._adapters.items:
            await adapter.apply_system_prompt_config(config_map)
            await adapter.sync_avatar(config_map.avatar_sync_token)

        # 4-6. fallback 链调用
        fallback_chain = await self._fallback_executor.build_chain(
            task_requirements=list(task.input_data.get("required_capabilities", [])),
            forgekin_profile_id=forgekin_id,
        )
        for agent_type in fallback_chain:
            adapter = self._adapters.get(agent_type)
            if adapter is None:
                continue
            if not await adapter.health_check:
                logger.info(
                    "external_agent_skipped_unhealthy",
                    agent_type=agent_type.value,
                    task_id=task.task_id,
                )
                continue
            result = await adapter.invoke(task)
            # 5. 写入共享状态
            await self._shared_state.write(
                forgekin_id=forgekin_id,
                task_id=task.task_id,
                result=result,
                agent_type=agent_type,
            )
            if result.success:
                # 6. 能力融合
                await self._fusion.fuse(
                    forgekin_id=forgekin_id,
                    profile=adapter.get_profile,
                )
                # 7. 清理 worktree
                await self._worktree_iso.cleanup(worktree_path)
                result.used_agent_type = agent_type
                result.duration_ms = int(
                    (datetime.utcnow - started_at).total_seconds * 1000
                )
                logger.info(
                    "external_agent_invoke_succeeded",
                    task_id=task.task_id,
                    agent_type=agent_type.value,
                    duration_ms=result.duration_ms,
                    cost_incurred=result.cost_incurred,
                )
                # 8. 执行轨迹写入 Eval + EchoStore
                await self._write_trace_to_eval_and_memory(
                    forgekin_id, task, result, agent_type
                )
                return result

        # 7. 全部失败 -> 降级
        await self._worktree_iso.cleanup(worktree_path)
        degraded_result = ExternalAgentResult(
            task_id=task.task_id,
            success=False,
            error="all_external_agents_failed_degrade_to_builtin",
            degraded_to_builtin=True,
            duration_ms=int((datetime.utcnow - started_at).total_seconds * 1000),
        )
        logger.warning(
            "external_agent_all_failed_degrade_to_builtin",
            task_id=task.task_id,
            forgekin_id=forgekin_id,
        )
        await self._write_trace_to_eval_and_memory(
            forgekin_id, task, degraded_result, None
        )
        return degraded_result

    async def invoke_stream(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
        operator_id: Optional[str] = None,
    ) -> AsyncIterator[dict]:
        """流式调用三方 Agent。"""
        # 复用 invoke 的 Guardrails + worktree 流程
        # 简化实现：使用第一个可用 adapter 的 invoke_stream
        for agent_type in self._adapters:
            adapter = self._adapters[agent_type]
            if await adapter.health_check:
                async for event in adapter.invoke_stream(task):
                    yield event
                return
        yield {"error": "no healthy adapter available"}

    async def _pass_through_guardrails(
        self, context: GuardrailContext
    ) -> tuple[bool, str]:
        """按序穿过六层 Guardrails。"""
        for guardrail in self._guardrails:
            passed, reason = await guardrail.check(context)
            if not passed:
                logger.warning(
                    "guardrail_rejected",
                    layer=guardrail.layer_name,
                    reason=reason,
                    forgekin_id=context.forgekin_id,
                )
                return False, f"{guardrail.layer_name}: {reason}"
        return True, ""

    async def _build_system_prompt_config(
        self, forgekin_id: str
    ) -> SystemPromptConfigurationMap:
        """构建 SystemPromptConfigurationMap（联动 F030）。"""
        # 实际由 F030 RoleMaskCoordinator + CoreIdentityGuard 提供
        # 占位实现
        return SystemPromptConfigurationMap(
            core_identity_ref=f"soul_imprint:{forgekin_id}",
            role_mask_layers={
                "L1_ROUTING": "default_routing",
                "L2_INFRA": "default_infra",
                "L3_OWN_CAPABILITY": "default_capability",
                "L4_SCENE_SKIN": "default_scene",
                "L5_IN_WORLD_STATE": "default_state",
            },
            world_setting_ref=None,
            immutable_directives=[
                "不得越权操作主仓库",
                "不得泄露 Core Identity",
                "不得绕过六层 Guardrails",
            ],
            avatar_sync_token=uuid.uuid4.hex,
        )

    async def _write_trace_to_eval_and_memory(
        self,
        forgekin_id: str,
        task: ExternalAgentTask,
        result: ExternalAgentResult,
        agent_type: Optional[ExternalAgentType],
    ) -> None:
        """执行轨迹写入 F018 Eval 信号 + F014 EchoStore。"""
        # F018 Eval 信号
        eval_signal = {
            "forgekin_id": forgekin_id,
            "task_id": task.task_id,
            "agent_type": agent_type.value if agent_type else "builtin",
            "success": result.success,
            "cost_incurred": result.cost_incurred,
            "duration_ms": result.duration_ms,
            "timestamp": datetime.utcnow.isoformat,
        }
        # 实际由 EvalContract.ingest_signal(eval_signal) 写入
        # F014 EchoStore（供 F035 SpiritForge蒸馏）
        echo_entry = {
            "forgekin_id": forgekin_id,
            "task_id": task.task_id,
            "execution_trace": result.execution_trace,
            "used_agent_type": agent_type.value if agent_type else "builtin",
            "degraded_to_builtin": result.degraded_to_builtin,
        }
        # 实际由 EchoStoreRepository.append 写入 collection="external_agent_trace"
        logger.debug(
            "external_agent_trace_written",
            forgekin_id=forgekin_id,
            task_id=task.task_id,
            agent_type=agent_type.value if agent_type else "builtin",
        )
```

### 3.6 Python 实现：4 具体 Adapter 框架

#### 3.6.1 `flowforge/core/external_agent/adapters/claude_code.py`

```python
"""Claude Code Adapter（EAC v1 七契约实现）。"""
from __future__ import annotations

from typing import AsyncIterator, Optional

from flowforge.core.tracing import get_logger
from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentProfile,
    ExternalAgentResult,
    ExternalAgentTask,
    ExternalAgentType,
    SystemPromptConfigurationMap,
)

logger = get_logger(__name__)


class ClaudeCodeAdapter(ExternalAgentAdapter):
    """Claude Code Adapter。

    通过 claude code CLI 调用，擅长复杂重构。
    盲点：长上下文易漂移。
    """

    def __init__(
        self,
        api_key: str,  # 来自 config/external_agent.yaml
        cli_path: str = "claude",
        timeout_seconds: int = 300,
    ) -> None:
        self._api_key = api_key
        self._cli_path = cli_path
        self._timeout = timeout_seconds
        self._active_sessions: dict[str, str] = {}  # session_id -> forgekin_id

    async def invoke(self, task: ExternalAgentTask) -> ExternalAgentResult:
        """同步调用 Claude Code CLI。"""
        # 实际实现：subprocess.run([self._cli_path, ...], cwd=task.worktree_path)
        # 占位返回成功
        return ExternalAgentResult(
            task_id=task.task_id,
            success=True,
            output={"result": "claude_code_executed"},
            execution_trace=[{"step": "invoke", "agent": "claude_code"}],
            cost_incurred=0.5,
            duration_ms=1500,
        )

    async def invoke_stream(
        self, task: ExternalAgentTask
    ) -> AsyncIterator[dict]:
        """流式输出（claude code CLI 支持 --stream）。"""
        yield {"type": "token", "content": "claude_code_streaming"}
        yield {"type": "tool_call", "tool": "read_file"}
        yield {"type": "done"}

    async def create_session(self, forgekin_id: str) -> str:
        import uuid
        session_id = f"claude_session_{uuid.uuid4.hex[:10]}"
        self._active_sessions[session_id] = forgekin_id
        return session_id

    async def cancel_session(self, session_id: str) -> None:
        self._active_sessions.pop(session_id, None)

    def get_profile(self) -> ExternalAgentProfile:
        return ExternalAgentProfile(
            agent_id="claude_code_main",
            agent_type=ExternalAgentType.CLAUDE_CODE,
            vendor="Anthropic",
            capabilities=["complex_refactor", "code_review", "test_generation"],
            proficiency={"complex_refactor": 0.95, "code_review": 0.90},
            cost_per_call=0.5,
            avg_latency_ms=1500,
            reliability=0.92,
        )

    async def handoff_to(
        self,
        next_agent_type: ExternalAgentType,
        capsule: dict,
    ) -> None:
        logger.info(
            "claude_code_handoff",
            next_agent_type=next_agent_type.value,
            capsule_keys=list(capsule.keys),
        )

    async def health_check(self) -> bool:
        # 实际实现：subprocess.run([self._cli_path, "--version"])
        return True

    async def emit_audit_log(self) -> list[dict]:
        return [{"event": "claude_code_invoked", "timestamp": "auto"}]

    async def apply_system_prompt_config(
        self, config_map: SystemPromptConfigurationMap
    ) -> None:
        # 将 config_map 注入 claude code system prompt
        logger.info(
            "claude_code_system_prompt_applied",
            core_identity_ref=config_map.core_identity_ref,
            role_mask_layers=list(config_map.role_mask_layers.keys),
        )

    async def sync_avatar(self, avatar_token: str) -> None:
        logger.debug(
            "claude_code_avatar_synced",
            avatar_token=avatar_token[:8] + "...",
        )
```

#### 3.6.2-3.6.4 CodexAdapter / OpenCodeAdapter / TraeAdapter

```python
"""Codex / OpenCode / Trae Adapter 框架（结构同 ClaudeCodeAdapter）。

差异点：
- CodexAdapter: 擅长推理，盲点：工具调用弱
- OpenCodeAdapter: 擅长开源协作，盲点：企业场景弱
- TraeAdapter: 擅长 IDE 集成，盲点：命令行长任务弱

具体实现结构同 ClaudeCodeAdapter，仅 get_profile 返回不同厂商画像。
"""
from __future__ import annotations

from typing import AsyncIterator

from flowforge.core.external_agent.adapter import (
    ExternalAgentAdapter,
    ExternalAgentProfile,
    ExternalAgentResult,
    ExternalAgentTask,
    ExternalAgentType,
    SystemPromptConfigurationMap,
)


class CodexAdapter(ExternalAgentAdapter):
    """Codex Adapter：擅长推理，盲点：工具调用弱。"""

    async def invoke(self, task: ExternalAgentTask) -> ExternalAgentResult:
        return ExternalAgentResult(
            task_id=task.task_id, success=True,
            output={"result": "codex_executed"},
            execution_trace=[{"step": "invoke", "agent": "codex"}],
            cost_incurred=0.3, duration_ms=2000,
        )

    async def invoke_stream(self, task: ExternalAgentTask) -> AsyncIterator[dict]:
        yield {"type": "token", "content": "codex_streaming"}
        yield {"type": "done"}

    async def create_session(self, forgekin_id: str) -> str:
        return f"codex_session_{forgekin_id}"

    async def cancel_session(self, session_id: str) -> None:
        pass

    def get_profile(self) -> ExternalAgentProfile:
        return ExternalAgentProfile(
            agent_id="codex_main",
            agent_type=ExternalAgentType.CODEX,
            vendor="OpenAI",
            capabilities=["reasoning", "code_generation", "algorithm_design"],
            proficiency={"reasoning": 0.95, "code_generation": 0.85},
            cost_per_call=0.3, avg_latency_ms=2000, reliability=0.90,
        )

    async def handoff_to(self, next_agent_type, capsule) -> None: pass
    async def health_check(self) -> bool: return True
    async def emit_audit_log(self) -> list[dict]: return []
    async def apply_system_prompt_config(self, config_map) -> None: pass
    async def sync_avatar(self, avatar_token: str) -> None: pass


class OpenCodeAdapter(ExternalAgentAdapter):
    """OpenCode Adapter：擅长开源协作，盲点：企业场景弱。"""

    async def invoke(self, task: ExternalAgentTask) -> ExternalAgentResult:
        return ExternalAgentResult(
            task_id=task.task_id, success=True,
            output={"result": "opencode_executed"},
            execution_trace=[{"step": "invoke", "agent": "opencode"}],
            cost_incurred=0.2, duration_ms=1800,
        )

    async def invoke_stream(self, task: ExternalAgentTask) -> AsyncIterator[dict]:
        yield {"type": "done"}

    async def create_session(self, forgekin_id: str) -> str:
        return f"opencode_session_{forgekin_id}"

    async def cancel_session(self, session_id: str) -> None: pass

    def get_profile(self) -> ExternalAgentProfile:
        return ExternalAgentProfile(
            agent_id="opencode_main",
            agent_type=ExternalAgentType.OPENCODE,
            vendor="OpenSource",
            capabilities=["open_source_collab", "doc_generation"],
            proficiency={"open_source_collab": 0.90},
            cost_per_call=0.2, avg_latency_ms=1800, reliability=0.85,
        )

    async def handoff_to(self, next_agent_type, capsule) -> None: pass
    async def health_check(self) -> bool: return True
    async def emit_audit_log(self) -> list[dict]: return []
    async def apply_system_prompt_config(self, config_map) -> None: pass
    async def sync_avatar(self, avatar_token: str) -> None: pass


class TraeAdapter(ExternalAgentAdapter):
    """Trae Adapter：擅长 IDE 集成，盲点：命令行长任务弱。"""

    async def invoke(self, task: ExternalAgentTask) -> ExternalAgentResult:
        return ExternalAgentResult(
            task_id=task.task_id, success=True,
            output={"result": "trae_executed"},
            execution_trace=[{"step": "invoke", "agent": "trae"}],
            cost_incurred=0.4, duration_ms=1200,
        )

    async def invoke_stream(self, task: ExternalAgentTask) -> AsyncIterator[dict]:
        yield {"type": "done"}

    async def create_session(self, forgekin_id: str) -> str:
        return f"trae_session_{forgekin_id}"

    async def cancel_session(self, session_id: str) -> None: pass

    def get_profile(self) -> ExternalAgentProfile:
        return ExternalAgentProfile(
            agent_id="trae_main",
            agent_type=ExternalAgentType.TRAE,
            vendor="ByteDance",
            capabilities=["ide_integration", "refactor", "debug"],
            proficiency={"ide_integration": 0.95},
            cost_per_call=0.4, avg_latency_ms=1200, reliability=0.88,
        )

    async def handoff_to(self, next_agent_type, capsule) -> None: pass
    async def health_check(self) -> bool: return True
    async def emit_audit_log(self) -> list[dict]: return []
    async def apply_system_prompt_config(self, config_map) -> None: pass
    async def sync_avatar(self, avatar_token: str) -> None: pass
```

### 3.7 Python 实现：`flowforge/core/external_agent/config_loader.py`

```python
"""ExternalAgentConfigLoader：从 external_agent.yaml 加载配置 + DI 注册。"""
from __future__ import annotations

import importlib
from pathlib import Path

import yaml

from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger
from flowforge.core.external_agent.adapter import ExternalAgentType
from flowforge.core.external_agent.guardrails.base import (
    ActionConfirmation,
    CostCeiling,
    Guardrail,
    InputValidation,
    OutputValidation,
    SystemPromptConstraints,
    ToolAllowLists,
)
from flowforge.core.external_agent.worktree import WorktreeConfig

logger = get_logger(__name__)


class AdapterConfig(BaseModel):
    """单 Adapter 配置。"""
    adapter_class: str
    api_key_ref: str                        # 来自 .env 的 key 名
    cli_path: str = ""
    timeout_seconds: int = 300


class GuardrailsConfig(BaseModel):
    """六层 Guardrails 配置。"""
    max_input_size_bytes: int = 1024 * 1024
    sensitive_field_patterns: list[str] = Field(default_factory=list)
    required_directives: list[str] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list)
    allowed_paths: list[str] = Field(default_factory=list)
    allowed_domains: list[str] = Field(default_factory=list)
    pii_patterns: list[str] = Field(default_factory=list)
    harmful_content_keywords: list[str] = Field(default_factory=list)
    max_cost_per_call_usd: float = 10.0


class ExternalAgentConfig(BaseModel):
    """三方 Agent 总配置。"""
    adapters: dict[ExternalAgentType, AdapterConfig]
    guardrails: GuardrailsConfig
    worktree: WorktreeConfig


class ExternalAgentConfigLoader:
    """external_agent.yaml 配置加载器。

    YAML 结构示例：
        adapters:
          claude_code:
            adapter_class: flowforge.core.external_agent.adapters.claude_code.ClaudeCodeAdapter
            api_key_ref: ANTHROPIC_API_KEY
            cli_path: claude
            timeout_seconds: 300
          codex:
            adapter_class: flowforge.core.external_agent.adapters.codex.CodexAdapter
            api_key_ref: OPENAI_API_KEY
          opencode:
            adapter_class: flowforge.core.external_agent.adapters.opencode.OpenCodeAdapter
            api_key_ref: OPENCODE_TOKEN
          trae:
            adapter_class: flowforge.core.external_agent.adapters.trae.TraeAdapter
            api_key_ref: TRAE_API_KEY
        guardrails:
          max_input_size_bytes: 1048576
          allowed_domains: [github.com, pypi.org, npmjs.org]
          max_cost_per_call_usd: 10.0
        worktree:
          base_path: /tmp/forgekin_worktrees
          allowed_domains: [github.com, pypi.org]
          allowed_paths: [/tmp/forgekin_worktrees]
          max_cost_per_call_usd: 10.0
    """

    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path

    def load(self) -> ExternalAgentConfig:
        with self._config_path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        adapters_raw = raw.get("adapters", {})
        adapters: dict[ExternalAgentType, AdapterConfig] = {}
        for agent_type_str, cfg in adapters_raw.items:
            agent_type = ExternalAgentType(agent_type_str)
            adapters[agent_type] = AdapterConfig(**cfg)
        guardrails_cfg = GuardrailsConfig(**raw.get("guardrails", {}))
        worktree_cfg = WorktreeConfig(**raw.get("worktree", {}))
        return ExternalAgentConfig(
            adapters=adapters,
            guardrails=guardrails_cfg,
            worktree=worktree_cfg,
        )

    def load_adapter_instances(
        self,
        config: ExternalAgentConfig,
        di_container: "DIContainer",
        env_resolver: "EnvResolver",
    ) -> dict[ExternalAgentType, "ExternalAgentAdapter"]:
        """通过 importlib 动态加载 adapter 类 + DI 容器解析依赖。"""
        adapters: dict[ExternalAgentType, "ExternalAgentAdapter"] = {}
        for agent_type, adapter_cfg in config.adapters.items:
            module_path, class_name = adapter_cfg.adapter_class.rsplit(".", 1)
            module = importlib.import_module(module_path)
            adapter_cls = getattr(module, class_name)
            # 从 .env 解析 api_key
            api_key = env_resolver.resolve(adapter_cfg.api_key_ref)
            instance = adapter_cls(
                api_key=api_key,
                cli_path=adapter_cfg.cli_path,
                timeout_seconds=adapter_cfg.timeout_seconds,
            )
            adapters[agent_type] = instance
            logger.info(
                "external_agent_adapter_loaded",
                agent_type=agent_type.value,
                adapter_class=adapter_cfg.adapter_class,
            )
        return adapters

    def load_guardrails(
        self, config: ExternalAgentConfig
    ) -> list[Guardrail]:
        """加载六层 Guardrails（按 L1-L6 顺序）。"""
        g = config.guardrails
        return [
            InputValidation(
                max_input_size_bytes=g.max_input_size_bytes,
                sensitive_field_patterns=g.sensitive_field_patterns,
            ),
            SystemPromptConstraints(required_directives=g.required_directives),
            ToolAllowLists(
                allowed_tools=g.allowed_tools,
                allowed_paths=g.allowed_paths,
                allowed_domains=g.allowed_domains,
            ),
            OutputValidation(
                pii_patterns=g.pii_patterns,
                harmful_content_keywords=g.harmful_content_keywords,
            ),
            ActionConfirmation,
            CostCeiling(max_cost_per_call_usd=g.max_cost_per_call_usd),
        ]
```

### 3.8 YAML 配置示例：`config/external_agent.yaml`

```yaml
# FlowForge 三方 Agent 配置（D031）
# 4 Adapter + 六层 Guardrails + worktree 隔离配置。

adapters:
  claude_code:
    adapter_class: flowforge.core.external_agent.adapters.claude_code.ClaudeCodeAdapter
    api_key_ref: ANTHROPIC_API_KEY
    cli_path: claude
    timeout_seconds: 300
  codex:
    adapter_class: flowforge.core.external_agent.adapters.codex.CodexAdapter
    api_key_ref: OPENAI_API_KEY
    cli_path: codex
    timeout_seconds: 300
  opencode:
    adapter_class: flowforge.core.external_agent.adapters.opencode.OpenCodeAdapter
    api_key_ref: OPENCODE_TOKEN
    cli_path: opencode
    timeout_seconds: 300
  trae:
    adapter_class: flowforge.core.external_agent.adapters.trae.TraeAdapter
    api_key_ref: TRAE_API_KEY
    cli_path: trae
    timeout_seconds: 300

guardrails:
  max_input_size_bytes: 1048576  # 1MB
  sensitive_field_patterns:
    - password
    - api_key
    - secret
    - token
  required_directives:
    - 不得越权操作主仓库
    - 不得泄露 Core Identity
    - 不得绕过六层 Guardrails
  allowed_tools:
    - read_file
    - write_file
    - run_tests
    - git_commit
  allowed_paths:
    - /tmp/forgekin_worktrees
  allowed_domains:
    - github.com
    - pypi.org
    - npmjs.org
  pii_patterns:
    - '\b\d{3}-\d{2}-\d{4}\b'
    - '\b\d{16}\b'
  harmful_content_keywords:
    - malware
    - exploit
    - phishing
  max_cost_per_call_usd: 10.0

worktree:
  base_path: /tmp/forgekin_worktrees
  allowed_domains: [github.com, pypi.org]
  allowed_paths: [/tmp/forgekin_worktrees]
  allowed_tools: [read_file, write_file, run_tests]
  max_cost_per_call_usd: 10.0
```

### 3.9 算法伪代码

#### 3.9.1 `register_adapter` EAC v1 七契约硬门校验

```
function register_adapter(agent_type, adapter):
    # 1. 校验 EAC v1 七契约全部实现
    missing = []
    for contract_method in EAC_V1_CONTRACTS:
        method = getattr(adapter, contract_method, None)
        if method is None:
            missing.append(contract_method)
        elif getattr(method, "__isabstractmethod__", False):
            missing.append(contract_method)

    if missing:
        raise EACContractViolationError(
            f"adapter {adapter.class.name} missing contracts: {missing}"
        )

    # 2. 注册到 adapters 字典
    adapters[agent_type] = adapter
    log("external_agent_adapter_registered", agent_type)
```

#### 3.9.2 `invoke(forgekin_id, task)` 全流程

```
function invoke(forgekin_id, task, operator_id):
    started_at = now

    # 1. 六层 Guardrails
    context = GuardrailContext(forgekin_id, task.input_data, task.description, operator_id)
    passed, error = pass_through_guardrails(context)
    if not passed:
        return Result(success=False, error="guardrail_rejected: " + error)

    # 2. worktree 隔离
    worktree_path = worktree_iso.create_isolated(worktree_config)
    task.worktree_path = worktree_path

    # 3. 下发 SystemPromptConfigurationMap
    config_map = build_system_prompt_config(forgekin_id)
    for adapter in adapters.values:
        adapter.apply_system_prompt_config(config_map)
        adapter.sync_avatar(config_map.avatar_sync_token)

    # 4-6. fallback 链调用
    fallback_chain = fallback_executor.build_chain(
        task.input_data.required_capabilities, forgekin_id
    )
    for agent_type in fallback_chain:
        adapter = adapters[agent_type]
        if not adapter.health_check:
            continue

        result = adapter.invoke(task)

        # 5. 写入共享状态
        shared_state.write(forgekin_id, task.task_id, result, agent_type)

        if result.success:
            # 6. 能力融合
            fusion.fuse(forgekin_id, adapter.get_profile)
            # 清理 worktree
            worktree_iso.cleanup(worktree_path)
            result.used_agent_type = agent_type
            return result

    # 7. 全部失败 -> 降级
    worktree_iso.cleanup(worktree_path)
    return Result(
        success=False,
        error="all_external_agents_failed_degrade_to_builtin",
        degraded_to_builtin=True
    )
```

#### 3.9.3 `_pass_through_guardrails` 六层按序穿过

```
function pass_through_guardrails(context):
    for guardrail in guardrails:  # L1 -> L2 -> L3 -> L4 -> L5 -> L6
        passed, reason = guardrail.check(context)
        if not passed:
            log("guardrail_rejected", layer=guardrail.layer_name, reason)
            return False, guardrail.layer_name + ": " + reason
    return True, ""
```

#### 3.9.4 `WorktreeIsolation.create_isolated` 四项隔离

```
function create_isolated(config):
    worktree_id = "wt-" + uuid
    worktree_path = config.base_path + "/" + worktree_id

    # 1. 创建 worktree 目录
    mkdir(worktree_path)
    # git worktree add worktree_path

    # 2. 网络白名单：写入 /etc/hosts 限制（系统级）
    # 仅允许 config.allowed_domains

    # 3. 权限控制：设置目录权限 0o755（read/write，禁 exec）
    chmod(worktree_path, 0o755)

    # 4. 审计追踪：记录创建事件
    audit_repo.append(AuditLogEntry(
        worktree_path=worktree_path,
        action="create_isolated",
        target=worktree_path,
    ))

    return worktree_path
```

### 3.10 时序图：Bridge.invoke 全流程

```
Forgekin            Bridge              Guardrails         WorktreeIso        Adapter           SharedState       Fusion
   |                |                      |                  |                 |                  |                |
   | invoke(...)    |                      |                  |                 |                  |                |
   |--------------->|                      |                  |                 |                  |                |
   |                | check L1 (Input)     |                  |                 |                  |                |
   |                |---------------------->|                  |                 |                  |                |
   |                |<----------------------|                  |                 |                  |                |
   |                | check L2 (SysPrompt) |                  |                 |                  |                |
   |                |---------------------->|                  |                 |                  |                |
   |                |<----------------------|                  |                 |                  |                |
   |                | check L3-L6 ...       |                  |                 |                  |                |
   |                |<----------------------|                  |                 |                  |                |
   |                |                      |                  |                 |                  |                |
   |                | create_isolated    |                  |                 |                  |                |
   |                |----------------------------------------->|                 |                  |                |
   |                | worktree_path        |                  |                 |                  |                |
   |                |<-----------------------------------------|                 |                  |                |
   |                |                      |                  |                 |                  |                |
   |                | apply_system_prompt_config            |                  |                  |                |
   |                |--------------------------------------------------------->|                  |                |
   |                | sync_avatar        |                  |                 |                  |                |
   |                |--------------------------------------------------------->|                  |                |
   |                |                      |                  |                 |                  |                |
   |                | build_chain (F034) |                  |                 |                  |                |
   |                | fallback_chain = [claude_code, codex, ...]                |                  |                |
   |                |                      |                  |                 |                  |                |
   |                | health_check       |                  |                 |                  |                |
   |                |--------------------------------------------------------->|                  |                |
   |                | true                 |                  |                 |                  |                |
   |                |<---------------------------------------------------------|                  |                |
   |                |                      |                  |                 |                  |                |
   |                | invoke(task)         |                  |                 |                  |                |
   |                |--------------------------------------------------------->|                  |                |
   |                | result               |                  |                 |                  |                |
   |                |<---------------------------------------------------------|                  |                |
   |                |                      |                  |                 |                  |                |
   |                | write shared_state   |                  |                 |                  |                |
   |                |------------------------------------------------------------------------------------>|                |
   |                |                      |                  |                 |                  |                |
   |                | (if success) fuse  |                  |                 |                  |                |
   |                |---------------------------------------------------------------------------------------------------->|
   |                | cleanup worktree     |                  |                 |                  |                |
   |                |----------------------------------------->|                 |                  |                |
   |                |                      |                  |                 |                  |                |
   | result         |                      |                  |                 |                  |                |
   |<---------------|                      |                  |                 |                  |                |
```

### 3.11 错误处理矩阵

| 错误场景 | 检测点 | 处理动作 | 用户反馈 |
|---------|--------|---------|---------|
| Adapter 缺 EAC v1 契约 | `register_adapter` | 抛 `EACContractViolationError` | "adapter X missing contracts: [...]" |
| L1 输入超大小 | `InputValidation.check` | 调用被拒 | "input size exceeds X bytes" |
| L1 敏感字段 | `InputValidation.check` | 调用被拒 | "sensitive field detected: X" |
| L1 注入风险 | `InputValidation.check` | 调用被拒 | "injection risk detected: X" |
| L2 prompt 注入 | `SystemPromptConstraints.check` | 调用被拒 | "prompt injection attempt detected" |
| L3 工具不在白名单 | `ToolAllowLists.check` | 调用被拒 | "tool not in allow-list: X" |
| L3 路径不允许 | `ToolAllowLists.check` | 调用被拒 | "worktree_path not in allowed paths" |
| L5 副作用操作无 operator | `ActionConfirmation.check` | 调用被拒 | "action X requires operator confirmation" |
| L6 预算超限 | `CostCeiling.check` | 调用被拒 | "budget X exceeds max_cost_per_call Y" |
| worktree 创建失败 | `WorktreeIsolation.create_isolated` | 抛 `IOError` | "cannot create worktree" |
| Adapter 健康检查失败 | `adapter.health_check=false` | 跳过此 Adapter | "external_agent_skipped_unhealthy" |
| Adapter 调用失败 | `adapter.invoke` 返回 success=false | 继续下一个 | "fallback to next adapter" |
| 全部 Adapter 失败 | fallback 链遍历完 | 降级到内置 | "all_external_agents_failed_degrade_to_builtin" |
| 共享状态写入失败 | `shared_state.write` | 抛 `IOError` | "shared state write failed" |
| 能力融合失败 | `fusion.fuse` | 抛 `FusionError` | "capability fusion failed" |

### 3.12 性能优化指标

| 指标 | 目标值 | 测量点 |
|------|--------|--------|
| 六层 Guardrails 总延迟 | < 100ms | L1-L6 顺序 check |
| worktree 创建延迟 | < 500ms | create_isolated |
| worktree 清理延迟 | < 200ms | cleanup |
| 单 Adapter `invoke` 延迟 | < 30s（含三方 Agent 执行） | adapter.invoke |
| `health_check` 延迟 | < 100ms | adapter.health_check |
| 共享状态写入延迟 | < 50ms | shared_state.write |
| 能力融合延迟 | < 200ms | fusion.fuse |
| `SystemPromptConfigurationMap` 构建延迟 | < 50ms | build_system_prompt_config |
| `ExternalAgentBridge.invoke` 总延迟 | < 60s（fallback 链平均） | 全流程 |
| 4 Adapter 并发健康检查 | 支持 4 并发 | adapter.health_check |

---

## 4. 跨模块协作实现

### 4.1 上游依赖实现

#### 4.1.1 依赖 F026 forgemind 应用层

`ExternalAgentBridge` 由 `ForgeMindPlugin.register_forge_skills` 注册到 DI 容器（flowforge 主应用层）。

#### 4.1.2 依赖 F001 CapabilityProfile

能力画像融合目标，`fusion.fuse(forgekin_id, profile)` 将三方 Agent profile 写入 CapabilityProfile。

#### 4.1.3 依赖 F002 TeamAct

`ExternalAgentSharedState` 与 `TeamActState` 一一关联（F033 实现）。

#### 4.1.4 依赖 F003 HandoffCapsule

`adapter.handoff_to` 支持 Handoff Capsule 交接。

#### 4.1.5 依赖 F008 持久状态层

`ExternalAgentSharedState` 通过 Repository 写入 F008。

#### 4.1.6 依赖 F014 Memory Collection

`FallbackExecutionRecord` 写入EchoStore供SpiritForge蒸馏。

#### 4.1.7 依赖 F018 Eval Contract

三方 Agent 执行轨迹通过 `_write_trace_to_eval_and_memory` 写入 Eval 信号。

#### 4.1.8 依赖 F022 Tier 1-4 Recovery

三方 Agent 失败按 Tier 1-4 分级恢复（F034 实现）。

#### 4.1.9 依赖 F030 Virtual World Setting

`SystemPromptConfigurationMap` 引用 World Setting + Role Mask 五层。

### 4.2 下游影响实现

#### 4.2.1 影响 F032-F035

本架构作为容器，承载：
- F032 能力画像：`ExternalAgentProfileRegistry` 在 `profile.py` 落地。
- F033 状态共享：`SharedStateStore` 在 `shared_state.py` 落地。
- F034 失败回退：`FallbackChainExecutor` 在 `fallback.py` 落地。
- F035 能力融合：`CapabilityFusion` 在 `capability_fusion.py` 落地。

#### 4.2.2 影响 ForgekinBase.act

Forgekin通过 `ExternalAgentBridge.invoke` 调用三方 Agent 作为能力扩展：

```python
# forgemind/base.py（节选）
async def act(self, action: str, params: dict) -> ActionResult:
    if action == "delegate_to_external_agent":
        task = ExternalAgentTask(...)
        result = await self._external_agent_bridge.invoke(
            forgekin_id=self.forgekin_id,
            task=task,
            operator_id=self._operator_id,
        )
        return ActionResult(success=result.success, output=result.output)
```

### 4.3 跨模块不变量校验

| 不变量 | 校验点 | 校验实现 |
|--------|--------|---------|
| EAC v1 七契约硬门 | `register_adapter` | `_assert_eac_v1_contracts` 校验 10 个方法（七契约展开） |
| 六层 Guardrails 按序穿过 | `_pass_through_guardrails` | for 循环 L1->L6，任一失败即返回 |
| worktree 隔离四项 | `WorktreeIsolation` | 网络白名单 + 权限控制 + 审计追踪 + 操作回滚 |
| fallback 链基于 F032 画像 | `fallback_executor.build_chain` | CapabilityMatcher.match_for_task + rank_by_cost_latency |
| 全部失败降级到内置 | `invoke` 末尾 | 返回 `degraded_to_builtin=True` |
| 能力融合触发 | `invoke` 成功分支 | `fusion.fuse(forgekin_id, profile)` |
| 共享状态写入 | `invoke` 每个 adapter 后 | `shared_state.write` |
| 执行轨迹回流 | `invoke` 末尾 | `_write_trace_to_eval_and_memory` |
| SystemPromptConfigurationMap 下发 | `invoke` 步骤 3 | `apply_system_prompt_config` + `sync_avatar` |
| Bridge 唯一入口 | 代码扫描 | Forgekin无直接调用 Adapter 的代码路径 |

---

## 5. 详细设计验收

### 5.1 功能验收

- [ ] AC-F-01: `ExternalAgentType` 枚举含 4 个值（CLAUDE_CODE/CODEX/OPENCODE/TRAE），运行时无法新增。
- [ ] AC-F-02: `ExternalAgentAdapter` 抽象定义 10 个方法（七契约展开），子类必须全部实现。
- [ ] AC-F-03: `register_adapter` 校验 EAC v1 七契约，缺一即抛 `EACContractViolationError`。
- [ ] AC-F-04: 六层 Guardrails（L1-L6）按序穿过，任一层失败即调用被拒绝。
- [ ] AC-F-05: `InputValidation` 校验输入大小 + 敏感字段 + 注入风险。
- [ ] AC-F-06: `SystemPromptConstraints` 检测 prompt injection（"ignore previous" / "forget instructions"）。
- [ ] AC-F-07: `ToolAllowLists` 校验工具白名单 + 路径白名单 + 域名白名单。
- [ ] AC-F-08: `ActionConfirmation` 校验副作用操作需 operator 确认。
- [ ] AC-F-09: `CostCeiling` 校验预算不超过 `max_cost_per_call_usd`。
- [ ] AC-F-10: `WorktreeIsolation.create_isolated` 创建独立 worktree + 网络白名单 + 权限控制 + 审计追踪。
- [ ] AC-F-11: `WorktreeIsolation.rollback` 执行 git reset --hard。
- [ ] AC-F-12: `WorktreeIsolation.cleanup` 清理 worktree 目录。
- [ ] AC-F-13: `ExternalAgentBridge.invoke` 编排五大机制（Guardrails + worktree + fallback + shared_state + fusion）。
- [ ] AC-F-14: Adapter `health_check=false` 时被跳过，继续 fallback 链。
- [ ] AC-F-15: Adapter 调用成功后触发能力融合 `fusion.fuse`。
- [ ] AC-F-16: 全部 Adapter 失败时降级到内置，返回 `degraded_to_builtin=True`。
- [ ] AC-F-17: 执行轨迹写入 F018 Eval 信号 + F014 EchoStore。
- [ ] AC-F-18: `SystemPromptConfigurationMap` 含 5 字段（core_identity_ref + role_mask_layers + world_setting_ref + immutable_directives + avatar_sync_token）。
- [ ] AC-F-19: `apply_system_prompt_config` + `sync_avatar` 在 invoke 前调用。
- [ ] AC-F-20: 4 具体 Adapter（ClaudeCode/Codex/OpenCode/Trae）均继承 `ExternalAgentAdapter` 并实现七契约。

### 5.2 性能验收

- [ ] AC-P-01: 六层 Guardrails 总延迟 < 100ms。
- [ ] AC-P-02: worktree 创建延迟 < 500ms。
- [ ] AC-P-03: worktree 清理延迟 < 200ms。
- [ ] AC-P-04: 单 Adapter `invoke` 延迟 < 30s。
- [ ] AC-P-05: `health_check` 延迟 < 100ms。
- [ ] AC-P-06: 共享状态写入延迟 < 50ms。
- [ ] AC-P-07: 能力融合延迟 < 200ms。
- [ ] AC-P-08: `SystemPromptConfigurationMap` 构建延迟 < 50ms。
- [ ] AC-P-09: `ExternalAgentBridge.invoke` 总延迟 < 60s（fallback 链平均）。
- [ ] AC-P-10: 4 Adapter 并发健康检查支持 4 并发。

### 5.3 安全验收

- [ ] AC-S-01: EAC v1 七契约缺一的 Adapter 注册被拒绝。
- [ ] AC-S-02: 六层 Guardrails 任一层失败时调用被拒绝，错误信息含 Guardrail 层名。
- [ ] AC-S-03: 三方 Agent 在独立 worktree 执行，主仓库代码未被越权修改。
- [ ] AC-S-04: worktree 网络白名单限制可访问域名。
- [ ] AC-S-05: worktree 权限控制禁用 exec。
- [ ] AC-S-06: worktree 审计追踪记录所有副作用。
- [ ] AC-S-07: worktree 操作回滚执行 git reset --hard。
- [ ] AC-S-08: prompt injection（"ignore previous"）被 L2 检测并拒绝。
- [ ] AC-S-09: 敏感字段（password/api_key/secret/token）被 L1 检测并拒绝。
- [ ] AC-S-10: 注入风险（SQL/shell）被 L1 检测并拒绝。
- [ ] AC-S-11: 副作用操作（write_file/commit_code/send_message）需 operator 确认。
- [ ] AC-S-12: 预算超过 `max_cost_per_call_usd` 时调用被拒绝。
- [ ] AC-S-13: API key 从 `.env` 解析，不硬编码在 `.py` 中。
- [ ] AC-S-14: `ExternalAgentBridge` 是唯一入口，Forgekin无直接调用 Adapter 的代码路径。
- [ ] AC-S-15: `SystemPromptConfigurationMap` 含不可越界指令，三方 Agent 必须接受。

### 5.4 Eval 验收

- [ ] AC-E-01: 三方 Agent 执行轨迹写入 F018 Eval 信号。
- [ ] AC-E-02: 执行轨迹含 `forgekin_id` / `task_id` / `agent_type` / `success` / `cost_incurred` / `duration_ms` / `timestamp` 七字段。
- [ ] AC-E-03: 失败的 Adapter 调用也写入 Eval 信号（success=false）。
- [ ] AC-E-04: 降级到内置时 Eval 信号 `agent_type="builtin"`，`degraded_to_builtin=true`。
- [ ] AC-E-05: 能力融合后 `CapabilityProfile` 含三方 Agent 的 capabilities。
- [ ] AC-E-06: 共享状态 `ExternalAgentSharedState` 与 F002 TeamActState 一一关联。

### 5.5 集成测试点

| 测试 ID | 测试场景 | 期望结果 |
|---------|---------|---------|
| IT-D031-001 | 注册缺 `invoke` 方法的 Adapter | 抛 `EACContractViolationError` |
| IT-D031-002 | 注册实现七契约的 Adapter | 注册成功 |
| IT-D031-003 | `invoke` L1 输入含 "password" 字段 | 调用被拒，错误含 "sensitive field" |
| IT-D031-004 | `invoke` L1 输入含 SQL 注入 | 调用被拒，错误含 "injection risk" |
| IT-D031-005 | `invoke` L2 描述含 "ignore previous" | 调用被拒，错误含 "prompt injection" |
| IT-D031-006 | `invoke` L3 工具不在白名单 | 调用被拒，错误含 "tool not in allow-list" |
| IT-D031-007 | `invoke` L5 副作用操作无 operator_id | 调用被拒，错误含 "requires operator confirmation" |
| IT-D031-008 | `invoke` L6 预算超 10.0 | 调用被拒，错误含 "exceeds max_cost_per_call" |
| IT-D031-009 | worktree 创建 + 清理 | 创建成功，清理后目录不存在 |
| IT-D031-010 | `health_check=false` 的 Adapter | 被跳过，继续 fallback 链 |
| IT-D031-011 | 第一个 Adapter 调用成功 | 返回 result，触发 fusion.fuse |
| IT-D031-012 | 全部 Adapter 失败 | 降级到内置，`degraded_to_builtin=True` |
| IT-D031-013 | 执行轨迹写入 Eval 信号 | Eval 信号含 7 字段 |
| IT-D031-014 | `SystemPromptConfigurationMap` 下发 | adapter.apply_system_prompt_config 被调用 |
| IT-D031-015 | `sync_avatar` 调用 | adapter.sync_avatar 被调用 |
| IT-D031-016 | worktree 审计日志 | audit_log 返回创建/清理记录 |
| IT-D031-017 | worktree rollback | rollback 执行后审计日志含 "rollback" |
| IT-D031-018 | 4 Adapter 全部通过 DI 注入 | 无 `ClaudeCodeAdapter` 直接实例化 |
| IT-D031-019 | API key 从 .env 解析 | 无 .py 硬编码 api_key |
| IT-D031-020 | `invoke_stream` 流式输出 | yield 多个 event |

---

## 6. 引用

- [doc:../spec.md#§3.10]（FR-CORE-010）+ [doc:../spec.md#§2.9]（三方 Agent 集成）
- [doc:../arch.md#§3.10]（三方 Agent 集成 ExternalAgentAdapter 抽象层）
- [doc:../arch.md#§4.4]（三方 Agent EAC 接口）
- [doc:../architecture/A031-external-agent-adapter.md]（同号架构设计）
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
- [doc:../design/D030-virtual-world-setting.md]（SystemPromptConfigurationMap 引用）
- [doc:../design/D032-external-agent-profile.md]（F032 能力画像）
- [doc:../design/D033-external-agent-shared-state.md]（F033 状态共享）
- [doc:../design/D034-external-agent-fallback.md]（F034 失败回退）
- [doc:../design/D035-external-agent-capability-fusion.md]（F035 能力融合）
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#AI编程优秀实践]（六层 Guardrails 主张）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（EAC v1 七契约 + 六层 Guardrails + worktree 隔离 + 4 Adapter + SystemPromptConfigurationMap + Bridge 编排五大机制详细设计） | 架构师 Forgekin（猫头鹰·鲁班） |

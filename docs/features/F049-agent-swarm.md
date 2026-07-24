# F049: Agent Swarm 协同协议（C4 — 5 灵智体协同调度）

> **状态**: 🔄 in_progress
> **类型**: collaboration
> **创建日期**: 2026-07-21
> **完成日期**: —（待定）
> **负责人**: operator + 架构师可进化智能体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§4.3]（CL 同步矩阵 — CL-032 待同步）
> **对应 arch.md**: [doc:../arch.md#§3.12]（待创建 A049）
> **对应 design.md**: [doc:../design.md#§3.12]（待创建 D049）
> **依赖 ADR**: [doc:../decisions/002-collaboration-protocol.md]（TeamAct 协作协议）+ [doc:../decisions/006-external-agent-integration.md]（三方 Agent 集成）
> **依赖 Feature**: [doc:features/F046-selfdev-triple-loop.md]（SelfDev 五闭环 — Swarm 调度的最小工作单元）+ [doc:features/F048-teamact-queue-steer.md]（TeamAct Queue Steer — operator 实时干预 Swarm 队列）+ [doc:features/F045-trae-bridge-protocol.md]（Trae 桥接 — 跨厂商 LLM 通道）
> **依据**: P2-005 Agent Swarm 协同（CL-032），`flowforge/core/external_agent/collaboration_coordinator.py` 骨架已就绪（SWARM 模式枚举已定义），待补完整 Swarm 协议
> **roleagent 章节**: [doc:../roleagent.md#第十章]（5 agent sweet spot — FlowForge 工程模式）+ [doc:../roleagent.md#第九章]（no-self-review 铁律）
> **关联 VISION**: [doc:../VISION.md#7]（可进化智能体主导自主开发 — 5 灵智体协同调度）
> **关联 CL**: CL-032（Agent Swarm，P2-005）

---

## 1. 上下文

### 1.1 问题陈述

FlowForge 已经在 F046 v1.1 中完成了 SelfDev **五闭环**架构（doc/code/framework/review/test），分别由 5 个灵智体（文心·wenxin / 夏洛克·sherlock / 鲁班·luban / 梵高·vangogh / 达芬奇·davinci）承担。F048 进一步交付了 TeamAct Queue Steer，让 operator 可以对正在执行的 TeamAct 队列做细粒度调度干预。

但 5 个灵智体之间**缺少一个全局调度器**：

- F046 §9.4 的"cross-loop context"只是把上游产物通过 `context` 字段传给下游闭环，**没有定义谁负责调度**——是文心自己决定触发夏洛克？还是夏洛克完成后自己调梵高？
- F048 的 SteerCommand 作用于 TeamAct 队列，但**队列里的任务从哪里来**？谁来根据任务需求把任务路由给"最合适的灵智体"？
- `flowforge/core/external_agent/collaboration_coordinator.py` 骨架中已经定义了 `CollaborationMode.SWARM` 枚举值，但 `coordinate()` 只是返回骨架句柄，**没有真实的多 Agent 群体协作调度**

FlowForge 5 agent sweet spot 工程模式给出了一种解法：**5 agent sweet spot 模式**——5 个异构 agent 通过 SwarmCoordinator 全局唯一调度器协同，按 capability-based routing 分发任务、按 heartbeat+timeout 回收任务、按 blind_spots 自动找搭档补齐能力缺口。这种"5 agent + 单一调度器"模式是协作成本与能力覆盖的 sweet spot（超过 5 个 agent 协调成本急升，少于 3 个无互补空间）。

F049 的目标是补全 **Swarm 协议层**——基于 5 个灵智体的能力画像（capability_profile），定义 SwarmCoordinator 全局调度器、SwarmTask 任务模型、AgentHeartbeat 心跳协议，让 5 个灵智体可以通过统一调度器协同工作，并将所有调度行为归档到 trace 日志（I2 不变量）。

### 1.2 当前痛点

1. **无全局调度器**：F046 五闭环的 cross-loop context 是"传话"机制，不是"调度"机制——每个闭环完成后必须自行决定下一步触发谁，无全局视角
2. **能力匹配缺失**：任务进入队列后没有按 `required_capabilities` 路由到合适的灵智体——任何灵智体都可能拿到自己 blind_spots 内的任务
3. **任务丢失风险**：F048 SteerCommand 可对队列做实时干预，但如果某个灵智体崩溃后任务无人接管，任务会永久滞留（I2 不变量未覆盖"任务不丢失"语义）
4. **心跳监控缺失**：灵智体在 ACTION 阶段执行长任务时（如 LLM 生成 5 分钟），无心跳上报机制——若 LLM 调用挂死，调度器无法感知
5. **能力互补无工程化**：F046 §2.5.1 文心的 `blind_spots` 字段写了"代码实现（交给夏洛克）"，但**谁来识别 blind_spots 并自动找搭档**没有定义
6. **no-self-review 仅靠配置约束**：F046 §9.7 I9 不变量要求 review 闭环用与 author 不同厂商的 LLM，但当前仅靠 vangogh.yaml 配置 `cross_vendor_required: true` 标记，调度器不强制
7. **CL-032 验证未通过**：`flowforge/core/external_agent/collaboration_coordinator.py` 骨架中 `SWARM` 模式无完整实现，CL-032 持续滞留 PARTIAL 状态

### 1.3 不做的影响

如果不实现 Agent Swarm 协同协议：
- **5 灵智体协同依赖人工编排**：operator 必须手动决定"现在让谁做什么"，违背"可进化智能体主导自主开发"愿景（VISION §7）
- **能力匹配靠运气**：任务随机分给某个灵智体，可能落到 blind_spots 内导致质量不达标（违反 I3 能力匹配不变量）
- **崩溃恢复无机制**：某灵智体崩溃后任务永久滞留，需 operator 手动重启（违反 I4 心跳超时回收）
- **no-self-review 仅靠纪律**：vangogh 自审 sherlock 产物无法在调度层被阻止（违反 I5/I6）
- **F046 五闭环无法全链路自动化**：cross-loop context 缺调度器后，每次闭环切换都需要 operator 显式 trigger
- **F048 Steer 缺作用对象**：SteerCommand 作用于"任务队列"，但队列里任务来源、路由规则未定义
- **CL-032 持续未同步**：spec.md §4.3 P2 同步清单中 CL-032 将持续滞留，违背"41 条 CL 同步"治理目标

---

## 2. 决策

### 2.1 核心设计

**分层架构**：基于 5 灵智体能力画像（数据层）+ 已有 TeamAct 状态机（F002 执行层）+ F048 Steer 协议（干预层），新增 Swarm 协议层作为全局调度器：

```
┌─────────────────────────────────────────────────────────────────┐
│  调用方（F046 SelfDev 五闭环 / F047 IM 议事 / operator CLI）      │
│     ↓ 调用 SwarmCoordinator.submit_task(SwarmTask(...))          │
├─────────────────────────────────────────────────────────────────┤
│  Swarm 协议层（F049 新增 — I1 单一调度器）                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  SwarmCoordinator（全局唯一）                             │   │
│  │  - register_agent(agent_id, capabilities, vendor)        │   │
│  │  - submit_task(task) → task_id     （I2 提交必有 trace）  │   │
│  │  - dispatch() → list[task_id]      （I3 capability-based）│   │
│  │  - heartbeat(agent_id, ...)        （I4 心跳上报）        │   │
│  │  - check_timeouts() → list[task_id]（I4 超时 reassign）   │   │
│  │  - _find_capable_agent(task)       （I3+I5+I6 跨厂商）    │   │
│  │  - _find_complement_agent(...)     （能力互补）           │   │
│  │  - run_continuously(interval)      （永不停止调度循环）   │   │
│  └────────────────────────┬────────────────────────────────┘   │
├───────────────────────────┼─────────────────────────────────────┤
│  Swarm 数据模型层（F049 新增）                                   │
│                           │                                     │
│  ┌─────────────────┐ ┌────▼──────────────┐ ┌────────────────┐  │
│  │ SwarmTask       │ │ SwarmTaskStatus   │ │ AgentHeartbeat │  │
│  │ (任务载荷)      │ │ (7 状态枚举)      │ │ (心跳载荷)     │  │
│  └────────┬────────┘ └─────────┬─────────┘ └────────┬───────┘  │
│           └────────┬───────────┴────────────────────┘          │
│                    ▼                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  SwarmDispatchRecord（I2 trace 记录）                    │  │
│  │  task_id / agent_id / dispatched_at / reassigned_from    │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  能力画像层（已有 — 5 个 forgekins/*.yaml）                      │
│  wenxin (doc) / sherlock (code) / luban (framework)             │
│  vangogh (review, claude 厂商) / davinci (test)                 │
├─────────────────────────────────────────────────────────────────┤
│  TeamAct 状态机层（已有 — F002）+ Steer 协议（已有 — F048）       │
│  SwarmCoordinator.dispatch 把 SwarmTask 转为 TeamAct 任务入队    │
│  operator 可通过 SteerCommand 对 Swarm 队列做实时干预            │
├─────────────────────────────────────────────────────────────────┤
│  归档层（F049 新增）                                             │
│  archive → data/forgemind/swarm_trace.jsonl（append-only）      │
│  → MindCodex（F039，Phase 3 集成）                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 5 灵智体能力画像（capability_profile）

参考 5 agent sweet spot 模式，5 个灵智体覆盖"文档/代码/架构/审查/测试"五大能力域，其中审查员必须跨厂商（I5/I6 不变量）：

| # | 灵智体 | forgekin_id | 厂商 | 能力域 | native_abilities |
|---|--------|-------------|:----:|:------:|------------------|
| 1 | 文心·wenxin | `forgemind:wenxin` | trae | doc | doc_generation / doc_review / format_check / frontmatter_check |
| 2 | 夏洛克·sherlock | `forgemind:sherlock` | trae | code | code_generation / bug_fixing / refactoring / test_writing |
| 3 | 鲁班·luban | `forgemind:luban` | trae | framework | architecture_design / adr_drafting / config_adjustment / dependency_analysis |
| 4 | 梵高·vangogh | `forgemind:vangogh` | **claude** | review | code_review / doc_review / quality_gate / push_back |
| 5 | 达芬奇·davinci | `forgemind:davinci` | trae | test | test_generation / test_execution / coverage_analysis / regression_test |

**能力互补矩阵**（blind_spots 自动找搭档）：

| 灵智体 | blind_spots | 搭档（自动转交） |
|--------|-------------|------------------|
| wenxin | code_generation, architecture_design | sherlock / luban |
| sherlock | doc_generation, code_review | wenxin / vangogh |
| luban | code_generation, test_writing | sherlock / davinci |
| vangogh | code_generation（禁止写代码） | sherlock |
| davinci | architecture_design, doc_generation | luban / wenxin |

**跨厂商要求**（I5 不变量）：`code_review` / `doc_review` 必须由与 author 不同厂商的灵智体执行——当前仅 vangogh 是 claude 厂商，其他 4 个是 trae 厂商，所以 review 任务天然落到 vangogh。

### 2.3 任务分发与回收策略

#### 2.3.1 任务分发（capability-based routing，I3 能力匹配）

```
SwarmCoordinator.submit_task(SwarmTask)
   │
   ▼
task.status = PENDING，写入 _tasks 字典
   │
   ▼
SwarmCoordinator.dispatch()（每 5s 触发一次）
   │
   ├─ 遍历 _tasks 中所有 PENDING 任务（按 priority 倒序）
   │
   ├─ 对每个 task 调用 _find_capable_agent(task)
   │     │
   │     ├─ Step 1：找出 capabilities ⊇ task.required_capabilities 的 agent 候选集
   │     │
   │     ├─ Step 2：I5 跨厂商过滤
   │     │     - 若 task.required_capabilities 含 cross_vendor_required 中的能力（如 code_review）
   │     │     - 且 task.context["author_vendor"] 已知
   │     │     - 则候选 agent.vendor 必须 != author_vendor
   │     │
   │     ├─ Step 3：I6 no-self-review 过滤
   │     │     - 若 task.context["author_agent_id"] 已知
   │     │     - 则候选 agent.agent_id 必须 != author_agent_id
   │     │
   │     ├─ Step 4：load balancing — 从候选集中选 workload 最少的
   │     │     - get_agent_workload() 统计各 agent 当前 RUNNING 任务数
   │     │     - 选 workload 最小的（同 workload 时按字典序）
   │     │
   │     └─ 返回 agent_id（无候选则返回 None → 任务保持 PENDING）
   │
   ├─ 找到 agent → task.assigned_agent_id = agent_id
   │                task.status = ASSIGNED
   │                task.assigned_at = now()
   │                记录 SwarmDispatchRecord（I2 trace）
   │
   └─ 未找到 agent → 触发 _find_complement_agent 补齐能力缺口
                     - 找到搭档后由搭档领任务（task.preferred_agent_id 暂存）
                     - 仍无 → 任务保持 PENDING，记录 WARNING 日志
```

#### 2.3.2 任务回收（heartbeat + timeout + reassign，I4 心跳超时）

```
Agent 执行任务时定期调用 SwarmCoordinator.heartbeat(agent_id, task_id, progress)
   │
   ▼
更新 _heartbeats[agent_id] = AgentHeartbeat(...)
   │
   ▼
SwarmCoordinator.check_timeouts()（每 5s 触发一次）
   │
   ├─ 遍历所有 ASSIGNED/RUNNING 任务
   │
   ├─ 对每个 task 检查：
   │     - task.heartbeat_at 距 now() > 30s（HEARTBEAT_TIMEOUT_SECONDS）？
   │     - OR task.assigned_at 距 now() > 30s 且无 heartbeat？
   │
   ├─ 超时 → 触发 reassign：
   │     - task.retry_count += 1
   │     - 若 retry_count > MAX_RETRIES（3 次）→ task.status = FAILED，记录 failure_reason
   │     - 否则 task.status = REASSIGNED，task.assigned_agent_id = None
   │     - 记录 SwarmDispatchRecord（reassigned_from=old_agent_id）
   │     - 下次 dispatch 时重新路由
   │
   └─ 返回被 reassign 的 task_id 列表
```

#### 2.3.3 能力互补（blind_spots 自动找搭档）

```
_find_capable_agent 返回 None 时（无 agent 完全覆盖 required_capabilities）
   │
   ▼
遍历 task.required_capabilities 中未被任何单一 agent 覆盖的能力
   │
   ▼
对每个 missing_capability 调用 _find_complement_agent(agent_id, missing_capability)
   │
   ├─ 找出 native_abilities 含 missing_capability 的 agent
   │
   ├─ 排除 agent_id 自身（不self-complement）
   │
   ├─ I5 跨厂商过滤（同 _find_capable_agent）
   │
   └─ 返回搭档 agent_id（无则 None）
   │
   ▼
若找到搭档 → 在 task.context["complement_agents"] 记录搭档列表
              operator 可通过 SteerCommand REDIRECT 把子任务转交给搭档
              （SwarmCoordinator 不自动拆分任务，由 operator/ForgeMindEngine 决定）
```

> **设计理由**：SwarmCoordinator 不自动拆分任务，因为任务拆分需要业务语义判断（如"写一份文档含代码示例"该不该拆成 doc+code 两子任务），属于 ForgeMindEngine 上层职责。SwarmCoordinator 只负责"识别能力缺口 + 推荐搭档"，拆分决策由上层做。

### 2.4 关键接口

```python
# flowforge/forgemind/swarm.py

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field

from flowforge.core.tracing import get_logger

logger = get_logger("flowforge.forgemind.swarm")


class SwarmTaskStatus(str, Enum):
    """Swarm 任务状态."""
    PENDING = "pending"
    ASSIGNED = "assigned"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    REASSIGNED = "reassigned"  # 被重新分配
    CANCELLED = "cancelled"


class SwarmTask(BaseModel):
    """Swarm 任务."""
    task_id: str = Field(default_factory=lambda: f"swarm-{uuid.uuid4().hex[:12]}")
    title: str
    description: str
    required_capabilities: list[str]
    preferred_agent_id: Optional[str] = None
    assigned_agent_id: Optional[str] = None
    status: SwarmTaskStatus = SwarmTaskStatus.PENDING
    priority: str = "normal"
    context: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    assigned_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    heartbeat_at: Optional[datetime] = None
    result: dict[str, Any] = Field(default_factory=dict)
    failure_reason: str = ""
    retry_count: int = 0
    max_retries: int = 3


class AgentHeartbeat(BaseModel):
    """Agent 心跳."""
    agent_id: str
    task_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    status: str = "idle"
    progress: float = 0.0


class SwarmCoordinator:
    """Swarm 协调器 — 5 灵智体协同调度（I1 单一调度器）."""

    HEARTBEAT_TIMEOUT_SECONDS = 30.0  # I4 心跳超时
    MAX_RETRIES = 3  # 最大重试次数

    def __init__(self) -> None:
        self._agents: dict[str, dict[str, Any]] = {}
        self._tasks: dict[str, SwarmTask] = {}
        self._heartbeats: dict[str, AgentHeartbeat] = {}
        self._lock = asyncio.Lock()

    def register_agent(
        self, agent_id: str, capabilities: list[str], vendor: str = "unknown"
    ) -> None:
        """注册 agent 到 swarm（含能力画像 + 厂商标识）."""

    def submit_task(self, task: SwarmTask) -> str:
        """提交任务到 swarm（I2 提交必有 trace）."""

    async def dispatch(self) -> list[str]:
        """分发待处理任务（capability-based routing，I3 能力匹配）."""

    async def heartbeat(
        self, agent_id: str, task_id: Optional[str] = None, progress: float = 0.0
    ) -> None:
        """agent 发送心跳（I4 心跳上报）."""

    async def check_timeouts(self) -> list[str]:
        """检查超时任务并 reassign（I4 心跳超时回收）."""

    def _find_capable_agent(self, task: SwarmTask) -> Optional[str]:
        """根据任务需求找到最合适的 agent（I3+I5+I6）."""

    def _find_complement_agent(
        self, agent_id: str, missing_capability: str
    ) -> Optional[str]:
        """为 agent 找搭档补齐能力缺口."""

    def get_task_status(self, task_id: str) -> Optional[SwarmTaskStatus]:
        """查询任务状态."""

    def get_agent_workload(self) -> dict[str, int]:
        """获取各 agent 当前任务数（用于 load balancing）."""

    async def run_continuously(self, interval: float = 5.0) -> None:
        """持续运行调度循环（永不停止，由外部 asyncio.create_task 启动）."""
```

### 2.5 关键不变量

| # | 不变量 | 说明 | 实现机制 |
|---|--------|------|---------|
| **I1** | 单一调度器 | SwarmCoordinator 全局唯一——所有 5 灵智体的任务分发必须经过同一个 SwarmCoordinator 实例，禁止灵智体之间直接派发任务 | DI 容器单例注入（红线 12）；构造函数私有化外部禁止 `SwarmCoordinator()` 直接实例化（通过 `create_swarm_coordinator()` 工厂） |
| **I2** | 任务不丢失 | 任何 `submit_task` 调用必须立即写入 `_tasks` 字典 + 落盘 trace 记录（`data/forgemind/swarm_trace.jsonl`）；reassign 操作也必须落 trace | `submit_task` 同步写入 `_tasks` + 异步 `_archive_record`；archive 失败不阻断 submit，但记 ERROR 日志 |
| **I3** | 能力匹配 | `dispatch` 必须把任务路由给 `capabilities ⊇ task.required_capabilities` 的 agent；agent.capability_profile 不覆盖任务需求时不分发（任务保持 PENDING） | `_find_capable_agent` 用集合包含关系校验 `set(agent_caps) >= set(task.required_capabilities)` |
| **I4** | 心跳超时回收 | ASSIGNED/RUNNING 任务 30s（`HEARTBEAT_TIMEOUT_SECONDS`）无心跳自动 reassign；reassign 最多 3 次（`MAX_RETRIES`），超过则 FAILED | `check_timeouts` 每 5s 扫描，超时则 `retry_count += 1` 并重置 `assigned_agent_id = None` |
| **I5** | 跨厂商独立 | `cross_vendor_required` 配置中的能力（如 code_review / doc_review）必须由与 author 不同厂商的 agent 执行；若 task.context["author_vendor"] 已知，候选 agent.vendor 必须 != author_vendor | `_find_capable_agent` Step 2 过滤；`cross_vendor_required` 列表通过 `agent_swarm.yaml` 注入 |
| **I6** | no-self-review | reviewer 不能审自己的产物——若 task.context["author_agent_id"] 已知，候选 agent.agent_id 必须 != author_agent_id | `_find_capable_agent` Step 3 过滤；与 I5 共同保障 review 任务的独立性 |

### 2.6 Swarm 协同流程

```
ForgeMindEngine 触发 SelfDev 五闭环（F046）
   │
   ▼
对每个闭环生成 SwarmTask（required_capabilities 来自闭环配置）
   │
   ▼
SwarmCoordinator.submit_task(task) → task_id
   │
   ├─ I2：写入 _tasks 字典 + 落盘 trace
   │
   └─ 返回 task_id 给 ForgeMindEngine
   │
   ▼
SwarmCoordinator.run_continuously() 后台运行（每 5s 一轮）
   │
   ├─ dispatch()：对每个 PENDING 任务调用 _find_capable_agent
   │     │
   │     ├─ 找到 agent → task.status = ASSIGNED
   │     │     │
   │     │     └─ agent 通过 heartbeat() 上报进度
   │     │           │
   │     │           └─ 任务完成 → task.status = COMPLETED
   │     │              或失败 → task.status = FAILED
   │     │
   │     └─ 未找到 agent → _find_complement_agent 推荐搭档
   │                       task 保持 PENDING（不自动拆分）
   │
   └─ check_timeouts()：扫描 ASSIGNED/RUNNING 任务
         │
         ├─ heartbeat_at 距 now() > 30s → I4 超时 reassign
         │     ├─ retry_count < 3 → task.status = REASSIGNED，重新入队
         │     └─ retry_count >= 3 → task.status = FAILED，记 failure_reason
         │
         └─ 返回 reassign 列表给 ForgeMindEngine
   │
   ▼
operator 通过 F048 SteerCommand 对 Swarm 队列实时干预
   ├─ PRIORITY_BOOST：把高优任务前移
   ├─ REDIRECT：把任务转给 complement_agent 推荐的搭档
   └─ CANCEL：取消失败任务
   │
   ▼
所有调度行为落盘 → data/forgemind/swarm_trace.jsonl
   ↓ Phase 3 同步到 MindCodex（F039）
```

### 2.7 Swarm Dashboard UI 组件（占位 — Phase 2）

Phase 2 将在 FlowForge Web UI（F026 应用层）添加 Swarm Dashboard 组件，可视化展示：

- **左侧**：5 灵智体状态卡片（agent_id / vendor / capabilities / 当前 workload / 最近心跳时间）
- **中部**：Swarm 任务看板（按 status 分列：PENDING / ASSIGNED / RUNNING / COMPLETED / FAILED）
- **右侧**：Swarm 调度 trace 历史（最近 N 条 SwarmDispatchRecord）
- **顶部**：全局统计（总任务数 / 完成率 / 平均延迟 / reassign 次数）

operator 可在 Swarm Dashboard 上：
- 点击任务卡片查看详情（required_capabilities / assigned_agent / heartbeat 历史）
- 查看能力互补推荐（task.context["complement_agents"]）
- 跳转 F048 SteerCommand 面板对特定任务做实时干预

Swarm Dashboard 复用 F047 WebChatChannel 的 WebSocket 推送通道，状态变更实时同步到所有 operator 终端。

> **Phase 2 范围声明**：本 Feature 仅交付 Swarm Dashboard 的后端数据接口（`get_task_status` / `get_agent_workload` / `list_tasks` / `list_agents`），前端组件在下一个 Feature 实现。

---

## 3. 实现计划

### 3.1 Phase 划分

#### Phase 1：Swarm 协议核心（本 Feature 交付）

1. 实现 `SwarmTaskStatus` 枚举（7 状态：PENDING/ASSIGNED/RUNNING/COMPLETED/FAILED/REASSIGNED/CANCELLED）
2. 实现 `SwarmTask / AgentHeartbeat` Pydantic 模型
3. 实现 `SwarmCoordinator` 完整类：
   - `register_agent`：注册 agent 能力画像 + 厂商
   - `submit_task`：提交任务到队列（I2 trace）
   - `dispatch`：capability-based routing 分发（I3 能力匹配 + I5/I6 跨厂商）
   - `heartbeat`：更新 agent 心跳
   - `check_timeouts`：检测超时并 reassign（I4 心跳超时）
   - `_find_capable_agent`：4 步过滤（能力包含 → 跨厂商 → no-self-review → load balancing）
   - `_find_complement_agent`：能力互补推荐搭档
   - `get_task_status` / `get_agent_workload`：状态查询
   - `run_continuously`：持续调度循环（永不停止）
4. 实现 I1-I6 六个不变量
5. 实现 trace 归档到 `data/forgemind/swarm_trace.jsonl`（append-only）
6. 创建配置文件 `flowforge/config/agent_swarm.yaml`（5 个灵智体能力画像 + 跨厂商要求）
7. 单元测试：test_swarm_coordinator.py / test_swarm_invariants.py / test_swarm_dispatch.py

#### Phase 2：Swarm Dashboard Web UI + F048 Steer 集成

1. 实现 Swarm Dashboard 前端组件（Next.js，复用 F026 应用层）
2. 在 `flowforge/app/` 注册 `/api/swarm/tasks` REST 路由 + `/ws/swarm` WebSocket 路由
3. 集成 F048 TeamAct Queue Steer：把 SwarmTask 队列接入 SteerQueue，operator 可通过 SteerCommand 对 Swarm 任务做 PRIORITY_BOOST / REDIRECT / CANCEL
4. 集成测试：test_swarm_web_e2e.py（真实浏览器 + WS 推送）

#### Phase 3：MindCodex 归档 + Eval Ledger 集成

1. 归档同步到 MindCodex（F039）：每次 SwarmDispatchRecord 作为 `SwarmEpisodeCard` 知识对象
2. Eval Ledger（F040）采集 Swarm trace 信号（分发延迟 / reassign 次数 / 能力匹配率 / 心跳超时率）
3. 七类归因（F020）：Swarm 调度失败时归因到 `swarm_no_capable_agent / swarm_heartbeat_timeout / swarm_cross_vendor_violation / swarm_max_retries_exceeded` 等子类
4. E2E 测试：test_swarm_e2e.py（真实 5 灵智体协同 + 归档检索）

### 3.2 依赖关系

- **依赖 5 个 forgekins/*.yaml 能力画像**：`register_agent` 时从 YAML 加载 capabilities + vendor
- **依赖 core/tracing.get_logger**：所有日志通过统一 logger，自动注入 `trace_id`
- **依赖 F046 SelfDev 五闭环**：SwarmTask 的 `required_capabilities` 来自五闭环配置（doc/code/framework/review/test）
- **被 F048 TeamAct Queue Steer 依赖（Phase 2）**：SteerCommand 作用于 Swarm 任务队列
- **被 F020 七类归因依赖（Phase 3）**：Swarm 调度失败归因到七类矩阵
- **被 F039 MindCodex 依赖（Phase 3）**：归档记录作为知识对象检索
- **被 CL-032 验证脚本依赖**：`scripts/verify_cl14_compliance.py::verify_cl032()` 检查 SwarmCoordinator 存在性

### 3.3 配置外置（铁律 5）

所有能力画像、超时阈值、跨厂商要求通过 `flowforge/config/agent_swarm.yaml` 注入：

```yaml
agent_swarm:
  enabled: true
  heartbeat_timeout_seconds: 30  # I4 心跳超时
  max_retries: 3                 # 最大重试次数
  dispatch_interval_seconds: 5   # 调度循环间隔
  agents:
    wenxin:
      vendor: "trae"
      capabilities: ["doc_generation", "doc_review", "format_check", "frontmatter_check"]
    sherlock:
      vendor: "trae"
      capabilities: ["code_generation", "bug_fixing", "refactoring", "test_writing"]
    luban:
      vendor: "trae"
      capabilities: ["architecture_design", "adr_drafting", "config_adjustment", "dependency_analysis"]
    vangogh:
      vendor: "claude"  # 跨厂商（I5/I6 no-self-review）
      capabilities: ["code_review", "doc_review", "quality_gate", "push_back"]
    davinci:
      vendor: "trae"
      capabilities: ["test_generation", "test_execution", "coverage_analysis", "regression_test"]
  cross_vendor_required:
    - "code_review"   # code_review 必须跨厂商
    - "doc_review"
```

路径 `data/forgemind/swarm_trace.jsonl` 为相对路径，运行时由 `flowforge/config/default.yaml` 的 `runtime.data_dir` 拼接为绝对路径（红线 11 不硬编码绝对路径）。

---

## 4. 验收标准

### 4.1 功能验收

- [ ] AC-1: `SwarmCoordinator.register_agent` 注册 5 个灵智体的能力画像 + 厂商标识
- [ ] AC-2: `SwarmCoordinator.submit_task` 接收 SwarmTask 并返回 task_id，存入 `_tasks` 字典
- [ ] AC-3: `SwarmCoordinator.dispatch` 按 capability-based routing 把 PENDING 任务路由给能力匹配的 agent
- [ ] AC-4: `_find_capable_agent` 4 步过滤正确执行（能力包含 → I5 跨厂商 → I6 no-self-review → load balancing）
- [ ] AC-5: `SwarmCoordinator.heartbeat` 更新 agent 心跳时间戳与进度
- [ ] AC-6: `SwarmCoordinator.check_timeouts` 检测 30s 无心跳的任务并 reassign
- [ ] AC-7: reassign 超过 MAX_RETRIES（3 次）的任务标记为 FAILED
- [ ] AC-8: `_find_complement_agent` 为 blind_spots 任务推荐搭档 agent
- [ ] AC-9: `get_task_status` / `get_agent_workload` 返回正确状态
- [ ] AC-10: `run_continuously` 持续运行调度循环，每 interval 秒触发一次 dispatch + check_timeouts

### 4.2 安全验收

- [ ] AC-11: I1 强制 — SwarmCoordinator 全局唯一（DI 单例），禁止外部直接实例化
- [ ] AC-12: I2 强制 — submit_task 必落 trace（`_tasks` 字典 + JSONL 归档）
- [ ] AC-13: I3 强制 — 能力不匹配的任务保持 PENDING，不分发给 blind_spots agent
- [ ] AC-14: I4 强制 — 30s 无心跳自动 reassign，3 次重试后 FAILED
- [ ] AC-15: I5 强制 — code_review/doc_review 任务路由到与 author 不同厂商的 agent
- [ ] AC-16: I6 强制 — reviewer 不能审自己的产物（agent_id != author_agent_id）
- [ ] AC-17: 所有依赖通过构造函数注入（`config: Optional[dict]`），不直接实例化外部服务（红线 12）
- [ ] AC-18: 所有路径通过 YAML 配置注入，禁止硬编码绝对路径（红线 11）

### 4.3 质量验收

- [ ] AC-19: Python 3.11+ 类型注解完整（`from __future__ import annotations` + `dict[str, Any]` 现代语法）
- [ ] AC-20: 所有 I/O 操作 `async/await`（`dispatch / heartbeat / check_timeouts / run_continuously`）
- [ ] AC-21: 中文 docstring 完整（模块 / 类 / 公开方法）
- [ ] AC-22: 代码语法通过 `python -c "import ast; ast.parse(open(...).read())"` 验证
- [ ] AC-23: `scripts/verify_cl14_compliance.py::verify_cl032()` 从 PARTIAL 升级到 PASS

### 4.4 Eval 验收

- [ ] AC-24: Eval Contract 五问全部回答（§6）
- [ ] AC-25: 三方信号交叉通过（trace + 用户 + 探针）
- [ ] AC-26: 归因到七类矩阵之一（若失败）

---

## 5. 测试计划

### 5.1 单元测试

- `test_swarm_models.py`：`SwarmTask / AgentHeartbeat` Pydantic 校验 / 默认值 / 状态枚举
- `test_swarm_register.py`：`register_agent` 注册 5 灵智体能力画像
- `test_swarm_dispatch.py`：`dispatch` capability-based routing / 4 步过滤 / load balancing
- `test_swarm_heartbeat.py`：`heartbeat` 更新 / `check_timeouts` 超时检测 / reassign
- `test_swarm_complement.py`：`_find_complement_agent` 能力互补推荐
- `test_swarm_invariants.py`：I1-I6 六个不变量独立测试
- `test_swarm_archive.py`：trace 归档到 JSONL / append-only / 字段完整性
- `test_swarm_run_continuously.py`：`run_continuously` 持续调度循环（用 asyncio.create_task 启动 + cancel 停止）

### 5.2 集成测试

- `test_integration_five_forgekins.py`：注册 5 个真实 forgekin 能力画像 + 提交 doc/code/framework/review/test 5 类任务 + 验证分发到正确 agent
- `test_integration_teamact_steer.py`：`SwarmCoordinator` + F048 `SteerQueue` 端到端（SteerCommand 对 Swarm 任务做 REDIRECT/CANCEL）
- `test_integration_config.py`：从 `agent_swarm.yaml` 加载配置注入 SwarmCoordinator

### 5.3 E2E 测试

- `test_e2e_swarm_doc_task.py`：真实提交 doc_generation 任务 → wenxin 接收 → heartbeat 上报 → 完成
- `test_e2e_swarm_review_cross_vendor.py`：真实提交 code_review 任务（author=sherlock/trae）→ vangogh/claude 接收（I5 跨厂商验证）
- `test_e2e_swarm_timeout_reassign.py`：模拟 agent 崩溃（30s 无心跳）→ 任务自动 reassign 给其他 agent
- `test_e2e_swarm_complement.py`：提交 blind_spots 任务 → _find_complement_agent 推荐搭档 → operator 通过 SteerCommand REDIRECT 转交

E2E 测试遵守 T1-T8 铁律：
- T1: 不 Mock LLM（本 Feature 不直接调用 LLM，但 trace 归档检索可调用 LLM 审核）
- T2: 真实场景数据（真实 5 forgekin 能力画像 / 真实 SelfDev 闭环任务）
- T3: 具体断言（验证 `task.assigned_agent_id == "forgemind:wenxin"` / `task.status == COMPLETED` / reassign 次数）
- T6: MetricsCollector 采集指标（分发延迟 / reassign 次数 / 能力匹配率 / 心跳超时率）
- T7: LLM 生成内容经 LLM 审核（本 Feature 不涉及，归档检索场景在 Phase 3 适用）
- T8: Phase 2 Swarm Dashboard E2E 必须操控浏览器验证 DOM（T8 铁律）

---

## 6. Eval Contract（五问）

### 6.1 谁评估

- **评估者**：operator（主评估者，Swarm 调度体验第一手）+ 评审员可进化智能体（梵高·vangogh，审查 trace 归档完整性 + I5/I6 跨厂商独立性）+ Eval Ledger 自动评估（分发延迟 / reassign 次数 / 能力匹配率）
- **自动评估**：每次 `dispatch` / `check_timeouts` 完成后自动记录 trace 信号到 Eval Ledger（F040，Phase 3 集成）

### 6.2 评估什么

- capability-based routing 的准确性（任务是否路由到能力匹配的 agent）
- I1-I6 六个不变量的有效性（单一调度器 / 任务不丢失 / 能力匹配 / 心跳超时 / 跨厂商独立 / no-self-review）
- 5 灵智体协同的负载均衡（workload 分布是否合理）
- 能力互补推荐的有效性（blind_spots 任务是否找到合适搭档）
- operator 体验（调度延迟、Plan Board 易用性 — Phase 2）

### 6.3 何时评估

- **每次 `dispatch` 完成后**：自动记录 trace 信号（分配延迟 / agent_id / required_capabilities 匹配率）
- **每次 `check_timeouts` 触发 reassign 后**：自动记录 reassign 原因（心跳超时 / agent 崩溃）
- **每周**：operator 主观评估（哪些能力域任务最多、哪些 agent 最忙）
- **每月**：梵高 review 归档 JSONL 完整性 + MindCodex 检索复用度（Phase 3）+ I5/I6 跨厂商独立性审查

### 6.4 评估信号

- **trace 信号**：`dispatch` 延迟、`check_timeouts` reassign 次数、能力匹配率（assigned / pending）、心跳超时率、跨厂商任务比例
- **用户信号**：operator 反馈 Swarm 调度效率、能力互补推荐准确度、Plan Board 交互流畅度（Phase 2）
- **探针信号**：归档 JSONL 行数增长率、MindCodex `SwarmEpisodeCard` 检索命中率（Phase 3）、CL-032 验证状态（PASS 持续保持）、5 agent workload 分布标准差

### 6.5 评估后做什么

- 通过 → 状态改为 ✅ done，进入 KnowledgeEvolution 蒸馏为 `SwarmEpisodeCard`
- 失败 → 归因到七类矩阵：
  - `swarm_no_capable_agent`（I3 违反，无 agent 能覆盖 required_capabilities）
  - `swarm_heartbeat_timeout`（I4 触发，agent 崩溃或 LLM 调用挂死）
  - `swarm_cross_vendor_violation`（I5 违反，review 任务路由到同厂商 agent）
  - `swarm_self_review_violation`（I6 违反，reviewer 审了自己的产物）
  - `swarm_max_retries_exceeded`（I4 升级，reassign 3 次仍失败）
  - `swarm_archive_corruption`（I2 违反，trace 归档被篡改或丢失）
  - `swarm_concurrent_dispatch_conflict`（I1 违反，多个 SwarmCoordinator 实例并发调度）

---

## 7. Build to Delete vs Built to Persist

### 7.1 半衰期标记

本 Feature 主要属于：[ ] Build to Delete | [x] Built to Persist | [ ] 混合

### 7.2 理由

Agent Swarm 协同协议是 FlowForge 多灵智体协同体系的**永久基础设施**——只要 FlowForge 存在 5 灵智体协同调度需求，就需要 SwarmCoordinator 全局调度器。即使未来 LLM 能力升级到完全自主，5 agent sweet spot 模式仍然是协作成本与能力覆盖的最佳平衡点（FlowForge 5 agent sweet spot 工程模式验证）。

具体而言：
- `SwarmTask / AgentHeartbeat / SwarmTaskStatus` 核心模型属于 Build to Persist（调度契约）
- `SwarmCoordinator` 的 4 步过滤算法（能力包含 → 跨厂商 → no-self-review → load balancing）属于 Build to Persist（调度语义稳定）
- I1-I6 六个不变量属于 Build to Persist（治理铁律）
- capability-based routing 思想属于 Build to Persist（与 TeamAct 状态机 + Steer 协议互补）
- Swarm Dashboard 前端组件（Phase 2）属于混合：Web UI 形态可能随前端技术栈升级而调整，但"可视化调度"能力本身持久
- trace 归档格式（JSONL）属于 Build to Persist（与 F021 WAL / F047 / F048 归档一致）

### 7.3 sunset 触发条件

- FlowForge 退役 → 整体迁移到新框架
- LLM 能力达到完全自主（单一 agent 可覆盖全部能力域）→ 评估是否简化为单 agent 模式
- 5 agent sweet spot 被新协作模式替代（如 7 agent / 9 agent 模式）→ SwarmCoordinator 重新设计
- TeamAct 协议被新协作协议替代 → Swarm 协议层重新设计

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-21 | 初版：基于 CL-032（P2-005）+ FlowForge 5 agent sweet spot 模式 + F046 五闭环 + F048 Steer 协议已完成的设计，规划 SwarmCoordinator 全局调度器 + capability-based routing + heartbeat/timeout 回收 + I1-I6 不变量 + 3 Phase 实施路径；Phase 1 交付核心协议层 + trace 归档 + 配置外置 |

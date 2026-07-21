# A008: Durable State Surfaces 架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，对应 FR-CORE-019）
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）
> **对应 Feature**: [doc:../features/F008-durable-state-surfaces.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D008-durable-state-surfaces.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"对话历史是最脆的状态表面，会被压缩截断丢失，真相源必须外部化"的根本问题。当前 v7.0 有 task_store / memory manager / git_worktree，但未明确：

1. 对话历史（thread_trace）是最脆的状态表面，关键决策必须镜像到高权威表面
2. 治理规则仍塞在 user message 里，上下文压缩后规则消失，Forgekin（Evolvable Agent，社区社交称'灵智体'）后半段突然违规
3. 6 类持久状态表面无权威等级与冲突解析规则
4. 压缩免疫层（native system role）未形式化，治理规则无处下沉

Durable State Surfaces 在架构层是 Harness 七层的第一层（感知现实），是 Build to Persist 的基础设施。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/harness/durable_state.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：DurableStateRegistry 通过构造函数注入存储后端
- **Repository 层约束**：所有 Durable Surface 写入必须通过 Repository 抽象
- **配置驱动约束**：权威等级 / 压缩免疫属性 / 存储后端映射外置到 `flowforge/config/harness.yaml`
- **压缩免疫约束**：治理规则必须注入 native system role，禁 user message prepend
- **真相源外部化约束**：thread_trace 关键决策必须镜像到高权威表面
- **Magic Words 约束**：Durable State 不可绕过 Magic Words 逃生舱（F011）

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：TeamAct 状态必须持久化到 6 类 Durable Surface
- **对 Governance Boundary（A010）的影响**：压缩免疫属性是 Governance 注入层的基础
- **对 Evidence & Sensors（A009）的影响**：证据写入 Durable Surface（task_queue / thread_trace）
- **对 liveness 规范读模型（A023）的影响**：Durable Surface 是 liveness 真相源
- **对分布式可靠性（A021-A025）的影响**：Durable Surface 走 Tier 2 恢复分级，WAL 可重放
- **对 Handoff Capsule（A003）的影响**：胶囊是 6 类 Durable Surface 之一（authority_level=2）

---

## 2. 架构设计

### 2.1 组件架构图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       Harness L1: Durable State Surfaces                │
│                                                                         │
│   ┌─────────────┐  ┌─────────┐  ┌──────────┐  ┌──────────────────────┐  │
│   │ feature_spec│  │ git     │  │task_queue│  │ thread_session_trace │  │
│   │ (authority=5│  │ (auth=4)│  │ (auth=3) │  │ (authority=1, 最脆)  │  │
│   │ 最权威)     │  │         │  │          │  │                      │  │
│   └──────┬──────┘  └────┬────┘  └─────┬────┘  └──────────┬───────────┘  │
│          │              │             │                  │              │
│          │              │             │                  │ 关键决策     │
│          │              │             │                  │ 必须镜像     │
│          │              │             │                  ▼              │
│          │              │             │        ┌──────────────────────┐ │
│          │              │             │        │ memory_federation   │ │
│          │              │             │        │ handoff_capsule     │ │
│          │              │             │        │ (authority=2)       │ │
│          │              │             │        └──────────┬───────────┘ │
│          │              │             │                   │             │
│          └──────────────┴─────────────┴───────────────────┘             │
│                                  │                                       │
│                                  ▼                                       │
│         ┌──────────────────────────────────────────────────────────┐    │
│         │   DurableStateRegistry (统一读写入口)                    │    │
│         │   - write / read / canonical_read                         │    │
│         │   - 冲突解析 (按权威等级)                                 │    │
│         └────────────────────────────┬─────────────────────────────┘    │
└──────────────────────────────────────┼───────────────────────────────────┘
                                       │
                                       ▼
         ┌─────────────────────────────────────────────────────────────┐
         │   CompressionImmuneInjector (压缩免疫注入器)               │
         │   - 治理规则注入 native system role                          │
         │   - 禁 user message prepend                                  │
         │   - 与 F010 Governance Boundary 联动                         │
         └─────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：6 类 Durable Surface 形式化（feature_spec/git/task_queue/thread_trace/memory_federation/handoff_capsule）**
  理由：roleagent.md 第 3 章明确列出 6 类。每类有不同的权威等级与压缩免疫属性，必须形式化才能机械判定冲突。

- **决策 2：权威等级分层（1-5）**
  理由：feature_spec(5) > git(4) > task_queue(3) > memory_federation(2) = handoff_capsule(2) > thread_trace(1)。多表面冲突时高权威覆盖低权威。

- **决策 3：thread_trace 是最脆表面（关键决策必须镜像）**
  理由：对话历史会被压缩截断丢失。thread_trace 中关键决策必须镜像到 feature_spec 或 task_queue 等高权威表面，避免压缩后丢失。

- **决策 4：治理规则注入 native system role（压缩免疫层）**
  理由：roleagent.md 第 3 章明确"压缩不理解什么是治理规则：它可能保留最近的代码细节，却压掉协作协议、操作红线、任务交接规则和质量纪律"。必须注入 native system role 才能压缩免疫。

- **决策 5：禁 user message prepend 注入治理规则**
  理由：user message 是最脆的表面，会被压缩吞掉。治理规则塞在 user message prepend 中，上下文压缩后规则消失。

- **决策 6：canonical_read 模型（关联 F023 liveness 规范读模型）**
  理由：多表面冲突时走 liveness 规范读模型，持久记录是生命周期真相源，草稿缓存是新鲜度信号。

### 2.3 架构不变量

- 6 类 Durable Surface 必须全部可通过 DurableStateRegistry 读写
- 治理规则必须注入 native system role，禁 user message prepend
- thread_trace 关键决策必须镜像到高权威表面（feature_spec 或 task_queue）
- 冲突解析必须按权威等级判定（高权威覆盖低权威）
- Durable Surface 写入必须通过 Repository 层，禁直操作数据库
- Durable Surface 走 WAL，进程崩溃可恢复（Tier 2 恢复分级）
- 治理规则文本必须外置 YAML 配置，禁硬编码（编程红线第 11 条）
- canonical_read 必须返回权威等级最高的表面数据

---

## 3. 模块设计

### 3.1 模块边界

- **durable_state.py::StateSurfaceType** — 6 类表面枚举。
- **durable_state.py::DurableSurface** — 单表面配置数据模型（authority_level + compression_immune + persistence_backend）。
- **durable_state.py::DurableStateRegistry (ABC)** — 统一读写入口（write / read / canonical_read）。
- **durable_state.py::CompressionImmuneInjector** — 压缩免疫注入器（注入 native system role）。
- **durable_state.py::ConflictResolver** — 冲突解析器（按权威等级判定）。
- **infra/repo/sqlite_durable_store.py** — SQLite 实现（WAL 可重放）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class StateSurfaceType(str, Enum):
    """6 类 Durable State Surface"""
    FEATURE_SPEC = "feature_spec"            # Feature 规格（最权威）
    GIT = "git"                              # git 仓库
    TASK_QUEUE = "task_queue"                # 任务队列
    THREAD_TRACE = "thread_trace"            # 线程会话 trace（最脆）
    MEMORY_FEDERATION = "memory_federation"  # 多域记忆联邦
    HANDOFF_CAPSULE = "handoff_capsule"      # 交接胶囊


class DurableSurface(BaseModel):
    """单 Durable Surface 配置"""
    surface_type: StateSurfaceType
    authority_level: int                    # 权威等级 1-5 (5 最权威)
    compression_immune: bool                # 是否压缩免疫
    persistence_backend: str                 # 存储后端 (sqlite/git/filesystem)
    canonical_read_model: str                # 规范读模型 ID (关联 F023)


class DurableStateRegistry(ABC):
    """Durable State 统一读写入口"""

    @abstractmethod
    async def write(
        self,
        surface_type: StateSurfaceType,
        key: str,
        payload: dict,
    ) -> str:
        """写入 Durable Surface

        架构契约:
        - 必须通过 Repository 层 (禁直操作数据库)
        - WAL 可重放 (F021 联动)
        - thread_trace 关键决策自动镜像到高权威表面
        """

    @abstractmethod
    async def read(
        self,
        surface_type: StateSurfaceType,
        key: str,
    ) -> Optional[dict]:
        """读取 Durable Surface"""

    @abstractmethod
    async def canonical_read(
        self,
        surface_type: StateSurfaceType,
        key: str,
    ) -> dict:
        """规范读 (返回权威等级最高的表面数据)

        架构契约:
        - 多表面冲突时返回最高权威
        - 与 F023 liveness 规范读模型联动
        """


class CompressionImmuneInjector(ABC):
    """压缩免疫注入器"""

    @abstractmethod
    async def inject(self, rules: list[str]) -> None:
        """把治理规则注入 native system role (压缩免疫层)

        架构契约:
        - 禁注入 user message prepend (F010 P0 问题)
        - 注入后写审计日志
        - 与 F010 Governance Boundary 联动
        """


class ConflictResolver(ABC):
    """冲突解析器"""

    @abstractmethod
    async def resolve(
        self,
        surfaces: list[DurableSurface],
    ) -> DurableSurface:
        """按权威等级解析冲突

        架构契约:
        - 高权威覆盖低权威
        - 同权威走 F023 liveness 规范读模型
        """
```

### 3.3 数据流

```
Forgekin执行动作 (TeamAct ACTION 步)
                  │
                  │ 产出 (代码 / 任务 / 决策 / 记忆 / 胶囊)
                  ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. DurableStateRegistry.write(surface_type, key, payload)  │
│    - 识别 surface_type                                       │
│    - 校验 authority_level / compression_immune              │
│    - 持久化到对应 backend (sqlite/git/filesystem)            │
│    - WAL 写入 (F021 联动, 可重放)                            │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
              ┌────────────┴────────────┐
              │  surface_type ==        │
              │  thread_trace?          │
              └────────────┬────────────┘
                           │
              ┌────────────┴────────────┐
              │ 关键决策?               │
              └────────────┬────────────┘
                           │ 是
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. 关键决策镜像到高权威表面                                 │
│    - 镜像到 feature_spec (authority=5) 或 task_queue (auth=3)│
│    - 避免压缩后丢失                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. 治理规则注入 (CompressionImmuneInjector)                │
│    - 注入 native system role (压缩免疫)                      │
│    - 禁 user message prepend                                 │
│    - 与 F010 Governance Bundle 联动                          │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. Forgekin读取 (canonical_read)                             │
│    - 多表面冲突时返回权威等级最高的                          │
│    - 与 F023 liveness 规范读模型联动                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — TeamAct 状态持久化到 Durable Surface
- **F003 Handoff Capsule** — 胶囊是 6 类 Durable Surface 之一
- **F014-F017 Memory Federation** — 多域记忆联邦是 Durable Surface 之一

### 4.2 下游影响

- **F009 Evidence & Sensors** — 证据写入 Durable Surface（task_queue / thread_trace）
- **F010 Governance Boundary** — 压缩免疫属性是 Governance 注入层基础
- **F011 Magic Words** — "我能猜出来"强制查询 Durable Surface 真相源
- **F022 Tier 1-4 Recovery** — Durable Surface 走 Tier 2 恢复分级
- **F023 liveness Canonical Read** — Durable Surface 是 liveness 真相源

### 4.3 跨模块不变量

- TeamActState 必须持久化到 task_queue（authority_level=3）
- HandoffCapsule 必须持久化到 handoff_capsule（authority_level=2）
- Evidence 必须持久化到 task_queue 或 thread_trace
- 治理规则必须注入 native system role，禁 user message prepend
- thread_trace 关键决策必须镜像到 feature_spec 或 task_queue
- 多表面冲突时 canonical_read 返回权威等级最高的

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/harness/durable_state.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: DurableStateRegistry 通过 DI 容器注入，无直接实例化
- [ ] AC-3: Durable Surface 写入通过 Repository 层（无 cursor.execute）
- [ ] AC-4: 权威等级 / 压缩免疫属性 / 存储后端外置到 `flowforge/config/harness.yaml`
- [ ] AC-5: Durable Surface 走 WAL（F021 联动）

### 5.2 架构不变量验收

- [ ] AC-6: 6 类状态表面全部可通过 Registry 读写
- [ ] AC-7: 治理规则注入 native system role，禁 user message prepend
- [ ] AC-8: 上下文压缩后治理规则仍在 session 生效
- [ ] AC-9: 冲突解析按权威等级判定（高权威覆盖低权威）
- [ ] AC-10: thread_trace 关键决策镜像到高权威表面
- [ ] AC-11: canonical_read 返回权威等级最高的表面数据

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-019 Durable State Surfaces）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L1 Durable State Surfaces）
- [doc:../features/F008-durable-state-surfaces.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]（TeamAct 状态持久化）
- [doc:../features/F003-handoff-capsule.md]（胶囊作为 Durable Surface）
- [doc:../features/F010-governance-boundary.md]（压缩免疫注入层基础）
- [doc:../features/F023-liveness-canonical-read.md]（liveness 规范读模型）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F008 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |

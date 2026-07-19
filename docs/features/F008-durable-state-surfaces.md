# Feature F008: Durable State Surfaces（持久状态表面）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-017] + [doc:roleagent.md#第3章]
> **关联 ADR**: [doc:decisions/007-harness-engineering.md]
> **类型**: harness
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.3]（待创建）
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

Durable State Surfaces 是 Harness 七层的第一层：明确"对话历史是最脆的状态表面，会被压缩截断丢失，真相源必须外部化"。本 Feature 把 roleagent.md 第 3 章列出的 6 类持久状态表面（feature spec / git / task queue / thread session trace / memory federation / handoff capsule）形式化为带权威等级、压缩免疫、可审计的状态层。

这是 Build to Persist 基础设施——编码"哪些状态必须跨 session 跨 agent 跨时间持续存在"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-017]` 指出：roleagent.md 列出 6 类持久状态表面，但 v7.0 有 task_store、memory manager、git_worktree，未明确"对话历史是最脆的状态表面，会被压缩截断丢失，真相源必须外部化"。导致治理规则仍塞在 user message 里，上下文压缩后规则消失，Forgekin 后半段突然违规。

不做这个 Feature，F010 Governance Boundary 的压缩免疫无从落地（治理规则无处下沉），F002 TeamAct 状态在 session 重启后丢失，跨厂商协作无法持久化。roleagent.md 第 1 章明确把"现实状态"列为 Build to Persist 基础设施。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class StateSurfaceType(str, Enum):
    FEATURE_SPEC = "feature_spec"        # Feature 规格（最权威）
    GIT = "git"                          # git 仓库
    TASK_QUEUE = "task_queue"            # 任务队列
    THREAD_TRACE = "thread_trace"        # 线程会话 trace
    MEMORY_FEDERATION = "memory_federation"  # 多域记忆联邦
    HANDOFF_CAPSULE = "handoff_capsule"  # 交接胶囊

class DurableSurface(BaseModel):
    surface_type: StateSurfaceType
    authority_level: int                 # 权威等级 1-5（5 最权威）
    compression_immune: bool             # 是否压缩免疫
    persistence_backend: str             # 存储后端
    canonical_read_model: str            # 规范读模型 ID（关联 F023）
```

### 3.2 核心接口

```python
class DurableStateRegistry(ABC):
    @abstractmethod
    async def write(self, surface_type: StateSurfaceType, key: str, payload: dict) -> str: ...
    @abstractmethod
    async def read(self, surface_type: StateSurfaceType, key: str) -> Optional[dict]: ...
    @abstractmethod
    async def canonical_read(self, surface_type: StateSurfaceType, key: str) -> dict: ...

class CompressionImmuneInjector:
    """把治理规则注入 native system role（压缩免疫层）"""
    def inject(self, rules: list[str]) -> None: ...
```

### 3.3 关键算法

- **权威等级**：feature_spec(5) > git(4) > task_queue(3) > memory_federation(2) > handoff_capsule(2) > thread_trace(1)。
- **冲突解析**：多表面冲突时，高权威覆盖低权威；同权威走 F023 liveness 规范读模型。
- **压缩免疫**：治理规则通过 native system role 注入（不通过 user message prepend），上下文压缩不触及。
- **真相源外部化**：thread_trace 标记为"最脆"，关键决策必须镜像到 feature_spec 或 task_queue。

### 3.4 配置外置（YAML 示例）

```yaml
durable_state:
  surfaces:
    feature_spec: {authority: 5, compression_immune: true, backend: git}
    git: {authority: 4, compression_immune: true, backend: git}
    task_queue: {authority: 3, compression_immune: true, backend: sqlite}
    thread_trace: {authority: 1, compression_immune: false, backend: sqlite}
    memory_federation: {authority: 2, compression_immune: true, backend: sqlite}
    handoff_capsule: {authority: 2, compression_immune: true, backend: sqlite}
  governance_injection_layer: native_system_role
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 6 类状态表面全部可通过 Registry 读写
- [ ] AC-2: 治理规则注入 native system role，上下文压缩后仍存在
- [ ] AC-3: 冲突解析按权威等级判定
- [ ] AC-4: thread_trace 关键决策镜像到高权威表面
- [ ] AC-5: 状态写入通过 Repository 层，禁直操作数据库

## 5. 测试策略

### 5.1 单元测试

- 权威等级判定、冲突解析、压缩免疫注入、真相源外部化。

### 5.2 集成测试

- 接入 F002 TeamAct 状态持久化、F010 Governance 注入、F023 liveness 读模型。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体在长上下文压缩后验证治理规则仍在 native system role 生效。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第3章]
- [doc:review/review.md#第八章/RA-017]
- [doc:decisions/007-harness-engineering.md]
- [doc:design/naming-contract.md#2.5]（灵忆 EchoStore）
- [doc:features/F002-teamact-loop.md]
- [doc:features/F010-governance-boundary.md]
- [doc:features/F023-liveness-canonical-read.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.3 同号映射 | 文档员灵智体（钢笔·文心） |

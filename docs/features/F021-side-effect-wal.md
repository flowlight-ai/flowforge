# Feature F021: 副作用日志 WAL

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-038] + [doc:roleagent.md#第6章]
> **关联 ADR**: [doc:decisions/010-distributed-reliability.md]
> **类型**: reliability
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.6]（待创建）
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

副作用日志 WAL（Write-Ahead Log）是 roleagent.md 第 6 章的可靠性基础：所有副作用操作（写文件/发请求/改数据库/调外部 API）必须先写 WAL 再执行，执行后写确认。本 Feature 实现 WAL 的追加写入、回放恢复、与 F022 Tier 1-4 恢复分级联动。

这是 Build to Persist 基础设施——编码"副作用可审计可回放"的工程规则。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-038]` 指出：roleagent.md 第 6 章要求副作用操作可追踪、可回滚、可恢复。v7.0 有 trace 但无副作用 WAL——执行中断后无法知道"哪些副作用已发生、哪些未发生"，导致恢复时要么重做（可能重复副作用）要么放弃（可能丢失已完成工作）。

不做这个 Feature，F022 Tier 1-4 恢复分级无回放基础，F023 liveness 规范读模型缺少"副作用已确认"信号，F024 强 workflow 的"可审计可回放"无从落地。这是 roleagent.md 第 6 章分布式可靠性的底座。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class SideEffectType(str, Enum):
    FILE_WRITE = "file_write"
    HTTP_REQUEST = "http_request"
    DB_WRITE = "db_write"
    EXTERNAL_API = "external_api"
    GIT_OP = "git_op"
    PHYSICAL_OP = "physical_op"           # 物理世界操作（FR-004）

class WalEntry(BaseModel):
    entry_id: str
    forgekin_id: str
    effect_type: SideEffectType
    target: str                           # 副作用目标（文件路径/URL/表名）
    payload: dict                         # 副作用参数
    pre_state: Optional[dict]             # 前置状态快照（用于回滚）
    status: Literal["pending", "executing", "confirmed", "failed", "rolled_back"]
    written_at: datetime
    confirmed_at: Optional[datetime]
    idempotency_key: str                  # 幂等键（防重复执行）
```

### 3.2 核心接口

```python
class WalAppender(ABC):
    """WAL 追加写入（执行前）"""
    @abstractmethod
    async def append(self, entry: WalEntry) -> str: ...

class WalExecutor:
    """WAL 执行器（按 entry 执行副作用）"""
    async def execute(self, entry_id: str) -> None: ...
    async def confirm(self, entry_id: str) -> None: ...

class WalReplayer:
    """WAL 回放恢复"""
    async def list_pending(self, forgekin_id: str) -> list[WalEntry]: ...
    async def replay(self, entry_id: str) -> None: ...
    async def rollback(self, entry_id: str) -> None: ...
```

### 3.3 关键算法

- **先写后执行**：副作用执行前必须先 append WAL entry（status=pending），执行后 confirm。
- **幂等键**：相同 idempotency_key 的 entry 不重复执行（防恢复时重放导致重复副作用）。
- **回放恢复**：进程重启后扫描 status=pending 的 entry，按 F022 Tier 分级决定 replay/rollback。
- **前置状态快照**：pre_state 用于 rollback 时恢复（仅可回滚操作记录）。

### 3.4 配置外置（YAML 示例）

```yaml
side_effect_wal:
  storage_backend: sqlite
  require_pre_state_for_rollback: true
  idempotency_key_strategy: hash_target_payload
  on_restart:
    pending_action: tier_based_recovery   # 交 F022 分级处理
    max_replay_batch: 50
  rollback_supported_types: [file_write, db_write]
  rollback_unsupported_types: [http_request, external_api, physical_op]
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 副作用执行前必须先 append WAL（status=pending）
- [ ] AC-2: 相同 idempotency_key 的 entry 不重复执行
- [ ] AC-3: 进程重启后可扫描 pending entry 交 F022 分级处理
- [ ] AC-4: 可回滚操作支持 rollback 恢复 pre_state
- [ ] AC-5: 不可回滚操作（physical_op 等）不自动 rollback

## 5. 测试策略

### 5.1 单元测试

- WAL 追加、幂等键、回放扫描、rollback 恢复。

### 5.2 集成测试

- 接入 F022 Tier 1-4 恢复分级、F023 liveness 读模型、F024 强 workflow。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体执行副作用时进程被中断，验证重启后 WAL 回放按 Tier 分级正确处理。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第6章]
- [doc:review/review.md#第八章/RA-038]
- [doc:decisions/010-distributed-reliability.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F022-tier-1-4-recovery.md]
- [doc:features/F023-liveness-canonical-read.md]
- [doc:features/F024-weak-state-vs-strong-workflow.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.6 同号映射 | 文档员灵智体（钢笔·文心） |

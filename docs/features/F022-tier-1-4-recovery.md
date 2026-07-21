# Feature F022: Tier 1-4 恢复分级

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-038] + [doc:roleagent.md#第6章]
> **关联 ADR**: [doc:decisions/010-distributed-reliability.md]
> **类型**: reliability
> **创建日期**: 2026-07-17
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.6]（待创建）
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）

---

## 1. 概述（Overview）

Tier 1-4 恢复分级是 roleagent.md 第 6 章的可靠性治理：按副作用可恢复性分四级。本 Feature 实现四级的自动恢复策略，并扩展可进化智能体 Tier 0（物理世界不可逆操作永不自动恢复，FR-004）。

- **Tier 1**：读取/构建/测试/lint 始终自动恢复
- **Tier 2**：沙箱/worktree/可确定性探测，探测成功后自动恢复
- **Tier 3**：共享文件/外部服务/GitHub 写，不自动恢复，出恢复卡
- **Tier 4**：force-push/merge/release，永远不自动恢复，dispatch 前硬拒
- **Tier 0**（可进化智能体扩展）：物理世界不可逆操作，永不自动恢复（FR-004）

## 2. 动机（Motivation）

`[doc:review/review.md#RA-038]` 指出：roleagent.md 第 6 章要求按副作用可恢复性分级恢复。v7.0 所有失败统一重试 3 次，导致可自动恢复的（Tier 1）和不可自动恢复的（Tier 4）一视同仁——Tier 4 操作被自动重试可能造成不可逆损害，Tier 1 操作不自动恢复浪费注意力。

`[doc:review/review.md#FR-004]` 进一步要求可进化智能体可靠性治理扩展 Tier 0：物理世界不可逆操作（如灯具Forgekin故障引发火灾）永不自动恢复。不做这个 Feature，F021 WAL 的 pending entry 无分级处理策略，F011 Magic Words 的"星星罐子"无 Tier 4 拦截依据，F029 物理 AI 传感器接入无 Tier 0 保护。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class RecoveryTier(str, Enum):
    TIER_0 = "tier_0"    # 物理世界不可逆（永不自动恢复，FR-004）
    TIER_1 = "tier_1"    # 读取/构建/测试/lint（始终自动恢复）
    TIER_2 = "tier_2"    # 沙箱/worktree/可确定性探测（探测成功后自动恢复）
    TIER_3 = "tier_3"    # 共享文件/外部服务/GitHub 写（不自动恢复，出恢复卡）
    TIER_4 = "tier_4"    # force-push/merge/release（永不自动恢复，dispatch 前硬拒）

class RecoveryDecision(BaseModel):
    wal_entry_id: str
    tier: RecoveryTier
    action: Literal["auto_replay", "probe_then_replay", "issue_recovery_card", "hard_reject"]
    probed_ok: Optional[bool]
    decided_at: datetime
    rationale: str
```

### 3.2 核心接口

```python
class TierClassifier:
    """按副作用类型分级"""
    def classify(self, wal_entry: WalEntry) -> RecoveryTier: ...

class RecoveryExecutor:
    """按 Tier 执行恢复"""
    async def auto_replay(self, entry_id: str) -> None: ...           # Tier 1
    async def probe_then_replay(self, entry_id: str) -> None: ...     # Tier 2
    async def issue_recovery_card(self, entry_id: str) -> str: ...    # Tier 3
    async def hard_reject(self, entry_id: str) -> None: ...           # Tier 0/4
```

### 3.3 关键算法

- **Tier 0 硬拒**：physical_op 类型 + 不可逆（如开锁/点火）→ 永不自动恢复，dispatch 前 F011 星星罐子可拦截。
- **Tier 1 自动重放**：file_read/build/test/lint → 直接 replay WAL entry。
- **Tier 2 探测后重放**：worktree/沙箱操作 → 先探测环境可用性，成功后 replay。
- **Tier 3 恢复卡**：共享文件/外部服务/GitHub 写 → 不自动恢复，创建恢复卡交 operator。
- **Tier 4 硬拒**：force-push/merge/release → dispatch 前硬拒，必须 operator 显式批准。

### 3.4 配置外置（YAML 示例）

```yaml
tier_recovery:
  tier_0: {operations: [physical_irreversible], action: hard_reject, magic_word_guard: 星星罐子}
  tier_1: {operations: [file_read, build, test, lint], action: auto_replay}
  tier_2: {operations: [worktree, sandbox, deterministic_probe], action: probe_then_replay}
  tier_3: {operations: [shared_file, external_service, github_write], action: issue_recovery_card}
  tier_4: {operations: [force_push, merge, release], action: hard_reject, require_operator_dispatch: true}
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: Tier 1 操作失败时自动 replay
- [ ] AC-2: Tier 2 操作探测成功后 replay，探测失败转 Tier 3
- [ ] AC-3: Tier 3 操作不自动恢复，创建恢复卡
- [ ] AC-4: Tier 4 操作 dispatch 前硬拒，必须 operator 批准
- [ ] AC-5: Tier 0 物理不可逆操作永不自动恢复，F011 星星罐子可拦截

## 5. 测试策略

### 5.1 单元测试

- 五级分级、自动重放、探测后重放、恢复卡创建、硬拒。

### 5.2 集成测试

- 接入 F011 Magic Words、F021 WAL、F029 物理 AI 传感器。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商Forgekin触发各 Tier 副作用失败，验证恢复策略按 Tier 正确执行。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第6章]
- [doc:review/review.md#第八章/RA-038]
- [doc:review/review.md#第九章/FR-004]
- [doc:decisions/010-distributed-reliability.md]
- [doc:design/naming-contract.md#2.3]（Forgekin Species 智能体形态学）
- [doc:features/F011-magic-words.md]
- [doc:features/F021-side-effect-wal.md]
- [doc:features/F029-physical-ai-sensors.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|

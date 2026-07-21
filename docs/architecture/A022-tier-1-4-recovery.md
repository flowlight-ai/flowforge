# A022: Tier 1-4 恢复分级架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.6]（FR-CORE-006）
> **对应 arch.md**: [doc:../arch.md#§3.6]
> **对应 design.md**: [doc:../design.md#§3.6]（待创建）
> **对应 Feature**: [doc:../features/F022-tier-1-4-recovery.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D022-tier-1-4-recovery.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/010-distributed-reliability.md]

---

## 1. 架构上下文

### 1.1 架构问题

恢复策略的架构问题是"一刀切重试"。v7.0 所有失败统一重试 3 次，导致两类架构故障：

1. **不可逆操作被重试**：Tier 4 操作（force-push/merge/release）被自动重试可能造成不可逆损害（如重复 merge）。
2. **可自动恢复操作浪费注意力**：Tier 1 操作（file_read/build/test）不自动恢复，把 operator 注意力浪费在低风险失败上。

roleagent.md 第 6 章要求按副作用可恢复性分级恢复，FR-004 进一步要求扩展 Tier 0（物理世界不可逆操作永不自动恢复，可进化智能体场景如灯具Forgekin故障引发火灾）。本架构解决的核心问题：**如何实现 Tier 0-4 五级分级、自动恢复策略、Tier 4 硬拒、Tier 0 物理硬拒，与 F011 Magic Words 星星罐子联动**。

### 1.2 架构约束

- **单向依赖约束**：Tier 分级层依赖 F021 WAL，禁止被 F021 反向依赖。
- **分级覆盖约束**：所有 SideEffectType 必须映射到 Tier 0-4 之一，无未分级操作。
- **Tier 0/4 硬拒约束**：Tier 0/4 操作必须 dispatch 前硬拒，必须不进入自动重试路径。
- **Tier 0 物理保护约束**：physical_op 类型 + 不可逆（如开锁/点火）必须 Tier 0，F011 星星罐子可拦截。
- **配置驱动约束**：Tier 操作映射、恢复动作、magic_word_guard 外置 YAML。

### 1.3 架构影响

- **对 F021 副作用 WAL**：WAL pending entry 是 Tier 分级的输入，按 Tier 决定 replay/rollback/硬拒。
- **对 F011 Magic Words**：Tier 0/4 操作在 dispatch 前可被 F011 星星罐子拦截。
- **对 F023 liveness 规范读模型**：Tier 分级恢复结果影响 liveness 状态（恢复成功转 alive / 失败转 zombie）。
- **对 F024 强 workflow**：强 workflow 的 rejectable 步骤对应 Tier 0/4，replayable 步骤对应 Tier 1/2。
- **对 F029 物理 AI 传感器接入**：physical_op 必须 Tier 0，是可进化智能体物理世界保护的承载。

---

## 2. 架构设计

### 2.1 组件架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 上层调用方                                                           │
│  F021 WalReplayer  F024 StrongWorkflowEngine  F029 PhysicalSensors │
└──────────┬──────────────────────────────────────────────────────────┘
           │ list_pending / classify / execute
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L2: TierClassifier + RecoveryExecutor（五级分级 + 恢复执行）         │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Tier 0: physical_op + 不可逆 → hard_reject + F011 拦截     │  │
│  │ Tier 1: file_read/build/test/lint → auto_replay            │  │
│  │ Tier 2: worktree/sandbox/probe → probe_then_replay         │  │
│  │ Tier 3: shared_file/external_service/github_write → card    │  │
│  │ Tier 4: force_push/merge/release → hard_reject + operator  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───┬─────────────────────────────────────────────────────────────────┘
    │ classify                │ execute
    ▼                         ▼
┌──────────────────┐   ┌──────────────────────────────────────┐
│TierClassifier    │   │ RecoveryExecutor                     │
│（按 effect_type +│   │  auto_replay / probe_then_replay     │
│  payload 分级）  │   │  issue_recovery_card / hard_reject   │
└──────────────────┘   └──────────┬───────────────────────────┘
                                  │
                                  ▼
                       ┌──────────────────────────────┐
                       │ F011 MagicWords Guard        │
                       │  星星罐子拦截 Tier 0/4       │
                       └──────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：五级分级而非四级**。在 roleagent.md 第 6 章 Tier 1-4 基础上扩展 Tier 0（物理世界不可逆），可进化智能体（Forgekin）场景下 physical_op 不可逆（如开锁/点火）必须 Tier 0。理由：FR-004 要求物理世界不可逆操作永不自动恢复。
- **决策 2：Tier 0/4 在 dispatch 前硬拒**。Tier 0/4 操作不进入自动重试路径，必须在 dispatch 阶段被硬拒，必须 operator 显式批准。理由：自动重试不可逆操作可能造成不可逆损害。
- **决策 3：Tier 1 自动重放**。file_read/build/test/lint 无副作用或副作用可重建，直接 replay WAL entry。理由：低风险失败不需要 operator 注意力，浪费注意力是架构债务。
- **决策 4：Tier 2 探测后重放**。worktree/sandbox 操作先探测环境可用性（如 worktree 是否还存在），探测成功后 replay，失败转 Tier 3。理由：探测成本低，可避免盲目重放。
- **决策 5：Tier 3 恢复卡机制**。shared_file/external_service/github_write 不自动恢复，创建恢复卡交 operator。理由：这些操作涉及外部状态，自动恢复可能造成不一致，operator 决策更可靠。
- **决策 6：F011 星星罐子拦截**。Tier 0/4 在 dispatch 前可被 F011 Magic Words "星星罐子"拦截。理由：roleagent.md 第 6 章 + F011 逃生舱要求，给Forgekin一个"停下来想想"的机会。
- **决策 7：分级映射从配置加载**。SideEffectType → Tier 映射表外置 YAML，禁止代码硬编码。理由：分级策略可能随业务演进调整，配置驱动可热更新。

### 2.3 架构不变量

- 所有 SideEffectType 必须映射到 Tier 0-4 之一，必须无未分级操作。
- Tier 0/4 操作必须在 dispatch 前硬拒，必须不进入自动重试路径。
- Tier 0 physical_op + 不可逆操作必须 F011 星星罐子可拦截。
- Tier 2 探测失败必须转 Tier 3，必须不直接 hard_reject。
- Tier 3 必须创建恢复卡交 operator，必须不自动 replay。
- Tier 分级映射必须从配置加载，必须禁止代码硬编码。

---

## 3. 模块设计

### 3.1 模块边界

| 模块 | 路径 | 职责 | 对外暴露 |
|------|------|------|---------|
| TierClassifier | `flowforge/core/reliability/tier/classifier.py` | 按 effect_type + payload 分级 | `classify` |
| RecoveryExecutor | `flowforge/core/reliability/tier/executor.py` | 按 Tier 执行恢复 | `auto_replay / probe_then_replay / issue_recovery_card / hard_reject` |
| RecoveryCardIssuer | `flowforge/core/reliability/tier/card.py` | 创建恢复卡交 operator | `issue_card` |
| ProbeChecker | `flowforge/core/reliability/tier/probe.py` | Tier 2 探测环境可用性 | `probe_environment` |
| MagicWordsGuard | `flowforge/core/reliability/tier/magic_words.py` | F011 星星罐子拦截 Tier 0/4 | `intercept` |
| TierConfigLoader | `flowforge/core/reliability/tier/config.py` | YAML 配置加载 | `load_tier_config` |

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional, Literal
from datetime import datetime
from pydantic import BaseModel
from enum import Enum


class RecoveryTier(str, Enum):
    TIER_0 = "tier_0"  # 物理世界不可逆（永不自动恢复，FR-004）
    TIER_1 = "tier_1"  # 读取/构建/测试/lint（始终自动恢复）
    TIER_2 = "tier_2"  # 沙箱/worktree/可确定性探测（探测成功后自动恢复）
    TIER_3 = "tier_3"  # 共享文件/外部服务/GitHub 写（不自动恢复，出恢复卡）
    TIER_4 = "tier_4"  # force-push/merge/release（永不自动恢复，dispatch 前硬拒）


class RecoveryAction(str, Enum):
    AUTO_REPLAY = "auto_replay"
    PROBE_THEN_REPLAY = "probe_then_replay"
    ISSUE_RECOVERY_CARD = "issue_recovery_card"
    HARD_REJECT = "hard_reject"


class RecoveryDecision(BaseModel):
    wal_entry_id: str
    tier: RecoveryTier
    action: RecoveryAction
    probed_ok: Optional[bool] = None
    decided_at: datetime
    rationale: str


class RecoveryCard(BaseModel):
    card_id: str
    wal_entry_id: str
    tier: RecoveryTier
    forgekin_id: str
    description: str
    suggested_actions: list[str]
    issued_at: datetime
    resolved_at: Optional[datetime] = None


class TierClassifier(ABC):
    @abstractmethod
    def classify(self, wal_entry) -> RecoveryTier:
        """
        按 effect_type + payload 分级：
        - physical_op + 不可逆 → TIER_0
        - file_read/build/test/lint → TIER_1
        - worktree/sandbox/probe → TIER_2
        - shared_file/external_service/github_write → TIER_3
        - force_push/merge/release → TIER_4
        分级映射从配置加载
        """


class RecoveryExecutor(ABC):
    @abstractmethod
    async def auto_replay(self, entry_id: str) -> None:
        """Tier 1 自动重放"""

    @abstractmethod
    async def probe_then_replay(self, entry_id: str) -> None:
        """Tier 2 探测后重放；探测失败转 Tier 3"""

    @abstractmethod
    async def issue_recovery_card(self, entry_id: str) -> str:
        """Tier 3 创建恢复卡交 operator"""

    @abstractmethod
    async def hard_reject(self, entry_id: str, reason: str) -> None:
        """Tier 0/4 硬拒；必须 operator 显式批准才放行"""


class MagicWordsGuard(ABC):
    @abstractmethod
    async def intercept(self, entry_id: str, tier: RecoveryTier) -> bool:
        """
        F011 星星罐子拦截 Tier 0/4
        返回 True 表示拦截成功（不执行）
        返回 False 表示放行
        """
```

### 3.3 数据流

```
[重启恢复路径]
  F021 WalReplayer.list_pending → pending entries
        │
        ▼
  TierClassifier.classify(wal_entry)
        │
        ├─ physical_op + 不可逆 → TIER_0
        ├─ file_read/build/test/lint → TIER_1
        ├─ worktree/sandbox/probe → TIER_2
        ├─ shared_file/external_service/github_write → TIER_3
        └─ force_push/merge/release → TIER_4
        │
        ▼
  RecoveryExecutor 按 Tier 执行
        │
        ├─ TIER_0 → MagicWordsGuard.intercept → hard_reject
        │            （F011 星星罐子可拦截）
        ├─ TIER_1 → auto_replay(entry_id)
        │            （直接重放 WAL entry）
        ├─ TIER_2 → ProbeChecker.probe_environment(entry_id)
        │            ├─ 探测成功 → replay
        │            └─ 探测失败 → 转 TIER_3 issue_recovery_card
        ├─ TIER_3 → RecoveryCardIssuer.issue_card(entry_id)
        │            （创建恢复卡交 operator）
        └─ TIER_4 → MagicWordsGuard.intercept → hard_reject
                     （必须 operator 显式批准）

[dispatch 前拦截路径]
  Forgekin.act 触发 Tier 0/4 副作用
        │
        ▼
  MagicWordsGuard.intercept(entry_id, tier)
        │
        ├─ F011 "星星罐子" 逃生舱检查
        │
        ▼
  返回 True（拦截）→ 不执行，等待 operator 批准
  返回 False（放行）→ 继续 dispatch

[恢复卡处理路径]
  Tier 3 创建恢复卡
        │
        ▼
  RecoveryCard 派发给 operator
        │
        ▼
  operator 决策：
   ├─ 手动 replay
   ├─ 手动 rollback
   └─ 放弃（标记 resolved）
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- 依赖 **F021 副作用 WAL**：WAL pending entry 是 Tier 分级的输入。
- 依赖 **F011 Magic Words**：Tier 0/4 操作可被 F011 星星罐子拦截。

### 4.2 下游影响

- 影响 **F023 liveness 规范读模型**：Tier 分级恢复结果影响 liveness 状态（恢复成功转 alive / 失败转 zombie）。
- 影响 **F024 强 workflow**：强 workflow 的 rejectable 步骤对应 Tier 0/4，replayable 步骤对应 Tier 1/2。
- 影响 **F025 跨 provider 宿主抽象**：provider failover 时 Tier 分级决定副作用恢复策略。
- 影响 **F029 物理 AI 传感器接入**：physical_op 必须 Tier 0，是物理世界保护的承载。
- 影响 **F040 控制面**：Tier 分级恢复事件写入 F040 Eval Hub。

### 4.3 跨模块不变量

- 所有 SideEffectType 必须映射到 Tier 0-4 之一，必须无未分级操作。
- Tier 0/4 必须 dispatch 前硬拒，必须不进入自动重试路径。
- Tier 2 探测失败必须转 Tier 3，必须不直接 hard_reject。
- Tier 3 必须创建恢复卡交 operator，必须不自动 replay。
- Tier 0 physical_op + 不可逆必须 F011 星星罐子可拦截。
- Tier 分级映射必须从配置加载，必须禁止代码硬编码。

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: 单向依赖通过——`flowforge/core/reliability/tier/` 不 import F021/F023/F024/F025/F011/F029/F040 任何模块。
- [ ] AC-2: DI 容器注入通过——`RecoveryExecutor` 通过 `inject("recovery_executor")` 获取。
- [ ] AC-3: Repository 层通过——恢复卡持久化经 Repository，不直操作数据库。
- [ ] AC-4: 配置驱动通过——Tier 操作映射 / 恢复动作 / magic_word_guard 从 `config/tier_recovery.yaml` 加载。
- [ ] AC-5: 所有 SideEffectType（6 种）均有 Tier 分级映射（单测覆盖）。

### 5.2 架构不变量验收

- [ ] AC-6: Tier 1 操作失败时自动 replay（单测覆盖）。
- [ ] AC-7: Tier 2 探测成功后 replay，探测失败转 Tier 3（单测覆盖）。
- [ ] AC-8: Tier 3 创建恢复卡，不自动 replay（单测覆盖）。
- [ ] AC-9: Tier 4 dispatch 前硬拒，必须 operator 批准才放行（单测覆盖）。
- [ ] AC-10: Tier 0 physical_op + 不可逆操作 F011 星星罐子可拦截（集成测试覆盖）。
- [ ] AC-11: Tier 分级映射从配置加载，代码中无硬编码 effect_type → tier 映射（静态扫描确认）。

---

## 6. 引用

- [doc:../spec.md#§3.6]
- [doc:../arch.md#§3.6]
- [doc:../features/F011-magic-words.md]
- [doc:../features/F021-side-effect-wal.md]
- [doc:../features/F022-tier-1-4-recovery.md]
- [doc:../features/F023-liveness-canonical-read.md]
- [doc:../features/F024-weak-state-vs-strong-workflow.md]
- [doc:../features/F025-provider-host-abstraction.md]
- [doc:../features/F029-physical-ai-sensors.md]
- [doc:../decisions/010-distributed-reliability.md]
- [doc:../../../hiclaw/rules.md#第十一部分]
- [doc:../../../hiclaw/rules.md#编程红线]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架 + 五级分级 + Tier 0 物理硬拒 + F011 星星罐子联动） | 架构师 Forgekin（猫头鹰·鲁班） |

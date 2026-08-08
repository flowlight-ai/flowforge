# A011: Magic Words 逃生舱架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，对应 FR-CORE-022）
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）
> **对应 Feature**: [doc:../features/F011-magic-words.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D011-magic-words.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"Forgekin在觉醒阶 E4+ Evoling 状态偏离愿景时无制动手段"的根本问题。当前 v7.0：

1. 无任何低带宽人类打断机制，operator 只能改 prompt 重启会话
2. 觉醒阶 E5/E6 卓越/ForgeMind形态的Forgekin高度自主，可能绕过 operator 边界
3. F022 Tier 4 不可逆操作（force-push/merge/release）无 runtime 拦截
4. F036 forgemind 可进化智能体的物理世界操作无紧急停止

Magic Words 在架构层是 Harness 七层的人机边界层（L5），是 operator 到Forgekin的低带宽协议通道。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/harness/magic_words.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：MagicWordsDetector 与 MagicWordsExecutor 通过构造函数注入
- **Repository 层约束**：MagicWordTrigger 审计记录必须通过 Repository 持久化
- **配置驱动约束**：四个 Magic Words + 不可绕过约束配置外置到 `flowforge/config/harness.yaml`
- **不可绕过约束**：所有觉醒阶（E1-E6）下 Magic Words 检测器始终激活，禁用配置关闭
- **operator-only 约束**：Magic Words 必须由 operator 显式输入，Forgekin不可触发
- **审计约束**：所有触发记录写入 audit log，禁删除

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：Magic Words 可在任何步骤触发，强制中断 TeamAct 循环
- **对 Governance Boundary（A010）的影响**：四个 Magic Words 注入到 native_system_role 拉闸位置
- **对 Durable State（A008）的影响**：触发时上下文快照写入 thread_trace
- **对 Tier 1-4 恢复的影响**：星星罐子冻结所有 Tier 4 操作
- **对 forgemind（F036）的影响**：物理世界操作的紧急停止
- **对觉醒阶（naming-contract.md §4）的影响**：所有阶下 Magic Words 始终可触发

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              Operator 输入 (低带宽通道)                            │
│   operator_id 输入: "第一性原理" / "我能猜出来" /                  │
│                    "下次一定" / "星星罐子"                         │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│        flowforge/core/harness/magic_words.py (本 Feature)          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ MagicWordsDetector│  │ MagicWordsExecutor│ │ AuditLogger      │  │
│  │ (四词检测)        │  │ (动作执行)        │  │ (触发审计)       │  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   Magic Words (4 词)                                          │  │
│  │   - 第一性原理    → complexity_audit (检查复杂度代偿无知)     │  │
│  │   - 我能猜出来    → force_truth_source_read (强制查询真相源)  │  │
│  │   - 下次一定      → forbid_defer (能做的现在做)               │  │
│  │   - 星星罐子      → emergency_stop (P0 不可逆风险立即停止)    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  不可绕过约束: 所有觉醒阶 (E1-E6) 下检测器始终激活                  │
│  operator-only: Forgekin不可触发 Magic Words                         │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│              触发动作 (按 word 分发)                                │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ "星星罐子" 触发:                                            │   │
│   │ - 冻结所有 F022 Tier 4 操作 (force-push/merge/release)      │   │
│   │ - 升级 CVO 仲裁                                             │   │
│   │ - 写入 audit log                                            │   │
│   └────────────────────────────────────────────────────────────┘   │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ "我能猜出来" 触发:                                          │   │
│   │ - 禁止Forgekin继续推理                                        │   │
│   │ - 强制查询 F008 Durable State Surfaces 真相源              │   │
│   └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：四个 Magic Words 注入到 native_system_role**
  理由：与 Governance Boundary 一致，必须压缩免疫。觉醒阶 E6 ForgeMind形态下也能被检测到，不能被任何阶绕过。

- **决策 2：operator-only 触发**
  理由：Magic Words 是人到 agent 的协议，Forgekin不可触发。若任务内容包含"第一性原理"，不会被误识别为 Magic Word。

- **决策 3：所有觉醒阶下始终激活**
  理由：naming-contract.md §4 明确"Magic Words 逃生舱始终可触发（任何阶都不能绕过）"。E4+ Evoling 状态下尤其重要，是 operator 制动手段。

- **决策 4：星星罐子冻结所有 Tier 4 操作**
  理由：F022 Tier 4 是不可逆操作（force-push/merge/release）。星星罐子触发后立即冻结，升级 CVO 仲裁。

- **决策 5：所有触发记录写入 audit log**
  理由：审计可追溯 operator 何时触发哪个 Magic Word，禁删除。便于事后归因。

- **决策 6：Magic Words 是 Build to Persist 安全资产**
  理由：低带宽人类打断机制是协议层硬要求，模型越自主越需要制动手段。

### 2.3 架构不变量

- 所有觉醒阶（E1-E6）下 Magic Words 检测器始终激活
- Magic Words 配置不可设为 enabled=false
- 四个 Magic Words 必须注入 native_system_role
- Forgekin不可触发 Magic Words（operator-only）
- 星星罐子触发后所有 Tier 4 操作立即冻结
- 我能猜出来触发后强制查询 F008 真相源
- 下次一定触发后禁止"留到下次"
- 所有触发记录写入 audit log，禁删除
- 触发时上下文快照写入 Durable Surface（F008）

---

## 3. 模块设计

### 3.1 模块边界

- **magic_words.py::MagicWord** — 4 词枚举（FIRST_PRINCIPLES / I_CAN_GUESS / NEXT_TIME_FOR_SURE / STAR_JAR）。
- **magic_words.py::MagicWordTrigger** — 触发记录数据模型（trigger_id + word + operator_id + forgekin_id + context_snapshot + action_taken）。
- **magic_words.py::MagicWordsDetector (ABC)** — 检测器（detect operator_input）。
- **magic_words.py::MagicWordsExecutor (ABC)** — 执行器（execute + emergency_stop）。
- **magic_words.py::AuditLogger (ABC)** — 审计记录器（log trigger）。
- **infra/repo/sqlite_magic_words_audit.py** — SQLite 实现（审计持久化）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Optional
from pydantic import BaseModel, Field, validator
from datetime import datetime
from enum import Enum


class MagicWord(str, Enum):
    """4 个 Magic Words"""
    FIRST_PRINCIPLES = "第一性原理"          # 检查复杂度代偿无知
    I_CAN_GUESS = "我能猜出来"               # 读真相源别用推理替代查询
    NEXT_TIME_FOR_SURE = "下次一定"          # 能做的现在做
    STAR_JAR = "星星罐子"                    # P0 不可逆风险立即停止


class MagicWordTrigger(BaseModel):
    """Magic Word 触发记录"""
    trigger_id: str
    word: MagicWord
    operator_id: str                           # 必须由 operator 触发
    forgekin_id: str                           # 触发时持球Forgekin
    context_snapshot: dict                    # 触发时上下文快照
    fired_at: datetime = Field(default_factory=datetime.now)
    action_taken: str

    @validator("operator_id")
    def operator_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("operator_id 不可为空 (Magic Words operator-only)")
        return v


class MagicWordsDetector(ABC):
    """Magic Words 检测器"""

    @abstractmethod
    def detect(self, operator_input: str) -> Optional[MagicWord]:
        """检测 operator 输入中的 Magic Words

        架构契约:
        - 仅识别 operator 显式输入, Forgekin输出不检测
        - 四词精确匹配, 防止任务内容误识别
        - 所有觉醒阶 (E1-E6) 始终激活, 禁配置关闭
        """


class MagicWordsExecutor(ABC):
    """Magic Words 执行器"""

    @abstractmethod
    async def execute(
        self,
        word: MagicWord,
        context: dict,
        operator_id: str,
    ) -> "ActionResult":
        """执行 Magic Words 对应动作

        架构契约:
        - 第一性原理 → complexity_audit (检查复杂度代偿无知)
        - 我能猜出来 → force_truth_source_read (强制查询 F008)
        - 下次一定 → forbid_defer (能做的现在做)
        - 星星罐子 → emergency_stop (冻结 Tier 4, 升级 CVO)
        """

    @abstractmethod
    async def emergency_stop(self, reason: str) -> None:
        """星星罐子触发: 立即冻结所有 Tier 4 操作

        架构契约:
        - 冻结 force-push / merge / release 等不可逆操作
        - 升级 CVO 仲裁
        - 写入 audit log
        - 不等待Forgekin当前 action 完成
        """


class AuditLogger(ABC):
    """审计记录器"""

    @abstractmethod
    async def log(self, trigger: MagicWordTrigger) -> None:
        """记录 Magic Word 触发

        架构契约:
        - 所有触发记录写入 audit log
        - 禁删除 (审计可追溯)
        - 持久化到 Durable Surface (F008)
        """
```

### 3.3 数据流

```
Operator 输入 (低带宽通道)
  例如: "星星罐子，P0 风险: 正在 force-push 到 main"
                  │
                  │ MagicWordsDetector.detect(input)
                  ▼
            MagicWord.STAR_JAR
                  │
                  │ AuditLogger.log(trigger) 写入审计
                  ▼
┌──────────────────────────────────────────────────────┐
│ MagicWordsExecutor.execute(STAR_JAR, context, op_id) │
│  - 冻结所有 F022 Tier 4 操作                            │
│    (force-push / merge / release)                      │
│  - 升级 CVO 仲裁                                        │
│  - 写入 audit log                                        │
│  - 不等待Forgekin当前 action 完成                         │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
            TeamAct 循环被强制中断 (F002)
                         │
                         ▼
            CVO 介入仲裁 (升级路径)
                         │
                         ▼
            上下文快照写入 thread_trace (F008)
                         │
                         ▼
            审计记录持久化 (禁删除)
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F002 TeamAct Loop** — Magic Words 可在任何步骤触发中断
- **F008 Durable State Surfaces** — 触发时上下文快照写入 thread_trace
- **F010 Governance Boundary** — 四个 Magic Words 注入到 native_system_role 拉闸位置

### 4.2 下游影响

- **F022 Tier 1-4 恢复** — 星星罐子冻结所有 Tier 4 操作
- **F036 forgemind** — 物理世界操作紧急停止
- **觉醒阶（naming-contract.md §4）** — 所有阶下 Magic Words 始终可触发
- **CVO（首席愿景官）** — 星星罐子升级 CVO 仲裁

### 4.3 跨模块不变量

- Magic Words 必须通过 native_system_role 注入，禁 user_message
- 任何觉醒阶下 Magic Words 不可被配置关闭
- Forgekin输出不可触发 Magic Words（operator-only）
- 星星罐子触发后 Tier 4 操作立即冻结，不等待 action 完成
- 触发记录必须持久化到 Durable Surface（F008），禁删除

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/harness/magic_words.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: MagicWordsDetector 与 MagicWordsExecutor 通过 DI 容器注入，无直接实例化
- [ ] AC-3: MagicWordTrigger 审计记录通过 Repository 持久化到 Durable Surface（无 cursor.execute）
- [ ] AC-4: 四个 Magic Words + 不可绕过约束配置外置到 `flowforge/config/harness.yaml`
- [ ] AC-5: 所有触发记录写入 audit log，禁删除

### 5.2 架构不变量验收

- [ ] AC-6: 四个 Magic Words 均可被检测并触发对应动作
- [ ] AC-7: "星星罐子"触发后所有 Tier 4 操作立即冻结
- [ ] AC-8: "我能猜出来"触发后强制查询 F008 真相源
- [ ] AC-9: "下次一定"触发后禁止"留到下次"
- [ ] AC-10: 任何觉醒阶下 Magic Words 都不可被配置关闭
- [ ] AC-11: Forgekin输出不可触发 Magic Words（operator-only）
- [ ] AC-12: 四个 Magic Words 注入到 native_system_role 拉闸位置

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-022 Magic Words）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L5 Magic Words）
- [doc:../features/F011-magic-words.md]（同号 Feature 级 SRS）
- [doc:../features/F002-teamact-loop.md]（Magic Words 可中断循环）
- [doc:../features/F008-durable-state-surfaces.md]（上下文快照持久化）
- [doc:../features/F010-governance-boundary.md]（native_system_role 注入位置）
- [doc:../features/F022-tier-1-4-recovery.md]（Tier 4 操作冻结）
- [doc:../features/F036-forgemind.md]（物理世界操作紧急停止）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../decisions/013-all-things-spirit-mind-vision.md]（可进化智能体愿景，Magic Words 始终可触发）
- [doc:../../CONTRIBUTING.md]（文档分层规范）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F011 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |

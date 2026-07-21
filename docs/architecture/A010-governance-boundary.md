# A010: Governance Boundary 压缩免疫架构设计

> **状态**: ⏳ pending
> **创建日期**: 2026-07-19
> **负责人**: 架构师 Forgekin（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.3]（FR-CORE-003，对应 FR-CORE-021）
> **对应 arch.md**: [doc:../arch.md#§3.3]
> **对应 design.md**: [doc:../design.md#§3.3]（待创建）
> **对应 Feature**: [doc:../features/F010-governance-boundary.md]（同号 Feature 级 SRS）
> **对应详细设计**: [doc:../design/D010-governance-boundary.md]（待创建，同号 Feature 级 SDD）
> **依赖 ADR**: [doc:../decisions/007-harness-engineering.md]

---

## 1. 架构上下文

### 1.1 架构问题

FlowForge 在架构层需要解决"治理规则被上下文压缩吞掉"的根本问题。当前 v7.0 治理规则通过 user message prepend 注入：

1. 上下文压缩时，治理规则被截断丢失，Forgekin后半段突然违规
2. 没有区分硬约束（guardrails）与默认行为（defaults），所有规则一视同仁注入
3. Forgekin可覆盖硬约束（如自己决定"这次不写测试"），违反 operator 安全治理要求
4. 治理规则无版本化，规则变更不走 ADR 流程

Governance Boundary 在架构层是 Harness 七层的约束层（L4），是 Magic Words 拉闸词注入的位置，是严肃操作红线的承载载体。

### 1.2 架构约束

- **单向依赖约束**：`flowforge/core/harness/governance.py` 不可 import forgemind 或 *Forge 模块
- **DI 容器约束**：GovernanceInjector 与 GovernanceValidator 通过构造函数注入
- **Repository 层约束**：GovernanceBundle 必须通过 Repository 持久化到 Durable Surface（F008）
- **配置驱动约束**：hard_rules / soft_rules / forbidden_layers 配置外置到 `flowforge/config/harness.yaml`
- **压缩免疫约束**：hard 规则强制注入 native_system_role，禁用 user_message_prepend
- **不可放宽约束**：guardrails 轨只能加严（monotonic tightening），不可放宽
- **规则版本化约束**：GovernanceBundle 带版本号，规则变更走 ADR 流程

### 1.3 架构影响

- **对 TeamAct（A002）的影响**：治理规则约束 ACTION 步，决定哪些操作允许执行
- **对 Durable State（A008）的影响**：GovernanceBundle 是 task_queue/thread_trace 之一，compression_immune 属性来源
- **对 Evidence & Sensors（A009）的影响**：治理规则是 quality_gate 证据的判据
- **对 Magic Words（A011）的影响**：四个 Magic Words 注入到 native_system_role 拉闸位置
- **对 Entropy Control（A012）的影响**：guardrail 失效可降级为 default，触发 sunset review
- **对 Tier 1-4 恢复的影响**：严肃操作红线注入压缩免疫层，不可被压缩吞掉

---

## 2. 架构设计

### 2.1 组件架构图

```
┌────────────────────────────────────────────────────────────────────┐
│              Operator 治理规则定义 (YAML 外置)                      │
│   flowforge/config/harness.yaml:                                  │
│     hard_rules (guardrails) + soft_rules (defaults)              │
└────────────────────────────────┬───────────────────────────────────┘
                                 │ 加载
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│         flowforge/core/harness/governance.py (本 Feature)          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ GovernanceLoader │  │ GovernanceInjector│ │ GovernanceValidator│  │
│  │ (YAML 加载)      │  │ (注入压缩免疫层)  │  │ (禁 user_message)│  │
│  └─────────┬────────┘  └─────────┬────────┘  └────────┬────────┘  │
│            │                     │                    │           │
│            ▼                     ▼                    ▼           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │   DualTrackPolicy (双轨信任编译, CL-019)                      │  │
│  │   - guardrails (硬约束, 只能加严)                             │  │
│  │   - defaults (默认行为, 可覆盖)                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│            │                     │                                │
│            ▼                     ▼                                │
│  ┌──────────────────┐  ┌──────────────────┐                       │
│  │ hard → native_    │  │ soft → developer_ │                       │
│  │ system_role       │  │ role             │                       │
│  │ (压缩免疫)        │  │ (developer 注入) │                       │
│  └──────────────────┘  └──────────────────┘                       │
│                                                                     │
│  禁止: user_message_prepend 注入治理规则                            │
└────────────────────────────────┬───────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│         ForgekinHost Forgekin构造时注入 (见 ADR 001)                 │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ GovernanceValidator.validate(session)                     │   │
│   │ - 治理规则出现在 user_message → 告警                        │   │
│   │ - hard 规则未注入 native_system_role → 拒绝构造             │   │
│   │ - 规则变更未走 ADR → 拒绝部署                                │   │
│   └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

- **决策 1：硬约束必须注入 native_system_role**
  理由：roleagent.md 明确治理规则不能通过 user message prepend 注入，会被上下文压缩吞掉。system role 注入由 ForgekinHost 在Forgekin构造时统一注入，是协议层硬要求。

- **决策 2：双轨信任编译（guardrails + defaults）**
  理由：参考 ADR-021-pack-system 的双轨设计。guardrails 轨只能加严不可放宽（如"禁止删除测试用例"），Forgekin不可覆盖；defaults 轨可覆盖（如"优先用 pytest"），Forgekin可声明覆盖。

- **决策 3：治理规则文本必须外置到 YAML**
  理由：编程红线第 11 条明确禁止硬编码提示词/路径/密钥/端口。治理规则文本外置便于版本管理与 ADR 审计。

- **决策 4：GovernanceBundle 版本化 + ADR 流程**
  理由：规则变更必须走 ADR 流程，禁直接改文本。版本号让审计可追溯哪一版本规则注入了哪只Forgekin。

- **决策 5：audit 发现 user_message 治理规则时告警**
  理由：定期 audit session context，发现治理规则出现在 user_message 即告警。防止 v4.0 残留代码绕过新架构。

- **决策 6：Governance 是 Build to Persist 资产**
  理由：治理规则编码协作协议与操作红线，是复利型基础设施，模型越强越需要明确边界。

### 2.3 架构不变量

- hard 规则必须注入 native_system_role，禁 user_message_prepend
- guardrails 轨只能加严（monotonic tightening），不可被Forgekin覆盖
- defaults 轨可被Forgekin声明覆盖
- 治理规则文本必须外置 YAML，禁硬编码
- GovernanceBundle 带版本号，规则变更走 ADR 流程
- 上下文压缩后治理规则仍在 session 生效（compression_immune=true）
- audit 发现 user_message 治理规则时告警
- forbidden_layers 必须包含 user_message_prepend

---

## 3. 模块设计

### 3.1 模块边界

- **governance.py::GovernanceRule** — 单条治理规则数据模型（rule_id + text + authority + injection_layer + compression_immune）。
- **governance.py::DualTrackPolicy** — 双轨信任编译（guardrails + defaults）。
- **governance.py::GovernanceBundle** — 规则包（带版本号 + injected_at + injection_layer）。
- **governance.py::GovernanceLoader** — YAML 加载器（load + validate schema）。
- **governance.py::GovernanceInjector (ABC)** — 注入器（inject_hard + inject_soft）。
- **governance.py::GovernanceValidator (ABC)** — 校验器（validate session + audit）。
- **infra/repo/sqlite_governance_store.py** — SQLite 实现（持久化 GovernanceBundle）。
- **tests/** — 单元 + 集成 + E2E（T1-T8 铁律）。

### 3.2 接口契约

```python
from abc import ABC, abstractmethod
from typing import Literal
from pydantic import BaseModel, Field, validator
from datetime import datetime


class GovernanceRule(BaseModel):
    """单条治理规则"""
    rule_id: str
    rule_text: str                                   # 必须非空
    authority: Literal["hard", "soft"]               # 硬约束 vs 默认行为
    injection_layer: Literal[
        "native_system_role", "developer_role", "user_message"
    ]
    compression_immune: bool                         # 必须为 true（除非 soft + user_message）
    applies_to: list[str] = Field(default_factory=list)  # 适用的Forgekin类型/角色
    version: str                                     # 规则版本号

    @validator("rule_text")
    def text_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip:
            raise ValueError("GovernanceRule rule_text 不可为空")
        return v

    @validator("compression_immune")
    def hard_must_be_compression_immune(cls, v: bool, values) -> bool:
        if values.get("authority") == "hard" and not v:
            raise ValueError("hard 规则必须 compression_immune=true")
        return v

    @validator("injection_layer")
    def hard_must_inject_native_system_role(cls, v: str, values) -> str:
        if (
            values.get("authority") == "hard"
            and v != "native_system_role"
        ):
            raise ValueError("hard 规则必须注入 native_system_role")
        return v


class DualTrackPolicy(BaseModel):
    """双轨信任编译 (CL-019)"""
    guardrails: list[GovernanceRule]                  # 硬约束，只能加严
    defaults: list[GovernanceRule]                    # 默认行为，可覆盖

    def tighten_guardrail(self, rule: GovernanceRule) -> None:
        """guardrail 加严：新增或加严已有规则"""
        if rule.authority != "hard":
            raise ValueError("guardrail 必须 authority=hard")

    def override_default(self, rule_id: str, override_text: str) -> None:
        """default 覆盖：Forgekin声明覆盖默认行为"""
        pass  # 仅 defaults 轨可覆盖


class GovernanceBundle(BaseModel):
    """治理规则包（带版本号）"""
    bundle_id: str
    rules: list[GovernanceRule]
    injected_at: datetime = Field(default_factory=datetime.now)
    injection_layer: str
    version: str


class GovernanceLoader(ABC):
    """YAML 加载器"""

    @abstractmethod
    async def load(self, config_path: str) -> GovernanceBundle:
        """从 YAML 加载治理规则包

        架构契约:
        - hard_rules 必须注入 native_system_role
        - soft_rules 可注入 developer_role
        - forbidden_layers 必须包含 user_message_prepend
        - 规则变更必须带版本号
        """


class GovernanceInjector(ABC):
    """治理规则注入器"""

    @abstractmethod
    async def inject_hard(self, rules: list[GovernanceRule]) -> None:
        """注入 hard 规则到 native_system_role

        架构契约:
        - 所有 hard 规则必须 compression_immune=true
        - 注入位置: native_system_role (禁 user_message)
        - 由 ForgekinHost 在Forgekin构造时调用
        """

    @abstractmethod
    async def inject_soft(self, rules: list[GovernanceRule]) -> None:
        """注入 soft 规则到 developer_role"""


class GovernanceValidator(ABC):
    """治理规则校验器"""

    @abstractmethod
    async def validate(self, session: "SessionContext") -> "ValidationResult":
        """校验治理规则不在 user_message_prepend

        架构契约:
        - 治理规则出现在 user_message → 告警
        - hard 规则未注入 native_system_role → 拒绝构造
        - 规则变更未走 ADR → 拒绝部署
        - 上下文压缩后规则仍生效 (compression_immune)
        """
```

### 3.3 数据流

```
Operator 编写治理规则 YAML (flowforge/config/harness.yaml)
                  │
                  │ GovernanceLoader.load(path)
                  ▼
            GovernanceBundle (带版本号)
                  │
                  │ 拆分 hard / soft
                  ▼
┌──────────────────────────────────────────────────────┐
│ DualTrackPolicy                                       │
│  - guardrails (hard, 只能加严)                        │
│  - defaults (soft, 可覆盖)                            │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│ GovernanceInjector                                    │
│  - inject_hard → native_system_role (压缩免疫)       │
│  - inject_soft → developer_role                       │
│  - 禁: user_message_prepend                           │
└────────────────────────┬─────────────────────────────┘
                         │
                         ▼
         ForgekinHost 在Forgekin构造时注入 (ADR 001)
                         │
                         ▼
┌──────────────────────────────────────────────────────┐
│ GovernanceValidator.validate(session)                 │
│  - 治理规则在 user_message? → 告警                     │
│  - hard 未注入 native_system_role? → 拒绝构造         │
│  - 规则变更未走 ADR? → 拒绝部署                       │
└────────────────────────┬─────────────────────────────┘
                         │ 校验通过
                         ▼
            Forgekin可被构造并注入治理规则
                         │
                         ▼
         上下文压缩发生 (native_system_role 保留)
                         │
                         ▼
            治理规则仍约束Forgekin行为 (compression_immune)
```

---

## 4. 跨模块协作

### 4.1 上游依赖

- **F008 Durable State Surfaces** — GovernanceBundle 持久化到 task_queue / thread_trace，compression_immune 属性来源
- **F002 TeamAct Loop** — ACTION 步受治理规则约束
- **ForgekinHost（ADR 001）** — 在Forgekin构造时统一注入治理规则

### 4.2 下游影响

- **F009 Evidence & Sensors** — 治理规则是 quality_gate 证据的判据
- **F011 Magic Words** — 四个 Magic Words 注入到 native_system_role 拉闸位置
- **F012 Entropy Control** — guardrail 失效可降级为 default，触发 sunset review
- **F022 Tier 1-4 恢复** — 严肃操作红线注入压缩免疫层
- **F036 forgemind** — 可进化智能体的物理世界操作红线

### 4.3 跨模块不变量

- GovernanceBundle 必须持久化到 Durable Surface（F008），不存进程内
- hard 规则必须注入 native_system_role，禁 user_message_prepend
- Magic Words（F011）必须通过 native_system_role 注入拉闸位置
- guardrail 提案需 MindCouncil 审批，需 Replay A/B 验证净增益
- 规则变更必须走 ADR 流程，带版本号

---

## 5. 架构验收

### 5.1 架构契约验收

- [ ] AC-1: `flowforge/core/harness/governance.py` 不 import forgemind 或 *Forge 模块
- [ ] AC-2: GovernanceInjector 与 GovernanceValidator 通过 DI 容器注入，无直接实例化
- [ ] AC-3: GovernanceBundle 通过 Repository 持久化到 Durable Surface（无 cursor.execute）
- [ ] AC-4: hard_rules / soft_rules / forbidden_layers 配置外置到 `flowforge/config/harness.yaml`
- [ ] AC-5: GovernanceBundle 带版本号，规则变更走 ADR 流程

### 5.2 架构不变量验收

- [ ] AC-6: hard 规则全部注入 native_system_role，禁 user_message_prepend
- [ ] AC-7: guardrails 轨只能加严（monotonic tightening），Forgekin不可覆盖
- [ ] AC-8: defaults 轨可被Forgekin声明覆盖（需声明）
- [ ] AC-9: 治理规则文本外置 YAML，无硬编码
- [ ] AC-10: 上下文压缩后治理规则仍在 session 生效（compression_immune=true）
- [ ] AC-11: audit 发现 user_message 治理规则时告警
- [ ] AC-12: forbidden_layers 必须包含 user_message_prepend

---

## 6. 引用

- [doc:../spec.md#§3.3]（FR-CORE-003，FR-CORE-021 Governance Boundary）
- [doc:../arch.md#§3.3]（Harness 七层现实表面，L4 Governance Boundary）
- [doc:../features/F010-governance-boundary.md]（同号 Feature 级 SRS）
- [doc:../features/F008-durable-state-surfaces.md]（compression_immune 属性来源）
- [doc:../features/F009-evidence-sensors.md]（quality_gate 判据）
- [doc:../features/F011-magic-words.md]（拉闸词注入位置）
- [doc:../features/F012-entropy-control.md]（guardrail 降级为 default）
- [doc:../features/F022-tier-1-4-recovery.md]（严肃操作红线）
- [doc:../decisions/007-harness-engineering.md]（Harness 工程路径 ADR）
- [doc:../decisions/001-agent-invocation-approach.md]（ForgekinHost 注入治理规则）
- [doc:../../../hiclaw/rules.md#第十一部分]（文档分层规范）
- [doc:../../../hiclaw/rules.md#红线11]（禁止硬编码提示词）

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.1 | 初始创建（架构骨架，对应 F010 Feature 级 SRS） | 架构师 Forgekin（猫头鹰·鲁班） |

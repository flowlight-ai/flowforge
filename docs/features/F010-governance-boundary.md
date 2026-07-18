# Feature F010: Governance Boundary（治理压缩免疫）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-019] + [doc:roleagent.md#第3章]
> **关联 ADR**: [doc:decisions/007-harness-engineering.md]
> **类型**: harness
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体

---

## 1. 概述（Overview）

Governance Boundary 是 Harness 七层的治理边界层：roleagent.md 第 3 章明确"压缩不理解什么是治理规则：它可能保留最近的代码细节，却压掉协作协议、操作红线、任务交接规则和质量纪律"。本 Feature 把关键治理沉到压缩免疫层（native system role / developer role），禁用 user message prepend 注入治理规则。

这是 Build to Persist 基础设施——治理规则是协作协议的硬约束，模型越强越需要明确边界。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-019]` 指出：v7.0 未把关键治理沉到压缩免疫层（native system role / developer role），仍用 user message prepend 注入治理规则。上下文一压缩，规则就消失，Forgekin 后半段突然违规。

不做这个 Feature，F008 Durable State Surfaces 的压缩免疫属性无内容可承载，F022 Tier 1-4 恢复分级的"严肃操作红线"会被压缩掉，F011 Magic Words 的"星星罐子"拉闸词无处注入。roleagent.md 第 3 章明确治理规则必须压缩免疫。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class GovernanceRule(BaseModel):
    rule_id: str
    rule_text: str                       # 治理规则文本
    authority: Literal["hard", "soft"]   # 硬约束 vs 默认行为
    injection_layer: Literal["native_system_role", "developer_role", "user_message"]
    compression_immune: bool             # 必须为 true（除非 soft + user_message）
    applies_to: list[str]                # 适用的灵智体类型/角色

class GovernanceBundle(BaseModel):
    bundle_id: str
    rules: list[GovernanceRule]
    injected_at: datetime
    injection_layer: str
```

### 3.2 核心接口

```python
class GovernanceInjector:
    """把治理规则注入压缩免疫层"""
    def inject_hard(self, rules: list[GovernanceRule]) -> None: ...
    def inject_soft(self, rules: list[GovernanceRule]) -> None: ...

class GovernanceValidator:
    """校验治理规则不在 user_message prepend"""
    def validate(self, session: SessionContext) -> ValidationResult: ...
```

### 3.3 关键算法

- **注入层选择**：hard 规则强制注入 native_system_role；soft 规则可注入 developer_role；user_message prepend 仅允许临时提示。
- **压缩免疫校验**：定期 audit session context，发现治理规则出现在 user_message 即告警。
- **规则版本化**：GovernanceBundle 带版本号，规则变更走 ADR 流程（禁直接改文本）。
- **规则外置**：治理规则文本外置到 YAML，禁硬编码（编程红线第 11 条）。

### 3.4 配置外置（YAML 示例）

```yaml
governance:
  hard_rules:
    - id: G001
      text: "禁止删除已有测试用例"
      injection_layer: native_system_role
    - id: G002
      text: "严肃操作走强 workflow（F024）"
      injection_layer: native_system_role
  soft_rules:
    - id: S001
      text: "优先用 pytest"
      injection_layer: developer_role
  forbidden_layers: [user_message_prepend]
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: hard 规则全部注入 native_system_role，禁 user_message
- [ ] AC-2: 上下文压缩后治理规则仍在 session 生效
- [ ] AC-3: 治理规则文本外置 YAML，无硬编码
- [ ] AC-4: 规则变更走 ADR 流程，带版本号
- [ ] AC-5: audit 发现 user_message 治理规则时告警

## 5. 测试策略

### 5.1 单元测试

- 注入层选择、压缩免疫校验、规则版本化、YAML 加载。

### 5.2 集成测试

- 接入 F008 DurableStateRegistry、F022 Tier 1-4 红线、F011 Magic Words。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体在超长上下文压缩后，验证 native_system_role 治理规则仍约束行为。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第3章]
- [doc:review/review.md#第八章/RA-019]
- [doc:decisions/007-harness-engineering.md]
- [doc:design/naming-contract.md#2.12]（能力画像）
- [doc:features/F008-durable-state-surfaces.md]
- [doc:features/F011-magic-words.md]
- [doc:features/F022-tier-1-4-recovery.md]
- [doc:project_rules.md#红线11]
- [doc:project_rules.md#T1-T8]

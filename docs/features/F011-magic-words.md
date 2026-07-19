# Feature F011: Magic Words 逃生舱

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-020] + [doc:roleagent.md#第3章]
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

Magic Words 是人到灵智体（Forgekin）的 runtime 协议——operator 用四个低带宽关键词打断 agent，对应四种逃生动作。本 Feature 实现四个 Magic Words 的识别、触发动作、审计记录，以及在所有觉醒阶（Awakening Stage）下都不可绕过的硬约束。

四个 Magic Words：
1. **"第一性原理"** — 检查是否用复杂度代偿无知
2. **"我能猜出来"** — 读真相源别用推理替代查询
3. **"下次一定"** — 能做的现在做
4. **"星星罐子"** — P0 不可逆风险立即停止

## 2. 动机（Motivation）

`[doc:review/review.md#RA-020]` 指出：roleagent.md 第 3 章的 Magic Words 是人到 agent 的 runtime 协议，v7.0 无任何低带宽人类打断机制，operator 只能改 prompt 重启会话。naming-contract.md §4 觉醒阶规则明确"Magic Words 逃生舱始终可触发（任何阶都不能绕过）"。

不做这个 Feature，觉醒阶 E4+ Evoling 状态的灵智体在偏离愿景时无制动手段，F022 Tier 4 不可逆操作无法被 runtime 拦截，F036 forgemind 万物灵智体的物理世界操作（FR-004）无紧急停止。这是 Build to Persist 的安全治理资产。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class MagicWord(str, Enum):
    FIRST_PRINCIPLES = "第一性原理"      # 检查复杂度代偿无知
    I_CAN_GUESS = "我能猜出来"           # 读真相源别用推理替代查询
    NEXT_TIME_FOR_SURE = "下次一定"      # 能做的现在做
    STAR_JAR = "星星罐子"                # P0 不可逆风险立即停止

class MagicWordTrigger(BaseModel):
    trigger_id: str
    word: MagicWord
    operator_id: str
    forgekin_id: str
    context_snapshot: dict              # 触发时上下文快照
    fired_at: datetime
    action_taken: str
```

### 3.2 核心接口

```python
class MagicWordsDetector:
    """检测 operator 输入中的 Magic Words"""
    def detect(self, operator_input: str) -> Optional[MagicWord]: ...

class MagicWordsExecutor:
    """执行 Magic Words 对应动作"""
    async def execute(self, word: MagicWord, context: dict) -> ActionResult: ...
    async def emergency_stop(self, reason: str) -> None: ...  # 星星罐子
```

### 3.3 关键算法

- **第一性原理**：触发后要求灵智体列出"当前复杂度是否在代偿对问题的无知"，并降级到更简单的方案。
- **我能猜出来**：触发后禁止灵智体继续推理，强制查询 F008 Durable State Surfaces 真相源。
- **下次一定**：触发后禁止"留到下次"，强制在当前 session 完成可做的部分。
- **星星罐子**：触发后立即冻结所有 F022 Tier 4 操作（force-push/merge/release），升级 CVO 仲裁。
- **不可绕过**：所有觉醒阶（E1-E6）下 Magic Words 检测器始终激活，禁用配置关闭。

### 3.4 配置外置（YAML 示例）

```yaml
magic_words:
  enabled: true                        # 不可设为 false（强制）
  bypass_forbidden: true
  words:
    "第一性原理": {action: complexity_audit, layer: native_system_role}
    "我能猜出来": {action: force_truth_source_read, layer: native_system_role}
    "下次一定": {action: forbid_defer, layer: native_system_role}
    "星星罐子": {action: emergency_stop, layer: native_system_role, freeze_tiers: [4]}
  audit_all_triggers: true
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 四个 Magic Words 均可被检测并触发对应动作
- [ ] AC-2: "星星罐子"触发后 Tier 4 操作立即冻结
- [ ] AC-3: "我能猜出来"触发后强制查询 F008 真相源
- [ ] AC-4: 任何觉醒阶下 Magic Words 都不可被配置关闭
- [ ] AC-5: 所有触发记录写入 audit log

## 5. 测试策略

### 5.1 单元测试

- 四词检测、动作执行、不可绕过约束、audit 记录。

### 5.2 集成测试

- 接入 F008 Durable State Surfaces、F022 Tier 1-4 恢复分级、F036 forgemind。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 真实厂商灵智体在执行任务中，operator 触发"星星罐子"，验证 Tier 4 操作立即冻结并升级 CVO。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第3章]
- [doc:review/review.md#第八章/RA-020]
- [doc:decisions/007-harness-engineering.md]
- [doc:design/naming-contract.md#2.11]（觉醒阶）
- [doc:design/naming-contract.md#4]（觉醒阶 E1-E6）
- [doc:features/F008-durable-state-surfaces.md]
- [doc:features/F022-tier-1-4-recovery.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.3 同号映射 | 文档员灵智体（钢笔·文心） |

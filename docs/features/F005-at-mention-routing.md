# Feature F005: 行首 @ 路由（At-Mention Routing）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-013] + [doc:roleagent.md#第2章]
> **关联 ADR**: [doc:decisions/002-collaboration-protocol.md]
> **类型**: collaboration
> **创建日期**: 2026-07-17
> **负责人**: 架构师灵智体（猫头鹰·鲁班）
> **对应 spec.md**: [doc:../spec.md#§3.2]（FR-CORE-002，与本文档同号对应）
> **对应 arch.md**: [doc:../arch.md#§3.2]（待创建）
> **对应 design.md**: [doc:../design.md#§3.2]（待创建）
> **9 大点名称修订**: 已应用（双轨命名 + AI 术语优先 + 弱化万物 + 去 AGI 化）

---

## 1. 概述（Overview）

行首 @ 路由是 TeamAct 协作协议的路由指令规范：路由指令必须出现在行首，不能嵌在句子中间——句中的 @ 是叙述，不是路由。本 Feature 实现行首 @ 解析器、路由指令与叙述提及的隔离、以及与 F006 持球注册 lease 的联动。

行首 @ 路由是 Build to Persist 协作协议资产，编码"任务归属明确"的工程规则，不会因模型升级而退役。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-013]` 指出：roleagent.md 第 2 章明确"路由指令必须出现在行首，不能嵌在句子中间（句中的 @ 是叙述，不是路由）"。v7.0 A2A 协议无此约束，导致 @ 提及和路由指令混在一起，无法区分，任务归属不明，球经常掉地上。

不做这个 Feature，TeamAct 的 Owner 步无法可靠地从对话中提取持球者变更，F006 持球注册 lease 也无法判断"谁该接管球"。跨厂商协作时叙述性提及（如"我和 @architect 讨论过"）会被误判为路由，导致非预期的任务转移。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class AtMentionToken(BaseModel):
    raw_line: str                    # 原始行
    target_forgekin_id: str          # @ 的目标灵智体
    is_routing: bool                 # 是否为路由指令（行首判定）
    routing_intent: Optional[str]    # 路由意图（take/pass/escalate）
    line_number: int
    source_forgekin_id: str

class RoutingDirective(BaseModel):
    target: str
    intent: Literal["take", "pass", "escalate", "broadcast"]
    condition: Optional[str]         # 条件路由（如 CI 通过后）
    issued_at: datetime
```

### 3.2 核心接口

```python
class AtMentionParser:
    """行首 @ 解析器"""
    def parse(self, message: str, source_forgekin_id: str) -> list[AtMentionToken]: ...

class RoutingDispatcher:
    """路由分发器"""
    def dispatch(self, directive: RoutingDirective) -> DispatchResult: ...
    def validate_target(self, target_id: str) -> bool: ...
```

### 3.3 关键算法

- **行首判定**：`is_routing = line.lstrip().startswith("@")`；句中 @ 一律标记 `is_routing=False`。
- **意图识别**：基于行首 @ 后的关键词（take/pass/escalate/broadcast）识别路由意图；无关键词默认为 pass。
- **叙述隔离**：句中 @ 的 token 仅记录不触发路由变更。
- **条件路由**：支持 `@forgekin take when CI_GREEN` 形式的条件路由，与 F006 lease 联动。

### 3.4 配置外置（YAML 示例）

```yaml
at_mention_routing:
  require_line_start: true
  default_intent: pass
  supported_intents: [take, pass, escalate, broadcast]
  allow_conditional: true
  ambiguous_fallback: notify_cvo
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 行首 @ 触发路由，句中 @ 仅记录不触发路由
- [ ] AC-2: 路由意图可识别 take/pass/escalate/broadcast
- [ ] AC-3: 条件路由可挂起等待条件满足后触发
- [ ] AC-4: 歧义目标（重名/不存在）走 ambiguous_fallback 不静默丢弃
- [ ] AC-5: 路由变更同步写入 TeamAct 状态机（F002）

## 5. 测试策略

### 5.1 单元测试

- 行首判定、意图识别、条件路由、歧义回退、叙述隔离。

### 5.2 集成测试

- 接入 F002 TeamActState.Owner 步，验证路由变更同步。
- 接入 F006 BallCustodyLease，验证 take 意图触发 lease 注册。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 多个真实厂商灵智体在协作对话中使用行首 @ 与句中 @，验证路由正确触发且叙述不被误判。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第2章]
- [doc:review/review.md#第八章/RA-013]
- [doc:decisions/002-collaboration-protocol.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F002-teamact-loop.md]
- [doc:features/F006-ball-custody-lease.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.2 同号映射 | 文档员灵智体（钢笔·文心） |

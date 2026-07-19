# Feature F004: 乒乓球熔断器（PingPong Circuit Breaker）

> **状态**: draft
> **版本**: v0.1
> **依赖**: [doc:review/review.md#RA-012] + [doc:roleagent.md#第2章]
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

乒乓球熔断器检测 TeamAct 协作中最隐蔽的失败模式：两个灵智体（Forgekin）互相传但都不干活。熔断器不看传球次数，看每次传球是否伴随实质工具调用和有内容输出。一旦检测到"空传"达到阈值，强制升级给 CVO（operator）并冻结 TeamAct 状态。

本 Feature 在 F002 `PingPongCircuitBreaker` 骨架之上，把"次数阈值"升级为"实质证据判定"，避免误杀正常的密集协作（如 review 多轮辩论）。

## 2. 动机（Motivation）

`[doc:review/review.md#RA-012]` 指出：roleagent.md 第 2 章描述最隐蔽的失败模式——两个 agent 互相传但都不干活。v7.0 无"乒乓球熔断器"，导致两个 Forgekin 可能无限互传"你看一下""我看看"，消耗 token 无产出。F002 骨架仅用 `max_iterations` 次数判定，会误杀合理的多轮 review 辩论。

正确的判定标准是"每次传球是否伴随实质工具调用和有内容输出"——这是 roleagent.md 明确的工程要求，也是 Build to Persist 的协作协议资产。

## 3. 详细设计（Detailed Design）

### 3.1 数据模型

```python
class PassRecord(BaseModel):
    from_forgekin_id: str
    to_forgekin_id: str
    iteration: int
    tool_calls: list[str]          # 本次持球期间的工具调用
    output_chars: int              # 本次持球期间的产出字符数
    evidence_refs: list[str]       # 关联证据 ID
    has_substantive_output: bool   # 是否有实质产出

class PingPongState(BaseModel):
    team_id: str
    consecutive_empty_passes: int = 0
    max_empty_passes: int = 3
    history: list[PassRecord]
    status: Literal["open", "warning", "tripped"] = "open"
```

### 3.2 核心接口

```python
class PingPongCircuitBreaker:
    def evaluate_pass(self, record: PassRecord) -> BreakerVerdict: ...
    def should_trip(self, team_id: str) -> bool: ...
    def trip(self, team_id: str, reason: str) -> None: ...
    def reset(self, team_id: str) -> None: ...
```

### 3.3 关键算法

- **实质产出判定**：`has_substantive_output = len(tool_calls) > 0 or output_chars >= min_output_chars`。
- **空传计数**：连续 `has_substantive_output == False` 的传球计数 +1；任一次有实质产出则归零。
- **熔断动作**：连续空传 ≥ `max_empty_passes` 时 trip，写 Eval 信号 + 升级 CVO + 冻结 TeamAct 状态机。
- **白名单豁免**：review 辩论场景允许显式声明 `debate_mode=true`，豁免空传判定但仍记录 trace。

### 3.4 配置外置（YAML 示例）

```yaml
pingpong_breaker:
  max_empty_passes: 3
  min_output_chars: 200
  min_tool_calls: 1
  debate_mode_exempt: true
  on_trip: [freeze_teamact, notify_cvo, write_eval_signal]
```

## 4. 验收标准（Acceptance Criteria）

- [ ] AC-1: 有工具调用或有 ≥ min_output_chars 产出的传球不计入空传
- [ ] AC-2: 连续空传达阈值时状态转为 tripped 并冻结 TeamAct
- [ ] AC-3: debate_mode 豁免空传判定但保留 trace 记录
- [ ] AC-4: 熔断触发后写 Eval 信号并升级 CVO
- [ ] AC-5: 熔断状态可通过 reset 恢复（需 CVO 确认）

## 5. 测试策略

### 5.1 单元测试

- 实质产出判定、空传计数、debate_mode 豁免、熔断/恢复状态机。

### 5.2 集成测试

- 接入 F002 TeamActState，验证熔断时状态机冻结。
- 接入 F009 Evidence & Sensors，验证证据采集正确。

### 5.3 E2E 测试（必须遵守 T1-T8 测试铁律）

- 构造两个真实厂商灵智体在"你看一下/我看看"场景下的协作，验证熔断器在第 3 次空传时触发。**遵守 T1-T8**：真实 LLM、真实数据、真实工具调用。

## 6. 引用

- [doc:roleagent.md#第2章]
- [doc:review/review.md#第八章/RA-012]
- [doc:decisions/002-collaboration-protocol.md]
- [doc:design/naming-contract.md#2.2]（灵智体 Forgekin）
- [doc:features/F002-teamact-loop.md]
- [doc:features/F009-evidence-sensors.md]
- [doc:project_rules.md#T1-T8]

---

## 7. 变更历史

| 日期 | 版本 | 变更 | 变更者 |
|------|:----:|------|--------|
| 2026-07-19 | v0.2 | 应用 9 大点名称修订 + 添加 spec.md §3.2 同号映射 | 文档员灵智体（钢笔·文心） |

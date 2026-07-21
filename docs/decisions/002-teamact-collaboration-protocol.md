# ADR 002: TeamAct 协作协议

> **状态**: accepted
> **日期**: 2026-07-21
> **决策者**: operator + 架构师灵智体
> **依赖**: `[doc:roleagent.md#第2章]` + `[doc:decisions/004-capability-profile-routing.md]` + `[doc:decisions/013-all-things-spirit-mind-vision.md]`
> **依据**: roleagent.md 七大工程路径之 TeamAct 团队主循环 + operator 7 条不可妥协原则
> **代码实现**: P1-2 ✅ 完整实现（`flowforge/core/teamact/` 7 个文件 624 行 + 385 测试通过）

---

## 1. 上下文

`[doc:roleagent.md#第2章]` 指出：multi-agent 协作不能只是"一群 agent 各自干活然后投票"，而需要一个**结构化的主循环**来保证：
- 状态可观测（谁在做什么、做到哪一步）
- 球权可交接（谁负责、何时交出）
- 终止可判定（什么时候算完成、什么时候该升级）
- 异常可熔断（互传踢皮球、失控时自动停机）

老版本 FlowForge 的问题：
- Agent 协作基于"对话流"而非"状态机"，导致状态不可观测
- 没有持球 lease 概念，球掉地上无人捡
- 终止条件模糊，容易陷入无限循环或过早退出
- 跨厂商 review 没有结构性强制，容易同厂商互评漏错

operator 指示（2026-07-21）：必须按 roleagent.md 七大工程路径实现代码，TeamAct 是七大路径之一的核心闭环。

本 ADR 是 P0 决策，术语对齐项目正式命名（详见 `[doc:decisions/012-naming-fusion.md]`）。

---

## 2. 决策

### 2.1 六步循环 STATE → OWNER → ACTION → EVIDENCE → VERDICT → ROUTE

TeamAct 主循环采用六步结构化状态机，每一步都有明确的输入/输出和验证点：

```python
class TeamActStep(str, Enum):
    STATE = "state"      # 读取共享状态 + 任务画像
    OWNER = "owner"      # 持球者认领 / 路由
    ACTION = "action"    # 持球者执行动作
    EVIDENCE = "evidence"  # 采集证据（commit / 测试 / trace）
    VERDICT = "verdict"  # 跨厂商 review + 质量判定
    ROUTE = "route"      # 路由：继续 / 终止 / 升级
```

**状态转换验证**：`advance(step)` 严格校验步骤顺序，禁止跳跃（如 STATE → EVIDENCE 是非法的），ROUTE → STATE 才允许进入下一轮迭代。

### 2.2 五项终止条件（ALL_CRITERIA_MET 必须 5 条全满足）

```python
class TerminationCondition(str, Enum):
    ALL_CRITERIA_MET = "all_criteria_met"          # 5 条全满足
    MAX_ITERATIONS = "max_iterations"              # 迭代上限（默认 5）
    CIRCUIT_BREAKER_TRIPPED = "circuit_breaker_tripped"  # 乒乓球熔断
    MAGIC_WORD = "magic_word"                      # operator 拉闸
    ENERGY_DEPLETED = "energy_depleted"            # 能量耗尽
    QUALITY_BAR_MET = "quality_bar_met"            # 质量分达标（宽松终止）
```

**五项终止信号**（ALL_CRITERIA_MET 必须全部 true）：
1. `cross_agent_verified`：跨厂商 review 通过
2. `no_dangling_ownership`：无悬挂球权（所有 lease 已释放或交接）
3. `vision_converged`：愿景收敛（产物符合 task brief）
4. `magic_word_invoked == False`：operator 未拉闸
5. `circuit_breaker_tripped == False`：未触发熔断

### 2.3 持球 lease + TTL 超时释放

`[doc:roleagent.md#RA-014]`：持球者必须声明 custody lease，防止"球掉地上"故障。

```python
class BallCustodyRegistry:
    def acquire(self, ball_id: str, owner: str, ttl_seconds: int = 300) -> str:
        """获取球权 lease，TTL 默认 5 分钟"""
    
    def release(self, lease_id: str) -> None:
        """主动释放球权"""
    
    def renew(self, lease_id: str, ttl_seconds: int) -> None:
        """续约（长任务必须定期续约）"""
    
    def current_holder(self, ball_id: str) -> str | None:
        """查询当前持球者（过期 lease 自动清理）"""
```

**关键设计**：
- TTL 是安全网，不是主要释放机制（持球者应主动 release）
- 过期 lease 在 acquire / current_holder 调用时懒清理
- `now_fn` 注入而非全局 `datetime.utcnow()`，保证测试可快进

### 2.4 Handoff Capsule 交接协议

球权交接必须携带结构化 capsule，禁止"口头交接"：

```python
@dataclass
class HandoffCapsule:
    capsule_id: str
    from_owner: str
    to_owner: str
    summary: str              # 这次做了什么
    evidence_refs: list[str]  # 证据引用
    open_questions: list[str] # 遗留问题
    next_action_hint: str     # 下一步建议
```

### 2.5 @mention 路由（4 种语义）

```python
class AtMentionRouter:
    # @coder fix bug       → 精确路由到 forgekin_id="coder"
    # @all standup          → 广播给团队所有成员
    # @role:reviewer check  → 按角色路由（运行时标签）
    # @forgekin:cat-companion greet → 按 forgekin 类型路由
```

### 2.6 推回协议（PushBackProtocol）

持球者有权推回不合理任务，但必须结构化记录：

```python
@dataclass
class PushBack:
    pushback_id: str
    owner: str
    reason: str              # 推回原因
    proposed_alternative: str # 建议替代方案
    status: str              # open / resolved / escalated
```

### 2.7 乒乓球熔断器（PingPongCircuitBreaker）

`[doc:roleagent.md#RA-010]`：两个 agent 互传任务超过 3 次自动熔断，升级到 operator。

```python
class PingPongCircuitBreaker:
    def record_handoff(self, from_owner: str, to_owner: str) -> None:
        """记录一次交接"""
    
    def is_tripped(self) -> bool:
        """检测是否触发熔断（3 次互传）"""
```

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: 六步状态机 + 5 终止 + lease + 熔断** | 状态可观测、球权可交接、终止可判定、异常可熔断，符合 roleagent.md | 实现复杂度高（7 个子组件），状态机约束严格可能影响灵活性 |
| 方案 B: 自由对话流协作 | 实现简单、灵活 | 状态不可观测、球权易丢失、终止模糊、无法熔断 |
| 方案 C: 三步循环（Plan→Act→Review） | 实现简单 | 缺少 Evidence 和 Route 步骤，无法结构化交接 |
| 方案 D: 基于 LLM 的元控制器 | 灵活 | 每次状态转换都要 LLM 调用，性能不可接受，且无法保证一致性 |

---

## 4. 理由

- `[doc:roleagent.md#第2章]` 明确要求 TeamAct 六步循环 + 五项终止 + 持球 lease + 乒乓球熔断器
- 六步状态机的严格顺序保证 Evidence 和 Verdict 不会被跳过（最易漏的两步）
- 持球 lease 的 TTL 机制解决了"球掉地上"故障，是分布式协作的结构性必需
- 乒乓球熔断器防止两个 agent 互相踢皮球浪费资源
- `now_fn` 注入设计让测试无需 sleep，保证测试套件快速且确定性
- 推回协议让 agent 有权拒绝不合理任务，避免被迫执行失败任务

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 六步状态机可能过于严格 | Route 步骤允许"继续 / 终止 / 升级"三种路由，保留灵活性 |
| TTL 默认 5 分钟可能不够 | 持球者可 renew 续约，TTL 只是安全网 |
| 熔断器误判 | 3 次互传阈值可配置，且熔断后升级 operator 而非直接失败 |
| Handoff Capsule 增加开销 | capsule 是结构化数据，可被 Eval 系统复用 |
| 状态机实现复杂度高 | 已在 P1-2 完整实现（7 文件 624 行 + 385 测试通过），复杂度可控 |

---

## 6. 否决理由

- **方案 B（自由对话流）**：违反 roleagent.md 核心主张，状态不可观测导致 debug 困难
- **方案 C（三步循环）**：缺少 Evidence 步骤导致质量无法验证，缺少 Route 步骤导致无法结构化终止
- **方案 D（LLM 元控制器）**：每次状态转换都要 LLM 调用，性能不可接受，且 LLM 可能产生不一致的决策

---

## 7. 参与者

- operator（愿景锚点 + 最终决策）
- 架构师灵智体（方案设计 + 代码实现 P1-2）
- 代码审核灵智体（385 测试用例验证通过）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-21 | 初始版本，确立 TeamAct 协作协议决策，代码实现 P1-2 已完成 | operator + 架构师灵智体 |

---

## 引用

- `[doc:roleagent.md#第2章]` — TeamAct 团队主循环（六步循环 + 五项终止 + 持球 lease + 乒乓球熔断器）
- `[doc:roleagent.md#RA-010]` — 五项终止条件
- `[doc:roleagent.md#RA-014]` — 持球 lease 规范
- `[doc:decisions/004-capability-profile-routing.md]` — 能力画像路由（TeamAct owner 选择依据）
- `[doc:decisions/013-all-things-spirit-mind-vision.md]` — 万物灵智体愿景
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表）
- `[doc:features/F002-teamact-loop.md]` — TeamAct 主循环 Feature 规格
- `flowforge/core/teamact/` — P1-2 代码实现（7 文件 624 行）

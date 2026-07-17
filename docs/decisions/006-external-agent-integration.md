# ADR 006: 三方 Agent 集成

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: 架构师灵智体 + operator 审核
> **依赖**: `[doc:VISION.md#5]` + `[doc:project_rules.md#红线11]`
> **依据**: `[doc:review/review.md#第九章]` EX-001~EX-010

---

## 上下文

operator 指示（2026-07-17）：

> 我们的灵智体除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent 的（这个也是我们的强大优势，比喻目前设计接入的编程 Agent：claude code、codex、opencode、trae，将来可扩展接入更多的编程 Agent 和其他的 Agent 的，这些都是可以给灵智体调用），目前你这块的设计感觉也比较弱，请加强。

当前 FlowForge 设计中，三方 Agent 集成被弱化为 ToolRegistry 中的普通工具调用。这导致：
- 三方 Agent 的能力画像未纳入灵智体能力画像融合
- 三方 Agent 执行状态未写入灵智体共享状态
- 三方 Agent 失败时无 fallback 链
- 三方 Agent 执行轨迹未纳入 Eval 信号

---

## 决策

### 1. 三方 Agent 是能力扩展，不是工具

灵智体调用三方 Agent 时，三方 Agent 的能力画像被纳入灵智体的能力画像融合，而非简单工具调用。

### 2. ExternalAgentAdapter 抽象层

新增 `flowforge/core/external_agent/` 模块：

```
flowforge/core/external_agent/
├── __init__.py
├── adapter.py             # ExternalAgentAdapter 抽象
├── bridge.py              # ExternalAgentBridge（灵智体调用入口）
├── profile.py             # ExternalAgentProfile（三方 Agent 能力画像）
├── shared_state.py        # ExternalAgentSharedState（状态共享）
├── fallback.py            # ExternalAgentFallback（失败回退链）
├── capability_fusion.py   # ExternalAgentCapabilityFusion（能力融合）
└── adapters/              # 具体三方 Agent 适配器
    ├── __init__.py
    ├── claude_code.py     # Claude Code Adapter
    ├── codex.py           # Codex Adapter
    ├── opencode.py        # OpenCode Adapter
    └── trae.py            # Trae Adapter
```

### 3. 四大机制

| 机制 | 用途 | Feature |
|------|------|---------|
| ExternalAgentProfile | 三方 Agent 能力画像 | F032 |
| ExternalAgentSharedState | 执行状态写入灵智体共享状态 | F033 |
| ExternalAgentFallback | 失败回退链 | F034 |
| ExternalAgentCapabilityFusion | 能力画像融合 | F035 |

### 4. 首批接入的三方 Agent

| 三方 Agent | 厂商 | 接入方式 | fallback 优先级 |
|---|---|---|:---:|
| Claude Code | Anthropic | CLI / SDK | 1 |
| Codex | OpenAI | CLI / API | 2 |
| OpenCode | 开源 | CLI | 3 |
| Trae | ByteDance | IDE / API | 4 |

### 5. 调用流程

```
1. 灵智体发起 ExternalAgentBridge.invoke(agent_id, task)
   ↓
2. 灵智体能力画像 gap_analysis 判断需要三方 Agent
   ↓
3. ExternalAgentAdapter 路由到对应三方 Agent
   ↓
4. 三方 Agent 在独立 worktree 执行（隔离 + 审计）
   ↓
5. 执行状态写入 ExternalAgentSharedState
   ↓
6. 灵智体读取共享状态，融合到自身能力画像
   ↓
7. 若失败，ExternalAgentFallback 链回退到下一个三方 Agent
   ↓
8. 全部失败 → 回退到 FlowForge 内置能力
   ↓
9. 执行轨迹写入灵智体 Eval 信号
```

### 6. 安全治理（六层 Guardrails）

| 治理层 | 机制 |
|--------|------|
| L1 输入验证 | 三方 Agent 调用前必须通过 Schema 校验 |
| L2 系统提示约束 | 灵智体 system role 注入"禁止绕过审计" |
| L3 工具白名单 | 三方 Agent 只能调用 allow-list 内工具 |
| L4 输出验证 | 三方 Agent 输出必须通过 lint + 测试 |
| L5 操作确认 | 不可逆操作（merge/release）需 operator 确认 |
| L6 成本上限 | 每个灵智体有三方 Agent 调用配额 |

### 7. worktree 隔离

每个三方 Agent 调用必须创建独立 worktree：
- 网络隔离：受限网络访问
- 权限控制：仅 read + write_code + run_tests
- 审计追踪：全部记录到 `harness-feedback/external-agent-traces/`

---

## 后果

### 正面后果

- 灵智体能力大幅扩展（接入顶级编程 Agent）
- 三方 Agent 失败有 fallback 链保证可用性
- 三方 Agent 能力画像融合让灵智体能力画像更完整
- 未来可扩展接入非编程类 Agent（搜索 / 设计 / 创意）

### 负面后果

- 实现复杂度增加（4 个 Adapter + 4 大机制）
- 三方 Agent 调用成本较高（需要 API key / 配额）
- worktree 隔离增加 I/O 开销

### 风险

- 三方 Agent API 不稳定（缓解：fallback 链 + 重试）
- 三方 Agent 能力画像融合可能引入盲点（缓解：跨厂商 review）
- worktree 隔离可能被绕过（缓解：审计追踪 + 操作确认）

---

## 替代方案

### 方案 A: 把三方 Agent 作为 ToolRegistry 普通工具

- 优点：实现简单
- 缺点：能力画像无法融合，状态无法共享，无 fallback
- 未选择原因：operator 明确指示"目前你这块的设计感觉也比较弱，请加强"

### 方案 B: 只接入 Claude Code

- 优点：实现简单
- 缺点：单点依赖，无 fallback
- 未选择原因：违反 fallback 链设计

### 方案 C: 把三方 Agent 集成放到 forgemind 应用层

- 优点：forgemind 自治
- 缺点：*Forge 垂直业务层无法使用三方 Agent
- 未选择原因：三方 Agent 集成是核心能力，应放核心框架层

---

## 引用

- `[doc:VISION.md#5]` — 三方 Agent 集成
- `[doc:features/F031-external-agent-adapter.md]` — 三方 Agent 适配层
- `[doc:features/F032-external-agent-profile.md]` — 三方 Agent 能力画像
- `[doc:features/F033-external-agent-shared-state.md]` — 三方 Agent 状态共享
- `[doc:features/F034-external-agent-fallback.md]` — 三方 Agent 失败回退
- `[doc:features/F035-external-agent-capability-fusion.md]` — 三方 Agent 能力融合
- `[doc:project_rules.md#红线11]` — 禁止硬编码密钥
- `[doc:SOP.md#3]` — 三方 Agent 调用 SOP

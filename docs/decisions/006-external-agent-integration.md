# ADR 006: 三方 Agent 集成

> **状态**: accepted
> **日期**: 2026-07-17
> **决策者**: operator + 架构师灵智体
> **依赖**: `[doc:VISION.md#5]` + `[doc:project_rules.md#红线11]`
> **依据**: operator 7 条不可妥协原则 + roleagent.md 工程路径

---

## 1. 上下文

operator 指示（2026-07-17）：

> 我们的灵智体除了可以调用 flowforge 核心框架的能力外，还可以接入和使用任何三方的 Agent 的（这个也是我们的强大优势，比喻目前设计接入的编程 Agent：claude code、codex、opencode、trae，将来可扩展接入更多的编程 Agent 和其他的 Agent 的，这些都是可以给灵智体调用），目前你这块的设计感觉也比较弱，请加强。

当前 flowlight-ai/flowforge 新仓库设计中，三方 Agent 集成被弱化为 ToolRegistry 中的普通工具调用。这导致：
- 三方 Agent 的能力画像未纳入灵智体能力画像融合
- 三方 Agent 执行状态未写入灵智体共享状态（灵忆 EchoStore）
- 三方 Agent 失败时无 fallback 链
- 三方 Agent 执行轨迹未纳入 Eval 信号

本 ADR 是 P0 决策，术语对齐项目正式命名（详见 `[doc:decisions/012-naming-fusion.md]`）。

---

## 2. 决策

### 2.1 三方 Agent 是能力扩展，不是工具

灵智体调用三方 Agent 时，三方 Agent 的能力画像被纳入灵智体的能力画像融合（CapabilityProfile fusion），而非简单工具调用。这是 operator 愿景锚点第 3 条（三方 Agent 是能力扩展不是工具）的落地。

### 2.2 ExternalAgentAdapter 抽象层

新增 `flowforge/core/external_agent/` 模块：

```
flowforge/core/external_agent/
├── __init__.py
├── adapter.py             # ExternalAgentAdapter 抽象
├── bridge.py              # ExternalAgentBridge（灵智体调用入口）
├── profile.py             # ExternalAgentProfile（三方 Agent 能力画像）
├── shared_state.py        # ExternalAgentSharedState（状态共享，写入灵忆 EchoStore）
├── fallback.py            # ExternalAgentFallback（失败回退链）
├── capability_fusion.py   # ExternalAgentCapabilityFusion（能力融合）
└── adapters/              # 具体三方 Agent 适配器
    ├── __init__.py
    ├── claude_code.py     # Claude Code Adapter
    ├── codex.py           # Codex Adapter
    ├── opencode.py        # OpenCode Adapter
    └── trae.py            # Trae Adapter
```

### 2.3 四大机制

| 机制 | 用途 | Feature |
|------|------|---------|
| ExternalAgentProfile | 三方 Agent 能力画像 | F032 |
| ExternalAgentSharedState | 执行状态写入灵智体共享状态（灵忆 EchoStore） | F033 |
| ExternalAgentFallback | 失败回退链 | F034 |
| ExternalAgentCapabilityFusion | 能力画像融合到灵智体灵印 SoulImprint | F035 |

### 2.4 首批接入的三方 Agent

| 三方 Agent | 厂商 | 接入方式 | fallback 优先级 |
|---|---|---|:---:|
| Claude Code | Anthropic | CLI / SDK | 1 |
| Codex | OpenAI | CLI / API | 2 |
| OpenCode | 开源 | CLI | 3 |
| Trae | ByteDance | IDE / API | 4 |

### 2.5 调用流程

```
1. 灵智体发起 ExternalAgentBridge.invoke(agent_id, task)
   ↓
2. 灵智体能力画像 gap_analysis 判断需要三方 Agent
   ↓
3. ExternalAgentAdapter 路由到对应三方 Agent
   ↓
4. 三方 Agent 在独立 worktree 执行（隔离 + 审计）
   ↓
5. 执行状态写入 ExternalAgentSharedState（同步到灵忆 EchoStore）
   ↓
6. 灵智体读取共享状态，融合到自身能力画像（灵印 SoulImprint）
   ↓
7. 若失败，ExternalAgentFallback 链回退到下一个三方 Agent
   ↓
8. 全部失败 → 回退到 FlowForge 内置能力（ForgeMindEngine）
   ↓
9. 执行轨迹写入灵智体 Eval 信号
```

### 2.6 安全治理（六层 Guardrails）

| 治理层 | 机制 |
|--------|------|
| L1 输入验证 | 三方 Agent 调用前必须通过 Schema 校验 |
| L2 系统提示约束 | 灵智体 system role 注入"禁止绕过审计" |
| L3 工具白名单 | 三方 Agent 只能调用 allow-list 内工具 |
| L4 输出验证 | 三方 Agent 输出必须通过 lint + 测试 |
| L5 操作确认 | 不可逆操作（merge/release）需 operator 确认 |
| L6 成本上限 | 每个灵智体有三方 Agent 调用配额 |

### 2.7 worktree 隔离

每个三方 Agent 调用必须创建独立 worktree：
- 网络隔离：受限网络访问
- 权限控制：仅 read + write_code + run_tests
- 审计追踪：全部记录到 `harness-feedback/external-agent-traces/`

---

## 3. 方案对比

| 方案 | 优点 | 缺点 |
|------|------|------|
| **方案 A（选定）: ExternalAgentAdapter 抽象层 + 四大机制 + 六层 Guardrails** | 灵智体能力大幅扩展，失败有 fallback 链，能力画像融合让灵智体画像更完整 | 实现复杂度增加（4 个 Adapter + 4 大机制 + 六层 Guardrails），三方 Agent 调用成本较高 |
| 方案 B: 把三方 Agent 作为 ToolRegistry 普通工具 | 实现简单 | 能力画像无法融合，状态无法共享，无 fallback |
| 方案 C: 只接入 Claude Code | 实现简单 | 单点依赖，无 fallback |
| 方案 D: 把三方 Agent 集成放到 forgemind 应用层 | forgemind 自治 | *Forge 垂直业务层无法使用三方 Agent，违反核心能力应放核心框架层 |

---

## 4. 理由

- operator 明确指示"目前你这块的设计感觉也比较弱，请加强"，要求三方 Agent 作为能力扩展而非工具
- operator 愿景锚点第 3 条：三方 Agent 是能力扩展不是工具
- 三方 Agent 能力画像融合让灵智体能力画像更完整（模型能力 × Harness 契合度 × 灵智体形态 × 三方 Agent 扩展）
- fallback 链保证可用性，避免单点依赖
- 六层 Guardrails 保证三方 Agent 调用安全可控
- 三方 Agent 集成是核心能力，应放核心框架层（`flowforge/core/external_agent/`），而非 forgemind 应用层

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 三方 Agent API 不稳定 | fallback 链 + 重试机制 + Tier 1-4 恢复分级 |
| 三方 Agent 能力画像融合可能引入盲点 | 跨厂商 review + 盲点画像识别 |
| worktree 隔离可能被绕过 | 审计追踪 + L5 操作确认 + 灵议 MindCouncil 审查 |
| 三方 Agent 调用成本较高 | L6 成本上限 + 配额管理 + Token 账本 |
| 三方 Agent API key 泄露风险 | 配置外置（红线 11）+ 密钥管理服务 |

---

## 6. 否决理由

- **方案 B（ToolRegistry 普通工具）**：operator 明确指示"目前你这块的设计感觉也比较弱，请加强"，普通工具调用无法实现能力画像融合和状态共享
- **方案 C（只接入 Claude Code）**：单点依赖，无 fallback 链，违反 fallback 链设计原则
- **方案 D（放到 forgemind 应用层）**：三方 Agent 集成是核心能力，*Forge 垂直业务层也需要使用，应放核心框架层

---

## 7. 参与者

- operator（愿景锚点 + 最终决策）
- 架构师灵智体（方案设计 + 四大机制 + 六层 Guardrails + 术语对齐项目正式命名）

---

## 8. 修订记录

| 日期 | 修订 | 修订者 |
|------|------|--------|
| 2026-07-17 | 初始版本，确立三方 Agent 集成决策，术语对齐项目正式命名（灵忆 EchoStore / 灵印 SoulImprint / 灵议 MindCouncil / ForgeMindEngine） | operator + 架构师灵智体 |

---

## 引用

- `[doc:VISION.md#5]` — 三方 Agent 集成
- `[doc:VISION.md#6]` — operator 7 条不可妥协原则（第 3 条：三方 Agent 是能力扩展）
- `[doc:decisions/012-naming-fusion.md]` — 命名融合（项目正式术语表）
- `[doc:features/F031-external-agent-adapter.md]` — 三方 Agent 适配层
- `[doc:features/F032-external-agent-profile.md]` — 三方 Agent 能力画像
- `[doc:features/F033-external-agent-shared-state.md]` — 三方 Agent 状态共享
- `[doc:features/F034-external-agent-fallback.md]` — 三方 Agent 失败回退
- `[doc:features/F035-external-agent-capability-fusion.md]` — 三方 Agent 能力融合
- `[doc:project_rules.md#红线11]` — 禁止硬编码密钥
- `[doc:SOP.md#3]` — 三方 Agent 调用 SOP

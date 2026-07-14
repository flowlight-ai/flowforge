# FlowForge v3.0 Agent Harness 进化需求规格说明书 — spec_face

> **版本**：v3.0 (face)
> **日期**：2026-07-14
> **作者**：基于 FlowForge v2.1 / DevForge v2.1 设计文档 + 2025-2026 大厂 Agent Harness 一手面试动态综合规划
> **状态**：待用户审核
> **权威源**：本文档为补充规格，与 `flowforge/docs/spec.md` v2.1、`devforge/docs/spec.md` v2.1、`hiclaw/rules.md`、`hiclaw/prompts.md` 共同构成 FlowForge 生态完整规格体系。冲突时以本文档为准。

---

## 第一章：背景与目标

### 1.1 项目背景

FlowForge 生态历经 Phase 0~5 的迭代，已建立：
- **FlowForge v2.1** 六层 Harness 架构（Application/Gateway/Harness/Engine/Capability/Infrastructure）
- 9 大执行模式（ReAct/Reflexion/Plan-Execute/ReWOO/Self-Discover/Multi-Agent/GOT/Workflow/Loop）
- 四大 Harness 护栏（Context Engineering/架构约束/反馈循环/熵管理）
- Loop 引擎（Executor/Verifier/Reflector/Planner/Orchestrator/Parallel）
- Plugin V2 协议（10 个钩子）
- Memory 多层体系（Short/Long/Episodic/Working/Semantic/Mailbox/Task Board/Compressor）
- MCP 集成（broker/client/gateway/server/tool_adapter）
- Workflow YAML Compiler（Parser/Validator/CodeGen/Resume Adapter）
- Skill 系统（base/combo/loader/manager）
- Helm 实时交互 UI（WebSocket/SSE/Plan/Spec/Artifact/Diff/Terminal）
- DevForge IPD 门禁流程（9 个 DCP+TR、5 类场景自适应）
- ContentForge/NovelForge/MallForge/StockForge 业务上层

### 1.2 调研方法

通过面试国内主流大厂 Agent Harness 相关岗位（涵盖字节、阿里、腾讯、百度、华为、网易、商汤等），收集 2025-2026 年最新一手动态，覆盖以下 15 大方向：

1. 多 Agent 协作与编排（Anthropic Orchestrator-Worker、OpenAI Agents SDK、Google A2A）
2. Context Engineering 取代 Prompt Engineering
3. MCP 标准化（2026-07-28 Spec RC）
4. Agent 安全六层 Guardrails
5. OpenTelemetry GenAI v1.30
6. Agent 评估与基准测试（τ-bench、SWE-bench Pro）
7. 长程任务管理（30+ 小时连续运行）
8. 自我纠错与反思（PreFlect、VIGIL、SAGE）
9. 成本优化与智能模型路由（Prompt Caching 45-80%）
10. Agent 生产化部署（灰度、A/B、Eval-gated）
11. 人机协作（IETF CHEQ、HITL/HotL/HoverL）
12. Agent 治理（CSA AGMM、AgentBOM、Blast-radius Gates）
13. Computer Use / Browser Use / GUI Agent
14. Agent-to-Agent 通信协议（A2A/ACP/MCP 三层栈）
15. 故障恢复与降级（Durable execution、Self-healing Runtime）

### 1.3 v3.0 总目标

将 FlowForge 从 v2.1 "Agent 驾驭层"进化为 v3.0 **"工业级 Agent 操作系统 + Agent 互联网节点"**，达成：

| 维度 | v2.1 现状 | v3.0 目标 |
|------|-----------|-----------|
| **架构定位** | 单体 Harness 层 | 多租户、多 Agent 互联的 Agent OS + 网络节点 |
| **协作能力** | 单进程 Multi-Agent | 跨进程、跨实例、跨厂 A2A 协议互联 |
| **上下文工程** | 配置驱动 Prompt 外置 | JIT Context + Memory Tool + Context Editing |
| **可观测性** | 日志 + Metrics | OTel GenAI v1.30 标准化 Trace + Eval-gated |
| **可靠性** | Loop 自修正 | Durable Execution + 30+ 小时长程任务 |
| **安全** | 4 护栏 + 红线 15 条 | 六层 Guardrails + AgentBOM + Blast-radius Gates |
| **成本** | 静态路由 | Prompt Caching + 智能 cost-aware routing |
| **治理** | 红线 + 铁律 | CSA AGMM Level 4 治理即代码 |
| **HITL** | 人工审核块 | IETF CHEQ + 三段式 HITL/HotL/HoverL |
| **评估** | T1-T9 测试铁律 | τ-bench pass^k + SWE-bench Pro 对齐 |

### 1.4 设计原则

1. **配置驱动 > 代码继承**（沿用 v2.1 红线 9）
2. **协议优先**：优先采用国际标准（MCP 2026/A2A/OTel GenAI/IETF CHEQ）
3. **向后兼容**：v2.1 接口不破坏，新能力通过 Feature Flag 渐进启用
4. **可观测即默认**：所有 Agent / Tool / Loop 自动埋点 OTel Trace
5. **治理即代码**：策略 YAML 化，CI/CD 门禁化
6. **测试铁律不退化**：T1-T9 全部继承，新增 T10（OTel Trace 完整性）+ T11（A2A 协议合规）

---

## 第二章：差距分析

### 2.1 当前架构成熟度自评（CSA AGMM）

| 维度 | v2.1 评分 | v3.0 目标 | 差距 |
|------|----------|----------|------|
| Identity & Access | L2 | L4 | 缺 Agent 身份体系、跨厂鉴权 |
| Observability | L2 | L4 | 缺 OTel GenAI 标准化、Eval-gated |
| Safety & Security | L3 | L4 | 缺六层 Guardrails 完整闭环、AgentBOM |
| Compliance & Audit | L2 | L4 | 缺 Blast-radius Gates、审计链 |
| Lifecycle Mgmt | L3 | L4 | 缺 Durable Execution、长程任务 |
| Collaboration | L1 | L4 | 缺 A2A 协议、跨 Agent 通信 |

### 2.2 关键差距矩阵

| # | 大厂方向 | FlowForge 现状 | DevForge 现状 | 差距 | 优先级 |
|---|---------|---------------|--------------|------|--------|
| G1 | A2A 协议 | 无 | 无 | 完全缺失，无法跨 Agent 互联 | P0 |
| G2 | MCP 2026 Spec | 已集成旧版 | 已用旧版 | 缺 Stateless Core、MCP Apps、OAuth | P0 |
| G3 | Context Engineering | Prompt 外置 | Prompt 外置 | 缺 JIT Context、Memory Tool、Context Editing | P0 |
| G4 | 六层 Guardrails | 4 护栏 | 4 护栏 | 缺 Input/Output validation 闭环、Action confirmation | P0 |
| G5 | OTel GenAI v1.30 | 自有 Tracing | 同上 | 缺 `gen_ai.*` schema、Eval-gated | P0 |
| G6 | τ-bench/SWE-bench 评估 | T1-T9 自有 | T1-T9 自有 | 缺 pass^k 可靠性、生产级 benchmark | P1 |
| G7 | 长程任务（30+ h） | Checkpoint 基础 | 同上 | 缺 Durable Execution、状态对齐 | P1 |
| G8 | 自我纠错 PreFlect/VIGIL/SAGE | Reflexion | Reflexion | 缺事前预防、多假设归因 | P1 |
| G9 | Prompt Caching | 无 | 无 | 完全缺失，成本居高 | P1 |
| G10 | 灰度/A/B/Eval-gated | Canary 基础 | Canary 基础 | 缺 Eval-gated、A/B、自动回滚闭环 | P1 |
| G11 | IETF CHEQ HITL | 审核块 | DCP/TR 门禁 | 缺标准化中断恢复、HotL/HoverL | P1 |
| G12 | AgentBOM/Blast-radius | 无 | 无 | 完全缺失，治理短板 | P2 |
| G13 | Computer/Browser Use | Playwright 工具 | Playwright 工具 | 缺 GUI Agent、Visual grounding | P2 |
| G14 | ACP/MCP/A2A 三层栈 | MCP 一层 | MCP 一层 | 缺 ACP 编排层、A2A 协作层 | P2 |
| G15 | Durable/Self-healing | Circuit Breaker | Circuit Breaker | 缺 Saga、Outbox、Self-healing Runtime | P1 |
| G16 | 多租户隔离 | 单租户 | 单租户 | 缺 Tenant 隔离、配额 | P2 |
| G17 | Skill 市场 | 内部 Skill | 内部 Skill | 缺外部市场、版本化分发 | P2 |
| G18 | 模型 Provider 配额治理 | Quota Manager 基础 | 同上 | 缺跨 Provider 配额池、降级策略 | P1 |

---

## 第三章：v3.0 总体架构演进

### 3.1 七层架构模型（v2.1 六层 + 互联层）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 7. 互联层 (Interconnect Layer) ★ v3.0 新增                                │
│    A2A Server/Client | ACP Orchestrator | Agent Directory | 租户路由       │
├──────────────────────────────────────────────────────────────────────────┤
│ 6. 应用层 (Application Layer)                                              │
│    ContentForge / NovelForge / DevForge / MallForge / StockForge          │
├──────────────────────────────────────────────────────────────────────────┤
│ 5. 接入层 (Gateway Layer)                                                  │
│    FastAPI REST + WebSocket (Helm/Events) + Web UI + CLI + A2A Endpoint   │
├──────────────────────────────────────────────────────────────────────────┤
│ 4. Harness 驾驭层 (Harness Layer) ★ v3.0 强化                              │
│    上下文工程(JIT/Memory Tool/Editing) | 六层 Guardrails | 反馈循环        │
│    熵管理 | HITL(CHEQ) | AgentBOM | Blast-radius Gates | 权限管线         │
├──────────────────────────────────────────────────────────────────────────┤
│ 3. 执行引擎层 (Engine Layer) ★ v3.0 强化                                   │
│    HybridExecutor(TAOR) | 9大模式 | Durable Execution | Long-Run Mgr     │
│    Scheduler | PreFlect | VIGIL | SAGE                                    │
├──────────────────────────────────────────────────────────────────────────┤
│ 2. 能力层 (Capability Layer) ★ v3.0 强化                                   │
│    MCP 2026 (Stateless/Apps/OAuth) | Skill 市场 | Prompt Cache           │
│    Agent 库 | Memory(Enhanced) | Computer Use | Browser Agent            │
├──────────────────────────────────────────────────────────────────────────┤
│ 1. 基础设施层 (Infrastructure Layer) ★ v3.0 强化                           │
│    SQLite/PostgreSQL | Redis | Qdrant | LangGraph | OTel Collector        │
│    LLM API (多 Provider 配额池) | A2A Registry | Eval Backend             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 控制回路演进

v2.1 控制回路（前馈+反馈+熵管理）→ v3.0 新增：
- **Durable 持久回路**：每个 Agent Step 都写入 Durable Event Log，故障后从最近 Checkpoint 恢复
- **Eval-gated 闭环**：金丝雀发布前自动跑 τ-bench 评估，未达 pass^k 阈值自动回滚
- **Blast-radius 闸门**：高风险 Action（生产发布/数据库迁移）需 Blast-radius Gate 双签
- **CHEQ 中断恢复**：HITL 中断点持久化，重启后自动恢复至中断状态

### 3.3 核心数据流

```
用户意图
  → Gateway(认证+限流+租户路由)
  → Harness(上下文工程 JIT 注入 + 六层 Guardrails 前馈)
  → Engine(Durable Execution 启动 + PreFlect 预检)
  → 9 大模式执行（每步 Checkpoint + OTel Span）
  → 工具调用（MCP 2026 / A2A / Skill）
  → HITL 中断点（CHEQ）
  → 输出（六层 Guardrails 后馈验证）
  → Eval-gated 发布门禁
  → 反馈循环（Reflexion / VIGIL / SAGE）
  → AgentBOM 落库 + 审计
```

---

## 第四章：核心需求模块（17 大模块）

### 模块 M1：A2A 协议集成（跨厂 Agent 互联）

**背景**：Google A2A 协议已被 150+ 组织采纳，Linux Foundation 托管。v3.0 必须让 FlowForge Agent 成为"互联网节点"，可被外部 Agent 调用，也可调用外部 Agent。

**需求**：

- **M1.1 A2A Server**：每个 FlowForge Agent 自动暴露 A2A Endpoint
  - 路径：`/a2a/{agent_id}/tasks` （任务下发）
  - 路径：`/a2a/{agent_id}/tasks/{task_id}/status` （状态查询）
  - 路径：`/a2a/{agent_id}/tasks/{task_id}/result` （结果获取）
  - 路径：`/a2a/{agent_id}/stream` （SSE 流式）
  - 路径：`/.well-known/agent.json` （Agent Card 自动发现）

- **M1.2 A2A Client**：FlowForge Agent 可作为客户端调用外部 A2A Agent
  - 通过 `ToolRegistry` 注册 `a2a_invoke` 工具
  - 支持 Agent Card 自动发现（`/.well-known/agent.json`）
  - 支持长任务流式 SSE 订阅

- **M1.3 Agent Card 规范**：
  ```yaml
  # .well-known/agent.json
  name: contentforge:writer
  description: AI content writer specialized in Chinese long-form articles
  version: 3.0.0
  capabilities:
    - streaming
    - push_notifications
    - state_transition
  skills:
    - id: long_form_writing
      name: Long-form Article Writing
      tags: ["content", "chinese", "long-form"]
  authentication:
    schemes: ["bearer", "oauth2"]
  default_input_modes: ["text", "json", "file"]
  default_output_modes: ["text", "json", "markdown"]
  ```

- **M1.4 Agent Directory**：内部 Agent 注册中心
  - 自动扫描所有 *forge/ 项目，生成 Agent Card
  - 提供 `/directory/search?skill=writing&tags=chinese` 查询接口
  - 支持跨实例联邦查询

- **M1.5 跨厂鉴权**：
  - Bearer Token（内部）
  - OAuth2 Client Credentials（跨厂）
  - JWT 签名（请求来源验证）
  - 限流配额（按 tenant + agent_id）

**设计要点**：
- A2A Server 复用 FastAPI 路由，不另起服务
- A2A Client 通过 `a2a_invoke` 工具接入 ToolRegistry，遵守 DI 铁律
- Agent Card YAML 化，存在 `config/agent_cards/` 目录
- 所有 A2A 调用必须经 OTel Trace（M5）

**验收标准**：
- ✅ `curl /.well-known/agent.json` 返回标准 Agent Card
- ✅ 外部 A2A Client 可下发任务并收到 SSE 流式响应
- ✅ FlowForge Agent 可通过 `a2a_invoke` 工具调用外部 A2A Agent
- ✅ Agent Directory 支持 50+ Agent 注册与联邦查询
- ✅ 跨厂鉴权通过 Bearer + OAuth2 双重验证

---

### 模块 M2：MCP 2026 Spec RC 升级

**背景**：MCP 2026-07-28 Spec RC 引入 Stateless Core、MCP Apps、OAuth Authorization Code Flow、Tool Result Elision 等关键能力。当前 FlowForge 集成的旧版 MCP 不兼容。

**需求**：

- **M2.1 Stateless Core**：MCP Server 无状态化
  - 所有状态由 Client 维护（Session ID 透传）
  - Server 重启不影响进行中的会话
  - 支持水平扩展（多副本部署）

- **M2.2 MCP Apps**：每个 MCP Server 是一个可发现、可安装的"应用"
  - `/.well-known/mcp-manifest.json` 自动发现
  - Marketplace 集成（M17 Skill 市场共享）
  - OAuth Authorization Code Flow 标准登录
  - 用户级授权（非全局 API Key）

- **M2.3 Tool Result Elision**：工具结果自动裁剪
  - 长结果自动摘要（>4K tokens 触发）
  - 历史结果折叠（保留最近 N 次完整，旧版摘要）
  - 与 M3 Context Editing 协同

- **M2.4 EMA（Enterprise MCP Adapter）**：
  - 企业内部 MCP 网关聚合
  - 统一鉴权、审计、限流
  - 多版本兼容（v2024 / v2026 RC）

- **M2.5 MCP 工具沙箱强化**：
  - Container Isolation（Docker per tool）
  - Resource Limit（CPU/Memory/Network）
  - Network Egress Allowlist（防止数据外泄）
  - 与 M4 六层 Guardrails 协同

**设计要点**：
- 现有 `flowforge/mcp/` 模块重构为 v2026 RC 兼容
- 工具清单 YAML 化（`config/mcp_tools/*.yaml`），含 OAuth 配置
- MCP Server 状态外置到 Redis
- 兼容旧版 MCP（Feature Flag 控制）

**验收标准**：
- ✅ MCP Server 无状态化，重启不影响会话
- ✅ `/.well-known/mcp-manifest.json` 自动发现可用
- ✅ OAuth Authorization Code Flow 跑通
- ✅ Tool Result Elision 触发率监控（>4K 自动摘要）
- ✅ 工具沙箱隔离测试通过（CVE-2025-47241 类漏洞已修复）

---

### 模块 M3：Context Engineering 2.0（JIT Context + Memory Tool + Context Editing）

**背景**：Anthropic《Effective Context Engineering》明确指出，Prompt Engineering 已死，Context Engineering 当立。核心是让 LLM"在合适的时间获得合适的信息"。

**需求**：

- **M3.1 JIT Context（Just-In-Time）注入**：
  - Agent 执行前不预加载所有上下文
  - 通过 `context_fetch` 工具按需获取
  - 上下文分层：System（永久）/ Persona（持久）/ Task（会话）/ Working（即时）
  - 自动预测所需上下文（LLM 调用 `context_predict` 工具决定加载哪些）

- **M3.2 Memory Tool**（让 LLM 自己管理上下文）：
  - `memory_save(key, value, ttl, scope)`：保存记忆
  - `memory_recall(query, top_k)`：语义检索记忆
  - `memory_forget(key)`：主动遗忘
  - `memory_compress(threshold)`：压缩旧记忆
  - 取代"系统提示词硬塞"模式

- **M3.3 Context Editing**（自动裁剪）：
  - Token 预算管理（每 Agent 调用上限 32K）
  - 历史消息滑动窗口（保留首尾，中间摘要）
  - 工具结果折叠（M2.3 协同）
  - 用户对话压缩（多轮对话自动总结）
  - 与 M8 自我纠错的 PreFlect 协同（事前预测上下文需求）

- **M3.4 Context Layer Manager 升级**：
  - 现有 `core/context_layer_manager.py` 升级为支持 JIT 模式
  - 每层 Context 可声明 `lazy: true`（按需加载）
  - 支持 `priority`（Token 不足时优先丢弃低优先级层）

- **M3.5 Context Caching**（与 M9 Prompt Caching 协同）：
  - 系统/Persona 层 Cache（命中免重算）
  - Cache Key 基于 content hash
  - Cache 失效策略（TTL + 主动失效）

**设计要点**：
- Memory Tool 通过 `ToolRegistry` 注册，遵守 DI
- Context Editing 算法可配置（YAML 策略）
- JIT 注入由 Planner Agent 决策
- 所有 Context 操作 OTel Trace（M5）

**验收标准**：
- ✅ JIT Context 模式下，单次 Agent 调用 Token 数下降 ≥ 40%
- ✅ Memory Tool 4 个 API 全部可用且 OTel Trace 覆盖
- ✅ Context Editing 在 50 轮对话后 Token 仍稳定在 32K 以内
- ✅ Context Cache 命中率 ≥ 60%（同 Persona 内）
- ✅ T7 审核通过率不下降（Context 减少不影响内容质量）

---

### 模块 M4：六层 Guardrails 闭环

**背景**：NVIDIA NeMo Guardrails、Meta LlamaFirewall、Microsoft Spotlighting 已成为工业标准。当前 FlowForge 4 护栏不完整，缺 Input/Output Validation 闭环、Action Confirmation。

**需求**：

- **M4.1 Layer 1: Input Validation**（输入验证）
  - Prompt Injection 检测（基于 LLM-as-Judge）
  - Jailbreak 检测（关键词 + 模式匹配）
  - PII 检测（身份证 / 手机 / 邮箱 / 银行卡）
  - 输入长度 / 复杂度限制
  - 多语言输入识别

- **M4.2 Layer 2: System Prompt Constraints**（系统提示词约束）
  - AGENTS.md 自动注入（项目规则）
  - Skill 白名单注入（仅授权 Skill 可用）
  - Linter 规则注入（代码风格）
  - 权限管线（M11 CHEQ 协同）
  - 防泄露（System Prompt 不输出给用户）

- **M4.3 Layer 3: Tool Allow-lists**（工具白名单）
  - 每个 Agent 声明可用工具集（YAML）
  - 运行时强制校验（不在白名单的工具不可调用）
  - 工具参数 Schema 校验（Pydantic）
  - 工具调用频率限制（每分钟 N 次）
  - 与 M2 MCP 沙箱协同

- **M4.4 Layer 4: Output Validation**（输出验证）
  - 内容审核（暴力 / 色情 / 政治 / 违法）
  - 事实核查（fact_check 工具强制调用）
  - 代码安全扫描（SAST / 依赖漏洞）
  - 输出格式校验（JSON Schema / Markdown 结构）
  - AI 痕迹检测（T7 标准）

- **M4.5 Layer 5: Action Confirmation**（行动确认）
  - 高风险 Action 列表：发布 / 删除 / 部署 / 数据库迁移 / 资金操作
  - 二次确认机制（用户 Web UI / 即时通讯）
  - Blast-radius Gate（M12 协同）：影响范围 > N 时双人审批
  - 时间窗口限制（高风险 Action 24h 内可撤销）

- **M4.6 Layer 6: Cost Ceilings**（成本上限）
  - 每会话成本上限（默认 $10）
  - 每日成本上限（默认 $100）
  - 每月成本上限（默认 $1000）
  - 超额自动熔断（拒绝新请求）
  - 实时成本仪表盘（Web UI）

- **M4.7 Guardrails 策略 YAML**：
  ```yaml
  # config/guardrails/policy.yaml
  input_validation:
    prompt_injection_detection: llm_judge
    jailbreak_detection: [keyword, pattern]
    pii_detection: [id_card, phone, email, bank_card]
    max_input_length: 8192
  
  system_prompt_constraints:
    auto_inject: [AGENTS.md, skill_whitelist, linter_rules]
    leak_prevention: true
  
  tool_allowlists:
    contentforge:writer:
      tools: [web_search, opensieve_search, memory_recall]
      rate_limit: 30/min
  
  output_validation:
    content_moderation: doubao_moderation
    fact_check_required: true
    code_security_scan: [bandit, semgrep]
    ai_flavor_detection: t7
  
  action_confirmation:
    high_risk_actions:
      - publish_to_production
      - database_migration
      - deployment
    blast_radius_threshold: 100
    revocation_window: 24h
  
  cost_ceilings:
    session: 10
    daily: 100
    monthly: 1000
  ```

**验收标准**：
- ✅ 六层 Guardrails 全部启用且 OTel Trace
- ✅ Prompt Injection 测试集（50 例）检出率 ≥ 95%
- ✅ 高风险 Action 二次确认机制 100% 覆盖
- ✅ 成本上限熔断触发后新请求被拒绝
- ✅ Guardrails 策略 YAML 全部外置（红线 11）

---

### 模块 M5：OpenTelemetry GenAI v1.30 可观测性

**背景**：OTel GenAI v1.30 已是国际标准，`gen_ai.*` span schema 被 LangSmith/Langfuse/Phoenix 等广泛支持。当前 FlowForge 自有 Tracing 不兼容。

**需求**：

- **M5.1 OTel GenAI Span Schema**：
  - 所有 LLM 调用生成 `gen_ai.llm` Span
  - Span 属性：`gen_ai.system`、`gen_ai.request.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.response.finish_reason`
  - Tool 调用生成 `gen_ai.tool` Span
  - Agent 执行生成 `gen_ai.agent` Span

- **M5.2 Trace 端到端串联**：
  - 用户请求 → Gateway → Harness → Engine → Agent → Tool → LLM
  - 全链路一个 Trace ID
  - 支持 Distributed Tracing（跨 A2A 调用）

- **M5.3 Eval-gated Deployment**（评估驱动发布）：
  - 发布前自动跑 τ-bench 评估
  - pass^k 阈值（k=5，pass 率 ≥ 4/5）
  - 未达标自动回滚
  - 评估报告 OTel Trace 化

- **M5.4 Metrics 标准化**：
  - `gen_ai.client.token_usage`（Counter）
  - `gen_ai.client.operation_duration`（Histogram）
  - `gen_ai.server.active_requests`（UpDownCounter）
  - 与现有 `observability/metrics_collector.py` 对齐

- **M5.5 Exporter 多后端**：
  - OTLP gRPC（默认）
  - LangSmith（按需）
  - Langfuse（按需）
  - Phoenix（按需）
  - 配置驱动（`config/observability.yaml`）

- **M5.6 Trace UI 集成**：
  - Helm UI 嵌入 Trace 视图
  - 支持 Span 树形展开
  - LLM Input/Output 可查看
  - 错误 Span 高亮

- **M5.7 告警规则**：
  - LLM 调用失败率 > 5% 告警
  - 平均延迟 > 30s 告警
  - Token 使用量异常增长告警
  - Cache 命中率 < 50% 告警（M9 协同）

**验收标准**：
- ✅ 所有 LLM/Tool/Agent 调用生成标准 `gen_ai.*` Span
- ✅ Trace 端到端串联（用户→LLM 一个 Trace ID）
- ✅ OTLP/LangSmith/Langfuse/Phoenix 至少 2 个 Exporter 可用
- ✅ Eval-gated 发布门禁阻断不合格版本
- ✅ Helm UI Trace 视图可查看完整 Span 树

---

### 模块 M6：Agent 评估框架（τ-bench pass^k + SWE-bench Pro）

**背景**：τ-bench pass^k（k 次执行通过率）评估 Agent 可靠性，SWE-bench Pro 评估代码能力。单一 pass@1 已不满足工业级要求。

**需求**：

- **M6.1 τ-bench pass^k 评估**：
  - 同一任务跑 k 次（默认 k=5）
  - 统计通过率分布（k=1/3/5）
  - 失败模式分类（工具错 / 推理错 / 上下文不足 / 超时）
  - 评估报告 OTel Trace 化

- **M6.2 SWE-bench Pro 子集**：
  - DevForge 必须跑 SWE-bench Pro 子集
  - MR Difficulty Filter（按难度筛选）
  - 自动 PR 提交验证
  - 与 GitHub Actions 集成

- **M6.3 AgentBox 沙箱化评估**：
  - 评估环境隔离（Docker）
  - 真实工具调用（非 Mock）
  - 与 T1 测试铁律对齐（禁 Mock LLM）

- **M6.4 在线评估**：
  - 生产流量采样（1%）
  - 影子评估（不返回用户，仅记录）
  - A/B 评估（新旧版本对比）

- **M6.5 Eval Dataset 管理**：
  - 数据集版本化（Git LFS）
  - 数据集生成器（基于真实场景）
  - 数据集质量审核（T7 LLM 审核）
  - 与 M17 Skill 市场共享

- **M6.6 评估指标扩展**：
  - pass^k 可靠性分布
  - 成本（tokens/$）
  - 延迟（P50/P95/P99）
  - 工具调用次数
  - 上下文使用率
  - HITL 介入率

**验收标准**：
- ✅ τ-bench pass^5 ≥ 80%（核心场景）
- ✅ SWE-bench Pro 子集 ≥ 30%（DevForge）
- ✅ 评估报告全 OTel Trace
- ✅ 在线评估影子模式不影响生产
- ✅ 评估数据集 ≥ 1000 例，T7 审核通过

---

### 模块 M7：Durable Execution + 长程任务管理

**背景**：Anthropic 报告 Agent 已可连续运行 30+ 小时。关键能力：Checkpoint 持久化、Initializer + Coding Agent 双阶段、状态对齐。

**需求**：

- **M7.1 Durable Execution**：
  - 每个 Agent Step 写入 Durable Event Log（PostgreSQL）
  - Step 包含：输入 / 输出 / 状态 / 时间戳 / Trace ID
  - 故障后从最近 Checkpoint 恢复
  - 与现有 `core/checkpoint_manager.py` 升级

- **M7.2 长程任务（>1 小时）**：
  - 任务分阶段（Phase 0..N）
  - 每阶段独立 Checkpoint
  - 阶段间状态对齐（State Alignment）
  - 跨阶段 Memory 持久化（M3 Memory Tool）
  - 任务可暂停 / 恢复 / 取消

- **M7.3 超长任务（>8 小时）**：
  - Initializer Agent 阶段（规划 + 资源准备）
  - Coding Agent 阶段（执行 + 增量交付）
  - 双阶段间通过 Durable State 传递
  - 支持中断后重启（恢复到上次中断点）

- **M7.4 Saga 模式**（分布式事务）：
  - 多 Agent 协作的事务管理
  - 每个 Agent 调用可补偿（Compensation）
  - 失败时自动回滚已完成步骤
  - 与 M15 故障恢复协同

- **M7.5 Outbox Pattern**：
  - 事件可靠投递
  - 数据库 + 消息队列双写一致性
  - 至少一次投递
  - 与 M1 A2A 协同

- **M7.6 状态对齐**（State Alignment）：
  - 恢复后 LLM 重新理解当前状态
  - 通过 `state_summarize` 工具生成状态摘要
  - 摘要注入下次 LLM 调用上下文
  - 防止状态丢失 / 偏差

**设计要点**：
- Durable Event Log 复用 `events/durable_stream.py`
- Saga 协调器新模块 `core/saga_coordinator.py`
- 长程任务配置 YAML（`config/long_run/*.yaml`）
- 所有 Checkpoint OTel Trace

**验收标准**：
- ✅ Agent 中断后从 Checkpoint 恢复，状态一致
- ✅ 30+ 小时长程任务跑通（DevForge 完整项目开发）
- ✅ Saga 多 Agent 事务失败自动回滚
- ✅ Outbox 事件不丢失（重启后重投）
- ✅ 状态对齐后 LLM 决策与中断前一致

---

### 模块 M8：自我纠错 2.0（PreFlect + VIGIL + SAGE）

**背景**：当前 Reflexion 是"事后反思"。大厂最新方向是"事前预防 + 多假设故障归因"。

**需求**：

- **M8.1 PreFlect（事前预防）**：
  - Agent 执行前先预测可能的失败模式
  - 生成预防策略（注入 System Prompt）
  - 与 M3 JIT Context 协同（预测所需上下文）
  - 与 M4 六层 Guardrails 协同（预测高风险 Action）

- **M8.2 VIGIL Reflective Runtime**（运行时监控）：
  - Agent 执行中实时监控异常信号
  - 检测：循环 / 死锁 / 工具滥用 / Token 爆炸
  - 异常时自动中断 + 反思
  - 反思结果注入下次执行

- **M8.3 SAGE 多假设故障归因**：
  - 故障后生成多个根因假设
  - 每个假设独立验证（LLM-as-Judge）
  - 选出最可能的根因
  - 生成修复策略

- **M8.4 Reflexion 上限**（沿用 v2.1）：
  - 默认 3-5 次反思上限
  - 超过上限进入 HITL（M11）
  - 反思历史 Memory 化（M3 协同）

- **M8.5 自我修复策略库**：
  - 策略 YAML 化（`config/reflection_strategies/*.yaml`）
  - 按失败类型匹配修复策略
  - 策略可继承 / 覆盖
  - 与 M17 Skill 市场共享

**验收标准**：
- ✅ PreFlect 预测准确率 ≥ 70%（Top-3 假设覆盖实际失败）
- ✅ VIGIL 实时检测循环 / 死锁，100ms 内中断
- ✅ SAGE 多假设归因，根因 Top-1 准确率 ≥ 60%
- ✅ Reflexion 上限触发 HITL 100% 覆盖
- ✅ 自我修复策略库 ≥ 20 个策略

---

### 模块 M9：Prompt Caching + 智能 Cost-Aware Routing

**背景**：Anthropic Prompt Caching 可降 45-80% 成本。当前 FlowForge 无缓存能力，每次 LLM 调用全量计算。

**需求**：

- **M9.1 Prompt Caching**：
  - 系统 / Persona 层 Cache（命中免重算）
  - Cache Key 基于 content hash
  - Cache TTL 配置（默认 1h）
  - Cache 主动失效（Persona 更新触发）
  - 支持 Anthropic / OpenAI / Google 等多 Provider

- **M9.2 Cache Hit Rate 监控**：
  - 实时命中率仪表盘
  - 命中率 < 50% 告警
  - 按模型 / Persona / 任务类型分类统计

- **M9.3 智能 Cost-Aware Routing**：
  - 任务难度评估（LLM-as-Judge）
  - 简单任务 → 低成本模型（如 Haiku）
  - 复杂任务 → 高能力模型（如 Sonnet）
  - 与现有 `llm/route.py` 升级
  - 路由策略 YAML 化

- **M9.4 多 Provider 配额池**：
  - 跨 Provider 配额统一管理
  - Provider 故障自动切换（已有基础）
  - 配额预警（80% 告警）
  - 配额借用（临时从其他 Provider 借）

- **M9.5 Token 预算管理**：
  - 每任务 Token 预算（默认 100K）
  - 每会话 Token 预算（默认 1M）
  - 超预算触发降级（简短模式 / 拒绝）
  - 与 M4 Cost Ceilings 协同

- **M9.6 成本归因**：
  - 成本按 tenant / agent / task / user 归因
  - 成本报表（日报 / 周报 / 月报）
  - 成本异常检测（突增告警）
  - 与 OTel Metrics 协同（M5）

**验收标准**：
- ✅ Prompt Cache 命中率 ≥ 60%（同 Persona 内）
- ✅ 成本下降 ≥ 30%（同任务对比）
- ✅ Cost-Aware Routing 简单任务 80% 走低成本模型
- ✅ 多 Provider 配额池故障切换 < 1s
- ✅ 成本归因报表准确到 Agent 级

---

### 模块 M10：生产化部署（灰度 + A/B + Eval-gated）

**背景**：Agent 上生产必须灰度发布、A/B 测试、Eval-gated。当前 FlowForge 有 Canary 基础但不闭环。

**需求**：

- **M10.1 灰度发布增强**：
  - 流量百分比灰度（1% → 10% → 50% → 100%）
  - 用户标签灰度（白名单 / 黑名单）
  - 租户灰度（M16 协同）
  - 自动回滚（错误率 > 阈值）

- **M10.2 A/B 测试**：
  - 新旧版本流量对比
  - 关键指标对比（通过率 / 成本 / 延迟 / 用户满意度）
  - 统计显著性检验
  - 自动选优

- **M10.3 Eval-gated 发布门禁**：
  - 发布前自动跑 τ-bench（M6）
  - pass^5 ≥ 80% 才允许发布
  - 失败自动回滚
  - 与 CI/CD 集成

- **M10.4 自动回滚**：
  - 监控指标异常触发回滚
  - 回滚到上一个稳定版本
  - 回滚通知（即时通讯）
  - 回滚后自动根因分析（M8 SAGE）

- **M10.5 蓝绿部署**：
  - 新版本预热（Warm-up）
  - 切换瞬时（< 1s）
  - 失败快速回切

- **M10.6 发布审批流**：
  - 发布计划 YAML
  - 审批人列表
  - Blast-radius Gate（M12）
  - 与 M11 CHEQ 协同

**验收标准**：
- ✅ 灰度发布 1% → 100% 自动化
- ✅ A/B 测试统计显著性报告
- ✅ Eval-gated 阻断不合格版本
- ✅ 自动回滚 < 30s
- ✅ 发布审批流审计完整

---

### 模块 M11：HITL 2.0（IETF CHEQ + 三段式）

**背景**：IETF CHEQ 协议标准化人机协作中断恢复。三段式 HITL（高阻塞）/ HotL（人在线）/ HoverL（人旁观）已成共识。

**需求**：

- **M11.1 IETF CHEQ 协议**：
  - 标准化中断点（Interrupt Point）
  - 中断点持久化（重启可恢复）
  - 中断通知（Web UI / 即时通讯 / 邮件）
  - 用户响应超时策略（默认 / 拒绝 / 升级）

- **M11.2 三段式 HITL**：
  - **HITL（Human-In-The-Loop）**：高阻塞，必须等人
    - 场景：高风险 Action / 发布审批 / 内容审核
    - 超时策略：拒绝 / 升级
  - **HotL（Human-On-The-Loop）**：人在线，可干预
    - 场景：Agent 执行中可实时介入
    - 介入方式：Web UI 中断 / 修改 / 接管
  - **HoverL（Human-Over-The-Loop）**：人旁观
    - 场景：低风险任务监控
    - 介入方式：仅观察，事后审核

- **M11.3 ApprovalRequiredAIFunction**：
  - 标准化审批接口
  - 审批人列表（按角色 / 部门）
  - 多人会签（M-of-N）
  - 审批 SLA

- **M11.4 中断恢复**：
  - 重启后自动恢复到中断点
  - 状态对齐（M7 State Alignment）
  - 用户上下文补全（重述任务）

- **M11.5 DevForge IPD 门禁对接**：
  - DCP-1 / DCP-2 / DCP-3 等门禁点改为 CHEQ 标准化
  - TR-1~TR-6 技术评审改为 HotL 模式
  - 评审结果可追溯

**验收标准**：
- ✅ CHEQ 中断点重启后 100% 恢复
- ✅ 三段式 HITL/HotL/HoverL 全部支持
- ✅ ApprovalRequiredAIFunction 多人会签可用
- ✅ DevForge IPD 门禁 100% CHEQ 化
- ✅ 中断恢复状态对齐通过率 100%

---

### 模块 M12：Agent 治理（AgentBOM + Blast-radius Gates）

**背景**：CSA AGMM 5 级成熟度模型、AgentBOM（软件物料清单）、Blast-radius Gates 是工业级 Agent 治理三件套。

**需求**：

- **M12.1 AgentBOM（Agent Bill of Materials）**：
  - 每个 Agent 生成 BOM 文件
  - 包含：依赖模型 / 依赖工具 / 依赖 Skill / 依赖数据 / 权限 / 版本
  - 类似软件 SBOM，便于审计 / 漏洞追踪
  - YAML 格式，存 `config/agent_bom/*.yaml`

- **M12.2 Blast-radius Gates**：
  - 高风险 Action 影响范围评估
  - 影响范围 > 阈值触发双人审批
  - 影响范围 > 严重阈值触发升级审批
  - 与 M11 CHEQ 协同

- **M12.3 治理即代码**：
  - 治理策略 YAML 化
  - CI/CD 门禁化（发布前自动检查）
  - 策略版本化（Git）
  - 策略可审计（变更日志）

- **M12.4 审计链**：
  - Agent 调用全链路审计
  - 审计日志不可篡改（append-only）
  - 审计日志保留期（默认 1 年）
  - 审计查询 API

- **M12.5 合规检查器**：
  - 数据合规（GDPR / 等保 / 数据出境）
  - 行业合规（金融 / 医疗 / 教育）
  - 自动合规报告
  - 与 M6 评估框架协同

- **M12.6 CSA AGMM Level 4 认证**：
  - Identity & Access L4
  - Observability L4
  - Safety & Security L4
  - Compliance & Audit L4
  - Lifecycle Mgmt L4
  - Collaboration L4

**验收标准**：
- ✅ 所有 Agent 生成 AgentBOM 文件
- ✅ Blast-radius Gates 100% 覆盖高风险 Action
- ✅ 治理策略 YAML 化 + CI/CD 门禁
- ✅ 审计链不可篡改
- ✅ CSA AGMM 自评 ≥ Level 4

---

### 模块 M13：Computer Use / Browser Use / GUI Agent

**背景**：OSWorld 82.6% 已达工业可用。当前 FlowForge 仅有 Playwright 工具，缺 Visual Grounding / GUI Agent。

**需求**：

- **M13.1 Visual Grounding**：
  - 屏幕截图 → 元素定位
  - 支持 Bounding Box 输出
  - 与 Set-of-Mark prompting 协同
  - 多模态 LLM 集成（GPT-4V / Claude 3.5 Sonnet Vision）

- **M13.2 GUI Agent**：
  - 桌面 GUI 自动化（Windows / macOS / Linux）
  - 浏览器自动化（升级 Playwright）
  - 移动端 GUI（Android / iOS，可选）
  - 操作录制 / 回放

- **M13.3 Connector 优先策略**：
  - 优先使用 API / MCP
  - API 不可用时降级为 GUI
  - GUI 不可用时降级为截图识别
  - 降级策略 YAML 化

- **M13.4 安全加固**：
  - CVE-2025-47241 类漏洞修复
  - 沙箱隔离（Container / VM）
  - 操作录屏审计
  - 与 M4 六层 Guardrails 协同

- **M13.5 Browser Agent 增强**：
  - 多标签页管理
  - 表单自动填写
  - 验证码处理（人工兜底 / 2Captcha）
  - 反爬虫规避（与现有 `anti_detection.py` 协同）

**验收标准**：
- ✅ Visual Grounding 定位准确率 ≥ 85%
- ✅ GUI Agent 桌面 / 浏览器自动化可用
- ✅ Connector 优先策略降级链路完整
- ✅ CVE 类漏洞已修复
- ✅ Browser Agent 多场景跑通（登录 / 表单 / 发布）

---

### 模块 M14：A2A / ACP / MCP 三层协议栈

**背景**：MCP（工具）/ ACP（编排）/ A2A（协作）三层栈已成共识。当前 FlowForge 仅 MCP 一层。

**需求**：

- **M14.1 ACP（Agent Communication Protocol）编排层**：
  - IBM/Bee ACP 兼容
  - 多 Agent 编排（DAG / Workflow）
  - Agent 间消息传递（同步 / 异步）
  - 与现有 Workflow Compiler 协同

- **M14.2 三层栈集成**：
  - MCP：Agent ↔ Tool
  - ACP：Agent ↔ Agent（同实例内）
  - A2A：Agent ↔ Agent（跨实例 / 跨厂）
  - 自动选择协议（同实例 ACP / 跨实例 A2A）

- **M14.3 协议适配器**：
  - 统一接口 `AgentCommunicator`
  - 适配 MCP / ACP / A2A
  - 配置驱动选择（`config/comm/*.yaml`）

- **M14.4 协议网关**：
  - 跨协议转换（MCP ↔ ACP ↔ A2A）
  - 协议版本兼容
  - 协议安全（TLS / mTLS）

**验收标准**：
- ✅ ACP 编排层支持 DAG / Workflow
- ✅ 三层协议栈自动选择
- ✅ 协议适配器统一接口
- ✅ 跨协议转换可用
- ✅ 协议安全（TLS / mTLS）启用

---

### 模块 M15：故障恢复与降级（Durable + Self-healing）

**背景**：Durable Execution + Self-healing Runtime 是长程任务的基础。当前 FlowForge 仅有 Circuit Breaker。

**需求**：

- **M15.1 Self-healing Runtime**：
  - 自动检测 Soft Failure（隐性失败）
  - 自动恢复策略（重启 / 切换 / 降级）
  - 恢复后状态对齐（M7）
  - 恢复日志 OTel Trace

- **M15.2 Soft Failure Detection**：
  - LLM 返回空 / 重复 / 异常内容
  - 工具调用超时 / 失败
  - Agent 循环 / 死锁
  - 与 M8 VIGIL 协同

- **M15.3 降级链路**：
  - 模型降级（Sonnet → Haiku）
  - 工具降级（MCP → GUI → 截图）
  - 模式降级（Multi-Agent → Single Agent）
  - 任务降级（完整 → 简化）
  - 降级策略 YAML 化

- **M15.4 Circuit Breaker 增强**：
  - 现有 `core/circuit_breaker.py` 升级
  - 多维度熔断（错误率 / 延迟 / 流量）
  - 半开状态（Hawlf-Open）探测
  - 自动恢复

- **M15.5 Bulkhead 隔离**：
  - 资源隔离（线程池 / 连接池）
  - 故障隔离（一个 Agent 挂不影响其他）
  - 配额隔离（按 tenant）

- **M15.6 Timeout 策略**：
  - 每层超时配置（Agent / Tool / LLM）
  - 超时降级（而非直接失败）
  - 超时告警

**验收标准**：
- ✅ Self-healing Runtime 自动检测 + 恢复
- ✅ Soft Failure 检出率 ≥ 90%
- ✅ 降级链路完整（模型 / 工具 / 模式 / 任务）
- ✅ Circuit Breaker 多维度熔断
- ✅ Bulkhead 隔离测试通过

---

### 模块 M16：多租户隔离与配额治理

**背景**：当前 FlowForge 单租户，无法对外提供服务。多租户是商业化前提。

**需求**：

- **M16.1 Tenant 隔离**：
  - 数据隔离（每租户独立 Schema / DB）
  - 资源隔离（CPU / Memory / 连接池）
  - 配置隔离（每租户独立 config）
  - Skill 隔离（私有 / 共享）

- **M16.2 配额治理**：
  - 每租户配额（QPS / Token / 存储 / API 调用）
  - 配额预警（80% 告警）
  - 配额超限策略（拒绝 / 降级）
  - 配额借用（临时超额）

- **M16.3 租户鉴权**：
  - OAuth2 / SSO 集成
  - RBAC（基于角色）
  - ABAC（基于属性）
  - API Key 管理

- **M16.4 租户计费**：
  - 按使用量计费（Token / API 调用 / 存储）
  - 按订阅计费（套餐）
  - 计费报表
  - 与 M9 成本归因协同

- **M16.5 租户运维**：
  - 租户管理 Web UI
  - 租户健康度仪表盘
  - 租户级告警
  - 租户级日志查询

**验收标准**：
- ✅ Tenant 数据 / 资源 / 配置隔离 100%
- ✅ 配额治理预警 + 超限策略可用
- ✅ OAuth2 / SSO 集成
- ✅ 计费报表准确
- ✅ 租户运维 Web UI 完整

---

### 模块 M17：Skill 市场与外部生态

**背景**：Skill 内部化限制了生态。开放 Skill 市场是规模化关键。

**需求**：

- **M17.1 Skill 市场平台**：
  - Skill 上传 / 审核 / 发布
  - Skill 搜索 / 安装 / 评价
  - 版本化管理（SemVer）
  - 与 M2 MCP Apps 共享市场

- **M17.2 Skill 打包格式**：
  - Skill = YAML + Code + Tests + Docs
  - 打包为 `skill-{name}-{version}.zip`
  - 数字签名（防篡改）
  - AgentBOM 集成（M12）

- **M17.3 Skill 沙箱**：
  - 安装时沙箱测试
  - 运行时沙箱执行
  - 资源限制
  - 与 M2 MCP 沙箱协同

- **M17.4 Skill 分发**：
  - 公共市场（免费 / 付费）
  - 私有市场（企业内部）
  - 跨厂联邦（与 A2A Directory 协同）

- **M17.5 Skill 评价体系**：
  - 下载量 / 使用量
  - 用户评分（1-5 星）
  - 安全评分（自动扫描）
  - 质量评分（M6 评估）

**验收标准**：
- ✅ Skill 市场平台可用
- ✅ Skill 打包 + 数字签名
- ✅ Skill 沙箱测试通过
- ✅ 公共 / 私有 / 联邦分发
- ✅ Skill 评价体系完整

---

## 第五章：跨模块需求

### 5.1 配置驱动统一

所有新增模块的策略必须 YAML 化，禁止硬编码（红线 11）：
- `config/a2a/` - A2A 协议配置
- `config/mcp_v2026/` - MCP 2026 配置
- `config/context_engine/` - Context Engineering 策略
- `config/guardrails/` - 六层 Guardrails 策略
- `config/observability/` - OTel 配置
- `config/evaluation/` - 评估框架配置
- `config/durable/` - Durable Execution 配置
- `config/reflection/` - 自我纠错策略
- `config/cost/` - 成本优化配置
- `config/deployment/` - 发布策略
- `config/hitl/` - HITL 配置
- `config/governance/` - AgentBOM / Blast-radius 配置
- `config/computer_use/` - GUI Agent 配置
- `config/comm/` - 三层协议栈配置
- `config/tenant/` - 多租户配置
- `config/skill_market/` - Skill 市场配置

### 5.2 DI 容器合规

所有新增模块必须通过 DI 容器注入（红线 12）：
- A2A Server/Client 通过 `ToolRegistry` 注册
- MCP 2026 通过 `Plugin` 注册
- Guardrails 通过 `Gate` 注册
- OTel 通过 `Tracing` 注册
- 评估框架通过 `Evaluator` 注册
- Durable 通过 `EventBus` 注册

### 5.3 单向依赖

严格遵守分层单向依赖（红线）：
- 互联层（M1, M14）→ 应用层 → Gateway → Harness → Engine → Capability → Infrastructure
- 上层禁止 import 下层模块
- FlowForge 禁止 import *Forge 模块

### 5.4 OTel Trace 全覆盖

所有新增模块必须 OTel Trace：
- A2A 调用 Span
- MCP 调用 Span
- Context 操作 Span
- Guardrails 检查 Span
- 评估 Span
- Durable Checkpoint Span
- 自我纠错 Span
- 成本记录 Span
- 发布门禁 Span
- HITL 中断 Span
- 治理审计 Span
- GUI 操作 Span
- 故障恢复 Span

### 5.5 测试铁律扩展

在 T1-T9 基础上新增：
- **T10**: OTel Trace 完整性测试 - 必须验证每个 Span 完整生成
- **T11**: A2A 协议合规测试 - 必须验证 Agent Card / Task / SSE 标准
- **T12**: Durable Execution 测试 - 必须验证中断恢复状态一致
- **T13**: Guardrails 闭环测试 - 必须验证六层 Guardrails 全部触发
- **T14**: Eval-gated 测试 - 必须验证不合格版本被阻断
- **T15**: AgentBOM 完整性测试 - 必须验证 BOM 文件完整

### 5.6 安全红线扩展

在 15 条编程红线基础上新增：
- **红线 16**: A2A 调用必须鉴权（Bearer / OAuth2）
- **红线 17**: MCP 工具必须沙箱执行
- **红线 18**: 高风险 Action 必须 Blast-radius Gate
- **红线 19**: Skill 安装必须数字签名验证
- **红线 20**: Tenant 数据必须隔离

### 5.7 性能 SLO

| 场景 | SLO |
|------|-----|
| LLM 单次调用 | P95 < 30s（沿用 v2.1） |
| Agent 单步执行 | P95 < 60s |
| Loop 完整执行 | P95 < 3min（ContentForge 沿用） |
| A2A 任务下发 | P95 < 1s |
| MCP 工具调用 | P95 < 5s |
| OTel Trace 上报 | P95 < 100ms |
| Durable Checkpoint | P95 < 500ms |
| 长程任务（30h+） | 稳定运行不崩溃 |

### 5.8 Web UI 增强

- **Helm UI** 新增面板：
  - A2A Directory（Agent 发现）
  - Trace View（OTel 链路）
  - Eval Dashboard（评估报告）
  - Cost Dashboard（成本仪表盘）
  - HITL Queue（人机协作队列）
  - Audit Trail（审计链）
  - Tenant Manager（租户管理）
  - Skill Marketplace（Skill 市场）

- **移动端适配**：
  - HITL 审批移动端可用
  - 关键告警移动推送

---

## 第六章：优先级与路线图

### 6.1 优先级分级

| 优先级 | 模块 | 说明 |
|--------|------|------|
| **P0** | M1 A2A | 跨厂互联基础 |
| **P0** | M2 MCP 2026 | 协议升级基础 |
| **P0** | M3 Context Eng 2.0 | 性能与质量基础 |
| **P0** | M4 六层 Guardrails | 安全闭环 |
| **P0** | M5 OTel GenAI | 可观测性基础 |
| **P1** | M6 评估框架 | 质量保证 |
| **P1** | M7 Durable + 长程 | 可靠性基础 |
| **P1** | M8 自我纠错 2.0 | 质量提升 |
| **P1** | M9 Prompt Caching | 成本优化 |
| **P1** | M10 生产化部署 | 商业化基础 |
| **P1** | M11 HITL 2.0 | 人机协作 |
| **P1** | M15 故障恢复 | 可靠性 |
| **P2** | M12 Agent 治理 | 合规 |
| **P2** | M13 Computer Use | GUI 自动化 |
| **P2** | M14 三层协议栈 | 协议完整 |
| **P2** | M16 多租户 | 商业化 |
| **P2** | M17 Skill 市场 | 生态 |

### 6.2 路线图

**Phase 6.0（P0，2 个月）**：
- M1 A2A Server/Client + Agent Card + Directory
- M2 MCP 2026 Stateless Core + Apps + OAuth
- M3 Context Engineering 2.0（JIT + Memory Tool + Editing）
- M4 六层 Guardrails 闭环
- M5 OTel GenAI v1.30 全链路
- 新增 T10-T13 测试铁律

**Phase 6.1（P1，3 个月）**：
- M6 τ-bench pass^k + SWE-bench Pro
- M7 Durable Execution + 30h 长程任务
- M8 PreFlect + VIGIL + SAGE
- M9 Prompt Caching + Cost-Aware Routing
- M10 灰度 + A/B + Eval-gated
- M11 IETF CHEQ + 三段式 HITL
- M15 Self-healing Runtime + 降级链路

**Phase 6.2（P2，2 个月）**：
- M12 AgentBOM + Blast-radius + 治理即代码
- M13 Computer Use + Browser Agent
- M14 ACP + 三层协议栈
- M16 多租户 + 配额
- M17 Skill 市场
- 新增 T14-T15 测试铁律
- CSA AGMM Level 4 自评

**Phase 6.3（生态化，持续）**：
- Skill 市场生态运营
- A2A 跨厂联邦
- CSA AGMM Level 5 认证
- 商业化 SaaS

### 6.3 里程碑

| 里程碑 | 时间 | 标准 |
|--------|------|------|
| **M6.0-Alpha** | 第 4 周 | A2A + MCP 2026 基础跑通 |
| **M6.0-Beta** | 第 8 周 | P0 全部完成，T10-T13 通过 |
| **M6.0-RC** | 第 10 周 | P0 全量验证，性能 SLO 达标 |
| **M6.0-GA** | 第 12 周 | P0 正式发布 |
| **M6.1-Alpha** | 第 16 周 | P1 模块跑通 |
| **M6.1-Beta** | 第 20 周 | P1 全部完成 |
| **M6.1-RC** | 第 22 周 | P1 全量验证 |
| **M6.1-GA** | 第 24 周 | P1 正式发布 |
| **M6.2-Alpha** | 第 28 周 | P2 模块跑通 |
| **M6.2-GA** | 第 32 周 | P2 正式发布，CSA AGMM L4 |

---

## 第七章：质量与测试要求

### 7.1 测试铁律（T1-T15）

| 编号 | 铁律 | 说明 |
|------|------|------|
| T1 | 禁用 Mock LLM | 沿用 |
| T2 | 禁用假数据 | 沿用 |
| T3 | 禁止跳过验证 | 沿用 |
| T4 | 禁止 Mock 工具 | 沿用 |
| T5 | 未实现即 Bug | 沿用 |
| T6 | 必采集指标 | 沿用 |
| T7 | LLM 内容必须经 LLM 审核 | 沿用 |
| T8 | Web 功能必须浏览器验证 DOM | 沿用 |
| T9 | （沿用）| 沿用 |
| **T10** | OTel Trace 完整性 | 新增：必须验证每个 Span 完整生成 |
| **T11** | A2A 协议合规 | 新增：必须验证 Agent Card / Task / SSE 标准 |
| **T12** | Durable Execution | 新增：必须验证中断恢复状态一致 |
| **T13** | Guardrails 闭环 | 新增：必须验证六层 Guardrails 全部触发 |
| **T14** | Eval-gated | 新增：必须验证不合格版本被阻断 |
| **T15** | AgentBOM 完整性 | 新增：必须验证 BOM 文件完整 |

### 7.2 验收标准汇总

每个模块的验收标准见第四章。整体验收需满足：
- T1-T15 全部通过
- 性能 SLO 全部达标
- 安全红线 16-20 全部遵守
- CSA AGMM 自评 ≥ Level 4

### 7.3 持续验证

- CI/CD 流水线集成所有测试
- 每日 nightly build 跑 τ-bench
- 每周跑 SWE-bench Pro 子集
- 每月跑 CSA AGMM 自评

---

## 第八章：风险与缓解

### 8.1 技术风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| A2A 协议变化 | 中 | 高 | 跟踪 Linux Foundation，预留适配层 |
| MCP 2026 Spec 延迟 | 中 | 高 | 兼容旧版 + Feature Flag |
| OTel GenAI 版本升级 | 低 | 中 | Exporter 多版本兼容 |
| 长程任务内存泄漏 | 高 | 高 | 内存监控 + 自动重启 |
| Prompt Cache 失效频繁 | 中 | 中 | TTL 调优 + 主动失效策略 |
| 多租户隔离不彻底 | 中 | 高 | 渗透测试 + 审计 |
| Skill 市场安全风险 | 高 | 高 | 沙箱 + 数字签名 + 审核 |

### 8.2 工程风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 模块间耦合过紧 | 中 | 高 | 严格单向依赖 + 接口隔离 |
| 配置爆炸 | 高 | 中 | 配置继承 + 模板化 |
| 测试用例指数增长 | 高 | 中 | 测试分层 + 自动化生成 |
| 性能回归 | 中 | 高 | 性能基准 + 自动告警 |
| 文档滞后 | 高 | 中 | 文档即代码 + 自动生成 |

### 8.3 业务风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 大厂方案变化 | 高 | 中 | 持续跟踪 + 季度评估 |
| 竞品抢先 | 中 | 中 | 差异化定位（中文场景 + IPD） |
| 用户接受度 | 中 | 高 | 渐进发布 + 用户教育 |
| 商业化失败 | 中 | 高 | 开源 + 增值服务 |

---

## 第九章：附录

### 9.1 术语表

| 术语 | 全称 | 说明 |
|------|------|------|
| A2A | Agent-to-Agent | Google 跨厂 Agent 通信协议 |
| ACP | Agent Communication Protocol | IBM/Bee Agent 编排协议 |
| MCP | Model Context Protocol | Anthropic Agent ↔ Tool 协议 |
| OTel | OpenTelemetry | 开源可观测性标准 |
| GenAI | Generative AI | 生成式 AI |
| AGMM | Agent Governance Maturity Model | CSA Agent 治理成熟度模型 |
| AgentBOM | Agent Bill of Materials | Agent 软件物料清单 |
| HITL | Human-In-The-Loop | 人机协作 |
| HotL | Human-On-The-Loop | 人在线 |
| HoverL | Human-Over-The-Loop | 人旁观 |
| CHEQ | (IETF) | 人机协作中断恢复协议 |
| τ-bench | tau-bench | Agent 可靠性基准 |
| SWE-bench | Software Engineering Bench | 代码能力基准 |
| pass^k | pass at k | k 次执行通过率 |
| JIT | Just-In-Time | 按需 |
| Saga | Saga Pattern | 分布式事务模式 |
| Outbox | Outbox Pattern | 事件可靠投递模式 |
| Durable | Durable Execution | 持久化执行 |
| Self-healing | Self-healing Runtime | 自愈运行时 |
| Blast-radius | Blast Radius | 影响范围 |
| SBOM | Software Bill of Materials | 软件物料清单 |

### 9.2 参考标准

- A2A Protocol Specification (Linux Foundation, 2026)
- MCP 2026 Spec RC (2026-07-28)
- OpenTelemetry GenAI v1.30
- IETF CHEQ Draft
- CSA AGMM v1.0
- Anthropic Effective Context Engineering
- Anthropic Prompt Caching
- NVIDIA NeMo Guardrails
- Meta LlamaFirewall
- Microsoft Spotlighting
- τ-bench: A Benchmark for Agent Reliability
- SWE-bench Pro

### 9.3 关联文档

- `flowforge/docs/spec.md` v2.1（前置依赖）
- `devforge/docs/spec.md` v2.1（前置依赖）
- `contentforge/docs/spec.md`（业务层）
- `novelforge/docs/spec.md`（业务层）
- `mallforge/docs/spec.md`（业务层）
- `stockforge/docs/spec.md`（业务层）
- `hiclaw/rules.md`（开发规范，最高优先级）
- `hiclaw/prompts.md`（提示词模板库，最高优先级）
- `flowforge/docs/arch.md`（架构总览）
- `flowforge/docs/loop.md`（Loop 引擎设计）
- `flowforge/docs/mcp_migration_guide.md`（MCP 迁移指南）

### 9.4 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v3.0-face-draft | 2026-07-14 | 初稿，基于大厂面试一手信息规划 17 大模块 |

### 9.5 待用户审核决策点

请用户重点审核以下决策点：

1. **优先级排序**：P0/P1/P2 划分是否符合预期？是否需要调整？
2. **A2A 集成深度**：是否需要完整 A2A Server/Client，还是仅 Client？
3. **MCP 2026 升级时机**：是否等 Spec RC 正式发布（2026-07-28）后启动？
4. **Context Engineering 范围**：是否全部采用 JIT，还是渐进式？
5. **多租户策略**：是否 v3.0 即支持，还是延后到 v3.1？
6. **Skill 市场**：是否 v3.0 即开放，还是先内部?
7. **Computer Use 范围**：是否包含移动端 GUI？
8. **测试铁律扩展**：T10-T15 是否全部纳入，还是分阶段?
9. **路线图时间**：Phase 6.0/6.1/6.2 时间是否合理？是否需要调整?
10. **CSA AGMM 目标**：是否冲击 Level 5，还是稳定 Level 4?
11. **商业化方向**：是否在 v3.0 即考虑 SaaS 化，还是先内部使用?
12. **大厂动态遗漏**：是否有其他大厂方向需要补充（如联邦学习 / 隐私计算 / 端侧 Agent 等）?

---

> **本文档为 FlowForge v3.0 进化需求规格补充稿，待用户审核。**
> **审核通过后，将拆解为 task.md（任务清单）和 arch.md（架构详设）执行。**
> **所有实现必须严格遵守 `hiclaw/rules.md` 和 `hiclaw/prompts.md`。**

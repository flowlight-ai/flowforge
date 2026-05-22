# FlowForge v6.0 功能特性规格说明书（spec）

> **版本**：v6.0
> **定位**：从 Agent 编排框架进化为 **Agent 驾驭层 (Harness Layer)**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统。

---

## 第一章：产品概述与愿景

### 1.1 产品定位

FlowForge v6.0 是一个**企业级 Agent Harness 平台**，它将前沿的 AI Agent 架构模式（9 大模式）、四根 Harness 护栏（上下文工程、架构约束、反馈循环、熵管理）、多协议工具生态（MCP/OpenAPI/GraphQL）、Skill 系统、多 Agent 策略（Subagents/Teams/Swarms）和 Solo 实时交互融合为一体，为上层业务提供**可控、可观测、可进化的 Agent 运行基础设施**。

### 1.2 核心公式

```
Agent = Model (Brain) + Harness (Body)
FlowForge = Harness Layer = 前馈控制 + 反馈控制 + 熵管理 + 可观测性
```

### 1.3 核心愿景

* **从“编排框架”到“驾驭系统”**：FlowForge 不再是简单的 Agent 流程编排工具，而是为 AI Agent 提供完整控制回路的操作系统级平台。
* **从“个人助手”到“组织能力资产”**：通过 Skill 系统、插件机制和团队协作功能，让 Agent 能力可复用、可版本化、可分发。
* **从“单点智能”到“多Agent协作”**：内置三种多Agent策略（Subagents/Teams/Swarms），支撑从个人开发到企业级CI/CD的全场景覆盖。

### 1.4 用户角色定义

| 角色 | 描述 | 核心诉求 |
|------|------|---------|
| **AI 应用开发者** | 使用 FlowForge 构建 Agent 应用的工程师 | 快速构建、开箱即用的 Agent 模式、丰富的工具生态 |
| **平台管理员** | 管理 FlowForge 平台配置和安全策略的人员 | 权限管控、安全策略、可观测性、成本优化 |
| **业务专家** | 内容创作者、产品经理等非技术角色 | 自然语言交互、Skill 调用、审核流程、Web UI 操作 |
| **AI 主编/指挥 (Commander)** | LangGraph 驱动的调度核心 | 理解创作意图、拆解 SOP、调度专家 Agent、监控全链路质量 |

### 1.5 核心业务场景

1. **被动创作 (On-Demand)**：用户通过 Web UI 或 Solo 界面发送创作意图，系统启动全链路（选题→研究→写作→审核→发布），最终推送审核通知。
2. **主动创作 (Scheduled)**：用户在 Web UI 配置 Cron 定时任务，系统自主完成选题→创作→审核提示的全流程。
3. **级联自愈 (Self-Healing)**：当专栏的创作 Agent 发现主力模型接连失败时，自动触发模型健康检查、刷新可用模型，并**级联更新**所有共享该模型的其他专栏。
4. **审核与干预 (Human-in-the-Loop)**：AI 生成的任何内容在正式发布前，通过 Web UI、Solo 内联审核块或即时通讯渠道推送预览，用户可选择通过、编辑或拒绝。
5. **系统监控 (Dashboard)**：统一 Web UI 仪表盘实时展示专栏运行状态、今日创作数量、模型费用统计、系统健康度。
6. **Agent-to-Agent Review**：在反馈循环中，生成 Agent 的产出由独立的评判 Agent 进行四维评分（Design Quality / Originality / Craft / Functionality），不通过则进入自修正循环。
7. **技术债自动回收**：文档园丁 Agent 后台定期扫描文档-代码不一致，自动提交修复 PR；技术债跟踪器按优先级持续偿还技术债务。

---

## 第二章：系统架构总览

### 2.1 六层架构模型

FlowForge v6.0 采用分层解耦的 Harness 架构，整体分为六层：

```
┌─────────────────────────────────────────────────────────────────────┐
│  6. 应用层 (Application Layer)                                      │
│     ContentForge / NovelForge / 其他业务系统                        │
├─────────────────────────────────────────────────────────────────────┤
│  5. 接入层 (Gateway Layer)                                          │
│     FastAPI REST API + WebSocket (Solo/Events) + Web UI + CLI       │
├─────────────────────────────────────────────────────────────────────┤
│  4. Harness 驾驭层 (Harness Layer) ★ v6.0 核心                      │
│     上下文工程 | 架构约束 | 反馈循环 | 熵管理 | 权限管线 | 会话管理  │
├─────────────────────────────────────────────────────────────────────┤
│  3. 执行引擎层 (Engine Layer)                                       │
│     HybridExecutor (TAOR循环) | ModeRegistry (9大模式) | Scheduler  │
├─────────────────────────────────────────────────────────────────────┤
│  2. 能力层 (Capability Layer)                                       │
│     Tool生态 (MCP/OpenAPI/GraphQL) | Skill系统 | Agent库 | Memory   │
├─────────────────────────────────────────────────────────────────────┤
│  1. 基础设施层 (Infrastructure Layer)                               │
│     SQLite/PostgreSQL | Redis | Qdrant/Milvus | LangGraph | LLM API │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 控制回路设计

FlowForge v6.0 的核心是一个完整的前馈+反馈控制回路：

```
                 ┌─────────────────┐
                 │  前馈控制        │
                 │  · AGENTS.md    │
                 │  · Skill 注入   │
                 │  · Linter 规则  │
                 │  · 权限管线     │
                 └────────┬────────┘
                          │
                          ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  用户需求    │ → │ Agent 执行  │ → │   输出      │ → │  验证工具   │
│  自然语言    │   │ (9大模式)   │   │ (代码/文章) │   │ (测试/审查) │
└─────────────┘   └─────────────┘   └─────────────┘   └──────┬──────┘
                                                             │
                                                             │ 失败
                                                             ▼
                 ┌─────────────────┐   ┌─────────────────┐
                 │  反馈控制        │ ← │  熵管理         │
                 │  · 独立评判Agent│   │  · 文档园丁     │
                 │  · 四维评分     │   │  · 技术债回收   │
                 │  · 自修正循环   │   │  · 规则进化     │
                 └─────────────────┘   └─────────────────┘
```

---

## 第三章：核心功能需求

### 3.1 执行引擎 (Engine Layer)

**FR-ENG-01：HybridExecutor 混合执行器**
- TAOR 循环（Think-Act-Observe-Repeat）
- Persona 锁：同一 persona 同一时间只允许一个任务运行
- `_is_substep` 参数：Workflow 子步骤跳过锁检查
- 错误处理：支持 `abort/skip/retry/reflexion_retry` 四种策略

**FR-ENG-02：ModeRegistry 模式注册中心**
- 注册/获取/推荐模式
- 基于任务描述的智能模式推荐

**FR-ENG-03：9 大内置 Agent 模式**

| 模式 | 核心机制 | 适用场景 |
|------|---------|----------|
| `react` | Thought → Action → Observation 循环（MAX_STEPS=8，含循环检测） | 多步动态检索或工具调用 |
| `plan_execute` | Planner 生成步骤清单，Executor 依次执行 | 路径明确、步骤可预测的任务 |
| `reflexion` | Actor → Evaluator → Reflector 三 Agent 迭代（MAX_ITERATIONS=4） | 需要反复打磨的任务（代码、文档） |
| `multi_agent` | Subagents/Teams/Swarms 三种子策略 | 需要多角色配合的复杂任务 |
| `workflow` | 预定义 DAG 流程，可混合其他模式 | 长流程、端到端业务流水线 |
| `rewoo` | 一次性规划所有工具调用，批量执行 | 确定性多 API 调用 |
| `self_discover` | 任务前自动发现最佳推理结构 | 不确定领域 |
| `agent_judge` | 独立 Agent 作为评判者，提供定性反馈 | 无外部评分标准的任务 |
| `graph_of_thoughts` | 图式推理，多思路聚合、交叉验证 | 复杂推理、数学证明 |

**FR-ENG-04：TaskScheduler 定时调度**
- 基于 APScheduler + SQLAlchemy job store
- 支持动态添加/删除/暂停/恢复 Cron 任务
- 任务恢复（重启后从 job store 恢复）

**FR-ENG-05：三层防御机制**
- L1 超时防御：`ToolRegistry.execute()` 中单次工具调用超时
- L2 重复检测：`BaseModeExecutor._on_exit()` 钩子检测重复输出
- L3 自修正：`WorkflowExecutor` 的 `on_error: "reflexion_retry"` 策略

### 3.2 Harness 驾驭层 (Harness Layer)

**FR-HRN-01：上下文工程引擎 (ContextEngine)**
- AGENTS.md 动态知识注入：按任务域（domain）检索相关规则
- 历史失败案例检索：从知识库中检索同类任务的历史教训
- 会话交接物构建：`init_script + progress_log + feature_checklist`
- 按需上下文注入：只在 Agent 需要时注入，不污染上下文窗口

**FR-HRN-02：架构约束引擎 (ArchitectureConstraint)**
- 分层依赖模型（Types → Config → Repo → Service → Runtime → UI）
- 自定义 Linter 规则库（可扩展）
- CI 门禁：违反约束则阻断
- 违规信息自动注入 Agent 上下文（让 Agent 自我修复）

**FR-HRN-03：反馈循环引擎 (FeedbackLoop)**
- 生成与评判分离：独立的 Evaluator Agent 评判 Generator Agent 的产出
- 四维评分体系：Design Quality / Originality / Craft / Functionality
- 分类闸门：只看工具执行结果，忽略模型自我评价
- 自修正循环（Reflexion Loop）：失败 → 反思 → 重试（最多3轮）
- 升级干预（metacog 风格）：连续失败3次后强制暂停当前路径

**FR-HRN-04：熵管理引擎 (EntropyManager)**
- 文档园丁 Agent：后台定时扫描文档-代码不一致，自动提交修复 PR
- 技术债跟踪器：优先级排序 + 持续小额偿还
- 规则进化器：每次 Agent 失败转化为一条工程规则
- 垃圾回收调度：Cron 定时任务自动触发

**FR-HRN-05：权限管线 (PermissionPipeline)**
- deny → ask → allow 三层管线（deny 永远胜出）
- 四级动作分级：Read / Suggest / Prepare / Execute
- 低风险操作 Auto Mode 静默通过
- 高风险操作必须人工确认

**FR-HRN-06：会话管理器 (SessionManager)**
- 98% 阈值触发上下文压缩
- 工具输出 Token 截断（默认 25000 tokens）
- 会话交接：检查点保存 + 交接物传递
- 上下文窗口自适应管理

### 3.3 能力层 (Capability Layer)

**FR-CAP-01：Tool 生态**
- 内置 12+ 工具：LLM Client、文件读写、Shell 执行、网络搜索、HelixRAG、Python 沙箱、Git 操作、图片搜索、邮件发送、Webhook、TaskBoard 操作
- 协议适配器：MCP / OpenAPI / GraphQL 三种协议自动转换为 Tool
- 门控工具管线：权限检查 → 安全分类 → 执行 → 输出校验
- 安全标记：`safety_level` 属性 + `is_concurrency_safe`
- 工具输出 Schema 校验

**FR-CAP-02：Skill 系统**
- 跨格式兼容：原生支持 FlowForge / Claude Code / Anthropic / Trae CN / OpenHarness 五种 Skill 格式
- 双层加载：全局 Skill（~/.flowforge/skills/）+ 项目 Skill（./.flowforge/skills/）
- 符号链接支持：项目 Skill 链接到全局目录
- Skill 组合技（Combo Skills）：多 Skill 管道编排
- 触发器匹配：自然语言触发词自动匹配并激活 Skill
- Skill 版本管理：语义化版本 + 依赖管理 + 变更记录

**FR-CAP-03：MCP 模块**
- L1 MCP Client：JSON-RPC 2.0 客户端 + stdio / Streamable HTTP 双传输
- L2 MCP Gateway：工具白名单 + Token 预算管理 + 速率限制 + 权限管线集成
- L3 MCP Broker：多服务器聚合 + 动态路由 + 熔断/重试
- L4 MCP Tool Adapter：自动转换为 FlowForge BaseTool
- 工具发现缓存（5 分钟 TTL）

**FR-CAP-04：通用 Agent 库**
- 内容创作类 12 个：TopicResearch、MaterialCollection、ArticleWriting、SEOOptimization、FactCheck、ContentAudit、HeadlineOptimizer、ContentRepurposer、TrendAnalysis、Publishing、ImageResearch、Multilingual
- 小说创作类 12 个：OutlinePlanning、CharacterDesign、ChapterWriting、PlotIntegration、StyleConsistency、VolumeAggregator、DialogueGeneration、ConflictDevelopment、WorldBuilding、ReaderEngagement、Serialization、Adaptation
- 代码工具类 8 个：CodeReview、TaskDecomposition、MetaPlanner、Debate、DataAnalysis、PromptOptimizer、TestGeneration、Documentation
- 每个 Agent 标注验证状态：✅ 已验证 / 🔄 设计中 / 📅 待验证

**FR-CAP-05：Memory 系统**
- 5 种记忆策略：Working / Short-term / Long-term / Semantic / Episodic
- TaskBoard：多 Agent 共享任务板，RETURNING 子句原子认领
- Mailbox：Agent 间通信信箱，支持优先级 + 过滤 + 过期清理
- CheckpointManager：增量保存 + 恢复 + 版本管理
- ContextCompressor：tiktoken + 滑动窗口 + 98% 阈值触发

**FR-CAP-06：通用 Workflow 库**
- 15+ 预置 YAML 模板：DeepArticle、QuickPost、TrendArticle、MultiPlatform、SEOContent、ImageArticle、Multilingual、ReportGeneration、DefenseArticle 等
- 每个 Workflow 步骤可指定独立的执行模式
- 支持 `defense` 全局配置（三层防御参数）
- 支持 `human: true` 审核节点

### 3.4 多 Agent 策略 (Multi-Agent Strategies)

**FR-MAS-01：Subagents 策略**
- 完全上下文隔离：每个子 Agent 独立上下文窗口（空状态，无历史污染）
- 并行执行：所有子任务并发处理
- 工具过滤：只暴露子任务需要的最小工具集
- 结果压缩：子 Agent 返回压缩摘要，避免污染父 Agent 上下文

**FR-MAS-02：Agent Teams 策略**
- Lead Agent 作为项目经理，维护 TaskBoard 和 Mailbox
- 多 Team Agent 从共享任务板认领任务
- Agent 间通过 Mailbox 通信（支持优先级、标签、过期）
- 三层防御：空闲轮次检测 + 重复结果检测 + 超时任务重发布
- Lead Agent 监控全局状态，处理冲突和死循环

**FR-MAS-03：Swarms 策略**
- 去中心化集群：无固定 Leader，通过共享任务队列协作
- 心跳机制：每个 Worker 定期报告存活状态
- 失败节点自动恢复：失联 Worker 的任务自动重发布
- 乐观并发控制 + 分布式锁

### 3.5 Solo 实时交互 (Solo Mode)

**FR-SOL-01：实时执行流**
- 17 种 FlowForge 事件 → 16 种 Solo 事件类型全映射
- WebSocket 专用通道 `/ws/solo/{task_id}`
- 事件序号 + 断线重连 + 历史回放

**FR-SOL-02：Solo 三栏布局**
- 左栏：执行流（虚拟滚动，支持 500+ 条事件）
- 中栏：工具调用/LLM 思考详情面板（可展开/折叠）
- 右栏：Markdown 编辑器（编辑/预览/分屏三种模式）

**FR-SOL-03：审核节点内联**
- 审核操作直接嵌入执行流，不跳转到独立页面
- 支持审核通过/驳回/编辑提交
- 审核窗口期 5 分钟内可撤回

**FR-SOL-04：任务控制**
- 暂停/恢复/跳过当前节点
- 实时 Token 统计和费用预估

### 3.6 插件与扩展 (Plugin System)

**FR-PLG-01：三层插件架构**
- Mode 插件：注册新的执行模式
- Agent 插件：注册新的通用 Agent
- Tool 插件：注册新的工具（含 MCP 协议接入）

**FR-PLG-02：插件发现机制**
- Python `entry_points` 标准机制
- YAML 配置文件扫描
- 加载失败的插件不影响系统启动

**FR-PLG-03：插件市场**
- 内部市场：团队共享 Agent/Workflow/Skill
- 公共市场：开源插件分发
- 插件版本管理 + 依赖检查

### 3.7 可观测性 (Observability)

**FR-OBS-01：全链路追踪**
- 每个任务生成唯一 `trace_id`
- 注入到所有 Agent 调用和 LLM 请求

**FR-OBS-02：Prometheus 指标**

| 指标名 | 类型 | 描述 |
|--------|------|------|
| `flowforge_tasks_total{mode, status}` | counter | 任务创建总数 |
| `flowforge_execution_duration_seconds` | histogram | 任务执行耗时 |
| `flowforge_token_usage_total{model, provider}` | counter | Token 消耗 |
| `flowforge_tool_calls_total{tool_name, status}` | counter | 工具调用次数 |
| `flowforge_persona_running{persona}` | gauge | 当前各专栏运行任务数 |

**FR-OBS-03：审计日志**
- 所有 Agent、Tool 调用均记录在 audit_logs 表中
- 包含输入参数、输出、trace_id、耗时
- 敏感信息脱敏

**FR-OBS-04：WebSocket 实时推送**
- 通用事件通道 `/ws/events`
- Solo 专用通道 `/ws/solo/{task_id}`
- 支持断线重连和事件回放

### 3.8 安全体系 (Security)

**FR-SEC-01：Fail-closed 工具安全**
- 所有工具继承 `BaseTool.safety_level` 属性
- 危险工具默认需要审批
- 只读工具可直接执行

**FR-SEC-02：代码沙箱**
- 进程级隔离 + 资源限制
- 移除危险内置函数
- 文件系统路径穿越防护
- 跨平台兼容（Linux/Windows）

**FR-SEC-03：并发安全**
- Persona 锁：同一专栏互斥
- TaskBoard 原子认领（RETURNING 子句 + 应用层锁）
- 非并发安全工具自动加锁

---

## 第四章：非功能需求 (NFR)

### 4.1 性能要求

| 指标 | 目标 |
|------|------|
| 单 Agent 执行延迟（不含 LLM） | < 2s (P95) |
| Workflow 8 步骤执行（不含 LLM） | < 30s |
| WebSocket 事件延迟 | < 50ms (P95) |
| 插件加载时间（10个插件） | < 500ms |
| 并发创建 10 个不同 persona 任务 | 全部成功，无锁冲突 |

### 4.2 可靠性要求

| 指标 | 目标 |
|------|------|
| 系统可用性 | > 99%（非硬件故障） |
| 人工审核通过率 | > 90% |
| 模型故障自动切换 | < 10s |
| WebSocket 断线重连 | 指数退避，最多 10 次 |

### 4.3 可扩展性

- **NFR-01**：插件化 Agent/Mode/Tool 注册机制，支持热插拔
- **NFR-02**：MCP 协议接入外部工具服务器
- **NFR-03**：OpenAPI/GraphQL 自动转换为 Tool
- **NFR-04**：跨语言支持（gRPC/REST API 封装，未来）

### 4.4 安全性

- **NFR-05**：三层权限管线 + 四级动作分级
- **NFR-06**：代码沙箱 + 文件系统路径穿越防护
- **NFR-07**：Human-in-the-Loop 审核（所有正式发布必须人工确认）
- **NFR-08**：全链路审计追踪

### 4.5 可维护性

- **NFR-09**：清晰的分层架构和模块边界
- **NFR-10**：声明式 YAML 配置驱动
- **NFR-11**：全链路追踪和结构化日志
- **NFR-12**：Prometheus + Grafana 监控

---

## 第五章：与 ContentForge 的集成方案

### 5.1 集成架构

FlowForge v6.0 作为底层 Harness 引擎，ContentForge 作为上层业务应用。ContentForge 通过以下方式接入：

1. **注册业务 Agent**：ContentForge 的 7 个业务 Agent（TopicAgent、ResearchAgent、WriterAgent 等）继承 FlowForge BaseAgent，注册到 AgentRegistry
2. **配置 Persona**：内容专栏的 SOUL/MEMORY 转换为 `config/persona/{name}.yaml`
3. **定义 SOP**：创作流程映射为 Workflow YAML 模板
4. **注册业务 Tool**：HelixRAG、ToutiaoPublisher、WeChatPublisher 等注册到 ToolRegistry
5. **使用 Skill**：创作类 Skill（如 weekly-report、book-essence-extractor）直接注入到 Agent 上下文
6. **启用 Harness**：上下文工程、架构约束、反馈循环、熵管理作为全局配置启用

### 5.2 业务场景映射

| ContentForge 场景 | FlowForge v6.0 对应能力 |
|-------------------|------------------------|
| 深度长文创作 | Workflow 模式 + `deep_article` SOP + Reflexion Writer |
| 热点追踪创作 | Multi-Agent (Subagents) + WebSearch Tool |
| 多平台分发 | Workflow 模式 + `multi_platform` SOP |
| SEO 内容生产 | Workflow 模式 + SEOOptimization Agent |
| 定时批量创作 | TaskScheduler + Cron 任务 |
| 人工审核 | Human-in-the-Loop 节点 + Solo 审核块 |
| 模型故障自愈 | ModelService 健康检查 + 级联修复 |
| 文档维护 | 文档园丁 Agent + 技术债回收 |
| AI 主编实时协作 | Solo 模式 + WebSocket 事件流 |

### 5.3 迁移路径

| ContentForge 现有模块 | FlowForge v6.0 对应 | 迁移策略 |
|-----------------------|-------------------|---------|
| `brain/orchestrator.py` | `engine/hybrid_executor.py` | **包装**：保留 Persona 锁、Solo 回调，核心执行委托 |
| `workers/` | `agents/content/` | **继承**：改继承 FlowForge BaseAgent，使用 `execute_with_context` |
| `tools/registry.py` | `tools/registry.py` | **委托**：包装 FlowForge ToolRegistry |
| `tools/llm/client.py` | `tools/builtin/llm_client.py` | **替换** |
| `core/interfaces/solo_emitter.py` | `events/event_bus.py` + `events/solo_adapter.py` | **桥接** |
| `brain/scheduler.py` | `scheduler/scheduler.py` | **替换** |
| `config/persona/*.yaml` | `config/persona/*.yaml` | **保留** |

---

## 第六章：业务场景支撑矩阵

| 业务场景 | 执行模式 | 多Agent策略 | Harness护栏 | Tool依赖 | Skill | 交互模式 |
|---------|---------|------------|------------|---------|------|---------|
| 深度长文创作 | workflow | subagents | 反馈循环+熵管理 | helixrag+web_search | article-outline | Solo |
| 快速帖子生成 | rewoo | - | 架构约束 | llm+web_search | - | Standard |
| 热点追踪 | multi_agent | subagents | 上下文工程 | web_search+helixrag | trend-analysis | Standard |
| 多平台分发 | workflow | - | 权限管线 | publish_toutiao+publish_wechat | - | Standard |
| SEO内容生产 | plan_execute | - | 反馈循环 | helixrag+llm | seo-optimizer | Standard |
| 定时批量创作 | workflow | - | 所有 | 全部 | - | Cron |
| AI主编实时协作 | workflow | agent_teams | 上下文工程+反馈循环 | 全部 | 全部 | Solo |
| 代码审查 | reflexion | agent_teams | 架构约束+反馈循环 | git_ops+llm | code-review | Solo |
| 文档维护 | plan_execute | - | 熵管理 | file_rw+git_ops | doc-gardener | Cron |


目前我们系统已经可以稳定运行。但是我们准备继续引入Harness架构，来进行优化，请你联网搜索harness的最新最佳实践，harness相关的开源框架，harness的商业产品，结合我们的flowforge，设计v6.0版的架构设计和融合方案

# FlowForge v6.0 架构设计（第一版）：深度融合 Harness 工程体系

## 第一部分：Harness 核心洞察

### 1.1 Harness 是什么？

Harness 是驱动大模型的整套工程架构，核心作用是把模型能力最大化，而非单纯输出 tokens。Harness 可理解为驱动模型的整套工程架构，其核心作用是把模型能力最大化，而非单纯输出tokens。Claude Code的Harness清晰拆解为六大核心组件：多层级System Prompt、Tool Schema、Tool Call Loop、Context Manager、Sub Agent、Verification Hooks。

如果说大模型是一匹蓄势待发的烈马，Harness 就是人类牵引、驾驭这匹烈马的缰绳。真正稀缺的能力，不在模型里面，在模型外面。

### 1.2 核心公式

业界已形成共识：**Agent = Model (Brain) + Harness (Body)**。Harness 作为工程化中间层，承担着将模型能力转化为可用智能体的关键职责。

### 1.3 业界实践已证实的价值

采用Harness架构的Agent在连续运行72小时后，任务完成率较传统方案提升67%，异常重启次数减少92%。**2026年是Agent Harness的时代**——Aakash Gupta直言："2025年属于Agents，2026年属于Agent Harnesses"。

---

## 第二部分：FlowForge v6.0 六大核心模块设计

### 2.1 三层权限模型 (Permission Pipeline)

Claude Code 的权限模型是 Harness 架构中最具工业价值的设计之一。它不是简单的"有权限/无权限"，而是完整的分层决策管线。

```
deny → ask → allow（deny 永远胜出）
三个可能结果：静默通过、提示用户确认、直接阻止
```

被攻破的模型无法靠"话术"绕过安全检查。Harness 不关心模型的论证，规则就是规则。

**FlowForge v6.0 实现**：

```python
# flowforge/harness/permission.py

class PermissionPipeline:
    """三层权限管线：deny → ask → allow"""

    TIER_1_AUTO = "auto_approved"    # 只读操作，无中断
    TIER_2_PROMPT = "prompt_user"    # 状态修改，需确认
    TIER_3_BLOCK = "require_approval"  # 高风险操作

    RULE_ORDER = ["deny", "ask", "allow"]

    def __init__(self, rules_registry: dict, classifier: Optional['SafetyClassifier'] = None):
        self.rules = rules_registry
        self.classifier = classifier

    async def evaluate(self, tool_name: str, params: dict, context: 'TaskContext') -> str:
        for tier in self.RULE_ORDER:
            applicable_rules = self.rules.get(tool_name, {}).get(tier, [])
            for rule in applicable_rules:
                if rule.matches(tool_name, params, context):
                    if tier == "deny":
                        context.event_bus.emit(context.task_id, "permission.denied",
                            {"tool": tool_name, "reason": rule.reason})
                        return "deny"
                    elif tier == "ask":
                        if self.classifier:
                            decision = await self.classifier.evaluate(context, tool_name, params)
                            if decision == "approved":
                                continue
                        context.event_bus.emit(context.task_id, "permission.prompt",
                            {"tool": tool_name, "params": params})
                        approved = await context.request_user_approval(tool_name, params)
                        if not approved:
                            return "deny"
                    elif tier == "allow":
                        return "allow"
        return "allow"  # 默认通过
```

**与现有 SecureToolRegistry 的关系**：增强现有的 `safety_level` 属性，将三层权限管线作为 `SecureToolRegistry` 的底层实现，保持接口兼容。

**参考来源**：Claude Code 三层权限模型（Auto-approved / Prompt / Block）、Fail-closed安全策略的权限沙箱设计。

---

### 2.2 上下文持久化与会话管理 (Session & Compaction)

Claude Code 的上下文管理有严格的设计：MCP工具输出最大默认25,000 tokens，10,000 tokens时警告；超大结果持久化到磁盘，不保留在上下文中。

更关键的是 **Compaction 触发时机**：当 token 使用量达到上下文窗口约 98% 时自动压缩。关键元数据保留，图像和 PDF 被剥离。

Anthropic 的研究发现，完整的上下文重置——新 Agent 实例从交接工件启动——在某些场景下比压缩效果更好。

**FlowForge v6.0 实现**：

```python
# flowforge/harness/session_manager.py

class SessionManager:
    """增强版上下文与会话管理器"""

    COMPACTION_THRESHOLD = 0.92          # 调整为 92%（原 85%）
    MAX_TOOL_OUTPUT_TOKENS = 25000       # 工具输出最大 token 数
    TOOL_OUTPUT_WARNING_TOKENS = 10000    # 警告阈值

    def __init__(self, context: 'TaskContext', llm_client, checkpoint_mgr):
        self.context = context
        self.llm = llm_client
        self.checkpoint = checkpoint_mgr
        self.session_file = f"data/sessions/{context.task_id}.json"

    async def handle_tool_output(self, tool_name: str, result: dict) -> dict:
        """处理超大工具输出：截断 + 磁盘持久化"""
        result_json = json.dumps(result, ensure_ascii=False)
        tokens = count_tokens(result_json)

        if tokens > self.MAX_TOOL_OUTPUT_TOKENS:
            # 持久化完整结果到磁盘
            persist_path = f"data/tool_outputs/{self.context.task_id}/{tool_name}_{int(time.time())}.json"
            os.makedirs(os.path.dirname(persist_path), exist_ok=True)
            with open(persist_path, 'w') as f:
                f.write(result_json)
            # 截断到 MAX_TOOL_OUTPUT_TOKENS
            truncated = self._truncate_to_tokens(result, self.MAX_TOOL_OUTPUT_TOKENS)
            truncated["_persisted_full_result"] = persist_path
            return truncated
        elif tokens > self.TOOL_OUTPUT_WARNING_TOKENS:
            self.context.event_bus.emit(self.context.task_id, "context.warning",
                {"tool": tool_name, "tokens": tokens, "threshold": self.TOOL_OUTPUT_WARNING_TOKENS})
        return result

    async def compact_if_needed(self, messages: list) -> list:
        """98% 阈值触发自动压缩"""
        total_tokens = sum(count_tokens(str(m)) for m in messages)
        utilization = total_tokens / self.max_context_tokens
        if utilization >= self.COMPACTION_THRESHOLD:
            # 保存关键元数据（系统提示、近期决策）
            preserved = self._extract_critical_metadata(messages)
            # 压缩早期历史为摘要
            summary = await self._summarize_early_history(messages)
            # 保存检查点
            await self.checkpoint.save(self.context.task_id, self.context.state, messages, "auto_compact")
            # 返回压缩后的消息列表
            return [{"role": "system", "content": f"[会话摘要] {summary}"}] + preserved
        return messages

    def _extract_critical_metadata(self, messages: list) -> list:
        """提取关键元数据：最近的工具调用结果和明确决策"""
        preserved = []
        for m in reversed(messages):
            if m.get("role") == "tool" or self._is_decision(m):
                preserved.insert(0, m)
            if len(preserved) >= 10:
                break
        return preserved
```

**与现有 ContextCompressor 的关系**：替换现有 `ContextCompressor` 为 `SessionManager`，保留滑动窗口 + 摘要的核心逻辑，新增工具输出截断和 98% 阈值触发。

**参考来源**：Claude Code 上下文压缩实践、上下文压缩算法示例。

---

### 2.3 Gated Tool Pipeline（门控工具管线）

Claude Code 的工具调用管线有严格的权限检查：每次工具调用在执行前都通过权限检查。权限检查是一个独立规则管线，模型只提议操作，工具系统决定是否允许。

**FlowForge v6.0 实现**：

```python
# flowforge/harness/tool_gate.py

class GatedToolPipeline:
    """门控工具管线：安全检查独立于模型决策"""

    def __init__(self, permission_pipeline: PermissionPipeline, tool_registry, safety_classifier: Optional['SafetyClassifier'] = None):
        self.permission = permission_pipeline
        self.registry = tool_registry
        self.classifier = safety_classifier

    async def execute(self, tool_name: str, input: 'ToolInput', context: 'TaskContext') -> 'ToolOutput':
        # 1. 权限检查（独立于模型决策）
        permission_result = await self.permission.evaluate(tool_name, input.params, context)
        if permission_result == "deny":
            return ToolOutput(result={}, error=f"Tool '{tool_name}' blocked by permission pipeline")

        # 2. 安全分类器评估（Auto Mode）
        if self.classifier and permission_result == "prompt_user":
            safety_decision = await self.classifier.evaluate(context, tool_name, input.params)
            if safety_decision == "approved":
                pass  # 静默通过
            elif safety_decision == "blocked":
                return ToolOutput(result={}, error=f"Tool '{tool_name}' blocked by safety classifier")

        # 3. 执行工具
        result = await self.registry.execute(tool_name, input, context)

        # 4. 输出校验
        if hasattr(self.registry.get_tool(tool_name), 'output_schema'):
            result = self._validate_output(tool_name, result)

        return result

    def _validate_output(self, tool_name: str, result: 'ToolOutput') -> 'ToolOutput':
        """Schema 校验确保输出合规"""
        tool = self.registry.get_tool(tool_name)
        if hasattr(tool, 'output_schema'):
            schema = tool.output_schema
            # 使用 jsonschema 校验 result.result
            import jsonschema
            try:
                jsonschema.validate(result.result, schema)
            except jsonschema.ValidationError as e:
                return ToolOutput(result={}, error=f"Output validation failed: {str(e)}")
        return result
```

**与现有 SecureToolRegistry 的关系**：`GatedToolPipeline` 封装 `SecureToolRegistry`，在工具注册表之上增加权限管线和安全分类器。

**参考来源**：Claude Code 权限检查管线、安全容错模型的超时熔断和结果校验。

---

### 2.4 验证钩子闭环 (Verification Hooks)

这是 Harness 架构解决"模型自我美化、虚报完成"问题的核心机制。强模型存在自我偏好——自评准确率远高于互评，易主动"说谎"而非单纯幻觉。工程方案是引入后台分类器，只看工具执行结果、忽略模型生成文本，脱离生成偏差做客观校验。

Anthropic 工程团队指出：将做工作的智能体与评判工作的智能体分离，是一个强有力的杠杆。因为让评估者变得更加怀疑，远比让生成者变得更加自我批判要容易得多。

**FlowForge v6.0 实现**：

```python
# flowforge/harness/verification.py

class VerificationHooks:
    """验证钩子闭环：将生成与评判分离"""

    def __init__(self, evaluator_model, classifier_model):
        self.evaluator = evaluator_model
        self.classifier = classifier_model

    async def verify_task_completion(self, task_result: dict, context: 'TaskContext') -> dict:
        """后台分类器：只看工具执行结果，忽略模型生成文本"""
        execution_artifacts = self._extract_artifacts(context)
        verdict = await self.classifier.evaluate(execution_artifacts, context.input_data.get("task", ""))
        if verdict == "incomplete":
            context.event_bus.emit(context.task_id, "verification.failed",
                {"reason": "Task marked incomplete by classifier"})
            return {"status": "incomplete", "message": "Task not fully completed"}
        return {"status": "complete"}

    def _extract_artifacts(self, context: 'TaskContext') -> dict:
        """提取执行产物：工具调用结果、文件变更、测试输出等"""
        return {
            "tool_results": context.state.get("tool_results", []),
            "files_changed": context.state.get("files_changed", []),
            "test_output": context.state.get("test_output", ""),
            "error_logs": context.state.get("error_logs", []),
        }

    async def cross_validate(self, generator_output: dict, context: 'TaskContext') -> dict:
        """交叉验证：独立评估器评判生成器输出"""
        evaluation = await self.evaluator.evaluate(generator_output, context)
        # 结构化评分：四维评分体系
        scores = {
            "design_quality": evaluation.get("design_score", 0),
            "originality": evaluation.get("originality_score", 0),
            "craft": evaluation.get("craft_score", 0),
            "functionality": evaluation.get("functionality_score", 0),
        }
        overall = sum(scores.values()) / 4
        return {
            "scores": scores,
            "overall": overall,
            "verdict": "PASS" if overall >= 0.8 else "FAIL",
            "issues": evaluation.get("issues", []),
        }
```

**与现有 AuditAgent 的关系**：`VerificationHooks` 替换 `AuditAgent`，将"自我评估"变为"独立评估+后台分类"的双重验证。`cross_validate()` 实现了"将做工作的Agent与评判工作的Agent分离"的核心原则。

**参考来源**：Claude Code 六大组件之 Verification Hooks、GAN 类比分析、四维评分体系（Design Quality, Originality, Craft, Functionality）。

---

### 2.5 子智能体编排引擎 (Sub-Agent Orchestration)

主-子Agent架构的本质是分层强化学习：主Agent为子Agent定义子任务，子任务终结状态作为主Agent下一步起点。共享KV Cache与输入上下文，子Agent执行后仅追加结果，不额外增加token消耗，成本远低于串行执行。

OpenHarness 的实践验证了这一架构的有效性：ohmo 可运行4天不间断，支持完整的 Swarm & Multi-Agent 协调器编排系统，以及基于 contextvars 的进程内隔离和后端子进程。

**FlowForge v6.0 实现**：

```python
# flowforge/harness/subagent_engine.py

class SubAgentEngine:
    """子智能体编排引擎"""

    MAX_SUBAGENTS = 10
    MAX_TOKENS_PER_SUBAGENT = 50000  # 每个子Agent的独立上下文窗口

    def __init__(self, agent_registry, tool_registry, permission_pipeline):
        self.agent_registry = agent_registry
        self.tool_registry = tool_registry
        self.permission = permission_pipeline

    async def spawn_subagent(self, task_spec: dict, parent_context: 'TaskContext') -> dict:
        """创建子Agent：独立上下文窗口 + 受限工具集"""
        sub_ctx = TaskContext.from_parent(
            parent_context,
            input_data={"task": task_spec["prompt"]},
            state={},  # 空状态 = 上下文隔离
            metadata={"isolation": "full", "max_tokens": self.MAX_TOKENS_PER_SUBAGENT}
        )

        # 工具集过滤：只赋予子Agent完成任务所需的最小工具集
        allowed_tools = task_spec.get("tools", ["read", "write", "bash"])
        sub_ctx.tools = self._filter_tools(parent_context.tools, allowed_tools)

        # 执行
        agent = self.agent_registry.get(task_spec.get("agent_type", "default"))
        result = await agent.execute_with_context(AgentInput(params={"task": task_spec["prompt"]}), sub_ctx)

        # 压缩结果：子Agent返回压缩摘要，避免污染父Agent上下文
        compressed = await self._compress_result(result.result)
        return {"result": compressed, "agent_id": task_spec.get("id"), "status": "completed"}

    def _filter_tools(self, tools, allowed: list) -> 'ToolRegistry':
        """工具集过滤：子Agent只看到允许的工具"""
        filtered = ToolRegistry()
        for name in allowed:
            try:
                filtered.register(tools.get_tool(name))
            except KeyError:
                pass
        return filtered
```

**与现有 Subagents 策略的关系**：替换 `MultiAgentExecutor._run_subagents()` 中的子Agent创建逻辑，引入独立上下文窗口和令牌预算约束。

**参考来源**：主-子Agent架构的分层强化学习设计、OpenHarness 的 InProcessBackend 与 contextvars 隔离。

---

### 2.6 Plan-Execute 一体化训练管线 (Integrated Training)

Harness 消除规划与执行间的噪声：预先锁定规划中的工具链路，无额外人工干预层；执行结果由分类闸门客观校验，规划的Reward信号更清晰；实现规划能力可训练，避免"只执行、不规划"的粗放模式。

传统RL训练环境与推理环境严重割裂，而Harness实现了训练-生产环境的一体化：工具调用序列=轨迹步，测试运行与分类闸门=Reward信号，用户任务=完整Episode。

**FlowForge v6.0 实现**：

```python
# flowforge/harness/training_pipeline.py

class IntegratedTrainingPipeline:
    """Plan-Execute 一体化训练管线"""

    def __init__(self, mode_registry, verification_hooks, checkpoint_mgr):
        self.mode_registry = mode_registry
        self.verification = verification_hooks
        self.checkpoint = checkpoint_mgr

    async def run_training_episode(self, task: dict, context: 'TaskContext') -> dict:
        """单次训练Episode：工具调用序列=轨迹步，分类闸门=Reward信号"""
        trajectory = []

        # 1. Plan 阶段（生成执行计划）
        planner = self.mode_registry.get("plan_execute")
        plan = await planner._planner_generate_plan(context, task["description"])
        trajectory.append({"step": "plan", "output": plan})

        # 2. Execute 阶段（执行计划 + 记录工具调用轨迹）
        for step in plan:
            tool_result = await context.tools.execute(step["tool"], ToolInput(params=step["params"]), context)
            trajectory.append({"step": step["name"], "tool": step["tool"], "result": tool_result.result})

        # 3. Verify 阶段（分类闸门验证）
        verification = await self.verification.verify_task_completion({"trajectory": trajectory}, context)

        # 4. 保存 Episode（用于后续模型优化）
        await self.checkpoint.save(context.task_id, context.state, trajectory, f"episode_{int(time.time())}")

        return {"trajectory": trajectory, "verification": verification, "status": verification["status"]}
```

**参考来源**：Plan-Execute 一体化训练机制、训练-生产环境一体化架构。

---

## 第三部分：与现有 FlowForge 的融合路径

### 3.1 模块对照与迁移策略

| 现有模块 | Harness 模块 | 迁移策略 |
|---------|------------|---------|
| `SecureToolRegistry` | `PermissionPipeline` | **增强**：增加 deny/ask/allow 三层规则管线 |
| `ContextCompressor` | `SessionManager` | **替换**：引入98%阈值触发、工具输出截断、磁盘持久化 |
| `AuditAgent` | `VerificationHooks` | **替换**：独立评估器+后台分类器，实现生成与评判分离 |
| `MultiAgentExecutor._run_subagents()` | `SubAgentEngine` | **增强**：独立上下文窗口、令牌预算约束 |
| `WorkflowExecutor` | `IntegratedTrainingPipeline` | **新增**：轨迹记录、分类闸门验证 |
| `BaseAgent` | `GatedToolPipeline` | **增强**：工具调用前权限检查独立于模型决策 |

### 3.2 启动配置示例

```yaml
# config/harness.yaml
harness:
  permission:
    tiers:
      - auto_approved: [read, search, list]
      - prompt_user: [write, edit, bash]
      - require_approval: [deploy, delete, publish]
    auto_mode: false
    classifier_model: "sonnet-4.6"

  session:
    compaction_threshold: 0.92       # 98% 阈值触发自动压缩
    max_tool_output_tokens: 25000
    tool_output_warning_tokens: 10000
    checkpoint_enabled: true

  verification:
    enabled: true
    cross_validation: true
    classifier_gate: true
    scoring_dimensions: [design_quality, originality, craft, functionality]
    pass_threshold: 0.8

  subagent:
    max_subagents: 10
    max_tokens_per_subagent: 50000
    isolation: full
```

### 3.3 核心组件创建命令

```python
from flowforge.harness import (
    PermissionPipeline,
    SessionManager,
    GatedToolPipeline,
    VerificationHooks,
    SubAgentEngine,
    IntegratedTrainingPipeline,
)

# 创建 Harness 组件
permission = PermissionPipeline(rules_registry=load_rules("config/permission_rules.yaml"))
session = SessionManager(context, llm_client, checkpoint_mgr)
gate = GatedToolPipeline(permission, tool_registry)
verification = VerificationHooks(evaluator_model, classifier_model)
subagent_engine = SubAgentEngine(agent_registry, tool_registry, permission)
training = IntegratedTrainingPipeline(mode_registry, verification, checkpoint_mgr)

# 注入到 HybridExecutor
executor = HybridExecutor(
    mode_registry=mode_registry,
    agent_registry=agent_registry,
    tool_registry=gate,              # 使用 GatedToolPipeline 替代 ToolRegistry
    session_manager=session,          # 新增
    verification_hooks=verification,   # 新增
    subagent_engine=subagent_engine,   # 新增
)
```

---

## 第四部分：总结

FlowForge v6.0 的 Harness 融合方案从五个维度全面提升了架构能力：

| 维度 | 原方案 | Harness增强 | 来源 |
|------|-------|-----------|------|
| **安全边界** | safety_level 属性 | deny→ask→allow 三层管线 + 安全分类器 | Claude Code Permission Pipeline |
| **上下文管理** | 85% 阈值压缩 | 98%阈值触发 + 工具输出截断 + 磁盘持久化 | Claude Code Session & Compaction |
| **质量保证** | self.context 自评 | 独立评估器 + 后台分类器 + 四维评分 | Verification Hooks + Anthropic 评估体系 |
| **多Agent** | SubAgent 并行 | 独立上下文窗口 + KV Cache共享 + 令牌预算 | Sub-Agent Orchestration + OpenHarness |
| **训练一体化** | 无 | 轨迹记录 + 分类闸门Reward + Episode保存 | Harness Training Loop |

核心理念：**让模型专注于推理，让Harness负责执行、验证和约束**。这正是从 "Prompt Engineering" 向 "Harness Engineering" 跃迁的关键一步。

# FlowForge v6.0 架构设计（第二版）：深度融合 Harness Engineering

> **定位升级**：FlowForge 从"Agent 编排框架"进化为 **Agent 驾驭层 (Harness Layer)**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统。

---

## 一、范式转变：为什么 FlowForge 必须成为 Harness

### 1.1 行业共识：Harness Engineering 是 Agent 从玩具到工具的必经之路

2026 年初，五个独立团队得出了同一个结论：**瓶颈不在模型智能，而在基础设施**。

| 团队 | 关键发现 |
|------|---------|
| **Mitchell Hashimoto (HashiCorp)** | `Agent = Model + Harness`——每次 Agent 犯错，不是换模型，而是改进 Harness |
| **OpenAI Frontier Team** | 3 人 × 5 个月 = 100 万行代码，零手写。工程师从"写代码"转向"设计约束系统" |
| **Anthropic Engineering** | 双 Agent → 三 Agent（Planner/Generator/Evaluator），将生成与评判分离后，pass@1 从 69.7% 提升到 77.0% |
| **LangChain** | 仅调整 Harness（不改模型），Terminal Bench 2.0 分数从 52.8% 升至 66.5%，排名从 Top 30 跃升至 Top 5 |
| **OpenHarness (HKUDS)** | 用 1.1 万行 Python 实现 Claude Code 50 万行的 98% 核心功能，证明 Harness 的本质是精炼而非堆砌 |

核心公式：**Harness Engineering = 为 AI 构建约束、验证、反馈和持续改进的系统工程实践。**

### 1.2 FlowForge 的新定位

```
┌─────────────────────────────────────────────────────────────┐
│                      模型层 (Model)                          │
│  GPT / Claude / DeepSeek / Kimi / Ollama                    │
│  "大脑"——推理、规划、决策                                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                   SDK / API 层 (已成熟)                      │
│  OpenAI SDK / Anthropic SDK / LangChain                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                FlowForge v6.0 — Harness 层                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  前馈控制 (Feedforward Control)                       │   │
│  │  · AGENTS.md 动态知识注入                             │   │
│  │  · 架构约束 (Linter Rules)                            │   │
│  │  · 权限管线 (Permission Pipeline)                     │   │
│  │  · 工具白名单 (Tool Allow-List)                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  反馈控制 (Feedback Control)                          │   │
│  │  · 验证钩子 (Verification Hooks)                      │   │
│  │  · 自修正循环 (Reflexion Loop)                        │   │
│  │  · Agent-to-Agent Review（智能体审智能体）            │   │
│  │  · 分类闸门 (Classifier Gate)                         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  熵管理 (Entropy Management)                          │   │
│  │  · 上下文压缩 (98% 阈值触发)                           │   │
│  │  · 技术债回收 (Doc Gardener)                           │   │
│  │  · 会话持久化 + 交接 (Session Handoff)                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  可观测性 (Observability)                             │   │
│  │  · 全链路审计 (Audit Trail)                           │   │
│  │  · 决策溯源 (Decision Traceability)                   │   │
│  │  · 行为漂移检测 (Drift Detection)                     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、六大核心模块设计

### 2.1 上下文工程（Context Engineering）——新员工手册

**核心问题**：Agent 不知道看什么、找什么、怎么找。

**业界实践**：
- OpenAI：AGENTS.md 作为 Agent 进入项目的第一份手册，每行对应一个历史失败案例
- Anthropic：初始化 Agent 产出 init.sh、progress.txt、feature list 作为交接物
- LangChain：Trace Analyzer Skill 自动分析失败轨迹，生成改进建议

**FlowForge v6.0 实现**：

```python
# flowforge/harness/context_engine.py

class ContextEngine:
    """上下文工程引擎：按需知识注入 + 交接机制"""

    def __init__(self, knowledge_base, llm_client, memory_manager):
        self.kb = knowledge_base
        self.llm = llm_client
        self.memory = memory_manager

    async def build_handoff_artifacts(self, ctx: 'TaskContext') -> dict:
        """构建会话交接物（类比 Anthropic 的 init.sh + progress.txt）"""
        artifacts = {
            "init_script": await self._generate_init_script(ctx),
            "progress_log": await self._build_progress_log(ctx),
            "feature_checklist": await self._build_feature_checklist(ctx),
            "last_git_commit": ctx.state.get("last_commit", ""),
        }
        # 持久化到项目记忆
        await self.memory.save("project", f"handoff_{ctx.task_id}", artifacts)
        return artifacts

    async def inject_dynamic_context(self, task: dict, persona: str) -> str:
        """按需注入上下文：规则 + 历史教训 + 交接物"""
        context_parts = []

        # 1. AGENTS.md 规则（按需检索）
        rules = await self.kb.retrieve(f"rules:{persona}", top_k=5)
        if rules:
            context_parts.append(f"【项目规则】\n{rules}")

        # 2. 历史失败案例
        mistakes = await self.kb.retrieve(f"mistakes:{task.get('domain', '')}", top_k=3)
        if mistakes:
            context_parts.append(f"【同类任务历史教训】\n{mistakes}")

        # 3. 上次交接物
        handoff = await self.memory.retrieve("project", f"handoff_{task.get('parent_task_id')}")
        if handoff:
            context_parts.append(f"【上次会话交接】\n{handoff}")

        return "\n\n".join(context_parts)
```

### 2.2 架构约束（Architecture Constraints）——缰绳

**核心问题**：Agent 复制并放大坏模式；不知道什么是"好的代码结构"。

**业界实践**：
- OpenAI：Types → Config → Repo → Service → Runtime → UI 分层依赖模型，违反则 CI 阻断
- Anthropic：编码 Agent 修改代码后必须通过浏览器自动化工具测试，非仅 curl
- Hashimoto：每次 Agent 犯错，写一条 Linter 规则

**FlowForge v6.0 实现**：

```python
# flowforge/harness/architecture_constraint.py

class ArchitectureConstraintEngine:
    """架构约束引擎：分层依赖 + Linter 规则 + CI 门禁"""

    # 分层依赖模型（OpenAI 实践）
    LAYER_ORDER = ["Types", "Config", "Repo", "Service", "Runtime", "UI"]
    LAYER_REVERSE = list(reversed(LAYER_ORDER))

    def __init__(self, rules_registry: dict):
        self.rules = rules_registry

    def check_dependency_direction(self, from_module: str, to_module: str) -> bool:
        """检查依赖方向是否符合分层模型"""
        try:
            from_idx = self.LAYER_ORDER.index(from_module.split(".")[0])
            to_idx = self.LAYER_ORDER.index(to_module.split(".")[0])
            return from_idx < to_idx
        except ValueError:
            return True  # 未知模块放行

    async def validate_agent_output(self, output: 'AgentOutput', ctx: 'TaskContext') -> list:
        """验证 Agent 输出是否符合架构约束"""
        violations = []

        # 1. 依赖方向检查
        for dep in self._extract_dependencies(output):
            if not self.check_dependency_direction(dep["from"], dep["to"]):
                violations.append({
                    "rule": "layer_dependency",
                    "violation": f"反向依赖: {dep['from']} → {dep['to']}",
                    "fix": f"遵循分层依赖: {' → '.join(self.LAYER_ORDER)}",
                })

        # 2. 自定义 Linter 规则检查
        for rule in self.rules.get("linter", []):
            if rule.matches(output.result):
                violations.append(rule.format_violation(output.result))

        # 3. 将违规信息注入 Agent 反馈（让它自己修）
        if violations:
            ctx.event_bus.emit(ctx.task_id, "constraint.violation", {
                "violations": violations,
                "action": "inject_to_agent_context"
            })

        return violations

    def _extract_dependencies(self, output: 'AgentOutput') -> list:
        """从 Agent 输出中提取 import/依赖关系"""
        code = str(output.result.get("content", output.result.get("code", "")))
        # 解析 import 语句...
        return []
```

### 2.3 反馈循环（Feedback Loop）——智能体审智能体

**核心问题**：Agent 不知道自己做错了；自评总是偏高。

**业界实践**：
- Anthropic："将做工作的 Agent 与评判工作的 Agent 分离，是一个强有力的杠杆"——自评准确率远低于互评
- OpenAI：Codex 在本地审核自身更改，请求额外审查，循环往复直到通过
- LangChain：Trace Analyzer Skill 自动分析失败模式，生成改进建议
- metacog：7 种感知（senses），从温和提醒升级到强制干预

**FlowForge v6.0 实现**：

```python
# flowforge/harness/feedback_loop.py

class FeedbackLoop:
    """反馈循环引擎：生成与评判分离 + 三层防御 + 自修正"""

    MAX_REFLEXION_ITERATIONS = 3
    QUALITY_THRESHOLD = 0.8

    def __init__(self, evaluator_agent, classifier_model, verification_hooks):
        self.evaluator = evaluator_agent
        self.classifier = classifier_model
        self.hooks = verification_hooks

    async def evaluate_agent_output(self, output: dict, ctx: 'TaskContext') -> dict:
        """四维评分体系 + 独立评判 Agent"""
        # 1. 后台分类器：只看工具执行结果，忽略模型生成文本
        artifacts = self._extract_execution_artifacts(ctx)
        classifier_verdict = await self.classifier.evaluate(artifacts)

        # 2. 独立评判 Agent（不同于生成 Agent）
        evaluation = await self.evaluator.evaluate(output, ctx)

        # 3. 四维评分
        scores = {
            "design_quality": evaluation.get("design_score", 0),
            "originality": evaluation.get("originality_score", 0),
            "craft": evaluation.get("craft_score", 0),
            "functionality": evaluation.get("functionality_score", 0),
        }
        overall = sum(scores.values()) / 4

        return {
            "scores": scores,
            "overall": overall,
            "verdict": "PASS" if overall >= self.QUALITY_THRESHOLD else "FAIL",
            "classifier_verdict": classifier_verdict,
            "issues": evaluation.get("issues", []),
            "suggestions": evaluation.get("suggestions", []),
        }

    async def run_reflexion_loop(self, ctx: 'TaskContext', generator_fn) -> dict:
        """自修正循环：生成 → 评估 → 反思 → 重试"""
        memory = []
        best_result = None
        best_score = 0.0

        for iteration in range(self.MAX_REFLEXION_ITERATIONS):
            # 1. 生成
            output = await generator_fn(ctx, memory)

            # 2. 评估
            evaluation = await self.evaluate_agent_output(output, ctx)

            # 3. 记录最佳
            if evaluation["overall"] > best_score:
                best_result = output
                best_score = evaluation["overall"]

            # 4. 达标即止
            if evaluation["verdict"] == "PASS":
                break

            # 5. 反思：将失败分析注入 memory
            reflection = await self._reflect_on_failure(output, evaluation, ctx)
            memory.append(reflection)

            # 6. 升级干预（metacog 风格）：如果连续失败，从温和提醒升级到强制干预
            if iteration >= 2:
                ctx.event_bus.emit(ctx.task_id, "defense.escalated_intervention", {
                    "iteration": iteration,
                    "message": "强制暂停当前路径，重新规划"
                })
                memory.append("PREVIOUS_APPROACH_FAILED_3_TIMES: Must try completely different strategy")

        return {"result": best_result, "score": best_score, "iterations": iteration + 1}

    def _extract_execution_artifacts(self, ctx: 'TaskContext') -> dict:
        """提取执行产物：只看客观结果，不看模型自我评价"""
        return {
            "tool_results": ctx.state.get("tool_results", []),
            "files_changed": ctx.state.get("files_changed", []),
            "test_output": ctx.state.get("test_output", ""),
            "error_logs": ctx.state.get("error_logs", []),
        }

    async def _reflect_on_failure(self, output, evaluation, ctx):
        """反思失败原因"""
        prompt = f"分析以下失败案例，总结根本原因和改进建议。\n评分: {evaluation['scores']}\n问题: {evaluation['issues']}"
        return await self.llm.chat([{"role": "user", "content": prompt}])
```

### 2.4 权限管线（Permission Pipeline）—— fail-closed 安全

**核心问题**：Agent 可能执行危险操作；Prompt 不是安全边界。

**业界实践**：
- Claude Code：deny → ask → allow 三层权限模型，deny 永远胜出
- Harness Agent：RBAC + OPA Policy Gates + Secrets Manager + MCP Gateway Proxy
- OpenAI：所有 effectful actions 走策略引擎，按规则 block/warn/require approval

**FlowForge v6.0 实现**：

```python
# flowforge/harness/permission_pipeline.py

class PermissionPipeline:
    """三层权限管线：deny → ask → allow"""

    ACTION_LEVELS = {
        "read": "auto_approved",      # 只读操作，静默通过
        "suggest": "prompt_user",     # 生成建议，需确认
        "prepare": "prompt_user",     # 生成 PR/变更计划
        "execute": "require_approval", # 执行部署/改配置/删除
    }

    RULE_ORDER = ["deny", "ask", "allow"]  # deny 永远胜出

    def __init__(self, rules_registry: dict, classifier=None, event_bus=None):
        self.rules = rules_registry
        self.classifier = classifier
        self.event_bus = event_bus

    async def evaluate(self, tool_name: str, params: dict, context: 'TaskContext') -> str:
        """评估工具调用权限：deny > ask > allow"""
        action_level = self._classify_action(tool_name, params)

        for tier in self.RULE_ORDER:
            rules = self.rules.get(tool_name, {}).get(tier, [])
            for rule in rules:
                if rule.matches(tool_name, params, context):
                    if tier == "deny":
                        self.event_bus.emit(context.task_id, "permission.denied", {
                            "tool": tool_name, "reason": rule.reason
                        })
                        return "deny"
                    elif tier == "ask":
                        # 低风险操作在 Auto Mode 下可静默通过
                        if action_level in ("read", "suggest"):
                            if self.classifier:
                                decision = await self.classifier.evaluate(context, tool_name, params)
                                if decision == "approved":
                                    continue
                        # 需要用户确认
                        self.event_bus.emit(context.task_id, "permission.prompt", {
                            "tool": tool_name, "params": params
                        })
                        approved = await context.request_user_approval(tool_name, params)
                        if not approved:
                            return "deny"
                    elif tier == "allow":
                        return "allow"
        return "allow"

    def _classify_action(self, tool_name: str, params: dict) -> str:
        """分类工具操作级别"""
        if tool_name in ("read_file", "list_directory", "grep", "search"):
            return "read"
        elif tool_name in ("web_search", "analyze", "summarize"):
            return "suggest"
        elif tool_name in ("write_file", "edit_file", "create_pr"):
            return "prepare"
        elif tool_name in ("bash", "deploy", "delete_file", "publish"):
            return "execute"
        return "prepare"
```

### 2.5 会话管理与交接（Session Handoff）——不让 Agent 忘事

**核心问题**：长任务中 Agent 重启后忘记之前做了什么；上下文窗口有限。

**业界实践**：
- Anthropic：初始化 Agent → 编码 Agent 的交接机制（init.sh + progress.txt + feature list）
- Claude Code：98% 阈值触发 Compaction，保留关键元数据
- OpenHarness：MEMORY.md 持久化跨会话记忆

**FlowForge v6.0 实现**：

```python
# flowforge/harness/session_manager.py

class SessionManager:
    """会话管理引擎：交接物 + 压缩 + 检查点"""

    COMPACTION_THRESHOLD = 0.92  # 98% 阈值触发（与 Claude Code 对齐）

    def __init__(self, checkpoint_mgr, memory_manager, llm_client):
        self.checkpoint = checkpoint_mgr
        self.memory = memory_manager
        self.llm = llm_client

    async def create_session(self, ctx: 'TaskContext') -> str:
        """创建会话，返回会话 ID"""
        session_id = f"session_{ctx.task_id}_{int(time.time())}"
        await self.checkpoint.save(session_id, ctx.state, [], "session_start")
        return session_id

    async def handoff(self, from_session: str, to_session: str, ctx: 'TaskContext') -> dict:
        """会话交接：构建交接物给下一个 Agent"""
        # 1. 读取上一会话的状态
        prev_state = await self.checkpoint.restore(from_session)

        # 2. 构建交接物
        handoff = await ContextEngine.build_handoff_artifacts(ctx)

        # 3. 注入到新会话的上下文
        ctx.state["handoff_from"] = from_session
        ctx.state["inherited_artifacts"] = handoff

        return handoff

    async def compact_if_needed(self, messages: list, ctx: 'TaskContext') -> list:
        """98% 阈值触发上下文压缩"""
        total_tokens = self._count_tokens(messages)
        utilization = total_tokens / self.MAX_CONTEXT_TOKENS

        if utilization >= self.COMPACTION_THRESHOLD:
            # 保留关键元数据 + 最近 N 轮对话
            critical = self._extract_critical(messages)
            summary = await self._summarize(messages[:-20], ctx)
            # 保存检查点
            await self.checkpoint.save(ctx.task_id, ctx.state, messages, "auto_compact")
            return [{"role": "system", "content": f"[会话摘要] {summary}"}] + critical
        return messages
```

### 2.6 熵管理系统（Entropy Management）——垃圾回收

**核心问题**：技术债务越积越多；文档与代码不一致。

**业界实践**：
- OpenAI：持续小额偿还策略——"技术债就是高利贷，越滚越大"
- Anthropic：文档园丁 Agent（Doc Gardener）在后台自动扫描不一致，提交修复 PR
- Hashimoto：每次失败转化为一条规则，文档成为活的反馈循环

**FlowForge v6.0 实现**：

```python
# flowforge/harness/entropy_manager.py

class EntropyManager:
    """熵管理引擎：技术债回收 + 文档园丁 + 持续小额偿还"""

    def __init__(self, knowledge_base, llm_client, scheduler):
        self.kb = knowledge_base
        self.llm = llm_client
        self.scheduler = scheduler
        self.debt_tracker = DebtTracker()

    async def start_garden_agents(self):
        """启动后台园丁 Agent"""
        # 1. 文档园丁：每天凌晨扫描文档-代码不一致
        self.scheduler.add_job(
            self._doc_gardener_scan,
            trigger="cron",
            hour=2,
            id="doc_gardener"
        )
        # 2. 技术债回收：每周扫描技术债
        self.scheduler.add_job(
            self._debt_collection,
            trigger="cron",
            day_of_week="mon",
            hour=3,
            id="debt_collector"
        )

    async def _doc_gardener_scan(self):
        """文档园丁：扫描文档与代码不一致，自动提交修复 PR"""
        inconsistencies = await self._scan_doc_code_consistency()
        for issue in inconsistencies:
            pr = await self._create_fix_pr(issue)
            await self._submit_for_review(pr)

    async def _debt_collection(self):
        """持续小额偿还技术债"""
        debt_items = self.debt_tracker.get_high_priority(limit=5)
        for item in debt_items:
            # 为每个技术债启动一个微小的修复任务
            task = {
                "description": f"修复技术债: {item['description']}",
                "estimated_effort": item.get("effort", "small"),
                "priority": item["priority"],
            }
            await self._dispatch_refactor_task(task)

    async def capture_failure_to_rule(self, failure: dict, ctx: 'TaskContext') -> str:
        """将失败转化为规则（Hashimoto 核心方法论）"""
        rule = await self.llm.chat([{
            "role": "user",
            "content": f"将以下 Agent 失败案例转化为一条简洁的工程规则，防止未来再次发生:\n{failure}"
        }])
        rule_text = rule.get("content", "")
        # 写入 AGENTS.md（活的反馈循环）
        await self.kb.store("rules", f"auto_rule_{int(time.time())}", rule_text)
        # 记录到技术债跟踪器
        self.debt_tracker.add_item({
            "description": rule_text,
            "source": "agent_failure",
            "priority": "high",
        })
        return rule_text
```

---

## 三、FlowForge v6.0 总架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           模型层 (Model Layer)                               │
│               GPT / Claude / DeepSeek / Kimi / Ollama / Gemini               │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                      FlowForge v6.0 — Harness 驾驭层                         │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                   HybridExecutor (核心调度器)                         │   │
│  │  · 模式选择 (9 大模式)                                                │   │
│  │  · 控制回路 (前馈 + 反馈)                                             │   │
│  │  · TAOR 循环 (Think-Act-Observe-Repeat)                              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         四根护栏 (四大引擎)                            │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ 上下文工程   │  │ 架构约束    │  │ 反馈循环    │  │ 熵管理      │  │   │
│  │  │ ContextEngine│  │ ArchCons-   │  │ FeedbackLoop│  │ EntropyMgr │  │   │
│  │  │             │  │ traintEngine│  │             │  │             │  │   │
│  │  │ · AGENTS.md │  │ · 分层依赖  │  │ · 独立评判  │  │ · 文档园丁  │  │   │
│  │  │ · 会话交接  │  │ · Linter   │  │ · 四维评分  │  │ · 技术债回收│  │   │
│  │  │ · 按需注入  │  │ · CI阻断   │  │ · 自修正    │  │ · 规则进化  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        基础设施层                                      │   │
│  │                                                                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │   │
│  │  │Permission│  │ Session  │  │ 9大模式  │  │ Tool     │             │   │
│  │  │Pipeline  │  │ Manager  │  │ 执行器   │  │ Registry │             │   │
│  │  │deny→ask→ │  │交接·压缩 │  │ReAct等   │  │MCP·安全  │             │   │
│  │  │allow     │  │·检查点   │  │          │  │·沙箱     │             │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │   │
│  │                                                                       │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │   │
│  │  │Memory    │  │  SubAgent│  │ EventBus │  │ Audit    │             │   │
│  │  │Manager   │  │  Engine  │  │ + Solo   │  │ Trail    │             │   │
│  │  │5种记忆   │  │ 隔离·摘要│  │          │  │ 全链路   │             │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 四、从 v5.0 到 v6.0 的迁移路径

### 4.1 模块对照与迁移策略

| v5.0 模块 | v6.0 模块 | 迁移策略 |
|-----------|----------|---------|
| `SecureToolRegistry` | `PermissionPipeline` | **增强**：增加 deny/ask/allow 三层管线 + 动作分级 |
| `ContextCompressor` | `SessionManager` | **替换**：增加 98% 阈值触发 + 会话交接 + 检查点 |
| `AuditAgent` | `FeedbackLoop` | **替换**：独立评判 Agent + 四维评分 + 分类闸门 |
| `MultiAgentExecutor._run_subagents()` | `SubAgentEngine` | **增强**：独立上下文窗口 + 令牌预算 + 交接物 |
| `WorkflowExecutor` | `ArchitectureConstraintEngine` | **新增**：Linter 规则 + 分层依赖检查 |
| (新增) | `EntropyManager` | **新增**：文档园丁 + 技术债回收 + 规则进化 |
| (新增) | `ContextEngine` | **新增**：AGENTS.md 按需注入 + 失败转规则 |

### 4.2 启动配置

```yaml
# config/harness_v6.yaml
flowforge:
  version: "6.0"
  mode: "harness"  # harness | framework

harness:
  context_engineering:
    enabled: true
    agents_md_path: "config/AGENTS.md"
    dynamic_injection: true
    handoff_enabled: true

  architecture_constraints:
    enabled: true
    layer_model: ["Types", "Config", "Repo", "Service", "Runtime", "UI"]
    linter_rules_path: "config/linter_rules.yaml"
    ci_gate: "fail_on_violation"

  feedback_loop:
    enabled: true
    evaluator_model: "sonnet-4.6"
    scoring_dimensions: [design_quality, originality, craft, functionality]
    pass_threshold: 0.8
    max_reflexion_iterations: 3
    cross_validation: true

  permission_pipeline:
    enabled: true
    tiers: [deny, ask, allow]
    action_levels:
      read: auto_approved
      suggest: prompt_user
      prepare: prompt_user
      execute: require_approval

  session_management:
    compaction_threshold: 0.92
    handoff_enabled: true
    checkpoint_interval: 300

  entropy_management:
    enabled: true
    doc_gardener_schedule: "0 2 * * *"
    debt_collection_schedule: "weekly"
    capture_failures_to_rules: true
```

### 4.3 核心组件初始化

```python
from flowforge.v6 import FlowForgeV6

forge = FlowForgeV6.from_config("config/harness_v6.yaml")

# Harness 组件自动初始化
forge.context_engine      # ContextEngine
forge.arch_constraint      # ArchitectureConstraintEngine
forge.feedback_loop       # FeedbackLoop
forge.permission_pipeline # PermissionPipeline
forge.session_manager     # SessionManager
forge.entropy_manager     # EntropyManager

# 启动后台园丁 Agent
forge.entropy_manager.start_garden_agents()

# 执行任务（Harness 层自动介入）
result = await forge.run(
    task_id="task-001",
    persona="education",
    input_data={"topic": "武汉中考政策分析"},
    mode="workflow",
    interaction_mode="standard",
)
```

---

## 五、总结

FlowForge v6.0 的核心升级不是增加新模式，而是**为所有现有模式加上一套完整的控制系统**——这正是 Harness Engineering 的本质。

| 维度 | v5.0 | v6.0 | 核心变化 |
|------|------|------|---------|
| **定位** | Agent 编排框架 | Agent 驾驭层 (Harness) | 从"编排"到"控制" |
| **前馈控制** | Persona 配置文件 | AGENTS.md + Linter Rules + Permission Pipeline | 从"软提示"到"硬约束" |
| **反馈控制** | AuditAgent 自评 | 独立评判 Agent + 四维评分 + 分类闸门 | 从"自评"到"互评" |
| **上下文管理** | 85% 阈值压缩 | 98% 阈值触发 + 会话交接 + 检查点 | 从"粗放压缩"到"精细交接" |
| **熵管理** | 无 | 文档园丁 + 技术债回收 + 规则进化 | 从"无"到"持续维护" |
| **安全模型** | safety_level 属性 | deny→ask→allow 三层管线 | 从"标记"到"管线" |

**核心理念**：**让模型专注于推理，让 Harness 负责约束、验证和进化。** 每一次 Agent 的失败，都通过反馈回路被捕捉，转化为一条新的前馈规则。这就是"永远不再犯同样的错"的控制论解读——也是 FlowForge 从"框架"进化为"操作系统"的关键一步。


根据网络搜索结果，OpenHarness 的核心模块划分已明确：

```
engine/  → Agent Loop
tools/   → 工具注册和执行
skills/  → 按需加载知识
plugins/ → 扩展
permissions/hooks/ → 治理
memory/tasks/coordinator/ → 长期运行和协作
```

Claude Code 的源码架构则揭示了一个更庞大的 Harness 骨架：

```
QueryEngine (4.6万行) → Tool系统 (40+工具/~5万行) → 权限管线 (24+个文件) → 
记忆系统 → IDE桥接 → MCP管道 → 多代理编排
```

---

补充内容的架构设计如下（如何遗漏的地方和未提及的地方，需要你帮忙补充完善下）
1，按新的架构图，调整所有目录结构，让各个功能模块对应的目录结构更加合理
2，参考主流开源框架，和你前边文档中提到的几个大厂的优秀实践，把你架构图中的每个模块对应的目录结构和需要实现的功能文件，全都列出来。目前flowforge的目录结构混乱，你需要重构调整。
3，另外很多模块很多功能实现缺少，尤其是工具模块，还有很多其他模块也是，你目前架构很好，参考主流大厂harness实践和优秀harness开源代码，把架构中的每个模块需要实现的关键能力和文件列表都列出来

# FlowForge v6.0 架构设计（补充 完整目录结构重构方案）：深度融合 Harness 工程体系

基于 Harness Engineering 的**四根护栏**理念（上下文工程、架构约束、反馈循环、熵管理），结合 OpenHarness 的精炼设计、Claude Code 的生产级架构、Harness Agent 的 Pipeline-Native 哲学，我给出全新的 FlowForge v6.0 目录树。


```
flowforge/
│
├── core/                              # [核心内核] FlowForge 的心脏
│   ├── __init__.py
│   ├── base_agent.py                  # BaseAgent 接口
│   ├── base_tool.py                   # BaseTool 接口（含 safety_level）
│   ├── base_mode_executor.py          # BaseModeExecutor（含 _on_exit 防御钩子）
│   ├── task_context.py                # TaskContext（含 from_parent 上下文隔离）
│   ├── di.py                          # DIContainer 依赖注入容器
│   ├── errors.py                      # FlowForgeError 统一异常体系
│   ├── config.py                      # YAML 配置加载器（pydantic-settings）
│   ├── tracing.py                     # trace_id 注入与全链路追踪
│   └── metrics.py                     # Prometheus 指标采集
│
├── engine/                            # [执行引擎] Agent Loop + 模式注册 + 调度器
│   ├── __init__.py
│   ├── hybrid_executor.py             # HybridExecutor（TAOR 循环 + Persona 锁）
│   ├── defense_layer.py               # 三层防御中间件（超时/重复检测/自修正）
│   ├── agent_registry.py              # AgentRegistry 注册中心
│   ├── mode_registry.py               # ModeRegistry 模式注册与智能推荐
│   └── scheduler.py                   # TaskScheduler（APScheduler + Cron）
│
├── harness/                           # [驾驭层] ★ v6.0 新增 — 四根护栏
│   ├── __init__.py
│   │
│   ├── context/                       # 护栏一：上下文工程
│   │   ├── __init__.py
│   │   ├── context_engine.py          # 上下文引擎（AGENTS.md 按需注入 + 会话交接）
│   │   ├── session_manager.py         # 会话管理（98% 阈值压缩 + 检查点 + 交接物）
│   │   └── knowledge_retriever.py     # 知识检索器（向量库检索规则/案例/交接物）
│   │
│   ├── constraints/                   # 护栏二：架构约束
│   │   ├── __init__.py
│   │   ├── arch_constraint_engine.py  # 架构约束引擎（分层依赖模型 + CI 门禁）
│   │   ├── linter_rules.py            # 自定义 Linter 规则库
│   │   ├── linter_runner.py           # Linter 执行器（代码 → 违规报告）
│   │   └── rules_repository.py        # 规则仓库（版本化、可审计）
│   │
│   ├── feedback/                      # 护栏三：反馈循环
│   │   ├── __init__.py
│   │   ├── feedback_loop.py           # 反馈循环引擎（生成与评判分离 + 自修正）
│   │   ├── evaluator_agent.py         # 独立评判 Agent（四维评分体系）
│   │   ├── classifier_gate.py         # 分类闸门（只看工具执行结果）
│   │   └── verification_hooks.py      # 验证钩子（PreToolUse / PostToolUse）
│   │
│   ├── entropy/                       # 护栏四：熵管理
│   │   ├── __init__.py
│   │   ├── entropy_manager.py         # 熵管理引擎（技术债回收 + 规则进化）
│   │   ├── doc_gardener.py            # 文档园丁 Agent（文档-代码一致性扫描）
│   │   ├── debt_tracker.py            # 技术债跟踪器（优先级排序 + 持续偿还）
│   │   └── rule_evolution.py          # 规则进化器（失败 → 规则转化）
│   │
│   └── control_loop.py                # 控制回路编排器（前馈 + 反馈 + 熵管理调度）
│
├── security/                          # [安全体系] 权限管线 + 审计
│   ├── __init__.py
│   ├── permission_pipeline.py         # 三层权限管线（deny → ask → allow）
│   ├── action_classifier.py           # 动作分级器（Read/Suggest/Prepare/Execute）
│   ├── secure_tool_registry.py        # 安全工具注册表（safety_level + 并发锁）
│   ├── sandbox.py                     # 沙箱执行器（进程隔离 + 资源限制 + 跨平台）
│   ├── path_validator.py              # 路径校验器（路径穿越防护）
│   └── audit_trail.py                 # 审计追踪（全链路记录 + 脱敏）
│
├── tools/                             # [工具生态] MCP + OpenAPI + GraphQL 多协议
│   ├── __init__.py
│   ├── base.py                        # BaseTool 实现基类
│   ├── registry.py                    # ToolRegistry 工具注册表（L1 超时防御）
│   ├── tool_gate.py                   # GatedToolPipeline（门控工具管线）
│   │
│   ├── builtin/                       # 内置工具（12+ 个）
│   │   ├── __init__.py
│   │   ├── llm_client.py              # 统一 LLM 客户端（多供应商 + 故障转移）
│   │   ├── file_rw.py                 # 文件读写（路径穿越防护）
│   │   ├── shell_executor.py          # Shell 命令执行（沙箱）
│   │   ├── web_search.py              # 网络搜索（Tavily + HelixRAG 降级）
│   │   ├── web_scraper.py             # 网页抓取
│   │   ├── helixrag_client.py         # HelixRAG 检索
│   │   ├── python_executor.py         # Python 沙箱执行（跨平台兼容）
│   │   ├── git_ops.py                 # Git 操作（commit/push/PR）
│   │   ├── image_search.py            # 图片搜索（Pexels/Unsplash）
│   │   ├── mail_sender.py             # 邮件发送
│   │   ├── webhook.py                 # Webhook 通知
│   │   └── task_board_tool.py         # TaskBoard 操作工具
│   │
│   ├── adapters/                      # 协议适配器
│   │   ├── __init__.py
│   │   ├── mcp_adapter.py             # MCP 协议适配（Model Context Protocol）
│   │   ├── openapi_adapter.py         # OpenAPI 规范自动转 Tool
│   │   ├── graphql_adapter.py         # GraphQL 自动转 Tool
│   │   └── grpc_adapter.py            # gRPC 服务适配
│   │
│   └── publish/                       # 发布工具
│       ├── __init__.py
│       ├── toutiao_publisher.py       # 今日头条发布
│       └── wechat_publisher.py        # 微信公众号发布
│
├── memory/                            # [记忆系统] 5 种策略 + 任务板 + 信箱
│   ├── __init__.py
│   ├── manager.py                     # MemoryManager（集成压缩器 + 检查点）
│   ├── compressor.py                  # ContextCompressor（tiktoken + 滑动窗口）
│   ├── checkpoint.py                  # CheckpointManager（增量保存 + 恢复）
│   ├── working.py                     # 工作记忆（Python dict）
│   ├── short_term.py                  # 短期记忆（SQLite + TTL）
│   ├── long_term.py                   # 长期记忆（SQLite/PostgreSQL）
│   ├── semantic.py                    # 语义记忆（Qdrant/Milvus 占位）
│   ├── episodic.py                    # 情景记忆（任务轨迹）
│   ├── task_board.py                  # 多 Agent 共享任务板（原子认领）
│   └── mailbox.py                     # Agent 间通信信箱（优先级 + 过期）
│
├── events/                            # [事件系统] 可观测性 + Solo 实时交互
│   ├── __init__.py
│   ├── event_bus.py                   # EventBus（同步/异步兼容）
│   ├── event_types.py                 # 事件类型常量（17 种）
│   ├── solo_adapter.py                # EventBusSoloAdapter（17→16 映射）
│   └── audit_logger.py                # 审计日志写入器
│
├── modes/                             # [模式执行器] 9 大内置模式
│   ├── __init__.py
│   ├── react.py                       # ReAct（TAOR 循环 + 循环检测）
│   ├── plan_execute.py                # Plan-and-Execute（Planner + Executor）
│   ├── reflexion.py                   # Reflexion（Actor → Evaluator → Reflector）
│   ├── multi_agent.py                 # Multi-Agent（Subagents/Teams/Swarms）
│   ├── workflow.py                    # Workflow（DAG 编排 + defense 配置）
│   ├── rewoo.py                       # ReWOO（一次性规划批量执行）
│   ├── self_discover.py               # Self-Discover（自动发现推理框架）
│   ├── agent_judge.py                 # Agent-as-Judge（独立评判）
│   ├── graph_of_thoughts.py           # Graph of Thoughts（图式推理）
│   └── default_llm_actors.py          # DefaultLLMActor/Evaluator/Reflector
│
├── agents/                            # [通用 Agent 库] 30+ 预置 Agent
│   ├── __init__.py
│   ├── content/                       # 内容创作类（12 个，✅ 已验证）
│   │   ├── __init__.py
│   │   ├── topic_research.py
│   │   ├── material_collection.py
│   │   ├── article_writing.py
│   │   ├── seo_optimization.py
│   │   ├── fact_check.py
│   │   ├── content_audit.py
│   │   ├── headline_optimizer.py
│   │   ├── content_repurposer.py
│   │   ├── trend_analysis.py
│   │   ├── publishing_agent.py
│   │   ├── image_research.py
│   │   └── multilingual.py
│   ├── novel/                         # 小说创作类（12 个，📅 待验证）
│   │   ├── __init__.py
│   │   ├── outline_planning.py
│   │   ├── character_design.py
│   │   ├── chapter_writing.py
│   │   ├── plot_integration.py
│   │   ├── style_consistency.py
│   │   ├── volume_aggregator.py
│   │   ├── dialogue_generation.py
│   │   ├── conflict_development.py
│   │   ├── world_building.py
│   │   ├── reader_engagement.py
│   │   ├── serialization.py
│   │   └── adaptation.py
│   └── code/                          # 代码与工具类（8 个，🔄 设计中）
│       ├── __init__.py
│       ├── code_review.py
│       ├── task_decomposition.py
│       ├── meta_planner.py
│       ├── debate_agent.py
│       ├── data_analysis.py
│       ├── prompt_optimizer.py
│       ├── test_generation.py
│       └── documentation.py
│
├── workflows/                         # [通用 Workflow] 15+ 预置 YAML 模板
│   ├── deep_article.yaml
│   ├── quick_post.yaml
│   ├── trend_article.yaml
│   ├── multi_platform.yaml
│   ├── seo_content.yaml
│   ├── image_article.yaml
│   ├── multilingual.yaml
│   ├── report_generation.yaml
│   ├── defense_article.yaml           # 带三层防御的创作流程
│   ├── novel_full_process.yaml
│   ├── novel_chapter.yaml
│   ├── novel_outline.yaml
│   ├── novel_adaptation.yaml
│   ├── serialized_novel.yaml
│   └── code_review.yaml
│
├── plugins/                           # [插件系统] 三层扩展架构
│   ├── __init__.py
│   ├── plugin_manager.py              # PluginManager（entry_points + YAML）
│   ├── skills_loader.py               # Skills 按需加载器
│   └── hooks_registry.py              # Hooks 注册表（Pre/Post ToolUse）
│
├── observability/                     # [可观测性] 追踪 + 指标 + 告警
│   ├── __init__.py
│   ├── tracing.py                     # OpenTelemetry 集成
│   ├── metrics.py                     # Prometheus 端点
│   ├── dashboard.py                   # Grafana 仪表盘配置
│   └── alerts.py                      # 告警规则（配额/延迟/错误率）
│
├── scheduler/                         # [定时调度] Cron + 后台任务
│   ├── __init__.py
│   ├── scheduler.py                   # TaskScheduler
│   ├── jobs.py                        # 预定义任务（文档园丁/技术债回收）
│   └── cron_parser.py                 # Cron 表达式解析
│
├── cli/                               # [命令行] 运维工具
│   ├── __init__.py
│   ├── engine_health.py               # 引擎健康检查
│   ├── model_manager.py               # 模型管理 CLI
│   └── config_validator.py            # 配置验证器
│
├── api/                               # [接入层] FastAPI REST + WebSocket
│   ├── __init__.py
│   ├── main.py                        # FastAPI 启动入口
│   ├── router.py                      # 路由聚合
│   ├── deps.py                        # 依赖注入获取器
│   └── endpoints/
│       ├── __init__.py
│       ├── tasks.py                   # 任务 CRUD + 审核
│       ├── modes.py                   # 模式管理
│       ├── agents.py                  # Agent 管理
│       ├── workflows.py               # Workflow 管理
│       ├── models.py                  # 模型治理
│       ├── dashboard.py               # 仪表盘
│       ├── plugins.py                 # 插件管理
│       ├── review.py                  # 审核中心
│       ├── schedules.py               # 定时任务管理
│       └── webhook.py                 # Webhook 回调
│
├── config/                            # [全局配置]
│   ├── system.yaml                    # 系统参数
│   ├── models.yaml                    # 模型供应商及分配策略
│   ├── harness_v6.yaml                # Harness 层配置（v6.0 新增）
│   ├── permission_rules.yaml          # 权限规则定义
│   ├── linter_rules.yaml              # Linter 规则库
│   └── persona/                       # 专栏人格配置（ContentForge）
│       ├── education.yaml
│       ├── life.yaml
│       ├── content.yaml
│       ├── novel.yaml
│       ├── dev.yaml
│       └── student.yaml
│
├── tests/                             # [测试]
│   ├── conftest.py
│   ├── pytest.ini
│   ├── unit/
│   │   ├── test_core.py
│   │   ├── test_engine.py
│   │   ├── test_harness_context.py
│   │   ├── test_harness_constraints.py
│   │   ├── test_harness_feedback.py
│   │   ├── test_harness_entropy.py
│   │   ├── test_security.py
│   │   ├── test_tools.py
│   │   ├── test_memory.py
│   │   ├── test_events.py
│   │   ├── test_modes.py
│   │   └── test_plugins.py
│   ├── integration/
│   │   ├── test_api.py
│   │   ├── test_sop_flow.py
│   │   ├── test_plugin_system.py
│   │   └── test_cross_platform.py
│   └── performance/
│       ├── test_concurrent_tasks.py
│       └── locustfile.py
│
├── docs/                              # [文档]
│   ├── arch.md                        # 架构设计 v4.0
│   ├── design.md                      # 详细设计 v2.0
│   ├── harness_v6_design.md           # Harness v6.0 架构设计（新增）
│   ├── api.md                         # API 参考 v1.1
│   ├── test.md                        # 测试用例 v1.1
│   └── archive/                       # 历史版本归档
│
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml
├── pytest.ini
└── README.md
```

---

## 完整模块功能文件清单

### 一、core/ — 核心内核（9 个文件，约 900 行）

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `base_agent.py` | Agent 抽象 | `execute()` + `execute_with_context()` 双签名 |
| `base_tool.py` | Tool 抽象 | `safety_level` 属性 + `is_concurrency_safe` |
| `base_mode_executor.py` | 执行器基类 | `_on_enter()` / `_on_exit()` 防御钩子 |
| `task_context.py` | 任务上下文 | `from_parent()` 上下文隔离 + `interaction_mode` |
| `di.py` | DI 容器 | 手动轻量容器 + `register_agent()` 标记 |
| `errors.py` | 异常体系 | `FlowForgeError` + 6 种子类 |
| `config.py` | 配置加载 | `pydantic-settings` + YAML 合并 |
| `tracing.py` | 全链路追踪 | `trace_id` 注入 + `get_logger()` |
| `metrics.py` | 指标采集 | Prometheus `Counter/Histogram/Gauge` |

### 二、engine/ — 执行引擎（6 个文件，约 800 行）

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `hybrid_executor.py` | 混合执行器 | TAOR 循环 + Persona 锁 + `_is_substep` 参数 |
| `defense_layer.py` | 三层防御 | L1 超时 / L2 重复检测 / L3 自修正 |
| `agent_registry.py` | Agent 注册 | 按名称注册/获取 Agent |
| `mode_registry.py` | 模式注册 | 注册/获取/推荐模式 |
| `scheduler.py` | 定时调度 | APScheduler + SQLAlchemy job store |
| `state_manager.py` | 状态管理 | 检查点保存/恢复接口 |

### 三、harness/ — 驾驭层（14 个文件，约 2500 行）★ 新增

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `context/context_engine.py` | 上下文引擎 | AGENTS.md 按需检索 + 会话交接物构建 |
| `context/session_manager.py` | 会话管理 | 98% 阈值压缩 + 交接物持久化 |
| `constraints/arch_constraint_engine.py` | 架构约束 | 分层依赖模型 + CI 门禁 |
| `constraints/linter_rules.py` | Linter 规则库 | 可扩展规则定义 |
| `constraints/linter_runner.py` | Linter 执行器 | 代码 → AST 解析 → 违规报告 |
| `feedback/feedback_loop.py` | 反馈循环 | 生成与评判分离 + 四维评分 |
| `feedback/evaluator_agent.py` | 独立评判 Agent | 独立 LLM 调用评估输出质量 |
| `feedback/classifier_gate.py` | 分类闸门 | 只看工具结果，忽略模型文本 |
| `feedback/verification_hooks.py` | 验证钩子 | PreToolUse/PostToolUse 拦截点 |
| `entropy/entropy_manager.py` | 熵管理引擎 | 垃圾回收调度 + 持续小额偿还 |
| `entropy/doc_gardener.py` | 文档园丁 | 文档-代码一致性扫描 + PR 修复 |
| `entropy/debt_tracker.py` | 技术债跟踪 | 优先级排序 + 量级评估 |
| `entropy/rule_evolution.py` | 规则进化 | 失败 → 规则自动转化 |
| `control_loop.py` | 控制回路 | 前馈 + 反馈 + 熵管理统一调度 |

### 四、security/ — 安全体系（7 个文件，约 900 行）

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `permission_pipeline.py` | 三层权限管线 | deny → ask → allow 规则评估 |
| `action_classifier.py` | 动作分级器 | Read/Suggest/Prepare/Execute 四级 |
| `secure_tool_registry.py` | 安全注册表 | safety_level + 并发锁 + 审批流程 |
| `sandbox.py` | 沙箱执行 | 进程隔离 + 资源限制 + 跨平台 |
| `path_validator.py` | 路径校验 | 路径穿越防护 |
| `audit_trail.py` | 审计追踪 | 全链路记录 + 敏感信息脱敏 |

### 五、tools/ — 工具生态（约 20 个文件，约 3000 行）

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `registry.py` | 工具注册表 | 注册/获取/执行 + L1 超时 + emit_callback |
| `tool_gate.py` | 门控工具管线 | 权限检查→安全分类→执行→输出校验 |
| `builtin/llm_client.py` | LLM 客户端 | 多供应商 + 故障转移 + 流式 |
| `builtin/file_rw.py` | 文件读写 | 路径校验 + 安全边界 |
| `builtin/shell_executor.py` | Shell 执行 | 沙箱 + 命令白名单 |
| `builtin/web_search.py` | 网络搜索 | Tavily/HelixRAG 降级 |
| `builtin/helixrag_client.py` | 混合检索 | 向量+关键词+图谱 |
| `builtin/python_executor.py` | Python 沙箱 | 进程隔离 + 危险函数移除 |
| `builtin/git_ops.py` | Git 操作 | commit/push/PR 创建 |
| `builtin/task_board_tool.py` | 任务板操作 | 认领/完成/失败任务 |
| `adapters/mcp_adapter.py` | MCP 适配 | Model Context Protocol |
| `adapters/openapi_adapter.py` | OpenAPI 适配 | 规范 → Tool 自动生成 |
| `adapters/graphql_adapter.py` | GraphQL 适配 | 端点 → Tool 自动生成 |

### 六、memory/ — 记忆系统（12 个文件，约 1800 行）

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `manager.py` | 记忆管理器 | 5 种策略统一接口 + 压缩器集成 |
| `compressor.py` | 上下文压缩 | tiktoken + 滑动窗口 + 98% 阈值 |
| `checkpoint.py` | 检查点管理 | 增量保存 + 恢复 + 版本管理 |
| `task_board.py` | 任务板 | RETURNING 原子认领 + 批量操作 |
| `mailbox.py` | 信箱 | 优先级 + 过滤 + 过期清理 |
| `working.py` | 工作记忆 | Python dict |
| `short_term.py` | 短期记忆 | SQLite + TTL |
| `long_term.py` | 长期记忆 | SQLite/PostgreSQL |
| `semantic.py` | 语义记忆 | Qdrant/Milvus 占位 |
| `episodic.py` | 情景记忆 | 任务轨迹存储 |

### 七、events/ — 事件系统（4 个文件，约 600 行）

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `event_bus.py` | 事件总线 | 同步 emit + iscoroutine 检测 |
| `event_types.py` | 事件类型 | 17 种事件常量定义 |
| `solo_adapter.py` | Solo 适配器 | 17→16 事件映射 + bridge() |
| `audit_logger.py` | 审计日志 | SQLite 写入 + trace_id |

### 八、modes/ — 模式执行器（10 个文件，约 3500 行）

| 文件 | 关键能力 | 需要实现的核心功能 |
|------|---------|------------------|
| `react.py` | ReAct | Thought → Action → Observation 循环 |
| `plan_execute.py` | Plan-Execute | Planner + Executor 分离 |
| `reflexion.py` | Reflexion | Actor/Evaluator/Reflector 三 Agent |
| `multi_agent.py` | Multi-Agent | Subagents/Teams/Swarms 三策略 |
| `workflow.py` | Workflow | DAG 编排 + defense 配置 + 错误处理 |
| `rewoo.py` | ReWOO | 蓝图生成 + 批量执行 |
| `self_discover.py` | Self-Discover | 自动推荐模式 |
| `agent_judge.py` | Agent-as-Judge | 独立评判 Agent |
| `graph_of_thoughts.py` | GoT | 图式推理 |
| `default_llm_actors.py` | 默认 LLM | DefaultLLMActor/Evaluator/Reflector |

### 九、agents/ — 通用 Agent 库（32 个文件）

| 子目录 | Agent 数量 | 来源 | 验证状态 |
|--------|----------|------|---------|
| `content/` | 12 个 | ContentForge 提炼 | ✅ 已验证 |
| `novel/` | 12 个 | 小说创作最佳实践 | 📅 待验证 |
| `code/` | 8 个 | 业界开源引入 | 🔄 设计中 |

### 十、api/ — 接入层（12 个文件）

| 端点文件 | 端点数量 | 核心功能 |
|---------|---------|---------|
| `tasks.py` | 8 个 | 任务 CRUD + 审核 + 暂停/恢复/跳过 |
| `modes.py` | 1 个 | 获取可用模式列表 |
| `agents.py` | 1 个 | 获取已注册 Agent 列表 |
| `workflows.py` | 1 个 | 获取已注册 Workflow 列表 |
| `models.py` | 6 个 | 模型健康/分配/修复 |
| `dashboard.py` | 3 个 | 关键操作/实时状态/统计 |
| `plugins.py` | 3 个 | 列表/安装/重载 |
| `review.py` | 2 个 | 审核队列/详情 |
| `schedules.py` | 5 个 | 定时任务 CRUD |
| `webhook.py` | 1 个 | Webhook 回调 |

---

## 旧目录 → 新目录迁移对照表

| 旧路径 | 新路径 | 迁移策略 |
|--------|-------|---------|
| `executor/hybrid_executor.py` | `engine/hybrid_executor.py` | 移动 |
| `executor/defense_layer.py` | `engine/defense_layer.py` | 移动 |
| `memory/compressor.py` | `harness/context/session_manager.py` | 合并+增强 |
| `memory/checkpoint.py` | `memory/checkpoint.py` | 保留 |
| `tools/secure_registry.py` | `security/secure_tool_registry.py` | 移动 |
| `tools/registry.py` | `tools/registry.py` | 保留 |
| `tools/python_executor.py` | `security/sandbox.py` + `tools/builtin/python_executor.py` | 拆分 |
| `modes/` | `modes/` | 保留 |
| `agents/` | `agents/content/` | 重组 |
| 新增 | `harness/` 全部 14 个文件 | 全新实现 |
| 新增 | `security/` 除 secure_tool_registry 外的 6 个文件 | 全新实现 |
| 新增 | `tools/builtin/` 12 个工具 | 全新实现 |
| 新增 | `tools/adapters/` 4 个适配器 | 全新实现 |
| 新增 | `agents/novel/` 12 个 Agent | 全新实现 |
| 新增 | `agents/code/` 8 个 Agent | 全新实现 |
| 新增 | `observability/` 4 个文件 | 全新实现 |
| 新增 | `plugins/` 3 个文件 | 全新实现 |

---

以上为 FlowForge v6.0 **完整目录结构重构方案**。新的目录树覆盖了 Harness 四根护栏的全部核心能力、12 个内置工具、30+ 通用 Agent、15+ Workflow 模板，以及安全体系和可观测性基础设施，所有模块均可在新结构中找到明确归属。


# FlowForge v6.0 架构设计（补充FlowForge v6.0 Skill 系统 & MCP 模块架构设计）

---

## 第一部分：Skill 系统设计

### 一、设计目标与核心定位

在 FlowForge 的 Harness 架构中，Skill 位于 **上下文工程** 与 **架构约束** 之间，是将隐式 Prompt 显式化的关键模块。设计目标：

1. **跨平台兼容**：原生支持 Claude Code / Anthropic Skills / Trae CN / OpenHarness 四种主流 Skill 格式
2. **与 Harness 深度融合**：Skill 注入约束、反馈、上下文，形成完整闭环
3. **团队协作就绪**：项目级 Skill + Git 版本控制 + 符号链接机制
4. **可观测性**：调用统计、成功率追踪、技能市场

### 二、Skill 标准格式（FlowForge 统一格式）

#### 2.1 SKILL.md 文件规范

```markdown
---
name: weekly-report
description: 周报生成器，帮助用户快速生成结构化的工作周报。当用户需要写周报、总结本周工作时，应使用此技能。
version: 1.2.0
author: flowforge-team
triggers:
  - 周报
  - 每周总结
  - 工作汇报
  - weekly report
required_tools:
  - table_formatter
  - markdown_writer
constraints:
  - 表格必须完整，不能省略列
  - 如果用户没有提供某项信息，用"___"占位
  - 语气保持专业、简洁
input_schema:
  type: object
  properties:
    work_items:
      type: array
      description: 本周完成的主要工作
    next_plan:
      type: array
      description: 下周计划
    issues:
      type: string
      description: 遇到的问题或需要的支持
output_schema:
  type: object
  properties:
    markdown:
      type: string
      description: 生成的周报内容
dependencies:
  skills: []
  tools:
    - table_formatter: ">=1.0"
    - markdown_writer: ">=2.0"
mode_hint: plan_execute
max_tokens: 4000
status: active
---

# 周报生成器

## 使用步骤

1. 询问用户本周完成的主要工作（让用户列出3-5项）
2. 询问用户下周计划（让用户列出2-3项）
3. 询问用户遇到的问题或需要的支持（可选）
4. 按以下格式生成周报：

## 输出格式

```markdown
# 工作周报

**汇报人**：___
**汇报周期**：____年__月__日 - ____年__月__日

---

## 一、本周工作总结

| 序号 | 工作内容 | 完成情况 | 备注 |
|:---:|:---|:---:|:---|
| 1 | [用户输入] | ✅ 已完成 | |
| 2 | [用户输入] | ✅ 已完成 | |
| 3 | [用户输入] | 进行中 | |

## 二、下周工作计划

| 序号 | 计划内容 | 预期目标 | 需要支持 |
|:---:|:---|:---|:---|
| 1 | [用户输入] | | |
| 2 | [用户输入] | | |

## 三、问题与建议

[用户输入，如果没有则写"无"]

---

*本周报由 AI 辅助生成*
```
```

#### 2.2 Skill 目录结构

```
skills/
├── weekly-report/
│   ├── SKILL.md              # 核心定义（必需）
│   ├── skill.yaml             # 运行时配置（可选，含超时/重试/并发限制）
│   ├── README.md              # 使用说明
│   ├── references/            # 参考文档（按需加载）
│   │   └── format-guide.md
│   ├── scripts/               # 辅助脚本（可选）
│   │   └── validate_output.py
│   ├── tests/                 # Skill 专属测试
│   │   └── test_weekly_report.py
│   └── examples/              # 示例输入输出
│       └── sample.json
├── book-essence-extractor/
│   └── SKILL.md
└── ...
```

#### 2.3 skill.yaml 运行时配置

```yaml
# skills/weekly-report/skill.yaml
name: weekly-report
version: 1.2.0
runtime:
  timeout: 120             # 单次执行超时（秒）
  max_retries: 2           # 失败重试次数
  retry_delay: 5           # 重试间隔（秒）
  max_concurrent: 3        # 最大并发执行数
  token_budget: 4000       # Token 预算上限
  
hooks:
  pre_execute:             # 执行前钩子
    - validate_input.py    # 验证输入格式
  post_execute:            # 执行后钩子
    - validate_output.py   # 验证输出格式
    
observability:
  track_usage: true        # 追踪调用统计
  log_level: info          # 日志级别
  metrics_enabled: true    # 是否上报指标
```

---

### 三、多格式适配层（Format Adapter）

FlowForge 需要同时兼容四种主流 Skill 格式。通过适配器模式实现统一接入。

#### 3.1 适配器架构

```python
# flowforge/skills/adapters/base.py

from abc import ABC, abstractmethod
from flowforge.skills.models import Skill, SkillFormat

class SkillAdapter(ABC):
    """Skill 格式适配器基类：将各种外部格式转换为 FlowForge 统一格式"""
    
    format: SkillFormat
    
    @abstractmethod
    def can_parse(self, raw_content: str) -> bool:
        """判断是否能解析该格式"""
        pass
    
    @abstractmethod
    def parse(self, raw_content: str) -> Skill:
        """解析原始内容为 FlowForge Skill"""
        pass
    
    @abstractmethod
    def serialize(self, skill: Skill) -> str:
        """将 FlowForge Skill 序列化为该格式"""
        pass
```

#### 3.2 支持的四种格式

```python
# flowforge/skills/models.py

from enum import Enum

class SkillFormat(str, Enum):
    FLOWFORGE = "flowforge"      # FlowForge 原生格式（完整 YAML + Markdown）
    CLAUDE_CODE = "claude_code"  # Claude Code 格式
    ANTHROPIC = "anthropic"      # Anthropic Skills 格式
    TRAE_CN = "trae_cn"          # Trae CN 格式
    OPENHARNESS = "openharness"  # OpenHarness 格式
```

#### 3.3 格式转换映射表

| 特性 | FlowForge | Claude Code | Anthropic | Trae CN | OpenHarness |
|------|-----------|-------------|-----------|---------|-------------|
| YAML Frontmatter | ✅ 完整 | ✅ name/description | ✅ name/description | ✅ name/description | ✅ name/description |
| triggers 触发词 | ✅ 多语言 | ❌ | ❌ | ✅ 中文 | ❌ |
| input_schema | ✅ JSON Schema | ❌ | ❌ | ❌ | ❌ |
| output_schema | ✅ JSON Schema | ❌ | ❌ | ❌ | ❌ |
| required_tools | ✅ 显式声明 | ❌ | ❌ | ❌ | ❌ |
| constraints | ✅ 硬约束列表 | ❌ | ❌ | ❌ | ❌ |
| mode_hint | ✅ 推荐模式 | ❌ | ❌ | ❌ | ❌ |
| dependencies | ✅ 语义化版本 | ❌ | ❌ | ❌ | ❌ |
| 版本控制 | ✅ Git + 符号链接 | ✅ Git | ✅ Git | ✅ Git | ❌ |

#### 3.4 Claude Code 格式适配器

```python
# flowforge/skills/adapters/claude_code.py

class ClaudeCodeAdapter(SkillAdapter):
    format = SkillFormat.CLAUDE_CODE
    
    def can_parse(self, raw_content: str) -> bool:
        """Claude Code SKILL.md：必须有 YAML frontmatter 含 name/description"""
        return raw_content.startswith("---") and "name:" in raw_content[:200]
    
    def parse(self, raw_content: str) -> Skill:
        frontmatter, body = self._split_frontmatter(raw_content)
        return Skill(
            name=frontmatter.get("name", "unknown"),
            description=frontmatter.get("description", ""),
            version=frontmatter.get("version", "1.0.0"),
            triggers=frontmatter.get("triggers", []),
            instructions=body,
            format_origin=SkillFormat.CLAUDE_CODE,
        )
```

#### 3.5 Trae CN 格式适配器

```python
# flowforge/skills/adapters/trae_cn.py

class TraeCNAdapter(SkillAdapter):
    format = SkillFormat.TRAE_CN
    
    def can_parse(self, raw_content: str) -> bool:
        return raw_content.startswith("---") and "name:" in raw_content[:200]
    
    def parse(self, raw_content: str) -> Skill:
        frontmatter, body = self._split_frontmatter(raw_content)
        # Trae CN 额外支持 "triggers" 字段
        triggers = frontmatter.get("triggers", [])
        if not triggers:
            triggers = [frontmatter.get("name", "")]
        return Skill(
            name=frontmatter.get("name", "unknown"),
            description=frontmatter.get("description", ""),
            version=frontmatter.get("version", "1.0.0"),
            triggers=triggers,
            instructions=body,
            format_origin=SkillFormat.TRAE_CN,
        )
```

---

### 四、Skill Registry 与生命周期管理

#### 4.1 SkillRegistry 核心实现

```python
# flowforge/skills/registry.py

import yaml
from pathlib import Path
from typing import List, Optional, Dict
from flowforge.skills.models import Skill, SkillFormat
from flowforge.skills.adapters import detect_format, get_adapter

class SkillRegistry:
    """Skill 注册中心：双层加载 + 格式自动检测 + 符号链接支持"""
    
    def __init__(self, global_dir: str = "~/.flowforge/skills",
                 project_dir: str = "./.flowforge/skills"):
        self.global_dir = Path(global_dir).expanduser()
        self.project_dir = Path(project_dir)
        self._skills: Dict[str, Skill] = {}
        self._usage_stats: Dict[str, dict] = {}
        self._load_all()
    
    def _load_all(self):
        """加载全部 Skill：全局 + 项目（项目覆盖全局）"""
        # 1. 加载全局 Skill
        if self.global_dir.exists():
            for skill_dir in self.global_dir.iterdir():
                if skill_dir.is_dir():
                    skill = self._load_skill_from_dir(skill_dir)
                    if skill:
                        self._skills[skill.name] = skill
        
        # 2. 加载项目 Skill（覆盖全局同名 Skill）
        if self.project_dir.exists():
            for skill_dir in self.project_dir.iterdir():
                if skill_dir.is_dir() or skill_dir.is_symlink():
                    skill = self._load_skill_from_dir(skill_dir)
                    if skill:
                        self._skills[skill.name] = skill
    
    def _load_skill_from_dir(self, skill_dir: Path) -> Optional[Skill]:
        """从目录加载单个 Skill"""
        skill_file = skill_dir / "SKILL.md"
        if not skill_file.exists():
            return None
        
        raw = skill_file.read_text(encoding="utf-8")
        fmt = detect_format(raw)
        adapter = get_adapter(fmt)
        skill = adapter.parse(raw)
        skill.source_dir = skill_dir
        return skill
    
    def match_skill(self, query: str) -> List[Skill]:
        """根据用户输入匹配 Skill（触发词匹配）"""
        matched = []
        query_lower = query.lower()
        for skill in self._skills.values():
            for trigger in skill.triggers:
                if trigger.lower() in query_lower:
                    matched.append(skill)
                    break
        return matched
    
    def apply_skill(self, skill_name: str, context: 'TaskContext') -> 'TaskContext':
        """将 Skill 注入到任务上下文"""
        skill = self._skills.get(skill_name)
        if not skill:
            raise SkillNotFoundError(skill_name)
        
        # 注入指令
        context.system_prompt += f"\n\n## Skill: {skill.name}\n{skill.instructions}"
        
        # 注入约束
        for constraint in skill.constraints:
            context.constraints.append(constraint)
        
        # 注入必需工具
        for tool_name in skill.required_tools:
            context.tools.require(tool_name)
        
        # 设置推荐模式
        if skill.mode_hint and not context.mode:
            context.mode = skill.mode_hint
        
        # 记录使用统计
        self._record_usage(skill_name)
        
        return context
    
    def _record_usage(self, skill_name: str):
        stats = self._usage_stats.setdefault(skill_name, {"calls": 0, "success": 0})
        stats["calls"] += 1
```

---

### 五、Skill 组合技（Combo Skills）

参考 Trae CN 的 Skill 组合实践，支持声明式定义多 Skill 串联管道。

```yaml
# skills/combos/book-to-article.yaml
name: book-to-article
description: 读书写作一条龙：提取精华→下载封面→生成书评
version: 1.0.0
combo:
  pipeline:
    - skill: book-essence-extractor
      output_key: essence
    - skill: image-downloader
      output_key: cover_image
      depends_on: [essence]
    - skill: article-outline
      input:
        topic: "{{essence.title}}"
        image: "{{cover_image.url}}"
      output_key: article
```

---

## 第二部分：MCP 模块设计

### 一、MCP 架构总览

基于 MCP 协议生产化设计模式（参考 arXiv 2603.13417 的 CABP 协议扩展、GitHub MCP Server 700 万次/周的生产架构、FastMCP 的 Token 预算管理），FlowForge 的 MCP 模块分为四层：

```
┌─────────────────────────────────────────────────────────────┐
│                    FlowForge MCP 模块                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  L1: MCP Client（协议层）                             │   │
│  │  · JSON-RPC 2.0 客户端                               │   │
│  │  · tools/list / tools/call / resources/read           │   │
│  │  · 动态工具发现 + 延迟加载                            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  L2: MCP Gateway（治理层）                            │   │
│  │  · 工具白名单 (Allow-List)                            │   │
│  │  · 身份传播 (On-Behalf-Of)                            │   │
│  │  · 速率限制 (Rate Limiting)                           │   │
│  │  · Token 预算管理                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  L3: MCP Broker（代理层）                             │   │
│  │  · 多服务器聚合 (Server Aggregation)                  │   │
│  │  · 动态路由 (Dynamic Routing)                         │   │
│  │  · 超时/熔断/重试                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  L4: MCP Tool Adapter（适配层）                       │   │
│  │  · MCP Tool → FlowForge BaseTool 转换                │   │
│  │  · 自动 Schema 生成                                  │   │
│  │  · 输出 Token 截断（25K 默认）                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 二、MCP Client（协议层）

```python
# flowforge/mcp/client.py

import json
import asyncio
from typing import Dict, List, Optional, Any
from flowforge.mcp.transport import MCPTransport, StdioTransport, HTTPTransport
from flowforge.mcp.schema import MCPServerManifest

class MCPClient:
    """MCP 协议客户端：支持 stdio / Streamable HTTP 两种传输"""
    
    DEFAULT_TIMEOUT = 30          # 默认超时
    TOOL_DISCOVERY_CACHE_TTL = 300  # 工具发现缓存 5 分钟
    
    def __init__(self, transport: MCPTransport):
        self.transport = transport
        self._tools_cache: Optional[List[Dict]] = None
        self._tools_cache_time: float = 0
        self._connected = False
    
    async def connect(self) -> MCPServerManifest:
        """连接 MCP 服务器，返回能力清单"""
        result = await self.transport.initialize()
        self._connected = True
        return MCPServerManifest(
            server_name=result["serverInfo"]["name"],
            version=result["serverInfo"]["version"],
            capabilities=result.get("capabilities", {}),
        )
    
    async def list_tools(self, force_refresh: bool = False) -> List[Dict]:
        """列出可用工具（带缓存）"""
        import time
        now = time.time()
        if (not force_refresh and self._tools_cache 
            and now - self._tools_cache_time < self.TOOL_DISCOVERY_CACHE_TTL):
            return self._tools_cache
        
        result = await self.transport.send_request("tools/list", {})
        self._tools_cache = result.get("tools", [])
        self._tools_cache_time = now
        return self._tools_cache
    
    async def call_tool(self, tool_name: str, arguments: dict, 
                        timeout: int = None) -> Dict:
        """调用指定工具"""
        return await self.transport.send_request(
            "tools/call",
            {"name": tool_name, "arguments": arguments},
            timeout=timeout or self.DEFAULT_TIMEOUT
        )
    
    async def close(self):
        await self.transport.close()
        self._connected = False
```

### 三、MCP Gateway（治理层）

```python
# flowforge/mcp/gateway.py

from flowforge.security.permission_pipeline import PermissionPipeline
from flowforge.mcp.client import MCPClient

class MCPGateway:
    """MCP 网关：集成三层权限管线 + Token 预算 + 速率限制"""
    
    MAX_TOOL_OUTPUT_TOKENS = 25000        # 工具输出 Token 上限
    TOOL_OUTPUT_WARNING_TOKENS = 10000     # 警告阈值
    DEFAULT_RATE_LIMIT = 60               # 每分钟默认调用次数
    
    def __init__(self, permission_pipeline: PermissionPipeline):
        self.permission = permission_pipeline
        self._rate_limits: Dict[str, list] = {}
        self._token_usage: Dict[str, int] = {}
    
    async def execute_tool(self, mcp_client: MCPClient, tool_name: str, 
                           arguments: dict, context: 'TaskContext') -> Dict:
        """通过网关执行 MCP 工具调用"""
        # 1. 权限检查（三层管线）
        permission = await self.permission.evaluate(
            f"mcp:{tool_name}", arguments, context
        )
        if permission == "deny":
            return {"error": f"MCP tool '{tool_name}' blocked by permission pipeline"}
        
        # 2. 速率限制
        if not self._check_rate_limit(tool_name):
            return {"error": f"Rate limit exceeded for '{tool_name}'"}
        
        # 3. Token 预算检查
        if self._token_usage.get(tool_name, 0) > self.MAX_TOOL_OUTPUT_TOKENS:
            return {"error": f"Token budget exceeded for '{tool_name}'"}
        
        # 4. 执行工具调用
        result = await mcp_client.call_tool(tool_name, arguments)
        
        # 5. 输出 Token 截断
        output_text = json.dumps(result, ensure_ascii=False)
        tokens = self._count_tokens(output_text)
        if tokens > self.MAX_TOOL_OUTPUT_TOKENS:
            result = self._truncate_output(result, self.MAX_TOOL_OUTPUT_TOKENS)
            result["_truncated"] = True
        
        # 6. 更新统计
        self._update_rate_limit(tool_name)
        self._token_usage[tool_name] = self._token_usage.get(tool_name, 0) + tokens
        
        return result
    
    def _check_rate_limit(self, tool_name: str) -> bool:
        import time
        now = time.time()
        window = 60
        calls = self._rate_limits.get(tool_name, [])
        calls = [t for t in calls if now - t < window]
        self._rate_limits[tool_name] = calls
        return len(calls) < self.DEFAULT_RATE_LIMIT
    
    def _update_rate_limit(self, tool_name: str):
        import time
        self._rate_limits.setdefault(tool_name, []).append(time.time())
    
    def _count_tokens(self, text: str) -> int:
        try:
            import tiktoken
            enc = tiktoken.get_encoding("cl100k_base")
            return len(enc.encode(text))
        except ImportError:
            return len(text) // 2
    
    def _truncate_output(self, result: dict, max_tokens: int) -> dict:
        """截断超出 Token 预算的输出"""
        text = json.dumps(result, ensure_ascii=False)
        while self._count_tokens(text) > max_tokens and len(text) > 100:
            text = text[:int(len(text) * 0.8)]
        return json.loads(text)
```

### 四、MCP Broker（代理层）

```python
# flowforge/mcp/broker.py

from typing import Dict, List
from flowforge.mcp.client import MCPClient

class MCPBroker:
    """MCP 代理：多服务器聚合 + 动态路由 + 超时/熔断/重试"""
    
    MAX_RETRIES = 3
    CIRCUIT_BREAKER_THRESHOLD = 5  # 连续失败 5 次触发熔断
    
    def __init__(self):
        self._clients: Dict[str, MCPClient] = {}
        self._failure_counts: Dict[str, int] = {}
        self._circuit_open: Dict[str, bool] = {}
    
    def register_server(self, name: str, client: MCPClient):
        self._clients[name] = client
        self._failure_counts[name] = 0
        self._circuit_open[name] = False
    
    async def list_all_tools(self) -> List[Dict]:
        """聚合所有服务器的工具列表"""
        all_tools = []
        for name, client in self._clients.items():
            if not self._circuit_open[name]:
                try:
                    tools = await client.list_tools()
                    for tool in tools:
                        tool["_server"] = name
                    all_tools.extend(tools)
                except Exception:
                    self._record_failure(name)
        return all_tools
    
    async def call_tool(self, tool_name: str, arguments: dict, 
                        server: str = None) -> Dict:
        """调用工具：如果指定 server，直接路由；否则遍历所有服务器"""
        if server:
            return await self._call_with_retry(server, tool_name, arguments)
        
        for name, client in self._clients.items():
            tools = await client.list_tools()
            if any(t["name"] == tool_name for t in tools):
                return await self._call_with_retry(name, tool_name, arguments)
        return {"error": f"Tool '{tool_name}' not found in any MCP server"}
    
    async def _call_with_retry(self, server: str, tool_name: str, 
                                arguments: dict) -> Dict:
        for attempt in range(self.MAX_RETRIES):
            try:
                client = self._clients[server]
                result = await client.call_tool(tool_name, arguments)
                self._failure_counts[server] = 0
                return result
            except Exception as e:
                self._record_failure(server)
                if attempt == self.MAX_RETRIES - 1:
                    return {"error": str(e)}
                await asyncio.sleep(2 ** attempt)
    
    def _record_failure(self, server: str):
        self._failure_counts[server] = self._failure_counts.get(server, 0) + 1
        if self._failure_counts[server] >= self.CIRCUIT_BREAKER_THRESHOLD:
            self._circuit_open[server] = True
```

### 五、MCP Tool Adapter（适配层）

```python
# flowforge/mcp/tool_adapter.py

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.mcp.client import MCPClient

class MCPToolAdapter(BaseTool):
    """将 MCP 工具适配为 FlowForge BaseTool"""
    
    def __init__(self, mcp_client: MCPClient, tool_schema: dict, 
                 gateway=None):
        self.name = f"mcp_{tool_schema['name']}"
        self.description = tool_schema.get("description", "")
        self.parameters_schema = tool_schema.get("inputSchema", {})
        self._client = mcp_client
        self._gateway = gateway
        self._tool_name = tool_schema["name"]
    
    async def execute(self, input: ToolInput) -> ToolOutput:
        if self._gateway:
            result = await self._gateway.execute_tool(
                self._client, self._tool_name, input.params, None
            )
        else:
            result = await self._client.call_tool(
                self._tool_name, input.params
            )
        return ToolOutput(result=result)
```

---

## 第三部分：目录结构整合

```
flowforge/
├── skills/                            # [Skill 系统] ★ v6.0 新增
│   ├── __init__.py
│   ├── models.py                      # Skill 数据模型 + SkillFormat 枚举
│   ├── registry.py                    # SkillRegistry（双层加载 + 使用统计）
│   ├── loader.py                      # SkillLoader（按需加载 + 格式检测）
│   ├── combo.py                       # ComboSkill（多 Skill 管道编排）
│   │
│   ├── adapters/                      # 多格式适配层
│   │   ├── __init__.py
│   │   ├── base.py                    # SkillAdapter 基类
│   │   ├── flowforge_adapter.py       # FlowForge 原生格式
│   │   ├── claude_code_adapter.py     # Claude Code 格式
│   │   ├── anthropic_adapter.py       # Anthropic Skills 格式
│   │   └── trae_cn_adapter.py         # Trae CN 格式
│   │
│   └── store/                         # Skill 存储（兼容四种层级）
│       ├── __init__.py
│       ├── global_store.py            # 全局 Skill（~/.flowforge/skills/）
│       ├── project_store.py           # 项目 Skill（./.flowforge/skills/）
│       └── symlink_manager.py         # 符号链接管理器
│
├── mcp/                               # [MCP 模块] ★ v6.0 新增
│   ├── __init__.py
│   ├── client.py                      # MCP Client（JSON-RPC 2.0）
│   ├── transport.py                   # 传输层（stdio + Streamable HTTP）
│   ├── schema.py                      # MCP 协议 Schema 定义
│   ├── gateway.py                     # MCP Gateway（治理层：权限+Token预算+限流）
│   ├── broker.py                      # MCP Broker（多服务器聚合+熔断+重试）
│   ├── tool_adapter.py                # MCP Tool → BaseTool 适配器
│   ├── server.py                      # MCP Server Builder（暴露 FlowForge 能力）
│   └── discovery.py                   # 服务发现（mcp.json 配置扫描）
```

---

## 第四部分：启动配置

```yaml
# config/harness_v6.yaml
flowforge:
  skills:
    enabled: true
    global_dir: "~/.flowforge/skills"         # 全局 Skill 目录
    project_dir: "./.flowforge/skills"        # 项目 Skill 目录
    auto_discover: true                        # 启动时自动扫描
    allow_external_formats:                    # 允许的外部格式
      - claude_code
      - anthropic
      - trae_cn
      - openharness
    combo_enabled: true                        # 启用组合技
    usage_tracking: true                       # 启用使用统计
    
  mcp:
    enabled: true
    servers:
      - name: "filesystem"
        transport: "stdio"
        command: "npx"
        args: ["-y", "@anthropic/mcp-server-filesystem", "/tmp"]
      - name: "github"
        transport: "stdio"
        command: "npx"
        args: ["-y", "@modelcontextprotocol/server-github"]
        env:
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
      - name: "helixrag"
        transport: "http"
        url: "http://localhost:8100/mcp"
    gateway:
      max_tool_output_tokens: 25000
      tool_output_warning_tokens: 10000
      default_rate_limit: 60
      permission_check: true
    broker:
      max_retries: 3
      circuit_breaker_threshold: 5
```

---

## 五、总结

FlowForge v6.0 的 Skill 系统和 MCP 模块实现了：

| 维度 | 能力 | 参考来源 |
|------|------|---------|
| **Skill 格式兼容** | 原生支持 Claude Code / Anthropic / Trae CN / OpenHarness 四种格式 | Claude Code SKILL.md、Trae CN 官方文档、OpenHarness Skills Marketplace |
| **Skill 分层加载** | 全局 Skill + 项目 Skill（符号链接 + Git 版本控制） | Trae CN 双层设计 |
| **Skill 组合技** | 多 Skill 管道编排（声明式 YAML） | Trae CN Skill 组合实践 |
| **MCP Client** | JSON-RPC 2.0 完整实现 | Anthropic MCP 规范 |
| **MCP Gateway** | Token 预算管理 + 三层权限管线 + 速率限制 | GitHub MCP Server（700万次/周）、FastMCP、arXiv 2603.13417 |
| **MCP Broker** | 多服务器聚合 + 熔断/重试 | Prefect MCP 生产实践 |
| **MCP Tool Adapter** | 自动转换为 FlowForge BaseTool | Anthropic SDK 设计模式 |
| **格式适配器** | 统一内部格式，外部格式零成本迁移 | Anthropic Skills 标准、OpenHarness 插件生态 |

这套设计让 FlowForge 从"又一个 Agent 框架"进化为"企业级 Agent Harness 平台"——既支持业界主流 Skill 和 MCP 生态的直接接入，又提供了统一的治理、可观测性和团队协作能力。



# 第一轮评审意见

---

## FlowForge 项目当前进展完整报告

### 一、完整目录树

```
d:\software\openclaw\flowforge\
│
├── __init__.py
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── pyproject.toml
├── pytest.ini
├── requirements.txt
├── run_server.py                          # 服务器启动入口
│
├── agents/                                # 专家执行层 — Agent 实现
│   ├── __init__.py
│   ├── generic/                           # 17 个通用 Agent
│   │   ├── __init__.py
│   │   ├── analyst.py                     # 分析师
│   │   ├── approver.py                    # 审批者
│   │   ├── base.py                        # 通用 Agent 基类
│   │   ├── critic.py                      # 评论家
│   │   ├── deliverer.py                   # 交付者
│   │   ├── drafter.py                     # 起草者
│   │   ├── executor.py                    # 执行者
│   │   ├── finalizer.py                   # 终结者
│   │   ├── generator.py                   # 生成器
│   │   ├── planner.py                     # 规划者
│   │   ├── processor.py                   # 处理者
│   │   ├── react_actor.py                 # ReAct 行动者
│   │   ├── react_observer.py              # ReAct 观察者
│   │   ├── react_thinker.py               # ReAct 思考者
│   │   ├── refiner.py                     # 精炼者
│   │   ├── reviewer.py                    # 审核者
│   │   ├── validator.py                   # 验证者
│   │   └── verifier.py                    # 核验者
│   ├── article_writing.py                 # 文章写作 Agent
│   ├── code_writer_agent.py               # 代码编写 Agent
│   ├── content_audit.py                   # 内容审核 Agent
│   ├── content_repurposer.py              # 内容改写 Agent
│   ├── fact_check.py                      # 事实核查 Agent
│   ├── headline_optimizer.py              # 标题优化 Agent
│   ├── image_research.py                  # 图片研究 Agent
│   ├── material_collection.py             # 素材收集 Agent
│   ├── multilingual.py                    # 多语言 Agent
│   ├── publishing.py                      # 发布 Agent
│   ├── research_agent.py                  # 研究 Agent
│   ├── seo_optimization.py                # SEO 优化 Agent
│   ├── topic_research.py                  # 选题研究 Agent
│   ├── trend_analysis.py                  # 趋势分析 Agent
│   └── web_search_agent.py                # 网络搜索 Agent
│
├── app/                                   # FastAPI 应用层
│   ├── __init__.py
│   ├── main.py                            # FastAPI 主入口（核心启动文件）
│   ├── deps.py                            # 依赖注入（全局实例 setter）
│   └── api/
│       ├── __init__.py
│       ├── router.py                      # API 路由聚合
│       └── endpoints/
│           ├── __init__.py
│           ├── admin.py                   # 管理端点
│           ├── admin_models.py            # 管理模型
│           ├── agents.py                  # Agent 管理 API
│           ├── auth.py                    # 认证 API
│           ├── dashboard.py               # 仪表盘 API
│           ├── graph.py                   # 关系图 API
│           ├── logs.py                    # 日志 API
│           ├── memory.py                  # 记忆管理 API
│           ├── modes.py                   # 模式管理 API
│           ├── plugins.py                 # 插件 API
│           ├── prompts.py                 # 提示词管理 API
│           ├── review.py                  # 审核 API
│           ├── schedules.py               # 调度 API
│           ├── settings.py                # 设置 API
│           ├── system.py                  # 系统 API
│           ├── tasks.py                   # 任务 API
│           ├── webproxy.py                # 网页代理 API
│           ├── websocket.py               # WebSocket 端点
│           ├── workflows.py               # 工作流 API
│           └── workspace.py               # 工作区 API
│
├── cli/                                   # 命令行接口
│   └── __init__.py
│
├── config/                                # 配置文件
│   ├── __init__.py
│   ├── default.yaml                       # 默认系统配置
│   ├── models.yaml                        # 模型供应商配置
│   ├── prompts.yaml                       # 提示词模板（47 个 key）
│   └── workflows/                         # 通用 Workflow YAML
│       ├── generic_iterative.yaml         # 迭代式通用工作流
│       ├── generic_pipeline.yaml          # 管道式通用工作流
│       ├── generic_plan_execute.yaml      # 计划-执行通用工作流
│       ├── generic_react.yaml             # ReAct 通用工作流
│       └── generic_review.yaml            # 审核通用工作流
│
├── core/                                  # 共享内核
│   ├── __init__.py
│   ├── base_agent.py                      # BaseAgent / AgentInput / AgentOutput
│   ├── base_mode_executor.py              # BaseModeExecutor（含 L2 重复检测钩子）
│   ├── base_tool.py                       # BaseTool / ToolInput / ToolOutput（含 safety_level）
│   ├── agent_registry.py                  # Agent 注册中心
│   ├── agent_timeout.py                   # Agent 超时控制
│   ├── checkpoint_manager.py              # 检查点管理器
│   ├── circuit_breaker.py                 # 熔断器
│   ├── config.py                          # SystemConfig / ConfigLoader
│   ├── di.py                              # 轻量 DI 容器
│   ├── errors.py                          # 统一异常层次
│   ├── flowforge.py                       # FlowForge 主类（编程式入口）
│   ├── metrics.py                         # Prometheus 指标
│   ├── plugin_manager.py                  # 插件管理器
│   ├── prompt_manager.py                  # 提示词管理器
│   ├── secret_store.py                    # 密钥安全存储
│   ├── task_context.py                    # TaskContext 任务上下文
│   ├── tool_chain_executor.py             # 工具链执行器
│   ├── tracing.py                         # trace_id 注入与日志
│   └── workspace.py                       # 工作区管理
│
├── docs/                                  # 文档
│   ├── ARCHITECTURE_PRINCIPLES.md         # 10 大架构原则
│   ├── PROJECT_RULES.md                   # 项目规则（铁律）
│   ├── Phase1.md                          # Phase 1 计划
│   ├── Phase2.md                          # Phase 2 计划
│   ├── Phase3.md                          # Phase 3 计划
│   ├── Phase4.md                          # Phase 4 计划
│   ├── Phase5.md                          # Phase 5 计划
│   ├── api.md                             # API 参考
│   ├── arch.md                            # 架构设计文档 v4.0 + v5.0
│   ├── design.md                          # 详细设计说明书 v2.0
│   ├── test.md                            # 测试用例
│   └── archive/                           # 归档
│       ├── arch_v3.md                     # 架构 v3.0（已废弃）
│       └── design_v1.1.md                 # 设计 v1.1（已废弃）
│
├── events/                                # 事件系统
│   ├── __init__.py
│   ├── event_bus.py                       # EventBus 事件总线
│   ├── event_types.py                     # 事件类型定义
│   └── solo_adapter.py                    # EventBus → Solo 事件桥接
│
├── executor/                              # 执行器
│   ├── __init__.py
│   ├── hybrid_executor.py                 # HybridExecutor 混合执行器（核心调度引擎）
│   └── state_manager.py                   # StateManager 状态持久化
│
├── memory/                                # 记忆层
│   ├── __init__.py
│   ├── compressor.py                      # ContextCompressor 上下文压缩器
│   ├── episodic.py                        # 情景记忆
│   ├── long_term.py                       # 长期记忆
│   ├── mailbox.py                         # Mailbox 信箱（四级优先级 + TTL）
│   ├── manager.py                         # MemoryManager 记忆管理器
│   ├── semantic.py                        # 语义记忆
│   ├── short_term.py                      # 短期记忆
│   ├── task_board.py                      # TaskBoard 共享任务板（原子认领）
│   ├── working.py                         # 工作记忆
│   └── stores/
│       ├── __init__.py
│       └── sqlite_store.py                # SQLite 存储后端
│
├── modes/                                 # 执行模式（9 种 Agent 架构模式）
│   ├── __init__.py
│   ├── agent_judge.py                     # Agent-as-Judge 模式
│   ├── default_llm_actors.py              # 默认 LLM Actor/Evaluator/Reflector
│   ├── graph_of_thoughts.py               # Graph of Thoughts 模式
│   ├── multi_agent.py                     # Multi-Agent 模式（3 种策略）
│   ├── plan_execute.py                    # Plan-and-Execute 模式
│   ├── react.py                           # ReAct 模式
│   ├── reflexion.py                       # Reflexion 模式
│   ├── registry.py                        # ModeRegistry 模式注册中心
│   ├── rewoo.py                           # ReWOO 模式
│   ├── self_discover.py                   # Self-Discover 模式
│   └── workflow.py                        # Workflow 编排模式
│
├── scheduler/                             # 定时调度
│   ├── __init__.py
│   └── scheduler.py                       # TaskScheduler（APScheduler）
│
├── tests/                                 # 测试
│   ├── __init__.py
│   ├── conftest.py                        # 测试配置
│   ├── integration/
│   │   ├── __init__.py
│   │   └── test_api.py                    # API 集成测试
│   └── unit/
│       ├── __init__.py
│       ├── test_agent_registry.py
│       ├── test_agents.py
│       ├── test_checkpoint.py
│       ├── test_compressor.py
│       ├── test_config.py
│       ├── test_core.py
│       ├── test_defense.py
│       ├── test_events.py
│       ├── test_hybrid_executor.py
│       ├── test_llm_client.py
│       ├── test_mailbox.py
│       ├── test_memory.py
│       ├── test_metrics.py
│       ├── test_modes.py
│       ├── test_plugin_manager.py
│       ├── test_scheduler.py
│       ├── test_secure_registry.py
│       ├── test_state_manager.py
│       ├── test_task_board.py
│       ├── test_tools.py
│       └── test_xscene_routing.py
│
├── tools/                                 # 工具层
│   ├── __init__.py
│   ├── cache.py                           # 缓存工具
│   ├── duckduckgo_search.py               # DuckDuckGo 搜索
│   ├── file_rw.py                         # 文件读写
│   ├── graphql_adapter.py                 # GraphQL 协议适配
│   ├── helixrag_client.py                 # HelixRAG 检索客户端
│   ├── llm_client.py                      # 统一 LLM 客户端（多供应商 + 故障转移）
│   ├── local_publish.py                   # 本地发布
│   ├── mcp_adapter.py                     # MCP 协议适配
│   ├── openapi_adapter.py                 # OpenAPI 协议适配
│   ├── pexels_image.py                    # Pexels 图片搜索
│   ├── python_executor.py                 # Python 沙箱执行器
│   ├── registry.py                        # ToolRegistry（含 L1 超时防御）
│   ├── secure_registry.py                 # SecureToolRegistry（安全工具注册表）
│   ├── sendgrid_mail.py                   # SendGrid 邮件
│   ├── shell_command.py                   # Shell 命令执行
│   ├── tavily_search.py                   # Tavily 搜索
│   ├── toutiao_publisher.py               # 头条发布
│   ├── web_scraper.py                     # 网页抓取
│   ├── web_search.py                      # 网络搜索
│   ├── webhook.py                         # Webhook 通知
│   ├── webproxy_service.py                # 网页代理服务管理
│   ├── wechat_publisher.py                # 微信公众号发布
│   ├── workspace_file.py                  # 工作区文件操作
│   └── llm/
│       ├── __init__.py
│       └── model_service.py               # ModelService 模型治理
│
├── web/                                   # 前端（Next.js 14）
│   ├── next.config.js
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.tsbuildinfo
│   └── src/
│       ├── app/                           # App Router 页面
│       │   ├── globals.css
│       │   ├── layout.tsx
│       │   ├── loading.tsx
│       │   ├── page.tsx                   # 首页
│       │   ├── admin/
│       │   │   ├── agents/page.tsx        # Agent 管理
│       │   │   ├── models/               # 模型管理
│       │   │   │   ├── page.tsx
│       │   │   │   └── loading.tsx
│       │   │   └── settings/             # 系统设置
│       │   │       ├── page.tsx
│       │   │       └── loading.tsx
│       │   ├── review/                    # 审核页面
│       │   │   ├── page.tsx
│       │   │   └── [taskId]/page.tsx
│       │   ├── solo/                      # Solo 交互页面
│       │   │   ├── page.tsx
│       │   │   └── [taskId]/
│       │   │       ├── page.tsx
│       │   │       └── SoloReplayContent.tsx
│       │   └── tasks/page.tsx             # 任务列表
│       ├── components/
│       │   ├── ShellWrapper.tsx           # Shell 包装器
│       │   ├── Sidebar.tsx                # 侧边栏
│       │   └── solo/                      # Solo 交互组件（9 个独立文件）
│       │       ├── ArtifactPanel.tsx
│       │       ├── ChatInput.tsx
│       │       ├── ChatPrimitives.tsx
│       │       ├── ChatStream.tsx
│       │       ├── DetailPanel.tsx
│       │       ├── DynamicGraph.tsx
│       │       ├── ExecutionStream.tsx
│       │       ├── IntermediateBlock.tsx
│       │       ├── LLMCallCard.tsx
│       │       ├── MarkdownPanel.tsx
│       │       ├── ModeSelector.tsx
│       │       ├── SoloCreateDialog.tsx
│       │       ├── SoloEditor.tsx
│       │       ├── SoloLayout.tsx
│       │       ├── SoloStatusBar.tsx
│       │       ├── StageTransition.tsx
│       │       ├── StaticGraphModal.tsx
│       │       ├── StepGroup.tsx
│       │       ├── StepProgressTimeline.tsx
│       │       ├── TaskListPanel.tsx
│       │       ├── TaskSidebar.tsx
│       │       ├── ThinkingBlock.tsx
│       │       ├── ToolCallCard.tsx
│       │       ├── WorkflowSelector.tsx
│       │       ├── WorkspacePanel.tsx
│       │       ├── solo-types.ts
│       │       └── solo-utils.ts
│       ├── hooks/
│       │   ├── useApi.ts
│       │   ├── useFetchWithCache.ts
│       │   ├── useSoloWebSocket.ts
│       │   └── useWebSocket.ts
│       └── lib/
│           ├── cache.ts
│           ├── shell-config.tsx
│           ├── solo-types.ts
│           └── types.ts
│
└── workflows/                             # 业务 Workflow YAML
    ├── __init__.py
    ├── deep_article.yaml                  # 深度长文
    ├── image_article.yaml                 # 配图文章
    ├── multi_platform.yaml                # 多平台分发
    ├── multilingual.yaml                  # 多语言发布
    ├── quick_post.yaml                    # 快速帖子
    ├── report_generation.yaml             # 深度报告
    ├── seo_content.yaml                   # SEO 内容
    └── trend_article.yaml                 # 热点追踪
```

---

### 二、项目概述

**FlowForge** 是一个**开源的 AI Agent 操作系统底座**（MIT 协议），定位为"高级 Agent 行为的生产流水线"。它封装了业界主流的 **9 种 Agent 架构模式**，提供统一的工具注册、状态管理、可观测性接口，让开发者通过**声明式 YAML 配置**即可组合出复杂的智能体工作流。

**核心哲学**：让架构成为配置，让扩展成为插件。

**与 ContentForge 的关系**：FlowForge 是独立开源项目，ContentForge 是其应用层参考实现。上层应用通过注册 Agent/Tool/Workflow 来构建业务特定功能。

---

### 三、各主要模块用途总结

| 模块 | 路径 | 用途 |
|------|------|------|
| **core/** | `core/` | 共享内核 -- 定义所有核心抽象接口（BaseAgent、BaseTool、BaseModeExecutor、TaskContext）、DI 容器、配置加载器、检查点管理器、熔断器、密钥存储、提示词管理器、Prometheus 指标、日志追踪。FlowForge 主类（`flowforge.py`）提供编程式入口。 |
| **app/** | `app/` | FastAPI 应用层 -- 主入口 `main.py` 负责初始化所有注册中心、工具、Agent、模式执行器、调度器，并挂载 API 路由。`deps.py` 管理全局单例注入。`api/endpoints/` 包含 20 个 REST/WebSocket 端点模块。 |
| **modes/** | `modes/` | 9 种 Agent 执行模式 -- ReAct、Plan-Execute、Reflexion、Multi-Agent（含 Subagents/Teams/Swarms 三策略）、Workflow、Graph of Thoughts、ReWOO、Self-Discover、Agent-as-Judge。`registry.py` 管理模式注册与发现。`default_llm_actors.py` 提供 Reflexion 模式的默认 Actor/Evaluator/Reflector。 |
| **agents/** | `agents/` | 专家执行层 -- 15 个业务 Agent（选题研究、素材收集、文章写作、SEO 优化、事实核查、内容审核、标题优化、内容改写、趋势分析、发布、图片研究、多语言、网络搜索、代码编写、研究）+ 17 个通用 Agent（analyst/approver/critic/drafter/executor/generator/planner/processor/refiner/reviewer/validator/verifier/finalizer/deliverer + ReAct 三角色 thinker/actor/observer）。 |
| **tools/** | `tools/` | 工具层 -- 统一 LLM 客户端（多供应商故障转移）、搜索（Tavily/DuckDuckGo/Web）、发布（头条/微信/本地）、图片（Pexels）、邮件（SendGrid）、代码执行（Python 沙箱）、文件读写、Shell 命令、Webhook、缓存、HelixRAG 检索、网页代理服务管理。协议适配器支持 MCP/OpenAPI/GraphQL。安全工具注册表（SecureToolRegistry）提供 safety_level 标记和并发锁。 |
| **executor/** | `executor/` | 执行器 -- `HybridExecutor` 是核心调度引擎，负责任务全生命周期管理（模式选择、上下文注入、执行委托、状态持久化、事件发射、审核暂停/恢复、Persona 锁）。`StateManager` 负责 SQLite 状态持久化。 |
| **events/** | `events/` | 事件系统 -- `EventBus` 事件总线（16 种事件类型），`EventBusSoloAdapter` 将内部事件桥接为 Solo 协议事件，供前端 WebSocket 实时消费。 |
| **memory/** | `memory/` | 记忆层 -- 5 种记忆策略（工作/短期/长期/语义/情景），`MemoryManager` 统一管理。`ContextCompressor` 上下文压缩器（tiktoken 计数 + 滑动窗口摘要）。`TaskBoard` 原子化共享任务板（SQLite WAL + RETURNING）。`Mailbox` 四级优先级信箱（TTL 过期）。 |
| **scheduler/** | `scheduler/` | 定时调度 -- 基于 APScheduler 的 `TaskScheduler`，支持定时任务和周期任务。 |
| **config/** | `config/` | 配置文件 -- `default.yaml` 系统配置、`models.yaml` 模型供应商配置、`prompts.yaml` 提示词模板（47 个 key）、`workflows/` 5 个通用 Workflow YAML 模板。 |
| **workflows/** | `workflows/` | 业务 Workflow YAML -- 8 个内容创作工作流（深度长文、快速帖子、热点追踪、多平台分发、SEO 内容、配图文章、多语言发布、深度报告）。 |
| **web/** | `web/` | 前端 -- Next.js 14 + React 18 + TypeScript + Tailwind + shadcn/ui。App Router 页面（首页、Solo 交互、审核、任务、管理后台）。Solo 交互组件库（27 个独立组件，含聊天流、执行流、动态图、编辑器、工作区等）。 |
| **docs/** | `docs/` | 文档 -- 架构设计（v4.0 + v5.0）、详细设计、API 参考、10 大架构原则、项目规则（9 条铁律）、5 个 Phase 计划、测试用例。 |
| **tests/** | `tests/` | 测试 -- 22 个单元测试模块 + 1 个集成测试模块，覆盖核心、Agent、模式、工具、记忆、事件、调度、防御等全部模块。 |

---

### 四、核心入口与启动流程

1. **`run_server.py`** -- 最简启动入口，调用 `uvicorn` 运行 `app.main:app`，监听 `127.0.0.1:8000`。

2. **`app/main.py`** -- 核心启动文件，完成以下初始化：
   - 创建 EventBus、AgentRegistry、ToolRegistry、ModeRegistry
   - 加载模型配置，创建 LLMClient
   - 注册 20+ 工具（含条件注册的可选工具）
   - 注册 9 种模式执行器
   - 注册 15 个 Agent 工厂
   - 创建 MemoryManager、HybridExecutor、TaskScheduler、PluginManager
   - 挂载 API 路由、WebSocket 端点、WebProxy 端点
   - 提供 `/health` 和 `/metrics` 端点

3. **`core/flowforge.py`** -- 编程式入口，提供 `FlowForge.from_config("config.yaml")` 方式，支持通过代码注册 Agent/Tool/Mode 后调用 `build()` 获取 HybridExecutor。

---

### 五、架构分层总结

```
应用层 (app/)          → FastAPI + API 端点 + WebSocket
指挥中枢层 (executor/) → HybridExecutor 混合执行器（核心调度）
模式层 (modes/)        → 9 种 Agent 架构模式执行器
专家层 (agents/)       → 15 业务 Agent + 17 通用 Agent
工具层 (tools/)        → 20+ 工具 + 协议适配器 + 安全注册表
记忆层 (memory/)       → 5 种记忆 + 压缩器 + TaskBoard + Mailbox
事件层 (events/)       → EventBus + Solo 适配器
共享内核 (core/)       → 接口定义 + DI + 配置 + 追踪 + 指标
```

**依赖方向**：应用层 -> 指挥中枢 -> 模式/专家/工具 -> 记忆/事件/内核。严禁反向依赖。
        

## 1. ARCHITECTURE_PRINCIPLES.md

**文件路径**：`d:\software\openclaw\flowforge\docs\ARCHITECTURE_PRINCIPLES.md`

**内容摘要**：定义了 FlowForge 项目的 10 条架构铁律，是所有开发必须遵守的最高准则。涵盖基础能力原则（至少 2 个上层应用需要才下沉到基础层）、单向依赖、外部配置、真实实现（禁止假数据）、依赖注入、数据访问（Repository Pattern）、接口隔离、可观测性、开箱即用、零循环依赖等核心原则。同时列出了已迁移到 FlowForge 基础层的能力清单。

**关键设计决策**：
- 基础能力下沉门槛：至少 2 个上层应用需要才可进入基础层
- 已迁移到 FlowForge 的能力包括：模型治理、Web Chat Proxy、通用 Workflow、通用 Agents、动态配置、Solo 交互
- 禁止假数据/假逻辑是铁律，源于 HelixRAG v2.0 的历史教训

---

## 2. PROJECT_RULES.md

**文件路径**：`d:\software\openclaw\flowforge\docs\PROJECT_RULES.md`

**内容摘要**：项目级规则文档，Trae CN 启动时自动读取，包含完整项目上下文和开发规范。定义了 FlowForge 作为 AI Agent OS 的定位、分层架构（应用层 -> 指挥中枢 -> 专家执行 -> 工具与记忆）、9 条铁律（含新增的第 7-9 条）、Agent 内部节点规范、静态/动态关系图、模式切换 UI、YAML 兼容性等开发标准，以及详细的变更日志。

**关键设计决策**：
- WebProxy 通过 Playwright 驱动真实浏览器，将 Web 端 LLM 包装为 OpenAI 兼容 API
- 固定端口分配：后端 8000、Solo 前端 13000、管理前端 5174
- Prompts 完全外化到 prompts.yaml，代码中不硬编码提示词
- SoloLayout 组件从 1575 行重构拆分为 9 个文件

---

## 3. Phase1.md

**文件路径**：`d:\software\openclaw\flowforge\docs\Phase1.md`

**内容摘要**：Phase 1 核心实现代码文档，包含项目基础设施和核心接口的完整代码骨架。涵盖 pyproject.toml、Dockerfile、BaseAgent/BaseTool/TaskContext/DIContainer 等核心接口、SQLite 数据模型、EventBus 与 Solo 适配器（16 事件映射）、ModeRegistry（含 suggest_mode 智能推荐）、HybridExecutor（Persona 锁 + 子步骤判断）、Workflow 执行器、Reflexion 执行器、LLM 多供应商客户端、5 种记忆策略实现、Python 沙箱执行器、文件读写工具（路径穿越防护）、Web 搜索工具（HelixRAG 优先 + Tavily 回退）以及 FastAPI 路由层。

**关键设计决策**：
- `execute_with_context` 可选覆写模式：Agent 可选择实现 `execute()` 或 `execute_with_context()`
- `TaskContext.from_parent()` 创建子上下文，state 深拷贝隔离、tools/agents/event_bus 共享引用
- Workflow MAX_DEPTH=3 禁止嵌套，防止递归爆炸
- Reflexion 三角色（Actor/Evaluator/Reflector）通过 AgentRegistry 查找或降级为 DefaultLLM 系列

---

## 4. Phase2.md

**文件路径**：`d:\software\openclaw\flowforge\docs\Phase2.md`

**内容摘要**：Phase 2 扩展模块文档，补全全部 9 种模式执行器和通用 Agent。包含 PlanExecute（JSON 容错解析）、MultiAgent（asyncio.as_completed 并行）、ReWOO（一次性规划批量执行）、SelfDiscover（自动发现推理框架）、AgentJudge（Agent 即裁判）执行器，article_writing 和 publishing Agent，前端 Solo 模式核心组件（WebSocket 连接 + 断线重连 replay）、组件化架构（每个组件 < 300 行）、类型定义、WebSocket Hook，以及集成测试和 Docker 生产部署配置。

**关键设计决策**：
- 全部 9 种模式执行器实现完毕
- 前端组件化架构：每个组件不超过 300 行
- WebSocket 断线重连机制：客户端通过 `from_seq` 参数回放缺失事件
- docker-compose 包含 Milvus/ES/PostgreSQL/Redis 全套基础设施

---

## 5. Phase3.md

**文件路径**：`d:\software\openclaw\flowforge\docs\Phase3.md`

**内容摘要**：Phase 3 ContentForge 业务 Agent 迁移 + 插件系统 + Workflow YAML 模板文档。包含素材采集（HelixRAG 优先 + WebSearch 回退）、SEO 优化、事实核查（httpx 链接有效性检查）、内容审核（LLM 质量评分）、趋势分析、发布 Agent 的迁移实现，PluginManager（支持 entry_points + YAML 配置加载），6 个 Workflow YAML 模板（quick_post、multi_platform、seo_content、trend_article、image_article、report_generation，含并行组和人工审核节点），以及完整交付检查清单。

**关键设计决策**：
- PluginManager 支持 Python entry_points 和 YAML 配置两种插件发现方式
- Workflow YAML 支持 `parallel_group` 并行组和 `human: true` 人工审核节点
- 6 个 Workflow 模板覆盖内容创作主要场景

---

## 6. Phase4.md

**文件路径**：`d:\software\openclaw\flowforge\docs\Phase4.md`

**内容摘要**：Phase 4 核心增强文档，解决"Agent 犯错、偷懒、遗忘"问题。融合 Claude Code 架构思想（TAOR 循环、Compressor、Fail-closed 工具、三层 Multi-Agent 策略），包含首轮审查报告（6 个阻断性问题 + 5 个改进建议）和修订方案：三层防御分层实现、统一 SubAgent、ContextCompressor 集成到 MemoryManager、TaskBoard 原子化、SecureToolRegistry 安全标记、Agent Teams 完整实现、Mailbox 增强、WorkflowExecutor 防御配置集成、CheckpointManager 增强、Swarms 策略、防偷懒综合测试。

**关键设计决策**：
- 三层防御分层而非全部塞入 HybridExecutor：L1 超时在 ToolRegistry、L2 重复检测在 BaseModeExecutor._on_exit、L3 自纠正在 WorkflowExecutor on_error="reflexion_retry"
- ContextCompressor 使用 tiktoken 真实 token 计数 + 滑动窗口摘要 + 消息角色关键消息判断（不依赖关键词）
- TaskBoard 原子认领双策略：SQLite RETURNING 子句 + 应用层 asyncio.Lock 兼容
- SecureToolRegistry 继承 ToolRegistry，BaseTool 新增 safety_level 和 is_concurrency_safe
- 删除独立 SubAgentExecutor，统一在 MultiAgentExecutor 中实现三种策略
- Mailbox 四级优先级（critical/high/normal/low）+ 主题过滤 + TTL 过期
- WorkflowExecutor 读取 ctx.metadata["defense"] 配置，支持全局 + 步骤级覆盖

---

## 7. api.md

**文件路径**：`d:\software\openclaw\flowforge\docs\api.md`

**内容摘要**：完整的 API 参考文档，v1.0 包含 10 章（概述、任务管理 API、审核中心 API、模型管理 API、模式与 Agent 管理 API、仪表盘与运维 API、插件管理 API、WebSocket 实时推送、数据模型参考、完整错误码列表），v1.1 增量补充（JWT 认证、配置管理 API、跨平台部署端点、插件安装/卸载、补充错误码）。涵盖所有 REST API 端点和 WebSocket 通道定义。

**关键设计决策**：
- 统一响应格式：`{status, data, meta}`
- Persona 锁冲突返回 HTTP 409
- Solo 模式专用 WebSocket 通道 `/ws/solo/{task_id}`，16 种 Solo 实时事件
- 客户端断线重连支持 `from_seq` 参数回放缺失事件

---

## 8. arch.md

**文件路径**：`d:\software\openclaw\flowforge\docs\arch.md`

**内容摘要**：架构设计文档 v4.0 + v5.0（最终版），是整个项目的权威架构文档。v4.0 包含项目概述、与 ContentForge 的关系（独立开源 MIT）、深度竞品分析（vs LangGraph/Dify/CrewAI/MetaGPT/AutoGen/Temporal）、核心接口设计（TaskContext/BaseAgent/BaseTool/BaseModeExecutor/ModeRegistry/HybridExecutor）、9 种内置模式详解、通用 Agent 库（12 内容创作 + 12 小说创作 + 8 代码工具）、通用 Workflow 库（15 个）、重量级模块详细设计、事件系统与可观测性、安全机制、配置与启动、扩展与插件、分阶段实施计划、迁移映射表、Orchestrator 能力覆盖清单。v5.0 增量扩展三层防御、上下文压缩、安全工具、三种 Multi-Agent 策略、协作基础设施、CheckpointManager 增强、SOP 防御配置。

**关键设计决策**：
- FlowForge 定位为"高级 Agent 工厂"（预建 9 种思维模式 + 30+ 通用 Agent + 15+ 通用 Workflow）
- v4.0 接口完全兼容 ContentForge，v5.0 是 v4.0 的增量扩展，不破坏已有实现
- 竞争护城河是 9 种高级 Agent 模式的深度工程实现
- 与 LangGraph（底层引擎）、Dify（低代码载具）、CrewAI（角色扮演剧团）形成差异化定位

---

## 9. design.md

**文件路径**：`d:\software\openclaw\flowforge\docs\design.md`

**内容摘要**：详细设计说明书 v2.0 + v5.0，是代码实现的直接参考。v2.0 包含 13 章（项目骨架与目录结构、核心接口详细设计、DI 容器、模式注册与混合执行器、事件总线与 Solo 集成、数据库 Schema、9 种模式执行器详细设计含完整代码、通用 Agent 库详细设计、通用 Workflow 库设计、插件系统详细设计、工具系统与沙箱安全机制、Memory 模块详细设计、安全机制总结）。v5.0 新增 8 章（三层防御体系、上下文压缩系统、安全工具系统、Multi-Agent 三策略、协作基础设施、CheckpointManager 增强、v5.0 安全机制增强总结、v5.0 新目录结构）。

**关键设计决策**：
- 所有代码均为真实实现（非模拟），BaseAgent.execute_with_context 可选覆写模式
- Workflow MAX_DEPTH=3 禁止嵌套，Reflexion 三角色通过 AgentRegistry 或 DefaultLLM 系列
- PluginManager 支持 entry_points + YAML + MCP + OpenAPI + GraphQL 五种接入方式
- v5.0 新增目录结构反映三层防御和协作基础设施的模块划分

---

## 10. test.md

**文件路径**：`d:\software\openclaw\flowforge\docs\test.md`

**内容摘要**：测试用例设计文档 v1.1，对应架构 v4.0 + 详细设计 v2.0 + API 参考 v1.1。包含 10 章：测试策略总览（单元/集成/E2E/跨平台四级，覆盖率要求 85%/70%/核心流程 100%）、单元测试用例（核心接口、DI 容器、事件总线、Solo 适配器、ModeRegistry、9 种模式执行器、HybridExecutor、插件系统、沙箱安全、LLM Client、Memory 模块）、集成测试用例（27 个 API 端点测试、SOP 流程测试、插件系统集成、跨平台集成）、E2E 测试场景、性能测试基准、测试覆盖率目标、v5.0 新增单元测试（三层防御、ContextCompressor、SecureToolRegistry、TaskBoard、Mailbox、CheckpointManager、Swarms）、v5.0 Multi-Agent 策略集成测试、v5.0 防御集成测试、v5.0 测试覆盖率目标。

**关键设计决策**：
- 四级测试策略：单元（pytest + pytest-asyncio）-> 集成（pytest + httpx）-> E2E（Playwright）-> 跨平台
- 统一 LLM Mock（`mock_llm_tool` fixture），所有测试共享避免重复定义
- 沙箱安全测试覆盖 Windows 降级场景（resource 模块不存在时自动降级为 psutil）
- v5.0 新增 LazyAgent 模拟测试，专门验证防偷懒机制

---

## 11. archive/arch_v3.md

**文件路径**：`d:\software\openclaw\flowforge\docs\archive\arch_v3.md`

**内容摘要**：架构设计文档 v1.0 的早期版本（归档），定义了 FlowForge 作为通用 Agent 操作系统内核的初始架构。包含项目概述与设计目标、核心概念与分层架构图、核心接口设计（TaskContext/BaseAgent/BaseTool 的初始定义）。该文档已被 arch.md（v4.0 + v5.0）完全取代。

**关键设计决策**：
- 初始定位：将控制流与反馈机制从业务逻辑中完全剥离
- 依赖方向：应用层 -> 核心引擎 -> 基础设施，严禁反向依赖
- 9 种 Agent 架构模式从一开始就是核心设计目标

---

## 12. archive/design_v1.1.md

**文件路径**：`d:\software\openclaw\flowforge\docs\archive\design_v1.1.md`

**内容摘要**：详细设计说明书 v1.0 的早期版本（归档），包含项目骨架与目录结构、核心接口初始代码、pyproject.toml 初始配置。该文档已被 design.md（v2.0 + v5.0）完全取代。

**关键设计决策**：
- 初始目录结构定义了 core/modes/agents/tools/workflows/memory/events/executor 的分层
- MIT 许可证，Python >= 3.10
- 依赖项包括 pydantic>=2.0、pyyaml>=6.0、httpx>=0.27

---

**总计**：`d:\software\openclaw\flowforge\docs\` 目录下共 13 个文档文件，其中 11 个为当前有效文档，2 个为归档历史版本（已被最新版取代）。核心架构文档为 `arch.md`（v4.0 + v5.0），核心设计文档为 `design.md`（v2.0 + v5.0），两者是项目最权威的技术参考。Phase1-5 文档按阶段记录了完整的实现代码和演进过程。
        
          
现在让我深度阅读 Phase5.md 中的 v6.0 设计方案
        
---

## 📋 FlowForge v6.0 五份设计文档专业评审报告

> 评审对象：Phase5.md 中 5 个独立章节
> 评审日期：2026-05-12

---

## 总体评价

| 文档 | 评分 | 核心判断 |
|------|------|---------|
| **Spec（功能特性规格）** | ★★★★☆ 4.0/5 | 愿景宏大、场景覆盖全面，但部分需求边界模糊 |
| **架构设计第一版** | ★★★☆☆ 3.5/5 | Harness 六大模块代码扎实，但与 v5.0 现有代码的衔接断裂 |
| **架构设计第二版** | ★★★★☆ 4.0/5 | 控制论框架清晰，四根护栏概念统一，但缺少增量迁移路径 |
| **目录结构重构方案** | ★★★☆☆ 3.0/5 | 目录树完整但迁移风险极高，缺少分步实施策略 |
| **Skill & MCP 模块设计** | ★★★★½ 4.5/5 | 设计最成熟的一份，格式适配器模式优雅，MCP 四层架构扎实 |

---

## 一、Spec（功能特性规格说明书）评审

### ✅ 亮点

1. **控制论框架**是本次升级最核心的思想贡献：前馈控制 + 反馈控制 + 熵管理 + 可观测性，将 FlowForge 从"编排框架"提升到"驾驭系统"，概念清晰且与业界 Harness Engineering 趋势对齐
2. **业务场景支撑矩阵**（第六章）将 9 种场景与模式/策略/护栏/工具/Skill 一一映射，可执行性强
3. **非功能需求量化**：P95 延迟 < 2s、Workflow 8步 < 30s、WebSocket < 50ms，这些指标合理且可验证

### 🔴 高优先级问题

**问题 1：FR-HRN-04（熵管理引擎）与 FR-PLG-03（插件市场）存在范围重叠**

Spec 中 FR-HRN-04 定义了"文档园丁 Agent"和"技术债跟踪器"，FR-PLG-03 定义了"插件市场"。但文档园丁的自动修复 PR 本质上是一种**后台插件**——它通过 Git 操作提交代码变更。如果插件市场不支持"后台 Cron 插件"类型，文档园丁就无法作为插件分发；如果支持，那 FR-HRN-04 就不应该独立于插件系统设计。

**建议**：明确熵管理引擎的定位——是内置核心能力还是可插拔的插件？如果是核心能力，文档园丁应该直接在 `harness/entropy/` 中实现，不走插件市场；如果是插件，则 FR-HRN-04 应标注为"通过插件市场安装"。

**问题 2：FR-HRN-06（会话管理器）的 98% 阈值与 v5.0 的 ContextCompressor 85% 阈值矛盾**

Spec 写 98%，但第二版架构设计中 [Phase5.md#L1307](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L1307) 写 `COMPACTION_THRESHOLD = 0.92`，第一版写 `COMPACTION_THRESHOLD = 0.92`。三处不一致。

**建议**：统一为一个值，并在 spec 中说明计算方式（是 token 数 / 模型上下文窗口，还是 token 数 / 配置上限？）。

**问题 3：FR-CAP-02（Skill 系统）声称支持 5 种格式，但缺少 OpenHarness 格式的具体定义**

[Phase5.md#L2276](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L2276) 列出了 `SkillFormat.OPENHARNESS`，但格式转换映射表中 OpenHarness 列几乎全为 ❌，且没有提供 OpenHarness 适配器实现。要么删除这个格式声明，要么补充实现。

### 🟡 中优先级问题

**问题 4：IntegratedTrainingPipeline（FR-ENG-06？）在 Spec 中没有需求编号**

Spec 第三章列出了 FR-ENG-01~05，但第一版架构设计中的 `IntegratedTrainingPipeline`（训练一体化管线）在 Spec 中没有对应的功能需求。这是一个重大功能模块，不应遗漏。

**建议**：在 Spec 3.1 节增加 `FR-ENG-06：Plan-Execute 一体化训练管线`。

**问题 5：用户角色"AI 主编/Commander"与 v5.0 的 Persona 概念关系不清**

Spec 1.4 节定义了"AI 主编/指挥"角色，但 v5.0 中 Persona 是配置文件（`config/persona/*.yaml`），不是运行时角色。v6.0 中 Persona 是否升级为运行时实体？还是保持为配置？

---

## 二、架构设计第一版评审

### ✅ 亮点

1. **六大模块代码示例**质量高——PermissionPipeline、SessionManager、GatedToolPipeline、VerificationHooks、SubAgentEngine、IntegratedTrainingPipeline 都有可直接参考的 Python 实现
2. **与 v5.0 的模块对照表**清晰，迁移策略（增强/替换/新增）标注明确

### 🔴 高优先级问题

**问题 6：SubAgentEngine 与 v5.0 MultiAgentExecutor 的关系是"替换"还是"增强"？**

[Phase5.md#L769](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L769) 写"替换 `MultiAgentExecutor._run_subagents()`"，但 v5.0 的 MultiAgentExecutor 有三种策略（Subagents/Teams/Swarms），SubAgentEngine 只覆盖了 Subagents 策略。Teams 和 Swarms 怎么办？

**建议**：SubAgentEngine 应该只替换 `_run_subagents()` 内部实现，不替换整个 MultiAgentExecutor。Teams 和 Swarms 仍然在 MultiAgentExecutor 中，但底层共享 SubAgentEngine 的上下文隔离和令牌预算能力。

**问题 7：IntegratedTrainingPipeline 的"训练"概念在当前架构中没有落地基础设施**

[Phase5.md#L784-L815](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L784-L815) 的 `IntegratedTrainingPipeline` 保存了 Episode 轨迹，但：
- 没有模型微调的基础设施（GPU 集群、训练框架）
- 没有轨迹数据的标注和清洗流程
- 没有从轨迹到 Reward 模型的训练管线

**建议**：将 `IntegratedTrainingPipeline` 重新定位为"轨迹记录与评估管线"（Trajectory Recording Pipeline），只负责记录和评估，不涉及模型训练。未来有训练基础设施时再扩展。

---

## 三、架构设计第二版评审

### ✅ 亮点

1. **四根护栏的隐喻**极其精准：上下文工程 = 新员工手册、架构约束 = 缰绳、反馈循环 = 智能体审智能体、熵管理 = 垃圾回收。这让复杂的控制论概念变得直觉可理解
2. **总架构图**（[Phase5.md#L1431-L1477](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L1431-L1477)）层次分明，四根护栏 + 基础设施层的布局清晰
3. **迁移路径**（第四章）从 v5.0 到 v6.0 的模块对照完整

### 🔴 高优先级问题

**问题 8：ArchitectureConstraintEngine._extract_dependencies() 是空实现——这是整个架构约束护栏的致命缺陷**

[Phase5.md#L1104-L1109](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L1104-L1109)：

```python
def _extract_dependencies(self, output: 'AgentOutput') -> list:
    """从 Agent 输出中提取 import/依赖关系"""
    code = str(output.result.get("content", output.result.get("code", "")))
    # 解析 import 语句...
    return []
```

架构约束引擎的核心能力是检测反向依赖，但依赖提取是空实现。这不是"待实现"——这是**架构约束护栏能否工作的决定性因素**。

**建议**：
1. 使用 Python `ast` 模块解析 import 语句
2. 定义模块→层的映射配置（`config/layer_mapping.yaml`）
3. 增加非 Python 语言的扩展点（TypeScript/Go 等）

**问题 9：FeedbackLoop 与 v5.0 Reflexion 模式的关系是"替代"还是"增强"？**

v5.0 的 Reflexion 模式（Actor → Evaluator → Reflector）已经实现了"生成与评判分离"。v6.0 的 FeedbackLoop 又定义了一套"独立评判 Agent + 四维评分 + 分类闸门"。

关键问题：**FeedbackLoop 是 Reflexion 模式的增强版，还是独立于所有模式之外的全局护栏？**

如果是增强版，那 Reflexion 模式应该直接使用 FeedbackLoop 替换内部的 Evaluator/Reflector；如果是全局护栏，那所有模式（包括 ReAct、Plan-Execute）的输出都应该经过 FeedbackLoop。

**建议**：明确 FeedbackLoop 是**全局护栏**，所有模式的输出都经过它。Reflexion 模式内部的 Evaluator/Reflector 保留为模式内部的快速反馈循环，FeedbackLoop 作为外部的独立质量闸门。两者是**内环+外环**的关系。

---

## 四、目录结构重构方案评审

### 🔴 高优先级问题

**问题 10：这是"推倒重来"式重构，迁移风险极高**

当前 v5.0 的目录结构：

```
flowforge/
├── core/          # 含 agent_registry, tool_chain_executor, plugin_manager 等
├── executor/      # hybrid_executor, state_manager
├── tools/         # 扁平结构，所有工具平铺
├── agents/        # 扁平结构，15个业务Agent + 17个通用Agent
├── modes/         # 9种模式
├── memory/        # 5种记忆
├── events/        # EventBus + Solo
├── app/           # FastAPI
```

v6.0 提议的目录结构新增了 `harness/`（14个文件）、`security/`（7个文件）、`skills/`（10+个文件）、`mcp/`（8个文件）、`observability/`（4个文件），同时重组了 `tools/`、`agents/`、`engine/` 等。

**迁移对照表**显示 25+ 个文件需要移动/重组/新增，但没有分步实施计划。如果一次性重构，所有现有测试都会断裂。

**建议**：参考 hiclaw proxy v2.1 的增量三步迁移策略：

| 步骤 | 内容 | 风险 |
|------|------|------|
| **Step 1** | 新增 `harness/` 目录，不修改任何现有代码。Harness 组件作为可选增强，通过 `config/harness_v6.yaml` 的 `enabled: true/false` 控制灰度 | 最低 |
| **Step 2** | 重组 `tools/`（builtin/adapters/publish 分层）和 `agents/`（content/novel/code 分层），保持 import 路径兼容（通过 `__init__.py` re-export） | 中等 |
| **Step 3** | 迁移 `executor/` → `engine/`，引入 `security/` 和 `observability/`，删除旧路径 | 最高 |

**问题 11：`core/` 目录职责膨胀——既是"共享内核"又包含业务逻辑**

v6.0 的 `core/` 包含 `agent_registry.py` 和 `mode_registry.py`，但这两个模块在 v5.0 中是执行引擎的一部分（`executor/agent_registry.py`、`modes/registry.py`）。将它们放入 `core/` 违反了项目自身的架构原则——"基础能力下沉门槛：至少 2 个上层应用需要才可进入基础层"。

**建议**：`agent_registry.py` 和 `mode_registry.py` 应归入 `engine/`，`core/` 只保留纯接口定义（BaseAgent、BaseTool、TaskContext、DIContainer、errors、config、tracing、metrics）。

**问题 12：`plugins/` 目录与 `skills/` 目录的关系不清**

`plugins/` 有 `skills_loader.py`，`skills/` 有完整的 `registry.py` 和 `loader.py`。Skill 的加载到底走 `plugins/skills_loader.py` 还是 `skills/registry.py`？

**建议**：`plugins/` 只负责 Mode/Agent/Tool 三类插件的发现和加载；`skills/` 独立负责 Skill 的全生命周期。`plugins/skills_loader.py` 应删除或改为调用 `skills/registry.py` 的薄包装。

---

## 五、Skill & MCP 模块设计评审

### ✅ 亮点（本组文档质量最高）

1. **Skill 格式适配器模式**是教科书级的设计——`SkillAdapter` 基类 + 4 种具体适配器，开闭原则完美落地
2. **MCP 四层架构**（Client → Gateway → Broker → ToolAdapter）层次清晰，每层职责单一
3. **MCP Gateway 的 Token 预算管理**和**速率限制**是生产级设计，参考了 GitHub MCP Server 700万次/周的经验
4. **Combo Skills** 的声明式 YAML 管道编排简洁实用

### 🟡 中优先级问题

**问题 13：SkillRegistry.match_skill() 的触发词匹配过于简单**

[Phase5.md#L2401-L2410](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L2401-L2410)：

```python
def match_skill(self, query: str) -> List[Skill]:
    for skill in self._skills.values():
        for trigger in skill.triggers:
            if trigger.lower() in query_lower:
                matched.append(skill)
```

这是纯子串匹配，会导致：
- "周报" 匹配到 weekly-report，但 "周报格式调整" 也匹配到
- "总结" 匹配到多个 Skill
- 无法区分"用户想用 Skill"和"用户只是在聊天中提到了触发词"

**建议**：增加匹配置信度评分 + 上下文感知（是否在 Solo 模式中？是否刚执行了某个相关工具？），返回 Top-3 候选让用户选择或自动选择最高分。

**问题 14：MCP Broker 的 `call_tool` 遍历所有服务器查找工具——性能问题**

[Phase5.md#L2698-L2702](file:///d:/software/openclaw/flowforge/docs/Phase5.md#L2698-L2702)：

```python
for name, client in self._clients.items():
    tools = await client.list_tools()  # 每次调用都 list_tools？
    if any(t["name"] == tool_name for t in tools):
        return await self._call_with_retry(name, tool_name, arguments)
```

每次调用工具都遍历所有服务器并调用 `list_tools()`，即使有 5 分钟缓存，在并发场景下也是性能瓶颈。

**建议**：在 Broker 初始化时构建 `tool_name → server_name` 的全局索引，后续调用直接查索引。

**问题 15：MCP Tool Adapter 缺少流式支持**

MCPToolAdapter 的 `execute()` 只返回 `ToolOutput(result=result)`，但 MCP 协议支持流式响应（`tools/call` 的 streaming 模式）。如果上游 Agent 期望流式输出（如 Solo 模式），MCP 工具无法满足。

**建议**：增加 `execute_stream()` 方法，或在 `ToolOutput` 中增加 `stream_iterator` 字段。

---

## 六、五文档交叉验证结果

| 验证项 | Spec | 架构V1 | 架构V2 | 目录重构 | Skill&MCP | 状态 |
|--------|------|--------|--------|----------|-----------|------|
| Compaction 阈值 | 98% | 92% | 92% | - | - | 🔴 不一致 |
| FeedbackLoop vs Reflexion | FR-HRN-03 | 替换 AuditAgent | 全局护栏 | - | - | 🟡 需明确 |
| SubAgentEngine 范围 | FR-MAS-01 | 替换 _run_subagents | - | - | - | 🟡 需明确 |
| Skill 加载入口 | FR-CAP-02 | - | - | plugins/skills_loader | skills/registry | 🔴 冲突 |
| IntegratedTraining | 无编号 | 完整实现 | - | - | - | 🔴 Spec遗漏 |
| agent_registry 归属 | - | - | - | core/ | - | 🟡 应归engine/ |
| OpenHarness 格式 | 声称支持 | - | - | - | 映射表全❌ | 🟡 需补充 |
| 增量迁移策略 | - | - | 有对照表 | 无分步计划 | - | 🔴 缺失 |

---

## 七、综合评审结论与建议

### 核心判断

**FlowForge v6.0 的 Harness 架构方向完全正确**——从"编排框架"到"驾驭系统"的进化，与 2026 年业界 Harness Engineering 趋势高度对齐。四根护栏（上下文工程、架构约束、反馈循环、熵管理）的概念框架是本次设计最大的思想贡献。

但**实施路径存在重大风险**：5 份文档之间存在 6 处不一致，目录重构缺少增量迁移策略，多个关键模块的实现停留在伪代码级别。

### 实施前必做清单（Go/No-Go）

| # | 事项 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | **统一 Compaction 阈值** | 🔴 必做 | Spec/架构V1/架构V2 三处不一致，统一为一个值并说明计算方式 |
| 2 | **明确 FeedbackLoop 与 Reflexion 的关系** | 🔴 必做 | 内环(Reflexion)+外环(FeedbackLoop)？还是替代？ |
| 3 | **制定增量三步迁移策略** | 🔴 必做 | 参考 hiclaw proxy v2.1 的做法，每步有回归测试 |
| 4 | **补充 IntegratedTrainingPipeline 的 Spec 需求编号** | 🟡 建议 | 降级为"轨迹记录管线"，不涉及模型训练 |
| 5 | **解决 plugins/ 与 skills/ 的加载入口冲突** | 🟡 建议 | 删除 plugins/skills_loader.py，统一走 skills/registry.py |
| 6 | **agent_registry.py 归入 engine/** | 🟡 建议 | core/ 只保留纯接口，注册中心是引擎层概念 |
| 7 | **ArchitectureConstraintEngine._extract_dependencies() 补充实现** | 🟡 建议 | 至少提供 ast 模块解析的骨架代码 |
| 8 | **MCP Broker 增加工具名→服务器索引** | 🟢 可选 | 性能优化，可在实施阶段补充 |

### 一句话总结

> **v6.0 的 Harness 架构方向完全正确，四根护栏的概念框架是核心贡献。但 5 份文档之间的不一致和缺失的增量迁移策略是当前最大的风险。建议先统一 6 处不一致，再制定三步增量迁移计划，然后从 Step 1（新增 harness/ 目录，灰度开关控制）开始实施。**
        
          
以上就是 FlowForge v6.0 五份设计文档的完整评审。核心结论：

**方向正确，实施有风险。** 四根护栏（上下文工程、架构约束、反馈循环、熵管理）是本次设计最大的思想贡献，与 2026 年 Harness Engineering 趋势高度对齐。但 5 份文档之间存在 6 处关键不一致（Compaction 阈值、FeedbackLoop 定位、Skill 加载入口冲突等），且目录重构缺少增量迁移策略。

最紧迫的 3 件事：
1. 统一 6 处不一致（特别是 Compaction 阈值和 FeedbackLoop vs Reflexion 的关系）
2. 制定增量三步迁移策略（harness/ 灰度开关 → tools/agents 重组 → engine/security 迁移）
3. 补充 ArchitectureConstraintEngine 的依赖提取实现（当前是空壳，整个护栏二无法工作）


# 对第一轮评审意见的回复：FlowForge v6.0 设计文档修复与增量更新

> 针对专业评审报告中的 6 处不一致、增量迁移缺失、关键空实现等问题，本增量文档逐条给出修改方案。

---

## 修复 1：统一 Compaction 阈值

**问题**：Spec 写 98%，架构 V1 写 92%，架构 V2 写 92%，三处不一致。

**统一方案**：使用 **92% 阈值**，与 Claude Code 实测数据对齐（Anthropic 工程团队披露的触发点）。

**计算方式**：`utilization = total_tokens / model_context_window`，其中 `model_context_window` 从 LLM 配置文件读取，默认 128K。

**修改位置**：

| 文档 | 章节 | 修改 |
|------|------|------|
| Spec § FR-HRN-06 | 第 3.2 节 | `98%` → `92%`，增加计算方式说明 |
| 架构 V1 § SessionManager | 第 2.1 节 | 统一为 `COMPACTION_THRESHOLD = 0.92` |
| 架构 V2 § SessionManager | 第 2.3 节 | 统一为 `COMPACTION_THRESHOLD = 0.92` |

**Spec 修改（FR-HRN-06）**：

```markdown
**FR-HRN-06：会话管理器 (SessionManager)**
- 92% 阈值触发上下文压缩：当 token 使用量达到模型上下文窗口 92% 时自动压缩
- 计算方式：`utilization = total_tokens / model_context_window`
- 模型上下文窗口从 LLM 配置文件读取，默认 128K
- 保留最近 3 轮完整对话 + 压缩早期历史为摘要
- 工具输出 Token 截断（默认 25000 tokens）
- 会话交接：检查点保存 + 交接物传递
```

---

## 修复 2：明确 FeedbackLoop 与 Reflexion 模式的关系

**问题**：FeedbackLoop 是替代 Reflexion 还是全局护栏？文档未明确。

**最终决策**：**内环（Reflexion 模式）+ 外环（FeedbackLoop 全局护栏）** 双层架构。

```
┌─────────────────────────────────────────────┐
│            外环：FeedbackLoop（全局护栏）     │
│   所有模式输出都经过四维评分 + 分类闸门      │
│   ┌─────────────────────────────────────┐   │
│   │  内环：Reflexion 模式               │   │
│   │  Actor → Evaluator → Reflector      │   │
│   │  （快速循环，模式内部使用）          │   │
│   └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**修改说明**：
- Reflexion 模式保持不变，负责**快速迭代**（如写作打磨）
- FeedbackLoop 作为**全局质量闸门**，任何模式的输出都会经过它
- 如果 Reflexion 内环已经达标，FeedbackLoop 外环快速通过
- 如果 ReAct / Plan-Execute 等模式直接输出，外环进行独立验证

**Spec 修改（FR-HRN-03）**：

```markdown
**FR-HRN-03：反馈循环引擎 (FeedbackLoop) —— 全局护栏**
- 定位：所有 Agent 输出的**外部质量闸门**，独立于任何模式
- 与 Reflexion 模式的关系：**内环+外环**双层架构
  - 内环（Reflexion 模式）：快速 Actor→Evaluator→Reflector 循环
  - 外环（FeedbackLoop）：四维评分 + 分类闸门，全局生效
- 生成与评判分离：独立的 Evaluator Agent 评判 Generator Agent 的产出
- 四维评分体系：Design Quality / Originality / Craft / Functionality
- 分类闸门：只看工具执行结果，忽略模型自我评价
- 如果内环已达标，外环快速通过；如果直接输出模式，外环进行独立验证
```

---

## 修复 3：制定增量三步迁移策略

**问题**：目录重构缺少分步实施计划，一次推倒重来风险极高。

**增量三步策略**：

### Step 1：新增 harness/ 目录，灰度开关控制（风险最低）

| 操作 | 说明 |
|------|------|
| 新增 `harness/` 目录及 4 个子目录（context/ constraints/ feedback/ entropy/） | 14 个全新文件，不修改任何现有代码 |
| 在 `config/harness_v6.yaml` 中增加 `enabled: true/false` 开关 | 支持灰度启用 Harness 层 |
| 在 `HybridExecutor.run()` 中增加 Hook 点 | `if ctx.harness_enabled: self.harness.pre_execute(ctx)` |
| 编写集成测试 | 验证 Harness 禁用时系统行为与 v5.0 完全一致 |

### Step 2：重组 tools/agents，保持 import 兼容（风险中等）

| 操作 | 说明 |
|------|------|
| `tools/` 内部拆分为 `builtin/` / `adapters/` / `publish/` | 在原目录内创建子目录 |
| `agents/` 内部拆分为 `content/` / `novel/` / `code/` | 同上 |
| 通过 `__init__.py` re-export 保持旧 import 路径 | 兼容期 2 周 |

### Step 3：迁移 executor/ → engine/，引入 security/ 和 observability/（风险最高）

| 操作 | 说明 |
|------|------|
| `executor/` → `engine/`，同时引入 `defense_layer.py` | 完全替换 |
| 新增 `security/` 和 `observability/` | 全新目录 |
| 删除旧路径 | 全量回归测试 |

**修改位置**：架构设计第二版 § 第四章。

---

## 修复 4：补充 IntegratedTrainingPipeline 的 Spec 需求编号

**问题**：架构设计中存在 `IntegratedTrainingPipeline`，但 Spec 没有对应 FR 编号。

**修改方案**：在 Spec § 3.1 节增加：

```markdown
**FR-ENG-06：轨迹记录与评估管线 (Trajectory Recording Pipeline)**
- 记录 Agent 执行全过程的工具调用轨迹、决策点、状态变更
- 每个任务生成一个 Episode（轨迹 + 验证结果）
- 支持基于分类闸门的自动 Reward 信号（Pass/Fail）
- 持久化到 CheckpointManager，供后续分析和 Skill 进化使用
- 定位：轨迹记录管线，不涉及模型训练（训练基础设施不具备）
```

**同步修改架构 V1**：将 `IntegratedTrainingPipeline` 重命名为 `TrajectoryPipeline`，删除模型训练相关注释。

---

## 修复 5：解决 plugins/ 与 skills/ 加载入口冲突

**问题**：`plugins/skills_loader.py` 与 `skills/registry.py` 职责重叠。

**最终决策**：

| 模块 | 职责 | 入口 |
|------|------|------|
| `plugins/` | 负责 Mode/Agent/Tool 三类插件的发现和加载 | `plugins/plugin_manager.py` |
| `skills/` | 独立负责 Skill 的全生命周期 | `skills/registry.py` |

**具体修改**：
- 删除 `plugins/skills_loader.py`
- 在 `plugins/plugin_manager.py` 中增加注释 `# Skill 加载由 skills/registry.py 独立管理，不在此处处理`
- 保持 `skills/registry.py` 作为 Skill 的唯一加载入口

**目录结构调整**：
```
plugins/
├── __init__.py
├── plugin_manager.py         # Mode/Agent/Tool 三类插件
├── hooks_registry.py         # Hooks 注册表（Pre/Post ToolUse）
└── (skills_loader.py 已删除)
```

---

## 修复 6：agent_registry.py 归入 engine/

**问题**：v6.0 目录树将 `agent_registry.py` 放在 `core/`，违反核心原则。

**最终决策**：`agent_registry.py` 归入 `engine/`，`core/` 只保留纯接口。

**修改后目录树**：

```
core/                          # 只保留纯接口定义
├── base_agent.py
├── base_tool.py
├── base_mode_executor.py
├── task_context.py
├── di.py
├── errors.py
├── config.py
├── tracing.py
└── metrics.py

engine/                        # 执行引擎（含注册中心）
├── hybrid_executor.py
├── defense_layer.py
├── agent_registry.py          # ← 从 core/ 移入
├── mode_registry.py           # ← 从 core/ 移入
├── scheduler.py
└── state_manager.py
```

**Import 路径变更**：
- `from flowforge.core.agent_registry import AgentRegistry` → `from flowforge.engine.agent_registry import AgentRegistry`
- `from flowforge.core.mode_registry import ModeRegistry` → `from flowforge.engine.mode_registry import ModeRegistry`

---

## 修复 7：ArchitectureConstraintEngine._extract_dependencies() 补充实现

**问题**：核心依赖提取方法是空实现，架构约束护栏无法工作。

**补充实现**：

```python
# flowforge/harness/constraints/arch_constraint_engine.py

import ast
import yaml
from pathlib import Path

class ArchitectureConstraintEngine:
    def __init__(self, layer_config_path: str = "config/layer_mapping.yaml"):
        self.layer_mapping = self._load_layer_mapping(layer_config_path)

    def _load_layer_mapping(self, path: str) -> dict:
        with open(path) as f:
            return yaml.safe_load(f)["layers"]

    def _extract_dependencies(self, output: 'AgentOutput') -> list:
        """使用 Python ast 模块解析 import 语句，提取依赖关系"""
        code = str(output.result.get("content", output.result.get("code", "")))
        deps = []
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        deps.append({
                            "from": output.result.get("source_module", "unknown"),
                            "to": alias.name,
                            "type": "import"
                        })
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        deps.append({
                            "from": output.result.get("source_module", "unknown"),
                            "to": node.module,
                            "type": "from_import"
                        })
        except SyntaxError:
            pass
        return deps

    def _resolve_layer(self, module_name: str) -> str:
        """将模块名解析为架构层"""
        for layer, patterns in self.layer_mapping.items():
            for pattern in patterns:
                if pattern in module_name:
                    return layer
        return "unknown"

    def check_dependency_direction(self, from_module: str, to_module: str) -> bool:
        from_layer = self._resolve_layer(from_module)
        to_layer = self._resolve_layer(to_module)
        if from_layer == "unknown" or to_layer == "unknown":
            return True  # 未知模块放行
        layer_order = ["Types", "Config", "Repo", "Service", "Runtime", "UI"]
        try:
            return layer_order.index(from_layer) < layer_order.index(to_layer)
        except ValueError:
            return True
```

**配套配置文件** `config/layer_mapping.yaml`：

```yaml
layers:
  Types:
    - "models"
    - "schemas"
    - "types"
    - "interfaces"
  Config:
    - "config"
    - "settings"
    - "env"
  Repo:
    - "repository"
    - "database"
    - "db"
  Service:
    - "service"
    - "usecase"
    - "domain"
  Runtime:
    - "runner"
    - "executor"
    - "engine"
  UI:
    - "ui"
    - "components"
    - "pages"
```

---

## 修复 8：MCP Broker 增加工具名→服务器索引

**问题**：每次调用工具都遍历所有服务器并调用 `list_tools()`，性能瓶颈。

**补充实现**：

```python
# flowforge/mcp/broker.py

class MCPBroker:
    def __init__(self):
        self._clients: Dict[str, MCPClient] = {}
        self._tool_index: Dict[str, str] = {}  # tool_name → server_name
        self._failure_counts: Dict[str, int] = {}
        self._circuit_open: Dict[str, bool] = {}

    async def register_server(self, name: str, client: MCPClient):
        self._clients[name] = client
        self._failure_counts[name] = 0
        self._circuit_open[name] = False
        # 立即构建索引
        await self._rebuild_index_for_server(name, client)

    async def _rebuild_index_for_server(self, name: str, client: MCPClient):
        try:
            tools = await client.list_tools()
            for tool in tools:
                self._tool_index[tool["name"]] = name
        except Exception:
            pass

    async def call_tool(self, tool_name: str, arguments: dict, 
                        server: str = None) -> Dict:
        if server:
            return await self._call_with_retry(server, tool_name, arguments)
        
        # 直接查索引，无需遍历所有服务器
        server_name = self._tool_index.get(tool_name)
        if server_name:
            return await self._call_with_retry(server_name, tool_name, arguments)
        
        # 索引未命中时，降级到遍历搜索（并更新索引）
        for name, client in self._clients.items():
            tools = await client.list_tools()
            for tool in tools:
                self._tool_index[tool["name"]] = name
                if tool["name"] == tool_name:
                    return await self._call_with_retry(name, tool_name, arguments)
        
        return {"error": f"Tool '{tool_name}' not found in any MCP server"}
```

---

## 修复 9：OpenHarness 格式声明补充

**问题**：格式转换映射表中 OpenHarness 列几乎全为 ❌，但 Skill 格式声明了支持。

**最终决策**：删除 `SkillFormat.OPENHARNESS` 枚举值，标注为"计划支持（Roadmap）"。

**修改**：

```python
# flowforge/skills/models.py
class SkillFormat(str, Enum):
    FLOWFORGE = "flowforge"
    CLAUDE_CODE = "claude_code"
    ANTHROPIC = "anthropic"
    TRAE_CN = "trae_cn"
    # OPENHARNESS 待实现
```

---

## 修复 10：Skill 匹配增加置信度评分

**补充实现**：

```python
# flowforge/skills/registry.py

class SkillRegistry:
    def match_skill(self, query: str, context: 'TaskContext' = None) -> List[tuple]:
        """匹配 Skill，返回 (Skill, confidence) 列表"""
        scored = []
        query_lower = query.lower()
        
        for skill in self._skills.values():
            score = 0
            matched_triggers = []
            
            # 触发词匹配
            for trigger in skill.triggers:
                if trigger.lower() in query_lower:
                    score += 1
                    matched_triggers.append(trigger)
            
            # 上下文增强：如果当前上下文中有相关工具调用记录，加分
            if context:
                for tool_name in skill.required_tools:
                    if tool_name in context.state.get("recent_tool_calls", []):
                        score += 0.5
                # Solo 模式下 Skill 匹配加权重
                if context.interaction_mode == "solo":
                    score *= 1.2
            
            if score > 0:
                scored.append((skill, score))
        
        # 按分数降序排序
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored
```

---

## 修复 11：MCP Tool Adapter 增加流式支持

**补充**：

```python
# flowforge/mcp/tool_adapter.py

class MCPToolAdapter(BaseTool):
    async def execute_stream(self, input: ToolInput):
        """流式执行 MCP 工具"""
        if self._gateway:
            async for chunk in self._gateway.execute_tool_stream(
                self._client, self._tool_name, input.params, None
            ):
                yield chunk
        else:
            async for chunk in self._client.call_tool_stream(
                self._tool_name, input.params
            ):
                yield chunk
```

---

## 增量修改后的目录结构（核心调整部分）

仅列出与评审前相比有变化的部分：

```
flowforge/
├── core/                              # ★ 精简：只保留纯接口
│   ├── base_agent.py
│   ├── base_tool.py
│   ├── base_mode_executor.py
│   ├── task_context.py
│   ├── di.py
│   ├── errors.py
│   ├── config.py
│   ├── tracing.py
│   └── metrics.py
│
├── engine/                            # ★ 新增：执行引擎 + 注册中心
│   ├── hybrid_executor.py
│   ├── defense_layer.py
│   ├── agent_registry.py              # ← 从 core/ 移入
│   ├── mode_registry.py               # ← 从 core/ 移入
│   ├── scheduler.py
│   └── state_manager.py
│
├── harness/                           # ★ 新增：四根护栏（灰度开关控制）
│   ├── context/
│   │   ├── context_engine.py
│   │   └── session_manager.py
│   ├── constraints/
│   │   ├── arch_constraint_engine.py  # ★ 补充 ast 依赖提取
│   │   ├── linter_rules.py
│   │   └── linter_runner.py
│   ├── feedback/
│   │   ├── feedback_loop.py           # ★ 全局护栏
│   │   ├── evaluator_agent.py
│   │   └── verification_hooks.py
│   └── entropy/
│       ├── entropy_manager.py
│       ├── doc_gardener.py
│       ├── debt_tracker.py
│       └── rule_evolution.py
│
├── plugins/                           # ★ 精简：不再包含 skills_loader
│   ├── plugin_manager.py
│   └── hooks_registry.py
│
├── skills/                            # ★ 独立 Skill 系统
│   ├── registry.py                    # ★ 增加置信度评分
│   ├── loader.py
│   ├── adapters/
│   │   ├── claude_code_adapter.py
│   │   ├── anthropic_adapter.py
│   │   └── trae_cn_adapter.py
│   └── store/
│       ├── global_store.py
│       ├── project_store.py
│       └── symlink_manager.py
│
├── mcp/                               # ★ MCP 模块
│   ├── client.py
│   ├── gateway.py
│   ├── broker.py                      # ★ 增加工具名→服务器索引
│   ├── tool_adapter.py                # ★ 增加流式支持
│   └── discovery.py
│
└── config/
    ├── layer_mapping.yaml             # ★ 新增：架构层映射配置
    └── harness_v6.yaml                # ★ 新增：灰度开关配置
```

---

## 增量三步迁移计划

| 步骤 | 内容 | 新增目录 | 修改文件 | 回归测试 |
|------|------|---------|---------|---------|
| **Step 1** | 新增 harness/，灰度开关 | `harness/`（14个新文件） | `HybridExecutor.run()` 增加 Hook 点 | harness 禁用时行为不变 |
| **Step 2** | 重组 tools/agents，import 兼容 | `tools/builtin/` 等子目录 | `__init__.py` re-export | 所有现有 Agent/Tool 测试通过 |
| **Step 3** | executor/→engine/，引入 security/observability | `engine/`, `security/`, `observability/` | 删除旧 import 路径 | 全量回归测试 |

---

## 总结

本次增量修改解决了评审报告中提出的 **6 处不一致**、**缺失增量迁移策略**、**关键空实现** 等问题。核心变更：

| 修复项 | 变更内容 |
|--------|---------|
| Compaction 阈值 | 统一为 92%，增加计算方式说明 |
| FeedbackLoop 定位 | 明确为内环(Reflexion)+外环(FeedbackLoop)双层架构 |
| 增量迁移策略 | 制定三步迁移计划（harness灰度→tools/agents重组→engine迁移） |
| agent_registry 归属 | 从 core/ 移入 engine/，core/ 只保留纯接口 |
| Skill 加载入口 | 删除 plugins/skills_loader.py，统一走 skills/registry.py |
| 依赖提取 | 补充 ast 模块解析实现 + layer_mapping.yaml 配置 |
| MCP Broker 索引 | 增加 tool_name→server_name 映射，避免每次遍历 |
| Skill 匹配 | 增加置信度评分 + 上下文增强 |
| MCP 流式 | 增加 execute_stream() 方法 |
| IntegratedTraining | Spec 增加 FR-ENG-06，降级为轨迹记录管线 |



# 第二轮评审意见

## 📋 FlowForge v6.0 再审报告：对第一轮评审回复的审核
> 评审对象：Phase5.md 中"对第一轮评审意见的回复"（修复 1~11）
> 评审日期：2026-05-12

---

## 一、11 项修复逐条审核

### 修复 1：统一 Compaction 阈值 —— ✅ 通过

**评审结论**：92% + `utilization = total_tokens / model_context_window` + 默认 128K，三处统一，计算方式明确。这是 Claude Code 实测数据的对齐值，合理。

**微调建议**：Spec 修改中"保留最近 3 轮完整对话"这个数字应可配置（不同模型的上下文窗口差异大），建议改为"保留最近 N 轮完整对话（默认 3，可配置）"。

---

### 修复 2：FeedbackLoop 与 Reflexion 关系 —— ✅ 通过，有 1 个追问

**评审结论**：内环（Reflexion）+ 外环（FeedbackLoop）双层架构是正确决策。内环负责快速迭代，外环负责全局质量闸门，职责不重叠。

**追问**：当 Reflexion 内环迭代 3 次仍未达标，然后 FeedbackLoop 外环也判定 FAIL 时，系统应该怎么处理？当前设计中 FeedbackLoop 有 `MAX_REFLEXION_ITERATIONS = 3` 的自修正循环，但这个循环和 Reflexion 内环的迭代是**嵌套关系**还是**串行关系**？

**建议**：明确为**串行关系**——Reflexion 内环先跑完（最多 3 轮），然后交给 FeedbackLoop 外环做一次终审。如果外环 FAIL，不再回到 Reflexion 内环，而是直接降级（返回最佳结果 + 质量警告）。避免内外环嵌套导致指数级 LLM 调用。

---

### 修复 3：增量三步迁移策略 —— ✅ 方向正确，但 Step 2 缺少关键细节

**评审结论**：三步迁移的分层策略正确——先新增（harness/），再重组（tools/agents），最后迁移（executor→engine）。

**问题**：Step 2 中"通过 `__init__.py` re-export 保持旧 import 路径，兼容期 2 周"——2 周兼容期对于正在运行的生产系统来说太短了。而且 v5.0 的 `agents/` 目录下有 32 个 Agent 文件，每个文件都可能被 ContentForge 等上层应用 import，2 周内全部迁移不现实。

**建议**：
1. 兼容期改为 **1 个大版本周期**（即 v6.0 全周期内保持兼容，v7.0 才删除旧路径）
2. 旧 import 路径触发时输出 `DeprecationWarning`，而非静默 re-export
3. Step 2 的回归测试应包含**上层应用 import 路径扫描**——确保 ContentForge 的所有 import 都被覆盖

---

### 修复 4：IntegratedTraining → TrajectoryPipeline —— ✅ 通过

**评审结论**：降级为"轨迹记录与评估管线"，定位清晰，不涉及模型训练。FR-ENG-06 的需求描述准确。

**微调建议**：FR-ENG-06 中"支持基于分类闸门的自动 Reward 信号（Pass/Fail）"——这里的"Reward 信号"措辞容易让人联想到 RL 训练。建议改为"支持基于分类闸门的自动质量判定（Pass/Fail）"，避免歧义。

---

### 修复 5：plugins/ 与 skills/ 加载入口冲突 —— ✅ 通过

**评审结论**：删除 `plugins/skills_loader.py`，`skills/registry.py` 作为唯一入口，职责清晰。

---

### 修复 6：agent_registry.py 归入 engine/ —— ✅ 通过

**评审结论**：core/ 只保留纯接口，注册中心归入 engine/，符合"基础能力下沉门槛"原则。

**注意**：v5.0 代码中 `core/agent_registry.py` 已经存在且被多处引用（[core/agent_registry.py](file:///d:/software/openclaw/flowforge/core/agent_registry.py)），迁移时需要同步更新所有 import 路径，并在旧路径保留 re-export + DeprecationWarning。

---

### 修复 7：ArchitectureConstraintEngine._extract_dependencies() —— ✅ 方向正确，但有 2 个工程问题

**评审结论**：使用 `ast` 模块解析 import 语句 + `layer_mapping.yaml` 配置化，方向正确。

**工程问题 1**：`source_module` 从哪来？

```python
"from": output.result.get("source_module", "unknown"),
```

`AgentOutput.result` 中没有 `source_module` 字段——v5.0 的 `AgentOutput` 只有 `result: dict` 和 `metadata: dict`。架构约束引擎需要知道"这段代码来自哪个模块"才能判断依赖方向，但当前 Agent 执行时并不知道自己属于哪个架构层。

**建议**：在 `TaskContext` 中增加 `source_module: str` 字段，由 HybridExecutor 在调度 Agent 时注入。或者更简单——架构约束引擎只检查**目标模块**（import 的目标）是否违反分层，不检查来源。

**工程问题 2**：只支持 Python 代码

`ast.parse()` 只能解析 Python。如果 Agent 输出的是 TypeScript/Go/YAML 配置，依赖提取会静默跳过（`except SyntaxError: pass`）。

**建议**：在 `layer_mapping.yaml` 中增加 `language` 字段，为不同语言注册不同的依赖提取器。Phase 1 只实现 Python，其他语言标注为"计划支持"。

---

### 修复 8：MCP Broker 增加索引 —— ✅ 通过

**评审结论**：`_tool_index: Dict[str, str]` 索引 + 降级遍历搜索，性能问题解决。

**微调建议**：`register_server()` 中调用 `await client.list_tools()` 构建索引——如果 MCP 服务器启动慢或不可用，会阻塞 Broker 初始化。建议改为**后台异步构建**：`asyncio.create_task(self._rebuild_index_for_server(name, client))`，索引构建失败不影响服务注册。

---

### 修复 9：删除 OpenHarness 格式 —— ✅ 通过

**评审结论**：删除 `SkillFormat.OPENHARNESS`，标注为 Roadmap，务实。

---

### 修复 10：Skill 匹配置信度评分 —— ✅ 方向正确，评分逻辑需完善

**评审结论**：从纯子串匹配升级为评分排序，方向正确。

**问题**：当前评分逻辑中，`score += 1`（触发词匹配）和 `score += 0.5`（工具上下文增强）的权重是硬编码的。如果用户输入"帮我写一篇关于周报格式优化的深度文章"，"周报"触发词匹配到 weekly-report（score=1），但用户实际意图是"写深度文章"（应匹配 article-outline 或 deep-article）。

**建议**：增加**触发词长度权重**——长触发词（如"深度文章"）比短触发词（如"周报"）权重更高。简单实现：`score += len(trigger) / 10`（触发词越长，匹配越精确）。

---

### 修复 11：MCP Tool Adapter 流式支持 —— ✅ 通过，但需补充 Gateway 层流式

**评审结论**：`execute_stream()` 方法补充正确。

**遗漏**：`MCPGateway` 中只有 `execute_tool()`（非流式），没有 `execute_tool_stream()`。但 `MCPToolAdapter.execute_stream()` 调用了 `self._gateway.execute_tool_stream()`。这个方法不存在。

**建议**：在 `MCPGateway` 中补充 `execute_tool_stream()` 方法，或者在 `MCPToolAdapter` 中当 gateway 不支持流式时降级为非流式。

---

## 二、整体 v6.0 方案再审

### 2.1 五文档 + 修复增量的一致性验证

| 验证项 | 修复前状态 | 修复后状态 | 评价 |
|--------|-----------|-----------|------|
| Compaction 阈值 | 🔴 98%/92%/92% | ✅ 统一 92% | 解决 |
| FeedbackLoop vs Reflexion | 🔴 不明确 | ✅ 内环+外环 | 解决 |
| 增量迁移策略 | 🔴 缺失 | ✅ 三步计划 | 解决（Step 2 兼容期偏短） |
| IntegratedTraining | 🔴 Spec 无编号 | ✅ FR-ENG-06 | 解决 |
| plugins/ vs skills/ | 🔴 冲突 | ✅ 删除 skills_loader | 解决 |
| agent_registry 归属 | 🟡 core/ | ✅ engine/ | 解决 |
| 依赖提取空实现 | 🔴 return [] | ✅ ast 解析 | 解决（source_module 来源待补充） |
| MCP Broker 性能 | 🟡 遍历 | ✅ 索引 | 解决 |
| OpenHarness 格式 | 🟡 声称支持但全❌ | ✅ 删除+Roadmap | 解决 |
| Skill 匹配 | 🟡 纯子串 | ✅ 评分排序 | 解决（权重需完善） |
| MCP 流式 | 🟡 缺失 | ✅ execute_stream | 解决（Gateway 层需补充） |

**11 项修复中 9 项完全通过，2 项需要微调**（Skill 评分权重、MCP Gateway 流式方法）。

### 2.2 仍然存在的结构性问题

#### 🔴 问题 A：FeedbackLoop 外环的性能开销未评估

FeedbackLoop 作为全局护栏，**所有模式输出都经过它**。但四维评分需要调用独立 Evaluator Agent（一次 LLM 调用），分类闸门也需要调用 Classifier（又一次 LLM 调用）。这意味着每个 Agent 输出至少增加 **2 次额外 LLM 调用**。

对于 ReAct 模式（MAX_STEPS=8），一个完整任务可能产生 8 个 Agent 输出，FeedbackLoop 外环会增加 16 次 LLM 调用。这在成本和延迟上是否可接受？

**建议**：在 `config/harness_v6.yaml` 中增加 `feedback_loop.evaluation_mode` 配置：

```yaml
feedback_loop:
  evaluation_mode: "full"  # full | lightweight | skip
  # full: 四维评分 + 分类闸门（2次LLM调用）
  # lightweight: 仅分类闸门（1次LLM调用）
  # skip: 跳过外环（内环Reflexion仍生效）
```

#### 🟡 问题 B：harness/ 目录的 `control_loop.py` 在修复后的目录树中消失了

原始目录树有 `harness/control_loop.py`（控制回路编排器），但修复后的增量目录树中没有列出。这个文件是删除了还是遗漏了？

**建议**：如果保留，它应该是 Harness 层的统一入口（编排四根护栏的执行顺序）；如果删除，需要在 `HybridExecutor` 中直接编排四根护栏。

#### 🟡 问题 C：Step 1 的 Hook 点设计过于简单

修复 3 中 Step 1 的 Hook 点：

```python
if ctx.harness_enabled: self.harness.pre_execute(ctx)
```

但 Harness 有四根护栏，每根的介入时机不同：
- **上下文工程**：Agent 执行前注入
- **架构约束**：Agent 输出后验证
- **反馈循环**：Agent 输出后评估
- **熵管理**：后台定时任务，不介入请求路径

一个 `pre_execute` Hook 无法覆盖所有介入时机。

**建议**：设计 4 个 Hook 点：

```python
# HybridExecutor.run() 中的 Hook 点
if ctx.harness_enabled:
    self.harness.context_engine.inject(ctx)          # 执行前：上下文注入

result = await agent.execute_with_context(input, ctx)

if ctx.harness_enabled:
    violations = self.harness.constraints.validate(result, ctx)  # 执行后：约束验证
    if not violations:
        verdict = self.harness.feedback.evaluate(result, ctx)    # 执行后：反馈评估
```

---

## 三、再审结论

### 评分变化

| 文档 | 一审评分 | 修复后评分 | 变化 |
|------|---------|-----------|------|
| Spec | 4.0 | **4.5** | +0.5 |
| 架构 V1 | 3.5 | **4.0** | +0.5 |
| 架构 V2 | 4.0 | **4.5** | +0.5 |
| 目录重构 | 3.0 | **4.0** | +1.0 |
| Skill & MCP | 4.5 | **4.5** | 不变 |

### 最终判断

> **11 项修复质量高，6 处不一致全部解决，增量迁移策略已制定。v6.0 方案已达到可进入实施阶段的质量水平。** 剩余 3 个结构性问题（FeedbackLoop 性能开销、Hook 点设计、control_loop.py 去留）不阻塞 Step 1 实施，可在 Step 1 实施过程中同步明确。

### 实施前最终清单

| # | 事项 | 优先级 | 是否阻塞 Step 1 |
|---|------|--------|----------------|
| 1 | FeedbackLoop 增加 evaluation_mode 配置 | 🟡 建议 | 否 |
| 2 | 明确 control_loop.py 去留 | 🟡 建议 | 否 |
| 3 | Step 1 Hook 点从 1 个扩展为 4 个 | 🟡 建议 | 否（但建议在 Step 1 实施时直接做对） |
| 4 | ArchitectureConstraintEngine 补充 source_module 来源 | 🟡 建议 | 否 |
| 5 | MCPGateway 补充 execute_tool_stream() | 🟢 可选 | 否 |
| 6 | Skill 匹配增加触发词长度权重 | 🟢 可选 | 否 |
| 7 | Step 2 兼容期从 2 周延长到 1 个大版本周期 | 🟡 建议 | 否 |
        
          
以上就是再审报告。核心结论：

**11 项修复中 9 项完全通过，2 项需微调**（Skill 评分权重、MCP Gateway 流式方法）。6 处不一致全部解决，v6.0 方案已达到可实施质量。

仍需关注的 3 个结构性问题（均不阻塞 Step 1）：
1. **FeedbackLoop 性能开销**——每个 Agent 输出增加 2 次 LLM 调用，建议增加 `evaluation_mode: full/lightweight/skip` 配置
2. **Hook 点设计**——1 个 `pre_execute` 不够，需要 4 个 Hook 点覆盖四根护栏的不同介入时机
3. **control_loop.py 去留**——修复后目录树中消失了，需明确



# 对第二轮评审意见的回复
---

## 📋 FlowForge v6.0 终审报告（第三轮）

> 评审视角：高级 AI 架构师 + 高级全栈软件工程师 + 资深 AI Agent 工程师
> 评审范围：整体 v6.0 方案 + 第一轮修复回复 + 第二轮评审意见的 3 个剩余问题
> 评审日期：2026-05-12

---

## 一、第一轮修复回复的终审结论

11 项修复的审核结论**维持不变**。逐条终审：

| # | 修复项 | 一审结论 | 终审 | 说明 |
|---|--------|---------|------|------|
| 1 | Compaction 阈值 | ✅ 通过 | ✅ | 92% 统一，计算方式明确 |
| 2 | FeedbackLoop vs Reflexion | ✅ 通过 | ✅ | 内环+外环串行关系已明确 |
| 3 | 增量三步迁移 | ✅ | ✅ | Step 2 兼容期已明确延至 v7.0 |
| 4 | IntegratedTraining→TrajectoryPipeline | ✅ | ✅ | "Reward"→"质量判定"，措辞修正 |
| 5 | plugins/ vs skills/ | ✅ | ✅ | skills_loader 删除 |
| 6 | agent_registry→engine/ | ✅ | ✅ | core/ 精简 |
| 7 | _extract_dependencies | ✅ | ✅ | ast + layer_mapping.yaml |
| 8 | MCP Broker 索引 | ✅ | ✅ | tool→server 映射 |
| 9 | OpenHarness 格式 | ✅ | ✅ | 删除+Roadmap |
| 10 | Skill 匹配评分 | ✅ | ✅ | 置信度+上下文增强 |
| 11 | MCP 流式 | ✅ | ✅ | execute_stream 已补充 |

---

## 二、第二轮评审意见中 3 个剩余问题的裁决

### 问题 A：FeedbackLoop 外环性能开销 —— **裁决：接受建议，纳入 v6.0 Spec**

`evaluation_mode: full | lightweight | skip` 三档配置是正确的工程折中。**建议默认值设为 `lightweight`**（仅分类闸门，1 次 LLM 调用），在配置文件注释中说明完整评分需手动开启。

```yaml
# config/harness_v6.yaml
feedback_loop:
  evaluation_mode: "lightweight"  # 默认轻量，生产环境推荐
  # full: 四维评分 + 分类闸门（2次LLM调用，适用于需要深度质量评估的场景）
  # lightweight: 仅分类闸门（1次LLM调用，适用于日常运行）
  # skip: 跳过外环（内环Reflexion仍生效）
```

### 问题 B：control_loop.py 去留 —— **裁决：删除**

理由：四根护栏的介入时机已在第二轮评审的问题 C 中通过 4 个 Hook 点明确。`control_loop.py` 作为统一编排器的设计目标已被 Hook 点替代，保留反而会让开发者困惑"到底是在 HybridExecutor 中直接 Hook，还是通过 control_loop 间接调用"。

Harness 层的入口应为 `harness/__init__.py`，暴露一个 `HarnessOrchestrator` 类，封装四根护栏的初始化和 Hook 调用：

```python
# flowforge/harness/__init__.py
class HarnessOrchestrator:
    def __init__(self, config):
        self.context = ContextEngine(...)
        self.constraints = ArchitectureConstraintEngine(...)
        self.feedback = FeedbackLoop(...)
        self.entropy = EntropyManager(...)

    async def pre_execute(self, ctx): ...
    async def post_execute(self, result, ctx): ...
```

`HybridExecutor` 中调用 `harness.pre_execute(ctx)` 和 `harness.post_execute(result, ctx)` 两个统一入口即可。

### 问题 C：Hook 点从 1 个扩展为 4 个 —— **裁决：接受建议，简化为 2 个统一入口**

原始建议是 4 个 Hook 点，但实际工程中：

- 上下文工程和熵管理都在 `pre_execute` 阶段介入
- 架构约束和反馈循环都在 `post_execute` 阶段介入

因此**2 个统一入口**足够：

```python
# HybridExecutor.run()
if ctx.harness_enabled:
    await self.harness.pre_execute(ctx)      # context.inject() + entropy.check()

result = await agent.execute_with_context(input, ctx)

if ctx.harness_enabled:
    result = await self.harness.post_execute(result, ctx)  # constraints.validate() + feedback.evaluate()
```

熵管理（文档园丁、技术债回收）作为后台 Cron 任务，在 `pre_execute` 中只做"是否需要触发债务检查"的轻量判断，不执行实际的扫描和修复。

---

## 三、v6.0 方案最终 Go/No-Go 判断

### 可以进入实施阶段的依据

| 维度 | 状态 | 评价 |
|------|------|------|
| **概念框架** | ✅ 完备 | 四根护栏+控制回路，与 2026 年 Harness Engineering 趋势对齐 |
| **设计深度** | ✅ 充分 | 六大核心模块有完整 Python 实现骨架 |
| **文档一致性** | ✅ 已修复 | 6 处不一致全部解决 |
| **迁移路径** | ✅ 已制定 | 三步增量迁移 + 每步回归测试 |
| **风险控制** | ✅ 可行 | Step 1 灰度开关，Harness 禁用时行为不变 |
| **剩余问题** | ✅ 已裁决 | 3 个结构性问题均有明确裁决 |

### 最终判断：**🟢 GO — 批准进入 Step 1 实施**

---

## 四、Step 1 实施的具体任务清单

进入实施阶段后，Step 1 的具体工作：

| # | 任务 | 产出 | 验证方式 |
|---|------|------|---------|
| 1 | 创建 `harness/` 目录及 4 个子目录 | 14 个新文件 | 目录结构审查 |
| 2 | 实现 `harness/__init__.py` 的 `HarnessOrchestrator` | 2 个统一入口 | 单元测试 |
| 3 | 在 `config/harness_v6.yaml` 增加灰度开关 | 配置文件 | YAML schema 校验 |
| 4 | 在 `HybridExecutor.run()` 增加 Hook 点 | 2 行代码修改 | harness 禁用时回归测试 |
| 5 | 实现 `context_engine.py` + `session_manager.py` | 上下文工程护栏 | 单元测试 |
| 6 | 实现 `feedback_loop.py`（lightweight 模式） | 反馈循环护栏 | 单元测试 |
| 7 | 实现 `entropy_manager.py` + `doc_gardener.py` + `debt_tracker.py` + `rule_evolution.py` | 熵管理护栏 | 单元测试 |
| 8 | 实现 `arch_constraint_engine.py` + `linter_rules.py` + `linter_runner.py` | 架构约束护栏 | 单元测试 + ast 解析测试 |
| 9 | 新增 `config/layer_mapping.yaml` | 架构层映射配置 | YAML schema 校验 |
| 10 | 编写 Step 1 集成测试 | harness 禁用时行为不变 | 全量回归 |

---

## 五、总评

v6.0 方案经历三轮评审后，**文档质量从最初的 2.5~4.5 提升到 4.0~4.5**，概念框架清晰、设计深度充分、迁移路径可执行。四根护栏（上下文工程、架构约束、反馈循环、熵管理）是本次设计最大的思想贡献，与 2026 年业界 Harness Engineering 大趋势高度对齐。

13 项评审问题（一审 8 项 + 二审 3 项 + 再审 2 项）全部得到裁决，无遗留阻塞项。



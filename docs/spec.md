# FlowForge v6.0 功能特性规格说明书

> **版本**：v6.0
> **日期**：2026-05-12
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

- **从"编排框架"到"驾驭系统"**：FlowForge 不再是简单的 Agent 流程编排工具，而是为 AI Agent 提供完整控制回路的操作系统级平台。
- **从"个人助手"到"组织能力资产"**：通过 Skill 系统、插件机制和团队协作功能，让 Agent 能力可复用、可版本化、可分发。
- **从"单点智能"到"多Agent协作"**：内置三种多Agent策略（Subagents/Teams/Swarms），支撑从个人开发到企业级CI/CD的全场景覆盖。

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

### 2.3 Harness Hook 点设计

Harness 层通过 2 个统一入口介入 Agent 执行流程：

```python
# HybridExecutor.run() 中的 Hook 点
if ctx.harness_enabled:
    await self.harness.pre_execute(ctx)      # context.inject() + entropy.check()

result = await agent.execute_with_context(input, ctx)

if ctx.harness_enabled:
    result = await self.harness.post_execute(result, ctx)  # constraints.validate() + feedback.evaluate()
```

- **pre_execute**：上下文工程注入 + 熵管理轻量检查
- **post_execute**：架构约束验证 + 反馈循环评估

熵管理（文档园丁、技术债回收）作为后台 Cron 任务，在 `pre_execute` 中只做"是否需要触发债务检查"的轻量判断，不执行实际的扫描和修复。

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

**FR-ENG-06：轨迹记录与评估管线 (Trajectory Recording Pipeline)**
- 记录 Agent 执行全过程的工具调用轨迹、决策点、状态变更
- 每个任务生成一个 Episode（轨迹 + 验证结果）
- 支持基于分类闸门的自动质量判定（Pass/Fail）
- 持久化到 CheckpointManager，供后续分析和 Skill 进化使用
- 定位：轨迹记录管线，不涉及模型训练（训练基础设施不具备）

### 3.2 Harness 驾驭层 (Harness Layer)

**FR-HRN-01：上下文工程引擎 (ContextEngine)**
- AGENTS.md 动态知识注入：按任务域（domain）检索相关规则
- 历史失败案例检索：从知识库中检索同类任务的历史教训
- 会话交接物构建：`init_script + progress_log + feature_checklist`
- 按需上下文注入：只在 Agent 需要时注入，不污染上下文窗口

**FR-HRN-02：架构约束引擎 (ArchitectureConstraintEngine)**
- 分层依赖模型（Types → Config → Repo → Service → Runtime → UI）
- 自定义 Linter 规则库（可扩展）
- CI 门禁：违反约束则阻断
- 违规信息自动注入 Agent 上下文（让 Agent 自我修复）
- 依赖提取：使用 Python `ast` 模块解析 import 语句，配合 `config/layer_mapping.yaml` 配置化模块→层映射
- Phase 1 仅支持 Python 语言依赖提取，其他语言标注为"计划支持"

**FR-HRN-03：反馈循环引擎 (FeedbackLoop) —— 全局护栏**
- 定位：所有 Agent 输出的**外部质量闸门**，独立于任何模式
- 与 Reflexion 模式的关系：**内环+外环**双层架构
  - 内环（Reflexion 模式）：快速 Actor→Evaluator→Reflector 循环
  - 外环（FeedbackLoop）：四维评分 + 分类闸门，全局生效
- 串行关系：Reflexion 内环先跑完（最多 3 轮），然后交给 FeedbackLoop 外环做一次终审。如果外环 FAIL，不再回到 Reflexion 内环，而是直接降级（返回最佳结果 + 质量警告）
- 生成与评判分离：独立的 Evaluator Agent 评判 Generator Agent 的产出
- 四维评分体系：Design Quality / Originality / Craft / Functionality
- 分类闸门：只看工具执行结果，忽略模型自我评价
- 如果内环已达标，外环快速通过；如果直接输出模式，外环进行独立验证
- evaluation_mode 三档配置：
  - `full`：四维评分 + 分类闸门（2 次 LLM 调用，适用于需要深度质量评估的场景）
  - `lightweight`：仅分类闸门（1 次 LLM 调用，默认，适用于日常运行）
  - `skip`：跳过外环（内环 Reflexion 仍生效）

**FR-HRN-04：熵管理引擎 (EntropyManager)**
- 文档园丁 Agent：后台定时扫描文档-代码不一致，自动提交修复 PR
- 技术债跟踪器：优先级排序 + 持续小额偿还
- 规则进化器：每次 Agent 失败转化为一条工程规则
- 垃圾回收调度：Cron 定时任务自动触发
- 定位：**内置核心能力**，不走插件市场。文档园丁直接在 `harness/entropy/` 中实现

**FR-HRN-05：权限管线 (PermissionPipeline)**
- deny → ask → allow 三层管线（deny 永远胜出）
- 四级动作分级：Read / Suggest / Prepare / Execute
- 低风险操作 Auto Mode 静默通过
- 高风险操作必须人工确认

**FR-HRN-06：会话管理器 (SessionManager)**
- 92% 阈值触发上下文压缩：当 token 使用量达到模型上下文窗口 92% 时自动压缩
- 计算方式：`utilization = total_tokens / model_context_window`
- 模型上下文窗口从 LLM 配置文件读取，默认 128K
- 保留最近 N 轮完整对话（默认 3，可配置）+ 压缩早期历史为摘要
- 工具输出 Token 截断（默认 25000 tokens）
- 会话交接：检查点保存 + 交接物传递

### 3.3 能力层 (Capability Layer)

**FR-CAP-01：Tool 生态**
- 内置 12+ 工具：LLM Client、文件读写、Shell 执行、网络搜索、HelixRAG、Python 沙箱、Git 操作、图片搜索、邮件发送、Webhook、TaskBoard 操作
- 协议适配器：MCP / OpenAPI / GraphQL 三种协议自动转换为 Tool
- 门控工具管线：权限检查 → 安全分类 → 执行 → 输出校验
- 安全标记：`safety_level` 属性 + `is_concurrency_safe`
- 工具输出 Schema 校验

**FR-CAP-02：Skill 系统**
- 跨格式兼容：原生支持 FlowForge / Claude Code / Anthropic / Trae CN 四种 Skill 格式
- OpenHarness 格式标注为 Roadmap，当前不实现
- 双层加载：全局 Skill（~/.flowforge/skills/）+ 项目 Skill（./.flowforge/skills/）
- 符号链接支持：项目 Skill 链接到全局目录
- Skill 组合技（Combo Skills）：多 Skill 管道编排
- 触发器匹配：自然语言触发词自动匹配并激活 Skill，支持置信度评分 + 上下文增强
- Skill 版本管理：语义化版本 + 依赖管理 + 变更记录

**FR-CAP-03：MCP 模块**
- L1 MCP Client：JSON-RPC 2.0 客户端 + stdio / Streamable HTTP 双传输
- L2 MCP Gateway：工具白名单 + Token 预算管理 + 速率限制 + 权限管线集成
- L3 MCP Broker：多服务器聚合 + 动态路由 + 熔断/重试 + 工具名→服务器索引
- L4 MCP Tool Adapter：自动转换为 FlowForge BaseTool + 流式执行支持
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
- ContextCompressor：tiktoken + 滑动窗口 + 92% 阈值触发

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
- 令牌预算约束：每个子 Agent 独立令牌预算（默认 50000 tokens）

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
- 注意：Skill 的加载由 `skills/registry.py` 独立管理，不走 `plugins/plugin_manager.py`

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

### 4.2 FeedbackLoop 评估模式

| 模式 | LLM 调用次数 | 适用场景 |
|------|-------------|---------|
| `full` | 2 次（四维评分 + 分类闸门） | 需要深度质量评估的场景 |
| `lightweight` | 1 次（仅分类闸门） | 日常运行，**默认** |
| `skip` | 0 次（跳过外环） | 内环 Reflexion 仍生效 |

### 4.3 可靠性要求

| 指标 | 目标 |
|------|------|
| 系统可用性 | > 99%（非硬件故障） |
| 人工审核通过率 | > 90% |
| 模型故障自动切换 | < 10s |
| WebSocket 断线重连 | 指数退避，最多 10 次 |
| Circuit Breaker 触发 | 5 次连续失败触发熔断 |
| 429 Retry-After | 支持 retry-after 头部解析 |

### 4.4 可扩展性

- **NFR-01**：插件化 Agent/Mode/Tool 注册机制，支持热插拔
- **NFR-02**：MCP 协议接入外部工具服务器
- **NFR-03**：OpenAPI/GraphQL 自动转换为 Tool
- **NFR-04**：配置热重载（harness_v6.yaml 修改后无需重启）

### 4.5 安全性

- **NFR-05**：三层权限管线 + 四级动作分级
- **NFR-06**：代码沙箱 + 文件系统路径穿越防护
- **NFR-07**：Human-in-the-Loop 审核（所有正式发布必须人工确认）
- **NFR-08**：全链路审计追踪
- **NFR-09**：密钥加密存储（SecretStore）

### 4.6 可维护性

- **NFR-10**：清晰的分层架构和模块边界
- **NFR-11**：声明式 YAML 配置驱动
- **NFR-12**：全链路追踪和结构化日志
- **NFR-13**：Prometheus + Grafana 监控
- **NFR-14**：结构化异常体系——`ProxyError` 携带 `context dict`，包含 trace_id、tool_name、原始错误信息

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

### 5.4 增量三步迁移策略

| 步骤 | 内容 | 新增目录 | 修改文件 | 回归测试 |
|------|------|---------|---------|---------|
| **Step 1** | 新增 harness/，灰度开关 | `harness/`（14个新文件） | `HybridExecutor.run()` 增加 Hook 点 | harness 禁用时行为不变 |
| **Step 2** | 重组 tools/agents，import 兼容 | `tools/builtin/` 等子目录 | `__init__.py` re-export + DeprecationWarning | 所有现有 Agent/Tool 测试通过 |
| **Step 3** | executor/→engine/，引入 security/observability | `engine/`, `security/`, `observability/` | 删除旧 import 路径 | 全量回归测试 |

Step 2 的 import 兼容期为 **1 个大版本周期**（v6.0 全周期内保持兼容，v7.0 才删除旧路径），旧 import 路径触发时输出 `DeprecationWarning`。

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

---

## 附录 A：Harness 层配置参考

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
    layer_mapping_path: "config/layer_mapping.yaml"
    linter_rules_path: "config/linter_rules.yaml"
    ci_gate: "fail_on_violation"

  feedback_loop:
    enabled: true
    evaluation_mode: "lightweight"  # full | lightweight | skip
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
    model_context_window: 128000
    preserved_rounds: 3
    max_tool_output_tokens: 25000
    tool_output_warning_tokens: 10000
    handoff_enabled: true
    checkpoint_interval: 300

  entropy_management:
    enabled: true
    doc_gardener_schedule: "0 2 * * *"
    debt_collection_schedule: "weekly"
    capture_failures_to_rules: true
```

## 附录 B：架构层映射配置参考

```yaml
# config/layer_mapping.yaml
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

## 附录 C：评审修复记录

本规格说明书经过三轮评审，以下为关键修复记录：

| # | 修复项 | 变更内容 |
|---|--------|---------|
| 1 | Compaction 阈值 | 统一为 92%，计算方式：`utilization = total_tokens / model_context_window`，默认 128K |
| 2 | FeedbackLoop 定位 | 明确为内环(Reflexion)+外环(FeedbackLoop)双层架构，串行关系，外环 FAIL 直接降级不回内环 |
| 3 | 增量迁移策略 | 制定三步迁移计划（harness 灰度→tools/agents 重组→engine 迁移），兼容期延至 v7.0 |
| 4 | FR-ENG-06 | 新增轨迹记录与评估管线，降级为轨迹记录，不涉及模型训练，"Reward"改为"质量判定" |
| 5 | Skill 加载入口 | 删除 plugins/skills_loader.py，统一走 skills/registry.py |
| 6 | agent_registry 归属 | 从 core/ 移入 engine/，core/ 只保留纯接口 |
| 7 | 依赖提取实现 | 补充 ast 模块解析 + layer_mapping.yaml 配置化 |
| 8 | MCP Broker 索引 | 增加 tool_name→server_name 映射，避免每次遍历 |
| 9 | OpenHarness 格式 | 删除 SkillFormat.OPENHARNESS，标注为 Roadmap |
| 10 | Skill 匹配评分 | 增加置信度评分 + 上下文增强 + 触发词长度权重 |
| 11 | MCP 流式 | 增加 execute_stream() 方法 |
| 12 | evaluation_mode | FeedbackLoop 增加 full/lightweight/skip 三档配置，默认 lightweight |
| 13 | control_loop.py | 删除，由 HarnessOrchestrator（2 个统一入口 pre_execute/post_execute）替代 |
| 14 | Hook 点设计 | 从 1 个 pre_execute 扩展为 2 个统一入口（pre_execute + post_execute） |
| 15 | 熵管理定位 | 明确为内置核心能力，不走插件市场 |
| 16 | 保留对话轮数 | 改为可配置（默认 3，可配置），适应不同模型上下文窗口 |

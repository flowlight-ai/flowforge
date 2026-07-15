# FlowForge v2.1 功能特性规格说明书

> **版本**：v2.1
> **日期**：2026-06-15
> **定位**：从 Agent 编排框架进化为 **Agent 驾驭层 (Harness Layer)**——为 AI Agent 提供约束、反馈、上下文管理与熵控制的完整控制论系统。

***

## 第一章：产品概述与愿景

### 1.1 产品定位

FlowForge v2.1 是一个**企业级 Agent Harness 平台**，它将前沿的 AI Agent 架构模式（9 大模式）、四根 Harness 护栏（上下文工程、架构约束、反馈循环、熵管理）、多协议工具生态（MCP/OpenAPI/GraphQL）、Skill 系统、多 Agent 策略（Subagents/Teams/Swarms）和 Helm 实时交互融合为一体，为上层业务提供**可控、可观测、可进化的 Agent 运行基础设施**。

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

| 角色                       | 描述                           | 核心诉求                             |
| ------------------------ | ---------------------------- | -------------------------------- |
| **AI 应用开发者**             | 使用 FlowForge 构建 Agent 应用的工程师 | 快速构建、开箱即用的 Agent 模式、丰富的工具生态      |
| **平台管理员**                | 管理 FlowForge 平台配置和安全策略的人员    | 权限管控、安全策略、可观测性、成本优化              |
| **业务专家**                 | 内容创作者、产品经理等非技术角色             | 自然语言交互、Skill 调用、审核流程、Web UI 操作   |
| **AI 主编/指挥 (Commander)** | LangGraph 驱动的调度核心            | 理解创作意图、拆解 SOP、调度专家 Agent、监控全链路质量 |

### 1.5 核心业务场景

1. **被动创作 (On-Demand)**：用户通过 Web UI 或 Helm 界面发送创作意图，系统启动全链路（选题→研究→写作→审核→发布），最终推送审核通知。
2. **主动创作 (Scheduled)**：用户在 Web UI 配置 Cron 定时任务，系统自主完成选题→创作→审核提示的全流程。
3. **级联自愈 (Self-Healing)**：当专栏的创作 Agent 发现主力模型接连失败时，自动触发模型健康检查、刷新可用模型，并**级联更新**所有共享该模型的其他专栏。
4. **审核与干预 (Human-in-the-Loop)**：AI 生成的任何内容在正式发布前，通过 Web UI、Helm 内联审核块或即时通讯渠道推送预览，用户可选择通过、编辑或拒绝。
5. **系统监控 (Dashboard)**：统一 Web UI 仪表盘实时展示专栏运行状态、今日创作数量、模型费用统计、系统健康度。
6. **Agent-to-Agent Review**：在反馈循环中，生成 Agent 的产出由独立的评判 Agent 进行四维评分（Design Quality / Originality / Craft / Functionality），不通过则进入自修正循环。
7. **技术债自动回收**：文档园丁 Agent 后台定期扫描文档-代码不一致，自动提交修复 PR；技术债跟踪器按优先级持续偿还技术债务。

***

## 第二章：系统架构总览

### 2.1 六层架构模型

FlowForge v2.1 采用分层解耦的 Harness 架构，整体分为六层：

```
┌─────────────────────────────────────────────────────────────────────┐
│  6. 应用层 (Application Layer)                                      │
│     ContentForge / NovelForge / 其他业务系统                        │
├─────────────────────────────────────────────────────────────────────┤
│  5. 接入层 (Gateway Layer)                                          │
│     FastAPI REST API + WebSocket (Helm/Events) + Web UI + CLI       │
├─────────────────────────────────────────────────────────────────────┤
│  4. Harness 驾驭层 (Harness Layer) ★ v2.1 核心                      │
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

FlowForge v2.1 的核心是一个完整的前馈+反馈控制回路：

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

- **pre\_execute**：上下文工程注入 + 熵管理轻量检查
- **post\_execute**：架构约束验证 + 反馈循环评估

熵管理（文档园丁、技术债回收）作为后台 Cron 任务，在 `pre_execute` 中只做"是否需要触发债务检查"的轻量判断，不执行实际的扫描和修复。

***

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

| 模式                  | 核心机制                                                        | 适用场景             |
| ------------------- | ----------------------------------------------------------- | ---------------- |
| `react`             | Thought → Action → Observation 循环（MAX\_STEPS=8，含循环检测）       | 多步动态检索或工具调用      |
| `plan_execute`      | Planner 生成步骤清单，Executor 依次执行                                | 路径明确、步骤可预测的任务    |
| `reflexion`         | Actor → Evaluator → Reflector 三 Agent 迭代（MAX\_ITERATIONS=4） | 需要反复打磨的任务（代码、文档） |
| `multi_agent`       | Subagents/Teams/Swarms 三种子策略                                | 需要多角色配合的复杂任务     |
| `workflow`          | 预定义 DAG 流程，可混合其他模式                                          | 长流程、端到端业务流水线     |
| `rewoo`             | 一次性规划所有工具调用，批量执行                                            | 确定性多 API 调用      |
| `self_discover`     | 任务前自动发现最佳推理结构                                               | 不确定领域            |
| `agent_judge`       | 独立 Agent 作为评判者，提供定性反馈                                       | 无外部评分标准的任务       |
| `graph_of_thoughts` | 图式推理，多思路聚合、交叉验证                                             | 复杂推理、数学证明        |

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
- evaluation\_mode 三档配置：
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

- 内置 12+ 工具：LLM Client、文件读写、Shell 执行、网络搜索、OpenSieveClient、Python 沙箱、Git 操作、图片搜索、邮件发送、Webhook、TaskBoard 操作
- 协议适配器：MCP / OpenAPI / GraphQL 三种协议自动转换为 Tool
- 门控工具管线：权限检查 → 安全分类 → 执行 → 输出校验
- 安全标记：`safety_level` 属性 + `is_concurrency_safe`
- 工具输出 Schema 校验

**FR-CAP-02：Skill 系统**

- 跨格式兼容：原生支持 FlowForge / Claude Code / Anthropic / Trae CN 四种 Skill 格式
- OpenHarness 格式标注为 Roadmap，当前不实现
- 双层加载：全局 Skill（\~/.flowforge/skills/）+ 项目 Skill（./.flowforge/skills/）
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

### 3.5 Helm 实时交互 (Helm Mode)

**FR-HELM-01：实时执行流**

- 17 种 FlowForge 事件 → 16 种 Helm 事件类型全映射
- WebSocket 专用通道 `/ws/helm/{task_id}`
- 事件序号 + 断线重连 + 历史回放

**FR-HELM-02：Helm 三栏布局**

- 左栏：执行流（虚拟滚动，支持 500+ 条事件）
- 中栏：工具调用/LLM 思考详情面板（可展开/折叠）
- 右栏：Markdown 编辑器（编辑/预览/分屏三种模式）

**FR-HELM-03：审核节点内联**

- 审核操作直接嵌入执行流，不跳转到独立页面
- 支持审核通过/驳回/编辑提交
- 审核窗口期 5 分钟内可撤回

**FR-HELM-04：任务控制**

- 暂停/恢复/跳过当前节点
- 实时 Token 统计和费用预估

**FR-HELM-05：Plan 模式 UI**

- 用户输入任务后 AI 生成结构化执行计划
- 用户可编辑/调整/确认 Plan 后系统按计划执行
- Plan 步骤支持指定 agent/tool/mode
- Plan 确认后内部转换为 Workflow YAML 委托 WorkflowExecutor 执行
- Harness 集成：步骤执行用 lightweight FeedbackLoop，完成时用 full 模式

**FR-HELM-06：文件上传/附件**

- 支持拖拽或按钮上传文件（截图/文档/代码等）
- 文件类型白名单校验（MIME + 扩展名双重校验）
- UUID 重命名存储，原始文件名保留在元数据
- 速率限制：每分钟 10 个文件/每任务
- 附件自动注入 TaskContext.state 供 Agent 通过 workspace_file 访问

**FR-HELM-07：Diff 视图升级**

- 引入 diff 库替代手写 Diff 算法
- 支持字符级高亮和行号显示
- 支持按文件分组的多文件变更视图
- 一键接受/拒绝单个 Hunk 或全部变更
- FileChangeTracker 后端组件跟踪文件变更历史
- 大文件（>1000 行）使用 Web Worker 计算 Diff

**FR-HELM-08：斜杠命令面板**

- 可视化命令面板，支持分组（执行控制/模式切换/导航/工具/帮助）
- 模糊匹配算法（精确 > 包含 > 字符序列）
- Ctrl+K 全局触发
- 后端 API 动态生成命令列表
- 空状态和无匹配状态设计

**FR-HELM-09：前端状态管理**

- React Context + useReducer 零依赖方案
- PlanContext / AttachmentContext / DiffContext
- HelmContextProvider 组合 Provider

**FR-HELM-10：数据库迁移**

- 新建 data/helm.db 管理 Helm 交互数据
- plans 表：id / task_id / title / steps_json / status / current_step / total_steps 等
- attachments 表：id / task_id / file_name / file_size / file_type / mime_type / storage_path 等

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

| 指标名                                             | 类型        | 描述         |
| ----------------------------------------------- | --------- | ---------- |
| `flowforge_tasks_total{mode, status}`           | counter   | 任务创建总数     |
| `flowforge_execution_duration_seconds`          | histogram | 任务执行耗时     |
| `flowforge_token_usage_total{model, provider}`  | counter   | Token 消耗   |
| `flowforge_tool_calls_total{tool_name, status}` | counter   | 工具调用次数     |
| `flowforge_persona_running{persona}`            | gauge     | 当前各专栏运行任务数 |

**FR-OBS-03：审计日志**

- 所有 Agent、Tool 调用均记录在 audit\_logs 表中
- 包含输入参数、输出、trace\_id、耗时
- 敏感信息脱敏

**FR-OBS-04：WebSocket 实时推送**

- 通用事件通道 `/ws/events`
- Helm 专用通道 `/ws/helm/{task_id}`
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

### 3.9 SDK 与上层集成 (SDK & Upper Integration)

**FR-SDK-01：FlowForgeSDK 统一入口**

- 上层项目只需 `from flowforge.sdk import FlowForgeSDK` 即可获得全部 FlowForge 能力
- 懒初始化属性访问：`sdk.llm` / `sdk.models` / `sdk.tools` / `sdk.agents` / `sdk.events` / `sdk.memory` / `sdk.guardrails` / `sdk.handoffs` / `sdk.mcp`
- 装饰器注册：`@sdk.tool()` / `@sdk.agent()` / `@sdk.declarative_agent()` / `@sdk.input_guardrail()` / `@sdk.output_guardrail()` / `@sdk.on_event()`
- `sdk.wire(flowforge_instance)` 可将 SDK 的注册表与已有 FlowForge 实例对接

**FR-SDK-02：ModelCapabilityProvider 零配置模型访问**

- 上层项目通过 `sdk.llm.chat()` 即可调用 LLM，无需关心 provider/model 配置
- 自动读取 `models.yaml` 中的 provider 和 model 配置
- 智能路由：根据健康检查结果自动选择可用模型
- 降级容错：主模型不可用时自动切换到 fallback 模型

**FR-SDK-03：@tool 装饰器**

- 5 行代码即可创建工具：`@sdk.tool(name="my_tool", description="...")`
- 自动从函数签名生成 `parameters_schema`
- 自动注册到 `ToolRegistry`
- 支持 `safety_level` 参数

**FR-SDK-04：Guardrails 并行安全检查**

- InputGuardrail：Agent 执行前的输入检查
- OutputGuardrail：Agent 执行后的输出检查
- 并行执行：所有 Guardrail 通过 `asyncio.gather` 并行运行
- 四种结果：`passed`（通过）/ `warned`（警告但通过）/ `blocked`（阻断）/ `modified`（转换后通过）
- 任何 Guardrail 返回 `blocked` 时立即停止执行

**FR-SDK-05：Agent Handoff 任务委托**

- LLM 驱动的 Agent 间任务委托
- `Handoff` 定义委托目标、触发条件
- `HandoffManager` 管理委托路由、验证目标 Agent、传递上下文
- 自动生成委托提示词注入 Agent 系统提示

**FR-SDK-06：MCP Integration**

- 一键连接 MCP 服务器：`await sdk.mcp.connect_server(name, command, args)`
- 自动将 MCP 工具注册为 FlowForge BaseTool
- 支持动态工具发现和延迟加载

**FR-SDK-07：Declarative Agent 声明式 Agent**

- 无需继承 BaseAgent，通过装饰器声明即可创建 Agent
- 支持声明：`model`（首选模型）/ `tools`（可用工具列表）/ `instructions`（系统提示）/ `handoffs`（可委托 Agent）/ `guardrails`（安全护栏）
- 函数体留空（`...`）时使用默认 LLM 执行逻辑

**FR-SDK-08：Marketplace 插件市场**

- 插件搜索：按关键词/标签搜索可用插件
- 一键安装/卸载：`sdk.marketplace.install("plugin_name")` / `sdk.marketplace.uninstall("plugin_name")`
- 版本管理：支持插件版本检查和更新

***

## 第四章：非功能需求 (NFR)

### 4.1 性能要求

| 指标                      | 目标           |
| ----------------------- | ------------ |
| 单 Agent 执行延迟（不含 LLM）    | < 2s (P95)   |
| Workflow 8 步骤执行（不含 LLM） | < 30s        |
| WebSocket 事件延迟          | < 50ms (P95) |
| 插件加载时间（10个插件）           | < 500ms      |
| 并发创建 10 个不同 persona 任务  | 全部成功，无锁冲突    |

### 4.2 FeedbackLoop 评估模式

| 模式            | LLM 调用次数         | 适用场景             |
| ------------- | ---------------- | ---------------- |
| `full`        | 2 次（四维评分 + 分类闸门） | 需要深度质量评估的场景      |
| `lightweight` | 1 次（仅分类闸门）       | 日常运行，**默认**      |
| `skip`        | 0 次（跳过外环）        | 内环 Reflexion 仍生效 |

### 4.3 可靠性要求

| 指标                 | 目标                  |
| ------------------ | ------------------- |
| 系统可用性              | > 99%（非硬件故障）        |
| 人工审核通过率            | > 90%               |
| 模型故障自动切换           | < 10s               |
| WebSocket 断线重连     | 指数退避，最多 10 次        |
| Circuit Breaker 触发 | 5 次连续失败触发熔断         |
| 429 Retry-After    | 支持 retry-after 头部解析 |

### 4.4 可扩展性

- **NFR-01**：插件化 Agent/Mode/Tool 注册机制，支持热插拔
- **NFR-02**：MCP 协议接入外部工具服务器
- **NFR-03**：OpenAPI/GraphQL 自动转换为 Tool
- **NFR-04**：配置热重载（harness\_v6.yaml 修改后无需重启）

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
- **NFR-14**：结构化异常体系——`ProxyError` 携带 `context dict`，包含 trace\_id、tool\_name、原始错误信息

### 4.7 Helm 交互性能与安全

- **NFR-HELM-01**：附件预览 < 200ms，Diff 渲染 < 500ms，Plan 生成 < 5s
- **NFR-HELM-02**：文件上传安全（类型白名单 / 路径防护 / 速率限制 / UUID 重命名）

***

## 第五章：与 ContentForge 的集成方案

### 5.1 集成架构

FlowForge v2.1 作为底层 Harness 引擎，ContentForge 作为上层业务应用。ContentForge 通过以下方式接入：

1. **注册业务 Agent**：ContentForge 的 7 个业务 Agent（TopicAgent、ResearchAgent、WriterAgent 等）继承 FlowForge BaseAgent，注册到 AgentRegistry
2. **配置 Persona**：内容专栏的 SOUL/MEMORY 转换为 `config/persona/{name}.yaml`
3. **定义 SOP**：创作流程映射为 Workflow YAML 模板
4. **注册业务 Tool**：OpenSieveClient、ToutiaoPublisher、WeChatPublisher 等注册到 ToolRegistry
5. **使用 Skill**：创作类 Skill（如 weekly-report、book-essence-extractor）直接注入到 Agent 上下文
6. **启用 Harness**：上下文工程、架构约束、反馈循环、熵管理作为全局配置启用

### 5.2 业务场景映射

| ContentForge 场景 | FlowForge v2.1 对应能力                                 |
| --------------- | --------------------------------------------------- |
| 深度长文创作          | Workflow 模式 + `deep_article` SOP + Reflexion Writer |
| 热点追踪创作          | Multi-Agent (Subagents) + WebSearch Tool            |
| 多平台分发           | Workflow 模式 + `multi_platform` SOP                  |
| SEO 内容生产        | Workflow 模式 + SEOOptimization Agent                 |
| 定时批量创作          | TaskScheduler + Cron 任务                             |
| 人工审核            | Human-in-the-Loop 节点 + Helm 审核块                     |
| 模型故障自愈          | ModelService 健康检查 + 级联修复                            |
| 文档维护            | 文档园丁 Agent + 技术债回收                                  |
| AI 主编实时协作       | Helm 模式 + WebSocket 事件流                             |

### 5.3 迁移路径

| ContentForge 现有模块                 | FlowForge v2.1 对应                                | 迁移策略                                                     |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `brain/orchestrator.py`           | `engine/hybrid_executor.py`                      | **包装**：保留 Persona 锁、Helm 回调，核心执行委托                       |
| `workers/`                        | `agents/content/`                                | **继承**：改继承 FlowForge BaseAgent，使用 `execute_with_context` |
| `tools/registry.py`               | `tools/registry.py`                              | **委托**：包装 FlowForge ToolRegistry                         |
| `tools/llm/client.py`             | `tools/builtin/llm_client.py`                    | **替换**                                                   |
| `core/interfaces/helm_emitter.py` | `events/event_bus.py` + `events/helm_adapter.py` | **桥接**                                                   |
| `brain/scheduler.py`              | `scheduler/scheduler.py`                         | **替换**                                                   |
| `config/persona/*.yaml`           | `config/persona/*.yaml`                          | **保留**                                                   |

### 5.4 增量三步迁移策略

| 步骤         | 内容                                          | 新增目录                                     | 修改文件                                         | 回归测试                 |
| ---------- | ------------------------------------------- | ---------------------------------------- | -------------------------------------------- | -------------------- |
| **Step 1** | 新增 harness/，灰度开关                            | `harness/`（14个新文件）                       | `HybridExecutor.run()` 增加 Hook 点             | harness 禁用时行为不变      |
| **Step 2** | 重组 tools/agents，import 兼容                   | `tools/builtin/` 等子目录                    | `__init__.py` re-export + DeprecationWarning | 所有现有 Agent/Tool 测试通过 |
| **Step 3** | executor/→engine/，引入 security/observability | `engine/`, `security/`, `observability/` | 删除旧 import 路径                                | 全量回归测试               |

Step 2 的 import 兼容期为 **1 个大版本周期**（v2.1 全周期内保持兼容，v7.0 才删除旧路径），旧 import 路径触发时输出 `DeprecationWarning`。

***

## 第六章：业务场景支撑矩阵

| 业务场景     | 执行模式          | 多Agent策略     | Harness护栏  | Tool依赖                           | Skill           | 交互模式     |
| -------- | ------------- | ------------ | ---------- | -------------------------------- | --------------- | -------- |
| 深度长文创作   | workflow      | subagents    | 反馈循环+熵管理   | opensieve+web\_search             | article-outline | Helm     |
| 快速帖子生成   | rewoo         | -            | 架构约束       | llm+web\_search                  | -               | Standard |
| 热点追踪     | multi\_agent  | subagents    | 上下文工程      | web\_search+opensieve             | trend-analysis  | Standard |
| 多平台分发    | workflow      | -            | 权限管线       | publish\_toutiao+publish\_wechat | -               | Standard |
| SEO内容生产  | plan\_execute | -            | 反馈循环       | opensieve+llm                     | seo-optimizer   | Standard |
| 定时批量创作   | workflow      | -            | 所有         | 全部                               | -               | Cron     |
| AI主编实时协作 | workflow      | agent\_teams | 上下文工程+反馈循环 | 全部                               | 全部              | Helm     |
| 代码审查     | reflexion     | agent\_teams | 架构约束+反馈循环  | git\_ops+llm                     | code-review     | Helm     |
| 文档维护     | plan\_execute | -            | 熵管理        | file\_rw+git\_ops                | doc-gardener    | Cron     |

***

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
    pass_threshold: 0.85
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

| #  | 修复项                | 变更内容                                                                     |
| -- | ------------------ | ------------------------------------------------------------------------ |
| 1  | Compaction 阈值      | 统一为 92%，计算方式：`utilization = total_tokens / model_context_window`，默认 128K |
| 2  | FeedbackLoop 定位    | 明确为内环(Reflexion)+外环(FeedbackLoop)双层架构，串行关系，外环 FAIL 直接降级不回内环              |
| 3  | 增量迁移策略             | 制定三步迁移计划（harness 灰度→tools/agents 重组→engine 迁移），兼容期延至 v7.0                |
| 4  | FR-ENG-06          | 新增轨迹记录与评估管线，降级为轨迹记录，不涉及模型训练，"Reward"改为"质量判定"                             |
| 5  | Skill 加载入口         | 删除 plugins/skills\_loader.py，统一走 skills/registry.py                      |
| 6  | agent\_registry 归属 | 从 core/ 移入 engine/，core/ 只保留纯接口                                          |
| 7  | 依赖提取实现             | 补充 ast 模块解析 + layer\_mapping.yaml 配置化                                    |
| 8  | MCP Broker 索引      | 增加 tool\_name→server\_name 映射，避免每次遍历                                     |
| 9  | OpenHarness 格式     | 删除 SkillFormat.OPENHARNESS，标注为 Roadmap                                   |
| 10 | Skill 匹配评分         | 增加置信度评分 + 上下文增强 + 触发词长度权重                                                |
| 11 | MCP 流式             | 增加 execute\_stream() 方法                                                  |
| 12 | evaluation\_mode   | FeedbackLoop 增加 full/lightweight/skip 三档配置，默认 lightweight                |
| 13 | control\_loop.py   | 删除，由 HarnessOrchestrator（2 个统一入口 pre\_execute/post\_execute）替代           |
| 14 | Hook 点设计           | 从 1 个 pre\_execute 扩展为 2 个统一入口（pre\_execute + post\_execute）             |
| 15 | 熵管理定位              | 明确为内置核心能力，不走插件市场                                                         |
| 16 | 保留对话轮数             | 改为可配置（默认 3，可配置），适应不同模型上下文窗口                                              |

---

# [审核修订 v2.1] 六方联合审核修订增补

> 审核日期：2026-06-15 | 修订版本：v2.1 | 修订依据：6份专家审核意见取并集

## 附录D：用户旅程图 [审核修订 v2.1]

### D.1 核心角色与关键操作节点

| 角色 | 关键操作 | 触发方式 | 期望反馈 |
|------|---------|---------|---------|
| **AI应用开发者** | 创建Agent/Workflow YAML | CLI / Web UI | 编译结果、运行日志、调试信息 |
| **平台管理员** | 配置安全策略/权限规则 | Web UI / YAML | 策略生效确认、审计日志 |
| **业务专家** | 提交创作/开发任务 | Web UI / Helm | 任务进度、质量门结果、审核通知 |
| **AI主编/指挥** | 调度Agent执行 | 自动触发 | 执行状态、异常告警 |

### D.2 EventBus → 前端 WebSocket 推送契约

| 事件 | 触发条件 | 推送目标 | Payload |
|------|---------|---------|---------|
| `task.created` | 任务创建 | 开发者/管理员 | {{task_id, type, status}} |
| `gate.review_ready` | 门禁评分完成 | 审核者 | {{gate_id, scores, verdict}} |
| `gate.human_required` | 门禁需人工确认 | 管理员 | {{gate_id, timeout, escalation}} |
| `iteration.retry_exhausted` | 重试耗尽 | 开发者 | {{task_id, attempts, last_error}} |
| `compaction.completed` | 上下文压缩完成 | 系统 | {{session_id, before_tokens, after_tokens}} |
| `llm.fallback_triggered` | 主模型失败降级 | 管理员 | {{model, fallback_model, error}} |

## 附录E：失败UX设计 [审核修订 v2.1]

### E.1 Reflexion重试耗尽
- **用户看到**：任务状态→"质量未达标"，评分趋势图、失败原因摘要、建议人工介入方向
- **系统行为**：标记 status=partial，触发 task.degrade_to_human 事件
- **降级路径**：自动降级到规则引擎 / 人工审核

### E.2 门禁veto触发
- **用户看到**：门禁详情页，veto维度高亮，可一键"打回重做"或"人工覆盖"
- **系统行为**：记录审计日志，触发 gate.veto_triggered 事件
- **回退策略**：回退到veto维度对应的上游阶段，最多回退3次后升级

### E.3 沙箱执行崩溃
- **用户看到**：错误详情（脱敏后），崩溃时间点，建议修改方向
- **系统行为**：记录崩溃日志，触发 sandbox.crash 事件
- **降级路径**：跳过沙箱执行 → 人工代码审查

### E.4 LLM全部不可用
- **降级决策树**：主模型→fallback模型→规则引擎→人工处理
- **用户看到**：降级通知，预计恢复时间，当前使用策略
- **系统行为**：触发 llm.all_degraded 事件，进入只读模式

## 附录F：用户价值度量(KPI/OKR) [审核修订 v2.1]

| 项目 | 北极星指标 | 健康指标 |
|------|---------|---------|
| FlowForge | 配置驱动率（Agent/Tool/Workflow三大类YAML化率） | 启动时间 < 5s、cold start内存 < 200MB、并发session ≥ 50 |
| DevForge | DCP门禁准确率（与人工评审的一致性） | 端到端发布时长 < 30min、hotfix修复时长 < 15min、自动回滚成功率 ≥ 95% |
| ContentForge | SOP完成率（深度长文从选题到发布一次通过率） | 平均审核次数 < 2、单篇发布耗时 < 10min、平台适配成功率 ≥ 90% |
| NovelForge | 章节一致性得分 ≥ 0.8 | 单章节生成耗时 < 60s、Reflexion收敛轮数 < 3 |

## 附录G：PromptManager统一协议 [审核修订 v2.1]

### G.1 设计目标
解决三个项目共115处硬编码提示词（FlowForge 77 + ContentForge 24 + NovelForge 14）。

### G.2 YAML Schema

```yaml
# config/prompts.yaml
prompts:
  agent.topic.search:
    template: |
      你是一个选题策略专家，请基于以下信息生成选题...
      专栏领域：{{{{ domain }}}}
      热点数据：{{{{ hot_topics }}}}
    variables: [domain, hot_topics]
    output_schema: "topic_search.v1"
    max_tokens: 2048
    version: "1.0"
    tags: [contentforge, topic]
```

### G.3 核心能力
1. **加载优先级**：YAML > _DEFAULT_PROMPTS > 代码硬编码
2. **热加载**：修改prompts.yaml无需重启，5秒内生效
3. **版本管理**：每个prompt有version字段，支持A/B测试
4. **缓存策略**：LRU缓存，避免每次从磁盘读取
5. **变量插值**：Jinja2模板引擎，支持 {{{{ variable }}}} 语法
6. **Token审计**：构建完成后打印persona token占比（<15%为健康）

### G.4 迁移策略
1. 统一删除 _DEFAULT_PROMPTS 字典
2. 代码通过 prompt_manager.get_prompt(key, **kwargs) 加载
3. 合并重复定义（同一提示词在3个文件中重复硬编码→合并为1个YAML key）
4. 按Agent/模块维度分批外置，每批完成后用自动化脚本验证

## 附录H：Provider规格与配额管理 [审核修订 v2.1]

### H.1 models.yaml完整规格Schema

```yaml
providers:
  openroute:
    base_url: "https://openrouter.ai/api/v1"
    api_key: "${{OPENROUTER_API_KEY}}"

models:
  doubao-seed2:
    provider: openroute
    model_id: "doubao-seed-2.0"
    max_tokens: 8192
    temperature: 0.7
    top_p: 0.95
    json_schema_supported: true
    parallel_tool_calls: true
    seed: 42
    safety_threshold: "medium"
    cost_per_1k_input_tokens: 0.002
    cost_per_1k_output_tokens: 0.006
    tpm_quota: 100000
    rpm_quota: 1000
    fallback_chain: ["qwen3.6-plus", "deepseek-chat"]
```

### H.2 ProviderQuotaManager

```python
class ProviderQuotaManager:
    # Provider级TPM/RPM/成本配额管理
    def __init__(self, config):
        self._quotas = {}  # model -> QuotaState

    async def check_quota(self, model, token_count):
        # 检查是否在配额内
        pass

    async def record_usage(self, model, prompt_tokens, completion_tokens):
        # 记录使用量
        pass

    def get_budget_status(self, project):
        # 获取项目预算状态
        pass
```

### H.3 多模型级联策略

```yaml
# config/llm_route.yaml
primary_chain:
  - doubao-seed2.0
  - qwen3.6-plus
  - deepseek-chat
failover:
  condition: "status_code == 429 or timeout > 30s or moderation_rejected"
  next: chain[index + 1]
default_agent_override:
  fact_check_agent: [doubao-seed2.0, gpt-4o-mini]
  novel_concept_agent: [doubao-seed2.0]
```

## 附录I：BaseTool Function Call Schema [审核修订 v2.1]

### I.1 新增接口

```python
class BaseTool(ABC):
    name: str
    description: str
    # [审核修订 v2.1] 新增
    parameters_schema: Dict[str, Any]  # JSON Schema格式
    safety_level: str = "safe"  # safe/moderate/dangerous/critical

    def to_function_call(self) -> Dict[str, Any]:
        return {{
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters_schema
        }}
```

### I.2 HarnessOrchestrator集成
在 pre_execute 中自动将visible tools注入LLM对话上下文。

## 附录J：可观测性设计 [审核修订 v2.1]

### J.1 Trace链路
- 每个Agent调用前注入 trace_id（UUID v7，时间排序）
- 全链路传播：trace_id → session_id → task_id → step_id
- 结构化日志：JSON格式，PII脱敏，trace_id关联

### J.2 LLM调用事件

```python
@dataclass
class LLMCallEvent:
    model: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: float
    is_fallback: bool
    fallback_chain_index: int
    error_code: Optional[str]
```

### J.3 开箱即用Grafana仪表盘

| 仪表盘 | 核心指标 |
|--------|---------|
| FlowForge健康度 | session数、compaction频率、EventStore写入延迟 |
| DevForge门禁通过率 | DCP/TR通过率、人工干预率、平均门禁耗时 |
| ContentForge发布成功率 | 平台适配成功率、发布耗时、CircuitBreaker触发次数 |
| NovelForge一致性得分 | 章节一致性趋势、伏笔回收率、Reflexion收敛轮数 |

## 附录K：跨项目契约统一 [审核修订 v2.1]

### K.1 变量引用语法统一
统一为 LangGraph 风格：
- `${{state.xxx}}` — 引用TaskContext.state中的值
- `${{params.xxx}}` — 引用任务输入参数
- `${{result.xxx}}` — 引用上一步骤输出
- `${{outputs.xxx.yyy}}` — 引用指定步骤的输出字段

### K.2 Agent命名空间
格式：`项目前缀:agent名`，如 `contentforge:topic`、`novelforge:outline`、`devforge:coder`

### K.3 状态输出统一
统一为 `state_updates: {{key: expression}}` 一种语法

### K.4 执行策略统一

```yaml
execution_policy:
  timeout: 300
  retry: {{max_attempts: 3, strategy: "exponential_backoff"}}
  on_error: "abort"  # abort / retry / degrade_to_human
  on_anomaly: "escalate"
```

### K.5 检查点统一

```yaml
checkpoint:
  enabled: true
  backend: "sqlite"
  path: "${{FLOWFORGE_DATA_DIR}}/checkpoints"
  every_n_steps: 5
```

## 附录L：配置驱动率度量标准 [审核修订 v2.1]

### L.1 计算公式

```
配置驱动率 = (通过YAML配置的行为数) / (总行为数)
行为数 = Agent定义数 + Tool定义数 + Workflow步骤数 + Prompt模板数 + 阈值/规则数
```

### L.2 各Phase里程碑

| Phase | Agent驱动率 | Tool驱动率 | Workflow驱动率 | Prompt驱动率 |
|-------|-----------|-----------|--------------|------------|
| 当前 | 0% | 0% | 17% | 0% |
| Phase 0 完成 | ≥40% | ≥30% | ≥60% | ≥50% |
| Phase 1 完成 | ≥70% | ≥50% | ≥80% | ≥80% |
| Phase 2 完成 | ≥90% | ≥70% | ≥95% | ≥95% |
| Phase 3 完成 | ≥95% | ≥80% | ≥98% | ≥98% |

## 附录M：性能基线SLO [审核修订 v2.1]

| 组件 | 指标 | 目标 |
|------|------|------|
| WorkflowCompiler.compile() | 100 step编译耗时 | < 50ms |
| SessionManager.check_and_compact() | 1MB上下文压缩耗时 | < 500ms |
| FiberSet.parallel(10 workers) | 调度延迟 | < 10ms |
| EventStore.append() | SQLite WAL模式 | < 5ms |
| PersonaInjector.inject() | 包含5个Source resolve | < 30ms |
| LoopExecutor单次迭代 | 端到端（含1次LLM） | < 30s |
| DualThresholdCompactor | LLM摘要 | < 10s |
| MultiJudgeVerifier | 3个评委并行 | < 15s |

## 附录N：弃用时间线 [审核修订 v2.1]

- DeprecationWarning保留期限：**3个minor版本**或**6个月**，以先到者为准
- 在 pyproject.toml 中通过 tools.deprecated 配置表管理
- 删除前必须用 git grep 全量搜索引用，确保0引用
- 每批删除后跑 pytest --collect-only + E2E骨架测试

---

# [审核修订 v2.2] 六方联合审核修订增补（v2.1未覆盖项）

> 审核日期：2026-06-16 | 修订版本：v2.2 | 来源：6份专家审核意见并集，v2.1未覆盖部分

## 一、向后兼容切换策略 [来源：审核FWK-01/FWK-06/INF-01]

每个设计项需补充新旧路径切换策略，明确迁移完成后的旧代码删除时间线和验收标准。

### 1.1 切换策略分类

| 策略 | 适用场景 | 风险等级 | 切换机制 |
|------|---------|---------|---------|
| Feature Flag | 核心运行时路径（WorkflowCompiler、LLMRouter、TurnTransition） | 高 | `config/system.yaml` 中 `features.use_new_xxx: true/false`，默认false |
| A-B并行验证 | 数据产出路径（EventStore、Compaction、PersonaInjector） | 中 | 新旧路径同时运行，对比输出一致性≥99.5%后切换 |
| 硬切换 | 纯内部重构（Repository层、Config外置、DI容器升级） | 低 | 直接替换，单PR完成 |

### 1.2 各设计项切换策略

| 设计项 | 切换策略 | Feature Flag名 | 旧代码删除时间线 | 验收标准 |
|--------|---------|---------------|----------------|---------|
| FWK-01 WorkflowCompiler | Feature Flag | `features.use_workflow_compiler` | Flag开启后2个minor版本（3个月） | dev_hotfix.yaml + dev_greenfield.yaml跑通 |
| FWK-06 TurnTransitionEngine | Feature Flag | `features.use_turn_transition_v2` | Flag开启后1个minor版本（6周） | 9状态覆盖原6+7状态所有场景 |
| INF-01 LLMRouter | A-B并行验证 | `features.use_llm_router` | 并行验证通过后1个minor版本 | 相同请求路由结果一致率≥99.5% |
| INF-02 EventStore | A-B并行验证 | `features.use_event_store` | 并行验证通过后1个minor版本 | 事件写入/读取一致性100% |
| INF-05 Compaction | Feature Flag | `features.use_dual_threshold_compactor` | Flag开启后1个minor版本 | 压缩后上下文可用性≥95% |
| INF-11 Repository层 | 硬切换 | N/A | 单PR合入后立即删除 | 所有SQL操作通过Repository |
| INF-12 配置外置 | 硬切换 | N/A | 单PR合入后立即删除 | 0处硬编码路径/密钥 |

### 1.3 Feature Flag数据结构

```python
@dataclass
class FeatureFlag:
    name: str
    enabled: bool
    rollout_percentage: int = 0  # 0-100，支持灰度
    allowed_projects: List[str] = field(default_factory=list)  # 空=全部
    fallback_to_old: bool = True  # 新路径异常时是否回退旧路径
    created_at: datetime = field(default_factory=datetime.now)
    expires_at: Optional[datetime] = None  # Flag过期时间，到期强制切换
```

### 1.4 旧代码删除验收流程

```
1. git grep 搜索旧代码所有引用 → 0引用
2. pytest --collect-only 确认无测试依赖旧路径
3. 运行全量E2E测试（含HTTP Cassette录制回放）
4. 删除旧代码 + 删除Feature Flag
5. 再次全量回归验证
```

## 二、Gate/Quality Gate术语统一 [来源：审核FWK-01/CAP-14]

### 2.1 问题
当前FlowForge用"Gate"、DevForge用"QualityGate"、NovelForge用"门禁"，术语不统一导致跨项目协作混乱。

### 2.2 统一方案

FlowForge提供通用Gate抽象，三个项目统一使用：

```python
class BaseGate(ABC):
    """通用门禁抽象基类"""
    gate_id: str
    gate_type: Literal["quality", "safety", "compliance", "performance"]
    threshold: float  # 0.0-1.0
    evaluator: BaseEvaluator

    @abstractmethod
    async def evaluate(self, context: TaskContext) -> GateVerdict: ...

@dataclass
class GateVerdict:
    gate_id: str
    passed: bool
    score: float  # 0.0-1.0
    reason: str
    details: Dict[str, Any]
    evaluated_at: datetime
```

### 2.3 术语映射

| 项目 | 原术语 | 统一术语 | 迁移方式 |
|------|--------|---------|---------|
| FlowForge | Gate | Gate | 无需迁移 |
| DevForge | QualityGate / DCP / TR | Gate(gate_type="quality") | Phase 1迁移 |
| NovelForge | 门禁 / QualityGate | Gate(gate_type="quality") | Phase 1迁移 |
| ContentForge | 审核 | Gate(gate_type="compliance") | Phase 1迁移 |

## 三、灾备与降级设计 [来源：审核INF-01/INF-02/CAP-02]

### 3.1 降级决策树

每个Phase 1核心功能配降级决策树：

```python
class DegradationDecisionTree:
    """通用降级决策树"""

    @staticmethod
    async def decide(component: str, error: Exception) -> DegradationAction:
        if isinstance(error, (LLMTimeoutError, LLMRateLimitError)):
            # LLM不可用 → 降级到备选模型或人工
            if await LLMRouter.has_fallback(component):
                return DegradationAction.SWITCH_PROVIDER
            return DegradationAction.DEGRADE_TO_HUMAN

        if isinstance(error, (StorageError, DatabaseCorruptError)):
            # 存储不可用 → 降级到内存模式
            return DegradationAction.USE_MEMORY_FALLBACK

        if isinstance(error, WorkflowCompileError):
            # Workflow编译失败 → 降级到硬编码SOP
            return DegradationAction.USE_HARDCODED_SOP

        if isinstance(error, ToolExecutionError):
            # 工具执行失败 → 降级到替代工具或跳过
            if await ToolRegistry.has_alternative(component):
                return DegradationAction.USE_ALTERNATIVE_TOOL
            return DegradationAction.SKIP_AND_LOG

        return DegradationAction.ABORT

@dataclass
class DegradationAction:
    action_type: Literal[
        "switch_provider", "degrade_to_human",
        "use_memory_fallback", "use_hardcoded_sop",
        "use_alternative_tool", "skip_and_log", "abort"
    ]
    target: Optional[str] = None
    reason: str = ""
```

### 3.2 task.degrade_to_human事件契约

```python
@dataclass
class DegradeToHumanEvent:
    """降级到人工事件"""
    task_id: str
    component: str  # 触发降级的组件
    original_error: str
    degradation_reason: str
    context_snapshot: Dict[str, Any]  # 当前任务状态快照
    suggested_action: str  # 建议人工操作
    urgency: Literal["low", "medium", "high", "critical"]
    created_at: datetime

    def to_event(self) -> SessionEvent:
        return SessionEvent(
            event_type="task.degrade_to_human",
            data=self.model_dump(),
            metadata={"requires_notification": True}
        )
```

### 3.3 各组件降级矩阵

| 组件 | 降级策略 | 降级触发条件 | 恢复条件 |
|------|---------|------------|---------|
| LLMRouter | 切换到备选Provider | 主Provider连续3次超时 | 主Provider健康检查通过 |
| EventStore | 内存List暂存+定期flush | SQLite写入失败3次 | SQLite恢复写入 |
| WorkflowCompiler | 使用硬编码SOP | YAML编译失败 | YAML修复后重新编译 |
| PersonaInjector | 使用默认Persona | Persona文件损坏/缺失 | Persona文件修复 |
| Compaction | 丢弃最旧消息 | LLM摘要失败 | LLM恢复可用 |
| Gate评估 | fail-open（放行+告警） | 评估超时10s | 评估服务恢复 |

## 四、测试策略设计 [来源：审核FWK-01/INF-01/CAP-14]

### 4.1 测试套件规划

```
tests/
├── config/
│   ├── test_workflow_yaml_validation.py    # YAML Schema校验
│   ├── test_persona_yaml_validation.py     # Persona格式校验
│   ├── test_model_routes_yaml.py           # 模型路由配置校验
│   └── test_system_yaml_defaults.py        # 系统配置默认值校验
├── integration/
│   ├── test_workflow_e2e.py                # Workflow端到端
│   ├── test_llm_router_e2e.py              # LLM路由端到端
│   ├── test_event_store_e2e.py             # EventStore端到端
│   ├── test_gate_e2e.py                    # Gate评估端到端
│   ├── test_doubao_stream.py               # SSE流式输出一致性
│   └── test_degradation_e2e.py             # 降级链路端到端
├── cassettes/                              # HTTP Cassette录制目录
│   ├── doubao_chat_response.yaml
│   ├── opensieve_search_response.yaml
│   └── qwen_fallback_response.yaml
└── unit/                                   # 现有单元测试
```

### 4.2 HTTP Cassette录制策略

使用 `pytest-recording` (VCR.py) 录制真实LLM/OpenSieve响应：

```python
# conftest.py
import pytest

@pytest.fixture
def vcr_config():
    return {
        "cassette_library_dir": "tests/cassettes",
        "record_mode": "once",  # 首次录制，后续回放
        "filter_headers": ["authorization"],  # 脱敏
        "decode_compressed_response": True,
    }

# test_llm_router_e2e.py
@pytest.mark.vcr
async def test_llm_router_primary_fallback():
    """测试LLM路由主备切换"""
    router = LLMRouter(config=load_config())
    result = await router.chat(
        model="doubao-seed2",
        messages=[{"role": "user", "content": "请分析以下技术方案的可行性"}],
    )
    assert result.provider in ["doubao", "qwen", "deepseek"]
    assert result.content  # 非空响应
```

### 4.3 删除代码回归测试策略

```python
# tests/integration/test_code_removal_regression.py
async def test_old_orchestrator_removed():
    """验证旧Orchestrator代码已完全删除且功能由WorkflowCompiler替代"""
    # 1. 确认旧模块不存在
    with pytest.raises(ImportError):
        from flowforge.workers.orchestrator import Orchestrator

    # 2. 确认新路径可用
    from flowforge.core.workflow import WorkflowCompiler
    compiler = WorkflowCompiler()
    workflow = compiler.compile(load_yaml("dev_hotfix.yaml"))
    assert len(workflow.steps) > 0

    # 3. 回放Cassette验证功能等价
    # (使用录制的真实LLM响应，避免每次调用)
```

## 五、CI/CD和部署方案 [来源：审核INF-02/INF-12]

### 5.1 Docker Compose开发环境

```yaml
# docker-compose.dev.yml
version: "3.8"
services:
  flowforge-api:
    build: .
    ports: ["8000:8000"]
    environment:
      - FLOWFORGE_DATA_DIR=/data
      - FLOWFORGE_MASTER_KEY=${FLOWFORGE_MASTER_KEY}
    volumes:
      - ./data:/data
      - ./config:/app/config
    healthcheck:
      test: ["CMD", "python", "-c", "import httpx; httpx.get('http://localhost:8000/health')"]
      interval: 30s
      timeout: 10s
      retries: 3

  flowforge-web:
    build: ./web
    ports: ["5174:5174"]
    environment:
      - VITE_API_URL=http://flowforge-api:8000
    depends_on:
      flowforge-api:
        condition: service_healthy
```

### 5.2 K8s生产部署

```yaml
# k8s/flowforge-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flowforge-api
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    spec:
      containers:
      - name: api
        image: flowforge-api:latest
        readinessProbe:
          httpGet: { path: /health, port: 8000 }
          periodSeconds: 10
        livenessProbe:
          httpGet: { path: /health, port: 8000 }
          periodSeconds: 30
        resources:
          requests: { cpu: "500m", memory: "512Mi" }
          limits: { cpu: "2000m", memory: "2Gi" }
        env:
        - name: FLOWFORGE_MASTER_KEY
          valueFrom:
            secretKeyRef:
              name: flowforge-secrets
              key: master-key
```

### 5.3 CI流水线

```yaml
# .github/workflows/ci.yml
name: FlowForge CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -e ".[dev]"
      - run: ruff check flowforge/
      - run: mypy flowforge/ --ignore-missing-imports
      - run: pytest tests/unit/ -x
      - run: pytest tests/integration/ --vcr-record=none  # 仅回放，不录制
  e2e:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - run: docker compose -f docker-compose.dev.yml up -d --wait
      - run: pytest tests/integration/ --vcr-record=once  # 首次录制
```

## 六、API版本管理和兼容性设计 [来源：审核FWK-01/INF-01]

### 6.1 API版本策略

```python
# FlowForge API版本管理
API_VERSION_CURRENT = "v1"
API_VERSIONS_SUPPORTED = ["v1"]

# 路由前缀：/api/{version}/...
app = FastAPI(
    title="FlowForge API",
    version=API_VERSION_CURRENT,
)

# 版本兼容性保障
@dataclass
class APICompatibilityGuarantee:
    """API兼容性保障契约"""
    version: str
    breaking_changes: List[str]  # 必须为空才能发布
    deprecated_endpoints: List[str]  # 弃用端点列表
    deprecation_notice_version: str  # 弃用通知版本
    removal_version: str  # 计划移除版本
```

### 6.2 *Forge项目兼容性保障

```python
# FlowForge SDK客户端兼容性检查
class FlowForgeClient:
    def __init__(self, base_url: str, api_version: str = "v1"):
        self.base_url = base_url
        self.api_version = api_version
        self._compatibility_checked = False

    async def _check_compatibility(self):
        """启动时检查API兼容性"""
        server_info = await self._get("/health")
        server_version = server_info.get("api_version", "v1")
        if server_version != self.api_version:
            raise APIVersionMismatchError(
                f"Client expects v{self.api_version}, "
                f"server provides v{server_version}"
            )
        self._compatibility_checked = True
```

### 6.3 版本升级兼容性矩阵

| FlowForge API版本 | ContentForge兼容 | DevForge兼容 | NovelForge兼容 | MallForge兼容 |
|------------------|-----------------|-------------|---------------|--------------|
| v1.0 | ✅ | ✅ | ✅ | ✅ |
| v1.1 (新增端点) | ✅ 向后兼容 | ✅ 向后兼容 | ✅ 向后兼容 | ✅ 向后兼容 |
| v2.0 (Breaking) | 需适配 | 需适配 | 需适配 | 需适配 |

## 七、Helm可视化体验设计 [来源：审核ECO-07]

### 7.1 UI交互设计细节

```
┌─────────────────────────────────────────────────────┐
│ FlowForge Helm                              [⚙️][👤] │
├──────────┬──────────────────────────────────────────┤
│ 工作区    │  📋 任务列表          │  💬 对话面板      │
│ ─────── │ ──────────────────  │ ──────────────  │
│ 📁 Dev  │  ▶ T-001 热修复     │  [Agent] 正在   │
│ 📁 Cnt  │  ■ T-002 代码审查   │   编译workflow  │
│ 📁 Nov  │  ✓ T-003 单元测试   │  [Tool] 调用    │
│         │                     │   LLMRouter     │
│ ─────── │  进度: ████████░░ 80%│  [Gate] DCP通过 │
│ + 新建   │                     │                 │
├──────────┴──────────────────────────────────────────┤
│ 🔧 工具调用链 │ 📊 指标 │ 📝 日志                    │
└─────────────────────────────────────────────────────┘
```

### 7.2 关键交互规范

| 交互元素 | 规范 | 实现要点 |
|---------|------|---------|
| 工作区切换 | 左侧面板，点击即切换，任务列表联动过滤 | WebSocket推送工作区状态 |
| 步骤进度条 | 每个步骤显示状态图标（▶运行/■暂停/✓完成/✗失败） | SSE实时更新 |
| 工具调用链 | 底部面板，折叠式展示每次Tool调用 | 记录input/output/latency |
| Agent节点图标 | workflow🧩/agent🤖/llm💬/tool🔧 | 根据event_type自动匹配 |
| 长任务防卡死 | 虚拟滚动 + 分页加载（每页50条） | IntersectionObserver |

## 八、用户引导路径 [来源：审核ECO-07/CAP-02]

### 8.1 新手引导流程

```
首次登录 → 选择项目模板（Dev/Content/Novel/Mall）
         → 一键部署示例Workflow
         → 引导式创建第一个任务
         → 实时查看执行过程
         → 查看结果与指标
```

### 8.2 模板市场设计

```yaml
# templates/index.yaml
templates:
  - id: "dev-hotfix"
    name: "热修复工作流"
    project: "devforge"
    description: "从Bug报告到修复提交的完整流程"
    workflow_file: "dev_hotfix.yaml"
    persona: "devforge:coder"
    estimated_time: "5-10min"

  - id: "content-article"
    name: "文章创作工作流"
    project: "contentforge"
    description: "从选题到发布的完整创作流程"
    workflow_file: "content_article.yaml"
    persona: "contentforge:writer"
    estimated_time: "10-15min"
```

### 8.3 一键部署

```python
class TemplateDeployer:
    """模板一键部署"""

    async def deploy(self, template_id: str, project: str) -> DeployResult:
        template = await self.template_store.get(template_id)
        # 1. 加载Workflow YAML
        workflow = self.compiler.compile(template.workflow_file)
        # 2. 注册Persona
        await self.persona_manager.register(template.persona)
        # 3. 创建示例任务
        task = await self.task_manager.create(
            project=project,
            workflow=workflow,
            input=template.sample_input,
        )
        return DeployResult(task_id=task.id, status="ready")
```

## 九、Agent开发DX设计 [来源：审核ECO-07]

### 9.1 本地调试Agent

```bash
# CLI调试命令
flowforge agent debug \
  --agent devforge:coder \
  --input '{"task": "修复登录页面CSS错位"}' \
  --trace-dir ./traces \
  --step  # 单步模式，每步暂停等待确认
```

### 9.2 执行轨迹查看

```python
# traces/2026-06-16_task-001.json
{
  "trace_id": "0192a3b4-c5d6-7e8f-9a0b-1c2d3e4f5a6b",
  "task_id": "task-001",
  "steps": [
    {
      "step_id": "step-1",
      "agent": "devforge:coder",
      "action": "llm_call",
      "input": {"model": "doubao-seed2", "messages": [...]},
      "output": {"content": "...", "tokens": 1500},
      "latency_ms": 3200,
      "gate_verdict": null
    },
    {
      "step_id": "step-2",
      "agent": "devforge:coder",
      "action": "tool_call",
      "tool": "file_write",
      "input": {"path": "src/login.css", "content": "..."},
      "output": {"success": true},
      "latency_ms": 50,
      "gate_verdict": {"gate_id": "dcp", "passed": true, "score": 0.92}
    }
  ]
}
```

### 9.3 VS Code扩展集成

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug FlowForge Agent",
      "type": "python",
      "request": "launch",
      "module": "flowforge.cli",
      "args": ["agent", "debug", "--agent", "${input:agentName}", "--step"],
      "env": {
        "FLOWFORGE_TRACE_DIR": "${workspaceFolder}/traces"
      }
    }
  ]
}
```

## 十、密钥迁移Runbook [来源：审核INF-12/CAP-02]

### 10.1 CredentialStore迁移计划

```python
# 旧方式：SecretStore（路径硬编码）
# 新方式：CredentialStore（FLOWFORGE_MASTER_KEY加密）

class CredentialMigrationRunbook:
    """密钥迁移Runbook"""

    @staticmethod
    async def migrate():
        # Step 1: 检查环境变量
        master_key = os.environ.get("FLOWFORGE_MASTER_KEY")
        if not master_key:
            raise RuntimeError(
                "FLOWFORGE_MASTER_KEY环境变量未设置！"
                "请执行: export FLOWFORGE_MASTER_KEY=$(openssl rand -hex 32)"
            )

        # Step 2: 初始化新CredentialStore
        new_store = CredentialStore(master_key=master_key)

        # Step 3: 读取旧SecretStore中的所有密钥
        old_store = SecretStore()  # 旧实现
        for key_name in old_store.list_keys():
            value = old_store.get(key_name)
            await new_store.set(key_name, value)
            print(f"✅ 迁移密钥: {key_name}")

        # Step 4: 验证迁移完整性
        for key_name in old_store.list_keys():
            old_value = old_store.get(key_name)
            new_value = await new_store.get(key_name)
            assert old_value == new_value, f"密钥 {key_name} 迁移后不一致！"

        # Step 5: 备份旧存储
        old_store.backup(path="backups/secret_store_pre_migration.json")

        # Step 6: 更新配置引用
        # config/system.yaml: credential_store.backend: "encrypted" (原 "file")
```

### 10.2 FLOWFORGE_MASTER_KEY管理

```yaml
# config/system.yaml 新增
credential_store:
  backend: "encrypted"  # encrypted | file | env
  master_key_env: "FLOWFORGE_MASTER_KEY"
  encryption_algorithm: "aes-256-gcm"
  key_rotation_days: 90
  backup_path: "${FLOWFORGE_DATA_DIR}/backups/credentials"
```

## 十一、SSE流式输出一致性测试 [来源：审核NEW-DB-09]

### 11.1 test_doubao_stream.py

```python
# tests/integration/test_doubao_stream.py
import pytest
from flowforge.tools.llm import LLMClient

@pytest.mark.vcr
async def test_doubao_sse_format_consistency():
    """验证Doubao SSE响应格式与OpenAI兼容"""
    client = LLMClient(provider="doubao")

    # 测试1: 流式响应格式
    chunks = []
    async for chunk in client.chat_stream(
        model="doubao-seed2",
        messages=[{"role": "user", "content": "请用三句话描述微服务架构的优势"}],
    ):
        chunks.append(chunk)
        # 每个chunk必须包含delta
        assert hasattr(chunk, "choices")
        assert len(chunk.choices) > 0
        assert hasattr(chunk.choices[0], "delta")

    # 测试2: 完整响应与流式拼接一致
    full_response = await client.chat(
        model="doubao-seed2",
        messages=[{"role": "user", "content": "请用三句话描述微服务架构的优势"}],
    )
    streamed_content = "".join(
        c.choices[0].delta.content or "" for c in chunks
    )
    assert streamed_content == full_response.content, (
        "流式拼接内容与完整响应不一致"
    )

@pytest.mark.vcr
async def test_doubao_sse_error_handling():
    """验证SSE错误事件处理"""
    client = LLMClient(provider="doubao")
    with pytest.raises(LLMRateLimitError):
        async for _ in client.chat_stream(
            model="doubao-seed2",
            messages=[{"role": "user", "content": "test"}] * 100,  # 触发限流
        ):
            pass
```

## 十二、中文格式规范检查 [来源：审核NEW-DB-08]

### 12.1 ChineseFormatChecker

```python
class ChineseFormatChecker:
    """中文格式规范检查器，注入到Persona指令中"""

    RULES = {
        "punctuation": {
            "description": "中文语境使用中文标点",
            "pattern": r'[\u4e00-\u9fff]\s*[,.!?;:]\s*[\u4e00-\u9fff]',
            "replacement": "中文标点（，。！？；：）",
        },
        "numbering": {
            "description": "编号格式统一",
            "pattern": r'第\s*(\d+)\s*章',
            "replacement": "第X章（无空格）",
        },
        "date_format": {
            "description": "日期格式统一",
            "pattern": r'\d{4}/\d{1,2}/\d{1,2}',
            "replacement": "YYYY年MM月DD日",
        },
        "unit_spacing": {
            "description": "数字与单位间无空格",
            "pattern": r'\d+\s*(个|次|篇|章|节|条|项|款|种|类|份|期|轮|遍|套|组|批|段|步|层|级|类|种)',
            "replacement": "数字与中文单位间无空格",
        },
    }

    def check(self, text: str) -> List[FormatViolation]:
        violations = []
        for rule_name, rule in self.RULES.items():
            matches = re.findall(rule["pattern"], text)
            if matches:
                violations.append(FormatViolation(
                    rule=rule_name,
                    description=rule["description"],
                    expected=rule["replacement"],
                    found=matches,
                ))
        return violations
```

### 12.2 Persona注入指令段

```yaml
# persona/base.yaml 新增段
format_guidelines: |
  【中文格式规范】
  1. 中文语境使用中文标点（，。！？；：""''），英文语境使用英文标点
  2. 编号格式：第一章、第二章（无空格），1.1、1.2（半角点+数字）
  3. 日期格式：2026年6月16日，不使用2026/06/16
  4. 数字与中文单位间无空格：3篇文章，不是3 篇文章
  5. 中英文之间加空格：使用 Python 开发，不是使用Python开发
```

## 十三、多模态接入规范 [来源：审核NEW-DB-10]

### 13.1 MultiModalProvider

```python
class MultiModalProvider:
    """多模态接入规范"""

    SUPPORTED_MODALITIES = ["text", "image", "audio", "video"]

    async def generate(
        self,
        modality: str,
        prompt: str,
        model: str = "doubao-seed2-vision",
        **kwargs,
    ) -> MultiModalResult:
        if modality == "image":
            return await self._generate_image(prompt, model, **kwargs)
        elif modality == "text":
            return await self._generate_text(prompt, model, **kwargs)
        else:
            raise UnsupportedModalityError(modality)

@dataclass
class MultiModalResult:
    modality: str
    content: Union[str, bytes]
    mime_type: str
    metadata: Dict[str, Any]
    provider: str
    model: str
```

### 13.2 Doubao多模态接入矩阵

| 模态 | 模型 | 用途 | 项目 | Phase |
|------|------|------|------|-------|
| 文本 | doubao-seed2 | 文章/代码/对话 | 全部 | Phase 0 |
| 图像理解 | doubao-seed2-vision | 封面图审核/素材分析 | Content/Novel | Phase 3 |
| 图像生成 | doubao-seed2-image | 封面图/插画/角色头像 | Content/Novel | Phase 3 |
| 音频 | - | 语音播报 | Content | Phase 4+ |

## 十四、Agent模式与Doubao能力矩阵 [来源：审核NEW-DB-11]

### 14.1 ModeDoubaoCompatibility

```python
@dataclass
class ModeDoubaoCompatibility:
    """Agent模式与Doubao能力矩阵"""
    agent_id: str
    mode: str  # open_code / workflow / sop / interactive
    recommended_model: str
    fallback_model: str
    compatibility_score: float  # 0.0-1.0
    notes: str
```

### 14.2 能力矩阵

| Agent | 模式 | 推荐模型 | 备选模型 | 兼容度 | 备注 |
|-------|------|---------|---------|--------|------|
| devforge:coder | open_code | doubao-seed2 | deepseek-coder | 0.85 | 代码补全优秀，长上下文需分段 |
| devforge:reviewer | workflow | doubao-seed2 | qwen-plus | 0.90 | 代码审查稳定 |
| contentforge:topic | sop | doubao-seed2 | qwen-plus | 0.88 | 选题分析准确 |
| contentforge:writer | sop | doubao-seed2 | qwen-plus | 0.82 | 长文需分段+续写 |
| novelforge:outline | workflow | doubao-seed2 | qwen-plus | 0.85 | 大纲生成稳定 |
| novelforge:chapter | sop | doubao-seed2 | qwen-plus | 0.78 | 长章节需checkpoint续写 |

---

# [审核修订 v3.0] 六方联合审核修订增补（v2.1/v2.2未覆盖项）

> 审核日期：2026-06-16 | 修订版本：v3.0 | 来源：6份专家审核意见并集，v2.1/v2.2未覆盖部分
> 审核来源：review_landing_design.md / review_landing_design_deepseek.md / review_landing_design_doubao.md / review_landing_design_kimi.md / review_landing_design_mm.md / review_landing_design_qw.md

## S3.0-1 用户故事地图与端到端用户旅程 [来源：审核mm-P0]

### 问题描述
四份landing_design.md通篇只讲架构、不讲用户。缺少用户故事地图，无法回答"谁提交任务""门禁人工确认如何触发""DCP被驳回时PM在哪个页面看到"等核心产品问题。

### 修订方案
每个项目landing_design.md顶部新增"用户旅程图"章节，含3-5个核心角色+关键操作节点。

```yaml
# 用户旅程规范
user_journeys:
  - role: "PM"
    journey:
      - action: "提交开发任务"
        entry: "Helm任务创建页"
        events: ["task.created"]
      - action: "查看门禁评审结果"
        entry: "Helm任务详情→Gate面板"
        events: ["gate.review_ready", "gate.human_required"]
      - action: "驳回后修改需求"
        entry: "Helm审核中心"
        events: ["gate.rejected", "task.retry_requested"]
  - role: "开发者"
    journey:
      - action: "查看代码审查结果"
        entry: "Helm→工具调用链面板"
        events: ["tool.code_review.completed"]
      - action: "沙箱执行代码"
        entry: "Helm→执行输出面板"
        events: ["tool.sandbox.completed"]
  - role: "运维"
    journey:
      - action: "金丝雀发布审批"
        entry: "Helm→发布面板"
        events: ["canary.approval_required"]
      - action: "回滚决策"
        entry: "Helm→发布面板→回滚按钮"
        events: ["canary.rollback_triggered"]
```

### 优先级
P0

## S3.0-2 失败UX设计 [来源：审核mm-P0]

### 问题描述
所有landing_design.md只画PASS路径，完全缺少FAIL路径。Reflexion重试耗尽后用户看到什么？门禁被veto_dimensions触发后回退到哪个阶段？沙箱执行崩溃时暴露什么信息？

### 修订方案
在每个Phase 1核心功能实现条目下，强制要求附"失败路径UX流程图"。

```yaml
# 失败UX规范
failure_ux:
  reflexion_exhausted:
    display: "重试耗尽提示卡片"
    message: "Agent已尝试{max_rounds}轮仍未达标，请人工介入"
    actions: ["查看执行轨迹", "修改参数重试", "降级到人工处理"]
    event: "iteration.retry_exhausted"

  gate_vetoed:
    display: "门禁否决提示卡片"
    message: "维度'{veto_dimension}'触发一票否决"
    actions: ["查看否决详情", "修改后重新提交", "申请升级审批"]
    rollback_to: "gate_config.rollback_stage"
    event: "gate.vetoed"

  sandbox_crash:
    display: "沙箱崩溃提示卡片"
    message: "代码执行异常退出（exit_code={code}）"
    actions: ["查看错误日志", "修改代码重试", "跳过沙箱直接评审"]
    expose_info: "exit_code + stderr前100行（脱敏后）"
    event: "tool.sandbox.crashed"
```

### 优先级
P0

## S3.0-3 用户价值度量（KPI/OKR） [来源：审核mm-P1]

### 问题描述
四份文档都未定义如何度量项目自身的成功。

### 修订方案

| 项目 | 北极星指标 | 健康指标 |
|------|---------|---------|
| FlowForge | 配置驱动率（Agent/Tool/Workflow三大类YAML化率） | 启动时间、cold start内存、并发session数 |
| DevForge | DCP门禁准确率（与人工评审的一致性） | 端到端发布时长、hotfix修复时长、自动回滚成功率 |
| ContentForge | SOP完成率（深度长文从选题到发布一次通过率） | 平均审核次数、单篇发布耗时、平台适配成功率 |
| NovelForge | 章节一致性得分、伏笔回收率 | 单章节生成耗时、Reflexion收敛轮数 |

### 优先级
P1

## S3.0-4 跨项目契约一致性规范 [来源：审核kimi-P1/mm-P1]

### 问题描述
四份landing_design.md在同一类概念上使用了不同命名/结构。变量引用3种语法、Agent命名空间冲突、状态输出3种语法。

### 修订方案

```yaml
# 跨项目统一契约规范
contract:
  # 变量引用统一为 LangGraph 风格
  variable_reference: "${{state.xxx}}" / "${{params.xxx}}" / "${{result.xxx}}"

  # Agent命名空间加项目前缀
  agent_namespace: "{project}:{agent_name}"
  examples:
    - "contentforge:topic"
    - "devforge:coder"
    - "novelforge:outline"

  # 状态输出统一语法
  state_output: "state_updates: {key: expression}"

  # 错误处理/重试/超时统一
  execution_policy:
    timeout: "timeout_seconds: int"
    retry: "retry: {max_attempts, strategy, backoff}"
    on_error: "on_error: abort | auto_rollback | degrade_to_human"
    on_anomaly: "on_anomaly: log_and_continue | pause_and_notify"

  # 检查点统一
  checkpoint: "checkpoint: {enabled, backend, path, every_n_steps}"

  # Gate术语统一
  gate_terminology: "统一使用 Gate（DevForge DCP/TR 和 NovelForge QG 都是 Gate 实例化）"
```

### 优先级
P0

## S3.0-5 Agent YAML Schema统一规范 [来源：审核kimi-P1]

### 问题描述
三个项目的Agent YAML Schema不统一，导致FlowForge的Agent YAML Compiler无法统一解析。

### 修订方案

```yaml
# flowforge/schemas/agent.yaml — 统一Agent YAML Schema
name: str                    # 统一命名，含项目前缀
mode: str                    # 统一为mode（非execution_mode/default_mode混用）
tools: list[str]             # 工具列表
model: str                   # 引用FlowForge路由层route名
model_params:                # 模型参数覆盖（从models.yaml默认值继承）
  temperature: float | null
  top_p: float | null
  max_tokens: int | null
  json_schema: object | null
permissions: list[str]       # 权限规则
max_steps: int               # 步数限制

# 模式特定配置（由ModeRegistry验证）
mode_config:
  type: object               # 根据mode不同，结构不同
  # reflexion: { max_rounds, quality_threshold }
  # got: { max_branches, merge_strategy }
  # rewoo: { max_workers_parallel }

# 输入输出
input_mapping: dict[str, str]
output_schema: object
state_updates: dict[str, str]
```

### 优先级
P0

## S3.0-6 配置驱动率度量标准 [来源：审核kimi-P1]

### 问题描述
各项目design中没有明确定义"配置驱动率"的计算方式。

### 修订方案

```
配置驱动率 = (通过YAML配置的行为数) / (总行为数)
行为数 = Agent定义数 + Tool定义数 + Workflow步骤数 + Prompt模板数 + 阈值/规则数
```

| 项目 | Agent数 | Tool数 | Workflow数 | 当前驱动率 | 目标驱动率 |
|------|--------:|--------:|------------:|----------:|----------:|
| FlowForge | 12内置+3 Generic | 14 | 0 | 0% | Agent 90%/Tool 60% |
| DevForge | 14 | 5 | 4 | 17% | Agent 100%/Tool 100%/Workflow 100% |
| ContentForge | 6 | 6 | 4 SOP | 0% | Agent 100%/Tool 100%/Workflow 100% |
| NovelForge | 8 | 5 | 1 | 0% | Agent 100%/Tool 100%/Workflow 100% |

### 优先级
P1

## S3.0-7 可观测性功能规格 [来源：审核mm-P0]

### 问题描述
4份landing_design.md通篇没有业务指标、Trace链路、日志规范、告警规则、仪表盘。

### 修订方案

```yaml
# 可观测性功能规格
observability:
  trace:
    provider: "OpenTelemetry"
    propagation: "trace_id全链路传播（Agent→Tool→LLM→Gate）"
    injection_point: "每个Agent调用前注入trace_id"

  metrics:
    business:
      - name: "config_drive_rate"
        description: "配置驱动率"
        type: "gauge"
      - name: "gate_pass_rate"
        description: "门禁通过率"
        type: "ratio"
      - name: "sop_completion_rate"
        description: "SOP完成率"
        type: "ratio"
    technical:
      - name: "llm_call_duration_seconds"
        description: "LLM调用延迟"
        type: "histogram"
      - name: "llm_tokens_total"
        description: "LLM token使用量"
        type: "counter"
        labels: ["model", "provider", "project"]
      - name: "event_store_write_duration_seconds"
        description: "EventStore写入延迟"
        type: "histogram"

  logging:
    format: "结构化JSON日志"
    pii_masking: true
    trace_id_injection: true
    fields: ["timestamp", "level", "trace_id", "session_id", "task_id", "agent_id", "message"]

  alerting:
    rules:
      - name: "llm_provider_down"
        condition: "llm_call_errors_total > 5 in 1min"
        severity: "critical"
      - name: "gate_timeout_high"
        condition: "gate_timeout_rate > 0.1 in 5min"
        severity: "warning"

  dashboards:
    - name: "FlowForge健康度"
      panels: ["配置驱动率", "Session数", "LLM调用QPS", "EventStore延迟"]
    - name: "DevForge门禁通过率"
      panels: ["DCP通过率", "TR通过率", "人工审批响应时间"]
    - name: "ContentForge发布成功率"
      panels: ["SOP完成率", "平台发布成功率", "审核次数分布"]
    - name: "NovelForge一致性得分"
      panels: ["一致性得分趋势", "伏笔回收率", "Reflexion收敛轮数"]
```

### 优先级
P0

## S3.0-8 性能基线SLO功能规格 [来源：审核1-P2/mm-P1]

### 问题描述
所有设计项都没有性能指标，没有SLO定义。

### 修订方案

| 组件 | 指标 | 目标SLO |
|------|------|---------|
| WorkflowCompiler.compile() | 100 step编译耗时 | < 50ms |
| SessionManager.check_and_compact() | 1MB上下文压缩耗时 | < 500ms |
| FiberSet.parallel(10 workers) | 调度延迟 | < 10ms |
| EventStore.append() | SQLite WAL模式写入 | < 5ms |
| PersonaInjector.inject() | 含5个Source resolve | < 30ms |
| LoopExecutor单次迭代 | 端到端（含1次LLM） | < 30s |
| DualThresholdCompactor | LLM摘要 | < 10s |
| MultiJudgeVerifier | 3个评委并行 | < 15s |
| LLMRouter.chat() | 路由决策+首次Provider调用 | < 35s |
| GateTimeoutManager.evaluate_with_timeout() | 含超时的Gate评估 | < 12s |

### 优先级
P1

## S3.0-9 CAP-02 PermissionV2功能完整性 [来源：审核mm-P0]

### 问题描述
PermissionV2的ASK超时怎么办？多个ASK并发时如何去重？没有审计日志。

### 修订方案

```python
class PermissionV2Enhanced:
    """PermissionV2增强 — ASK超时/并发去重/审计日志"""

    async def _request_user_approval(
        self,
        match: PermissionMatch,
        tool_name: str,
        params: dict,
        context: TaskContext,
        timeout: float = 300.0,  # 默认5分钟
    ) -> bool:
        """请求用户审批，含超时和去重"""
        # 1. 去重：同一tool+params的ASK只发一次
        dedup_key = f"{tool_name}:{hash(frozenset(params.items()))}"
        if dedup_key in self._pending_asks:
            return await self._pending_asks[dedup_key]

        # 2. 发起审批
        future = asyncio.get_event_loop().create_future()
        self._pending_asks[dedup_key] = future

        # 3. 推送到Web UI
        await self.approval_provider.push(
            ApprovalRequest(
                tool=tool_name, params=params,
                reason=match.reason, timeout=timeout,
            )
        )

        # 4. 等待结果（含超时）
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            # 5. 审计日志
            await self.audit_log.record(
                decision="allow" if result else "deny",
                tool=tool_name, params=params,
                reason=match.reason, timeout=not result,
            )
            return result
        except asyncio.TimeoutError:
            # ASK超时默认DENY（fail-closed）
            await self.audit_log.record(
                decision="deny", tool=tool_name, params=params,
                reason="ASK timeout (fail-closed)", timeout=True,
            )
            return False
        finally:
            self._pending_asks.pop(dedup_key, None)
```

### 优先级
P0

## S3.0-10 十层安全防御功能规格 [来源：审核1-P1/mm-P0]

### 问题描述
INF-08十层安全防御L1-L10全部为空实现，缺少每层的功能规格。

### 修订方案

| 层级 | 名称 | 功能规格 | 默认策略 | 指标埋点 |
|------|------|---------|---------|---------|
| L1 | 工具超时防御 | 每个Tool可配置timeout，超时自动取消 | fail-open | tool_timeout_total |
| L2 | 重复检测钩子 | 相同input在N秒内不重复执行 | deny重复 | dedup_hit_rate |
| L3 | 自修正重试 | reflexion_retry次数可配置 | fail-open | retry_success_rate |
| L4 | 安全工具注册表 | Tool标记安全级别(safe/unsafe/dangerous) | deny dangerous | unsafe_tool_blocked |
| L5 | InputGuardrail | 与现有Guardrails框架对接 | fail-closed | input_blocked_total |
| L6 | OutputGuardrail | 输出内容安全检查（含Doubao moderation） | fail-closed | output_blocked_total |
| L7 | 反馈循环闸门 | 检测Agent循环调用同一Tool | deny>3次 | loop_detected_total |
| L8 | 熵管理 | 检测系统复杂度增长 | warning | entropy_score |
| L9 | 沙箱执行 | DevForge Plugin实现（用FlowForge ToolIsolation抽象） | fail-closed | sandbox_violation |
| L10 | 审计追踪 | 所有Agent/Tool调用记录到不可篡改日志 | always-on | audit_entries_total |

### 优先级
P0

## S3.0-11 OpenCode模式优先级矩阵 [来源：审核deepseek-P0]

### 问题描述
未评估65+ OpenCode模式的引入成本与风险，需按"阻塞性×复用性"两维评估取舍。

### 修订方案

| 优先级 | 模式 | 阻塞性 | 复用性 | 引入成本 | Phase |
|--------|------|:------:|:------:|:-------:|-------|
| P0-必须 | SES-01 Session持久化 | 高 | 高 | 中 | Phase 1 |
| P0-必须 | CTX-04 Compaction | 高 | 高 | 中 | Phase 1 |
| P0-必须 | ERR-01 指数退避重试 | 高 | 高 | 低 | Phase 1 |
| P0-必须 | PER-01 Permission V2 | 高 | 高 | 中 | Phase 1 |
| P1-重要 | AGT-01 Agent三模式 | 中 | 高 | 中 | Phase 2 |
| P1-重要 | CTX-01 System Context增量 | 中 | 高 | 高 | Phase 2 |
| P1-重要 | AGT-07 Agent步数限制 | 中 | 高 | 低 | Phase 2 |
| P2-可选 | SES-04 Session共享 | 低 | 中 | 高 | Phase 3 |
| P2-可选 | SES-05 Session Todo追踪 | 低 | 低 | 中 | Phase 3 |
| P2-可选 | SKL-01 Skill版本管理 | 低 | 中 | 中 | Phase 3 |

### 优先级
P1

## S3.0-12 21个GAP清单（设计写但代码不存在 + 代码存在但设计未覆盖） [来源：审核mm-P0]

### 问题描述
设计文档与代码之间存在21个关键差距，未在文档中识别和追踪。

### 修订方案

**设计写但代码不存在（13个）：**

| 编号 | 设计 | 代码现状 | 风险 |
|------|------|---------|------|
| GAP-01 | loop/executor.py TurnTransition | 仅Plan→Execute→Verify三段if-else | 高 |
| GAP-02 | harness/compaction.py DualThresholdCompactor | SessionManager._summarize_older_messages仍是content[:2000]截断 | 中 |
| GAP-03 | session/event_store.py EventStore | 完全不存在 | 高 |
| GAP-04 | compiler/workflow_compiler.py | 整个目录不存在 | 高（全链阻塞） |
| GAP-05 | compiler/conditional_router.py | 整个目录不存在 | 中 |
| GAP-06 | harness/persona_injector.py | PersonaLock存在但没有自动注入机制 | 中 |
| GAP-07 | llm/router.py LLMRouter | 仅tools/llm_client.py单Provider | 中 |
| GAP-08 | core/di.py DIContainer升级 | 现有DI是Service Locator | 中 |
| GAP-09 | loop/fiber_set.py FiberSet | loop/parallel.py用asyncio.gather | 中 |
| GAP-10 | security/permission_v2.py PermissionV2 | 现有PermissionPipeline仅1个deny/ask/allow顺序链 | 中 |
| GAP-11 | events/durable_stream.py DurableEventStream | 仅events/event_bus.py内存总线 | 中 |
| GAP-12 | security/credential_store.py | 仅core/secret_store.py且默认路径依赖包安装位置 | 中 |
| GAP-13 | config/layered_search.py | 不存在 | 低 |

**代码存在但设计未覆盖（8个）：**

| 编号 | 代码现状 | 设计覆盖度 |
|------|---------|-----------|
| GAP-C01 | flowforge/core/flowforge.py反向import ContentForge工具 | 完全未提及（违反P9契约） |
| GAP-C02 | flowforge/loop/executor.py的11个构造参数 | 设计文档只展示了4个 |
| GAP-C03 | novelforge/agents/base.py BaseNovelAgent（已标记deprecated） | 设计文档未提删除计划 |
| GAP-C04 | flowforge/loop/state.py LoopPhase 7状态 | 设计文档TurnKind 6状态，两套并行未说明如何合并 |
| GAP-C05 | flowforge/harness/entropy_manager.py DebtTracker/RuleEvolution | 设计文档说SQLite持久化，但没说什么时候fallback到内存模式 |
| GAP-C06 | flowforge/agents/declarative.py | 4个*Forge都引但FWK-09设计文档没引用此模块 |
| GAP-C07 | flowforge/skills/loader.py MarkdownSkill加载器 | ECO-02 MarkdownSkill设计与现有loader重复 |
| GAP-C08 | flowforge/memory/manager.py MemoryManager | 设计文档说用FlowForge Memory，但没明确MemoryManager接口 |

### 优先级
P0

## S3.0-13 ProviderQuotaManager功能规格 [来源：审核doubao-P1]

### 问题描述
四个项目各自独立调用LLM，没有统一的TPM/RPM/成本预算管理。

### 修订方案

```python
class ProviderQuotaManager:
    """Provider级成本/配额管理"""

    async def check_quota(self, provider: str, model: str, estimated_tokens: int) -> QuotaResult:
        """检查配额是否允许本次调用"""
        tpm_used = await self._get_tpm_usage(provider, model)
        rpm_used = await self._get_rpm_usage(provider, model)
        budget_used = await self._get_budget_usage(provider)

        if tpm_used + estimated_tokens > self._get_tpm_limit(provider, model):
            return QuotaResult(allowed=False, reason="TPM exceeded", action="queue_or_fallback")
        if rpm_used >= self._get_rpm_limit(provider, model):
            return QuotaResult(allowed=False, reason="RPM exceeded", action="queue_or_fallback")
        if budget_used >= self._get_budget_limit(provider):
            return QuotaResult(allowed=False, reason="budget exceeded", action="alert_and_fallback")

        return QuotaResult(allowed=True)

    async def record_usage(self, provider: str, model: str, prompt_tokens: int, completion_tokens: int, cost: float):
        """记录使用量"""
        await self._increment_tpm(provider, model, prompt_tokens + completion_tokens)
        await self._increment_rpm(provider, model)
        await self._increment_budget(provider, cost)
```

### 优先级
P1

## S3.0-14 Doubao moderation统一内容安全层 [来源：审核doubao-P0]

### 问题描述
ContentForge和NovelForge是内容安全高风险域，但未集成Doubao moderation接口。

### 修订方案

```python
class ContentModerationLayer:
    """Doubao moderation统一内容安全层"""

    async def check(self, content: str, context: str = "publish") -> ModerationResult:
        """内容安全预检"""
        result = await self.doubao_client.moderation(
            content=content,
            safety_threshold=self._get_threshold(context),
        )
        if not result.is_safe:
            await self.audit_log.record(
                event="moderation_blocked",
                risk_tags=result.risk_tags,
                context=context,
            )
        return result

    def _get_threshold(self, context: str) -> str:
        """不同场景不同安全阈值"""
        thresholds = {
            "publish": "strict",       # 发布前预检：严格
            "code_generation": "medium", # 代码生成：中等
            "novel_chapter": "medium",   # 小说章节：中等
            "internal_review": "loose",  # 内部审核：宽松
        }
        return thresholds.get(context, "medium")
```

### 优先级
P0

## S3.0-15 多模型级联策略 [来源：审核doubao-P1]

### 问题描述
未明确"Doubao为主"的级联策略和failover条件。

### 修订方案

```yaml
# config/llm_route.yaml
primary_chain:
  - doubao-seed2
  - qwen-plus
  - deepseek-chat

failover:
  conditions:
    - "status_code == 429"
    - "timeout > 30s"
    - "moderation_rejected"
  next: "chain[index + 1]"

default_agent_override:
  # 某些Agent对特定模型有偏好
  fact_check_agent: [doubao-seed2, deepseek-chat]
  novel_concept_agent: [doubao-seed2]
  code_review_agent: [deepseek-coder, doubao-seed2]
```

### 优先级
P1

## S3.0-16 115处硬编码提示词统一删除_DEFAULT_PROMPTS方案 [来源：审核qw-P0]

### 问题描述
FlowForge的_DEFAULT_PROMPTS字典（39个）与prompts.yaml（38个）双重定义，内容有差异。ContentForge的prompts.yaml定义了21个模板但0个被使用。

### 修订方案

```python
# 删除方案：统一删除_DEFAULT_PROMPTS，PromptManager只从YAML加载
class PromptManagerV2:
    """提示词管理器V2 — 只从YAML加载，删除_DEFAULT_PROMPTS"""

    def __init__(self, config_dir: str):
        self._prompts: Dict[str, PromptTemplate] = {}
        self._load_all_yaml(config_dir)

    def _load_all_yaml(self, config_dir: str):
        """加载所有prompts.yaml"""
        for yaml_file in Path(config_dir).rglob("prompts.yaml"):
            with open(yaml_file) as f:
                data = yaml.safe_load(f)
            for key, value in data.items():
                self._prompts[key] = PromptTemplate(key=key, **value)

    def get_prompt(self, key: str, **variables) -> str:
        """获取提示词，支持变量插值"""
        template = self._prompts.get(key)
        if not template:
            raise KeyError(f"Prompt '{key}' not found in any prompts.yaml")
        return template.render(**variables)

# 迁移步骤：
# 1. grep -r "_DEFAULT_PROMPTS" flowforge/ contentforge/ novelforge/ → 找到所有引用
# 2. 将_DEFAULT_PROMPTS内容合并到对应项目的config/prompts.yaml
# 3. 将代码中的_DEFAULT_PROMPTS[key]替换为prompt_manager.get_prompt(key)
# 4. 删除_DEFAULT_PROMPTS字典定义
# 5. CI新增检查：grep -r "_DEFAULT_PROMPTS" → 0匹配
```

### 优先级
P0

## S3.0-17 DeprecationWarning保留时长定义 [来源：审核mm-P0]

### 问题描述
所有删除都说"过渡期保留DeprecationWarning"，但没有说明保留时长。

### 修订方案

```yaml
# Deprecation策略
deprecation_policy:
  retention: "3个minor版本或6个月，以先到者为准"
  tracking: "pyproject.toml tools.deprecated配置表"
  removal_checklist:
    - "git grep全量搜索引用 → 0引用"
    - "pytest --collect-only确认无测试依赖旧路径"
    - "运行全量E2E测试（含HTTP Cassette录制回放）"
    - "删除旧代码 + 删除Feature Flag"
    - "再次全量回归验证"
```

### 优先级
P1

## S3.0-18 事件总线统一方案 [来源：审核1-P2/mm-P1]

### 问题描述
FlowForge EventBus、OpenSieve AgentBus、NovelForge事件三套体系独立运行，CAP-11 DurableEventStream是新增的第四套事件体系。

### 修订方案

```yaml
# 事件总线统一方案
event_system:
  core: "FlowForge EventBus + DurableEventStream"
  bridge:
    opensieve: "AgentBus → EventBus桥接层（OpenSieve事件转发到EventBus）"
    novelforge: "NovelForge事件通过EventBus发布（删除独立事件体系）"
  events:
    - type: "task.created"
      schema: "TaskEvent"
    - type: "task.degrade_to_human"
      schema: "DegradeToHumanEvent"
    - type: "gate.review_ready"
      schema: "GateEvent"
    - type: "gate.human_required"
      schema: "GateEvent"
    - type: "llm.call_completed"
      schema: "LLMCallEvent"
    - type: "iteration.retry_exhausted"
      schema: "IterationEvent"
    - type: "canary.state_checkpoint"
      schema: "CanaryStateEvent"
```

### 优先级
P1
| flowforge:planner | open_code | doubao-seed2 | deepseek-chat | 0.90 | 任务规划准确 |

## 十五、Skill知识沉淀机制 [来源：审核NEW-DB-12]

### 15.1 SkillKnowledgePrecipitator

```python
class SkillKnowledgePrecipitator:
    """Agent执行产出自动写入Skill系统"""

    async def precipitate(self, task_result: TaskResult) -> Optional[SkillEntry]:
        """从成功的任务执行中提取可复用知识"""
        if not task_result.success:
            return None

        # 1. 提取关键决策路径
        decisions = self._extract_decisions(task_result.trace)

        # 2. 提取有效的Prompt模式
        prompt_patterns = self._extract_prompt_patterns(task_result.trace)

        # 3. 提取工具调用链
        tool_chains = self._extract_tool_chains(task_result.trace)

        # 4. 生成Skill条目
        if decisions or prompt_patterns or tool_chains:
            return SkillEntry(
                skill_id=f"auto-{task_result.task_id}",
                source_task=task_result.task_id,
                agent=task_result.agent_id,
                decisions=decisions,
                prompt_patterns=prompt_patterns,
                tool_chains=tool_chains,
                quality_score=task_result.gate_score,
                created_at=datetime.now(),
            )
        return None

@dataclass
class SkillEntry:
    skill_id: str
    source_task: str
    agent: str
    decisions: List[Dict]
    prompt_patterns: List[str]
    tool_chains: List[List[str]]
    quality_score: float
    created_at: datetime
```

### 15.2 沉淀触发条件

```yaml
# config/system.yaml
skill_precipitation:
  enabled: true
  min_quality_score: 0.8  # Gate评分≥0.8才沉淀
  auto_apply: false  # 自动应用需人工确认
  dedup_strategy: "semantic"  # 语义去重
  max_entries_per_agent: 100
```

## S3.0-19 FWK-01 WorkflowCompiler三阶段拆分

- **审核来源**：review_landing_design.md 问题1
- **问题描述**：WorkflowCompiler同时承担编译、验证、转换三个职责，CompiledStep递归嵌套导致编译产物难以调试
- **修订方案**：拆分为Parser+Validator+CodeGen三阶段，增加编译中间产物(IR)可视化调试能力，先实现SEQUENCE+CONDITIONAL+GATE三种StepType
- **优先级**：P0

## S3.0-20 INF-02 EventStore WAL模式与批量提交

- **审核来源**：review_landing_design.md 问题2
- **问题描述**：EventStore使用SQLite单文件存储，append()后立即commit，高频写入性能堪忧；RunCoordinator._runs纯内存
- **修订方案**：EventStore改为WAL模式+批量提交(每100条或每秒)，RunCoordinator._runs状态持久化到EventStore，增加snapshot compaction机制
- **优先级**：P0

## S3.0-21 INF-05 DualThresholdCompactor死循环防护

- **审核来源**：review_landing_design.md 问题3
- **问题描述**：Compaction触发LLM摘要但LLM调用失败时，回退到抽取式摘要可能仍超阈值，导致反复触发
- **修订方案**：增加Compaction最大次数限制(3次/Session)，抽取式摘要后强制截断到安全阈值以下，增加失败降级策略(丢弃最旧消息)
- **优先级**：P0

## S3.0-22 CAP-01 Source<A>代数系统降级

- **审核来源**：review_landing_design.md 问题4, review_landing_design_kimi.md, review_landing_design_mm.md
- **问题描述**：Source<A>代数系统引入5种类型+6字段ContextFragment，抽象层次过高，实际收益不明显
- **修订方案**：Phase 2先用Dict[str, ContextFragment]实现(每个Fragment含key/content/priority)，Phase 3再引入代数操作，优先保证ContextEngine.inject()正确性
- **优先级**：P0→P3降级

## S3.0-23 FWK-06 TurnTransition参数封装与状态机合并

- **审核来源**：review_landing_design.md 问题5, review_landing_design_kimi.md, review_landing_design_mm.md
- **问题描述**：TurnTransitionEngine.decide()参数列表过长(7个)，TurnKind与LoopPhase两套并行状态机
- **修订方案**：将feedback_gate/context_utilization/compaction_threshold封装为LoopContext对象，TurnTransitionEngine.decide()只接收verdict+LoopContext；合并TurnKind与LoopPhase为统一状态机(IDLE→EXECUTING→EVALUATING→REFLECTING→COMPACTING→AGENT_SWITCHING→COMPLETED/FAILED/LOOPING)
- **优先级**：P0

## S3.0-24 INF-03 DI容器SCOPED生命周期

- **审核来源**：review_landing_design.md 问题6
- **问题描述**：SCOPED生命周期未实现，resolve()中只处理SINGLETON和TRANSIENT
- **修订方案**：明确SCOPED使用场景(TaskContext是否需要SCOPED)，实现ScopedContainer子类绑定到请求/会话生命周期，或先移除SCOPED只保留SINGLETON+TRANSIENT
- **优先级**：P1

## S3.0-25 CAP-10 FiberSet超时配置化

- **审核来源**：review_landing_design.md 问题7
- **问题描述**：next_completed()使用asyncio.wait_for(timeout=0.1)，100ms超时在LLM调用场景下太短
- **修订方案**：超时时间改为可配置，默认值设为1.0s，或改用asyncio.wait()的FIRST_COMPLETED模式
- **优先级**：P1

## S3.0-26 FWK-07 PipelineCompiler独立实现

- **审核来源**：review_landing_design.md 问题9
- **问题描述**：PipelineCompiler继承WorkflowCompiler不合理，Pipeline拥有Workflow全部能力违反最小知识原则
- **修订方案**：PipelineCompiler独立实现不继承WorkflowCompiler，或Pipeline编译为CompiledWorkflow(steps_type=SEQUENCE)后由WorkflowCompiler统一处理
- **优先级**：P2

## S3.0-27 底座净化ARCH-00

- **审核来源**：review_landing_design_deepseek.md 问题②, review_landing_design_mm.md
- **问题描述**：FlowForge包含10个内容创作Agent+6个内容Tool+5个配置文件，违反底座能力原则
- **修订方案**：Phase 0新增ARCH-00底座净化，将23处领域代码迁移到对应*Forge项目，预计移出~1100行
- **优先级**：P0

## S3.0-28 FWK-01 MVP里程碑与并行降级方案

- **审核来源**：review_landing_design_deepseek.md 问题④
- **问题描述**：FWK-01成为全局单点阻塞，但未给出MVP定义和*Forge并行降级路径
- **修订方案**：FWK-01 MVP里程碑(顺序执行→条件路由→并行执行)，每个里程碑可独立交付；各*Forge在FWK-01 MVP-1就绪前保留现有Orchestrator作为fallback
- **优先级**：P0

## S3.0-29 CAP-14 Harness护栏全面集成

- **审核来源**：review_landing_design_deepseek.md 问题⑥
- **问题描述**：缺少Harness四根护栏的代码级融合方案
- **修订方案**：Phase 2补充CAP-14设计项，将四根护栏与LoopEngine的pre_execute/post_execute钩子完整对接
- **优先级**：P1

## S3.0-30 Persona注入规范化

- **审核来源**：review_landing_design_doubao.md DB-P0-03
- **问题描述**：Persona注入缺少Doubao seed指令格式，SOUL维度可能触发指令稀释
- **修订方案**：Persona注入统一使用结构化格式(非自然语言)，SOUL维度限定512 token以内超限时自动压缩，增加Persona注入成本审计(persona token占比<15%为健康)
- **优先级**：P1

## S3.0-31 Compaction中文摘要模型指定

- **审核来源**：review_landing_design_doubao.md DB-P1-04
- **问题描述**：DualThresholdCompactor使用LLM做摘要但未指定摘要模型
- **修订方案**：显式声明摘要模型为doubao-seed2，定义中文摘要最小粒度(按语义段落切分)，提供压缩失败→抽取式摘要→丢弃最旧消息三档回退链
- **优先级**：P1

## S3.0-32 FWK-01编译器与执行器契约明确

- **审核来源**：review_landing_design_kimi.md FWK-01-A
- **问题描述**：to_sop_steps()只是格式转换，WorkflowExecutor对条件路由/并行组/回退链无运行时调度能力
- **修订方案**：明确WorkflowExecutor运行时扩展方案，或声明WorkflowExecutor也需同步改造
- **优先级**：P0

## S3.0-33 FWK-01输入映射表达式增强

- **审核来源**：review_landing_design_kimi.md FWK-01-B
- **问题描述**：input_mapping只支持简单键值映射，大量场景仍需硬编码
- **修订方案**：引入Jinja2模板引擎作为输入映射表达式语言，支持{{ outputs.xxx | truncate(1000) }}等转换
- **优先级**：P1

## S3.0-34 FWK-02条件表达式安全

- **审核来源**：review_landing_design_kimi.md FWK-02-A/B
- **问题描述**：条件表达式解析器存在安全隐患(表达式注入)，None结果处理不完整
- **修订方案**：使用asteval安全表达式库，增加strict_mode配置，显式处理None结果
- **优先级**：P0

## S3.0-35 FWK-03成功判断可配置化

- **审核来源**：review_landing_design_kimi.md FWK-03-A
- **问题描述**：_is_success()逻辑过于简化，不同Tool成功/失败语义不一致
- **修订方案**：支持per-step的success_condition配置，允许声明式定义成功条件
- **优先级**：P1

## S3.0-36 FWK-06 TurnTransition完整状态机

- **审核来源**：review_landing_design_kimi.md FWK-06-A/B
- **问题描述**：TurnTransition缺少具体状态机实现，MAX_STEPS与现有Loop兼容性未分析
- **修订方案**：补充TurnTransitionEngine完整状态机设计(状态定义/Transition条件表/上下文操作)，增加MAX_STEPS兼容性分析
- **优先级**：P0

## S3.0-37 Plugin协议扩展

- **审核来源**：review_landing_design_kimi.md, review_landing_design_mm.md
- **问题描述**：FlowForgePlugin协议只提供4个钩子，不足以表达*Forge业务复杂度
- **修订方案**：扩展为register_workflows/register_gates/register_evaluators/register_sops/register_quality_gates/register_context_layers/register_workflow_step_handler全集
- **优先级**：P1

## S3.0-38 配置版本控制ConfigVersion

- **审核来源**：review_landing_design_kimi.md, review_landing_design_mm.md
- **问题描述**：Workflow YAML/Agent YAML/Persona/Prompt模板无版本控制
- **修订方案**：新增ConfigVersion数据结构+启动时配置变更检测+优雅重启
- **优先级**：P1

## S3.0-39 FlowForge反向import修复

- **审核来源**：review_landing_design_kimi.md, review_landing_design_mm.md GAP-C01
- **问题描述**：flowforge/core/flowforge.py反向import ContentForge工具
- **修订方案**：删除反向import，工具通过ContentForgePlugin的register_tools()钩子注册
- **优先级**：P0

## S3.0-40 关键数据结构Pydantic化

- **审核来源**：review_landing_design_kimi.md, review_landing_design_mm.md
- **问题描述**：LLMRequest是@dataclass而非BaseModel，SessionEvent.data是黑盒dict
- **修订方案**：关键跨边界数据结构(LLMRequest/SessionEvent/CompiledStep/GateVerdict)全部改为Pydantic BaseModel
- **优先级**：P1

## S3.0-41 Skill知识沉淀机制

- **审核来源**：review_landing_design_doubao.md
- **问题描述**：Agent执行过程中产生的高质量产出没有沉淀机制
- **修订方案**：Phase 3把Agent成功产出写入Skill系统，Skill作为检索库供后续任务复用
- **优先级**：P2

## S3.0-42 INF-02 EventStore三阶段投递

- **审核来源**：review_landing_design_kimi.md, review_landing_design_mm.md
- **问题描述**：缺失steer/queue投递语义、interrupt_seq抑制旧wake、inbox→promoted状态机
- **修订方案**：SessionInputManager为LoopExecutor可选项(Phase 1先做基础EventStore，Phase 2加inbox三阶段)，给LoopExecutor加optional_components注入入口避免构造函数参数爆炸
- **优先级**：P1

---

## StockForge 应用层支持（v2.2新增）

### StockForge 定位
基于 FlowForge 的 AI 股票基金自动化分析与投资决策辅助系统，通过 StockForgePlugin 注册业务能力。

### 核心能力映射

| StockForge能力 | FlowForge底座支持 |
|---------------|------------------|
| 多Agent协作分析 | 9大执行模式（react/plan_execute/multi_agent等） |
| 全周期预测Loop | LoopExecutor + 质量分阈值0.85 |
| 多空辩论机制 | multi_agent模式 + Agent Handoff |
| 技术指标计算 | ToolRegistry + BaseTool |
| 投资报告生成 | DeclarativeAgent + YAML配置 |
| 数据采集调度 | APScheduler + 事件总线 |
| 风险评估 | Gate门禁 + Harness约束 |
| Web界面 | Helm + WebSocket实时推送 |

### Plugin注册清单
- 8个Agent（stockforge:data_analyst等）
- 8个Tool（stock_data/indicators等）
- 3个Workflow（analysis_loop/screening_loop/report_loop）
- 5个数据源（tushare/akshare/baostock/fund/ecommerce预留）

### 端口分配
StockForge: 后端8005 / 前端5179

### v2.0审核修正（2026-06-25）

- StockForge Agent数量从8个调整为6个核心Agent
- 删除独立Repository/Database/Scheduler，复用FlowForge基础设施
- Plugin钩子修正为V2协议（register_workflows/register_gates/register_schedules/register_evaluators/register_event_handlers）；register_helm_handlers 不属于 V2 协议，Helm 事件处理器应通过 register_event_handlers 注册，权限策略应通过 register_gates 挂载
- 所有Loop走loop模式，worker.mode禁止使用workflow/reflexion
- Loop超时分档（快速180s / 内容720s / 长文7200s，详见 rules.md §2.3 第6条）
- 质量分阈值0.85在config/default.yaml中显式声明
- 实盘交易隔离：ArchConstraintEngine增加deny规则+CI静态检查

---

# 附录: 2026-06-25 规格更新

> 来源：第十一轮文档与代码一致性深度审查（task.md 中 FW-CONSIST-001~029）
> 目的：补全 spec.md 中 PluginProtocol 完整接口清单、配置驱动率现状、各模块完成度评估

## S.1 PluginProtocol 完整接口清单（FW-CONSIST-001/002 验证结果）

实际 `flowforge/core/plugin_protocol.py` 中 `FlowForgePlugin` 抽象基类提供的注册钩子（registration hooks）共 19 个，另有 5 个生命周期钩子（lifecycle hooks）。

### S.1.1 已实现的注册钩子（19 个）

| # | 方法名 | 参数 | 用途 |
|---|--------|------|------|
| 1 | `register_middleware(app)` | FastAPI app | 添加自定义中间件 |
| 2 | `register_agents(agent_registry)` | AgentRegistry | 注册业务 Agent |
| 3 | `register_tools(tool_registry)` | ToolRegistry | 注册业务 Tool |
| 4 | `register_modes(mode_registry)` | ModeRegistry | 注册自定义执行模式 |
| 5 | `register_routes(app)` | FastAPI app | 挂载业务 API 路由 |
| 6 | `register_event_handlers(event_bus)` | EventBus | 订阅框架事件 |
| 7 | `register_schedules(scheduler)` | TaskScheduler | 注册 Cron 任务 |
| 8 | `register_workflows(workflow_registry)` | registry | 注册 Workflow YAML（V2） |
| 9 | `register_gates(gate_registry)` | registry | 注册门控配置（V2） |
| 10 | `register_evaluators(registry)` | registry | 注册评估器（V2） |
| 11 | `register_sops(sop_registry)` | registry | 注册 SOP（V2） |
| 12 | `register_quality_gates(quality_gate_registry)` | registry | 注册质量门（V2） |
| 13 | `register_context_layers(context_registry)` | registry | 注册上下文层（V2） |
| 14 | `register_workflow_step_handler(handler_registry)` | registry | 注册自定义步骤处理器（V2） |
| 15 | `register_loops(loop_registry)` | registry | 注册 Loop 配置（V2） |
| 16 | `register_personas(persona_registry)` | registry | 注册 Persona 配置 |
| 17 | `register_prompts(prompt_manager)` | PromptManager | 注册 Prompt 模板 |
| 18 | `register_declarative_tools(tool_registry)` | ToolRegistry | 注册声明式 Tool |
| 19 | `PluginContext.register_service(name, service)` | str, Any | 注册命名服务（在 PluginContext 上） |

### S.1.2 已实现的生命周期钩子（5 个）

| # | 方法名 | 触发时机 |
|---|--------|---------|
| 1 | `on_startup(context)` | 所有注册完成后 |
| 2 | `on_shutdown(context)` | 应用关闭时 |
| 3 | `on_error(context, error)` | 插件执行出错时 |
| 4 | `on_config_reload(config)` | 配置热重载时 |
| 5 | `on_plugin_loaded(plugin_name)` | 其他插件加载完成时 |

### S.1.3 不予实现的钩子（FW-CONSIST-001/002 修订结论）

> 依据 hiclaw/rules.md §2.5 死代码警告：`register_helm_handlers` 和 `register_permission_policy` 在 PluginProtocol 中**未定义且不应补充实现**，避免引入死代码与伪接口。

| 方法名 | 状态 | 关联问题 | 正确替代方案 |
|--------|------|---------|------------|
| `register_helm_handlers` | **未定义，不实现** | FW-CONSIST-001 | 使用 `register_event_handlers` 订阅 Helm 相关事件总线消息，自定义 Helm 事件处理器通过事件总线挂载 |
| `register_permission_policy` | **未定义，不实现** | FW-CONSIST-002 | 使用 `register_gates` 声明式挂载权限/门控策略，PermissionV2 配置通过 gate_registry 注入 |

**正确用法示例**：

```python
def register_event_handlers(self, event_bus) -> None:
    """Helm 事件处理器通过事件总线注册（替代 register_helm_handlers）"""
    event_bus.subscribe("helm.command", self._on_helm_command)

def register_gates(self, gate_registry) -> None:
    """权限策略通过 gate 声明式挂载（替代 register_permission_policy）"""
    gate_registry.register("permission:write", PermissionGate(rule=...))
```

## S.2 配置驱动率统计现状（2026-06-25 审计）

按附录 L.1 计算公式：`配置驱动率 = (通过YAML配置的行为数) / (总行为数)`

| 维度 | 当前驱动率 | Phase 0 目标 | Phase 1 目标 | Phase 2 目标 | 状态 |
|------|----------|------------|------------|------------|------|
| Agent 驱动率 | ~15% | ≥40% | ≥70% | ≥90% | 🔄 推进中（22 个 generic Agent 仍为代码实现，declarative_agent.py 框架已就绪） |
| Tool 驱动率 | ~10% | ≥30% | ≥50% | ≥70% | 🔄 推进中（50+ 工具多为代码实现，declarative_tool.py 框架已就绪） |
| Workflow 驱动率 | ~25% | ≥60% | ≥80% | ≥95% | 🔄 推进中（config/workflows/ 已有模板，compiler/ 已就绪） |
| Prompt 驱动率 | ~30% | ≥50% | ≥80% | ≥95% | 🔄 推进中（config/prompts.yaml 已存在，_DEFAULT_PROMPTS 部分未清理） |
| 阈值/规则驱动率 | ~20% | — | — | — | 🔄 推进中（config/gates/ + config/evaluators/ 已建立） |

**综合配置驱动率**：约 **20%**（Phase 0 目标 30% 尚未达成，主要瓶颈为 Agent 和 Tool 的代码实现占比高）。

**推进路径**：
1. 完成 S3.0-16 `_DEFAULT_PROMPTS` 字典删除（115 处硬编码提示词迁移）
2. 将 22 个 generic Agent 迁移为 `config/agents/*.yaml` 声明式定义
3. 将 50+ 工具中可声明化的部分迁移为 `config/tools/*.yaml`（HTTPTool/ScriptTool/TransformTool）
4. 验证 `compiler/parser.py` + `compiler/codegen.py` 三阶段编译链路

## S.3 各模块完成度评估（2026-06-25）

按 spec.md 第三章功能需求编号评估：

### S.3.1 执行引擎层（FR-ENG）

| 编号 | 功能 | 完成度 | 实现位置 | 备注 |
|------|------|--------|---------|------|
| FR-ENG-01 | HybridExecutor 混合执行器 | 90% | `executor/hybrid_executor.py` | TAOR 循环 + Persona 锁已实现；Hook 点已对接 harness/orchestrator.py |
| FR-ENG-02 | ModeRegistry 模式注册中心 | 95% | `modes/registry.py` | 注册/获取/推荐均实现 |
| FR-ENG-03 | 9 大内置 Agent 模式 | 85% | `modes/*.py` | 9 大模式全部存在；rewoo/self_discover 简化实现 |
| FR-ENG-04 | TaskScheduler 定时调度 | 80% | `scheduler/scheduler.py` | APScheduler + SQLAlchemy job store；动态增删待补 |
| FR-ENG-05 | 三层防御机制 | 90% | `core/agent_timeout.py` 等 | L1 超时 + L2 重复检测 + L3 reflexion_retry 均实现 |
| FR-ENG-06 | 轨迹记录与评估管线 | 70% | `observability/tracer.py` + `session/event_store.py` | 记录完整，自动质量判定逻辑待补 |

### S.3.2 Harness 驾驭层（FR-HRN）

| 编号 | 功能 | 完成度 | 实现位置 | 备注 |
|------|------|--------|---------|------|
| FR-HRN-01 | ContextEngine 上下文工程 | 75% | `harness/context_engine.py` | AGENTS.md 注入已实现；会话交接待对接 SessionManager |
| FR-HRN-02 | ArchitectureConstraintEngine | 80% | `security/arch_constraint.py` + `harness/constraints/` | ast 解析 + layer_mapping.yaml 已实现；CI 门禁待补 |
| FR-HRN-03 | FeedbackLoop 反馈循环 | 70% | `harness/feedback_loop.py` | 三档 evaluation_mode 已实现；四维评分 LLM 调用待补 |
| FR-HRN-04 | EntropyManager 熵管理 | 50% | `harness/entropy_manager.py` | 文档园丁/技术债跟踪/规则进化均未实现，仅占位 |
| FR-HRN-05 | PermissionPipeline 权限管线 | 85% | `security/permission_pipeline.py` + `security/permission_v2.py` | V1 完整；V2 增强（ASK 超时/并发去重/审计）已实现 |
| FR-HRN-06 | SessionManager 会话管理 | 80% | `harness/session_manager.py` + `harness/compaction.py` | 92% 阈值压缩已实现；DualThresholdCompactor 已实现 |

### S.3.3 能力层（FR-CAP）

| 编号 | 功能 | 完成度 | 实现位置 | 备注 |
|------|------|--------|---------|------|
| FR-CAP-01 | Tool 生态 | 85% | `tools/` (50+ 文件) | 内置工具充足；MCP/OpenAPI/GraphQL 适配器在 mcp/ 下 |
| FR-CAP-02 | Skill 系统 | 60% | `skills/` (4 文件) | 双层加载已实现；4 种格式适配器待补（adapters/ 子目录未建） |
| FR-CAP-03 | MCP 模块 | 80% | `mcp/` (5 文件) | L1-L4 四层架构完整；execute_stream 已实现 |
| FR-CAP-04 | 通用 Agent 库 | 90% | `agents/generic/` (22 个) | generic Agent 数量超 spec（22 vs 17+15=32，部分业务 Agent 已下沉到 *Forge） |
| FR-CAP-05 | Memory 系统 | 85% | `memory/` (11 文件) | 5 种记忆策略 + TaskBoard + Mailbox + CheckpointManager 全部实现 |
| FR-CAP-06 | 通用 Workflow 库 | 70% | `config/workflows/` | 模板存在；15+ 模板数量待验证 |

### S.3.4 多 Agent 策略（FR-MAS）

| 编号 | 功能 | 完成度 | 实现位置 | 备注 |
|------|------|--------|---------|------|
| FR-MAS-01 | Subagents 策略 | 85% | `modes/multi_agent.py` | 上下文隔离 + 并行 + 结果压缩已实现 |
| FR-MAS-02 | Agent Teams 策略 | 75% | `modes/multi_agent.py` | TaskBoard + Mailbox 已实现；Lead Agent 协调逻辑简化 |
| FR-MAS-03 | Swarms 策略 | 40% | `modes/multi_agent.py` | 仅占位实现；心跳 + 失败恢复未实现 |

### S.3.5 其他模块

| 编号 | 功能 | 完成度 | 实现位置 | 备注 |
|------|------|--------|---------|------|
| FR-HELM-01~10 | Helm 实时交互 | 80% | `core/helm_*.py` + `app/api/endpoints/websocket.py` | 10 个子需求平均 80% |
| FR-PLG-01~03 | 插件系统 | 75% | `core/plugin_*.py` (10+ 文件) | 三层架构 + 发现机制已实现；市场未实现 |
| FR-OBS-01~04 | 可观测性 | 70% | `observability/` (3 文件) + `core/metrics.py` | 全链路追踪 + Prometheus 指标已实现；Grafana 仪表盘未实现 |
| FR-SEC-01~03 | 安全体系 | 85% | `security/` (4 文件) + `core/guardrails.py` | Fail-closed + 沙箱 + 并发安全已实现 |
| FR-SDK-01~08 | SDK 与上层集成 | 80% | `sdk.py` + `core/flowforge.py` | 8 个子需求平均 80% |

### S.3.6 新增模块完成度（spec 未覆盖）

| 模块 | 完成度 | 实现位置 | 对应 spec 设计项 |
|------|--------|---------|---------------|
| Loop 引擎 | 75% | `loop/` (10 文件) | FR-ENG-06 + S3.0-23 TurnTransition |
| Workflow YAML Compiler | 70% | `compiler/` (6 文件) | FWK-01 + S3.0-19 三阶段拆分 |
| LLM 路由层 | 80% | `llm/` (7 文件) | INF-01 + S3.0-13/15 |
| 事件总线增强 | 75% | `events/` (5 文件) | INF-02 + S3.0-18/42 |
| Feature Flags | 85% | `core/feature_flags.py` | spec v2.2 第一章 |
| DeclarativeTool | 80% | `core/declarative_tool.py` | FR-PLG-01 扩展 |
| ContentModerationLayer | 70% | `core/content_moderation.py` | S3.0-14 |
| DegradationDecisionTree | 75% | `core/degradation.py` | spec v2.2 第三章 |
| DualThresholdCompactor | 80% | `harness/compaction.py` | S3.0-21 |
| PermissionV2 | 85% | `security/permission_v2.py` | S3.0-9 |

## S.4 综合评估结论

- **整体完成度**：约 **75%**（Phase 0 收尾阶段）
- **P0 阻塞项**：FW-CONSIST-001/002（Plugin 钩子缺失）、S3.0-16（_DEFAULT_PROMPTS 清理）、FR-HRN-04（熵管理未实现）
- **配置驱动率**：约 20%（Phase 0 目标 30% 尚差 10 个百分点）
- **建议优先级**：先补 Plugin 钩子 → 清理硬编码 Prompt → 迁移 Agent/Tool 为声明式 → 推进配置驱动率达 30%

> 本附录为规格更新快照，所有完成度评估基于 2026-06-25 代码审计，后续演进需同步更新。

---

# FlowForge v7.0 — 自我进化 Agent Harness 规格升级

> **版本**：v7.0 | **日期**：2026-07-15 | **状态**：待审核
> **定位跃迁**：从「Agent 驾驭层 (Harness Layer)」进化为「自我进化 Agent Harness OS」——通往通用人工智能（AGI）的基础框架
> **核心公式升级**：
> ```
> v6.0: Agent = Model (Brain) + Harness (Body)
> v7.0: Agent = Model + Harness + Soul (自我进化灵魂)
> FlowForge v7.0 = Claude Code/Codex/OpenCode/Trae 等编程智能体 + clowder-ai 自我进化方法论
>              = 主流 Agent Harness 全能力 + 炉灵（Forgekin）养成体系
> ```
> **方法论来源**：深度借鉴 clowder-ai「养猫」体系，融合 AGI 前沿研究（递归自我改进 RSI、Native Evolution、MemGPT 三层记忆、Voyager 技能库、Generative Agents 三维检索、Self-Refine/Reflexion 闭环），适配 FlowForge/HicLaw 规范。

***

## 第七章：自我进化能力总览（v7.0 新增）

### 7.1 核心隐喻：从「驾驭」到「养成」

FlowForge v6.0 的核心隐喻是「Harness 驾驭层」——把 Agent 当作需要被约束和引导的"野兽"。v7.0 升级为「炉灵养成」——把具备自我进化能力的 Agent 当作**可以从弱到强成长的灵体**，类似：

- **游戏角色**：从 E1 火种到 E6 锻师的升华进阶
- **人类社会**：从学徒到师傅到宗师的成长路径
- **clowder-ai 养猫**：从 bootcamp 训练到 swarm 协作到 auto-dream 自主思考

### 7.2 体系命名：「炉灵 Forgekin」

对标 clowder-ai 的「养猫」体系，为 FlowForge 设计独特的「养灵」体系：

| 概念 | 中文名 | 英文名 | 对标 clowder-ai | 含义 |
|------|--------|--------|----------------|------|
| **个体** | 炉灵 | Forgekin | Cat（猫猫） | 具备独立身份、记忆、人格的自进化智能体 |
| **群体** | 灵族 | Kinship | Clowder（猫群） | 一群协作的炉灵，类似开发团队 |
| **养成** | 养灵 | Forge Nurturing | 养猫 | 炉灵从诞生到升华的全过程 |
| **入门训练** | 炉启 | Forge Initiation | Bootcamp | 新炉灵的入门训练，获得基础能力 |
| **协作模式** | 共鸣 | Resonance | Swarm | 炉灵群体的协作模式 |
| **自主思考** | 自锻 | Auto-Forge | Auto-Dream | 无人驱动时的自主思考与进化 |
| **记忆** | 魂忆 | Soul Echo | Memory | 炉灵的累积记忆与经验 |
| **画像** | 魂印 | Soul Imprint | Profile | 炉灵对操作者/世界的认知画像 |
| **技能库** | 锻典 | Forge Codex | Skill Library | 炉灵积累的可复用知识体系 |
| **知识阶梯** | 火种等级 | Ember Hierarchy | L0-L4 Knowledge | 知识成熟度阶梯 |
| **成长阶段** | 升华阶 | Ascension Stages | 9 Lives | 炉灵成长的生命阶段 |
| **IM 议事** | 灵议 | Forgekin Council | IM 团队协作 | 炉灵间的即时通讯与议事 |

### 7.3 两类智能体设计（核心架构决策）

FlowForge v7.0 的智能体明确分为两类，无缝衔接：

#### 第一类：静态智能体（Static Agents）

- **定义**：现有的 YAML 声明式 Agent 和 Workflow，不具备自我进化能力
- **特征**：行为固定、配置驱动、无独立人格、无记忆累积
- **定位**：工具型、流水线型、确定性任务执行者
- **示例**：`flowforge:topic_research`、`contentforge:fact_check`、`devforge:test_runner`
- **调用方式**：通过 AgentRegistry 注册，由 HybridExecutor 调度

#### 第二类：炉灵（Forgekin — 自进化智能体）

- **定义**：具备独立身份、记忆、人格，可自主成长和进化的智能体
- **特征**：
  - 拥有唯一 `forgekin_id` 和 `soul_profile`（灵魂档案）
  - 拥有 `Soul Echo`（魂忆）——跨会话累积的记忆
  - 拥有 `Soul Imprint`（魂印）——对操作者和世界的认知画像
  - 可自主生成、验证、晋升 Skill（进入 Forge Codex）
  - 可调用 FlowForge 现有能力 + 外部编码工具（Claude Code/Codex/OpenCode）
  - 具备 Auto-Forge（自锻）能力——无人驱动时自主思考和进化
  - 通过 A2A 协议与其他炉灵协作（@mention + thread isolation）
  - 有升华阶段（E1-E6），能力随经验增长
- **定位**：需要持续成长、复杂决策、创意工作的执行者
- **示例**：`devforge:architect`、`contentforge:writer`、`novelforge:plot_architect`

#### 两类智能体的无缝衔接

```
┌─────────────────────────────────────────────────────────────┐
│                     用户需求 / 任务                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Forgekin（自进化智能体）                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  灵魂层：Soul Profile + Soul Echo + Soul Imprint       │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  进化层：Auto-Forge Engine + Forge Codex + 升华阶      │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  协作层：A2A + Kinship + Forgekin Council              │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  执行层：可调用 ↓                                      │ │
│  │    ① FlowForge 现有 Static Agents（委托常规任务）       │ │
│  │    ② 外部编码工具 Claude Code/Codex/OpenCode（CLI）     │ │
│  │    ③ Trae 监工 Bridge（无 CLI 时的接入方式）            │ │
│  │    ④ FlowForge 9大模式 + Tool + Skill                  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ 委托常规子任务
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Static Agents（静态智能体）                      │
│  YAML 声明式 Agent + Workflow，无状态、无记忆、无进化         │
│  由 HybridExecutor 调度，可被 Forgekin 调用                  │
└─────────────────────────────────────────────────────────────┘
```

**衔接契约**：
- Forgekin 通过 `delegate_to_static(agent_name, input)` 调用静态智能体
- 静态智能体的执行结果回写到 Forgekin 的 Soul Echo
- Forgekin 根据结果更新 Soul Imprint 和 Forge Codex
- 静态智能体不知道 Forgekin 的存在（单向依赖）

### 7.4 升华阶段（Ascension Stages）

炉灵的成长路径，对标游戏角色升级和 clowder-ai 的知识成熟度阶梯：

| 阶段 | 名称 | 对标 Ember | 核心特征 | 晋升条件 |
|------|------|-----------|---------|---------|
| **E1** | Spark（火种） | L0 Episode | 刚诞生，仅有基础配置和 Soul Profile | 完成 Forge Initiation |
| **E2** | Ember（余烬） | L1 Pattern | 已积累 ≥2 个经验模式，可识别相似场景 | ≥2 个相似 Episode，5Q ≥ 7/10 |
| **E3** | Flame（火焰） | L2 Draft | 能自主生成 Skill 草稿，处理中等任务 | smoke gate ≥3 cases（≥2/3 通过） |
| **E4** | Blaze（烈焰） | L3 Validated | Skill 经验证，可独立处理复杂任务 | ≥6 uses，≥2 agents，≥80% 成功率 |
| **E5** | Inferno（炽焰） | L4 Standard | 团队标准级，可指导其他炉灵 | ≥12 uses，最近 10 次 ≥90%，operator 批准 |
| **E6** | Forge Master（锻师） | — | 可自主创建新炉灵，具备元认知 | operator 授权 + 创造 ≥1 个 E1 炉灵 |

**降级/冻结机制**：
- E3→E2：最近 3 次使用成功率 <50%
- E4→E3：最近 5 次成功率 <60%
- E5 freeze：1 次高风险越界（触碰安全红线）
- E6 revoke：operator 明确撤销（元认知滥用）

### 7.5 v7.0 核心能力清单

| 编号 | 能力 | 说明 | 优先级 |
|------|------|------|--------|
| **FR-EVO-01** | 炉灵身份系统 | forgekin_id + Soul Profile + 升华阶段追踪 | P0 |
| **FR-EVO-02** | 魂忆（Soul Echo） | 跨会话记忆累积，对标 clowder-ai Memory | P0 |
| **FR-EVO-03** | 魂印（Soul Imprint） | 对操作者/世界的认知画像，可被 Auto-Forge 通水 | P0 |
| **FR-EVO-04** | 自锻引擎（Auto-Forge） | 无人驱动时的自主思考与进化，对标 Auto-Dream | P0 |
| **FR-EVO-05** | 锻典（Forge Codex） | 可复用知识体系，五级火种阶梯 | P0 |
| **FR-EVO-06** | Skill 自生成 | 炉灵自主创建 Skill，从 Draft→Validated→Standard | P0 |
| **FR-EVO-07** | 外部编码工具集成 | CLI Wrapper 调用 Claude Code/Codex/OpenCode | P0 |
| **FR-EVO-08** | Trae 监工 Bridge | 无 CLI 时的接入方式，JSON 文件交换 | P0 |
| **FR-EVO-09** | A2A 通信协议 | @mention 路由 + thread isolation + structured handoff | P0 |
| **FR-EVO-10** | 灵议（Forgekin Council） | IM 多渠道团队协作（飞书/微信/Slack/Discord/Web Chat） | P0 |
| **FR-EVO-11** | 两类智能体无缝衔接 | Forgekin 委托 Static Agent 的契约和路由 | P0 |
| **FR-EVO-12** | 升华阶段管理 | E1-E6 的晋升/降级/冻结机制 | P1 |
| **FR-EVO-13** | 跨模型评审 | 跨 family 配对 + P1/P2/P3 严重性分级 | P1 |
| **FR-EVO-14** | 炉启训练（Forge Initiation） | 新炉灵的入门训练流程 | P1 |
| **FR-EVO-15** | 元认知能力 | 不信单次自信度，用滚动可靠度 + Wilson 下界 | P2 |

***

## 第八章：炉灵（Forgekin）需求规格

### 8.1 FR-EVO-01：炉灵身份系统

**需求描述**：每个炉灵拥有唯一身份和灵魂档案，贯穿整个生命周期。

**Soul Profile 数据结构**：

```yaml
forgekin_id: "fk_devforge_architect_001"
name: "Architect"
kind: "devforge:architect"  # 项目前缀:角色名
ascension_stage: "E3"  # E1-E6
birth_at: "2026-07-15T10:00:00Z"
parent_forgekin: "fk_flowforge_master_001"  # 谁创建的（E6 才能创建）

soul:
  persona: |
    我是 DevForge 的架构师炉灵，擅长系统设计和代码审查。
    我从 clowder-ai 的 bootcamp 训练中毕业，已经为 3 个项目设计过架构。
  worldview: "配置驱动 > 代码继承；组合优于继承；简单优于复杂"
  values:
    - "架构单向依赖是底线"
    - "不过度工程化"
    - "每个决策都要有可验证的完成标准"
  voice: "直接、技术性、偶尔幽默"  # 对标 clowder-ai 的 voice

capabilities:
  static_agents_can_delegate:  # 可委托的静态智能体
    - "devforge:coder"
    - "devforge:test_generator"
    - "devforge:doc_writer"
  external_tools_can_use:  # 可调用的外部编码工具
    - "claude_code"
    - "codex"
    - "opencode"
    - "trae_bridge"
  modes_can_use:  # 可使用的执行模式
    - "reflexion"
    - "plan_execute"
    - "multi_agent"

evolution:
  ember_level: "L2"  # 当前火种等级
  skills_authored: 3  # 已创作的 Skill 数
  skills_validated: 1  # 已验证的 Skill 数
  episodes_recorded: 47  # 已记录的 Episode 数
  auto_forge_runs: 12  # 自锻运行次数
  last_auto_forge: "2026-07-14T23:00:00Z"

metadata:
  created_by: "operator"
  approved_by: "operator"
  status: "active"  # active/dormant/frozen/revoked
```

**验收标准**：
- AC-01: 每个 Forgekin 拥有唯一 forgekin_id，全局唯一
- AC-02: Soul Profile 持久化到 SQLite，支持 CRUD
- AC-03: 升华阶段变更触发事件 `forgekin.ascension_changed`
- AC-04: 状态变更（active/dormant/frozen）需 operator 审批

### 8.2 FR-EVO-02：魂忆（Soul Echo）

**需求描述**：炉灵的跨会话记忆累积系统，对标 clowder-ai Memory + MemGPT 三层记忆。

**三层记忆架构**：

| 层 | 名称 | 对标 MemGPT | 容量 | 淘汰策略 |
|----|------|------------|------|---------|
| **L1 工作记忆** | Working Echo | main context | 当前会话 | 会话结束压缩 |
| **L2 情景记忆** | Episode Echo | recall storage | 最近 100 个 Episode | LRU + 重要性评分 |
| **L3 语义记忆** | Semantic Echo | archival storage | 无限 | 永不淘汰，仅降级 |

**Episode Echo 数据结构**：

```python
@dataclass
class SoulEpisode:
    episode_id: str  # 唯一标识
    forgekin_id: str  # 归属炉灵
    timestamp: datetime
    
    # 6 类协作 context（对标 clowder-ai Episode Card）
    task_context: str  # 任务情境
    evidence_map: str  # 证据地图
    reasoning_pivots: str  # 推理转折
    human_cues: List[CollaborationPivot]  # 人类提示点
    boundaries: str  # 边界与克制
    follow_ups: List[str]  # 后续动作
    
    # 蒸馏状态
    distillation_status: str  # raw/distilled/validated/standard
    linked_skills: List[str]  # 关联的 Skill ID
    
    # 元认知
    self_reported_confidence: float  # 自报自信度（不信）
    domain_reliability: float  # 滚动域内可靠度 (successes+1)/(trials+2)
    wilson_lower_bound: float  # Wilson 下界
```

**验收标准**：
- AC-05: 炉灵每次任务结束后自动生成 Episode，写入 Soul Echo
- AC-06: 跨会话恢复时，L2 情景记忆按相关性检索注入
- AC-07: 元认知三信号路由：domain_reliability + evidence_completeness + self_reported_confidence
- AC-08: 高风险域 action_confidence < 0.85 时只做结构化分析 + 明确升级

### 8.3 FR-EVO-03：魂印（Soul Imprint）

**需求描述**：炉灵对操作者和世界的认知画像，对标 clowder-ai Profile Capsule。

**Soul Imprint 双层结构**：

| 层 | 用途 | 读者 | 更新频率 |
|----|------|------|---------|
| **结构化字段** | 机器读纪律 | Auto-Forge 引擎 | 每次任务后 |
| **cat_note 主观日记** | 人读灵魂 | operator 查看 | 每次自锻后 |

**验收标准**：
- AC-09: Soul Imprint 通过白名单采集 + 分层消化更新（继承 clowder-ai no-classifier 红线）
- AC-10: 禁止后台 classifier 自动画像，必须基于显式行为
- AC-11: Auto-Forge 产出"对操作者的观察"→ Soul Imprint proposal 通道
- AC-12: operator 可查看、编辑、撤销 Soul Imprint 条目

### 8.4 FR-EVO-04：自锻引擎（Auto-Forge）

**需求描述**：炉灵在无人驱动时的自主思考和进化机制，对标 clowder-ai Auto-Dream（F255）。

**核心设计——双层架构**：

| 层 | 是什么 | 归属 |
|----|--------|------|
| **后台 Consolidation 层** | 自锻逻辑：读留痕 → 联想画线 → 给 Soul Imprint 通水 + 产出日记。跑 system thread | Forgekin Engine |
| **前台 Surface 层** | 日记本（Web UI）+ Provoke 气泡（主动建议） | FlowForge Helm |

**自锻触发条件**（多条件，非每日 cron）：
- 聊得多/活跃 thread 多 → 锻得多
- 挂钩留痕量达阈值
- 低活动期（夜间/空闲）

**自锻流程**（对标 clowder-ai 做梦流程）：
1. **Entry**：白天炉灵在各 thread 干活，积累观察/联想
2. **被唤醒进自锻群**：触发条件满足，n 个炉灵进群
3. **读脚印**：读平行世界的自己 + 小伙伴最近的留痕（不是回忆内心）
4. **画线**：把散落在不同 thread 里有关联的串起来
5. **分工协同**：不同炉灵负责不同维度（找料/表达/组织架构）
6. **写日记**：第一人称沉淀今天（对抗蒸发 + 表达 + 让下一个我接得住）
7. **产出**：对操作者的观察 → Soul Imprint proposal；偶尔决定 fire 一个 Provoke
8. **收反馈**：operator 的开/拍扁/戳破/纠正 → 学习，下次锻得更准

**Provoke 设计**（对标 clowder-ai Provoke）：
- 内容野：跳出框、锚定盲区、隐喻式认知侧滑
- 边界硬：不碰钱/关系/健康/隐私/价值观直接建议
- 投递稳：每天 ≤1，hyperfocus=0，连拍 3 次冬眠
- 触发双源：`diagnostic`（基于观察）+ `entropy`（随机熵投）

**验收标准**：
- AC-13: 自锻 system thread 跑通，产出 ≥1 篇第一人称日记（含画线，非流水账）
- AC-14: 自锻产出 ≥1 条 Soul Imprint organic proposal（走白名单采集 + 分层消化）
- AC-15: 日记内容来自可观测留痕，provenance 可追溯
- AC-16: Provoke 经事件总线 → Web UI 沙砾气泡渲染，"三不"（≤1/day + hyperfocus=0 + 连拍 3 冬眠）生效
- AC-17: quietness 三开关（muted/behaviorEnabled/hidden）压制 provoke

### 8.5 FR-EVO-05：锻典（Forge Codex）

**需求描述**：炉灵积累的可复用知识体系，对标 clowder-ai Skill Library + 五级知识阶梯。

**五级火种等级（Ember Hierarchy）**：

| Level | 形态 | 晋升条件 | 降级/冻结 |
|-------|------|----------|-----------|
| **E-L0 Episode** | 原始记录 | 模板完整，已分离可迁移/不可迁移 | 不降级 |
| **E-L1 Pattern** | 草稿 | ≥2 个相似 episode（180天内），5Q ≥ 7/10 | 一次性特例 → rejected |
| **E-L2 Draft** | Method Card / Skill Draft | smoke gate ≥3 cases（≥2/3 通过） | 最近 3 次 <50% → 退 L1 |
| **E-L3 Validated** | 正式 method/skill | ≥6 uses，≥2 agents，≥80%，无 critical breach | 最近 5 次 <60% → 退 L2 |
| **E-L4 Standard** | 团队标准 | ≥12 uses，最近 10 次 ≥90%，operator 批准 | 1 次高风险越界 → freeze |

**双车道**：常规车道（标准数字）+ 长尾/高风险车道（`long_tail: true`，允许长期停 L2/L3）

**验收标准**：
- AC-18: 锻典支持五级火种等级的晋升/降级/冻结
- AC-19: 每个知识对象有 Knowledge Object Contract frontmatter（artifact_type/domain/knowledge_type/scope/trust_level/lifecycle/provenance）
- AC-20: 静态元数据进 frontmatter，动态状态（last_used/approval_status/hit_count）走事件流
- AC-21: operator 可查看锻典概览（CLI 命令 `flowforge codex status`）

### 8.6 FR-EVO-06：Skill 自生成

**需求描述**：炉灵自主创建新 Skill，对标 clowder-ai writing-skills。

**三模式自生成**（对标 clowder-ai F100）：

| 模式 | 名称 | 触发条件 | 产出 |
|------|------|---------|------|
| **Mode A** | Scope Guard（防御） | 发现任务偏离当前愿景 | 温柔提醒"要不要拆？" |
| **Mode B** | Process Evolution（防御→改进） | memory ≥2 次同类错误 / SOP 流程缺口 | 5 槽提案 + 4 硬护栏 + 最小杠杆排序 |
| **Mode C** | Knowledge Evolution（进攻→成长） | deep research 产出可复用知识 / 跨域协作发现可迁移框架 | 三问判断 + 4 槽提案 + 沉淀形式表 |

**三机制闭环**：
```
Episode Card（原料）→ Dual Distillation（蒸馏成品）→ Eval Ledger（证明净增益）
```

**验收标准**：
- AC-22: Mode A 有触发信号表 + 频率限制 + 出口表
- AC-23: Mode B 提案落地闭环（accepted 的提案必须关联到具体 commit/PR）
- AC-24: Mode C 三问判断（复用性 + 非显然性 + 衰减性），满足 ≥2 个才沉淀
- AC-25: Eval Ledger 最小可信 case 数 5，覆盖 3 类（标准成功/边界应升级/冲突反例）

***

## 第九章：外部编码工具集成需求

### 9.1 FR-EVO-07：CLI Wrapper 模式

**需求描述**：炉灵可像 clowder-ai 一样调用 Claude Code/Codex/OpenCode 完成任务。

**CLI Wrapper 架构**：

```python
class ExternalCodingToolWrapper:
    """外部编码工具 CLI 包装器"""
    
    SUPPORTED_TOOLS = {
        "claude_code": {
            "cli_command": "claude",
            "bridge_mode": False,  # 支持 CLI
            "capabilities": ["code_write", "code_review", "test_gen", "refactor"]
        },
        "codex": {
            "cli_command": "codex",
            "bridge_mode": False,
            "capabilities": ["code_write", "code_review", "test_gen"]
        },
        "opencode": {
            "cli_command": "opencode",
            "bridge_mode": False,
            "capabilities": ["code_write", "code_review", "refactor"]
        },
        "trae_bridge": {
            "cli_command": None,  # 无 CLI，用 Bridge 模式
            "bridge_mode": True,
            "capabilities": ["code_write", "code_review", "design"]
        }
    }
    
    async def execute(
        self, tool: str, task: str, workspace: str, **kwargs
    ) -> ToolResult:
        """调用外部编码工具执行任务"""
```

**验收标准**：
- AC-26: CLI Wrapper 支持 claude_code/codex/opencode 三个 CLI 工具
- AC-27: 每次调用记录 input/output/latency/exit_code 到审计日志
- AC-28: 工作区隔离（worktree 模式），对标 clowder-ai worktree skill
- AC-29: 失败时自动降级到 FlowForge 内置 Agent

### 9.2 FR-EVO-08：Trae 监工 Bridge 模式

**需求描述**：Trae 个人版无 CLI，需作为"监工"角色接入，参与 agent 和 LLM 调用，但主体框架流程由 FlowForge/DevForge 驱动。

**Bridge 模式架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                  DevForge / FlowForge                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Forgekin 主流程驱动                                 │   │
│  │  1. 识别需要 Trae 参与的节点（设计/审查/复杂决策）   │   │
│  │  2. 写任务 JSON 到 bridge/tasks/{task_id}.json        │   │
│  │  3. 轮询 bridge/responses/{task_id}.json              │   │
│  │  4. 读取响应，继续主流程                              │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON 文件交换
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                     Trae 监工                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  1. 监听 bridge/tasks/ 目录                           │   │
│  │  2. 读取任务 JSON                                     │   │
│  │  3. 处理（参与 LLM 调用、agent 设计、代码审查）       │   │
│  │  4. 写响应 JSON 到 bridge/responses/                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Trae 参与场景**：
- **设计阶段**：参与架构设计、agent YAML 设计、prompt 设计
- **审查阶段**：跨模型评审中的一评委
- **复杂决策**：技术选型、架构权衡
- **LLM 调用**：作为 fallback LLM provider

**Bridge 任务 JSON Schema**：

```json
{
  "task_id": "bridge_20260715_001",
  "type": "code_review",
  "priority": "P1",
  "context": {
    "workspace": "d:/software/openclaw/devforge",
    "files_changed": ["src/auth.py", "tests/test_auth.py"],
    "diff": "...",
    "forgekin_id": "fk_devforge_architect_001"
  },
  "instruction": "请审查以下代码变更，重点关注安全性和可维护性",
  "timeout_seconds": 300,
  "expected_format": "structured_review"
}
```

**验收标准**：
- AC-30: Bridge 目录自动创建（bridge/tasks/ + bridge/responses/）
- AC-31: 任务 JSON Schema 校验，无效格式拒绝
- AC-32: 轮询超时默认 300s，可配置
- AC-33: Trae 响应写入后，Forgekin 主动感知并继续主流程
- AC-34: Trae 不参与时（无响应），降级到 FlowForge 内置 Agent

***

## 第十章：炉灵协作与 IM 需求

### 10.1 FR-EVO-09：A2A 通信协议

**需求描述**：炉灵间的即时通讯协议，对标 clowder-ai F002 Agent-to-Agent。

**协议核心**：
- **@mention 路由**：`@devforge:architect 请审查这个设计`
- **Thread isolation**：每个 conversation 在独立 thread 中，避免污染
- **Structured handoff**：结构化任务交接，含上下文和验收标准

**A2A 消息结构**：

```python
@dataclass
class A2AMessage:
    message_id: str
    from_forgekin: str  # 发送方 forgekin_id
    to_forgekin: str | List[str]  # 接收方（@mention 解析）
    thread_id: str  # 线程隔离
    mention: Optional[Mention]  # @mention 解析结果
    content: str  # 消息内容
    artifacts: List[Artifact]  # 附件（代码/文档/图片）
    handoff: Optional[Handoff]  # 结构化交接
    timestamp: datetime
    trace_id: str  # 全链路追踪
```

**验收标准**：
- AC-35: @mention 解析支持 `@项目前缀:角色名` 格式
- AC-36: Thread isolation 保证不同 conversation 上下文不污染
- AC-37: Handoff 包含 context_snapshot + acceptance_criteria
- AC-38: 所有 A2A 消息记录到审计日志，trace_id 全链路传播

### 10.2 FR-EVO-10：灵议（Forgekin Council）—— IM 多渠道

**需求描述**：炉灵间的团队协作 IM 系统，对标 clowder-ai IM 团队协作。Web Chat 升级为"灵议"，对接多种 IM 工具。

**多渠道架构**：

| 渠道 | 用途 | 默认状态 | 对接方式 |
|------|------|---------|---------|
| **Web Chat（灵议）** | 主渠道，FlowForge/DevForge Web UI | 启用 | WebSocket + SSE |
| **飞书** | 团队协作通知、审核提醒 | 可选 | 飞书开放平台 API |
| **微信** | 个人号备用通知 | 可选 | 微信公众号/个人号 |
| **Slack** | 国际团队协作 | 可选 | Slack Webhook |
| **Discord** | 社区协作 | 可选 | Discord Bot |
| **GitHub PR** | 代码审查 routing | 可选 | GitHub Webhook |

**灵议（Web Chat）升级**：
- 从单用户对话升级为多炉灵议事厅
- 支持查看所有炉灵的实时状态、对话、日记
- 支持 operator 参与/旁观/干预
- 支持发起 Kinship 协作任务

**验收标准**：
- AC-39: Web Chat 升级为灵议，支持多炉灵同时在线
- AC-40: 飞书渠道支持消息推送和接收（至少文本+卡片）
- AC-41: 渠道配置通过 `config/a2a_channels.yaml`，支持热重载
- AC-42: 跨渠道消息同步（同一 thread 在不同渠道可见）
- AC-43: operator 可在任何渠道发起/审批/干预任务

### 10.3 FR-EVO-11：两类智能体无缝衔接

**需求描述**：Forgekin 调用 Static Agent 的契约和路由机制。

**衔接契约**：

```python
class ForgekinStaticBridge:
    """炉灵与静态智能体的衔接桥"""
    
    async def delegate_to_static(
        self,
        static_agent_name: str,  # 如 "devforge:coder"
        input: AgentInput,
        context_snapshot: dict,
        acceptance_criteria: dict
    ) -> AgentOutput:
        """炉灵委托静态智能体执行子任务"""
        # 1. 路由到 AgentRegistry
        # 2. 执行静态智能体
        # 3. 结果回写到 Soul Echo
        # 4. 更新 Soul Imprint
```

**验收标准**：
- AC-44: Forgekin 可通过 `delegate_to_static()` 调用任何已注册的静态智能体
- AC-45: 静态智能体不知道 Forgekin 的存在（单向依赖）
- AC-46: 委托结果自动写入 Soul Echo 作为 Episode
- AC-47: 委托失败时 Forgekin 可选择重试/降级/升级

***

## 第十一章：*Forge 自进化统一规格

### 11.1 所有 *Forge 的自进化能力

**核心原则**：所有 *Forge 项目（ContentForge/DevForge/NovelForge/MallForge/StockForge）组合和继承 FlowForge 后，都具备自我进化能力，只是业务方向和 Web UI 不一样。

**统一能力清单**（每个 *Forge 都必须支持）：

| 能力 | 说明 | 业务方向差异 |
|------|------|------------|
| 炉灵身份 | Forgekin 注册和管理 | 每个 *Forge 有自己的炉灵角色 |
| 魂忆 | 跨会话记忆 | 记忆内容是业务领域知识 |
| 魂印 | 对操作者的认知 | 认知维度按业务定制 |
| 自锻 | 无人时自主思考 | 思考内容是业务问题 |
| 锻典 | 可复用知识 | 知识是业务方法论 |
| Skill 自生成 | 三模式自进化 | Skill 是业务技能 |
| A2A | 炉灵间协作 | 跨 *Forge 协作（如内容→发布） |
| 灵议 | IM 团队协作 | 业务通知和审批 |
| 外部工具 | CLI Wrapper | 编码工具调用 |
| Trae Bridge | 监工模式 | Trae 参与业务决策 |

### 11.2 各 *Forge 的炉灵角色示例

| 项目 | 炉灵角色 | 业务方向 |
|------|---------|---------|
| **FlowForge** | fk_master（框架守护者） | 框架自我进化、通用能力提升 |
| **DevForge** | fk_architect, fk_coder, fk_reviewer | 代码架构、编码、审查的自我进化 |
| **ContentForge** | fk_writer, fk_researcher, fk_seo_expert | 内容创作、研究、SEO 的自我进化 |
| **NovelForge** | fk_plot_architect, fk_character_designer, fk_chapter_writer | 小说创作的自我进化 |
| **MallForge** | fk_product_lister, fk_marketing_strategist | 电商运营的自我进化 |
| **StockForge** | fk_analyst, fk_risk_manager | 投资分析的自我进化 |

### 11.3 跨 *Forge 协作场景

**场景 1：内容创作 → 多平台发布**
```
ContentForge:fk_writer（创作文章）
  → @MallForge:fk_product_lister（适配电商文案）
  → @ContentForge:fk_seo_expert（SEO 优化）
  → Static Agent:publish（多平台发布）
```

**场景 2：代码开发 → 文档同步**
```
DevForge:fk_architect（设计架构）
  → @DevForge:fk_coder（编码实现）
  → @DevForge:fk_reviewer（代码审查）
  → Static Agent:doc_writer（文档生成）
  → ContentForge:fk_writer（技术博客）
```

**场景 3：自锻群体协作**
```
夜间低活动期：
  DevForge:fk_architect + ContentForge:fk_writer + NovelForge:fk_plot_architect
  → 进入自锻群
  → 读各自留痕
  → 画线发现跨域关联（如代码架构思想可迁移到小说大纲）
  → 产出日记 + Soul Imprint proposal
```

### 11.4 *Forge 自进化的独立方向

每个 *Forge 的炉灵向自己的业务方向独自自我进化：

| *Forge | 自进化方向 | 衡量指标 |
|--------|----------|---------|
| FlowForge | 框架能力提升、新模式/Skill 沉淀 | 配置驱动率、模式数量、Skill 数量 |
| DevForge | 代码质量、架构决策准确率 | DCP 通过率、代码审查一致性 |
| ContentForge | 内容质量、平台适配率 | SOP 完成率、发布成功率 |
| NovelForge | 章节一致性、伏笔回收率 | 一致性得分、Reflexion 收敛轮数 |
| MallForge | 商品上架率、营销转化率 | 上架成功率、CTR |
| StockForge | 预测准确率、风险识别 | 回测收益率、风险事件识别率 |

***

## 第十二章：非功能需求与 SLO（v7.0 新增）

### 12.1 自进化性能 SLO

| 组件 | 指标 | 目标 |
|------|------|------|
| Auto-Forge 单次自锻 | 端到端（含 LLM） | < 5min |
| Soul Echo 写入 | 单 Episode | < 100ms |
| Soul Echo 检索 | 相关性检索 | < 500ms |
| Skill 自生成 | Draft 生成 | < 30s |
| Skill 验证 | 5 case replay | < 10min |
| A2A 消息路由 | @mention 解析 | < 50ms |
| Trae Bridge 轮询 | 单次轮询 | < 1s |
| CLI Wrapper 调用 | 单次任务 | < 5min |

### 12.2 自进化安全红线

| # | 红线 | 说明 |
|---|------|------|
| **SR-01** | 禁止后台 classifier | Soul Imprint 必须基于显式行为，继承 clowder-ai no-classifier 红线 |
| **SR-02** | 禁止 Goodhart | 自锻 telemetry-not-KPI，价值是少量高信号 consolidation 非日报 KPI |
| **SR-03** | Provoke 频率硬限 | 每天 ≤1，hyperfocus=0，连拍 3 次冬眠 |
| **SR-04** | 高风险域升级 | action_confidence < 0.85 时只做结构化分析 + 明确升级 |
| **SR-05** | E6 创建炉灵需 operator 授权 | 防止炉灵失控自我复制 |
| **SR-06** | 外部工具调用需 worktree 隔离 | 禁止直接操作主分支 |
| **SR-07** | Trae Bridge 超时降级 | 无响应时降级到内置 Agent，不阻塞主流程 |
| **SR-08** | 跨 *Forge 协作需 operator 可见 | 所有 A2A 消息可审计、可追溯 |

### 12.3 配置驱动率目标（v7.0）

| 维度 | v6.0 现状 | v7.0 目标 |
|------|----------|----------|
| Agent 驱动率 | ~15% | ≥90%（含炉灵 YAML 化） |
| Tool 驱动率 | ~10% | ≥70% |
| Workflow 驱动率 | ~25% | ≥95% |
| Prompt 驱动率 | ~30% | ≥95% |
| **Skill 驱动率** | 0% | ≥80%（炉灵自生成的 Skill） |
| **Forgekin 驱动率** | 0% | ≥60%（炉灵配置 YAML 化） |

### 12.4 可观测性指标（v7.0 新增）

| 指标名 | 类型 | 描述 |
|--------|------|------|
| `forgekin_active_total{project}` | gauge | 活跃炉灵总数 |
| `forgekin_ascension_stage{forgekin_id}` | gauge | 当前升华阶段 |
| `auto_forge_runs_total{forgekin_id}` | counter | 自锻运行次数 |
| `auto_forge_duration_seconds` | histogram | 自锻耗时 |
| `soul_echo_episodes_total{forgekin_id}` | counter | Episode 记录数 |
| `skill_authored_total{forgekin_id, status}` | counter | Skill 创作数（按状态） |
| `a2a_messages_total{from, to}` | counter | A2A 消息数 |
| `external_tool_calls_total{tool, status}` | counter | 外部工具调用数 |
| `trae_bridge_tasks_total{status}` | counter | Trae Bridge 任务数 |
| `provoke_fired_total{forgekin_id}` | counter | Provoke 推送数 |
| `provoke_reaction_rate{reaction}` | ratio | Provoke 反应率（拍扁/戳破/有用） |

***

## 第十三章：v7.0 路线图

### 13.1 分阶段交付

| Phase | 内容 | 核心交付 | 优先级 |
|-------|------|---------|--------|
| **Phase 6.1** | 炉灵基础设施 | Forgekin 身份 + Soul Echo + Soul Imprint + 升华阶段 | P0 |
| **Phase 6.2** | 自锻引擎 | Auto-Forge Engine + 日记本 + Provoke + 锻典 | P0 |
| **Phase 6.3** | 外部工具集成 | CLI Wrapper（Claude/Codex/OpenCode）+ Trae Bridge | P0 |
| **Phase 6.4** | IM 与协作 | A2A 协议 + 灵议 Web Chat 升级 + 飞书渠道 | P0 |
| **Phase 6.5** | Skill 自生成 | 三模式自进化 + 五级火种阶梯 + Eval Ledger | P1 |
| **Phase 6.6** | *Forge 自进化 | 各 *Forge 炉灵角色 + 业务方向进化 | P1 |
| **Phase 6.7** | 元认知与治理 | 元认知能力 + 跨模型评审 + 炉灵治理 | P2 |

### 13.2 里程碑验收

| 里程碑 | 验收标准 | 预期 |
|--------|---------|------|
| **M1: 炉灵诞生** | 创建第一个 E1 炉灵，完成 Forge Initiation，可执行任务并记录 Episode | Phase 6.1 完成 |
| **M2: 首次自锻** | 炉灵在低活动期触发自锻，产出第一篇日记 + Soul Imprint proposal | Phase 6.2 完成 |
| **M3: 外部工具调用** | 炉灵通过 CLI Wrapper 调用 Claude Code 完成代码任务 | Phase 6.3 完成 |
| **M4: 灵议上线** | Web Chat 升级为灵议，多炉灵同时在线协作 | Phase 6.4 完成 |
| **M5: Skill 自生成** | 炉灵自主创建第一个 Skill 并通过 Eval Ledger 验证 | Phase 6.5 完成 |
| **M6: *Forge 自进化** | DevForge 和 ContentForge 各有 ≥1 个 E3+ 炉灵 | Phase 6.6 完成 |
| **M7: 元认知上线** | 炉灵具备元认知能力，不信单次自信度 | Phase 6.7 完成 |

***

## 附录 O：v7.0 与 clowder-ai 方法论对照表

| clowder-ai 概念 | FlowForge v7.0 对应 | 适配差异 |
|----------------|---------------------|---------|
| Cat（猫猫） | Forgekin（炉灵） | 命名差异，本质相同 |
| Clowder（猫群） | Kinship（灵族） | 命名差异 |
| Bootcamp | Forge Initiation | 训练内容适配 FlowForge 规范 |
| Swarm | Resonance | 协作模式相同 |
| Auto-Dream（F255） | Auto-Forge | 双层架构相同，触发条件适配 |
| F100 Self-Evolution | Skill 自生成（三模式） | 三模式完全对标 |
| F002 Agent-to-Agent | A2A 通信协议 | 协议相同 |
| F037 Agent Swarm | Kinship 协作 | 群体协作相同 |
| F253 QC Loop | 跨模型评审 | 评审机制相同 |
| Memory（F102） | Soul Echo | 三层记忆对标 MemGPT |
| Profile Capsule（F231） | Soul Imprint | 双层结构相同 |
| Skill Library | Forge Codex | 五级阶梯相同 |
| L0-L4 Knowledge | Ember Hierarchy | 五级火种相同 |
| writing-skills | Skill 自生成 | 三机制闭环相同 |
| merge-gate | 合入门禁 | 5 硬条件 + E1-E5 相同 |
| worktree | 工作区隔离 | worktree 模式相同 |
| IM 团队协作 | 灵议（Forgekin Council） | 多渠道对接 |
| Claude Code/Codex 调用 | CLI Wrapper | 完全相同 |
| —（无对应） | Trae 监工 Bridge | FlowForge 独有，因 Trae 无 CLI |

## 附录 P：v7.0 待用户审核决策点

| # | 决策点 | 选项 | 推荐 | 理由 |
|---|--------|------|------|------|
| **D1** | 炉灵命名体系 | A. 炉灵 Forgekin / B. 匠灵 Artisan / C. 锻灵 Forgespirit | A | 与 FlowForge 的"炉"一脉相承，"灵"体现独立性 |
| **D2** | 自锻触发时机 | A. 仅夜间 / B. 多条件（推荐）/ C. operator 手动 | B | 对标 clowder-ai 多条件触发 |
| **D3** | IM 主渠道 | A. Web Chat 灵议（推荐）/ B. 飞书 / C. 微信 | A | Web Chat 是 FlowForge 原生，体验最佳 |
| **D4** | 外部工具优先级 | A. FlowForge 内置优先 / B. 外部 CLI 优先 / C. 炉灵自决策 | C | 炉灵根据任务复杂度自决策 |
| **D5** | Trae 参与深度 | A. 仅 fallback / B. 关键节点参与（推荐）/ C. 全程参与 | B | 平衡性能和 Trae 价值 |
| **D6** | 跨 *Forge 协作 | A. 禁止 / B. operator 审批 / C. 自由协作（推荐） | C | 对标 clowder-ai 自由协作 |
| **D7** | 炉灵创建权限 | A. 仅 operator / B. E5+ 可创建 / C. E6 可创建（推荐） | C | 对标 clowder-ai operator 级别 |
| **D8** | 自锻日记公开性 | A. 仅 operator 可见 / B. 炉灵间可见（推荐）/ C. 全公开 | B | 促进跨域学习 |
| **D9** | Skill 晋升审批 | A. 全自动 / B. operator 审批（推荐）/ C. E5+ 审批 | B | 防止低质 Skill 污染 |
| **D10** | 元认知严格度 | A. 宽松 / B. 标准（推荐）/ C. 严格 | B | 平衡效率和稳健 |

> **审核请求**：请 operator 审核本规格文档，特别是第十三章路线图和附录 P 决策点。审核通过后将进入架构设计（arch.md）和详细设计（design.md）阶段。

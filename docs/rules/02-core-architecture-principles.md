# 第二部分：核心架构原则

> **来源**：原 `hiclaw/rules.md` 第二部分
> **关联**：[doc:rules/01-architecture-overview.md]（架构总览） | [doc:rules/08-flowforge-boundary.md]（FlowForge 边界验证）

---

## 2.1 核心铁律：配置驱动 > 代码继承 > 独立实现

**优先级**（递减）：
1. **配置驱动**（最佳）：通过YAML/JSON配置声明Agent/Tool/Workflow/Skill/MCP，零Python代码
2. **代码继承**（次之）：继承FlowForge基类重写方法 — 说明FlowForge配置能力不足，需改进框架
3. **独立实现**（禁止）：自己从零实现编排/存储/LLM调用等 — 严重违反架构原则

## 2.2 原则1：所有数据检索走OpenSieve

1. **所有数据检索必须通过OpenSieve**，包括结构化数据和非结构化数据
2. OpenSieve提供统一的数据检索接口：
   - **结构化数据源**（通过DataSource协议注册）：如A股行情、基金净值、电商商品数据
   - **非结构化检索**（通过SearchSource协议）：如公告/研报/新闻/知识库
   - **爬虫框架**（Playwright反检测）
   - **多源融合**（RRF排序）
3. **禁止绕过OpenSieve直接访问数据库或外部API**
4. StockForge的股票数据、ContentForge的素材检索、NovelForge的知识库、MallForge的商品数据等都必须通过OpenSieve

## 2.3 原则2：所有Agent通过LoopExecutor执行（P31铁律）

1. LoopExecutor是所有Agent的**唯一执行入口**
2. 调用方式：`sdk.loop_executor.run(loop_name=..., task_context=...)`
3. LoopExecutor包装HybridExecutor，每次迭代通过HybridExecutor执行
4. Harness Hook每次迭代触发（pre_execute注入上下文，post_execute架构约束校验）
5. 质量分阈值**0.85**（v4.0: 由0.9调整为0.85，平衡质量与可用性）
6. Loop超时分档铁律：
   - **快速 Loop**（screening/news_summary/快速分析）：**180秒**
   - **内容 Loop**（deep_article/content_polish/fact_check/publish/code_review）：**720秒**
   - **长文 Loop**（series_article）：**7200秒**
7. 嵌套Loop最大深度**3**

## 2.4 原则3：单向依赖

- 上层可依赖下层，**下层绝对禁止导入上层模块**
- FlowForge完全独立，对上层集成方无依赖无感知
- *Forge通过Plugin协议注册到FlowForge，不修改FlowForge核心代码

## 2.5 原则4：Plugin注册规则

所有 *Forge 项目通过继承 **FlowForgePlugin** 实现注册：

**标准钩子**（PluginProtocol已定义）：
- `register_agents()` — 注册所有Agent
- `register_tools()` — 注册所有Tool
- `register_loops()` — 注册Loop配置（**注意：不是register_workflows**）
- `register_workflows()` — 注册Workflow
- `register_routes()` — 注册API路由
- `register_schedules()` — 注册定时任务
- `register_event_handlers()` — 注册事件处理器
- `register_gates()` — 注册质量门禁
- `register_evaluators()` — 注册评估器
- `on_startup()` / `on_shutdown()` — 生命周期

**死代码警告**：
- ❌ `register_helm_handlers` — FlowForge PluginProtocol **未定义**此钩子（FW-CONSIST-001），实现了也不会被调用
- ❌ `register_permission_policy` — FlowForge PluginProtocol **未定义**此钩子（FW-CONSIST-002），实现了也不会被调用
- 如需事件订阅，使用 `register_event_handlers` 替代 `register_helm_handlers`
- 如需权限策略，使用 `register_gates` 替代 `register_permission_policy`

## 2.6 原则5：十大架构原则（FF17）

1. **底座能力原则**：至少2个上层应用需要的能力才可下层到FlowForge
2. **单向依赖原则**：上层可依赖下层，下层禁止导入上层
3. **配置外置原则**：所有密钥/路径/环境相关配置通过配置系统注入
4. **真实实现原则**：禁止假数据、假逻辑、模拟返回
5. **依赖注入原则**：禁止绕过DI容器直接实例化
6. **数据访问原则**：禁止直接操作数据库，必须通过Repository层
7. **接口隔离原则**：所有抽象基类在 `core/interfaces/` 中定义
8. **可观测性原则**：日志自动注入trace_id，所有I/O使用async/await
9. **开箱即用原则**：预制Workflow/Agent/Model配置
10. **循环依赖零容忍原则**

## 2.7 FlowForge 核心能力概览

### 9大执行模式
1. **react** — Thought→Action→Observation循环（MAX_STEPS=8）
2. **plan_execute** — Planner生成步骤清单，Executor依次执行
3. **reflexion** — Actor→Evaluator→Reflector三Agent迭代（MAX_ITERATIONS=4）
4. **multi_agent** — Subagents/Teams/Swarms三种子策略
5. **workflow** — 预定义DAG流程（混合模式，max_depth=3）
6. **rewoo** — 一次性规划所有工具调用，批量执行
7. **self_discover** — 任务前自动发现最佳推理结构
8. **agent_judge** — 独立Agent作为评判者
9. **graph_of_thoughts** — 图式推理，多思路聚合交叉验证

### Harness四根护栏
1. **上下文工程**（ContextEngine）— AGENTS.md动态知识注入
2. **架构约束**（ArchitectureConstraintEngine）— 分层依赖检查
3. **反馈循环**（FeedbackLoop）— 四维评分 + 分类闸门 + 三种评估模式
4. **熵管理**（EntropyManager）— 文档园丁Agent + 技术债跟踪 + 规则进化

### Loop Engine五层模块
1. **Planner**（3种模式：plan_execute/self_discover/llm_direct）
2. **Worker**（复用HybridExecutor，mode=workflow/agent/loop嵌套，最大深度3）
3. **Verifier**（4种模式：agent_judge/rule_based/schema/test_suite）
4. **Reflector**（2种模式：reflexion/trace_analysis）
5. **Memory**（5种映射：working/short_term/long_term/semantic/episodic）

### Memory系统5种记忆策略
Working / Short-term / Long-term / Semantic / Episodic + TaskBoard + Mailbox + CheckpointManager + ContextCompressor

---

> **本文件来源**：原 `hiclaw/rules.md` 第二部分 核心架构原则

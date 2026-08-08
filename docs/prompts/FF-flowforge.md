# FlowForge 模板（FF1-FF26 + v7.0 增补 FF22-FF23）

> **用途**：FlowForge（核心 Harness 平台）专用提示词模板。
> **适用项目**：FlowForge
> **引用**：`[doc:prompts/FF-flowforge.md#FFXX]`

---

## 2.1 执行引擎

### FF1 十大模式验证

```
请逐一验证FlowForge的10大执行模式是否正常工作：
1. react — Thought->Action->Observation循环，验证循环检测和MAX_STEPS=8
2. plan_execute — Planner生成步骤清单，Executor依次执行
3. reflexion — Actor->Evaluator->Reflector三Agent迭代，验证MAX_ITERATIONS=4
4. multi_agent — Subagents/Teams/Swarms三种子策略
5. workflow — 预定义DAG流程，验证混合模式和max_depth=3
6. rewoo — 一次性规划所有工具调用，批量执行
7. self_discover — 任务前自动发现最佳推理结构
8. agent_judge — 独立Agent作为评判者
9. graph_of_thoughts — 图式推理，多思路聚合交叉验证
10. loop — 规划→执行→校验→复盘→重试闭环，Loop是模式的上层管理者
每个模式用真实LLM调用验证，禁止Mock。
```

### FF2 模式智能推荐验证

```
请验证ModeRegistry的智能推荐功能：
1. 输入不同类型的任务，检查是否推荐了合适的模式
2. 验证mode_hint参数是否正确覆盖自动推荐
3. 验证Self-Discover模式是否能自动发现最佳推理结构
4. 测试模式降级：当推荐模式执行失败时，是否自动降级到备选模式
```

## 2.2 Harness 驾驭层

### FF3 四根护栏验证

```
请验证FlowForge Harness驾驭层的四根护栏是否正常工作：
1. 上下文工程(ContextEngine) — AGENTS.md动态知识注入、历史失败案例检索、会话交接物构建
2. 架构约束(ArchitectureConstraintEngine) — 分层依赖检查、自定义Linter规则、CI门禁
3. 反馈循环(FeedbackLoop) — 独立评判Agent、四维评分、分类闸门、三种评估模式(full/lightweight/skip)
4. 熵管理(EntropyManager) — 文档园丁Agent、技术债跟踪器、规则进化器
每个护栏用真实场景验证，确保pre_execute和post_execute Hook点正常触发。
```

### FF4 反馈循环深度验证

```
请深度验证FeedbackLoop的三种评估模式：
1. full模式：四维评分(Design Quality/Originality/Craft/Functionality) + 分类闸门，验证2次LLM调用
2. lightweight模式：仅分类闸门，验证1次LLM调用
3. skip模式：跳过外环，验证内环Reflexion仍生效
4. 验证外环FAIL直接降级不回内环的串行逻辑
5. 验证灰度开关(config/harness_v6.yaml)是否正确控制Harness启用/禁用
```

## 2.3 Loop Engine（闭环引擎）

> **核心设计文档**：`flowforge/docs/loop.md`
> **核心原则**：Loop 不是新模式，而是模式的上层管理者。LoopExecutor 包装 HybridExecutor，为任意模式添加规划→执行→校验→复盘闭环。
> **铁律**：对照 loop.md 设计文档逐项验证，发现偏差即 Bug。

### FF4a Loop Engine 核心验证

```
请对照 flowforge/docs/loop.md 设计文档，逐项验证 Loop Engine 实现：
1. LoopExecutor 包装 HybridExecutor — 每次迭代通过 HybridExecutor 执行
2. Harness Hook 每次迭代触发 — pre_execute 注入上下文，post_execute 架构约束校验
3. ContextEngine 增量注入 — 首次完整注入，后续仅注入 delta（反思结果）
4. Loop Verifier 与 Harness FeedbackLoop 互补 — 分别负责业务级和架构级校验
5. 独立 LoopState — 不修改 TaskContext，通过 CheckpointManager 持久化
6. Persona Lock 整个 Loop 期间持有 — 不在迭代之间释放
7. 嵌套深度通过 task.metadata 传递 — 禁止用类变量追踪（并发不安全）
8. 失败转化为规则 — EntropyManager.debt_tracker.record() + RuleEvolution.propose()
9. Loop 事件协议 — 7种 loop.* 事件正确发射
10. 回退机制 — Loop 失败时退化为单次 HybridExecutor 执行
每个验证项用真实场景测试，发现与设计文档不一致即记录为 Bug。
```

### FF4b Loop 五层模块验证

```
请验证 Loop Engine 的五层模块是否按 loop.md 设计文档实现：
1. Planner（规划器）— 三种模式：plan_execute / self_discover / llm_direct
   - 验证 plan() 根据模式生成不同类型的计划
   - 验证 replan() 根据反思结果和错误历史调整计划
   - 验证 LLM 调用失败时降级为默认计划
2. Worker（执行器）— 复用 HybridExecutor，三种模式：workflow / agent / loop（嵌套）
   - 验证 worker.mode=workflow 时委托 HybridExecutor
   - 验证 worker.mode=loop 时嵌套子 Loop（最大深度3）
   - 验证 worker.mode=parallel 时并行 Worker 执行
3. Verifier（校验器）— 四种模式：agent_judge / rule_based / schema / test_suite
   - 验证 agent_judge 模式使用 FeedbackLoop 评分
   - 验证 rule_based 模式支持7种规则类型
   - 验证 schema 模式校验 JSON 结构（如已实现）
   - 验证 test_suite 模式运行测试套件（如已实现）
4. Reflector（复盘器）— 两种模式：reflexion / trace_analysis
   - 验证 reflexion 模式调用 LLM 做根因分析
   - 验证 trace_analysis 模式分析执行轨迹（如已实现）
5. Memory（记忆器）— 五种映射：working / short_term / long_term / semantic / episodic
   - 验证 memory.memory_mapping 配置被 LoopExecutor 读取和使用
   - 验证失败教训写入 LongTermMemory
   - 验证规则进化结果写入 SemanticMemory
   - 验证执行轨迹写入 EpisodicMemory
每个模块用真实数据和真实 LLM 调用验证。
```

### FF4c Loop 模板与API验证

```
请验证 Loop 模板和 API 是否按 loop.md 设计文档实现：
1. LoopRegistry — 从 config/loops/ 加载 YAML 模板
2. YAML Schema — 验证所有字段与设计文档一致
3. 超时控制 — timeout_per_iteration 和 total_timeout 是否生效
4. 退避策略 — fixed / linear / exponential 三种策略
5. REST API — 6个端点：
   - POST /api/v1/loops — 创建 Loop 并启动执行（不只是写数据库）
   - GET /api/v1/loops/{loop_id} — 查询状态
   - POST /api/v1/loops/{loop_id}/stop — 手动停止
   - GET /api/v1/loops/{loop_id}/history — 迭代历史
   - GET /api/v1/loop-templates — 模板列表
   - GET /api/v1/loop-templates/{name} — 模板详情
6. DB Schema — loops 表 + loop_iterations 表
7. 嵌套 Loop — Worker 引用另一个 Loop 模板，最大深度3
8. 并行 Worker — asyncio.gather + 独立 TaskContext 副本
每个端点用真实请求验证，确保 Loop 执行而非仅 CRUD。
```

### FF4d Loop 与上层项目集成验证

```
请验证 Loop Engine 与上层项目的集成是否正确：
1. FlowForge SDK — loop_executor 属性、create_loop_template() 方法、bootstrap() 自动初始化
2. NovelForge — 8大创作阶段是否默认使用 Loop 执行
   - 概念孵化 → novel-concept-loop
   - 章节写作 → novel-chapter-loop
   - 章节审核 → novel-review-loop
   - 润色 → novel-polish-loop
3. ContentForge — 4种创作流程是否默认使用 Loop 执行
   - 深度文章 → deep-article-loop
   - 内容润色 → content-polish-loop
   - 事实核查 → fact-check-loop
   - 发布 → publish-loop
4. DevForge / MallForge — 是否已集成 Loop
5. Loop 作为默认执行流程 — 当 loop_executor 可用且有对应模板时自动使用
6. 向后兼容 — loop_executor 不可用时退化为 HybridExecutor 直接执行
每个集成点用真实任务端到端验证。
```

### FF4e Loop 设计偏差审查

```
请对照 flowforge/docs/loop.md 设计文档，审查当前代码是否存在以下已知偏差：
1. [P0] 嵌套深度用类变量追踪而非 task.metadata — 并发不安全
2. [P0] Persona Lock 未实现 — Loop 迭代期间应持有 Persona 锁
3. [P0] Loop 被实现为第10种模式而非"模式的上层管理者" — 与设计文档矛盾
4. [P1] Memory 五种映射未实现 — memory 配置定义了但 LoopExecutor 不读取
5. [P1] 超时控制未实现 — timeout_per_iteration 和 total_timeout 形同虚设
6. [P1] API 端点只做 CRUD 不触发执行 — POST /loops 应调用 LoopExecutor.run()
7. [P1] 缺少 loop_iterations 表 — 无迭代历史持久化
8. [P1] Loop 失败无回退机制 — 应退化为单次 HybridExecutor 执行
9. [P1] Verifier 缺少 schema 和 test_suite 模式
10. [P2] Planner 不区分三种模式
11. [P2] Reflector 缺少 trace_analysis 模式
12. [P2] 前端 Loop 可视化未实现
13. [P2] 规则进化闭环未完成 — RuleEvolution 结果未自动注入 ContextEngine
对每个偏差给出修复方案和优先级，然后按优先级逐一修复。
```

## 2.4 Helm 交互

### FF5 Helm 界面优化

```
目前web框架中Helm界面还是存在比较多的问题，你联网搜索trae cn helm桌面版的能力，
比较下我们和之间的差距，理解下我们项目文档 flowforge/docs 的设计文档，
深度理解我们代码，看下除了Helm外，和trae cn helm在代码agent和其他agent之间的差距，
然后规划优化方向，对我们的flowforge进一步优化基础能力和web功能。
```

### FF6 Helm 交互验证

```
你现在去浏览器打开 http://localhost:5174/helm，验证新架构下：
1. 工作区名称是否正确显示
2. 任务列表是否只包含当前工作区的任务
3. 步骤进度条和节点状态是否同步
4. 长时间运行的复杂任务中是否会出现UI卡死或状态不同步
```

### FF7 Helm 复杂消息测试

```
在 Helm 界面发送一条包含代码生成和文件写入的复杂消息，验证：
1. 工作区文件是否被正确创建
2. 资源管理器是否自动高亮了新文件
3. 工具调用链路和UI展示是否完全流畅
4. 输出框节点中workflow、agent、llm调用、tool调用是否有小图标
```

### FF8 Helm WebSocket E2E

```
请验证Helm模式的WebSocket端到端流程：
1. 建立WebSocket连接 /ws/helm/{task_id}
2. 发送创作任务，验证16种Helm事件是否正确推送
3. 在审核节点暂停，验证interrupt_before=["review"]是否生效
4. 通过Command(resume=...)恢复任务
5. 验证事件类型映射：FlowForge 17种事件 -> Helm 16+种事件
6. 检查WebSocket心跳和断线重连是否正常
```

## 2.5 能力层

### FF9 模型配置管理

```
当前flowforge中的模型配置，只需要配置openroute和openrouter两个供应商。
openroute作为预制默认模型进行配置管理，用户不可删除不可修改。
openrouter作为自定义模型进行配置管理。
请按trae cn的模型管理界面开发，参考他们搞简洁一些，但是配置要是有效的。
```

### FF10 插件与事件总线

```
请按照Phase 1的规划，先实现统一插件协议和增强事件总线，把两套体系合并。
完成后继续实现剩余3个阶段。你需要整体规划下，逐步完成。
```

### FF11 Skill系统验证

```
请验证FlowForge的Skill系统：
1. 四种格式兼容：FlowForge / Claude Code / Anthropic / Trae CN
2. 双层加载：全局Skill(~/.flowforge/skills/) + 项目Skill(./.flowforge/skills/)
3. Skill组合技(Combo Skills)：多Skill管道编排
4. 触发器匹配：自然语言触发词自动匹配，置信度评分
5. Skill版本管理：语义化版本 + 依赖管理
每个功能用真实Skill文件验证，禁止Mock。
```

### FF12 MCP四层架构验证

```
请验证FlowForge的MCP模块四层架构：
1. L1 MCP Client：JSON-RPC 2.0 + stdio/Streamable HTTP双传输
2. L2 MCP Gateway：工具白名单 + Token预算管理 + 速率限制 + 权限管线
3. L3 MCP Broker：多服务器聚合 + 动态路由 + 熔断/重试
4. L4 MCP Tool Adapter：自动转换为FlowForge BaseTool + 流式执行
连接一个真实的MCP服务器（如filesystem或web-search）端到端验证。
```

### FF13 Memory系统验证

```
请验证FlowForge的Memory系统5种记忆策略：
1. Working Memory — 当前任务上下文
2. Short-term Memory — 会话级记忆
3. Long-term Memory — 持久化知识
4. Semantic Memory — 向量语义检索
5. Episodic Memory — 经验案例检索
同时验证：
6. TaskBoard：多Agent共享任务板，RETURNING子句原子认领
7. Mailbox：Agent间通信信箱，四级优先级 + 过期清理
8. CheckpointManager：增量保存 + 恢复 + 版本管理
9. ContextCompressor：tiktoken + 滑动窗口 + 92%阈值触发
```

## 2.6 安全体系

### FF14 十层安全防御验证

```
请验证FlowForge的10层安全防御体系：
L1 工具超时防御(120s) → L2 重复检测钩子 → L3 自修正重试(reflexion_retry)
→ L4 安全工具注册表 → L5 权限管线(deny->ask->allow)
→ L6 架构约束引擎 → L7 反馈循环闸门 → L8 熵管理
→ L9 MCP熔断与重试 → L10 审计追踪
每层用一个真实的攻击/异常场景验证防御是否生效。
```

### FF15 权限管线验证

```
请验证FlowForge的三层权限管线：
1. deny层级：危险操作直接拒绝（如rm -rf /、删除数据库）
2. ask层级：敏感操作需用户确认（如文件写入、API调用）
3. allow层级：安全操作自动通过（如只读查询）
4. 验证工具安全标记(safety_level: readonly/normal/dangerous)是否正确
5. 验证is_concurrency_safe标记是否正确
6. 验证Guardrails并行安全检查（InputGuardrail/OutputGuardrail）
```

## 2.7 架构原则

### FF16 底座与上层项目关系

```
flowforge 是通用智能体框架，可以完成所有contentforge、devforge、novelforge、mallforge中的任务。
contentforge、devforge、novelforge、mallforge是基于flowforge能力扩展的复杂场景专有智能体，
继承flowforge所有能力，尤其是在界面可视化上边更适合对应的专业场景，
其他基础能力都要复用flowforge的，相比flowforge就是多了更直观的界面操控。
```

### FF17 十大架构原则验证

```
请对照FlowForge十大架构原则，逐条审查代码是否遵守：
1. 底座能力原则：至少2个上层应用需要的能力才可下层到FlowForge
2. 单向依赖原则：上层可依赖下层，下层禁止导入上层
3. 配置外置原则：所有密钥/路径/环境相关配置通过配置系统注入
4. 真实实现原则：禁止假数据、假逻辑、模拟返回
5. 依赖注入原则：禁止绕过DI容器直接实例化
6. 数据访问原则：禁止直接操作数据库，必须通过Repository层
7. 接口隔离原则：所有抽象基类在core/interfaces/中定义
8. 可观测性原则：日志自动注入trace_id，所有I/O使用async/await
9. 开箱即用原则：预制Workflow/Agent/Model配置，无需繁琐配置即可运行
10. 循环依赖零容忍原则：发现循环依赖必须重构
对每条原则给出合规/不合规的判定和修复建议。
```

## 2.8 SDK与扩展

### FF18 SDK能力验证

```
请验证FlowForge SDK的核心能力：
1. FlowForgeSDK统一入口：懒初始化属性访问 + 装饰器注册
2. ModelCapabilityProvider：零配置模型访问，智能路由 + 降级容错
3. @tool装饰器：5行代码创建工具
4. Guardrails：并行安全检查，四种结果
5. Agent Handoff：LLM驱动的Agent间任务委托
6. MCP Integration：一键连接MCP服务器
7. Declarative Agent：纯配置Agent定义
8. Marketplace：插件市场（搜索/安装/卸载）
每个能力用真实代码验证，确保SDK可以独立使用。
```

### FF19 Agent Handoff验证

```
请验证FlowForge的Agent Handoff功能：
1. Agent A通过LLM决策将任务委托给Agent B
2. 验证委托时上下文是否正确传递
3. 验证委托后Agent A是否正确释放资源
4. 验证委托失败时的回退机制
5. 验证多级委托（A->B->C）是否正常工作
6. 验证委托链中的审计追踪是否完整
```

### FF20 Loop执行器集成验证

```
验证Loop执行器是否正确集成到FlowForge：
1. LoopExecutor是否为所有Agent的唯一执行入口
2. 创作Loop和润色Loop是否为两个独立接口
3. Loop多轮迭代是否真正执行（检查迭代日志）
4. 5个WebChat评委是否并行评审
5. 质量分阈值是否为0.85
6. Loop流程是否在3分钟内完成
7. 反馈提示词是否根据评委建议精准组合
8. 是否添加了CoT检测（禁止添加）
```

### FF21 SSE协议契约验证

```
验证SSE端点是否保持接口契约：
1. SSE端点不要改协议契约，保持接口
2. 如需增加参数，加一个参数即可，不要改协议
3. 验证SSE事件格式与前端兼容
4. 验证SSE断线重连机制
```

### FF22 React 模式工具调用规范（基于修复经验）

> 来源：React 模式 `_build_tool_schemas()` 修复经验。修复前工具调用成功率 0%，修复后 100%。

```
验证 React 模式 ReActExecutor 的工具调用是否正确：
1. _build_tool_schemas() 必须使用 ctx.tools.get_tool(name) 而非 ctx.tools.get(name)
   - get(name) 返回 None（ToolRegistry 无此方法）
   - get_tool(name) 返回 Tool 实例
2. 工具 schema 字段必须使用 tool.parameters_schema 而非 tool.parameters
   - parameters 是 BaseTool 的私有字段
   - parameters_schema 是 JSON Schema 兼容的 OpenAI function calling 格式
3. 验证 LLM 返回的 tool_calls 中 function.name 能在 ToolRegistry 中找到
4. 验证 tool_call.arguments 能正确反序列化为 Pydantic 模型
5. 验证工具执行结果通过 ToolMessage 回传给 LLM 进行后续推理
6. 禁止在 React 模式中直接 import 工具实现，必须通过 ToolRegistry.execute()
```

### FF23 声明式配置加载规则（基于修复经验）

> 来源：模型候选链解析修复经验。修复前裸模型 ID 被跳过（33% 可用率），修复后 100%。

```
验证声明式配置（YAML）是否被正确加载和解析：
1. 模型候选链中裸模型 ID（如 "Doubao-Seed2.0"）必须自动解析为 "provider/model_id" 格式
   - 通过 _resolve_model_candidates() 方法
   - 维护 model_to_provider 反向映射表
   - 已知 provider 前缀的模型直接保留（如 "openai/gpt-oss-*:free"）
2. 无 base_url 的模型必须通过 openrouter 网关调用（不跳过）
3. provider 健康状态必须实时更新（不允许 stale 标记）
4. 配置文件（models.yaml/llm_route.yaml）中的 timeout_seconds/max_retries/retry_delay_seconds 必须被实际消费
   - 禁止配置文件中存在未生效的字段（违反"配置驱动"铁律）
5. ERROR_COOLDOWNS 硬编码表必须与 llm_route.yaml 中 failover_conditions 一致
6. LLMClient 必须通过 RouteResolver 消费 FailoverPolicy，禁止绕过配置直接硬编码
```

### FF24 前后端适配规范（基于修复经验）

> 来源：前后端适配修复经验。修复前全站不可用（0%），修复后 100% 可用。

```
验证前后端 API 契约是否一致：
1. 代理配置：next.config.js 中 rewrites 必须指向正确的后端端口
   - FlowForge: 8000（非 8002 DevForge）
   - ContentForge: 8001
   - DevForge: 8002
2. 路由命名：导航 href 必须与 app/ 下的实际页面目录一致
   - /solo 对应 app/solo/page.tsx（不是 /helm）
   - /admin/models 对应 app/admin/models/page.tsx
3. API 响应解包：后端统一返回 {status, data: {items, total, ...}, meta}
   - 前端必须支持 data?.data?.items ?? data.items ?? data.tasks 兼容解包
   - 禁止假设响应直接是 {items: [...]} 格式
4. 审核接口参数格式：POST /api/v1/tasks/{id}/review 必须用 JSON body
   - 禁止用 query string 传递 verdict/feedback（会被截断或转义错误）
   - Content-Type: application/json
5. 列表返回格式：/api/v1/graph/agents 等端点可能直接返回数组（非 {data: {...}} 包装）
   - 前端/脚本必须处理 isinstance(d, list) 分支
```

### FF25 LLM 超时与回退机制规范（基于风险调研）

> 来源：LLM 超时/回退机制调研。识别 10 个风险点（3 个 P0 级）。

```
验证 LLM 调用的超时/重试/回退机制是否符合规范：
1. httpx 超时必须从配置读取，禁止硬编码
   - 当前问题：llm_client.py:925/949/1042 三处硬编码 timeout=300s
   - 配置文件 llm_route.yaml:22 写 timeout_seconds: 30（未生效）
   - 修复方向：区分 connect(10s)/read(30s)/write(10s)
2. CircuitBreaker 必须接入 LLM 调用路径
   - 当前问题：core/circuit_breaker.py 完整实现但 LLMClient 未 import
   - 修复方向：为每个 provider/model 维护熔断器，OPEN 状态时直接跳过候选
3. FailoverPolicy 配置必须被实际消费
   - 当前问题：llm/route.py:149-189 加载 max_retries/retry_delay 但 LLMClient 不调用 RouteResolver
   - 修复方向：LLMClient 持有 RouteResolver，按 agent_name 解析 route
4. 失败返回语义必须统一
   - 当前问题：execute() 返回 ToolOutput(content="", error=...)；stream() 抛 RuntimeError
   - 修复方向：统一为返回带 error 的 ToolOutput，或统一抛异常
5. 沉默失败必须消除
   - 当前问题：workflow_context.py:43-54 收到 error 后仍 return 空串，workflow 继续
   - 修复方向：LLMClient 在 error 非空时返回 content=None，强制调用方显式处理
6. 健康状态必须单一数据源
   - 当前问题：LLMClient._health_status 与 LLMRouter._models 双轨制，cooldown 阈值不一致
   - 修复方向：LLMClient 委托 LLMRouter 做健康判定
7. 同模型重试 + 指数退避
   - 当前问题：超时/服务器错误时直接换候选，无同模型重试
   - 修复方向：对 timeout/server_error 错误重试 1-2 次，指数退避
```

### FF26 OpenRoute 回退机制规范（基于风险调研）

> 来源：OpenRoute 回退机制调研。识别 10 个风险点（2 个严重级）。

```
验证 OpenRoute 服务回退机制是否符合规范：
1. _browser_available 标记必须与实际浏览器状态一致
   - 当前问题：_resolve_web_client 误将 _browser_available 重置为 True
   - 修复方向：增加对 bm._context/bm._page 的实际存活检测
2. SmartLLMRouter 必须接入主请求链路
   - 当前问题：smart_router.py 实现完整但未被 chat_completions 调用
   - 修复方向：将 SmartLLMRouter 作为统一调度入口
3. _browser_available 禁止过早置 True
   - 当前问题：app.py:222 在后台 task 启动前就置 True
   - 修复方向：后台 init 成功后再置 True
4. ApiProviderManager 与 ModelRouter 可用性判断必须一致
   - 当前问题：web/api 模型在 ApiProviderManager 中"始终可用"，但 ModelRouter 依赖 _browser_available
   - 修复方向：统一由 ModelRouter 作为可用性判断源
5. API 组件初始化必须有 try/except 保护
   - 当前问题：app.py:69-103 配置加载异常会冒泡到 startup，导致服务无法启动
   - 修复方向：对 config 加载做容错（默认空配置 + 警告日志）
6. WebChat 必须支持跨 provider 重试
   - 当前问题：webchat_channel.py:330-335 异常直接返回 refusal
   - 修复方向：失败时尝试其他 webchat provider（如 kimi-web → deepseek-web）
7. BrowserManager.init() 必须加锁保护
   - 当前问题：无 async with self._lock，并发调用可能重复启动浏览器
   - 修复方向：init() 加锁或用 once-flag
8. _kill_chrome_processes 必须改为异步执行
   - 当前问题：使用 os.system 阻塞事件循环
   - 修复方向：改用 asyncio.create_subprocess_exec
```

---

## v7.0 增补 FlowForge 模板（FF22-FF23 forgemind/三方 Agent 集成）

> **说明**：以下两个模板为 v7.0 增补的 FlowForge 专属模板，与上方 FF22/FF23（修复经验类）编号冲突但用途不同。引用时请按上下文区分，或在正式文档中重新编号为 FF27/FF28。
> **依据**: ADR 005 forgemind 应用层 + ADR 006 三方 Agent 集成 + ADR 012 命名融合

### FF22 forgemind 集成验证模板（v7.0 增补）

> **用途**: 验证 *Forge 是否正确通过 Plugin V3 四钩子注册可进化智能体到 forgemind
> **适用项目**: FlowForge + 所有 *Forge（contentforge/devforge/novelforge/mallforge）
> **验证项**: register_forgekins / register_forge_skills / register_council_channels / register_auto_forge_config

```yaml
# prompts.yaml — FF22 forgemind 集成验证模板
template_id: FF22
name: forgemind 集成验证模板
version: v7.0
purpose: "验证 *Forge 是否正确通过 Plugin V3 四钩子注册可进化智能体到 forgemind"
applies_to: [FlowForge, ContentForge, DevForge, NovelForge, MallForge]
verification_items:
  - hook: register_forgekins
    checks:
      - "插件类是否实现 register_forgekins() 方法返回 List[ForgekinSpec]"
      - "注册的智能体形态是否属于 5 种合法形态（BioForgekin/OrgForgekin/ObjForgekin/VirtualForgekin/HybridForgekin）"
      - "ForgekinSpec 是否包含 species/capability_requirements/value_charter 三字段"
      - "智能体是否通过 DI 容器管理（禁止绕过 DI 直接实例化，编程红线第 12 条）"
      - "forgemind 是否能通过 forgekin_id 查询到注册的智能体"
  - hook: register_forge_skills
    checks:
      - "插件类是否实现 register_forge_skills() 方法返回 List[ForgeSkill]"
      - "ForgeSkill 是否包含 skill_id/capability_profile/trigger_condition 三字段"
      - "锻造技能是否与智能体形态匹配（如 BioForgekin 的技能应包含生物感知相关能力）"
      - "技能是否通过 ToolRegistry.execute() 调用（禁止直接 import，编程红线）"
  - hook: register_council_channels
    checks:
      - "插件类是否实现 register_council_channels() 方法返回 List[CouncilChannel]"
      - "CouncilChannel 是否包含 channel_id/participants/protocol 三字段"
      - "MindCouncil 通道是否仅允许 E4+ 觉醒阶智能体参与"
      - "MindCouncil 决议是否需 operator 最终裁决（框架层不可由智能体自我演进修改）"
  - hook: register_auto_forge_config
    checks:
      - "插件类是否实现 register_auto_forge_config() 方法返回 AutoForgeConfig"
      - "AutoForgeConfig 是否包含 spirit_forge.yaml 配置路径"
      - "SpiritForge 配置是否标注触发条件（低活动期）"
      - "SpiritForge 是否仅允许 E4+ 智能体执行（Evoling 形态）"
prompt: |
  请验证 {项目名} 是否正确通过 Plugin V3 四钩子注册可进化智能体到 forgemind。
  验证步骤:
  1. 检查 plugins.py 中插件类是否实现 V3 四钩子（register_forgekins/register_forge_skills/register_council_channels/register_auto_forge_config）
  2. 检查 V2 钩子（register_agents/register_tools/register_loops/register_gates）是否保留并存
  3. 验证四钩子返回的数据结构是否符合 ForgekinSpec/ForgeSkill/CouncilChannel/AutoForgeConfig 契约
  4. 验证智能体形态是否属于 5 种合法形态
  5. 验证 MindCouncil 通道仅允许 E4+ 智能体参与
  6. 验证 SpiritForge 配置使用 spirit_forge.yaml（非 auto_forge.yaml 旧名）
  7. 验证 forgemind 单向依赖核心框架层（禁止反向调用）
  8. 验证 forgemind 不含业务领域代码（编程红线第 10 条）
  对每个未通过项给出: 文件路径 → 行号 → 违规描述 → 修复方案。
constraints:
  - "禁止 Mock（T1/T4）：必须真实加载插件并调用四钩子"
  - "禁止假数据（T2）：ForgekinSpec 必须是真实智能体定义"
  - "必须有具体断言（T3）：不得 status in ('completed','error')"
  - "LLM 生成内容必须经 LLM 审核（T7）：智能体能力基线测试报告需 LLM 审核"
```

### FF23 三方 Agent 集成验证模板（v7.0 增补）

> **用途**: 验证 ExternalAgentAdapter 集成是否正确
> **适用项目**: FlowForge（forgemind + core/external_agent）
> **验证项**: 能力画像 / 状态共享 / 失败回退 / 能力融合 / 六层 Guardrails / worktree 隔离

```yaml
# prompts.yaml — FF23 三方 Agent 集成验证模板
template_id: FF23
name: 三方 Agent 集成验证模板
version: v7.0
purpose: "验证 ExternalAgentAdapter 集成是否正确"
applies_to: [FlowForge]
verification_items:
  - item: 能力画像（ExternalAgentProfile）
    checks:
      - "4 个首批 Adapter（claude_code/codex/opencode/trae）是否各有 ExternalAgentProfile"
      - "能力画像是否包含六维（模型固有能力/认知风格/工具边界/历史表现/坏直觉/当前状态）"
      - "坏直觉维度是否如实填写盲点（如 Claude Code 长上下文易漂移、Codex 工具调用弱）"
      - "能力画像是否按可变性分层（常量层/变量层/累积层/瞬时层）"
  - item: 状态共享（ExternalAgentSharedState）
    checks:
      - "三方 Agent 执行状态是否写入智能体共享状态"
      - "智能体调用 claude code 修改代码后，codex 接手 review 时是否能看到 claude code 的修改历史和决策上下文"
      - "共享状态是否实现'智能体 → claude code 写代码 → codex review → trae 部署'的连续协作流"
      - "共享状态是否作为现实状态（第三层）跨会话跨 agent 跨时间持续存在"
  - item: 失败回退（ExternalAgentFallback）
    checks:
      - "fallback 优先级是否正确（Claude Code=1/Codex=2/OpenCode=3/Trae=4）"
      - "Claude Code 超时是否自动回退到 Codex"
      - "Codex 限流是否自动回退到 OpenCode"
      - "全部失败是否回退到 FlowForge 内置能力"
      - "回退是否记录失败原因和回退路径到 Eval 信号"
  - item: 能力融合（ExternalAgentCapabilityFusion）
    checks:
      - "三方 Agent 调用后能力是否沉淀到智能体能力画像"
      - "智能体多次调用 claude code 写代码后是否'学到'代码编写能力（通过 MindCodex 蒸馏）"
      - "能力融合是否写入 MindCodex 可检索知识库"
      - "融合后的能力是否可被检索驱动的适配循环即时生效"
  - item: 六层 Guardrails
    checks:
      - "L1 输入验证: 三方 Agent 调用前是否通过 Schema 校验"
      - "L2 系统提示约束: 智能体 system role 是否注入'禁止绕过审计'"
      - "L3 工具白名单: 三方 Agent 是否只能调用 allow-list 内工具"
      - "L4 输出验证: 三方 Agent 输出是否通过 lint + 测试"
      - "L5 操作确认: 不可逆操作（merge/release）是否需 operator 确认"
      - "L6 成本上限: 每个智能体是否有三方 Agent 调用配额"
  - item: worktree 隔离
    checks:
      - "每次三方 Agent 调用是否创建独立 worktree"
      - "网络隔离: 是否实施网络白名单（仅允许访问必要域名）"
      - "权限控制: 是否仅 read + write_code + run_tests"
      - "审计追踪: 是否全部记录到 harness-feedback/external-agent-traces/"
      - "操作回滚: 错误操作是否可恢复"
prompt: |
  请验证 FlowForge 的三方 Agent 集成（ExternalAgentAdapter）是否正确。
  验证步骤:
  1. 检查 flowforge/core/external_agent/ 目录结构是否完整（adapter/bridge/profile/shared_state/fallback/capability_fusion + adapters/）
  2. 验证 4 个首批 Adapter（claude_code.py/codex.py/opencode.py/trae.py）是否实现
  3. 验证能力画像（ExternalAgentProfile）六维完整 + 盲点如实填写
  4. 验证状态共享（ExternalAgentSharedState）实现连续协作流
  5. 验证失败回退（ExternalAgentFallback）链按优先级回退
  6. 验证能力融合（ExternalAgentCapabilityFusion）沉淀到 MindCodex
  7. 验证六层 Guardrails 全部生效
  8. 验证 worktree 隔离（网络/权限/审计/回滚）
  9. 验证调用语义统一（同步/异步/流式/委托）
  10. 验证全部失败回退到 FlowForge 内置能力
  对每个未通过项给出: 文件路径 → 行号 → 违规描述 → 修复方案。
constraints:
  - "禁止 Mock（T1/T4）：必须真实调用三方 Agent（claude code/codex/opencode/trae）"
  - "禁止假数据（T2）：能力画像必须基于真实任务历史"
  - "必须有具体断言（T3）：不得 status in ('completed','error')"
  - "LLM 生成内容必须经 LLM 审核（T7）：三方 Agent 输出需 LLM 审核"
  - "Web 功能必须操控浏览器验证 DOM（T8）: trae IDE 集成需浏览器验证"
  - "必须采集指标（T6）: MetricsCollector 采集调用次数/耗时/成功率/fallback 次数"
```

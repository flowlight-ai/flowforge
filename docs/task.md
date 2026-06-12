# FlowForge + ContentForge 问题清单 — Prompt 验证与代码审计

> 基于 `hiclaw/prompts.md` 中公共模板(P1-P18)、FlowForge 模板(FF1-FF19)、ContentForge 模板(CF1-CF9)逐条验证，结合代码走读和设计文档对比，发现的所有问题。
> 审计日期: 2026-06-11 | 更新日期: 2026-06-12
> 审计方法: 逐条 Prompt → 对照设计文档 → 验证代码实现 → 记录差距

---

## 一、FlowForge 架构问题

### BUG-FF-01: Skill 系统框架已搭建但核心链路未打通

- **来源**: FF11 Skill 系统验证
- **严重等级**: P1 — 严重（从 P0 降级，框架已搭建）
- **描述**: Skill 系统核心框架已实现（四格式解析、双层加载、版本管理、触发匹配、ComboSkill 管道编排），但关键执行链路未打通：
  - `FlowForgeNativeSkill._execute_step()` 是空壳，返回 `status: "defined"` 而非真正调度 agent/tool
  - `ComboPipeline._check_condition()` 始终返回 `True`，条件分支功能未实现
  - **SDK 未集成 SkillManager**：上层项目无法通过 `sdk.skills` 访问技能系统
  - 缺少测试文件
- **影响**: Skill 系统可加载/解析/注册，但无法真正执行步骤
- **修复方案**: (1) 实现 _execute_step 与 HybridExecutor 的集成 (2) 实现 _check_condition 条件判断 (3) SDK 增加 skills 属性 (4) 补充测试

### BUG-FF-02: MCP Integration 核心方法为 Stub

- **来源**: FF12 MCP 四层架构验证
- **严重等级**: P1 — 严重
- **描述**: MCP 四层架构类已存在（MCPClient/MCPGateway/MCPBroker/MCPToolAdapter），但核心方法为 stub 实现：
  - `MCPClient` 的 JSON-RPC 2.0 调用方法返回占位数据
  - `MCPBroker` 的动态路由和熔断重试未完整实现
  - 未连接过真实的 MCP 服务器
- **影响**: MCP 集成不可用，无法连接外部 MCP 工具
- **修复方案**: 实现 MCP Client 的 JSON-RPC 2.0 协议，连接真实 MCP 服务器验证

### BUG-FF-03: workflow.py God Object — 1684 行单文件

- **来源**: P11 架构腐化检测 / FF1 九大模式验证
- **严重等级**: P1 — 严重
- **描述**: `flowforge/modes/workflow.py` 单文件 1684 行，包含 WorkflowNode/WorkflowEdge/WorkflowGraph/WorkflowExecutor 等多个类，属于 God Object 反模式。
- **影响**: 难以维护和测试
- **修复方案**: 拆分为 graph.py(模型定义)、executor.py(执行引擎)、validator.py(验证逻辑)

### BUG-FF-04: 单向依赖违规 — modes 层导入 app 层

- **来源**: P12 分层依赖验证 / FF17 十大架构原则验证
- **严重等级**: P1 — 严重
- **描述**: `flowforge/modes/` 下的模块存在导入 `flowforge.app` 层的情况，违反"上层可以依赖下层，下层绝对禁止导入上层模块"的原则。
- **影响**: 循环依赖风险、modes 层无法独立使用
- **修复方案**: 通过依赖注入或事件机制解耦

### BUG-FF-05: 模式参数与设计文档不一致

- **来源**: FF1 九大模式验证 / A11 文档与代码一致性验证
- **严重等级**: P2 — 一般
- **描述**: 各模式的参数（如 MAX_STEPS、MAX_ITERATIONS 等）与设计文档定义不一致。例如 react 模式的 MAX_STEPS 设计为 8，代码中可能不同。
- **修复方案**: 统一代码与文档中的参数值

### BUG-FF-06: ArchitectureConstraintEngine 层映射与设计文档不匹配

- **来源**: FF3 四根护栏验证
- **严重等级**: P2 — 一般
- **描述**: `security/arch_constraint.py` 的 ArchitectureConstraintEngine 存在，但约束规则和层级映射与设计文档定义不完全一致。
- **修复方案**: 对齐设计文档更新约束规则

### BUG-FF-07: HelmDatabase 重复建表

- **来源**: FF8 Helm WebSocket E2E
- **严重等级**: P2 — 一般
- **描述**: Helm 相关的数据库表定义存在重复，可能导致初始化冲突。
- **修复方案**: 统一数据库表定义

### BUG-FF-08: Mailbox FOREIGN KEY 引用错误

- **来源**: FF13 Memory 系统验证
- **严重等级**: P1 — 严重
- **描述**: `memory/mailbox.py` 的 Mailbox 实现中，外键引用存在错误，可能导致数据完整性问题。
- **修复方案**: 修正外键引用

### BUG-FF-09: SecretStore 默认路径依赖包安装位置

- **来源**: P14 代码质量门禁 / A5 安全审计
- **严重等级**: P2 — 一般
- **描述**: SecretStore 的默认存储路径依赖于 Python 包的安装位置，不同环境可能不一致。
- **修复方案**: 使用配置文件指定存储路径

### BUG-FF-10: Marketplace 下载回退创建空 Stub

- **来源**: FF18 SDK 能力验证
- **严重等级**: P2 — 一般
- **描述**: `core/marketplace.py` 的 Marketplace 在下载失败时创建空 stub 文件作为回退，可能导致后续使用时出现难以诊断的错误。
- **修复方案**: 下载失败时抛出明确异常，不创建空文件

### BUG-FF-11: ModelCapabilityProvider 已实现但与系统脱节

- **来源**: FF18 SDK 能力验证
- **严重等级**: P1 — 严重（从"未实现"降级为"已实现但脱节"）
- **描述**: `ModelCapabilityProvider` 已实现智能路由+降级恢复+健康追踪，但存在以下问题：
  - **SDK 未集成**：`sdk.py` 使用的是 `core/model_capability.py` 的 `ModelCapability`，与 `ModelCapabilityProvider` 无桥接
  - **与现有 ModelCapability 功能重叠**：两者都提供零配置模型访问，但互不感知
  - **get_model() 只返回模型名**：不像 ModelCapability 直接提供 `chat()` 方法，实用性不足
  - 缺少测试文件
- **影响**: ModelCapabilityProvider 是"孤岛"类，上层项目无法通过标准路径使用
- **修复方案**: (1) 将 ModelCapabilityProvider 的路由能力集成到 ModelCapability 内部 (2) SDK 暴露 provider 级别接口 (3) 补充测试

### BUG-FF-12: DeclarativeAgent 已实现但 tools/handoffs/guardrails 仅声明未执行

- **来源**: FF18 SDK 能力验证
- **严重等级**: P1 — 严重（从"未实现"降级为"已实现但关键特性缺失"）
- **描述**: DeclarativeAgent 核心框架已完整实现（YAML/装饰器/字典三种定义方式、SDK 集成、默认 LLM 执行），但：
  - **tools 字段仅声明未使用**：config.tools 列表不会传递给 LLM 的 function calling 接口，也不会通过 ToolRegistry 查找和调用工具
  - **handoffs 仅声明未执行**：config.handoffs 不会产生委派行为
  - **guardrails 仅声明未执行**：config.guardrails 不会产生护栏检查
  - 缺少测试文件
- **影响**: DeclarativeAgent 实质上只能做"纯 LLM 对话"或"自定义函数执行"，无法利用工具和委派能力
- **修复方案**: (1) 实现 tools → ToolRegistry 查找+LLM function calling (2) 实现 handoffs → HandoffManager 委派 (3) 实现 guardrails → FeedbackLoop 检查

---

## 二、ContentForge 功能问题

### ~~BUG-CF-01: review_decision "edit" 分支映射错误~~ — 已修复

- **审核结果**: "edit" 现在正确映射到 "writer" 节点，三条分支（pass→publish, edit→writer, reject→END）逻辑完整

### BUG-CF-02: SqliteSaver 已替换但 sqlite3 连接未在 shutdown 时释放

- **来源**: CF3 SOP 编排验证
- **严重等级**: P2 — 一般（从 P0 降级，核心修复已完成）
- **描述**: MemorySaver 已正确替换为 SqliteSaver，checkpoint 路径从 system_config 读取，目录自动创建。但遗留问题：
  - `self._checkpoint_conn` 创建后**没有任何关闭逻辑**
  - `plugin.py` 的 `on_shutdown` 仅打印日志，未调用连接关闭
  - **风险**: Windows 环境下 sqlite3 文件锁可能不会及时释放，导致下次启动时 "database is locked" 错误
- **修复方案**: 在 Orchestrator 添加 `close()` 方法，在 plugin.py 的 on_shutdown 中调用

### BUG-CF-03: 选题搜索三级 Fallback 链路 — 已实现

- **审核结果**: TopicAgent 已实现完整的三级回退：`helixrag_search → web_search → llm_web_chat`，每级有异常捕获和阈值判断。此问题已修复。

### BUG-CF-04: Agentic RAG 知识中枢完全缺失

- **来源**: CF5 Agentic RAG 知识中枢验证
- **严重等级**: P1 — 严重
- **描述**: 设计文档要求的全部 Agentic RAG 能力均未实现：
  - 混合多源检索（向量+关键词+图谱）— 未实现
  - RRF（Reciprocal Rank Fusion）融合排序 — 未实现
  - SimHash 去重 — 未实现
  - 时间衰减权重 — 未实现
  - 知识资产累积（自动索引已发布文章）— 未实现
  - 查询理解层 — 未实现
- **影响**: 检索质量低，无知识沉淀能力
- **修复方案**: 集成 OpenSieve 的 Agentic RAG 能力或自建

### BUG-CF-05: 发布能力严重缺失 — 无内容适配/错峰/熔断

- **来源**: CF6-CF7 发布技能与多平台发布验证
- **严重等级**: P1 — 严重
- **描述**: PublishAgent 仅遍历 platforms 列表调用 `publish_{platform}` 工具，缺少：
  - 内容适配引擎（不同平台自动改写格式）
  - 错峰发布（不同平台间隔 5-10 分钟）
  - 熔断保护（发布失败 3 次自动暂停该平台）
  - Playwright 自动化发布（头条等平台需要浏览器操控）
- **影响**: 发布功能仅为最小实现，无法满足多平台发布需求
- **修复方案**: 逐步实现内容适配、错峰调度、熔断保护

### BUG-CF-06: Web 控制台严重缺失 — 仅 Dashboard 基础页面

- **来源**: CF9 Web 控制台验证
- **严重等级**: P1 — 严重
- **描述**: 前端仅有 3 个页面（/create, /tasks, /templates），缺少：
  - 审核中心（/review）— 未实现
  - 定时任务管理 — 未实现
  - 专栏配置管理 — 未实现
  - 模型配置管理 — 未实现
  - 发布日志 — 未实现
  - Helm Studio — 未实现
- **影响**: 用户无法通过 Web 界面管理创作流程
- **修复方案**: 按优先级补充前端页面

### ~~BUG-CF-07: agents/ 与 workers/ 双体系冗余~~ — 已修复

- **审核结果**: `agents/` 旧目录已清理，所有 Agent 统一在 `workers/` 目录下，无残留引用

### BUG-CF-08: brain/orchestrator 与 core/pipeline 双编排体系重叠

- **来源**: P11 架构腐化检测 / CF1 内容创作全流程验证
- **严重等级**: P2 — 一般
- **描述**: `brain/orchestrator.py`（SOP 编排）和 `core/pipeline.py`（Phase 2 全流程编排器）是两套独立实现，职责边界不清。两者都实现了创作流程编排，但接口和逻辑不同。
- **影响**: 两套体系并存导致维护困难，新开发者不清楚该用哪个
- **修复方案**: 统一为一套编排体系

### BUG-CF-09: DI 容器未在主代码中使用

- **来源**: P14 代码质量门禁 / 铁律3
- **严重等级**: P2 — 一般
- **描述**: DI 容器（`flowforge.core.di.DIContainer`）仅在测试代码中使用，主代码中 Orchestrator 等核心组件由调用方直接实例化，未通过 DI 容器。构造函数注入模式已遵循，但缺少 DI 容器统一管理生命周期。
- **修复方案**: 引入 DI 容器统一管理核心组件

### BUG-CF-10: FactCheckAgent 数据交叉验证已实现但与 SOP 参数不匹配

- **来源**: CF2 六大专家 Agent 验证 / 铁律2
- **严重等级**: P1 — 严重（问题性质变化：从"功能缺失"变为"参数不匹配"）
- **描述**: FactCheckAgent 已实现完整的数据交叉验证（`_extract_claims()` + `_cross_validate_data()` + `_validate_single_claim()`），但存在**参数不匹配问题**：
  - `deep_article.py` 的 `fact_check_node` 传入 `topic_list` 参数
  - `fact_check_agent.py` 的 `execute()` 读取 `draft` 参数
  - 并行阶段 fact_check 收到的是选题列表而非文章草稿，链接检查和数据交叉验证逻辑**实际上无法正常工作**
- **影响**: fact_check 在并行阶段形同虚设，交叉验证逻辑不会被执行
- **修复方案**: (1) 调整 fact_check_node 传入正确的参数 (2) 或调整 fact_check_agent 支持对 topic_list 进行核查

### BUG-CF-11: 模型治理缺少定期健康检查和自动故障切换

- **来源**: CF8 模型治理验证
- **严重等级**: P2 — 一般
- **描述**: `tools/llm/model_service.py` 的 `auto_fix_persona()` 仅生成建议（"建议模式"），不会自动执行切换。`SemanticRouter` 是纯静态路由表，无动态调整能力。缺少定期健康检查调度器和自动故障切换。
- **修复方案**: 实现定期健康检查调度器和自动故障切换

### ~~BUG-CF-12: 无并行 Agent 调度~~ — 已修复

- **审核结果**: deep_article.py 已实现 Fan-out/Fan-in 模式：topic → [research + fact_check] → writer，research 和 fact_check 并行执行

---

## 三、公共模板验证问题

### BUG-PUB-01: FlowForge 与 ContentForge 之间 Skill/Plugin 集成机制缺失

- **来源**: P17 FlowForge SDK 集成规范 / P18 插件注册完整性
- **严重等级**: P1 — 严重
- **描述**: FlowForge 的 Skill 系统（FF11）和 Plugin 协议（FF10）未实现，导致 ContentForge 无法通过标准插件机制注册到 FlowForge。当前 ContentForge 通过 `FlowForgeSDK(project="contentforge")` 初始化，但未实现 `FlowForgePlugin` 的 `register_agents/register_tools/register_routes` 方法。
- **影响**: ContentForge 的 Agent 和 Tool 无法被 FlowForge 自动发现
- **修复方案**: 实现 FlowForge Plugin 协议，ContentForge 实现 FlowForgePlugin

### BUG-PUB-02: 跨项目事件总线未统一

- **来源**: P16 跨项目集成验证 / P9 契约与弱耦合验证
- **严重等级**: P2 — 一般
- **描述**: FlowForge 有 EventBus，ContentForge 有 Helm 事件回调，OpenSieve 有 AgentBus，三套事件体系独立运行，事件无法跨系统流转。
- **影响**: 跨项目协作时事件链路断裂
- **修复方案**: 统一到 FlowForge EventBus 或增加桥接层

### BUG-PUB-03: 5 个项目的重复代码未清理

- **来源**: P13 代码冗余检查 / Q3 架构追问
- **严重等级**: P2 — 一般
- **描述**: FlowForge、ContentForge、DevForge、NovelForge、MallForge 五个项目存在重复代码，特别是：
  - LLM 调用逻辑（各项目各自实现）
  - 配置管理（各项目各自实现）
  - Agent 基类（各项目各自定义）
  - 发布渠道代码（ContentForge 和 MallForge 重复）
- **修复方案**: 将公共能力下沉到 FlowForge，上层项目通过 SDK 复用

---

## 四、深度审计新增问题

> 以下为第二轮深度审计（2026-06-12）新增发现

### BUG-NEW-01: ContentForge fact_check_node 与 fact_check_agent 参数不匹配

- **来源**: CF2/CF3 深度验证 / 铁律5（未实现即Bug）
- **严重等级**: P0 — 致命
- **描述**: `brain/sop/deep_article.py` 的 `fact_check_node`（第69-81行）传入 `topic_list` 参数，但 `workers/fact_check_agent.py` 的 `execute()` 方法读取 `draft` 参数。并行阶段 fact_check 收到的是选题列表而非文章草稿，其 `_extract_claims()` 和 `_cross_validate_data()` 方法将因缺少 draft 内容而无法正常工作。
- **影响**: fact_check 在 SOP 并行阶段形同虚设，数据交叉验证不会被执行
- **修复方案**: (1) 调整 fact_check_node 传入 draft 参数（但并行阶段尚无 draft）(2) 或将 fact_check 移到 writer 之后执行（改为串行）(3) 或让 fact_check_agent 支持对 topic_list 进行核查

### BUG-NEW-02: ContentForge submit_review 中 "edit" 分支的 persona 锁释放逻辑不完整

- **来源**: CF3 SOP 编排深度验证 / 铁律5
- **严重等级**: P1 — 严重
- **描述**: `brain/orchestrator.py` 的 `submit_review()` 方法（第178-221行）中：
  - "pass" 分支：执行 `Command(resume=...)` 后，在第206-208行释放 persona 锁
  - "edit" 分支：执行 `Command(resume=...)` 后，检查新状态是否仍在 review（第202-204行），但**无论结果如何都走到第206-208行释放 persona 锁**
  - 设计要求：persona 锁在审核暂停期间**必须保留**，审核完成后释放。但 "edit" 分支 resume 后文章回到 writer 重写，此时 persona 应继续锁定（因为重写完成后还会再次进入审核），但代码中 persona 锁被提前释放
- **影响**: "edit" 分支 persona 锁提前释放，可能导致同一 persona 的并发任务冲突
- **修复方案**: "edit" 分支 resume 后，如果新状态仍在执行中（writer/audit/review），应保留 persona 锁

### BUG-NEW-03: FlowForge Skill System 缺少测试覆盖

- **来源**: P7 测试铁律自检 / FF11 深度验证
- **严重等级**: P1 — 严重
- **描述**: `flowforge/skills/` 目录下无任何测试文件。Skill 系统的四格式解析、双层加载、版本管理、ComboSkill 管道编排等核心功能均无测试覆盖。
- **影响**: Skill 系统质量无法保证
- **修复方案**: 补充 Skill 系统单元测试和集成测试

### BUG-NEW-04: FlowForge ModelCapabilityProvider 与 ModelCapability 双类并存造成混淆

- **来源**: FF18 SDK 深度验证
- **严重等级**: P2 — 一般
- **描述**: `tools/llm/model_capability_provider.py` 的 `ModelCapabilityProvider` 和 `core/model_capability.py` 的 `ModelCapability` 功能重叠：
  - `ModelCapability`：SDK 的 `sdk.llm` 属性使用，提供 chat/list_models/check_health
  - `ModelCapabilityProvider`：提供更细粒度的路由和降级，但未集成到 SDK
  - 两者互不感知，模型健康状态不共享
- **影响**: 开发者不清楚该用哪个类，模型健康状态在不同类之间不同步
- **修复方案**: 合并为一个类，或将 ModelCapabilityProvider 作为 ModelCapability 的内部实现

### BUG-NEW-05: FlowForge DeclarativeAgent 缺少测试覆盖

- **来源**: P7 测试铁律自检 / FF18 深度验证
- **严重等级**: P1 — 严重
- **描述**: `flowforge/core/declarative_agent.py` 无对应测试文件。YAML 加载、装饰器、SDK 集成、默认 LLM 执行等核心功能均无测试覆盖。
- **修复方案**: 补充 DeclarativeAgent 单元测试

### BUG-NEW-06: ContentForge ResearchAgent 无优先级 Fallback — helixrag 失败不降级

- **来源**: CF4 选题搜索链路深度验证
- **严重等级**: P1 — 严重
- **描述**: TopicAgent 已实现三级 fallback（BUG-CF-03 已修复），但 ResearchAgent 仍同时调用 `web_search` 和 `helixrag_search`，两者是独立并行调用，无优先级排序，无 fallback 逻辑。如果 helixrag 返回空结果，不会自动增加 web_search 的搜索深度或范围。
- **影响**: ResearchAgent 的素材检索质量不稳定
- **修复方案**: ResearchAgent 实现 helixrag → web_search 的优先级 fallback

### BUG-NEW-07: ContentForge audit_decision 重试逻辑未区分失败原因

- **来源**: CF1 内容创作全流程深度验证
- **严重等级**: P2 — 一般
- **描述**: `brain/sop/deep_article.py` 的 `audit_decision()`（第145-151行）仅根据 score 和 retry_count 决定是否重试，不区分失败原因（内容质量问题 vs 事实错误 vs 格式问题）。不同失败原因应路由到不同的修复策略（质量问题→writer, 事实错误→research, 格式问题→editor）。
- **修复方案**: audit_decision 根据 audit_issues 类型路由到不同修复节点

### BUG-NEW-08: FlowForge SDK 缺少 Skill 系统入口

- **来源**: FF11/FF18 深度验证
- **严重等级**: P1 — 严重
- **描述**: `flowforge/sdk.py` 中没有任何对 `SkillManager` 或 `skills` 模块的引用。上层项目（ContentForge 等）无法通过 `sdk.skills` 访问技能系统，必须直接 `from flowforge.skills import SkillManager`，违反了 SDK 作为统一入口的设计意图。
- **修复方案**: 在 FlowForgeSDK 中增加 `skills` 属性，暴露 SkillManager 实例

---

## 问题统计

| 严重等级 | FlowForge | ContentForge | 公共 | 新增 | 合计 |
|----------|:---------:|:------------:|:----:|:----:|:----:|
| P0 致命 | 0 | 1 | 0 | 1 | 1 |
| P1 严重 | 5 | 2 | 1 | 4 | 12 |
| P2 一般 | 4 | 3 | 2 | 2 | 11 |
| **合计** | **9** | **6** | **3** | **7** | **24** |

**已修复删除**: BUG-CF-01, BUG-CF-07, BUG-CF-12, BUG-CF-03（共 4 项）

---

## 修复优先级建议

### 第一优先级（必须立即修复）

1. **BUG-NEW-01**: fact_check_node 与 fact_check_agent 参数不匹配 → fact_check 在并行阶段形同虚设
2. **BUG-NEW-02**: submit_review "edit" 分支 persona 锁提前释放

### 第二优先级（架构去腐化 + 新功能打通）

3. **BUG-FF-01**: Skill 系统步骤执行链路打通 + SDK 集成
4. **BUG-FF-11**: ModelCapabilityProvider 与 ModelCapability 合并/桥接
5. **BUG-FF-12**: DeclarativeAgent tools/handoffs/guardrails 执行链路
6. **BUG-FF-03**: workflow.py God Object 拆分
7. **BUG-FF-04**: 单向依赖违规修复
8. **BUG-FF-08**: Mailbox FOREIGN KEY 修复

### 第三优先级（功能补全）

9. **BUG-CF-04**: Agentic RAG 知识中枢
10. **BUG-CF-05**: 发布能力补全
11. **BUG-CF-06**: Web 控制台补全
12. **BUG-CF-10**: FactCheckAgent 参数不匹配修复
13. **BUG-NEW-06**: ResearchAgent 优先级 fallback
14. **BUG-PUB-01**: FlowForge Plugin 协议实现

### 第四优先级（质量提升）

15. **BUG-NEW-03**: Skill 系统测试覆盖
16. **BUG-NEW-05**: DeclarativeAgent 测试覆盖
17. **BUG-NEW-08**: SDK 增加 skills 入口
18. **BUG-NEW-04**: ModelCapability 双类合并
19. **BUG-CF-02**: sqlite3 连接释放
20. **BUG-NEW-07**: audit_decision 区分失败原因
21. 文档一致性修复（BUG-FF-05, BUG-FF-06）
22. 安全问题修复（BUG-FF-09, BUG-FF-10）

---

> **本文档与各项目 docs/ 下的设计文档互补。发现问题时请同步更新对应设计文档。**

# FlowForge + ContentForge 问题清单 — Prompt 验证与代码审计

> 基于 `hiclaw/prompts.md` 中公共模板(P1-P18)、FlowForge 模板(FF1-FF19)、ContentForge 模板(CF1-CF9)逐条验证，结合代码走读和设计文档对比，发现的所有问题。
> 审计日期: 2026-06-11
> 审计方法: 逐条 Prompt → 对照设计文档 → 验证代码实现 → 记录差距

---

## 一、FlowForge 架构问题

### BUG-FF-01: Skill 系统完全未实现

- **来源**: FF11 Skill 系统验证
- **严重等级**: P0 — 致命
- **描述**: prompts.md FF11 定义了完整的 Skill 系统：四种格式兼容(FlowForge/Claude Code/Anthropic/Trae CN)、双层加载(全局+项目)、Combo Skills 管道编排、触发器匹配、版本管理。但代码中 `class SkillSystem`、`class SkillManager`、`class ComboSkill` 均不存在。整个 Skill 系统零实现。
- **影响**: 无法通过 Skill 机制扩展 Agent 能力，无法实现 Combo Skills 管道编排
- **修复方案**: 实现 Skill 系统核心框架

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

### BUG-FF-11: ModelCapabilityProvider 未实现

- **来源**: FF18 SDK 能力验证
- **严重等级**: P1 — 严重
- **描述**: prompts.md FF18 定义了 `ModelCapabilityProvider`：零配置模型访问、智能路由+降级容错。但代码中 `class ModelCapabilityProvider` 不存在。FlowForgeSDK 有 `model` 属性但未实现智能路由。
- **影响**: 无法实现零配置模型访问和智能路由
- **修复方案**: 实现 ModelCapabilityProvider

### BUG-FF-12: Declarative Agent 未实现

- **来源**: FF18 SDK 能力验证
- **严重等级**: P2 — 一般
- **描述**: prompts.md FF18 定义了"纯配置 Agent 定义"（Declarative Agent），但代码中无对应实现。当前 Agent 必须通过代码定义。
- **修复方案**: 实现基于 YAML 配置的 Agent 定义

---

## 二、ContentForge 功能问题

### BUG-CF-01: review_decision "edit" 分支映射错误

- **来源**: CF1 内容创作全流程验证 / CF3 SOP 编排验证
- **严重等级**: P0 — 致命 Bug
- **描述**: `brain/sop/deep_article.py` 第 139-140 行，`review_decision()` 函数中 "edit" 判定直接映射到 "publish" 节点：
  ```python
  elif verdict == "edit":
      return "publish"  # BUG: 应回到 "writer" 或 "review" 修改
  ```
  设计要求：审核结果为 "edit" 时应回到 writer 或 review 节点进行修改，而非直接发布。
- **影响**: 人工审核选择"编辑修改"时文章直接发布，跳过修改环节
- **修复方案**: 将 `return "publish"` 改为 `return "writer"` 或 `return "review"`

### BUG-CF-02: MemorySaver 替代 SqliteSaver — 服务重启丢失所有 Checkpoint

- **来源**: CF3 SOP 编排验证
- **严重等级**: P0 — 致命
- **描述**: `brain/orchestrator.py` 第 5 行和第 34 行硬编码使用 `MemorySaver()`：
  ```python
  from langgraph.checkpoint.memory import MemorySaver
  self.checkpointer = MemorySaver()
  ```
  而 `config/system.yaml` 已配置 `checkpointer.url: "sqlite:///data/checkpoints.db"` 但未使用。服务重启后所有 checkpoint 丢失，审核中的任务无法恢复。
- **影响**: 服务重启后所有进行中的审核任务丢失，违反设计文档的持久化要求
- **修复方案**: 替换为 `SqliteSaver.from_conn_string(config["checkpointer"]["url"])`

### BUG-CF-03: 选题搜索三级 Fallback 链路未实现

- **来源**: CF4 选题搜索链路
- **严重等级**: P1 — 严重
- **描述**: 设计要求三级 fallback：helixrag → web 爬虫 → web chat 模型。实际实现：
  - **TopicAgent**: 仅用 LLM 生成选题，**完全不调用** helixrag_search 或 web_search
  - **ResearchAgent**: 同时调用 web_search 和 helixrag_search，但无优先级排序，无 fallback 逻辑
  - **无 web chat 模型 fallback**: 没有任何"使用 web chat 模型引导联网搜索"的实现
- **影响**: helixrag 不可用时无降级策略，选题质量不稳定
- **修复方案**: 实现三级 fallback 链路

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

### BUG-CF-07: agents/ 与 workers/ 双体系冗余 — 10 个旧 Agent 未清理

- **来源**: P13 代码冗余检查 / P15 技术债务清理
- **严重等级**: P2 — 一般
- **描述**: `agents/` 目录下 10 个 Agent（继承 GenericAgent）与 `workers/` 目录下 7 个 Agent（继承 ContentForgeAgent）功能高度重叠。Grep 搜索确认 `agents/` 目录已无代码引用，属于死代码。
- **影响**: 代码冗余、维护困惑
- **修复方案**: 清理 agents/ 旧目录，将独有功能（content_repurposer, article_reflect, article_eval, headline_optimizer）合并到 workers/

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

### BUG-CF-10: FactCheckAgent 仅验证链接有效性 — 无数据交叉验证

- **来源**: CF2 六大专家 Agent 验证 / 铁律2
- **严重等级**: P1 — 严重
- **描述**: `workers/fact_check_agent.py` 仅使用 httpx HEAD 请求验证链接是否可达，缺少设计要求的数据交叉验证（多源数据对比、数据一致性检查）。
- **影响**: 事实核查深度不足，无法检测数据错误
- **修复方案**: 增加数据交叉验证逻辑

### BUG-CF-11: 模型治理缺少定期健康检查和自动故障切换

- **来源**: CF8 模型治理验证
- **严重等级**: P2 — 一般
- **描述**: `tools/llm/model_service.py` 的 `auto_fix_persona()` 仅生成建议（"建议模式"），不会自动执行切换。`SemanticRouter` 是纯静态路由表，无动态调整能力。缺少定期健康检查调度器和自动故障切换。
- **修复方案**: 实现定期健康检查调度器和自动故障切换

### BUG-CF-12: 无并行 Agent 调度 — 所有节点串行执行

- **来源**: CF3 SOP 编排验证
- **严重等级**: P2 — 一般
- **描述**: 设计文档要求"多 Agent 并行调度（无依赖关系的 Agent 可并行工作）"，但当前所有 Agent 节点串行执行，无并行调度逻辑。
- **修复方案**: 在 SOP 编排中增加并行节点支持

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

## 问题统计

| 严重等级 | FlowForge | ContentForge | 公共 | 合计 |
|----------|:---------:|:------------:|:----:|:----:|
| P0 致命 | 1 | 2 | 0 | 3 |
| P1 严重 | 3 | 4 | 1 | 8 |
| P2 一般 | 5 | 5 | 2 | 12 |
| **合计** | **9** | **11** | **3** | **23** |

---

## 修复优先级建议

### 第一优先级（必须立即修复 — 阻塞核心功能）

1. **BUG-CF-01**: review_decision "edit" 分支映射错误 → 1 行代码修复
2. **BUG-CF-02**: MemorySaver 替换为 SqliteSaver → 5 行代码修改
3. **BUG-FF-01**: Skill 系统核心框架实现 → 需要设计+开发

### 第二优先级（架构去腐化）

4. **BUG-FF-03**: workflow.py God Object 拆分
5. **BUG-FF-04**: 单向依赖违规修复
6. **BUG-FF-11**: ModelCapabilityProvider 实现
7. **BUG-FF-08**: Mailbox FOREIGN KEY 修复
8. **BUG-FF-02**: MCP Integration 核心方法实现

### 第三优先级（功能补全）

9. **BUG-CF-03**: 选题搜索三级 Fallback 链路
10. **BUG-CF-04**: Agentic RAG 知识中枢
11. **BUG-CF-05**: 发布能力补全
12. **BUG-CF-10**: FactCheckAgent 数据交叉验证
13. **BUG-PUB-01**: FlowForge Plugin 协议实现

### 第四优先级（质量提升）

14. **BUG-CF-06**: Web 控制台补全
15. **BUG-CF-07**: agents/ 旧目录清理
16. **BUG-CF-08**: 双编排体系统一
17. 文档一致性修复（BUG-FF-05, BUG-FF-06）
18. 安全问题修复（BUG-FF-09, BUG-FF-10）

---

> **本文档与各项目 docs/ 下的设计文档互补。发现问题时请同步更新对应设计文档。**

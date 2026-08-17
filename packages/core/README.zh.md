# core/ — 产品 API 主心骨

[English](README.md) | 中文

`core` 工作区是 FlowForge 的**产品 API 主心骨**：它构建在 vendored
[Cordis](https://cordis.nodejs.cn/) 内核之上，把“一切皆插件”落地为具体的
Agent / Session / Tool / Prompt 能力面。每个子包都是 `@flowforge/*` scope 下的
一个 npm 包。

每个子包要么把一个**服务（Service）**挂载到 Cordis 的 `Context` 上（用
`ctx.<key>` 读取），要么贡献一个被其他包使用的**原语 / 插件**。服务都是
`Service` 的子类；注册本身是 effect，作用域卸载时自动反注册。

| 包 | 角色 | ctx 键 |
| --- | --- | --- |
| [`agent`](agent) | Agent 接口、实时注册表（`AgentRegistry`）、进程内 initiator 作用域，以及事件词汇（`agent/created`、`agent/disposed`、`agent/session-start`）。同时定义 loop 插件实现的 `AgentFactory` 契约。 | `ctx.agents`（另有可选 DX 访问器 `ctx.agent`） |
| [`agent-default-model`](agent-default-model) | Agent 入口共用的默认模型选择，可选随 settings 覆盖。 | `ctx.agentDefaultModel` |
| [`agent-loop`](agent-loop) | 具体的 agent-loop 插件：创建作用域化的 agent、经 agent/session 注册表发布、独占其有序拆除，并提供 `AgentFactory` 实现。 | `ctx.agentLoop`（另有可选 `ctx.configuredAgentIdentities`） |
| [`agent-tool-presentation`](agent-tool-presentation) | Agent 平面的工具呈现选择器：声明某 agent 的模型以 `native` / `code` / `both` 形态看到工具。它是**插件**而非服务——调用的是 `ctx.tools.presentAs()`。 | *（无——插件；调用 `ctx.tools.presentAs`）* |
| [`scope`](scope) | 作用域化上下文注册原语：铸造带有不透明 `ScopeKey` 标签的 Cordis 上下文、构造仅用于路由的事件载体（`scopeTarget`）、读取所属作用域（`scopeOf`）。这是“作用域过滤派发”的地基。 | *（无——原语库）* |
| [`session`](session) | 事件溯源的会话存储：append-only 的 `SessionEvent` 日志、内存 `SessionStore`，以及派生的 LLM 消息历史（`deriveMessages`）。落盘持久化是独立插件职责（订阅 `session/event`，在 `session/flush` 时落盘）。 | `ctx.sessions` |
| [`system-prompt`](system-prompt) | 系统提示词组装注册表：有序 section、动态 context、工具 schema 提供方，以及 `{{variable}}` 插值；在每次模型步前组装。 | `ctx.systemPrompt` |
| [`tools`](tools) | 工具注册表与执行管线：注册、pre/execute/post 瀑布流，以及作用域级呈现。 | `ctx.tools` |

## 能力边界（capability seam）

主心骨刻意拆分为**服务定义 / 提供方 / 消费方**三层：

- `@flowforge/agent` 定义 `AgentRegistry`（`ctx.agents`）与 `AgentFactory`
  接口——定义层。
- `@flowforge/agent-loop` 实现 `AgentFactory`，并通过
  `ctx.agents.setFactory(this)` 注册——提供方层。
- 其余一切只通过 `ctx.agents.create` / `resume` 驱动 agent——消费方层，不依赖
  具体 loop 包。

工具（`ctx.tools`、`ToolRuntime`）与提示词（`ctx.systemPrompt`、`SystemPrompt`）
也是同样的形态：服务是稳定契约，注入它的插件可替换。

## 交叉引用

- 内核：vendored `@flowforge/cordis`（Cordis 的 `Context`、`Service`、`effect`、`on`）。
- 重量级会话持久化后端在 core 之外：`session-persistence*` 包（经 `ctx.get('sessionPersistence')` 获取）。
- `code` 呈现依赖的主机平面代码运行时：`@flowforge/code-runtime`（经 `ctx.get('codeRuntime')` 获取）。
- 仓库根规则：[`../../AGENTS.md`](../../AGENTS.md)。core 专属 AI/开发规则：[`AGENTS.md`](AGENTS.md)。

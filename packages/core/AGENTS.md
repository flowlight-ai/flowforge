# AGENTS.md — flowforge/packages/core 工作规范（AI 工具 + 开发者补充规则）

> 本文件是仓库根 `AGENTS.md` 的**补充**。根文件中的 Git 工作流、开发红线、提交署名等规则**全部仍然适用**，此处只增补 core 这个产品 API 主心骨（product API spine）特有的规则。请勿与根规则重复。
>
> core 是“一切皆插件”内核（vendored Cordis）之上的产品 API 主心骨，npm scope 为 `@flowforge/*`。它在 Cordis 的 `Context` 上挂载了一系列**服务（Service）**，并定义了跨包的能力契约。

**规则：插件向内核贡献能力，一律通过 `ctx.effect()` / `ctx.on()` 注册与监听；注册本身就是一次性 effect（disposable），作用域卸载时自动反注册、反监听。不要手动持有并裸调用清理函数。**

**规则：服务（Service）是 `Service` 的子类，通过 `super(ctx, 'name')` 在构造时挂载到 `ctx`；运行期、可选的服务用 `ctx.provide('name', value)` 注入。不要绕过 Service 直接往 `ctx` 上挂普通字段。**

**规则：强制注入的服务用 `ctx.<name>` 直接读取；可选（可能未安装）的服务一律用 `ctx.get('name')` 读取，缺失时返回 `undefined` 且不抛错（例如 `ctx.get('sessionPersistence')`、`ctx.get('codeRuntime')`、`ctx.get('settings')`）。不要假设可选服务一定存在。**

**规则：能力边界（capability seam）拆分为三层——服务定义（Service Definition）/ 提供方（Provider）/ 消费方（Consumer）。以 Agent 为例：`@flowforge/agent` 只定义 `AgentRegistry`（`ctx.agents`）与 `AgentFactory` 契约，`@flowforge/agent-loop` 作为 Provider 在构造时 `ctx.agents.setFactory(this)` 注入实现，其余消费方只通过 `ctx.agents.create/resume` 使用，不依赖具体 loop 包。新增能力时先确认它在哪一层，接口与服务实现保持解耦。**

**规则：一个异步操作 = 一个生命周期控制器。把该操作的创建与拆卸折叠进同一个复合 effect：先 `enter`/`prepare` 再 `announce`，把反向 `dispose` 作为该 effect 的唯一收口（如 `agent-loop` 的 `prepare` 返回 memoized dispose，并由 owner fiber 的单一 effect 跟踪）。不要让创建与拆卸分散在多个互不依赖的 sibling effect 中，否则会出现“先移除发布钩子、后写入收尾事件”的竞态丢事件。**

**规则：仅在提交点（commit point）发布状态。事件（`agent/created`、`session/created`、`session/event` 等）在 `enter` 之后、显式 `announce` 时才发出；同步监听器抛错会否决发布并回滚，并配对发出对应的 `*/disposed`。监听器里的异步 reject 已经晚于同步边界，只能记录、不能撤销发布。**

**规则：跨作用域的事件路由用 `scopeTarget(base, key)` 构造“路由载体”（carrier），用 `scopeOf(ctx)` 读取上下文最近的作用域标签；事件沿作用域链**向上**传播——祖先作用域上注册的监听器能收到其所有后代作用域的事件，反之向下不传播。`@flowforge/scope` 是承载这一切的底层原语，不是服务、没有 `ctx.*` 键。**

**规则：会话持久化是插件职责，不是 `ctx.sessions` 的职责。`@flowforge/session` 只维护内存中的 append-only 事件日志与派生态（derived message history）；持久化后端订阅 `session/event`、在 `session/flush` 与 dispose 时落盘，运行态通过 `ctx.get('sessionPersistence')` 获取（具体后端在 `session-persistence*` 包）。不要在 core 的 session 里实现落盘。**

**规则：Agent 的创建/恢复事务是回滚覆盖（rollback-covered）的。`ctx.agents.create/resume` 在发布前 await 未发布的 setup、调用可选的同步 `commit()`、依次发出 `session/created`/`agent/created`/`agent/session-start` 后才启动 loop；任一环节失败都回滚而不发布任一 id。setup 回调只能“组合”（compose）作用域，不能“驱动”（drive）agent。**

**规则：工具呈现（presentation）是作用域级的声明。一个 agent preset 通过 `ctx.tools.presentAs('native' | 'code' | 'both')` 声明其模型看到的工具形态（作用在 preset 的常驻作用域上，覆盖该作用域下的每个 agent）；这是一个 effect，随作用域卸载自动复位为部署默认。进程级全局默认是 `tools` 行配置里的 `mode` 字段，不要对 `agent-tool-presentation` 包本身期望一个 `ctx.*` 键——它只是个调用 `ctx.tools.presentAs` 的插件。**

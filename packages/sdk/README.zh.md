[English](README.md) | 中文

# sdk/ — 进程外运行时 SDK

`sdk/` 是 FlowForge 的**进程外控制面**。所谓「进程外」，意思是：外部的驱动
程序（比如一个命令行工具、一个编排器、或者其他语言的 SDK）会把
`flowforge-jsonrpc-agent` 这个运行时当成**子进程**启动起来，然后通过标准
输入/输出上的 **stdio JSON-RPC** 来驱动它跑 agent。运行时本身是一个完整的
Cordis 进程，由它自己的 `cordis.yml` 决定怎么装配；SDK 只负责把控制指令送
进去、把事件流出来。

## 包含哪些包

| 包名 | 作用 | ctx 键 |
| --- | --- | --- |
| `@flowforge/sdk-protocol` | 共享的**线协议**：基于换行的 JSON-RPC stdio 传输，加上请求/结果/通知的具名类型。client 与 server 共用的**唯一事实来源**。 | —（纯库） |
| `@flowforge/sdk-jsonrpc-server` | 基于 stdio 的 JSON-RPC **服务端插件**，把正在运行的运行时暴露给外部驱动/CLI。通过 `ctx.plugin` 注册。 | `sdk-jsonrpc-server`（插件，`apply` 走 `ctx.plugin`） |
| `@flowforge/sdk-client` | TypeScript **客户端 SDK**：以子进程方式拉起运行时并通过 stdio JSON-RPC 驱动。`DeepSeekHarness` 是高层运行接口，`HarnessClient` 是更底层的协议客户端。 | —（纯库） |

## 外部系统是怎么驱动 FlowForge 的

1. 宿主程序把运行时可执行文件 `flowforge-jsonrpc-agent` 作为子进程启动
   （它的 `cordis.yml` 决定要不要加载 `sdk-jsonrpc-server` 这个插件）。
2. 客户端在子进程的 `stdin`/`stdout` 上建立「换行分隔的 JSON-RPC」数据流
   （传输由 `@flowforge/sdk-protocol` 定义）。
3. 客户端先发 `initialize`（带上 cwd / provider / model / 可选的 `maxTokens`），
   然后针对某个 `sessionId` 发一个或多个 `session/prompt`（id 不认识就自动
   创建对应的 agent + 会话）。
4. 服务端把四种通知流回客户端：`session.event`、`session.status`、
   `subagent.started`、`subagent.finished`。
5. 收到 `shutdown` 请求后，会先 flush 响应、再释放整个 root 运行时、最后以
   退出码 0 退出；EOF / 信号的退出由 app bin 负责。

这三种请求方法和四种通知，**全部定义在** `@flowforge/sdk-protocol`
（`HarnessSdkRequestMap`、`HarnessSdkNotificationMap`）里，不要在该包之外
随手加字段或自定义 key。

## 相关链接

- 线类型与传输： [`protocol/`](./protocol)
- 服务端插件： [`server/`](./server)
- TypeScript 客户端： [`client/`](./client)
- 根架构说明： [../../docs/arch.md](../../docs/arch.md)
- 给 AI 工具的模块规则： [./AGENTS.md](./AGENTS.md)

## 计划中的使用者

- `apps/cli`（一个用来**消费本 SDK** 的命令行宿主）目前**尚未创建，为 (planned)**。
  这里提到它，只是为了说明 SDK 的设计目的。

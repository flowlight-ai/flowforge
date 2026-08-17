# AGENTS.md — SDK 模块工作规范（强制补充）

> 本文件补充根目录 `AGENTS.md`，仅约束 `packages/sdk/*` 下的三个子包。
> AI 工具在本目录工作时**必须同时遵守**根 `AGENTS.md` 与本文件。

## 定位

SDK 是 FlowForge 的**进程外控制面（out-of-process control surface）**。
外部驱动方（CLI、编排器、其他语言的 SDK）通过 `stdio` 上的
**JSON-RPC** 拉起并驱动一个独立的 runtime 进程（`flowforge-jsonrpc-agent`）。
runtime 进程自身是完整的 Cordis 运行时，由它自己的 `cordis.yml` 配置，
SDK 只负责把控制指令送到进程里、把事件流出来。

## 规则（红线）

- **规则：** SDK 是进程外的 JSON-RPC 控制面，不是进程内模块。外部系统只能通过协议与服务端插件通信，不得假设可直接 import 运行时内部状态。
- **规则：** `sdk-jsonrpc-server` 服务端插件**必须**通过 `ctx.plugin(...)` 注册，且保持具名导出（无 `default` 导出），以便 Loader 的 `unwrapExports` 保留 `name` / `inject` / `Config` / `apply`。
- **规则：** `@flowforge/sdk-protocol` 中的协议类型是 **client 与 server 的唯一事实来源（single source of truth）**。请求方法、结果、通知结构只能定义在协议包里。
- **规则：** **禁止**在协议包之外新增临时的传输字段或自定义 JSON key。任何线类型变更都改 `sdk-protocol`，并由 client 与 server 同步消费。
- **规则：** **线稳定性（wire stability）优先**。外部驱动方依赖这套协议；`serverInfo.name` 固定为 `flowforge-sdk-runtime`，新增/改名请求方法或通知字段视为破环变更，需要版本协商与明确说明。
- **规则：** 服务端插件的 `stdout` 仅用于协议帧（newline-delimited JSON-RPC）。加载树**不得**挂载任何向 `stdout` 写日志的 logger，否则会污染协议流。
- **规则：** `shutdown` 请求由协议层负责：先 flush 响应、再 dispose 整个 root runtime、最后以退出码 0 退出；EOF 与信号的退出由 app bin 负责，插件不要抢。

## 子包间依赖

```
sdk-protocol   ←  sdk-jsonrpc-server   （服务端消费协议类型与传输）
sdk-protocol   ←  sdk-client           （客户端消费同一协议类型）
sdk-client     是纯库，不在 Cordis ctx 上注册任何服务
```

## 不在本目录职责内（仅说明）

- `apps/cli`（消费本 SDK 的命令行宿主）当前**尚未创建，为 (planned)**，
  不要在此目录伪造其实现；它的存在只用于解释 SDK 的设计目的。

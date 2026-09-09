# `@flowforge/sdk-app`

[English](README.md) | 中文

以 `flowforge` profile 组合包形式交付的 SDK stdio 应用：叠加在 [`@flowforge/base`](../base/README.md) 之上。它继承 base 的禁用模块 HMR 策略；其 patch 设置编码 agent 的人设，挂载一个由本应用独享的零选项命令 provider，并且仅在 provider 接受该次调用后才启动 [`@flowforge/sdk-jsonrpc-server`](../../sdk/server/README.md)。因此 `flowforge --profile sdk --help` 会写入帮助文本后直接退出，而不会占用 stdin 或 stdout。独立的 [`sdk-minimal`](../sdk-minimal/README.md) 组合包以自己的 profile 名复用同一个启动 provider。

## 使用方式

启动 provider（`sdk-app-startup`，由 `sdk-app` 提供）通过 [`@flowforge/cmdline`](../../boot/cmdline/README.md) 把 stdin EOF 绑定到启动器的有界成功退出。SDK 协议的 `shutdown`、SIGINT 与 SIGTERM 保留各自的 server 或 launcher 路径；清理会排空根 profile 树与持久化。stdout 专用于以换行分隔的 JSON-RPC 帧。该组合包禁用了模型生成的会话标题，因为 SDK 不提供标题界面；确定性的回退标题无需额外模型请求即可持久化。部署方通过 profile 组合包与 patch 文件选择不同的组合，而非另一个应用 bin。

| Config | 默认值 | 行为 |
|---|---|---|
| `profile` | `sdk` | 渲染在命令帮助中的 profile 名；挂载该 provider 的组合包会设置自己的发行 profile 名。 |

`FF_MAX_TOKENS_AS_SUCCESS` 保留 SDK 的部署映射：未设置或 JSON `true` 把受 token 限制的 subagent 完成报告为接受，JSON `false` 则报告为错误。provider/model 与工作区 cwd 通过 SDK 初始化请求到达；base profile 拥有适配器、工具、持久化、策略、settings 与凭据。

## 模型体验

### SDK 编码 agent 人设

#### 模型所见

profile 在 base 工具与上下文贡献之前提供 `You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.`。确切的 SDK 初始化路由与会话 cwd 负责解析占位符。

#### KV Cache 影响

对固定的 profile、provider、模型与工具清单保持稳定。

## 已知限制与暂缓事项

- **profile 可以省略 SDK server**：由客户端选中的自定义 profile 必须保留本组合包或另一条 `@flowforge/sdk-jsonrpc-server` 行；没有 peer 应答时客户端初始化会失败。
- **用户插件可能破坏 stdout 纯净性**：profile 与每次启动的 patch 是被信任的应用组合。随发行版提供的组合包不写入任何非协议 stdout，但它无法约束任意插入的插件。

**运行时不变式：** 不发布 companion。该组合包新增了进程传输与启动闩；启动 spec 负责帧纯净性、帮助排除与关闭。
# `@flowforge/acp-app`

[English](README.md) | 中文

以 `flowforge` profile 组合包形式交付的、仅用于自动化的 ACP stdio 应用：叠加在 [`@flowforge/base`](../base/README.md) 之上。它继承 base 的禁用模块 HMR 策略；其 patch 设置编码 agent 的人设与默认模型路由，挂载一个由本应用独享的零选项命令 provider，并且仅在 provider 接受该次调用后才启动 [`@flowforge/acp`](../../acp/acp/README.md)。因此 `flowforge --profile acp --help` 会写入帮助文本后直接退出，而不会占用 stdin 或 stdout。

## 使用方式

启动 provider（`acp-app-startup`，注入 `cmdlineArgs`，由 `acp-app` 提供）通过 [`@flowforge/cmdline`](../../boot/cmdline/README.md) 把 stdin EOF 绑定到启动器的有界成功退出。ACP 连接关闭、SIGINT 与 SIGTERM 会在退出前排空 bridge 持有的 agent 与根 profile 树。stdout 专用于以换行分隔的 ACP JSON-RPC 帧。该组合包禁用了模型生成的会话标题，因为 ACP 不提供标题界面；确定性的回退标题无需额外模型请求即可持久化。部署方通过 profile 组合包与 patch 文件选择不同的组合，而非另一个应用 bin。

随发行版提供的行以 `deepseek-official` 和 `deepseek-v4-flash` 创建会话；后续 patch 可替换该行的完整 config。base profile 拥有适配器、工具、持久化、策略、settings、凭据以及 ACP 客户端提供的每会话工作区。

## 模型体验

### ACP 编码 agent 人设

#### 模型所见

profile 在 base 工具与上下文贡献之前提供 `You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.`。ACP 行的路由与每个 `session/new` 的 cwd 负责解析占位符。

#### KV Cache 影响

对固定的 profile、provider、模型与工具清单保持稳定。

## 已知限制与暂缓事项

- **profile 可以省略 ACP bridge**：自定义 ACP 启动 profile 必须保留本组合包或另一条 `@flowforge/acp` 行；否则没有任何 peer 应答客户端。
- **用户插件可能破坏 stdout 纯净性**：profile 与每次启动的 patch 是被信任的应用组合。随发行版提供的组合包不写入任何非协议 stdout，但它无法约束任意插入的插件。

**运行时不变式：** 不发布 companion。该组合包新增了进程传输与启动闩；启动 spec 负责帧纯净性、帮助排除与关闭。
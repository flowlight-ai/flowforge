# cordis-host-runner/ — 动态插件宿主与装配

[English](README.md) | 中文

动态包定义的注册表、host 半的沙箱生命周期，以及 host→client 的 invoke 处理器表。
这是 FlowForge 的**运行时装配点**：它是静态宿主对应的动态形态。静态宿主在编译期
导入插件包，而本包在运行时——由模型提供的清单（manifest）——发现并登记插件*定义*，
再把它们启动到一个存活的 Cordis `Context` 上。

| 包 | 角色 |
| --- | --- |
| `@flowforge/cordis-host-runner` | 动态插件注册表 + host 半沙箱生命周期 + invoke 处理器表（装配边界）。 |

配套工具集 [`@flowforge/tool-cordis`](../tool-cordis/README.md) 注入本服务
（`ctx.dynamicCordisRunner`）并提供面向模型的动词（`cordis_define` /
`cordis_run` / `cordis_stop` / `cordis_undefine` / `cordis_inspect`）。一个
只装了这些工具、却没装 runner 的组合永远无法激活任何包——注册表、VM 沙箱与
浏览器广播全都住在这里。

## 装配模型

```
                 根 Context（由宿主应用启动）
                                  │
                                  ▼
                  cordis-dynamic  分组 fiber   ◄── runner 持有它
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                        ▼
        Host 半（沙箱）                         Client 半
   evaluateHostCode() → Plugin              投递到已打开的网页
   startHostHalf() → 子 fiber               把 UI 注册进 Client 槽位
   handlers → run.handlers（invoke 表）
```

1. **发现 / 登记** —— `define()` 在语法预检后，登记一个不可变的 `Package`
   （`name`、`purpose`，以及 host 半的 `hostCode` 和/或 client 半的
   `clientCode`）。它为新插件铸造稳定的 `pluginId`，或向已有插件追加版本，
   并为每个版本铸造唯一的 `packageId`。版本只追加、不可变；定义本身不会再次
   自动运行。
2. **启动一个 Context** —— runner 在构造时接收根 `Context`，并把每个 host 半
   挂载到该 Context 下唯一的 `cordis-dynamic` 分组 fiber 上。host 源码在 VM
   沙箱中求值，必须返回一个 Cordis `Plugin`（`apply(ctx)`），并以子 fiber 的
   形式 settle，于是它注册的服务变成真实的 `ctx.*` 服务。
3. **运行 / 调用** —— `run()`（以及负责审批的 `runHostHalf()`）启动一个包；
   通过 `handle(method, fn)` 注册的 host 方法，经 `invoke()` 处理器表暴露给
   client 半回调。client 半若依赖某个 host 尚未挂载的服务，会保持 *pending*
   而非失败（合法的 Cordis 语义：服务出现时它才激活）。
4. **副作用绑定的清理** —— `retract()` 会依次执行每个 `handlerDisposer` 并
   `await fiber.dispose()`。因为 host 半注册的一切都是其 fiber 上的 effect，
   释放该 fiber 就把整个包彻底拆除；回收之后它贡献的服务不复存在，与静态插件
   卸载完全一致。

### 运行 / 控制动词（摘要）

- `define` / `undefine` —— 掌管一个定义的生命周期。`define` 预检每一半的语法
  （不执行任何代码），并把定义登记在所属会话名下；`undefine` 先停掉正在运行的
  定义，再把其忘掉。两者都不上 wire。
- `run` —— 回答模型「运行某个定义」的请求。只有 host 半的包在进程内求值并直接
  返回；带 client 半的包会 emit `cordis/request-run`、挂起，并在审批
  （`resolveRequestRun`）或取消中结算。
- `runHostHalf` / `getClientCode` —— 获准的页面依次走的步骤：host 半在先（故
  host 失败会短路），随后 client 源码只交给这一个页面。代码从不搭乘任何播报。
- `stop` —— 回退一次存活的下发（丢弃 handler、把 host fiber dispose 到停稳、
  emit `retract`），并让该定义仍然可运行。
- `inventory` / `snapshot` —— 全注册表与按会话限定的报告。`snapshot` 携带每个
  存活 host 半的 fiber，供 `cordis_inspect` 自行渲染 provides / waiting /
  state（fiber 无法跨 wire）。
- `invoke` —— 把一个包的 client 半发起的一次调用，路由到它自己的 host 半所
  注册的方法。基础设施只做路由；不存在 host→client 的方向。

`run` / `stop` 的拒绝会给出 `definition-missing`、`host-half-failed`、
`client-half-failed`、`rejected`、`cancelled`、`not-running` 之一；后三者是
答复而非缺陷。

## `apps/cli` 会如何使用它（计划 / 阶段 3）

`apps/cli` 属于**计划中的内容（阶段 3，`docs/refactor/23-stage3-api-cli.md`，
任务 T3.6）**——目前尚不存在。建成之后，宿主应用是组合根：它启动根 `Context`、
安装内核与领域服务、挂载 `@flowforge/cordis-host-runner`，再让模型经
`tool-cordis` 的动词来驱动包。runner 本身**不会自举**——它被交予一个已在运行
的 `Context`，并把它当作装配边界。计划中的应用垂直域（`cats` / `chat` / `limb`
/ `forgekin`，阶段 4–7）在此以「被加载的包」的形式组合自身能力，而不是写进
内核代码。

## 存储与信任立场

- 注册表即进程内存，也是唯一真源。会话日志只承载一次 `define` 调用的元数据——
  绝不承载代码——因此进程重启后确实没有任何定义，这是合理的；id 已无法解析的
  卡片会如实说明这一点，不会假装自己还能运行。本包不向磁盘写任何东西，也不会
  自动恢复任何定义。
- VM 沙箱隔离全局变量，但**不是安全边界**：Node 全局变量不存在，或重定向到
  Cordis 服务（`ctx.fs`、`ctx.web`、`ctx.bash`），host 半收到的是不含框架内部
  机制的 façade，但它声明的服务仍会触达存活运行时。应当像对待 bash 访问一样
  对待动态包，参见
  [自引用工具集 Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md)。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `vmTimeoutMs` | `5000` | host 半在 VM 中同步执行时被中止求值前可运行的毫秒数 |

## 导出形状

服务包：默认导出 `DynamicCordisRunnerService`（服务键 `dynamicCordisRunner`）；
`./types` 承载 `dynamicCordisRunner` remote namespace 与其消费方共享的载荷形状。
`define` / `undefine` 的形状留在包内部，因为它们从不跨 wire。

## 交叉引用

- 项目规则与开发红线：根目录 [`AGENTS.md`](../../../AGENTS.md)。
- 本包规则补充：[`./AGENTS.md`](./AGENTS.md)。
- 重构上下文：[`docs/refactor/22-stage2-plugins.md`](../../../docs/refactor/22-stage2-plugins.md)
  （T2.13 —— host-runner 作为生产装配器）与
  [`docs/refactor/23-stage3-api-cli.md`](../../../docs/refactor/23-stage3-api-cli.md)
  （`apps/cli`，计划）。
- 面向模型的动词与信任立场：[`@flowforge/tool-cordis`](../tool-cordis/README.md)。
- 客户端投递：[`@flowforge/cordis-client-runner`](../cordis-client-runner/README.md)。

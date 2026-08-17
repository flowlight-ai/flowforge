# AGENTS.md — `@flowforge/cordis-host-runner` 工作规范（强制）

> 本文件是根目录 `AGENTS.md` 的**包级补充**，仅针对 `@flowforge/cordis-host-runner`
> （动态插件宿主 / 装配器）这一包。根目录红线（Git 工作流、开发红线）在本包同样适用。
> AI 工具修改本包代码或文档前，**必须**读取并遵守下列规则。

## 职责边界

**规则：** 本包是动态插件的**装配边界**，不是业务逻辑的容器。它只负责三件事——
不可变 `Package` 定义注册表、host 半的 VM 沙箱与 `cordis-dynamic` 分组 fiber 生命周期、
以及 host→client 的 `invoke` 处理器表。具体能力由被加载的插件包提供；不要把
`cats`/`chat`/`limb`/`forgekin` 等垂直域的业务行为写进 runner。

**规则：** host-runner **启动根 `Context` 并从中加载插件包**。它在构造时接收由宿主
应用（计划中的 `apps/cli`）已经启动好的根 `Context`，并把每个 host 半挂载到该
Context 下唯一的 `cordis-dynamic` 分组 fiber 上。runner 自身不 bootsrap 进程、不
自举——它只装配已存在的 Context 与服务。

**规则：** 注册是**副作用绑定（effect-bound）**的，`dispose` 即清理。host 半在
VM 沙箱中求值后，以子 fiber 形式 settle 到 `cordis-dynamic` 分组；它注册的所有
handler 与 `ctx.*` 服务都是该 fiber 的 effect。`retract()` 通过 `handlerDisposers`
与 `fiber.dispose()` 完成拆除。卸载后其贡献的服务不可用，与静态插件卸载一致——不要
手动保留引用或绕过 dispose。

## 运行模型

**规则：** `define` 只登记、不执行。它做元数据校验与语法预检（编译而非运行），铸造
稳定的 `pluginId` 与每次版本唯一的 `packageId`，把定义登记在所属会话名下。定义一旦
登记即不可变；「运行新版本」必须 `define` 一个新 `Package` 再 `run` 之，而不是修改
旧定义。

**规则：** `run` 是模型驱动的激活请求，host-only 包进程内求值即返回；带 client 半的
包会 emit `cordis/request-run` 并挂起，直到某次审批（`resolveRequestRun`）或调用方
`AbortSignal` 取消结算。没有自动超时；无人值守自动化不得依赖带 client 半的包。

**规则：** 一次激活是「一包一 run（pluginRunId）」。`runHostHalf` 对已运行的包只做
绑定、不重复求值；针对同一定义的并发调用只求值一次。`getClientCode` 是 client 源码
到达浏览器的唯一途径——代码从不搭乘任何播报事件。

**规则：** 会话隔离是读语义，不是鉴权。`invoke` 与 `resolveRequestRun` 完全不携带
会话；其他会话登记的定义读来是「不存在」而非「被禁止」，因此不会跨会话泄漏。任何有
实际动作的动词仍需校验所属会话归属。

## 装配约定（应用组合于此，而非内核）

**规则：** 计划中的应用垂直域（`cats`/`chat`/`limb`/`forgekin`，阶段 4–7）在此组合，
**不在 cordis 内核代码里组合**。runner 是它们与内核之间的装配点；内核只提供
`ctx.*` 服务与插件契约，垂直域能力以被加载的包形态落到这里。

**规则：** `apps/cli` 属于**计划（阶段 3）**，尚不存在。它是本包的消费方：启动根
`Context`、安装内核与领域服务、挂载 `@flowforge/cordis-host-runner`，再经
`@flowforge/tool-cordis` 的动词驱动包。不要在本包内假设 `apps/cli` 的具体形态或
为它写特例分支。

**规则：** 信任边界不是安全边界。VM 沙箱隔离全局变量，但 host 半声明/调用的服务会
触达存活运行时——对待动态包要像对待 bash 访问一样审慎。请勿在 host 半中引入可逃逸沙箱
或越权的 helper。

## 文档与改动

**规则：** 改动 `src/types.ts` 等 wire 载荷形状时，同步更新本包 `README.md` /
`README.zh.md` 与 `./types` 导出；这些形状与 `dynamicCordisRunner` remote namespace
的消费方共享，禁止悄悄改 schema。

**规则：** 新增/修改模型可见的拒绝原因（`definition-missing` / `host-half-failed` /
`client-half-failed` / `rejected` / `cancelled` / `not-running`）时，必须在 README
的「拒绝原因」段落同步列举，避免调用方（tool-cordis）行为漂移。

## 交叉引用

- 根目录红线与 Git 工作流：根 [`AGENTS.md`](../../../AGENTS.md)
- 重构上下文（T2.13 生产装配器 / T3.6 计划中的 `apps/cli`）：
  [`docs/refactor/22-stage2-plugins.md`](../../../docs/refactor/22-stage2-plugins.md)、
  [`docs/refactor/23-stage3-api-cli.md`](../../../docs/refactor/23-stage3-api-cli.md)
- 面向模型的动词与信任立场：[`@flowforge/tool-cordis`](../tool-cordis/README.md)

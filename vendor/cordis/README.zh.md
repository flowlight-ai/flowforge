# Cordis

> FlowForge 移植副本：本目录是 [Cordis](https://github.com/cordiverse/cordis) 内核的源码级改名移植，包名为 `@flowforge/cordis`。它是整个 FlowForge 的插件骨架——所有 `packages/*` 都是注册在它之上的 Cordis 插件。上游文档与论文见 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。对上游的偏离记录见 `vendor/README.md`；AI 工具与开发者规则见 `vendor/AGENTS.md`。

Cordis 是一个 TypeScript 插件框架，面向那些需要「显式依赖注入、作用域服务、生命周期托管的清理、以及可选的配置驱动加载」的应用。核心包发布为 `cordis`；本仓库里的官方包在此基础上增加了 loader、配置文件 include、HMR、控制台日志、定时器与项目脚手架。

## 安装

本包是以 `@flowforge/cordis` 的名字源码级移植进 FlowForge 工作区的——**不需要**从 npm 单独安装。它通过 `pnpm-workspace.yaml` 的 `linkWorkspacePackages` 解析。不要把它当成 npm 依赖去添加；把它当作 peer 依赖，引用 `@flowforge/cordis` 即可。

Cordis 优先使用 ESM。仓库在当前 Node 版本上测试，脚手架需要 Node 22 或更高。

## 快速开始

```ts
import { Context, Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    counter: Counter
  }

  interface Events {
    'app/ready'(message: string): void
  }
}

class Counter extends Service {
  value = 0

  constructor(ctx: Context) {
    super(ctx, 'counter')
  }

  next() {
    return ++this.value
  }
}

const greeter = Object.assign((ctx: Context) => {
  ctx.on('app/ready', (message) => {
    ctx.logger.info('%s #%d', message, ctx.counter.next())
  })
}, {
  inject: ['counter'],
})

const root = new Context()
await root.plugin(Counter)
await root.plugin(greeter)

root.emit('app/ready', 'started')
await root.fiber.dispose()
```

关键要点：

- `new Context()` 创建根依赖容器。
- `ctx.plugin()` 启动一个插件，返回一个 `Fiber`。
- `inject` 告诉 Cordis 该插件运行前哪些服务必须存在。
- 副作用（effect）、事件监听器与服务，都会在所属 fiber 卸载时被自动清理。

## 文档

- FlowForge 的 vendor 走读（专家版）：[`docs/refactor/vendor-walkthrough.md`](../../docs/refactor/vendor-walkthrough.md)
- FlowForge 的 vendor 走读（小白版）：[`docs/refactor/vendor-walkthrough-beginner.md`](../../docs/refactor/vendor-walkthrough-beginner.md)
- 可运行 demo：[`docs/refactor/vendor-demo.ts`](../../docs/refactor/vendor-demo.ts)
- 上游 Tutorial / Guide / API 参考见 Cordis 仓库（`cordiverse/cordis`）。

## 包清单

| 包 | 用途 |
| --- | --- |
| `@flowforge/cordis` | 核心 Context、插件注册表、Fiber 生命周期、事件总线、服务与日志。 |
| `@flowforge/cordis-plugin-loader` | 运行时插件树与 loader 服务。 |
| `@flowforge/cordis-plugin-include` | 为 loader 提供 YAML/JSON 配置文件的 include 支持。 |
| `@flowforge/cordis-plugin-group` | loader 配置里的嵌套插件分组。 |
| `@flowforge/cordis-plugin-hmr` | 为 loader 管理的插件提供热更新（HMR）。 |
| `@flowforge/cordis-plugin-logger-console` | 内置日志器的控制台导出器。 |
| `@flowforge/cordis-plugin-timer` | 与卸载绑定的 timeout / interval / throttle / debounce 工具。 |
| `@flowforge/cosmokit` | Cordis 各包共用的工具函数。 |
| `@flowforge/schemastery` | 类型驱动的 schema 校验器（`Schema<>`），用于每个插件的配置。 |

## 开发

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

FlowForge monorepo 用 `tsc -b`（工程引用）+ `tsdown` 构建，用 `oxlint` + `vitest` 做 lint/test。多数示例只用 `@flowforge/cordis` 的公开 API；loader 示例会额外用到 `@flowforge/cordis-plugin-loader` 与 `@flowforge/cordis-plugin-include`。

**不要随意手改 `vendor/cordis/src/`**——见 `vendor/AGENTS.md` 与 `vendor/README.md` 的同步流程。

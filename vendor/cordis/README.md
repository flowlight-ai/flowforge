# Cordis

> FlowForge 移植副本：本目录是 [Cordis](https://github.com/cordiverse/cordis) 内核的源码级改名移植，包名为 `@flowforge/cordis`。它是整个 FlowForge 的插件骨架——所有 `packages/*` 都是注册在它之上的 Cordis 插件。上游文档与论文见 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。对上游的偏离记录见 `vendor/README.md`；AI 工具与开发者规则见 `vendor/AGENTS.md`。

Cordis is a TypeScript plugin framework for applications that need explicit dependency injection, scoped services, lifecycle-managed cleanup, and optional configuration-driven loading. The core package is published as `cordis`; the official packages in this repository add a loader, config-file includes, HMR, console logging, timers, and project scaffolding.

## Install

This package is vendored into the FlowForge workspace as `@flowforge/cordis` — it is **not** installed from npm separately. It resolves through `pnpm-workspace.yaml` (`linkWorkspacePackages`). Do not add it as an npm dependency; depend on it as a peer via `@flowforge/cordis`.

Cordis is ESM-first. The repository is tested on current Node releases, and the scaffolder requires Node 22 or newer.

## Quick Start

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

The important pieces are:

- `new Context()` creates the root dependency container.
- `ctx.plugin()` starts a plugin and returns a `Fiber`.
- `inject` tells Cordis which services must exist before the plugin runs.
- Effects, event listeners, and services are removed when their owning fiber is disposed.

## Documentation

- FlowForge 的 vendor 走读（专家版）：[`docs/refactor/vendor-walkthrough.md`](../../docs/refactor/vendor-walkthrough.md)
- FlowForge 的 vendor 走读（小白版）：[`docs/refactor/vendor-walkthrough-beginner.md`](../../docs/refactor/vendor-walkthrough-beginner.md)
- 可运行 demo：[`docs/refactor/vendor-demo.ts`](../../docs/refactor/vendor-demo.ts)
- 上游 Tutorial: build a plugin / Guide: plugin lifecycle / Guide: loader configuration / API reference — see the Cordis repo (`cordiverse/cordis`).

## Packages

| Package | Purpose |
| --- | --- |
| `@flowforge/cordis` | Core context, plugin registry, fiber lifecycle, events, services, and logger. |
| `@flowforge/cordis-plugin-loader` | Runtime plugin tree and loader service. |
| `@flowforge/cordis-plugin-include` | YAML/JSON config-file include support for the loader. |
| `@flowforge/cordis-plugin-group` | Nested plugin groups for loader configs. |
| `@flowforge/cordis-plugin-hmr` | Hot module replacement for loader-managed plugins. |
| `@flowforge/cordis-plugin-logger-console` | Console exporter for the built-in logger. |
| `@flowforge/cordis-plugin-timer` | Disposal-aware timeout, interval, throttle, and debounce helpers. |
| `@flowforge/cosmokit` | Shared utilities used by Cordis packages. |
| `@flowforge/schemastery` | Type-driven schema validator (`Schema<>`) for per-plugin config. |

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

The FlowForge monorepo uses `tsc -b` (project references) + `tsdown` to build, and `oxlint` + `vitest` for lint/test. Most examples use public APIs from `@flowforge/cordis`; loader examples additionally use `@flowforge/cordis-plugin-loader` and `@flowforge/cordis-plugin-include`.

**Do not hand-edit `vendor/cordis/src/` casually** — see `vendor/AGENTS.md` and the sync procedure in `vendor/README.md`.

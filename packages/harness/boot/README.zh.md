# @flowforge/harness-boot

[English](README.md) | 中文

最小 cordis 插件宿主：manifest 驱动的插件装配（FlowForge 0.2.0 阶段 0 插件基座，
契约见 `docs/refactor/01-stack-decision.md` R13）。

每个功能包以 cordis 插件形态提供（`apply(ctx)` 函数 / 插件类 / 插件对象）。
宿主按 manifest 声明的 `provide`/`inject` 服务名对插件做拓扑排序，按依赖顺序
安装启用的插件并等待每个 fiber 加载完成。`stop()` dispose 根 fiber，卸载全部
插件；卸载后 `ctx.*` 服务不可用。

## 公开 API

- `PluginManifest` — 插件名 / 插件入口 / 配置 / 声明的 `provide`+`inject`
  服务名 / `enabled` 开关。
- `sortManifests(manifests)` — Kahn 拓扑排序；依赖缺失或成环直接抛错，
  尽早暴露装配问题。
- `Host` / `createHost(manifests)` — `use(manifest)` 在 `start()` 前追加；
  `start()` 按依赖顺序安装启用的插件；`stop()` 卸载全部。

```ts
import { createHost } from '@flowforge/harness-boot'
import { session } from '@flowforge/session'

const host = createHost([{ name: 'session', plugin: session }])
await host.start()
// ctx.sessions 可用
await host.stop()
// ctx.sessions 不可用
```

## 测试

`tests/boot.test.ts` — 装配顺序、缺失/循环依赖报错、插件生命周期
（install → ready → dispose）冒烟覆盖。

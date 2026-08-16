# @flowforge/harness-boot

English | [中文](README.zh.md)

Minimal cordis plugin host: manifest-driven plugin assembly for FlowForge 0.2.0
(stage-0 plugin base, contract in `docs/refactor/01-stack-decision.md` R13).

Every feature package ships a cordis plugin (`apply(ctx)` function / plugin
class / plugin object). The host sorts manifests topologically by their
declared `provide`/`inject` names, installs enabled plugins in that order, and
waits for each fiber to load before continuing. `stop()` disposes the root
fiber, unloading every plugin; after disposal `ctx.*` services are gone.

## Public API

- `PluginManifest` — name / plugin entry / config / declared `provide`+`inject`
  names / `enabled` switch.
- `sortManifests(manifests)` — Kahn topological sort; throws on missing or
  cyclic dependencies so assembly problems surface early.
- `Host` / `createHost(manifests)` — `use(manifest)` before `start()`;
  `start()` installs enabled plugins in dependency order; `stop()` unloads all.

```ts
import { createHost } from '@flowforge/harness-boot'
import { session } from '@flowforge/session'

const host = createHost([{ name: 'session', plugin: session }])
await host.start()
// ctx.sessions is available
await host.stop()
// ctx.sessions is gone
```

## Tests

`tests/boot.test.ts` — assembly order, missing/cyclic dependency errors, and
plugin lifecycle (install → ready → dispose) smoke coverage.

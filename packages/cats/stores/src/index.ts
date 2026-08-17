/**
 * @flowforge/cats-stores — Forgekin (cats) store ports + Memory backend Cordis
 * plugin + CatStores aggregate service.
 *
 * Architecture (对齐 dsh session/session-persistence 范式):
 * - `ports/` 纯 TypeScript 接口（无 Cordis 依赖）
 * - `CatStores extends Service` → `ctx.catStores` 聚合服务
 * - `MemoryStoresBackend extends Service` → Memory 后端插件（默认随主插件挂载）
 * - 后端通过 `static inject = ['catStores']` 注入聚合，再注册自身
 * - Sqlite 后端单独成包（`@flowforge/cats-stores-sqlite`，批次2.4）
 *
 * @module @flowforge/cats-stores
 */

import type { Context } from '@flowforge/cordis'
import { CatStores } from './cat-stores.ts'
import { MemoryStoresBackend } from './memory/backend.ts'

// Ports (pure TypeScript interfaces)
export * from './ports/index.ts'

// Memory backend (Cordis plugin + Memory store implementations)
export * from './memory/index.ts'

// Aggregate service
export { CatStores } from './cat-stores.ts'
export type { CatStoresBackend } from './cat-stores.ts'

/**
 * Default Cordis plugin: mounts CatStores at `ctx.catStores` and auto-loads
 * the Memory backend so out-of-the-box consumers have a working store.
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-stores'
 * ```
 *
 * To suppress the default Memory backend (e.g. when loading Sqlite only),
 * use the named plugin exports:
 * ```ts
 * import { CatStores } from '@flowforge/cats-stores'
 * ctx.plugin(CatStores)
 * // then ctx.plugin(SqliteStoresBackend) — see @flowforge/cats-stores-sqlite
 * ```
 */
export default function Plugin(ctx: Context) {
  ctx.plugin(CatStores)
  // Auto-mount Memory backend so the aggregate is usable out of the box.
  // Tests / production that load a different backend can still plugin(it) after —
  // the most-recently-registered backend becomes active.
  ctx.plugin(MemoryStoresBackend)
}

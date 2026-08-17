/**
 * CatRegistry — Cordis service for Forgekin (cats) runtime registration.
 *
 * clowder-ai used a module-level singleton `catRegistry`. In flowforge the
 * registry is a Cordis `Service` mounted at `ctx.cats`; lifetime is bound to
 * the plugin fiber and consumers resolve it through dependency injection.
 *
 * @module @flowforge/cats-shared
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatConfig } from '../types/cat.ts'
import type { CatId } from '../types/ids.ts'
import { createCatId } from '../types/ids.ts'

export interface CatRegistryEntry {
  readonly config: CatConfig
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Forgekin (cats) runtime registry — mounted by `@flowforge/cats-shared`. */
    cats: CatRegistry
  }
}

/**
 * Runtime registry for Forgekin (cats) configurations. Mounted at `ctx.cats`
 * by the `@flowforge/cats-shared` plugin. Consumers read live configs through
 * `ctx.cats.tryGet(id)` / `ctx.cats.getOrThrow(id)`; providers register
 * configs during boot via `ctx.cats.register(id, config)`.
 */
export class CatRegistry extends Service {
  private entries = new Map<string, CatRegistryEntry>()
  private revision = 0

  constructor(ctx: Context) {
    super(ctx, 'cats')
  }

  /**
   * Register a Forgekin. Throws on duplicate ID.
   * Effect-scoped: the registration is removed when the calling fiber unloads.
   */
  register(catId: string, config: CatConfig): void {
    this.ctx.effect(() => {
      if (this.entries.has(catId)) {
        throw new Error(`Cat "${catId}" is already registered`)
      }
      this.entries.set(catId, { config })
      this.revision += 1
      return () => {
        this.entries.delete(catId)
        this.revision += 1
      }
    }, `cats.register(${catId})`)
  }

  has(catId: string): boolean {
    return this.entries.has(catId)
  }

  /**
   * Get entry — throws if not found. Use at boundary layers (routes, RPC, MCP).
   */
  getOrThrow(catId: string): CatRegistryEntry {
    const entry = this.entries.get(catId)
    if (!entry) {
      throw new Error(`Unknown cat ID: "${catId}". Registered: ${this.getAllIds().join(', ')}`)
    }
    return entry
  }

  /**
   * Get entry — returns undefined if not found. Use where fallback is acceptable.
   */
  tryGet(catId: string): CatRegistryEntry | undefined {
    return this.entries.get(catId)
  }

  getAllIds(): CatId[] {
    return Array.from(this.entries.keys()).map((id) => createCatId(id))
  }

  getAllConfigs(): Record<string, CatConfig> {
    const result: Record<string, CatConfig> = {}
    for (const [id, entry] of this.entries) {
      result[id] = entry.config
    }
    return result
  }

  getRevision(): number {
    return this.revision
  }

  /**
   * Non-empty tuple for z.enum() compat (if needed).
   * Throws if registry is empty.
   */
  getValidCatIds(): [string, ...string[]] {
    const ids = Array.from(this.entries.keys())
    if (ids.length === 0) {
      throw new Error('CatRegistry is empty — was it initialized before use?')
    }
    return ids as [string, ...string[]]
  }

  /**
   * Assert that a string is a registered cat ID. Throws if not.
   * Use at system boundaries (RPC handlers, MCP callbacks, external input).
   */
  assertKnownCatId(id: string): CatId {
    this.getOrThrow(id)
    return createCatId(id)
  }

  /** Clear all entries. For testing only. */
  reset(): void {
    this.entries.clear()
    this.revision += 1
  }
}

export default CatRegistry

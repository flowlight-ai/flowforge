/**
 * Registry exports
 *
 * In flowforge, `catRegistry` is no longer a module-level singleton — it is a
 * Cordis Service mounted at `ctx.cats`. `assertKnownCatId` is now an instance
 * method on `CatRegistry` (`ctx.cats.assertKnownCatId(id)`).
 */

export type { CatRegistryEntry } from './CatRegistry.ts'
export { CatRegistry } from './CatRegistry.ts'
export { catIdSchema } from './cat-id-schema.ts'
export { type NormalizeCatResult, normalizeCatId } from './normalize-cat-id.ts'

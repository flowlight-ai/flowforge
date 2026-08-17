/**
 * @flowforge/cats-shared — Forgekin (cats) shared types, schemas, pure functions,
 * and CatRegistry Cordis service.
 *
 * This package is the foundation of the cats domain. All types and pure
 * functions are framework-agnostic; the CatRegistry is a Cordis `Service`
 * mounted at `ctx.cats` via the default plugin export.
 *
 * @module @flowforge/cats-shared
 */

import type { Context } from '@flowforge/cordis'
import { CatRegistry } from './registry/CatRegistry.ts'

// Registry (CatRegistry Service, catIdSchema, normalizeCatId)
export * from './registry/index.ts'

// Schemas (zod)
export * from './schemas/index.ts'

// Types
export * from './types/index.ts'
export * from './types/auto-dream.ts'
export * from './types/memory-cue.ts'

// Pure function modules
export * from './approval-producer-catalog.ts'
export * from './avatar-limits.ts'
export * from './capability-tip-telemetry.ts'
export * from './capability-tips.ts'
export * from './cli-effort.ts'
export { parseCommand } from './command-parser.ts'
export type {
  AutonomousPetState,
  CodexPetState,
  PetBehaviorOutput,
  PetStateProjection,
} from './concierge/pet-skin-projection.ts'
export {
  PET_STATE_PROJECTION_V0,
  PET_STATE_PROJECTION_V1,
  projectToPetState,
} from './concierge/pet-skin-projection.ts'
export { CORE_COMMANDS } from './core-commands.ts'
export * from './eval-metric-ref.ts'
export * from './recall-outcome.ts'
export * from './source-code-extensions.ts'
export * from './text-utils.ts'
export * from './utils/subject-key.ts'

// Scanner discovery (pure)
export * from './scanner-discovery-pure.ts'

/**
 * Default Cordis plugin: mounts CatRegistry at `ctx.cats`.
 *
 * Register in cordis.patch.yml:
 * ```yaml
 * - name: '@flowforge/cats-shared'
 * ```
 */
export default function Plugin(ctx: Context) {
  ctx.plugin(CatRegistry)
}

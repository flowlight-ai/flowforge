/**
 * @flowforge/cats-profile — Forgekin (cats) profile repository + approval
 * pipeline Cordis plugin.
 *
 * Architecture (对齐 dsh 范式，R13 一切皆插件):
 * - `ProfileRepositoryService extends Service` → `ctx.catsProfile`
 *   (scope derivation, primer path resolution/reads)
 * - `ProfileApprovalService extends Service` → `ctx.catsProfileApproval`
 *   (approve critical section: per-target lock + P1-1 checkpoint pipeline +
 *   P1-2 optimistic lock; one-shot reject)
 * - Pure writers live in `./write-profile-update.ts` (no Cordis dependency)
 * - Proposals persist through `ctx.catStores.profileUpdateProposals()`
 *   (batch 4.2a port + Memory backend)
 *
 * Consumers load the default plugin:
 * ```ts
 * import CatsProfile from '@flowforge/cats-profile'
 * ctx.plugin(CatsProfile)
 * // ctx.catsProfile / ctx.catsProfileApproval ready (requires ctx.cats +
 * // ctx.catStores aggregates to be loaded first)
 * ```
 *
 * @module @flowforge/cats-profile
 */

import type { Context } from '@flowforge/cordis'
import { ProfileApprovalService } from './approval.ts'
import { ProfileRepositoryService } from './repository.ts'

// Re-export repository service + types.
export { ProfileRepositoryService } from './repository.ts'
export type { ProfileRepositoryOptions, ProfileScope } from './repository.ts'

// Re-export approval service + types.
export { ProfileApprovalService } from './approval.ts'
export type {
  ApproveFailureReason,
  ApproveProfileUpdateResult,
  RejectProfileUpdateResult,
  WritePrimerFn,
  WriteProvenanceFn,
} from './approval.ts'

// Re-export pure writers + errors (P1-1 / P1-2 semantics).
export {
  hashContent,
  InvalidPrimerPathError,
  provenancePathFor,
  resolvePrimerPath,
  StaleProfileUpdateError,
  writeProfilePrimer,
  writeProfileProvenance,
} from './write-profile-update.ts'
export type {
  ProfileWriteFileOps,
  WritableProfileUpdate,
  WriteProfilePrimerOptions,
} from './write-profile-update.ts'

// Re-export shared profile-update types + store port for one-stop imports.
export type {
  CollectionSignalKind,
  ProfileUpdateApproveOverrides,
  ProfileUpdateProposal,
  ProfileUpdateProposalStatus,
  ProfileUpdateSignalProvenance,
  ProfileUpdateTargetLayer,
} from '@flowforge/cats-shared'
export type {
  CreateProfileUpdateProposalInput,
  IProfileUpdateProposalStore,
  ProfileUpdateCheckpoint,
} from '@flowforge/cats-stores'

/**
 * Default Cordis plugin: mounts the profile repository at `ctx.catsProfile`
 * and the approval pipeline at `ctx.catsProfileApproval`.
 *
 * Both services declare their own `static inject` (`cats`, `catStores`,
 * `catsProfile`) so Cordis schedules them after their dependencies.
 */
export default function Plugin(ctx: Context) {
  ctx.plugin(ProfileRepositoryService)
  ctx.plugin(ProfileApprovalService)
}

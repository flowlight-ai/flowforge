/**
 * ProfileRepositoryService — canonical F231 user-profile repository.
 *
 * Ported from clowder-ai `FileProfileRepository`
 * (api/src/domains/cats/services/profile/ProfileRepository.ts), transformed
 * into a Cordis `Service` (R13 plugin-first constraint):
 * - clowder-ai resolved the relationshipKey through the module-level
 *   `catRegistry` singleton; here it resolves through `ctx.cats`
 *   (CatRegistry service), overridable via `relationshipKeyForCat` for
 *   tests / alternate registries.
 * - The root is deliberately independent of cwd, install root, and worktree.
 *   Legacy private/profile trees are migration inputs only and never
 *   participate in runtime reads.
 *
 * 对齐 dsh `@flowforge/agent-default-model` 范式：`ProfileRepositoryService
 * extends Service` 挂载到 `ctx.catsProfile`。
 *
 * @module @flowforge/cats-profile/repository
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { Context, Service } from '@flowforge/cordis'
import {
  CURRENT_RELATIONSHIP_PROFILE_URI,
  assertProfilePathSegment,
  profileUserRelativePath,
  relationshipKeyFromPrimerRelativePath,
  relationshipPrimerRelativePath,
} from '@flowforge/cats-shared/profile-contract'

export interface ProfileScope {
  userId: string
  catId: string
  relationshipKey: string
}

export interface ProfileRepositoryOptions {
  dataDir?: string
  homeDir?: string
  relationshipKeyForCat?: (catId: string) => string | undefined
}

declare module '@flowforge/cordis' {
  interface Context {
    /**
     * Forgekin (cats) profile repository — mounted by `@flowforge/cats-profile`.
     * Owns profile-dir resolution, relationship-persona scope derivation, and
     * primer reads.
     */
    catsProfile: ProfileRepositoryService
  }
}

/**
 * Cordis service exposing the canonical profile repository at `ctx.catsProfile`.
 *
 * Resolves the relationshipKey through the live `ctx.cats` registry unless a
 * custom resolver is injected at construction (tests, alternate registries).
 */
export class ProfileRepositoryService extends Service {
  static inject = ['cats']

  readonly dataDir: string
  private readonly relationshipKeyResolver: (catId: string) => string | undefined

  constructor(ctx: Context, options: ProfileRepositoryOptions = {}) {
    super(ctx, 'catsProfile')
    this.dataDir = resolve(
      options.dataDir ?? process.env.CAT_CAFE_DATA_DIR ?? resolve(options.homeDir ?? homedir(), '.cat-cafe'),
    )
    this.relationshipKeyResolver =
      options.relationshipKeyForCat ?? ((catId) => ctx.cats?.tryGet(catId)?.config.relationshipKey)
  }

  profileDir(userId: string): string {
    return resolve(this.dataDir, ...profileUserRelativePath(userId).split('/'))
  }

  scope(userId: string, catId: string): ProfileScope {
    profileUserRelativePath(userId)
    assertProfilePathSegment('catId', catId)
    const relationshipKey = this.relationshipKeyResolver(catId)
    if (!relationshipKey) {
      throw new Error(`No relationship key configured for catId "${catId}"; refusing catId fallback`)
    }
    assertProfilePathSegment('relationshipKey', relationshipKey)
    return { userId, catId, relationshipKey }
  }

  /**
   * Resolve a server-pinned proposal target without re-projecting today's catalog.
   * A model/catalog upgrade between propose and approve must not redirect or
   * strand an already-audited proposal.
   */
  scopeForPinnedPrimerTarget(userId: string, catId: string, targetPath: string): ProfileScope {
    profileUserRelativePath(userId)
    assertProfilePathSegment('catId', catId)
    const relationshipKey = relationshipKeyFromPrimerRelativePath(targetPath)
    const currentRelationshipKey = this.relationshipKeyResolver(catId)
    if (!currentRelationshipKey) {
      throw new Error(`No relationship key configured for catId "${catId}"; refusing pinned primer approval`)
    }
    if (relationshipKey === catId && currentRelationshipKey !== relationshipKey) {
      throw new Error(
        `Legacy catId-keyed primer target "${targetPath}" cannot be approved after persona migration; ` +
          `re-propose for relationshipKey "${currentRelationshipKey}"`,
      )
    }
    return { userId, catId, relationshipKey }
  }

  primerPath(scope: ProfileScope): string {
    const relativePath = relationshipPrimerRelativePath(scope.relationshipKey)
    return resolve(this.profileDir(scope.userId), ...relativePath.split('/'))
  }

  resolvePrimerTarget(scope: ProfileScope, targetPath: string): string {
    const expected = relationshipPrimerRelativePath(scope.relationshipKey)
    const normalized = targetPath.replaceAll('\\', '/')
    if (normalized !== expected) {
      throw new Error(`Invalid primer target "${targetPath}"; expected ${expected}`)
    }
    return this.primerPath(scope)
  }

  readPrimer(scope: ProfileScope): { content: string; path: string } | null {
    const path = this.primerPath(scope)
    if (!existsSync(path)) return null
    return { content: readFileSync(path, 'utf8'), path }
  }

  currentRelationshipUri(): typeof CURRENT_RELATIONSHIP_PROFILE_URI {
    return CURRENT_RELATIONSHIP_PROFILE_URI
  }
}

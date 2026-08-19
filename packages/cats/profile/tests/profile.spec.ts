/**
 * @flowforge/cats-profile — unit tests for the profile repository service,
 * the P1-1/P1-2 pure writers, and the approval pipeline (batch 4.5).
 *
 * 对齐 dsh 测试风格：Cordis 服务直接构造挂到 `new Context()`（Service
 * 构造即注册），审批管线走 `ctx.catStores`（Memory 后端）+ `ctx.catsProfile`。
 *
 * @module @flowforge/cats-profile/tests
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, type CatConfig } from '@flowforge/cats-shared'
import { CatRegistry } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import {
  hashContent,
  InvalidPrimerPathError,
  ProfileApprovalService,
  ProfileRepositoryService,
  resolvePrimerPath,
  StaleProfileUpdateError,
  writeProfilePrimer,
  writeProfileProvenance,
} from '../src/index.ts'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const catA = createCatId('cat_a')
const REL_KEY = 'persona-a'
const USER = 'user_1'
const TARGET = `relationship/${REL_KEY}-primer.md`

const tmpRoot = mkdtempSync(join(tmpdir(), 'flowforge-cats-profile-'))
afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function dataDir(name: string): string {
  const dir = join(tmpRoot, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Minimal registry-backed CatConfig fixture with a relationshipKey. */
function catConfig(catName: string, relationshipKey?: string): CatConfig {
  return {
    id: createCatId(catName),
    name: catName,
    displayName: 'Cat A',
    avatar: '/avatars/cat-a.png',
    color: { primary: '#ff0000', secondary: '#ffdddd' },
    mentionPatterns: ['@cat_a'],
    clientId: 'anthropic',
    defaultModel: 'claude-sonnet-4-5',
    mcpSupport: true,
    roleDescription: 'test cat',
    personality: 'test',
    ...(relationshipKey !== undefined ? { relationshipKey } : {}),
  }
}

interface ApprovalHarness {
  ctx: Context
  approval: ProfileApprovalService
  repository: ProfileRepositoryService
  store: ReturnType<CatStores['profileUpdateProposals']>
  dir: string
}

/** Build a Cordis context with stores + repository + approval wired. */
function harness(
  dir: string,
  relationshipKey: string = REL_KEY,
  approvalOptions: ConstructorParameters<typeof ProfileApprovalService>[1] = {},
): ApprovalHarness {
  const ctx = new Context()
  new CatStores(ctx)
  new MemoryStoresBackend(ctx)
  const repository = new ProfileRepositoryService(ctx, {
    dataDir: dir,
    relationshipKeyForCat: (catId) => (catId === 'cat_a' ? relationshipKey : undefined),
  })
  const approval = new ProfileApprovalService(ctx, approvalOptions)
  return { ctx, approval, repository, store: ctx.catStores.profileUpdateProposals(), dir }
}

interface ProposalSeed {
  beforeContent?: string
  afterContent?: string
  dir?: string
}

/** Seed a primer on disk + create a matching pending proposal. */
async function seedProposal(h: ApprovalHarness, seed: ProposalSeed = {}) {
  const beforeContent = seed.beforeContent ?? 'old primer'
  const afterContent = seed.afterContent ?? 'new primer'
  const scope = h.repository.scope(USER, 'cat_a')
  const primerPath = h.repository.primerPath(scope)
  mkdirSync(dirname(primerPath), { recursive: true })
  writeFileSync(primerPath, beforeContent, 'utf8')

  const proposal = await h.store.create({
    sourceThreadId: 'thread_1',
    sourceInvocationId: 'inv_1',
    sourceCatId: catA,
    targetLayer: 'primer',
    targetPath: TARGET,
    beforeContent,
    baseContentHash: hashContent(beforeContent),
    afterContent,
    rationale: 'record operator preference',
    signalProvenance: { kind: 'cvo-instructed', sourceThreadId: 'thread_1' },
    createdBy: USER,
  })
  return { proposal, primerPath, scope }
}

// ---------------------------------------------------------------------------
// Pure writers (write-profile-update.ts)
// ---------------------------------------------------------------------------

describe('write-profile-update pure functions', () => {
  it('resolvePrimerPath validates the exact relationship primer shape', () => {
    const dir = dataDir('writers-resolve')
    const full = resolvePrimerPath(dir, TARGET, REL_KEY)
    expect(full).toBe(resolve(dir, TARGET))

    expect(() => resolvePrimerPath(dir, 'relationship/other-primer.md', REL_KEY)).toThrow(InvalidPrimerPathError)
    expect(() => resolvePrimerPath(dir, '../../etc/passwd', REL_KEY)).toThrow(InvalidPrimerPathError)
    expect(() => resolvePrimerPath(dir, '/abs/path.md', REL_KEY)).toThrow(InvalidPrimerPathError)
  })

  it('writeProfilePrimer writes when the base hash matches, else throws StaleProfileUpdateError', () => {
    const dir = dataDir('writers-primer')
    const base = 'before'
    // Seed the primer so the optimistic lock has a base to compare against.
    const seededPath = resolvePrimerPath(dir, TARGET, REL_KEY)
    mkdirSync(dirname(seededPath), { recursive: true })
    writeFileSync(seededPath, base, 'utf8')
    const proposal = {
      proposalId: 'p1',
      sourceCatId: catA,
      sourceThreadId: 'thread_1',
      targetPath: TARGET,
      beforeContent: base,
      baseContentHash: hashContent(base),
      afterContent: 'after',
      rationale: 'r',
      signalProvenance: { kind: 'cvo-instructed' as const, sourceThreadId: 'thread_1' },
    }

    const { writtenPath } = writeProfilePrimer(proposal, dir, REL_KEY)
    expect(readFileSync(writtenPath, 'utf8')).toBe('after')

    // Primer now differs from a stale proposal pinned on the old content.
    expect(() => writeProfilePrimer(proposal, dir, REL_KEY)).toThrow(StaleProfileUpdateError)

    // Crash recovery: hash differs but content equals afterContent → skip write.
    const ok = writeProfilePrimer(proposal, dir, REL_KEY, { allowAlreadyApplied: true })
    expect(ok.writtenPath).toBe(writtenPath)
  })

  it('writeProfileProvenance writes a deterministic before/after record', () => {
    const dir = dataDir('writers-provenance')
    const proposal = {
      proposalId: 'p2',
      sourceCatId: catA,
      sourceThreadId: 'thread_1',
      targetPath: TARGET,
      beforeContent: 'B',
      baseContentHash: hashContent('B'),
      afterContent: 'A',
      rationale: 'why',
      signalProvenance: {
        kind: 'cat-declared' as const,
        sourceThreadId: 'thread_9',
        sourceMessageId: 'msg_1',
      },
    }

    const { provenancePath } = writeProfileProvenance(proposal, dir)
    expect(provenancePath.endsWith(join('provenance', 'p2-cat_a-primer.md'))).toBe(true)

    const content = readFileSync(provenancePath, 'utf8')
    expect(content).toContain('signalKind: cat-declared')
    expect(content).toContain('signalSourceMessage: msg_1')
    expect(content).toContain('## Before (pinned at propose)')
    expect(content).toContain('B')
    expect(content).toContain('## After')
    expect(content).toContain('A')
  })
})

// ---------------------------------------------------------------------------
// ProfileRepositoryService
// ---------------------------------------------------------------------------

describe('ProfileRepositoryService', () => {
  it('derives profile dir / scope / primer path from dataDir + resolver', () => {
    const ctx = new Context()
    const dir = dataDir('repo-basic')
    const repo = new ProfileRepositoryService(ctx, {
      dataDir: dir,
      relationshipKeyForCat: () => REL_KEY,
    })

    const scope = repo.scope(USER, 'cat_a')
    expect(scope).toEqual({ userId: USER, catId: 'cat_a', relationshipKey: REL_KEY })
    expect(repo.primerPath(scope).startsWith(repo.profileDir(USER))).toBe(true)
    expect(repo.profileDir(USER).startsWith(dir)).toBe(true)
  })

  it('refuses catId fallback when no relationship key is configured', () => {
    const ctx = new Context()
    const repo = new ProfileRepositoryService(ctx, { dataDir: dataDir('repo-noref'), relationshipKeyForCat: () => undefined })
    expect(() => repo.scope(USER, 'cat_b')).toThrow(/No relationship key configured/)
  })

  it('scopeForPinnedPrimerTarget blocks legacy catId-keyed targets after migration', () => {
    const ctx = new Context()
    const repo = new ProfileRepositoryService(ctx, {
      dataDir: dataDir('repo-pinned'),
      relationshipKeyForCat: () => REL_KEY,
    })

    const scope = repo.scopeForPinnedPrimerTarget(USER, 'cat_a', TARGET)
    expect(scope.relationshipKey).toBe(REL_KEY)

    // Legacy target keyed by catId while the registry moved to REL_KEY → refuse.
    expect(() => repo.scopeForPinnedPrimerTarget(USER, 'cat_a', 'relationship/cat_a-primer.md')).toThrow(
      /cannot be approved after persona migration/,
    )
  })

  it('readPrimer returns null when absent and content when present', () => {
    const ctx = new Context()
    const dir = dataDir('repo-read')
    const repo = new ProfileRepositoryService(ctx, { dataDir: dir, relationshipKeyForCat: () => REL_KEY })
    const scope = repo.scope(USER, 'cat_a')

    expect(repo.readPrimer(scope)).toBeNull()

    const path = repo.primerPath(scope)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, 'hello', 'utf8')
    expect(repo.readPrimer(scope)).toEqual({ content: 'hello', path })
  })

  it('resolves the relationshipKey through the live ctx.cats registry by default', () => {
    const ctx = new Context()
    new CatRegistry(ctx)
    ctx.cats.register('cat_a', catConfig('cat_a', REL_KEY))
    const repo = new ProfileRepositoryService(ctx, { dataDir: dataDir('repo-registry') })

    expect(repo.scope(USER, 'cat_a').relationshipKey).toBe(REL_KEY)
    // Cat without a relationshipKey → refuse (undefined resolver result).
    ctx.cats.register('cat_b', catConfig('cat_b', undefined))
    expect(() => repo.scope(USER, 'cat_b')).toThrow(/No relationship key configured/)
  })
})

// ---------------------------------------------------------------------------
// ProfileApprovalService (approve / recover / reject)
// ---------------------------------------------------------------------------

describe('ProfileApprovalService', () => {
  it('approves a pending proposal: primer + provenance written, status approved', async () => {
    const h = harness(dataDir('approve-happy'))
    const { proposal, primerPath } = await seedProposal(h)

    const result = await h.approval.approve(proposal.proposalId, 'operator')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.recovered).toBe(false)
    expect(result.proposal.status).toBe('approved')
    expect(result.proposal.writtenPath).toBe(primerPath)
    expect(result.proposal.provenancePath).toBeDefined()

    expect(readFileSync(primerPath, 'utf8')).toBe('new primer')
    const provenance = readFileSync(result.proposal.provenancePath!, 'utf8')
    expect(provenance).toContain('# Provenance: profile-update')
  })

  it('re-approve of an approved proposal is an idempotent no-op', async () => {
    const h = harness(dataDir('approve-idempotent'))
    const { proposal } = await seedProposal(h)

    const first = await h.approval.approve(proposal.proposalId, 'operator')
    expect(first.ok).toBe(true)
    const second = await h.approval.approve(proposal.proposalId, 'operator')
    expect(second).toMatchObject({ ok: true, recovered: false })
  })

  it('stale primer (changed after propose) rolls the claim back to pending', async () => {
    const h = harness(dataDir('approve-stale'))
    const { proposal, primerPath } = await seedProposal(h)

    // Mutate the primer after propose → optimistic lock must fire.
    writeFileSync(primerPath, 'drifted content', 'utf8')

    const result = await h.approval.approve(proposal.proposalId, 'operator')
    expect(result).toMatchObject({ ok: false, reason: 'stale_hash' })

    const stored = await h.store.get(proposal.proposalId)
    expect(stored?.status).toBe('pending')
    expect(stored?.approvedBy).toBeUndefined()
  })

  it('rejects a pending proposal one-shot; rejecting again reports not_pending', async () => {
    const h = harness(dataDir('reject'))
    const { proposal } = await seedProposal(h)

    const rejected = await h.approval.reject(proposal.proposalId, 'operator', 'inaccurate')
    expect(rejected.ok).toBe(true)
    if (!rejected.ok) return
    expect(rejected.proposal.status).toBe('rejected')
    expect(rejected.proposal.rejectionReason).toBe('inaccurate')

    const again = await h.approval.reject(proposal.proposalId, 'operator')
    expect(again).toMatchObject({ ok: false, reason: 'not_pending' })

    // Rejected proposals cannot be approved either.
    const approve = await h.approval.approve(proposal.proposalId, 'operator')
    expect(approve).toMatchObject({ ok: false, reason: 'rejected' })
  })

  it('crash recovery: approving + writtenPath checkpoint resumes from provenance only', async () => {
    const h = harness(dataDir('recover'))
    const { proposal, primerPath } = await seedProposal(h)

    // Simulate a crash after primer write + checkpoint: status approving,
    // primer already contains afterContent, writtenPath checkpointed.
    writeFileSync(primerPath, 'new primer', 'utf8')
    await h.store.claimForApproval(proposal.proposalId, 'operator-crashed')
    await h.store.recordCheckpoint(proposal.proposalId, { writtenPath: primerPath })

    const result = await h.approval.approve(proposal.proposalId, 'operator')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.recovered).toBe(true)
    expect(result.proposal.status).toBe('approved')
    expect(result.proposal.provenancePath).toBeDefined()
    // Primer untouched by recovery (no re-write of the same content path).
    expect(readFileSync(primerPath, 'utf8')).toBe('new primer')
  })

  it('not_found for unknown proposal ids', async () => {
    const h = harness(dataDir('notfound'))
    const approve = await h.approval.approve('proposal_missing', 'operator')
    expect(approve).toMatchObject({ ok: false, reason: 'not_found' })
    const reject = await h.approval.reject('proposal_missing', 'operator')
    expect(reject).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('write_failed (with rollback) when the primer writer throws after claim', async () => {
    const h = harness(dataDir('write-fail'), REL_KEY, {
      writePrimer: () => {
        throw new Error('disk full')
      },
    })
    const { proposal } = await seedProposal(h)

    const result = await h.approval.approve(proposal.proposalId, 'operator')
    expect(result).toMatchObject({ ok: false, reason: 'write_failed', error: 'disk full' })

    // Nothing committed → rolled back to pending.
    const stored = await h.store.get(proposal.proposalId)
    expect(stored?.status).toBe('pending')
  })

  it('serializes concurrent approves of the same target under the per-target lock', async () => {
    const h = harness(dataDir('lock-serialize'))
    const { proposal, primerPath } = await seedProposal(h)

    // First approve wins; the concurrent second observe terminal approved.
    const [a, b] = await Promise.all([
      h.approval.approve(proposal.proposalId, 'op-1'),
      h.approval.approve(proposal.proposalId, 'op-2'),
    ])
    expect(a.ok || b.ok).toBe(true)
    expect(readFileSync(primerPath, 'utf8')).toBe('new primer')
    const stored = await h.store.get(proposal.proposalId)
    expect(stored?.status).toBe('approved')
  })
})



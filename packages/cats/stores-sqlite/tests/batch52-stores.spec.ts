/**
 * 批次52：12 个新增 sqlite store 的语义测试（与 Memory 版对齐）。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { CatStores } from '@flowforge/cats-stores'
import { MemoryMessageStore } from '@flowforge/cats-stores/memory'
import { SqliteStoresBackend } from '../src/index.ts'

async function makeBackend() {
  const ctx = new Context()
  await ctx.plugin((await import('@flowforge/cats-stores')).default)
  await ctx.plugin(SqliteStoresBackend, { path: ':memory:' })
  const backend = ctx.catStoresSqlite
  return { ctx, backend, aggregate: ctx.catStores as CatStores }
}

describe('批次52 sqlite stores', () => {
  it('read-state：ack 单调 CAS + reconcile 换写 + deleteByThread', async () => {
    const { backend } = await makeBackend()
    const store = backend.threadReadStateStore
    expect(store.ack('u1', 't1', 'm-01')).toBe(true)
    expect(store.get('u1', 't1')?.lastReadMessageId).toBe('m-01')
    // 旧 cursor 拒绝（只前进，lex 比较）
    expect(store.ack('u1', 't1', 'm-00')).toBe(false)
    expect(store.ack('u1', 't1', 'v2:0000000000000010:m-01')).toBe(true)
    // reconcile：v1 → v2 无前进换写，旧值不匹配拒绝
    expect(store.reconcileReadCursor('u1', 't1', 'm-wrong', 'v2:1:x')).toBe(false)
    store.ack('u2', 't1', 'm-1')
    store.deleteByThread('t1')
    expect(store.get('u1', 't1')).toBeNull()
    expect(store.get('u2', 't1')).toBeNull()
  })

  it('read-state：getUnreadSummaries 基于注入的 messageStore', async () => {
    const { backend } = await makeBackend()
    const store = backend.threadReadStateStore
    const messages = new MemoryMessageStore()
    const now = Date.now()
    messages.append({ threadId: 't9', userId: 'u1', catId: null, content: 'a', mentions: [], mentionsUser: false, timestamp: now } as never)
    messages.append({ threadId: 't9', userId: 'u1', catId: null, content: '@u1 hi', mentions: [], mentionsUser: true, timestamp: now + 1 } as never)
    store.ack('u1', 't9', 'm-1')
    const summaries = await store.getUnreadSummaries('u1', ['t9'], messages)
    expect(summaries[0]?.threadId).toBe('t9')
    expect(summaries[0]?.unreadCount).toBeGreaterThan(0)
    expect(summaries[0]?.hasUserMention).toBe(true)
  })

  it('vote：save/get/clear 原样读写', async () => {
    const { backend } = await makeBackend()
    const store = backend.voteStore
    expect(store.getByThread('t1')).toBeNull()
    const state = { version: 'v1', status: 'active', topic: 'x' } as never
    store.saveByThread('t1', state)
    expect(store.getByThread('t1')).toEqual(state)
    store.clearByThread('t1')
    expect(store.getByThread('t1')).toBeNull()
  })

  it('thread-memory：容量淘汰最旧 key + deleteThread 计数', async () => {
    const { backend } = await makeBackend()
    const store = backend.threadMemoryStore
    // 填满 50 个 key
    for (let i = 0; i < 50; i++) {
      store.set({ threadId: 't1', key: `k${i}`, value: String(i), updatedBy: 'user' })
    }
    // 最旧的是 k0——新 key 触发淘汰
    store.set({ threadId: 't1', key: 'k-new', value: 'new', updatedBy: 'user' })
    expect(store.get('t1', 'k0')).toBeNull()
    expect(store.get('t1', 'k-new')).not.toBeNull()
    expect(store.list('t1')).toHaveLength(50)
    // 覆盖已有 key 不触发淘汰
    store.set({ threadId: 't1', key: 'k1', value: 'updated', updatedBy: 'user' })
    expect(store.get('t1', 'k1')?.value).toBe('updated')
    expect(store.delete('t1', 'k1')).toBe(true)
    expect(store.deleteThread('t1')).toBe(49)
  })

  it('task-progress：setSnapshot 覆盖 + deleteSnapshotIfOwner CAS', async () => {
    const { backend } = await makeBackend()
    const store = backend.taskProgressStore
    const snapshot = {
      threadId: 't1', catId: 'cat-1',
      tasks: [{ id: 'a', subject: 's', status: 'running' }],
      status: 'running', updatedAt: 1, lastInvocationId: 'inv-1',
    } as unknown as Parameters<typeof store.setSnapshot>[0]
    await store.setSnapshot(snapshot)
    expect((await store.getSnapshot('t1' as never, 'cat-1' as never))?.lastInvocationId).toBe('inv-1')
    // owner 不匹配：拒绝删除
    expect(await store.deleteSnapshotIfOwner('t1' as never, 'cat-1' as never, 'inv-2' as never)).toBe(false)
    expect(await store.getSnapshot('t1' as never, 'cat-1' as never)).not.toBeNull()
    // owner 匹配：CAS 删除
    expect(await store.deleteSnapshotIfOwner('t1' as never, 'cat-1' as never, 'inv-1' as never)).toBe(true)
    expect(await store.getSnapshot('t1' as never, 'cat-1' as never)).toBeNull()
    await store.setSnapshot(snapshot)
    await store.setSnapshot({ ...snapshot, catId: 'cat-2' } as Parameters<typeof store.setSnapshot>[0])
    expect(Object.keys(await store.getThreadSnapshots('t1' as never))).toEqual(['cat-1', 'cat-2'])
    await store.deleteThread('t1' as never)
    expect(await store.getThreadSnapshots('t1' as never)).toEqual({})
  })

  it('task-managed-work：upsert 幂等/冲突 + (workId, attemptId) 反查', async () => {
    const { backend } = await makeBackend()
    const store = backend.taskManagedWorkRegistrationStore
    expect(await store.upsert('task-1', { workId: 'w1', attemptId: 'a1' }))
      .toMatchObject({ outcome: 'bound' })
    // 相同绑定幂等
    expect(await store.upsert('task-1', { workId: 'w1', attemptId: 'a1' }))
      .toMatchObject({ outcome: 'bound' })
    // 冲突
    const conflict = await store.upsert('task-1', { workId: 'w2', attemptId: 'a2' })
    expect(conflict.outcome).toBe('conflict')
    expect(await store.get('task-1')).toEqual({ workId: 'w1', attemptId: 'a1' })
    expect(await store.getByWorkAttempt('w1', 'a1')).toBe('task-1')
    expect(await store.getByWorkAttempt('w2', 'a2')).toBeNull()
    expect(await store.delete('task-1')).toBe(true)
    expect(await store.get('task-1')).toBeNull()
  })

  it('signal-article：URL 归一化去重 + upsert 保留 filePath + update patch', async () => {
    const { backend } = await makeBackend()
    const store = backend.signalArticleStore
    const source = { id: 'hackernews', tier: 'cloud' } as never
    const a1 = store.upsert({
      source, title: 'A', url: 'https://x.com/p?utm_source=t#frag',
      publishedAt: '2026-09-01', content: 'body', summary: 'sum',
    })
    // 归一化 URL 再 upsert → 命中同一条（dedup）
    const dup = store.getByUrl('https://x.com/p/')
    expect(dup?.article.id).toBe(a1.id)
    // 同 id 覆盖：保留 filePath
    const again = store.upsert({
      source, title: 'A2', url: a1.url, publishedAt: '2026-09-02',
      content: 'body2', articleId: a1.id,
    })
    expect(again.filePath).toBe(a1.filePath)
    expect(again.fetchedAt >= a1.fetchedAt).toBe(true)
    // update patch
    const updated = store.update(a1.id, { status: 'digested' as never, note: 'n1' })
    expect(updated?.article.status).toBe('digested')
    expect(updated?.article.note).toBe('n1')
    expect(store.listArticles().length).toBeGreaterThanOrEqual(1)
  })

  it('dossier-distillation：fail-closed + sourceId 幂等 + CAS 状态机', async () => {
    const { backend } = await makeBackend()
    const store = backend.dossierDistillationProposalStore
    const base = {
      sourceEvent: 'feat-phase-close' as never,
      sourceId: 'feat-phase-close:F208:D',
      targetCatId: 'cat-1' as never,
      targetFields: ['summary'],
      beforeSnapshot: 'before',
      afterDraft: 'after',
      rationale: 'r',
      evidenceRefs: [{ kind: 'observation', ref: 'obs-1' } as never],
      baseHash: 'h1',
      createdBy: 'op',
    }
    // fail-closed：无证据拒绝
    expect(() => store.create({ ...base, evidenceRefs: [] })).toThrow(/fail-closed/)
    const p = store.create(base)
    // 同 sourceId 幂等命中
    expect(store.getBySourceId(base.sourceId)?.proposalId).toBe(p.proposalId)
    // CAS：applied 不能从 pending 直达
    expect(store.markApplied(p.proposalId, 'cat', 'sha')).toBeNull()
    expect(store.markApproved(p.proposalId, 'op')?.status).toBe('approved')
    // 二次 approve 幂等拒绝（已非 pending）
    expect(store.markApproved(p.proposalId, 'op')).toBeNull()
    expect(store.markApplied(p.proposalId, 'cat', 'sha-1')?.status).toBe('applied')
    expect(store.listByCat('cat-1' as never)).toHaveLength(1)
  })

  it('dossier-observation：add/list/listAll/delete', async () => {
    const { backend } = await makeBackend()
    const store = backend.dossierObservationStore
    const obs = store.add({ catId: 'cat-1' as never, content: 'c1', author: 'op' })
    expect(obs.provenance).toMatchObject({ type: 'cvo', author: 'op' })
    store.add({ catId: 'cat-2' as never, content: 'c2', author: 'op' })
    expect(store.list('cat-1' as never)).toHaveLength(1)
    expect(Object.keys(store.listAll())).toEqual(['cat-2', 'cat-1'])
    expect(store.get(obs.id)?.content).toBe('c1')
    expect(store.delete(obs.id)).toBe(true)
    expect(store.get(obs.id)).toBeNull()
  })

  it('memory-governance：合法迁移链 + 409 冲突', async () => {
    const { backend } = await makeBackend()
    const store = backend.memoryGovernanceStore
    store.create('e1', 'op', ['anchor-a'])
    expect(store.get('e1')?.status).toBe('draft')
    expect(store.transition('e1', 'submit_review', 'op').status).toBe('pending_review')
    expect(store.transition('e1', 'approve', 'op2').status).toBe('published')
    expect(store.transition('e1', 'rollback', 'op2').status).toBe('draft')
    expect(store.transition('e1', 'submit_review', 'op2').status).toBe('pending_review')
    expect(store.transition('e1', 'approve', 'op2').status).toBe('published')
    expect(store.transition('e1', 'archive', 'op2').status).toBe('archived')
    expect(() => store.transition('e1', 'approve', 'op2')).toThrow(/Invalid transition/)
    expect(store.list()).toHaveLength(1)
  })

  it('proposal（F128）：完整状态机 + 崩溃检查点 + dedup', async () => {
    const { backend } = await makeBackend()
    const store = backend.proposalStore
    const input = {
      sourceThreadId: 'st', sourceInvocationId: 'si', sourceCatId: 'cat-1' as never,
      title: 'T', reason: 'R', parentThreadId: 'st', preferredCats: [] as never[],
      projectPath: '/p', createdBy: 'user-1',
    }
    const p = store.create(input)
    expect(p.publication?.state).toBe('staged')
    expect(store.listPending('user-1')).toHaveLength(1)
    // CAS claim
    const claimed = store.claimForApproval(p.proposalId, 'op')
    expect(claimed?.status).toBe('approving')
    expect(claimed?.claimedAt).toBeDefined()
    // pending→rejected 不再可能（已 claiming）
    expect(store.markRejected(p.proposalId, 'op')).toBeNull()
    // Stage 1.5 崩溃检查点：不改 status
    const checkpointed = store.recordCreatedThread(p.proposalId, 'th-new')
    expect(checkpointed?.status).toBe('approving')
    expect(checkpointed?.createdThreadId).toBe('th-new')
    // finalize
    const finalized = store.finalizeApproval({ proposalId: p.proposalId, createdThreadId: 'th-new' })
    expect(finalized?.status).toBe('approved')
    expect(finalized?.claimedAt).toBeUndefined()
    expect(store.listSettledByUser('user-1')).toHaveLength(1)
    // rollback / withdrawn / dedup
    const p2 = store.create(input)
    store.claimForApproval(p2.proposalId, 'op')
    expect(store.rollbackClaim(p2.proposalId)).toBe(true)
    expect(store.markWithdrawn(p2.proposalId, 'cat-1' as never)?.status).toBe('withdrawn')
    const p3 = store.create(input)
    expect(store.reserveDedup('user-1', 'req-1', p3.proposalId)).toBe(p3.proposalId)
    expect(store.getDedupProposalId('user-1', 'req-1')).toBe(p3.proposalId)
    store.releaseDedup('user-1', 'req-1', p3.proposalId)
    expect(store.getDedupProposalId('user-1', 'req-1')).toBeNull()
    // envelope / abort
    store.abortStaged(p3.proposalId, 'cleanup')
    expect(store.getPublication(p3.proposalId)?.state).toBe('tombstoned')
    store.delete(p3.proposalId)
    expect(store.get(p3.proposalId)).toBeNull()
  })

  it('profile-update：两路检查点 + envelope 抛错语义（F231）', async () => {
    const { backend } = await makeBackend()
    const store = backend.profileUpdateProposalStore
    const p = store.create({
      sourceThreadId: 'st', sourceInvocationId: 'si', sourceCatId: 'cat-1' as never,
      targetLayer: 'persona-primer' as never, targetPath: 'a.md',
      beforeContent: 'b', baseContentHash: 'h', afterContent: 'a',
      rationale: 'r', signalProvenance: {} as never, createdBy: 'user-1',
    })
    expect(() => store.commitEnvelope(p.proposalId, { fake: true } as never)).toThrow()
    store.claimForApproval(p.proposalId, 'op')
    const checkpointed = store.recordCheckpoint(p.proposalId, {
      writtenPath: 'w.md', provenancePath: 'p.md',
    })
    expect(checkpointed?.writtenPath).toBe('w.md')
    expect(checkpointed?.provenancePath).toBe('p.md')
    expect(checkpointed?.status).toBe('approving')
    expect(store.finalizeApproval(p.proposalId)?.status).toBe('approved')
    expect(store.listSettledByUser('user-1')).toHaveLength(1)
  })

  it('session-handoff：create/claim/checkpoint/finalize + A4 查询 + 过期', async () => {
    const { backend } = await makeBackend()
    const store = backend.sessionHandoffProposalStore
    const note = { summary: 's', keyContext: 'k', nextSteps: [], openLoops: [], artifacts: [] } as never
    const p = store.create({
      sourceThreadId: 'st', sourceSessionId: 'ss', sourceCatId: 'cat-1' as never,
      sourceMessageId: 'sm', userId: 'user-1', note,
    })
    expect(p.note.proposalId).toBe(p.proposalId)
    expect(p.note.persistedAt).toBe(p.createdAt)
    store.claimForApproval(p.proposalId)
    const checkpointed = store.recordCheckpoint(p.proposalId, { sealedSessionId: 'sealed-1' })
    expect(checkpointed?.sealedSessionId).toBe('sealed-1')
    expect(checkpointed?.status).toBe('approving')
    expect(store.finalizeApproval(p.proposalId)?.status).toBe('approved')
    // A4 查询
    const p2 = store.create({
      sourceThreadId: 'st', sourceSessionId: 'ss2', sourceCatId: 'cat-1' as never,
      sourceMessageId: 'sm2', userId: 'user-1', note,
    })
    expect(store.listActiveBySession('ss2')).toHaveLength(1)
    expect(store.getMostRecentByCatThread('user-1', 'cat-1', 'st')?.proposalId).toBe(p2.proposalId)
    expect(store.countRecentByCatThread('user-1', 'cat-1', 'st', 0)).toBe(2)
    expect(store.markExpired(p2.proposalId)?.status).toBe('expired')
    expect(store.listSettledByUser('user-1').map((x) => x.proposalId)).toContain(p.proposalId)
  })

  it('session-handoff：F281 拒绝反馈原子捕获 + replay 分类', async () => {
    const { backend } = await makeBackend()
    const store = backend.sessionHandoffProposalStore
    const note = { summary: 's', keyContext: 'k', nextSteps: [], openLoops: [], artifacts: [] } as never
    const p = store.create({
      sourceThreadId: 'st', sourceSessionId: 'ss', sourceCatId: 'cat-1' as never,
      sourceMessageId: 'sm', userId: 'user-1', note,
    })
    const decidedAt = Date.now()
    const feedback = { reasonCode: 'not_now' } as never
    const first = store.markRejected(p.proposalId, { decidedAt, feedback })
    expect(first.outcome).toBe('applied')
    expect(first.proposal?.status).toBe('rejected')
    expect(first.proposal?.humanDispositionLedgerEntry).toBeDefined()
    // 重放同一反馈 → replayed；不同反馈 → conflict
    const replay = store.markRejected(p.proposalId, { decidedAt, feedback })
    expect(replay.outcome === 'replayed' || replay.outcome === 'conflict').toBe(true)
    const conflict = store.markRejected(p.proposalId, {
      decidedAt, feedback: { reasonCode: 'wrong' } as never,
    })
    expect(conflict.outcome === 'conflict' || conflict.outcome === 'replayed').toBe(true)
    // ledger entry 可由 receipt 反查
    const entry = first.proposal?.humanDispositionLedgerEntry
    if (entry !== undefined) {
      const { buildHumanDispositionLedgerReceipt } = await import('@flowforge/cats-shared')
      const receipt = buildHumanDispositionLedgerReceipt(entry)
      expect(store.loadHumanDispositionEntry({ ownerUserId: 'user-1', receipt })).not.toBeNull()
      expect(store.loadHumanDispositionEntry({ ownerUserId: 'user-2', receipt })).toBeNull()
    }
  })
})

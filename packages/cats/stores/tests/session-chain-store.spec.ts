/**
 * MemorySessionChainStore port contract — verifies in-memory
 * ISessionChainStore semantics（移植自 clowder-ai 批次 6.2a，语义全量保留）：
 * - create seq 自增 + activeIndex 维护 + reuseExistingCliSession 复用
 * - getActive 仅返回 active 状态的记录
 * - getChain 按 seq 排序 / getChainByThread 按 catId+seq 排序（含 abort）
 * - update 状态机（active → sealing → sealed）+ activeIndex 清理
 * - getByCliSessionId / getByChainKey（sealed 记录仍可达，F198 写容忍）
 * - incrementCompressionCount 仅 active 生效
 * - listSealingSessions（F118 全局 reaper）
 * - sealReason / sealedAt 的 null 删除语义
 * - 容量驱逐（MAX_RECORDS=1000 三级驱逐 + 真 active 拒绝驱逐回滚抛错）
 * - CatStores 聚合 sessionChains() 访问器路由
 *
 * @module @flowforge/cats-stores/tests
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createUserId } from '@flowforge/cats-shared'
import type { CreateSessionInput } from '../src/ports/session-chain-store.ts'
import type { MemorySessionChainStore } from '../src/memory/session-chain-store.ts'
import { CatStores, MemoryStoresBackend } from '../src/index.ts'

const CAT_OPUS = createCatId('opus')
const CAT_NEO = createCatId('neo')
const USER_ALICE = createUserId('alice')

/**
 * Track plugin fibers so each test tears down cleanly. Cordis disposal is via
 * Fiber.dispose() (returned by ctx.plugin), NOT ctx.dispose — Context has no
 * dispose method; services/effects clean up when their owning fiber is torn
 * down.
 */
const fibers: Array<{ dispose: () => Promise<void> | void }> = []
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!
    await fiber.dispose()
  }
})

/**
 * Cordis Context harness：挂载 CatStores 聚合 + MemoryStoresBackend，返回
 * 具体 MemorySessionChainStore（同步语义，断言无需 await）。
 */
async function withSessionChainStore(): Promise<MemorySessionChainStore> {
  const ctx = new Context()
  fibers.push(await ctx.plugin(CatStores) as unknown as { dispose: () => Promise<void> | void })
  fibers.push(await ctx.plugin(MemoryStoresBackend) as unknown as { dispose: () => Promise<void> | void })
  return ctx.catStoresMemory.sessionChainStore
}

function createInput(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  return {
    cliSessionId: `cli_${Math.random().toString(36).slice(2)}`,
    threadId: 't1',
    catId: CAT_OPUS,
    userId: USER_ALICE,
    ...overrides,
  } as CreateSessionInput
}

describe('MemorySessionChainStore — create + seq + activeIndex', () => {
  it('creates sessions with auto-incrementing seq and status=active', async () => {
    const store = await withSessionChainStore()
    const s1 = store.create(createInput())
    expect(s1.seq).toBe(0)
    expect(s1.status).toBe('active')
    expect(s1.messageCount).toBe(0)
    expect(s1.id).toMatch(/^[0-9a-f-]{36}$/) // randomUUID 主键
    expect(s1.createdAt).toBe(s1.updatedAt)

    const s2 = store.create(createInput())
    expect(s2.seq).toBe(1)

    // activeIndex 指向最新记录
    expect(store.getActive(CAT_OPUS, 't1')?.id).toBe(s2.id)
    expect(store.get(s1.id)?.id).toBe(s1.id)
    expect(store.get('missing')).toBeNull()
  })

  it('omits optional fields via conditional spread (no undefined keys)', async () => {
    const store = await withSessionChainStore()
    const bare = store.create(createInput())
    expect('workingDirectory' in bare).toBe(false)
    expect('workspaceFingerprint' in bare).toBe(false)
    expect('chainKey' in bare).toBe(false)

    const full = store.create(
      createInput({ workingDirectory: '/w', workspaceFingerprint: 'fp', chainKey: 'bg:t1:opus' }),
    )
    expect(full.workingDirectory).toBe('/w')
    expect(full.workspaceFingerprint).toBe('fp')
    expect(full.chainKey).toBe('bg:t1:opus')
  })

  it('reuseExistingCliSession returns the existing record for the same cliSessionId', async () => {
    const store = await withSessionChainStore()
    const s1 = store.create(createInput({ cliSessionId: 'cli-reuse' }))
    const s2 = store.create(createInput({ cliSessionId: 'cli-reuse', reuseExistingCliSession: true }))
    expect(s2.id).toBe(s1.id)

    // 不带 flag 时创建新记录并覆盖 cliIndex
    const s3 = store.create(createInput({ cliSessionId: 'cli-reuse' }))
    expect(s3.id).not.toBe(s1.id)
    expect(store.getByCliSessionId('cli-reuse')?.id).toBe(s3.id)
  })
})

describe('MemorySessionChainStore — getActive / getChain / getChainByThread', () => {
  it('getActive returns null once the session leaves active status', async () => {
    const store = await withSessionChainStore()
    const s = store.create(createInput())
    expect(store.getActive(CAT_OPUS, 't1')?.id).toBe(s.id)
    expect(store.getActive(CAT_OPUS, 'other-thread')).toBeNull()
    expect(store.getActive(CAT_NEO, 't1')).toBeNull()

    store.update(s.id, { status: 'sealing' })
    expect(store.getActive(CAT_OPUS, 't1')).toBeNull()

    // 新 active 接管索引
    const s2 = store.create(createInput())
    expect(store.getActive(CAT_OPUS, 't1')?.id).toBe(s2.id)
  })

  it('getChain returns the full chain sorted by seq', async () => {
    const store = await withSessionChainStore()
    const s1 = store.create(createInput())
    const s2 = store.create(createInput())
    const s3 = store.create(createInput())
    const chain = store.getChain(CAT_OPUS, 't1')
    expect(chain.map((r) => r.seq)).toEqual([0, 1, 2])
    expect(chain.map((r) => r.id)).toEqual([s1.id, s2.id, s3.id])
    expect(store.getChain(CAT_NEO, 't1')).toEqual([])
  })

  it('getChainByThread sorts by catId then seq and honors abort signals', async () => {
    const store = await withSessionChainStore()
    const neo = store.create(createInput({ catId: CAT_NEO }))
    const opus1 = store.create(createInput({ catId: CAT_OPUS }))
    const opus2 = store.create(createInput({ catId: CAT_OPUS }))
    store.create(createInput({ threadId: 't-other' }))

    const chain = store.getChainByThread('t1')
    expect(chain.map((r) => r.id)).toEqual([neo.id, opus1.id, opus2.id]) // 'neo' < 'opus'

    const controller = new AbortController()
    controller.abort()
    expect(() => store.getChainByThread('t1', { signal: controller.signal })).toThrow()
  })
})

describe('MemorySessionChainStore — update state machine', () => {
  it('walks active → sealing → sealed and cleans up the active index', async () => {
    const store = await withSessionChainStore()
    const s = store.create(createInput())
    expect(store.update('missing', { status: 'sealing' })).toBeNull()

    // active → sealing：activeIndex 清理 + F118 reaper 可见
    const sealing = store.update(s.id, { status: 'sealing' })
    expect(sealing?.status).toBe('sealing')
    expect(store.getActive(CAT_OPUS, 't1')).toBeNull()
    expect(store.listSealingSessions()).toEqual([s.id])

    // sealing → sealed
    const sealed = store.update(s.id, { status: 'sealed', sealReason: 'threshold', sealedAt: 42 })
    expect(sealed?.status).toBe('sealed')
    expect(sealed?.sealReason).toBe('threshold')
    expect(sealed?.sealedAt).toBe(42)
    expect(store.listSealingSessions()).toEqual([])
    expect(store.getActive(CAT_OPUS, 't1')).toBeNull()

    // sealed → active：patch.status === 'active' 时重建 activeIndex（源码语义）
    store.update(s.id, { status: 'active' })
    expect(store.getActive(CAT_OPUS, 't1')?.id).toBe(s.id)
  })

  it('applies field patches, updatedAt fallback, and re-indexes cliSessionId', async () => {
    const store = await withSessionChainStore()
    const s = store.create(createInput({ cliSessionId: 'cli-old' }))

    store.update(s.id, { messageCount: 7, updatedAt: 999 })
    const after = store.get(s.id)
    expect(after?.messageCount).toBe(7)
    expect(after?.updatedAt).toBe(999)

    store.update(s.id, { cliSessionId: 'cli-new' }) // updatedAt 缺省 → Date.now()
    expect(store.getByCliSessionId('cli-old')).toBeNull()
    expect(store.getByCliSessionId('cli-new')?.id).toBe(s.id)
  })

  it('sealReason/sealedAt null patches delete the fields', async () => {
    const store = await withSessionChainStore()
    const s = store.create(createInput())
    store.update(s.id, { sealReason: 'manual', sealedAt: 100 })
    expect(store.get(s.id)?.sealReason).toBe('manual')
    expect(store.get(s.id)?.sealedAt).toBe(100)

    store.update(s.id, { sealReason: null, sealedAt: null })
    const after = store.get(s.id)
    expect(after?.sealReason).toBeUndefined()
    expect('sealReason' in (after ?? {})).toBe(false)
    expect(after?.sealedAt).toBeUndefined()
    expect('sealedAt' in (after ?? {})).toBe(false)
  })
})

describe('MemorySessionChainStore — lookups + compression + reaper', () => {
  it('getByChainKey keeps sealed records reachable (F198 write tolerance)', async () => {
    const store = await withSessionChainStore()
    const s = store.create(createInput({ chainKey: 'bg:t1:opus' }))
    expect(store.getByChainKey('bg:t1:opus')?.id).toBe(s.id)
    expect(store.getByChainKey('missing')).toBeNull()

    store.update(s.id, { status: 'sealed', sealReason: 'manual' })
    // sealed 后仍可达（不同于 getActive）——并发 done 写入的写容忍语义
    expect(store.getByChainKey('bg:t1:opus')?.id).toBe(s.id)
    expect(store.getByCliSessionId(s.cliSessionId)?.id).toBe(s.id)
  })

  it('incrementCompressionCount only applies to active sessions', async () => {
    const store = await withSessionChainStore()
    const s = store.create(createInput())
    expect(store.incrementCompressionCount(s.id)).toBe(1)
    expect(store.incrementCompressionCount(s.id)).toBe(2)
    expect(store.get(s.id)?.compressionCount).toBe(2)

    store.update(s.id, { status: 'sealing' })
    expect(store.incrementCompressionCount(s.id)).toBeNull()
    expect(store.incrementCompressionCount('missing')).toBeNull()
  })

  it('listSealingSessions returns ids of all sealing sessions across cats', async () => {
    const store = await withSessionChainStore()
    const a = store.create(createInput({ catId: CAT_OPUS }))
    const b = store.create(createInput({ catId: CAT_NEO, threadId: 't2' }))
    const c = store.create(createInput({ catId: CAT_NEO, threadId: 't3' }))

    store.update(a.id, { status: 'sealing' })
    store.update(b.id, { status: 'sealing' })
    expect(store.listSealingSessions().sort()).toEqual([a.id, b.id].sort())

    store.update(b.id, { status: 'sealed' })
    expect(store.listSealingSessions()).toEqual([a.id])
    expect(store.get(c.id)?.status).toBe('active')
  })
})

describe('MemorySessionChainStore — capacity eviction (MAX_RECORDS=1000)', () => {
  it('evicts sealed records first when over capacity', async () => {
    const store = await withSessionChainStore()
    // 1 条 sealed 种子 + 999 条互异 thread 的真 active = 1000 条
    const sealed = store.create(createInput({ cliSessionId: 'cli-seed', threadId: 't-seed' }))
    store.update(sealed.id, { status: 'sealed', sealReason: 'manual', sealedAt: 1 })
    for (let i = 0; i < 999; i++) {
      store.create(createInput({ cliSessionId: `cli-${i}`, threadId: `t-${i}` }))
    }
    expect(store.size).toBe(1000)

    // 第 1001 条触发驱逐：第一优先级是 sealed 记录
    const extra = store.create(createInput({ cliSessionId: 'cli-extra', threadId: 't-extra' }))
    expect(store.size).toBe(1000)
    expect(store.get(sealed.id)).toBeNull()
    expect(store.get(extra.id)?.id).toBe(extra.id)
  })

  it('evicts superseded (non-indexed) active records in a long chain', async () => {
    const store = await withSessionChainStore()
    const first = store.create(createInput({ cliSessionId: 'cli-0' }))
    for (let i = 1; i < 1001; i++) {
      store.create(createInput({ cliSessionId: `cli-${i}` }))
    }
    // 同一 (cat, thread) 内旧 active 已被最新记录取代（superseded）→ 第三优先级驱逐
    expect(store.size).toBe(1000)
    expect(store.get(first.id)).toBeNull()
    expect(store.getActive(CAT_OPUS, 't1')?.cliSessionId).toBe('cli-1000')
  })

  it('refuses to evict truly active sessions: rolls back and throws', async () => {
    const store = await withSessionChainStore()
    // 1000 条互异 thread → 每条都在 activeIndex 中（真 active）
    for (let i = 0; i < 1000; i++) {
      store.create(createInput({ cliSessionId: `cli-${i}`, threadId: `t-${i}` }))
    }
    expect(store.size).toBe(1000)

    expect(() => store.create(createInput({ cliSessionId: 'cli-overflow', threadId: 't-overflow' })))
      .toThrow(/at capacity/)
    // 回滚：刚创建的记录（含全部索引）被移除
    expect(store.size).toBe(1000)
    expect(store.getByCliSessionId('cli-overflow')).toBeNull()
  })
})

describe('CatStores.sessionChains() — aggregate wiring', () => {
  it('routes through the active memory backend', async () => {
    const ctx = new Context()
    fibers.push(await ctx.plugin(CatStores) as unknown as { dispose: () => Promise<void> | void })
    fibers.push(await ctx.plugin(MemoryStoresBackend) as unknown as { dispose: () => Promise<void> | void })
    expect(ctx.catStores.sessionChains()).toBe(ctx.catStoresMemory.sessionChainStore)
  })

  it('throws when the active backend did not register a session chain store', async () => {
    const ctx = new Context()
    fibers.push(await ctx.plugin(CatStores) as unknown as { dispose: () => Promise<void> | void })
    fibers.push(await ctx.plugin(MemoryStoresBackend) as unknown as { dispose: () => Promise<void> | void })
    // 最小 fake backend（缺 sessionChainStore）注册后成为 active
    ctx.catStores.registerBackend('fake', {
      messageStore: {} as never,
      threadStore: {} as never,
      taskStore: {} as never,
      backlogStore: {} as never,
      memoryStore: {} as never,
    })
    expect(() => ctx.catStores.sessionChains()).toThrow(/did not register an ISessionChainStore/)
  })
})

/**
 * ChatMemoryService — T5.7.2 thread KV 记忆服务契约验证（阶段5 批次7）。
 *
 * 覆盖（对齐 clowder-ai `routes/memory.ts` 语义）：
 * - 守卫：无 identity 401 / thread 不存在 404 / userId 不匹配 403 /
 *   'default' thread 直接放行
 * - writeMemory（覆盖写）/ readMemory（单 key + 全列 + 404）/
 *   deleteMemory（204 语义 + 404）
 * - 容量淘汰：store 契约（MAX_KEYS_PER_THREAD 淘汰最旧 key）
 *
 * @module @flowforge/chat-misc/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createUserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { MAX_KEYS_PER_THREAD } from '@flowforge/cats-stores/ports'
import { ChatMemoryErrorCode, ChatMemoryService } from '../src/index.ts'

const ALICE = createUserId('alice')
const BOB = createUserId('bob')

interface Harness {
  ctx: Context
  memory: ChatMemoryService
  backend: MemoryStoresBackend
}

function harness(): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const memory = new ChatMemoryService(ctx)
  return { ctx, memory, backend }
}

function seedThread(h: Harness, owner: string): string {
  return h.backend.threadStore.create({ userId: owner, title: '对话' }).id
}

describe('ChatMemoryService — authorization guards', () => {
  it('401 when identity is missing', async () => {
    const h = harness()
    await expect(
      h.memory.writeMemory({ threadId: 'default', key: 'k', value: 'v', updatedBy: 'user' }, ''),
    ).rejects.toMatchObject({ code: ChatMemoryErrorCode.IDENTITY_REQUIRED, status: 401 })
    await expect(h.memory.readMemory('default', '')).rejects.toMatchObject({
      code: ChatMemoryErrorCode.IDENTITY_REQUIRED,
      status: 401,
    })
  })

  it('404 when the thread does not exist', async () => {
    const h = harness()
    await expect(
      h.memory.writeMemory({ threadId: 'missing', key: 'k', value: 'v', updatedBy: 'user' }, ALICE),
    ).rejects.toMatchObject({ code: ChatMemoryErrorCode.THREAD_NOT_FOUND, status: 404 })
  })

  it('403 when the caller is not the thread owner', async () => {
    const h = harness()
    const threadId = seedThread(h, ALICE)
    await expect(
      h.memory.writeMemory({ threadId, key: 'k', value: 'v', updatedBy: 'user' }, BOB),
    ).rejects.toMatchObject({ code: ChatMemoryErrorCode.FORBIDDEN, status: 403 })
  })

  it('allows the "default" thread without a thread record', async () => {
    const h = harness()
    const entry = await h.memory.writeMemory(
      { threadId: 'default', key: 'k', value: 'v', updatedBy: 'user' },
      ALICE,
    )
    expect(entry.key).toBe('k')
    expect(entry.value).toBe('v')
  })
})

describe('ChatMemoryService — write/read/delete', () => {
  it('writes and overwrites a key', async () => {
    const h = harness()
    const threadId = seedThread(h, ALICE)
    const first = await h.memory.writeMemory(
      { threadId, key: 'pref', value: 'dark', updatedBy: 'user' },
      ALICE,
    )
    expect(first.updatedAt).toBeGreaterThan(0)

    const second = await h.memory.writeMemory(
      { threadId, key: 'pref', value: 'light', updatedBy: 'user' },
      ALICE,
    )
    expect(second.value).toBe('light')
  })

  it('reads a single key and lists all entries', async () => {
    const h = harness()
    const threadId = seedThread(h, ALICE)
    await h.memory.writeMemory({ threadId, key: 'a', value: '1', updatedBy: 'user' }, ALICE)
    await h.memory.writeMemory({ threadId, key: 'b', value: '2', updatedBy: 'user' }, ALICE)

    const single = await h.memory.readMemory(threadId, ALICE, 'a')
    expect(single).toMatchObject({ key: 'a', value: '1' })

    const all = await h.memory.readMemory(threadId, ALICE)
    expect('entries' in all).toBe(true)
    if ('entries' in all) expect(all.entries).toHaveLength(2)
  })

  it('404 when reading or deleting a missing key', async () => {
    const h = harness()
    const threadId = seedThread(h, ALICE)
    await expect(h.memory.readMemory(threadId, ALICE, 'nope')).rejects.toMatchObject({
      code: ChatMemoryErrorCode.ENTRY_NOT_FOUND,
      status: 404,
    })
    await expect(h.memory.deleteMemory(threadId, 'nope', ALICE)).rejects.toMatchObject({
      code: ChatMemoryErrorCode.ENTRY_NOT_FOUND,
      status: 404,
    })
  })

  it('deletes a key and returns void on success', async () => {
    const h = harness()
    const threadId = seedThread(h, ALICE)
    await h.memory.writeMemory({ threadId, key: 'a', value: '1', updatedBy: 'user' }, ALICE)
    await expect(h.memory.deleteMemory(threadId, 'a', ALICE)).resolves.toBeUndefined()
    const all = await h.memory.readMemory(threadId, ALICE)
    expect('entries' in all && all.entries).toHaveLength(0)
  })
})

describe('ChatMemoryService — capacity eviction (store contract)', () => {
  it('evicts the oldest key once MAX_KEYS_PER_THREAD is exceeded', () => {
    const h = harness()
    const threadId = 'cap-thread'
    for (let i = 0; i < MAX_KEYS_PER_THREAD; i += 1) {
      h.backend.threadMemoryStore.set({
        threadId,
        key: `k${i}`,
        value: `v${i}`,
        updatedBy: 'user',
      })
    }
    // 最旧 key 是 k0；写入新 key 触发淘汰
    h.backend.threadMemoryStore.set({ threadId, key: 'newest', value: 'v', updatedBy: 'user' })
    const keys = h.backend.threadMemoryStore.list(threadId).map((e) => e.key)
    expect(keys).toHaveLength(MAX_KEYS_PER_THREAD)
    expect(keys).not.toContain('k0')
    expect(keys).toContain('newest')
  })
})

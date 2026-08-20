/**
 * MessageActionService — delete / restore / block-state contract tests（阶段5 批次2）：
 * - soft delete：作者/线程创建者可删，他人 UNAUTHORIZED；onDeleted 钩子
 * - hard delete：confirmTitle 必填/匹配线程标题/无标题线程用固定短语；tombstone 结果
 * - restore：删除者可恢复；未被删/已硬删 MESSAGE_NOT_RESTORABLE；他人 UNAUTHORIZED
 * - F096 block-state：interactive 块合并持久化；非 interactive/缺块/无 rich 报错；
 *   非作者非创建者 UNAUTHORIZED
 *
 * @module @flowforge/chat-messages/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import type { StoredMessage } from '@flowforge/cats-stores'
import { MessageActionService, MessageErrorCode } from '../src/index.ts'
import type { MessageActionServiceOptions } from '../src/index.ts'

const USER_ALICE = 'alice' as UserId
const USER_BOB = 'bob' as UserId

interface Harness {
  ctx: Context
  actions: MessageActionService
  backend: MemoryStoresBackend
}

function harness(options: MessageActionServiceOptions = {}): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const actions = new MessageActionService(ctx, options)
  return { ctx, actions, backend }
}

async function createThread(h: Harness, title = 'titled thread'): Promise<string> {
  const thread = await h.ctx.catStores.threads().create({ userId: USER_ALICE, title })
  return thread.id
}

function appendUser(h: Harness, threadId: string, content = 'hello'): StoredMessage {
  return h.backend.messageStore.append({
    userId: USER_ALICE,
    catId: null,
    content,
    mentions: [],
    timestamp: Date.now(),
    threadId,
  })
}

describe('MessageActionService — soft delete', () => {
  it('author soft-deletes and fires the onDeleted hook', async () => {
    const onDeleted = vi.fn()
    const h = harness({ onDeleted })
    const threadId = await createThread(h)
    const msg = appendUser(h, threadId)

    const result = await h.actions.delete(msg.id, { userId: USER_ALICE })

    expect(result).toMatchObject({ id: msg.id, threadId, deletedBy: USER_ALICE })
    expect(result._tombstone).toBeUndefined()
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: msg.id }), USER_ALICE, 'soft')
  })

  it('thread creator may delete another author’s message', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const foreign = h.backend.messageStore.append({
      userId: USER_BOB,
      catId: null,
      content: 'bob says',
      mentions: [],
      timestamp: Date.now(),
      threadId,
    })

    const result = await h.actions.delete(foreign.id, { userId: USER_ALICE })
    expect(result.id).toBe(foreign.id)
  })

  it('a non-author non-creator gets UNAUTHORIZED', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const msg = appendUser(h, threadId)

    await expect(h.actions.delete(msg.id, { userId: USER_BOB })).rejects.toMatchObject({
      code: MessageErrorCode.UNAUTHORIZED,
    })
  })

  it('missing message → MESSAGE_NOT_FOUND', async () => {
    const h = harness()
    await expect(h.actions.delete('ghost', { userId: USER_ALICE })).rejects.toMatchObject({
      code: MessageErrorCode.MESSAGE_NOT_FOUND,
    })
  })
})

describe('MessageActionService — hard delete', () => {
  it('requires confirmTitle', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const msg = appendUser(h, threadId)

    await expect(
      h.actions.delete(msg.id, { userId: USER_ALICE, mode: 'hard' }),
    ).rejects.toMatchObject({ code: MessageErrorCode.CONFIRM_TITLE_REQUIRED })
  })

  it('rejects a mismatched confirmTitle', async () => {
    const h = harness()
    const threadId = await createThread(h, 'real title')
    const msg = appendUser(h, threadId)

    await expect(
      h.actions.delete(msg.id, { userId: USER_ALICE, mode: 'hard', confirmTitle: 'wrong' }),
    ).rejects.toMatchObject({ code: MessageErrorCode.CONFIRM_TITLE_MISMATCH })
  })

  it('matching title produces a tombstone', async () => {
    const onDeleted = vi.fn()
    const h = harness({ onDeleted })
    const threadId = await createThread(h, 'real title')
    const msg = appendUser(h, threadId)

    const result = await h.actions.delete(msg.id, {
      userId: USER_ALICE,
      mode: 'hard',
      confirmTitle: 'real title',
    })

    expect(result._tombstone).toBe(true)
    expect(onDeleted).toHaveBeenCalledWith(expect.objectContaining({ id: msg.id }), USER_ALICE, 'hard')
  })

  it('untitled threads confirm with the fixed phrase', async () => {
    const h = harness()
    const threadId = await createThread(h, '')
    const msg = appendUser(h, threadId)

    const result = await h.actions.delete(msg.id, {
      userId: USER_ALICE,
      mode: 'hard',
      confirmTitle: '确认删除',
    })
    expect(result._tombstone).toBe(true)
  })
})

describe('MessageActionService — restore', () => {
  it('the deleter restores a soft-deleted message', async () => {
    const onRestored = vi.fn()
    const h = harness({ onRestored })
    const threadId = await createThread(h)
    const msg = appendUser(h, threadId)
    await h.actions.delete(msg.id, { userId: USER_ALICE })

    const result = await h.actions.restore(msg.id, { userId: USER_ALICE })

    expect(result).toMatchObject({ id: msg.id, threadId, content: 'hello' })
    expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ id: msg.id }))
  })

  it('restore rejects messages that were never deleted', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const msg = appendUser(h, threadId)

    await expect(h.actions.restore(msg.id, { userId: USER_ALICE })).rejects.toMatchObject({
      code: MessageErrorCode.MESSAGE_NOT_RESTORABLE,
    })
  })

  it('restore rejects hard-deleted tombstones', async () => {
    const h = harness()
    const threadId = await createThread(h, 'real title')
    const msg = appendUser(h, threadId)
    await h.actions.delete(msg.id, {
      userId: USER_ALICE,
      mode: 'hard',
      confirmTitle: 'real title',
    })

    await expect(h.actions.restore(msg.id, { userId: USER_ALICE })).rejects.toMatchObject({
      code: MessageErrorCode.MESSAGE_NOT_RESTORABLE,
    })
  })

  it('only the deleter or the thread creator may restore', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const msg = appendUser(h, threadId)
    await h.actions.delete(msg.id, { userId: USER_ALICE })

    await expect(h.actions.restore(msg.id, { userId: USER_BOB })).rejects.toMatchObject({
      code: MessageErrorCode.UNAUTHORIZED,
    })

    // Thread creator (alice deleted herself here) — use a foreign deleter to
    // exercise the creator branch: bob-authored message, alice deletes (creator),
    // alice restores.
    const foreign = h.backend.messageStore.append({
      userId: USER_BOB,
      catId: null,
      content: 'bob again',
      mentions: [],
      timestamp: Date.now(),
      threadId,
    })
    await h.actions.delete(foreign.id, { userId: USER_ALICE })
    const restored = await h.actions.restore(foreign.id, { userId: USER_ALICE })
    expect(restored.id).toBe(foreign.id)
  })
})

describe('MessageActionService — F096 block-state', () => {
  function appendRichMessage(h: Harness, threadId: string): StoredMessage {
    return h.backend.messageStore.append({
      userId: USER_ALICE,
      catId: null,
      content: 'pick one',
      mentions: [],
      timestamp: Date.now(),
      threadId,
      metadata: {
        rich: {
          blocks: [
            { id: 'b-static', kind: 'markdown', text: 'read-only' },
            { id: 'b-choice', kind: 'interactive', component: 'choice', selectedIds: ['a'] },
          ],
        },
      },
    })
  }

  it('merges disabled/selectedIds into an interactive block and persists', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const msg = appendRichMessage(h, threadId)

    await h.actions.patchBlockState(msg.id, {
      userId: USER_ALICE,
      blockId: 'b-choice',
      disabled: true,
      selectedIds: ['b', 'c'],
    })

    const updated = await h.ctx.catStores.messages().getById(msg.id)
    const blocks = (updated?.metadata?.rich as { blocks: Array<Record<string, unknown>> }).blocks
    const choice = blocks.find((b) => b['id'] === 'b-choice')!
    expect(choice['disabled']).toBe(true)
    expect(choice['selectedIds']).toEqual(['b', 'c'])
    // Sibling block untouched.
    expect(blocks.find((b) => b['id'] === 'b-static')!['kind']).toBe('markdown')
  })

  it('rejects non-interactive blocks', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const msg = appendRichMessage(h, threadId)

    await expect(
      h.actions.patchBlockState(msg.id, { userId: USER_ALICE, blockId: 'b-static', disabled: true }),
    ).rejects.toMatchObject({ code: MessageErrorCode.BLOCK_NOT_INTERACTIVE })
  })

  it('rejects unknown blocks and messages without rich blocks', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const rich = appendRichMessage(h, threadId)
    const plain = appendUser(h, threadId, 'plain')

    await expect(
      h.actions.patchBlockState(rich.id, { userId: USER_ALICE, blockId: 'b-missing' }),
    ).rejects.toMatchObject({ code: MessageErrorCode.BLOCK_NOT_FOUND })

    await expect(
      h.actions.patchBlockState(plain.id, { userId: USER_ALICE, blockId: 'b-choice' }),
    ).rejects.toMatchObject({ code: MessageErrorCode.NO_RICH_BLOCKS })
  })

  it('rejects callers who are neither author nor thread creator', async () => {
    const h = harness()
    const threadId = await createThread(h)
    const msg = appendRichMessage(h, threadId)

    await expect(
      h.actions.patchBlockState(msg.id, { userId: USER_BOB, blockId: 'b-choice', disabled: true }),
    ).rejects.toMatchObject({ code: MessageErrorCode.UNAUTHORIZED })
  })
})

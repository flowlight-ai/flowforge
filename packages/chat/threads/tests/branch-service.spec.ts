/**
 * ThreadBranchService — 编辑即分支（ADR-008 D4）移植契约验证（阶段5 批次1）：
 * - 正常分支：切点前消息全量复制 + "(分支)" 标题后缀 + branchedFrom 元数据
 * - editedContent：切点消息以编辑后内容替换
 * - 无标题源线程 → '分支对话' fallback
 * - 权限：非 owner 且非 system 线程 → UNAUTHORIZED
 * - fromMessage 校验：不存在 / 属于其他线程 → INVALID_FROM_MESSAGE；
 *   软删消息（复制视图不可见）→ FROM_MESSAGE_DELETED
 * - onBranched 通知回调（批次3 realtime 接线点）
 * - 复制失败回滚：孤儿分支线程与已复制消息一并清理
 *
 * @module @flowforge/chat-threads/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import { createCatId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import type { AppendMessageInput, StoredMessage } from '@flowforge/cats-stores'
import { BRANCH_TITLE_SUFFIX, ThreadBranchService, ThreadErrorCode } from '../src/index.ts'

const USER_ALICE = 'alice' as UserId
const USER_BOB = 'bob' as UserId
const CAT_OPUS = createCatId('opus')

interface Harness {
  ctx: Context
  branch: ThreadBranchService
  backend: MemoryStoresBackend
}

function harness(
  options: ConstructorParameters<typeof ThreadBranchService>[1] = {},
): Harness {
  const ctx = new Context()
  new CatStores(ctx)
  const backend = new MemoryStoresBackend(ctx)
  const branch = new ThreadBranchService(ctx, options)
  return { ctx, branch, backend }
}

/** Create an alice-owned thread with `contents` appended in order. */
async function seedThread(
  h: Harness,
  contents: readonly string[],
  title?: string,
  options: { readonly userId?: UserId } = {},
): Promise<{ readonly threadId: string; readonly messages: readonly StoredMessage[] }> {
  const userId = options.userId ?? USER_ALICE
  const created = await h.ctx.catStores.threads().create({
    userId,
    title: title ?? '',
    assignedCatIds: [CAT_OPUS],
  })
  const messages: StoredMessage[] = []
  for (const content of contents) {
    messages.push(
      h.backend.messageStore.append({
        userId,
        catId: null,
        content,
        mentions: [],
        timestamp: Date.now(),
        threadId: created.id,
      }),
    )
  }
  return { threadId: created.id, messages }
}

describe('ThreadBranchService — branchFromMessage', () => {
  it('copies messages up to the cut point with the branch title suffix', async () => {
    const h = harness()
    const seed = await seedThread(h, ['one', 'two', 'three'], 'original')

    const result = await h.branch.branchFromMessage({
      threadId: seed.threadId,
      fromMessageId: seed.messages[1]!.id,
      userId: USER_ALICE,
    })

    expect(result.messageCount).toBe(2)
    expect(result.title).toBe(`original${BRANCH_TITLE_SUFFIX}`)

    const newThread = h.backend.threadStore.getById(result.threadId)
    expect(newThread?.title).toBe(`original${BRANCH_TITLE_SUFFIX}`)
    expect(newThread?.assignedCatIds).toEqual([CAT_OPUS])
    expect(newThread?.metadata).toMatchObject({
      branchedFrom: seed.threadId,
      branchedFromMessageId: seed.messages[1]!.id,
    })

    const copied = await h.backend.messageStore.getByThread(result.threadId)
    expect(copied.map((m) => m.content)).toEqual(['one', 'two'])

    // Source thread is untouched.
    const source = await h.backend.messageStore.getByThread(seed.threadId)
    expect(source).toHaveLength(3)
  })

  it('replaces the cut-point message with editedContent', async () => {
    const h = harness()
    const seed = await seedThread(h, ['one', 'two'], 'original')

    const result = await h.branch.branchFromMessage({
      threadId: seed.threadId,
      fromMessageId: seed.messages[1]!.id,
      editedContent: 'two (edited)',
      userId: USER_ALICE,
    })

    const copied = await h.backend.messageStore.getByThread(result.threadId)
    expect(copied.map((m) => m.content)).toEqual(['one', 'two (edited)'])
  })

  it('falls back to a default title for untitled threads', async () => {
    const h = harness()
    const seed = await seedThread(h, ['one'])
    const result = await h.branch.branchFromMessage({
      threadId: seed.threadId,
      fromMessageId: seed.messages[0]!.id,
      userId: USER_ALICE,
    })
    expect(result.title).toBe('分支对话')
  })

  it('rejects branching from foreign threads', async () => {
    const h = harness()
    const seed = await seedThread(h, ['one'], 'private')
    await expect(
      h.branch.branchFromMessage({
        threadId: seed.threadId,
        fromMessageId: seed.messages[0]!.id,
        userId: USER_BOB,
      }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.UNAUTHORIZED })
  })

  it('validates the fromMessage (unknown / cross-thread / soft-deleted)', async () => {
    const h = harness()
    const a = await seedThread(h, ['one'], 'a')
    const b = await seedThread(h, ['two'], 'b')

    // Unknown message id.
    await expect(
      h.branch.branchFromMessage({
        threadId: a.threadId,
        fromMessageId: 'msg_missing',
        userId: USER_ALICE,
      }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.INVALID_FROM_MESSAGE })

    // Message belongs to another thread.
    await expect(
      h.branch.branchFromMessage({
        threadId: a.threadId,
        fromMessageId: b.messages[0]!.id,
        userId: USER_ALICE,
      }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.INVALID_FROM_MESSAGE })

    // Soft-deleted cut point: invisible in the copy view.
    h.backend.messageStore.softDelete(a.messages[0]!.id, USER_ALICE)
    await expect(
      h.branch.branchFromMessage({
        threadId: a.threadId,
        fromMessageId: a.messages[0]!.id,
        userId: USER_ALICE,
      }),
    ).rejects.toMatchObject({ code: ThreadErrorCode.FROM_MESSAGE_DELETED })
  })

  it('fires the onBranched notification hook', async () => {
    const onBranched = vi.fn()
    const h = harness({ onBranched })
    const seed = await seedThread(h, ['one'], 'original')

    const result = await h.branch.branchFromMessage({
      threadId: seed.threadId,
      fromMessageId: seed.messages[0]!.id,
      userId: USER_ALICE,
    })

    expect(onBranched).toHaveBeenCalledWith({
      sourceThreadId: seed.threadId,
      newThreadId: result.threadId,
      fromMessageId: seed.messages[0]!.id,
    })
  })

  it('rolls back the orphan branch when a copy fails', async () => {
    const h = harness()
    const seed = await seedThread(h, ['one', 'two'], 'original')

    // Inject a failure on the second copied message.
    const original = h.backend.messageStore.append.bind(h.backend.messageStore)
    let calls = 0
    const spy = vi.spyOn(h.backend.messageStore, 'append').mockImplementation(
      (input: AppendMessageInput) => {
        calls++
        if (calls === 2) throw new Error('injected copy failure')
        return original(input)
      },
    )
    try {
      await expect(
        h.branch.branchFromMessage({
          threadId: seed.threadId,
          fromMessageId: seed.messages[1]!.id,
          userId: USER_ALICE,
        }),
      ).rejects.toMatchObject({ code: ThreadErrorCode.BRANCH_FAILED })
    } finally {
      spy.mockRestore()
    }

    // Rollback removed the orphan branch thread and its copied message.
    const threads = await h.backend.threadStore.listForUser(USER_ALICE)
    expect(threads.filter((t) => t.title.includes(BRANCH_TITLE_SUFFIX))).toHaveLength(0)
    const strayBranchMessages = (await h.backend.messageStore.getRecent(100, USER_ALICE))
      .filter((m) => m.threadId !== seed.threadId)
    expect(strayBranchMessages).toHaveLength(0)

    // The source thread survives intact.
    const source = await h.backend.messageStore.getByThread(seed.threadId)
    expect(source.map((m) => m.content)).toEqual(['one', 'two'])
  })
})

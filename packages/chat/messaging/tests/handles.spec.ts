/**
 * Host-issued address handles — contract tests (T-D1, AC-2 / §4c).
 */
import { describe, expect, it } from 'vitest'
import type { HandleScope } from '../src/contract/host-types.js'
import { MessagingError } from '../src/contract/host-types.js'
import { HandleService } from '../src/handles.js'
import { MemoryCursorStore } from '../src/stores/memory-cursor.js'
import { MemoryHandleStore } from '../src/stores/memory.js'

const scope: HandleScope = { canSend: true, canSubscribe: true }
const subscribeOnly: HandleScope = { canSend: false, canSubscribe: true }

function service() {
  const handles = new MemoryHandleStore()
  const cursors = new MemoryCursorStore()
  return { handles, cursors, handleService: new HandleService(handles, cursors) }
}

describe('HandleService.issueThreadHandle', () => {
  it('issues a th_ thread handle bound to instance / thread / userId', async () => {
    const { handleService } = service()
    const { handleId } = await handleService.issueThreadHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
    })
    expect(handleId.startsWith('th_')).toBe(true)
  })
})

describe('HandleService.resolveForSend', () => {
  it('resolves a matching, live handle with canSend', async () => {
    const { handleService } = service()
    const { handleId } = await handleService.issueThreadHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
    })
    const record = await handleService.resolveForSend('inst-1', { kind: 'thread_handle', handle: handleId })
    expect(record.threadId).toBe('t1')
  })

  it('rejects when the address kind does not match the handle kind', async () => {
    const { handleService } = service()
    const { handleId } = await handleService.issueConnectorBindingHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
      connectorId: 'c1',
      externalChatId: 'chat1',
    })
    await expect(handleService.resolveForSend('inst-1', { kind: 'thread_handle', handle: handleId })).rejects.toThrow(
      MessagingError,
    )
  })

  it('rejects when the handle is bound to another plugin instance (INV-8)', async () => {
    const { handleService } = service()
    const { handleId } = await handleService.issueThreadHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
    })
    await expect(handleService.resolveForSend('inst-2', { kind: 'thread_handle', handle: handleId })).rejects.toThrow(
      MessagingError,
    )
  })

  it('rejects when the handle scope does not grant send', async () => {
    const { handleService } = service()
    const { handleId } = await handleService.issueThreadHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope: subscribeOnly,
    })
    await expect(handleService.resolveForSend('inst-1', { kind: 'thread_handle', handle: handleId })).rejects.toThrow(
      MessagingError,
    )
  })
})

describe('HandleService.ensureMessageHandle', () => {
  it('mints one canonical message handle per message id (idempotent)', async () => {
    const { handleService } = service()
    const { handleId } = await handleService.issueThreadHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
    })
    const parent = await handleService.resolveForSend('inst-1', { kind: 'thread_handle', handle: handleId })
    const first = await handleService.ensureMessageHandle(parent, 'm1')
    const second = await handleService.ensureMessageHandle(parent, 'm1')
    expect(first.handleId).toBe(second.handleId)
  })

  it('resolves for append against a live message handle and its parent', async () => {
    const { handleService } = service()
    const { handleId } = await handleService.issueThreadHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
    })
    const parent = await handleService.resolveForSend('inst-1', { kind: 'thread_handle', handle: handleId })
    const mh = await handleService.ensureMessageHandle(parent, 'm1')
    const resolved = await handleService.resolveForAppend('inst-1', { kind: 'message', token: mh.handleId })
    expect(resolved.messageId).toBe('m1')
  })
})

describe('HandleService.revoke', () => {
  it('revokes the handle and cascades to bound subscriptions', async () => {
    const { cursors, handleService } = service()
    const { handleId } = await handleService.issueThreadHandle({
      pluginInstanceId: 'inst-1',
      threadId: 't1',
      userId: 'u1',
      scope,
    })
    await cursors.createOrGet({
      subscriptionId: 'sub-1',
      pluginInstanceId: 'inst-1',
      handleId,
      threadId: 't1',
      ackedSequence: 0,
      lastDeliveredSequence: 0,
      replayFloorSequence: 0,
    })
    await handleService.revoke(handleId)

    const sub = await cursors.get('inst-1', 'sub-1')
    expect(sub?.revokedAt).toBeDefined()
    await expect(handleService.resolveForSend('inst-1', { kind: 'thread_handle', handle: handleId })).rejects.toThrow(
      MessagingError,
    )
  })
})
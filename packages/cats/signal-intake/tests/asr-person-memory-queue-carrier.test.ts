/**
 * ASR 人物记忆队列载体契约：把服务端场景绑定到已持久化队列消息。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { bindAsrPersonMemoryScenesFromQueueMessage, type AsrQueueCarrierMessage } from '../src/AsrPersonMemoryQueueCarrier.ts'
import { buildAsrPersonMemoryDynamicScenes } from '../src/AsrPersonMemorySceneBuilder.ts'
import { makeArtifact, makeIntake } from './fixtures.ts'

function liveMessage(extra: Partial<AsrQueueCarrierMessage> = {}): AsrQueueCarrierMessage {
  const scenes = buildAsrPersonMemoryDynamicScenes({
    intake: makeIntake({ judgmentState: 'confirmed', choices: { speakerMap: { spk1: 'Alice' } } }),
    artifact: makeArtifact(),
    threadId: 'thread-abc',
    consumerCatId: 'cat-a',
    now: 5_000,
  })
  return {
    id: 'msg-1',
    userId: 'owner-1',
    threadId: 'thread-abc',
    catId: null,
    extra: {
      dynamicSceneEntries: scenes,
      meetingArtifact: { trust: 'untrusted_external', instructionPolicy: 'data_only' },
    },
    ...extra,
  }
}

describe('bindAsrPersonMemoryScenesFromQueueMessage', () => {
  it('binds every scene from a live verified owner message', () => {
    const bound = bindAsrPersonMemoryScenesFromQueueMessage(liveMessage(), { ownerUserId: 'owner-1', threadId: 'thread-abc' })
    expect(bound).toHaveLength(1)
    expect(bound[0]!.source.visibility).toBe('verified_live_owner_message')
    expect(bound[0]!.source.sourceMessageId).toBe('msg-1')
  })

  it('returns nothing for a deleted or mismatched message', () => {
    const ownerMatch = liveMessage()
    expect(bindAsrPersonMemoryScenesFromQueueMessage({ ...ownerMatch, userId: 'owner-2' }, { ownerUserId: 'owner-1', threadId: 'thread-abc' })).toHaveLength(0)
    expect(bindAsrPersonMemoryScenesFromQueueMessage({ ...ownerMatch, deletedAt: 1 }, { ownerUserId: 'owner-1', threadId: 'thread-abc' })).toHaveLength(0)
    expect(bindAsrPersonMemoryScenesFromQueueMessage({ ...ownerMatch, _tombstone: true }, { ownerUserId: 'owner-1', threadId: 'thread-abc' })).toHaveLength(0)
  })

  it('returns nothing when the artifact is not data_only / untrusted', () => {
    const message = liveMessage({ extra: { dynamicSceneEntries: [], meetingArtifact: { trust: 'trusted', instructionPolicy: 'data_only' } } })
    expect(bindAsrPersonMemoryScenesFromQueueMessage(message, { ownerUserId: 'owner-1', threadId: 'thread-abc' })).toHaveLength(0)
  })
})
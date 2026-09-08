/**
 * 线程会议产物调度契约：envelope 构建、目标 cat 选择、幂等投递与重试呈现。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { ThreadMeetingArtifactDispatcher, MAX_MEETING_ARTIFACT_ENVELOPE_BYTES, buildMeetingArtifactPrompt } from '../src/ThreadMeetingArtifactDispatcher.ts'
import { MemoryMeetingThreadStore } from '../src/ThreadDestinationAuthority.ts'
import { MemoryMeetingThreadDeliveryPort } from '../src/MeetingThreadDeliveryPort.ts'
import { createMeetingArtifactDescriptor } from '../src/MeetingArtifactResourceService.ts'
import { makeIntake } from './fixtures.ts'

const THREAD = 'host:private-thread:thread-abc'

function setup() {
  const threadStore = new MemoryMeetingThreadStore()
  threadStore.put({ id: 'thread-abc', createdBy: 'owner-1', preferredCats: ['cat-a'], participants: ['cat-a', 'cat-b'] })
  const delivery = new MemoryMeetingThreadDeliveryPort({ supportsPresentationRetry: () => true })
  const now = () => 3_000
  const dispatcher = new ThreadMeetingArtifactDispatcher({ threadStore, delivery, now })
  return { threadStore, delivery, dispatcher }
}

function artifact() {
  return createMeetingArtifactDescriptor({ intakeId: 'intake-1', sourceHandle: 'minute://obcn123456', contentType: 'text/plain', text: 'meeting body' })
}

describe('ThreadMeetingArtifactDispatcher.deliver', () => {
  it('dispatches a dynamic carrier to the preferred cat', async () => {
    const { dispatcher, delivery } = setup()
    const intake = makeIntake({
      ownerId: 'owner-1',
      judgmentState: 'confirmed',
      choices: { speakerMap: { spk1: 'Alice' }, destinationHandle: THREAD },
    })
    await expect(dispatcher.deliver({ intake, artifact: artifact() })).resolves.toBeUndefined()
    // the carrier is durably queryable by its idempotency key
    const receipt = await delivery.getCarrierByIdempotencyKey('owner-1', 'thread-abc', `meeting-artifact:intake-1:${artifact().sourceRevision}`)
    expect(receipt?.threadId).toBe('thread-abc')
  })

  it('rejects a destination that is not a private thread', async () => {
    const { dispatcher } = setup()
    const intake = makeIntake({ choices: { destinationHandle: 'host:channel:other' } })
    const error = await dispatcher.deliver({ intake, artifact: artifact() }).catch((e) => e)
    expect(error.code).toBe('ROUTE_UNAVAILABLE')
  })
})

describe('ThreadMeetingArtifactDispatcher.deliverAlphaDynamicCanary', () => {
  it('queues a canary for a valid run id', async () => {
    const { dispatcher } = setup()
    const result = await dispatcher.deliverAlphaDynamicCanary({ ownerId: 'owner-1', threadId: 'thread-abc', runId: 'a'.repeat(40) })
    expect(result.started).toBe(true)
    expect(result.deduped).toBe(false)
  })

  it('rejects a malformed run id', async () => {
    const { dispatcher } = setup()
    const error = await dispatcher.deliverAlphaDynamicCanary({ ownerId: 'owner-1', threadId: 'thread-abc', runId: 'not-hex' }).catch((e) => e)
    expect(error.code).toBe('ROUTE_UNAVAILABLE')
  })
})

describe('envelope size guard', () => {
  it('builds a prompt under the hard byte limit', () => {
    const prompt = buildMeetingArtifactPrompt(
      makeIntake({ choices: { speakerMap: { spk1: 'Alice' }, destinationHandle: THREAD } }),
      artifact(),
    )
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(MAX_MEETING_ARTIFACT_ENVELOPE_BYTES)
  })
})
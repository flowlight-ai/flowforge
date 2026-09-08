/**
 * 会议产物资源服务契约：owner/thread/cat 授权 + revision 校验 + 分页视图。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { MeetingArtifactResourceService, createMeetingArtifactDescriptor } from '../src/MeetingArtifactResourceService.ts'
import { MemoryMeetingIntakeStore } from '../src/MeetingIntakeStore.ts'
import {
  MemorySourceAccessLeaseStore,
  SourceAccessLeaseService,
  SourceResolverRegistry,
  type SourceArtifact,
  type SourceResolver,
} from '../src/SourceAccessLeaseService.ts'
import { meetingArtifactCarrierIdempotencyKey, type MeetingArtifactCarrierReader, type MeetingIntakeCarrierResolved } from '../src/meeting-artifact-resource-contract.ts'
import { MeetingArtifactResourceError } from '../src/meeting-artifact-resource-contract.ts'
import { makeIntake } from './fixtures.ts'

const HANDLE = 'minute://obcn123456'
const THREAD = 'host:private-thread:thread-abc'
const TRANSCRIPT = '[00:00:00] Alice: opening\n[00:00:05] Bob: agreed\n[00:00:09] Alice: next steps\n'

class TranscriptResolver implements SourceResolver {
  readonly adapterId = 'transcript.v1'
  supports(handle: string): boolean {
    return handle === HANDLE
  }
  async resolve(): Promise<SourceArtifact> {
    return { contentType: 'text/plain', text: TRANSCRIPT }
  }
}

class MemoryCarrierReader implements MeetingArtifactCarrierReader {
  private readonly records = new Map<string, MeetingIntakeCarrierResolved | null>()
  put(ownerId: string, threadId: string, idempotencyKey: string, record: MeetingIntakeCarrierResolved | null): void {
    this.records.set(`${ownerId}\u0000${threadId}\u0000${idempotencyKey}`, record)
  }
  async getByIdempotencyKey(ownerId: string, threadId: string, idempotencyKey: string): Promise<MeetingIntakeCarrierResolved | null> {
    return structuredClone(this.records.get(`${ownerId}\u0000${threadId}\u0000${idempotencyKey}`) ?? null)
  }
}

function setup() {
  const intakes = new MemoryMeetingIntakeStore()
  const descriptor = createMeetingArtifactDescriptor({ intakeId: 'intake-1', sourceHandle: HANDLE, contentType: 'text/plain', text: TRANSCRIPT })
  const intake = makeIntake({
    source: { handle: HANDLE },
    judgmentState: 'confirmed',
    choices: { destinationHandle: THREAD, speakerMap: { spk1: 'Alice' } },
    artifact: descriptor,
  })
  const leases = new MemorySourceAccessLeaseStore()
  const resolvers = new SourceResolverRegistry()
  resolvers.register(new TranscriptResolver())
  const sources = new SourceAccessLeaseService({ intakes, leases, resolvers, now: () => 1_000, createGrant: () => 'g1', ttlMs: 60_000 })
  const messages = new MemoryCarrierReader()
  messages.put('owner-1', 'thread-abc', meetingArtifactCarrierIdempotencyKey(intake.intakeId, descriptor.sourceRevision), {
    userId: 'owner-1',
    threadId: 'thread-abc',
    connectorFromSource: 'feishu',
    mentions: ['cat-a'],
    meetingArtifact: { resourceRef: descriptor.resourceRef, sourceRevision: descriptor.sourceRevision },
  })
  const service = new MeetingArtifactResourceService({ intakes, sources, messages })
  return { intakes, sources, service, descriptor, intake }
}

async function adm(store: MemoryMeetingIntakeStore, intake: ReturnType<typeof makeIntake>) {
  await store.accept({ settlementKey: 's1', sourceIdentityKey: 'src1', intake })
  return intake
}

describe('MeetingArtifactResourceService.read', () => {
  it('returns an overview projection with detected speakers', async () => {
    const { intakes, service, intake, descriptor } = setup()
    await adm(intakes, intake)
    const result = await service.read({
      ownerId: 'owner-1',
      threadId: 'thread-abc',
      catId: 'cat-a',
      resourceRef: descriptor.resourceRef,
      view: 'overview',
      maxChars: 4_096,
      maxTokens: 2_000,
    })
    expect(result.view).toBe('overview')
    expect(result.overview.characterCount).toBe(TRANSCRIPT.length)
    expect(result.overview.detectedSpeakers).toContain('Alice')
    expect(result.overview.detectedSpeakers).toContain('Bob')
  })

  it('returns a content page with a nextCursor when it has more', async () => {
    const { intakes, service, intake, descriptor } = setup()
    await adm(intakes, intake)
    const result = await service.read({
      ownerId: 'owner-1',
      threadId: 'thread-abc',
      catId: 'cat-a',
      resourceRef: descriptor.resourceRef,
      view: 'content',
      maxChars: 8,
      maxTokens: 2_000,
    })
    expect(result.content.length).toBeGreaterThan(0)
    expect(typeof result.nextCursor).toBe('string')
  })

  it('rejects a cat that is not a participant', async () => {
    const { intakes, service, intake, descriptor } = setup()
    await adm(intakes, intake)
    const error = await service
      .read({ ownerId: 'owner-1', threadId: 'thread-abc', catId: 'cat-z', resourceRef: descriptor.resourceRef, view: 'overview', maxChars: 100, maxTokens: 100 })
      .catch((e) => e)
    expect(error).toBeInstanceOf(MeetingArtifactResourceError)
    expect(error.code).toBe('RESOURCE_FORBIDDEN')
  })

  it('rejects an invalid resource ref', async () => {
    const { intakes, service, intake } = setup()
    await adm(intakes, intake)
    const error = await service
      .read({ ownerId: 'owner-1', threadId: 'thread-abc', catId: 'cat-a', resourceRef: 'bad', view: 'overview', maxChars: 100, maxTokens: 100 })
      .catch((e) => e)
    expect(error).toBeInstanceOf(MeetingArtifactResourceError)
    expect(error.code).toBe('RESOURCE_NOT_FOUND')
  })

  it('rejects out-of-bounds read bounds', async () => {
    const { intakes, service, intake, descriptor } = setup()
    await adm(intakes, intake)
    const error = await service
      .read({ ownerId: 'owner-1', threadId: 'thread-abc', catId: 'cat-a', resourceRef: descriptor.resourceRef, view: 'content', maxChars: 100_000, maxTokens: 100 })
      .catch((e) => e)
    expect(error).toBeInstanceOf(MeetingArtifactResourceError)
    expect(error.code).toBe('INVALID_READ_REQUEST')
  })
})
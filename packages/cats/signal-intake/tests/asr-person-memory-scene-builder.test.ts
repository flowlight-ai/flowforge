/**
 * ASR 人物记忆动态场景构建契约（写机会投影）。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { buildAsrPersonMemoryDynamicScenes } from '../src/AsrPersonMemorySceneBuilder.ts'
import { asrPersonMemoryDynamicSceneEntryV1Schema } from '../src/contract/asr-person-memory-scene.ts'
import { makeArtifact, makeIntake } from './fixtures.ts'

function confirmedIntake() {
  return makeIntake({
    judgmentState: 'confirmed',
    choices: { speakerMap: { spk1: 'Alice', spk2: 'Bob' } },
  })
}

describe('buildAsrPersonMemoryDynamicScenes', () => {
  it('builds a validated scene for a confirmed data-only artifact', () => {
    const scenes = buildAsrPersonMemoryDynamicScenes({
      intake: confirmedIntake(),
      artifact: makeArtifact(),
      threadId: 'thread-abc',
      consumerCatId: 'cat-a',
      now: 5_000,
    })
    expect(scenes).toHaveLength(1)
    expect(asrPersonMemoryDynamicSceneEntryV1Schema.safeParse(scenes[0]).success).toBe(true)
    expect(scenes[0]!.surface).toBe('dynamic_context')
    expect(scenes[0]!.opportunity.opportunityId).toMatch(/^write_opp_[a-f0-9]{32}$/)
  })

  it('binds one source coordinate per normalized speaker', () => {
    const scenes = buildAsrPersonMemoryDynamicScenes({
      intake: confirmedIntake(),
      artifact: makeArtifact(),
      threadId: 'thread-abc',
      consumerCatId: 'cat-a',
      now: 5_000,
    })
    expect(scenes[0]!.opportunity.sourceCoordinates).toHaveLength(2)
  })

  it('returns no scenes for a non-confirmed intake', () => {
    const intake = makeIntake({ judgmentState: 'unresolved', choices: { speakerMap: { spk1: 'Alice' } } })
    expect(
      buildAsrPersonMemoryDynamicScenes({ intake, artifact: makeArtifact(), threadId: 't', consumerCatId: 'c', now: 1 } ),
    ).toHaveLength(0)
  })

  it('returns no scenes for zero-byte or untrusted artifacts', () => {
    expect(
      buildAsrPersonMemoryDynamicScenes({
        intake: confirmedIntake(),
        artifact: makeArtifact({ byteLength: 0 }),
        threadId: 't',
        consumerCatId: 'c',
        now: 1,
      }),
    ).toHaveLength(0)
    expect(
      buildAsrPersonMemoryDynamicScenes({
        intake: confirmedIntake(),
        artifact: makeArtifact({ trust: 'untrusted_external', instructionPolicy: 'data_only', byteLength: 0 }),
        threadId: 't',
        consumerCatId: 'c',
        now: 1,
      }),
    ).toHaveLength(0)
  })

  it('derives a stable lineage from owner, intake, source and revision', () => {
    const a = buildAsrPersonMemoryDynamicScenes({
      intake: confirmedIntake(),
      artifact: makeArtifact(),
      threadId: 'thread-abc',
      consumerCatId: 'cat-a',
      now: 5_000,
    })
    const b = buildAsrPersonMemoryDynamicScenes({
      intake: confirmedIntake(),
      artifact: makeArtifact(),
      threadId: 'thread-abc',
      consumerCatId: 'cat-a',
      now: 6_000,
    })
    expect(a[0]!.opportunity.dedupeLineage).toBe(b[0]!.opportunity.dedupeLineage)
  })
})
/**
 * MeetingIntake 契约辅助与编解码契约。
 *
 * @flowforge/cats-signal-intake/tests
 */

import { describe, expect, it } from 'vitest'
import { meetingIntakeNeedsAttention } from '../src/contract/signals.ts'
import { parseMeetingIntake } from '../src/meeting-intake-codec.ts'
import { makeArtifact, makeIntake } from './fixtures.ts'

describe('meetingIntakeNeedsAttention', () => {
  it('flags unresolved judgment or degraded health', () => {
    expect(meetingIntakeNeedsAttention(makeIntake())).toBe(true)
    expect(meetingIntakeNeedsAttention(makeIntake({ judgmentState: 'dismissed' }))).toBe(false)
    expect(meetingIntakeNeedsAttention(makeIntake({ judgmentState: 'confirmed', healthState: 'degraded' }))).toBe(true)
  })
})

describe('parseMeetingIntake — codec round trip', () => {
  it('round-trips a valid intake through canonical JSON', () => {
    const intake = makeIntake({ artifact: makeArtifact() })
    const parsed = parseMeetingIntake(JSON.stringify(intake))
    expect(parsed.intakeId).toBe('intake-1')
    expect(parsed.artifact?.sourceRevision).toBe(intake.artifact?.sourceRevision)
    expect(parsed.unresolved).toEqual(['speakers', 'destination'])
  })

  it('rejects non-JSON payload', () => {
    expect(() => parseMeetingIntake('{oops')).toThrow('not valid JSON')
  })

  it('rejects records with unknown state enums', () => {
    const raw = JSON.stringify(makeIntake({ judgmentState: 'weird' as never }))
    expect(() => parseMeetingIntake(raw)).toThrow('corrupt')
  })

  it('rejects artifact whose resourceRef does not match its intake', () => {
    const bad = makeArtifact({ resourceRef: 'meeting-artifact://intakes/other?revision=sha256:' + 'b'.repeat(64) })
    expect(() => parseMeetingIntake(JSON.stringify(makeIntake({ artifact: bad })))).toThrow('corrupt')
  })

  it('accepts intake without artifact', () => {
    const parsed = parseMeetingIntake(JSON.stringify(makeIntake({ artifact: undefined })))
    expect(parsed.artifact).toBeUndefined()
  })
})
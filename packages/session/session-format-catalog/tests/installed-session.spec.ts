import { describe, expect, it } from 'vitest'
import type { SessionFormatArtifact, SessionFormatHeader } from '@flowforge/session-format'
import { MemoryInstalledSession, INSTALLED_SESSION_FORMAT_VERSION } from '../src/ports/installed-session.ts'
import {
  validateInstalledCurrentSessionArtifact,
  validateInstalledCurrentSessionHeader,
} from '../src/current.ts'

const installed = new MemoryInstalledSession()

const currentHeader: SessionFormatHeader = {
  version: 2,
  id: 'installed-current',
  createdAt: 1,
  isSeeded: false,
  delegationDepth: 0,
}

describe('installed current Session restoration', () => {
  it('is a real memory implementation at the current version', () => {
    expect(installed.version).toBe(INSTALLED_SESSION_FORMAT_VERSION)
    expect(installed.version).toBe(2)
    const known = installed.knownEventTypes()
    expect(known.has('turn/start')).toBe(true)
    expect(known.has('request/header')).toBe(true)
    expect(known.has('assistant/attempt')).toBe(true)
  })

  it('rejects version skew before entering installed Session validation', () => {
    expect(() => validateInstalledCurrentSessionHeader(installed, { ...currentHeader, version: 0 }))
      .toThrow(/installed Session format is v2, got v0/)
    const artifact: SessionFormatArtifact = {
      header: { ...currentHeader, version: 0 },
      inheritedEventCount: 0,
      events: [],
    }
    expect(() => validateInstalledCurrentSessionArtifact(installed, artifact))
      .toThrow(/installed Session format is v2, got v0/)
  })

  it('rejects an event type outside the installed released-v2 vocabulary', () => {
    const artifact: SessionFormatArtifact = {
      header: { ...currentHeader },
      inheritedEventCount: 0,
      events: [
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        { type: 'ordinary/not-installed', seq: 1, time: 2, data: 'future' },
      ],
    }
    expect(() => validateInstalledCurrentSessionArtifact(installed, artifact))
      .toThrow(/rejects unknown event type "ordinary\/not-installed"/)
  })

  it('rejects a non-dense event seq in the installed Session', () => {
    const artifact: SessionFormatArtifact = {
      header: { ...currentHeader },
      inheritedEventCount: 0,
      events: [
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        { type: 'turn/start', seq: 2, time: 2, data: { turn: 2 } },
      ],
    }
    expect(() => validateInstalledCurrentSessionArtifact(installed, artifact))
      .toThrow(/installed Session event .* is not dense/)
  })

  it('accepts a canonical current header and artifact composed of installed types', () => {
    expect(() => validateInstalledCurrentSessionHeader(installed, currentHeader)).not.toThrow()
    const artifact: SessionFormatArtifact = {
      header: { ...currentHeader, isSeeded: true },
      inheritedEventCount: 0,
      events: [
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        {
          type: 'request/header',
          seq: 1,
          time: 2,
          data: {
            header: { config: { provider: 'mock', model: 'mock' } },
            reason: 'initial',
            startsSeries: false,
          },
        },
      ],
    }
    expect(() => validateInstalledCurrentSessionArtifact(installed, artifact)).not.toThrow()
  })
})
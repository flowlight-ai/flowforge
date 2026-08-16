/**
 * Skill security store: the approval lifecycle for installed skills.
 * Every skill registers with a content fingerprint (sha256); review
 * moves it pending_review → approved / quarantined, and rejection is
 * terminal until reinstall. An approved skill whose content no longer
 * matches its fingerprint is auto-quarantined (tamper tripwire).
 * Mapped from the upstream skill-security reference `skill-security-store` (C36).
 *
 * @module @flowforge/skill-security/store
 */

import { createHash } from 'node:crypto'
import type { ContentScanFinding } from './scanner.ts'

/** Approval lifecycle of one installed skill. */
export type SkillSecurityStatus = 'pending_review' | 'approved' | 'quarantined' | 'rejected'

/** Content fingerprint recorded at registration time. */
export interface SkillFingerprint {
  readonly source: string
  readonly version: string
  readonly contentHash: string
  readonly recordedAt: string
}

/** The security record of one skill. */
export interface SkillSecurityEntry {
  readonly skillId: string
  readonly status: SkillSecurityStatus
  readonly fingerprint: SkillFingerprint
  readonly scanFindings: readonly ContentScanFinding[]
  readonly approvedBy?: string
  readonly approvedAt?: string
  readonly revokedBy?: string
  readonly revokedAt?: string
}

/** What a registration needs: where the skill came from and its content. */
export interface SkillRegisterInput {
  readonly source: string
  readonly version: string
  readonly content: string
}

/** Outcome of a fingerprint re-verification. */
export interface FingerprintVerification {
  readonly valid: boolean
  readonly expected: string
  readonly actual: string
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function buildFingerprint(input: SkillRegisterInput): SkillFingerprint {
  return {
    source: input.source,
    version: input.version,
    contentHash: computeHash(input.content),
    recordedAt: new Date().toISOString(),
  }
}

/**
 * In-memory security registry. Hosts that need persistence serialize
 * {@link SkillSecurityStore.list} through their storage domain — the
 * store itself stays dependency-free (R19).
 */
export class SkillSecurityStore {
  private readonly entries: Map<string, SkillSecurityEntry>

  private constructor(entries?: Map<string, SkillSecurityEntry>) {
    this.entries = entries ?? new Map()
  }

  static createInMemory(): SkillSecurityStore {
    return new SkillSecurityStore()
  }

  /** Register a skill for review (starts pending_review). */
  register(skillId: string, input: SkillRegisterInput): SkillSecurityEntry {
    const entry: SkillSecurityEntry = {
      skillId,
      status: 'pending_review',
      fingerprint: buildFingerprint(input),
      scanFindings: [],
    }
    this.entries.set(skillId, entry)
    return entry
  }

  get(skillId: string): SkillSecurityEntry | undefined {
    return this.entries.get(skillId)
  }

  list(): SkillSecurityEntry[] {
    return [...this.entries.values()]
  }

  /** Approve a skill for execution. */
  approve(skillId: string, approver: string): SkillSecurityEntry {
    const entry = this.requireEntry(skillId)
    this.assertNotTerminal(entry)
    const updated: SkillSecurityEntry = {
      ...entry,
      status: 'approved',
      approvedBy: approver,
      approvedAt: new Date().toISOString(),
    }
    this.entries.set(skillId, updated)
    return updated
  }

  /** Quarantine a skill with the scan findings that convicted it. */
  quarantine(skillId: string, findings: readonly ContentScanFinding[]): SkillSecurityEntry {
    const entry = this.requireEntry(skillId)
    this.assertNotTerminal(entry)
    const updated: SkillSecurityEntry = {
      ...entry,
      status: 'quarantined',
      scanFindings: findings,
    }
    this.entries.set(skillId, updated)
    return updated
  }

  /** Reject (terminal) — reinstall is the only way back. */
  revoke(skillId: string, revoker: string): SkillSecurityEntry {
    const entry = this.requireEntry(skillId)
    const updated: SkillSecurityEntry = {
      ...entry,
      status: 'rejected',
      revokedBy: revoker,
      revokedAt: new Date().toISOString(),
    }
    this.entries.set(skillId, updated)
    return updated
  }

  /**
   * Re-hash the skill content on disk against the recorded fingerprint.
   * A mismatch on an APPROVED skill trips the tamper wire: the skill is
   * quarantined with a `fingerprint_mismatch` finding.
   */
  verifyFingerprint(skillId: string, currentContent: string): FingerprintVerification {
    const entry = this.requireEntry(skillId)
    const actual = computeHash(currentContent)
    const valid = actual === entry.fingerprint.contentHash
    if (!valid && entry.status === 'approved') {
      this.quarantine(skillId, [
        {
          pattern: 'fingerprint_mismatch',
          severity: 'critical',
          line: 0,
          context: `expected=${entry.fingerprint.contentHash.slice(0, 12)} actual=${actual.slice(0, 12)}`,
        },
      ])
    }
    return { valid, expected: entry.fingerprint.contentHash, actual }
  }

  private requireEntry(skillId: string): SkillSecurityEntry {
    const entry = this.entries.get(skillId)
    if (!entry) throw new Error(`skill not found: ${skillId}`)
    return entry
  }

  private assertNotTerminal(entry: SkillSecurityEntry): void {
    if (entry.status === 'rejected') {
      throw new Error(`skill ${entry.skillId} is rejected (terminal state). Re-install to re-enable.`)
    }
  }
}

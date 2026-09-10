import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryAuditLog } from '../src/audit-log-contract.ts'
import {
  computeSkillPackageRevision,
  PILOT_SKILL_ID,
  SkillConsumptionReceiptService,
  WORKSPACE_NAVIGATOR_CONSUMER_ID,
  type SkillConsumptionScope,
} from '../src/SkillConsumptionReceiptService.ts'
import { InMemorySortedSetStore } from '../src/store.ts'
import { SkillLoadEventLog } from '../src/SkillLoadEventLog.ts'
import type { SkillLoadedEvent } from '../src/event-log-types.ts'

const tempDirs: string[] = []
async function tempSkillRoot(skillId: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'skill-root-'))
  tempDirs.push(base)
  const pkg = join(base, skillId)
  await mkdir(pkg, { recursive: true })
  await writeFile(join(pkg, 'SKILL.md'), '# ' + skillId)
  return base
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

const scope: SkillConsumptionScope = {
  userId: 'u1',
  threadId: 't1',
  invocationId: 'i1',
  catId: 'c1',
}

describe('SkillLoadEventLog', () => {
  it('appends and reads skill-load events by session + count by skill', async () => {
    const log = new SkillLoadEventLog(new InMemorySortedSetStore())
    const ev: SkillLoadedEvent = { invocationId: 'i', sessionId: 's1', skillId: 'memory-nav', loadTrigger: 'explicit_call', timestamp: 10 }
    await log.append(ev)
    await log.append({ ...ev, loadTrigger: 'keyword_match', timestamp: 20 })
    const events = await log.readBySession('s1')
    expect(events).toHaveLength(2)
    expect(events[0]?.loadTrigger).toBe('explicit_call')
    expect(await log.countLoadsBySkill('s1', 'memory-nav')).toBe(2)
    expect(await log.countLoadsBySkill('s1', 'other')).toBe(0)
  })
})

describe('SkillConsumptionReceiptService', () => {
  it('reflects a changed SKILL.md into a different revision hash', async () => {
    const root = await tempSkillRoot(PILOT_SKILL_ID)
    const v1 = await computeSkillPackageRevision(root, PILOT_SKILL_ID)
    await writeFile(join(root, PILOT_SKILL_ID, 'SKILL.md'), '# changed')
    const v2 = await computeSkillPackageRevision(root, PILOT_SKILL_ID)
    expect(v1).not.toBe(v2)
    expect(v1).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('rejects unsupported skills in prepare', async () => {
    const root = await tempSkillRoot(PILOT_SKILL_ID)
    const svc = new SkillConsumptionReceiptService({ skillSourceRoot: root, auditLog: new InMemoryAuditLog() })
    const result = await svc.prepare('other-skill', scope)
    expect(result).toEqual({ ok: false, reason: 'skill_unsupported' })
  })

  it('verifies then records an applied receipt once', async () => {
    const root = await tempSkillRoot(PILOT_SKILL_ID)
    const audit = new InMemoryAuditLog()
    const svc = new SkillConsumptionReceiptService({ skillSourceRoot: root, auditLog: audit, secret: Buffer.alloc(32, 1) })
    const prepared = await svc.prepare(PILOT_SKILL_ID, scope)
    if (!prepared.ok) throw new Error('prepare failed')
    const verified = await svc.verifyPrepared(prepared.preparation.handle, scope, WORKSPACE_NAVIGATOR_CONSUMER_ID)
    expect(verified.ok).toBe(true)

    const recorded = await svc.recordApplied({
      handle: prepared.preparation.handle,
      scope,
      outcome: { kind: 'workspace_navigation_delivery.v1', deliveryStatus: 'applied' },
    })
    if (!recorded.ok) throw new Error('record failed')
    expect(recorded.receipt.consumption).toBe('applied')
    expect(recorded.receipt.receiptId).toBeTruthy()
    expect(audit.events).toHaveLength(1)

    // Replay is rejected: already_consumed.
    const again = await svc.recordApplied({
      handle: prepared.preparation.handle,
      scope,
      outcome: { kind: 'workspace_navigation_delivery.v1', deliveryStatus: 'applied' },
    })
    expect(again).toEqual({ ok: false, reason: 'already_consumed' })
  })

  it('rejects expired handles', async () => {
    const root = await tempSkillRoot(PILOT_SKILL_ID)
    const audit = new InMemoryAuditLog()
    const secret = Buffer.alloc(32, 7)
    const now = 1_000_000
    const svc = new SkillConsumptionReceiptService({ skillSourceRoot: root, auditLog: audit, secret, now: () => now, ttlMs: 100 })
    const prepared = await svc.prepare(PILOT_SKILL_ID, scope)
    if (!prepared.ok) throw new Error('prepare failed')
    // advance clock past expiry with the same secret
    const late = new SkillConsumptionReceiptService({ skillSourceRoot: root, auditLog: audit, secret, now: () => now + 200, ttlMs: 100 })
    const verified = await late.verifyPrepared(prepared.preparation.handle, scope, WORKSPACE_NAVIGATOR_CONSUMER_ID)
    expect(verified).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects scope mismatch', async () => {
    const root = await tempSkillRoot(PILOT_SKILL_ID)
    const audit = new InMemoryAuditLog()
    const svc = new SkillConsumptionReceiptService({ skillSourceRoot: root, auditLog: audit })
    const prepared = await svc.prepare(PILOT_SKILL_ID, scope)
    if (!prepared.ok) throw new Error('prepare failed')
    const verified = await svc.verifyPrepared(prepared.preparation.handle, { ...scope, threadId: 'other' }, WORKSPACE_NAVIGATOR_CONSUMER_ID)
    expect(verified).toEqual({ ok: false, reason: 'scope_mismatch' })
  })

  it('rejects invalid handle', async () => {
    const root = await tempSkillRoot(PILOT_SKILL_ID)
    const svc = new SkillConsumptionReceiptService({ skillSourceRoot: root, auditLog: new InMemoryAuditLog() })
    const verified = await svc.verifyPrepared('garbage', scope, WORKSPACE_NAVIGATOR_CONSUMER_ID)
    expect(verified).toEqual({ ok: false, reason: 'invalid_handle' })
  })
})
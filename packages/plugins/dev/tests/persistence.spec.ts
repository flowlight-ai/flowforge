/**
 * Instance persistence contract suite (EP0-3 T0.3.6): the state contract —
 * `docs/process/instances/<name>.json` — is what lets any AI tool resume a
 * process after a tool/model/session switch (33-stage §1 / §5).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { InstanceStore, InstanceStoreError, instancesDir } from '../src/persistence.ts'
import { ForgeProcessStateMachine } from '../src/state-machine.ts'

const repoRoot = mkdtempSync(join(tmpdir(), 'ff-dev-persistence-'))

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

function walkToImplement(machine: ForgeProcessStateMachine): void {
  machine.advance() // requirement → design
  machine.approveDesign(join('docs', 'process', 'specs', 'demo-design.md'))
  machine.advance() // → plan
  machine.validatePlan(join('docs', 'process', 'plans', 'demo-plan.md'))
  machine.advance() // → implement
}

describe('InstanceStore — 状态契约读写', () => {
  it('saves and reloads an instance with the workflow kind intact', () => {
    const store = new InstanceStore(repoRoot)
    const machine = new ForgeProcessStateMachine({ name: 'demo' })
    walkToImplement(machine)
    const savedPath = store.saveMachine('demo', 'feature', machine, () => new Date('2026-09-07T00:00:00Z'))

    expect(savedPath).toBe(join(instancesDir(repoRoot), 'demo.json'))
    const reloaded = store.loadOrThrow('demo')
    expect(reloaded.workflow).toBe('feature')
    expect(reloaded.schemaVersion).toBe(1)
    expect(reloaded.snapshot.phase).toBe('implement')
    expect(reloaded.snapshot.gates.planValidated).toBe(true)
    expect(reloaded.updatedAt).toBe('2026-09-07T00:00:00.000Z')
  })

  it('restores a live machine that keeps advancing (换会话接续)', () => {
    const store = new InstanceStore(repoRoot)
    const reloaded = store.loadOrThrow('demo')
    const machine = store.restoreMachine(reloaded)
    expect(machine.advance().phase).toBe('review')
    store.saveMachine('demo', 'feature', machine)
  })

  it('lists instances and filters active ones', () => {
    const store = new InstanceStore(repoRoot)
    store.saveMachine('finished', 'hotfix', new ForgeProcessStateMachine({ name: 'finished' }))
    const finished = store.restoreMachine(store.loadOrThrow('finished')!)
    finished.advance() // requirement → design
    finished.approveDesign('docs/process/specs/finished.md')
    finished.advance() // → plan
    finished.validatePlan('docs/process/plans/finished.md')
    finished.advance() // → implement
    finished.advance() // → review
    finished.advance() // → verify
    finished.recordVerification('docs/process/verifications/finished.md')
    finished.advance() // → finish
    store.saveMachine('finished', 'hotfix', finished)

    expect(store.list().map(instance => instance.name).sort()).toEqual(['demo', 'finished'])
    expect(store.active().map(instance => instance.name)).toEqual(['demo'])
    expect(store.load('missing')).toBeUndefined()
    expect(() => store.loadOrThrow('missing')).toThrow(InstanceStoreError)
  })
})

describe('InstanceStore — 损坏状态拒绝', () => {
  it('rejects invalid JSON with a hard error', () => {
    const store = new InstanceStore(repoRoot)
    writeFileSync(store.pathOf('broken'), '{ not json', 'utf8')
    expect(() => store.loadOrThrow('broken')).toThrow(/not valid JSON/)
  })

  it('rejects an unknown workflow kind at load time (typo 防线)', () => {
    const store = new InstanceStore(repoRoot)
    const machine = new ForgeProcessStateMachine({ name: 'typo' })
    writeFileSync(
      store.pathOf('typo'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'typo',
        workflow: 'features',
        snapshot: machine.snapshot(),
        updatedAt: '2026-09-07T00:00:00.000Z',
      }),
      'utf8',
    )
    expect(() => store.loadOrThrow('typo')).toThrow(/unknown workflow kind 'features'/)
  })

  it('rejects an invalid schema shape', () => {
    const store = new InstanceStore(repoRoot)
    writeFileSync(store.pathOf('bad-schema'), JSON.stringify({ nope: true }), 'utf8')
    expect(() => store.loadOrThrow('bad-schema')).toThrow(/invalid schema/)
  })
})

import { describe, it, expect } from 'vitest'
import { InMemoryDesktopBridge } from '../src/bridge.ts'
import type { BridgeContractPersistence } from '../src/bridge/contract.ts'
import { DesktopInvariantViolation, invariantBoolean, invariantUpdateAction, invariantVersion } from '../src/bridge/invariant.ts'

/** A memory-backed persistence double for the bridge contract. */
class MemoryPersistence implements BridgeContractPersistence {
  autoCheck = false
  async readSettings() {
    return { autoCheck: this.autoCheck }
  }
  async setAutoCheck(enabled: boolean) {
    this.autoCheck = enabled
  }
}

/** Unit tests for the desktop bridge bus. */
describe('InMemoryDesktopBridge', () => {
  it('delivers splash-status messages to subscribers and unsubscribes', () => {
    const bridge = new InMemoryDesktopBridge(new MemoryPersistence())
    const received: string[] = []
    const unsubscribe = bridge.onStatus(message => received.push(message.message))
    bridge.emitStatus({ message: 'starting-backend' })
    bridge.emitStatus({ message: 'ready' })
    expect(received).toEqual(['starting-backend', 'ready'])
    unsubscribe()
    bridge.emitStatus({ message: 'ignored' })
    expect(received).toEqual(['starting-backend', 'ready'])
  })

  it('delivers update prompts and progress to subscribers', () => {
    const bridge = new InMemoryDesktopBridge(new MemoryPersistence())
    const prompts: number[] = []
    const progress: number[] = []
    bridge.onUpdatePrompt(prompt => prompts.push(prompt.version.length))
    bridge.onUpdateProgress(p => progress.push(p.transferred))
    bridge.emitUpdatePrompt({ version: '1.0.0', autoCheck: true })
    bridge.emitUpdatePrompt({ version: '2.0.0', autoCheck: true })
    bridge.emitUpdateProgress({ total: 100, transferred: 30 })
    expect(prompts).toEqual([5, 5])
    expect(progress).toEqual([30])
  })

  it('persists auto-check preference through injected persistence', async () => {
    const memory = new MemoryPersistence()
    const bridge = new InMemoryDesktopBridge(memory)
    expect((await bridge.getUpdateSettings()).autoCheck).toBe(false)
    await bridge.setUpdateAutoCheck(true)
    expect((await bridge.getUpdateSettings()).autoCheck).toBe(true)
  })

  it('records validated update actions and rejects invalid ones', () => {
    const bridge = new InMemoryDesktopBridge(new MemoryPersistence())
    bridge.sendUpdatePromptAction('later', '1.0.0')
    bridge.sendUpdatePromptAction('download', '2.1.3')
    expect(bridge.recordedActions()).toEqual([
      { action: 'later', version: '1.0.0' },
      { action: 'download', version: '2.1.3' },
    ])
    expect(() => bridge.sendUpdatePromptAction('bogus', '1.0.0')).toThrow(DesktopInvariantViolation)
    expect(() => bridge.sendUpdatePromptAction('install', '')).toThrow(DesktopInvariantViolation)
  })
})

/** Unit tests for update-action and version invariants. */
describe('desktop bridge invariants', () => {
  it('accepts every documented update action', () => {
    for (const action of ['download', 'install', 'later', 'skip', 'open-release', 'dismiss']) {
      expect(invariantUpdateAction(action)).toBe(action)
    }
  })

  it('rejects an unknown action', () => {
    expect(() => invariantUpdateAction('upgrade')).toThrow(DesktopInvariantViolation)
  })

  it('rejects a non-string action', () => {
    expect(() => invariantUpdateAction(42)).toThrow(DesktopInvariantViolation)
  })

  it('accepts a non-empty trimmed version', () => {
    expect(invariantVersion(' 1.0.0 ')).toBe(' 1.0.0 ')
  })

  it('rejects empty or blank versions', () => {
    expect(() => invariantVersion('')).toThrow(DesktopInvariantViolation)
    expect(() => invariantVersion('   ')).toThrow(DesktopInvariantViolation)
  })

  it('enforces boolean typing for auto-check', () => {
    expect(invariantBoolean(true)).toBe(true)
    expect(invariantBoolean(false)).toBe(false)
    expect(() => invariantBoolean('yes')).toThrow(DesktopInvariantViolation)
  })
})
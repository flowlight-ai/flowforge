import { describe, it, expect } from 'vitest'
import { resolveDesktopConfig } from '../src/config.ts'
import { DesktopShellOrchestrator } from '../src/shell.ts'
import type { BackendSpawner, DesktopConfig, ReadinessProbe } from '../src/shell.ts'
import type { BridgeContractPersistence } from '../src/bridge/contract.ts'

/** A fake persistence double reused across shell tests. */
class FakePersistence implements BridgeContractPersistence {
  async readSettings() {
    return { autoCheck: false }
  }
  async setAutoCheck() {}
}

/** A config with a tiny probe budget so timeouts are fast in tests. */
function fastConfig(overrides: Partial<DesktopConfig> = {}): DesktopConfig {
  return {
    ...resolveDesktopConfig({}),
    apiProbeTimeoutMs: 80,
    apiProbeIntervalMs: 10,
    ...overrides,
  }
}

/** A fake spawner that records lifecycle transitions. */
class FakeSpawner implements BackendSpawner {
  started = 0
  stopped = 0
  failStart: Error | null = null
  async start() {
    if (this.failStart !== null) throw this.failStart
    this.started += 1
  }
  async stop() {
    this.stopped += 1
  }
}

/** A probe that returns a scripted sequence of readiness answers. */
class ScriptedProbe implements ReadinessProbe {
  results: boolean[]
  calls = 0
  constructor(results: boolean[]) {
    this.results = results
  }
  async probe() {
    const value = this.results[Math.min(this.calls, this.results.length - 1)]
    this.calls += 1
    return value
  }
}

/** Unit tests for desktop shell orchestration. */
describe('DesktopShellOrchestrator', () => {
  it('starts the backend, waits for health, and exposes the resolved URLs', async () => {
    const spawner = new FakeSpawner()
    const probe = new ScriptedProbe([false, false, true])
    const config = fastConfig()
    const shell = new DesktopShellOrchestrator(config, new FakePersistence(), spawner, probe)

    const status: string[] = []
    shell.bridge.onStatus(message => status.push(message.message))

    const result = await shell.launch()

    expect(spawner.started).toBe(1)
    expect(probe.calls).toBeGreaterThanOrEqual(3)
    expect(result.healthy).toBe(true)
    expect(result.webUrl).toBe(config.webUrl)
    expect(result.apiUrl).toBe(config.apiUrl)
    expect(status).toContain('starting-backend')
    expect(status).toContain('backend-started')
    expect(status).toContain('ready')
  })

  it('surfaces healthy=false instead of throwing when readiness never arrives', async () => {
    const spawner = new FakeSpawner()
    const probe = new ScriptedProbe([false])
    const config = fastConfig({ apiProbeTimeoutMs: 60, apiProbeIntervalMs: 10 })
    const shell = new DesktopShellOrchestrator(config, new FakePersistence(), spawner, probe)

    const status: string[] = []
    shell.bridge.onStatus(message => status.push(message.message))

    const result = await shell.launch()

    expect(result.healthy).toBe(false)
    expect(status).toContain('degraded')
  })

  it('shutdown stops the backend and emits lifecycle status', async () => {
    const spawner = new FakeSpawner()
    const probe = new ScriptedProbe([true])
    const shell = new DesktopShellOrchestrator(fastConfig(), new FakePersistence(), spawner, probe)

    const status: string[] = []
    shell.bridge.onStatus(message => status.push(message.message))

    await shell.launch()
    await shell.shutdown()

    expect(spawner.stopped).toBe(1)
    expect(status).toContain('shutting-down')
    expect(status).toContain('stopped')
  })

  it('propagates a backend spawn failure', async () => {
    const spawner = new FakeSpawner()
    spawner.failStart = new Error('spawn failed')
    const probe = new ScriptedProbe([true])
    const shell = new DesktopShellOrchestrator(fastConfig(), new FakePersistence(), spawner, probe)

    await expect(shell.launch()).rejects.toThrow('spawn failed')
  })

  it('reads backend command from config and passes it through the spawner contract', async () => {
    let observedCommand = ''
    const config = fastConfig({ backendCommand: 'flowforge serve' })
    const spawner: BackendSpawner = {
      async start(cfg) {
        observedCommand = cfg.backendCommand
      },
      async stop() {},
    }
    const probe = new ScriptedProbe([true])
    const shell = new DesktopShellOrchestrator(config, new FakePersistence(), spawner, probe)
    await shell.launch()
    expect(observedCommand).toBe('flowforge serve')
  })
})
/**
 * Desktop shell orchestration — the host-side service lifecycle that sits in
 * front of the web frontend (port of clowder `desktop/main.js` orchestration
 * concerns: start the backend service set, wait for the API to become healthy,
 * then expose the resolved web URL). Transport and process-spawn are injected
 * so the orchestration policy is unit-testable without a real backend.
 * @module @flowforge/desktop/shell
 */

import type { DesktopConfig } from './config.ts'
import type { BridgeContractPersistence } from './bridge/contract.ts'
import { InMemoryDesktopBridge } from './bridge.ts'

/** The injected process-spawn entry a shell uses to start the backend. */
export interface BackendSpawner {
  start(config: DesktopConfig): Promise<unknown>
  stop(): Promise<void>
}

/** The injected HTTP readiness probe a shell uses to wait for the API. */
export interface ReadinessProbe {
  probe(url: string): Promise<boolean>
}

/** Outcome of {@link DesktopShellOrchestrator.launch}. */
export interface DesktopLaunchResult {
  /** Resolved web URL the renderer should load. */
  webUrl: string
  /** Resolved API probe URL. */
  apiUrl: string
  /** Whether the backend reached readiness (false = timeout with health degraded). */
  healthy: boolean
}

/**
 * Host-side desktop shell policy, framework-agnostic. Owns the bridge and a
 * best-effort backend lifecycle; readiness and spawn are injected dependencies,
 * so a unit test exercises the orchestration with fakes and a production
 * Electron host wires real IPC + child-process spawn.
 */
export class DesktopShellOrchestrator {
  readonly bridge: InMemoryDesktopBridge

  constructor(
    private readonly config: DesktopConfig,
    persistence: BridgeContractPersistence,
    private readonly backend: BackendSpawner,
    private readonly probe: ReadinessProbe,
  ) {
    this.bridge = new InMemoryDesktopBridge(persistence)
  }

  /**
   * Start the backend, poll the API until healthy (or the probe budget is
   * exhausted), and return the resolved launch coordinates. Never throws on a
   * degraded readiness probe — the shell surfaces `healthy:false` so the
   * renderer still gets a useful error instead of a blank window.
   */
  async launch(): Promise<DesktopLaunchResult> {
    this.bridge.emitStatus({ message: 'starting-backend' })
    await this.backend.start(this.config)
    this.bridge.emitStatus({ message: 'backend-started' })

    const healthy = await this.pollUntilHealthy(this.config.apiUrl, this.config)
    this.bridge.emitStatus({ message: healthy ? 'ready' : 'degraded' })
    return { webUrl: this.config.webUrl, apiUrl: this.config.apiUrl, healthy }
  }

  /** Stop the backend service set, emitting a trailing status message. */
  async shutdown(): Promise<void> {
    this.bridge.emitStatus({ message: 'shutting-down' })
    await this.backend.stop()
    this.bridge.emitStatus({ message: 'stopped' })
  }

  /** Probe the API at an interval until ready or the wall-clock budget lapses. */
  private async pollUntilHealthy(url: string, config: DesktopConfig): Promise<boolean> {
    const deadline = Date.now() + config.apiProbeTimeoutMs
    for (;;) {
      if (await this.probe.probe(url)) return true
      if (Date.now() >= deadline) return false
      await sleep(config.apiProbeIntervalMs)
    }
  }
}

/** Resolve after `ms` milliseconds (util.promisify-safe). */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
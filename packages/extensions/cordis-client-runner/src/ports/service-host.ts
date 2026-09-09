/**
 * Service-host seam + real in-memory implementation.
 *
 * Stands in for everything a dynamic package's `apply` needed from the cordis
 * Context root: `ctx.get(name)` (optional service lookup — the only wire to a
 * platform service other than the guarded slots seat), `ctx.provide` and
 * `ctx.effect` (fiber-owned disposer registration) and the fiber's declared
 * `inject` list (the guard's declaration gate). The guard wraps this host in a
 * whitelisting Proxy; the runner probes it for parked-detection; providers read
 * live services through it.
 *
 * Per the seam pattern: a port interface + a real memory implementation, no
 * mocks.
 *
 * @module @flowforge/cordis-client-runner/ports/service-host
 */

/** The minimal "real context" surface a dynamic package can reach. */
export interface ServiceHostPort {
  /**
   * Optional service lookup (never throws for an absent service).
   * @param name - service key.
   */
  get<T = unknown>(name: string): T | undefined
  /**
   * Register a service.
   * @param name - service key.
   * @param value - service instance.
   * @returns disposer removing the service.
   */
  provide<T>(name: string, value: T): () => void
  /**
   * Register a fiber-owned disposer.
   * @param dispose - teardown to run on context disposal.
   * @param label - diagnostic label.
   * @returns disposer cancelling this registration.
   */
  registerEffect(dispose: () => void, label?: string): () => void
  /** The services the current plugin declared in its `inject`. */
  declaredServices(): ReadonlySet<string>
  /** Replace the current plugin's declared service set. */
  setDeclaredServices(names: readonly string[]): void
  /** Prune every registered effect (context disposal path). */
  disposeEffects(): void
}

/** Real in-memory service host: services map + effect set + declared injects. */
export class MemoryServiceHost implements ServiceHostPort {
  private readonly services = new Map<string, unknown>()
  private readonly effects = new Set<() => void>()
  private readonly declared = new Set<string>()

  get<T = unknown>(name: string): T | undefined {
    return this.services.get(name) as T | undefined
  }

  provide<T>(name: string, value: T): () => void {
    this.services.set(name, value)
    return (): void => { this.services.delete(name) }
  }

  registerEffect(dispose: () => void, _label?: string): () => void {
    this.effects.add(dispose)
    return (): void => { this.effects.delete(dispose) }
  }

  declaredServices(): ReadonlySet<string> {
    return this.declared
  }

  setDeclaredServices(names: readonly string[]): void {
    this.declared.clear()
    for (const name of names) this.declared.add(name)
  }

  disposeEffects(): void {
    for (const dispose of [...this.effects]) dispose()
    this.effects.clear()
  }
}

/** Convenience constructor. */
export function createMemoryServiceHost(): MemoryServiceHost {
  return new MemoryServiceHost()
}

export default MemoryServiceHost
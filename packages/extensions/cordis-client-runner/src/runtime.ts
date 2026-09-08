/**
 * Per-package browser lifecycle (seam port of the dsh `runtime.ts` client half):
 * evaluate the closure, wrap `apply` in the guard facade, seat a ready-made
 * factory in the module table, and create a loader entry — so dynamic packages
 * ride the same machinery static plugins do (activation gating on inject,
 * fiber-effect cleanup, status projection). Unload = loader entry removal
 * (fiber disposal cascades slot entries and facade effects) + factory
 * invalidation + style removal.
 *
 * The engine answers its caller: `load` resolves with what this page ended up
 * with, which is what the run orchestration reports back to the host. Loads
 * converge by Plugin Run ID against live state, not history. Per-Plugin
 * serialization keeps a second request from interleaving with one in flight.
 *
 * Cordis and dsh infrastructure is absent by design: `ClientSlotsPort`,
 * `ServiceHostPort` and `LoaderModulesPort` are the package-local injected
 * seams standing in for `SlotRegistry`, `Context` and the loader/module system;
 * `DynamicCordisStyles` writes through the style-document seam.
 *
 * @module @flowforge/cordis-client-runner/runtime
 */

import { DYNAMIC_CLIENT_REDIRECTS, messages } from './messages.ts'
import { DynamicCordisStyles, evaluateClientHalf } from './evaluator.ts'
import type { DynamicCordisEvaluatedPlugin } from './evaluator.ts'
import { dynamicCordisContext, cordisViewKey } from './guard.ts'
import type { DynamicCordisGuardEnv, DynamicCordisSlotLedgerRow } from './guard.ts'
import type {
  CordisDynamicPackageId, CordisDynamicPluginId,
  CordisDynamicPluginRunId, DynamicCordisPackage, SessionId,
} from './types.ts'
import type { ClientSlotsPort } from './ports/slots.ts'
import type { ServiceHostPort } from './ports/service-host.ts'
import type { StyleDocumentPort } from './ports/style.ts'
import type { LoaderModulesPort } from './ports/loader-modules.ts'

/** Snapshot source a surface can subscribe to (the render seam's observable shape). */
export interface CordisObservable<T> {
  /** Current value; the reference is stable between mutations. */
  getSnapshot(): T
  /** Observe mutations; returns unsubscribe. */
  subscribe(fn: () => void): () => void
}

/** Which stage of a load failed, as the page classified it. */
export type DynamicCordisLoadErrorCause = 'evaluate' | 'module-import' | 'activate'

/** Error fields retained by the page runner and Host transport. */
export interface CordisErrorDetails {
  /** Original error message. */
  message: string
  /** Original stack when the thrown value supplied one. */
  stack?: string
}

/** One package's browser half as the host handed it over. */
export interface DynamicCordisClientHalf {
  /** Stable Plugin instance. */
  pluginId: CordisDynamicPluginId
  /** Immutable Package source version. */
  packageId: CordisDynamicPackageId
  /** Exact activation. */
  pluginRunId: CordisDynamicPluginRunId
  /** Session the run is carried out for; a later render failure is reported under it. */
  agentId: SessionId
  /** Label from the define call; also the plugin name. */
  name: string
  /** Browser-half source: an async function body returning a plugin. */
  code: string
}

/**
 * One render-time crash of a dynamic package's slot entry, as this page reports
 * it. Post-settle diagnosis only.
 */
export interface DynamicCordisRenderFailure {
  /** Slot key the crashed entry rendered under. */
  slot: string
  /** Crash text plus (for a withheld global) its redirect. */
  message: string
  /** Original render failure stack when available. */
  stack?: string
  /** Whether the crash retired the entry from its cell. */
  abdicated: boolean
}

/**
 * What this page ended up with. A parked package is a success — the browser
 * half settled and waits on declared services this page has not got.
 */
export type DynamicCordisLoadResult =
  | { ok: true; pluginRunId: CordisDynamicPluginRunId; waitingFor?: string[] }
  | ({ ok: false; cause: DynamicCordisLoadErrorCause; error?: unknown } & CordisErrorDetails)

/** One live package's bookkeeping. */
interface LivePackage {
  pkg: DynamicCordisPackage
  entryId: string
  styles: DynamicCordisStyles
  ledger: DynamicCordisSlotLedgerRow[]
  /** Services the browser half declared and this page has not got (parked, still a success). */
  waitingFor: string[]
}

/** Runner dependencies, resolved by the plugin entry at activation. */
export interface DynamicCordisRunnerEnv {
  /** Package-local service host (the page's minimal "real context" stand-in). */
  host: ServiceHostPort
  /** Slot registry seam: entry-crash supervision + the guarded register seat. */
  slots: ClientSlotsPort
  /** Loader/module-table seam: dynamic packages become entries under it. */
  loader: LoaderModulesPort
  /** Style-document seam `DynamicCordisStyles` writes tags through. */
  styleDocument: StyleDocumentPort
  /** Route one `host.call` to the package's host half. */
  invoke(
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    method: string,
    args: unknown,
  ): Promise<unknown>
  /** Send one render-time crash back to the session that authored the package. */
  reportRenderFailure(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: DynamicCordisRenderFailure,
  ): void
  /** Send one post-activation Client guard rejection to the owning Agent. */
  reportGuardFailure(
    agentId: SessionId,
    pluginId: CordisDynamicPluginId,
    pluginRunId: CordisDynamicPluginRunId,
    failure: CordisErrorDetails,
  ): void
}

/** Module-table id of one package (also its loader entry name and fiber name). */
function moduleIdOf(id: CordisDynamicPluginId): string {
  return `dyn/${id}`
}

/** One live package's contribution summary in this page. */
export interface DynamicCordisLivePackage {
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  pluginRunId: CordisDynamicPluginRunId
  name: string
  /** Slot names this package registered into here. */
  slots: string[]
  /** Live injected-style tag count. */
  styleCount: number
}

/** The browser-side load engine for dynamic packages. */
export class DynamicCordisPackageRunner {
  private readonly live = new Map<CordisDynamicPluginId, LivePackage>()
  private readonly queues = new Map<CordisDynamicPluginId, Promise<unknown>>()
  private readonly changeListeners = new Set<() => void>()
  /** Page-local shadowing rank. A later registration receives a lower priority. */
  private nextPriority = 0
  /**
   * Which package seated which component, and for whom. Component identity is
   * the only attribution key that holds a crash back to its owner.
   */
  private readonly owners = new WeakMap<object, {
    pluginId: CordisDynamicPluginId
    pluginRunId: CordisDynamicPluginRunId
    agentId: SessionId
  }>()
  /** This page's last render crash per package. */
  private readonly failures = new Map<CordisDynamicPluginId, DynamicCordisRenderFailure>()
  private readonly unwatch: () => void
  private snapshotCache: readonly DynamicCordisLivePackage[] | undefined
  private failureCache: ReadonlyMap<CordisDynamicPluginId, DynamicCordisRenderFailure> | undefined

  /** @param env - loader/module/slot wiring plus the two host verbs this engine uses. */
  constructor(private readonly env: DynamicCordisRunnerEnv) {
    // The supervision seam fires for EVERY entry crash on the page, factory UI
    // included; only the ones this runner seated are ours to report.
    this.unwatch = env.slots.onEntryError((slot, entry, error, info) => {
      if (!indexable(entry.component)) return
      const owner = this.owners.get(entry.component)
      if (owner === undefined) return
      const details = errorDetails(error)
      const failure: DynamicCordisRenderFailure = {
        slot,
        message: renderFailureMessage(slot, details.message),
        ...details.stack === undefined ? {} : { stack: details.stack },
        abdicated: info.abdicated,
      }
      // One observation, two outlets with different owners and lifetimes: the
      // host keeps the last crash ACROSS pages; this map is what THIS page shows.
      env.reportRenderFailure(owner.agentId, owner.pluginId, owner.pluginRunId, failure)
      this.failures.set(owner.pluginId, failure)
      this.notify()
    })
  }

  /** Observe live-set changes (the run-state surface's re-render seam). */
  subscribe(fn: () => void): () => void {
    this.changeListeners.add(fn)
    return () => { this.changeListeners.delete(fn) }
  }

  /** This page's last render crash per package, on the same notification channel as the live set. */
  readonly renderFailures: CordisObservable<ReadonlyMap<CordisDynamicPluginId, DynamicCordisRenderFailure>> = {
    getSnapshot: () => this.failureCache ??= new Map(this.failures),
    subscribe: fn => this.subscribe(fn),
  }

  /** What this page currently has loaded (stable reference between mutations). */
  getSnapshot(): readonly DynamicCordisLivePackage[] {
    return this.snapshotCache ??= [...this.live.values()].map(({ pkg, ledger, styles }) => ({
      pluginId: pkg.pluginId,
      packageId: pkg.packageId,
      pluginRunId: pkg.pluginRunId,
      name: pkg.name,
      slots: [...new Set(ledger.map(row => row.slot))],
      styleCount: styles.count,
    }))
  }

  /** Whether this page has the browser half loaded — page-local truth, never the host's. */
  isLoaded(pluginId: CordisDynamicPluginId): boolean {
    return this.live.has(pluginId)
  }

  /** Load one browser half into this page and answer what happened. */
  load(half: DynamicCordisClientHalf): Promise<DynamicCordisLoadResult> {
    return this.enqueue(half.pluginId, async () => {
      const current = this.live.get(half.pluginId)
      if (current !== undefined) {
        if (current.pkg.pluginRunId === half.pluginRunId) return settled(current)
        await this.teardown(current.pkg.pluginId, current.entryId, current.styles)
      }
      const result = await this.mount(half)
      this.notify()
      return result
    })
  }

  /** Unload one package (`cordis/dynamic-retract`: a stop, or an undefine that stops first). */
  retract(pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId): void {
    void this.enqueue(pluginId, async () => {
      const current = this.live.get(pluginId)
      if (current === undefined || current.pkg.pluginRunId !== pluginRunId) return
      await this.teardown(pluginId, current.entryId, current.styles)
      this.notify()
    })
  }

  /** Unload everything (plugin disposal path). */
  async dispose(): Promise<void> {
    this.unwatch()
    for (const current of [...this.live.values()]) {
      await this.teardown(current.pkg.pluginId, current.entryId, current.styles)
    }
    this.notify()
  }

  private notify(): void {
    this.snapshotCache = undefined
    this.failureCache = undefined
    for (const fn of [...this.changeListeners]) fn()
  }

  /** Queue one package operation behind that package's previous ones. */
  private enqueue<T>(id: CordisDynamicPluginId, op: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.then(op)
    this.queues.set(id, next.then(() => {}, () => {}))
    return next
  }

  private async mount(half: DynamicCordisClientHalf): Promise<DynamicCordisLoadResult> {
    const styles = new DynamicCordisStyles(this.env.styleDocument, half.pluginId)
    const ledger: DynamicCordisSlotLedgerRow[] = []
    let plugin: DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown)
    try {
      plugin = await evaluateClientHalf(half.pluginId, half.code, {
        invoke: (method, args) => this.env.invoke(half.pluginId, half.pluginRunId, method, args),
        noteError: (message) => {
          console.error(`[cordis-client-runner] ${half.pluginId} logged an error:`, message)
        },
      }, styles)
    } catch (error) {
      styles.dispose()
      return { ok: false, cause: 'evaluate', ...errorDetails(error), error }
    }

    const pkg: DynamicCordisPackage = {
      pluginId: half.pluginId,
      packageId: half.packageId,
      pluginRunId: half.pluginRunId,
      name: half.name,
    }
    const surface = this.guardedSurface(pkg, half.agentId, plugin, ledger)
    const moduleId = moduleIdOf(half.pluginId)
    // Invalidate-then-register keeps re-loading legal: the module table throws
    // loudly on a duplicate factory registration.
    this.env.loader.invalidateModule(moduleId)
    this.env.loader.registerModule(moduleId, () => surface)

    const entryId = await this.env.loader.createEntry(moduleId)
    const fiber = this.env.loader.fiberOf(entryId)
    if (fiber === undefined) {
      await this.teardown(half.pluginId, entryId, styles)
      return { ok: false, cause: 'module-import', message: messages.moduleImportFailed() }
    }
    try {
      await fiber.await()
    } catch (error) {
      await this.teardown(half.pluginId, entryId, styles)
      return { ok: false, cause: 'activate', ...errorDetails(error), error }
    }
    const waitingFor = Object.keys(fiber.inject).filter(name => this.env.host.get(name) === undefined)
    const record: LivePackage = { pkg, entryId, styles, ledger, waitingFor }
    this.live.set(half.pluginId, record)
    this.failures.delete(half.pluginId)
    return settled(record)
  }

  /**
   * Wrap the evaluated plugin so `apply` sees the guard facade; the surface
   * doubles as the module-table module. The plugin's OWN `inject` survives (the
   * object form's declaration is the facade's service gate).
   */
  private guardedSurface(
    pkg: DynamicCordisPackage,
    agentId: SessionId,
    plugin: DynamicCordisEvaluatedPlugin | ((ctx: unknown) => unknown),
    ledger: DynamicCordisSlotLedgerRow[],
  ): DynamicCordisEvaluatedPlugin {
    const claim = (component: unknown): void => {
      if (indexable(component)) {
        this.owners.set(component, { pluginId: pkg.pluginId, pluginRunId: pkg.pluginRunId, agentId })
      }
    }
    const guardEnv: DynamicCordisGuardEnv = {
      pkg,
      ledger,
      claim,
      allocatePriority: () => --this.nextPriority,
      reportFailure: (error) => {
        this.env.reportGuardFailure(agentId, pkg.pluginId, pkg.pluginRunId, errorDetails(error))
      },
      bindCordisViewKey: () => cordisViewKey(pkg.pluginId, pkg.packageId),
    }
    const guardedCtx = dynamicCordisContext(this.env.host, guardEnv)
    if (typeof plugin === 'function') {
      return { name: moduleIdOf(pkg.pluginId), apply: () => plugin(guardedCtx) }
    }
    return {
      ...plugin,
      name: moduleIdOf(pkg.pluginId),
      apply: (_ctx, config?: unknown) => plugin.apply(guardedCtx, config),
    }
  }

  /** Unload one package's contributions. */
  private async teardown(
    id: CordisDynamicPluginId,
    entryId: string,
    styles: DynamicCordisStyles,
  ): Promise<void> {
    this.live.delete(id)
    this.failures.delete(id)
    await this.env.loader.removeEntry(entryId)
    this.env.loader.invalidateModule(moduleIdOf(id))
    styles.dispose()
  }
}

/** The success answer for a package that is live here, parked or active. */
function settled(record: { pkg: DynamicCordisPackage; waitingFor: string[] }): DynamicCordisLoadResult {
  return {
    ok: true,
    pluginRunId: record.pkg.pluginRunId,
    ...record.waitingFor.length > 0 ? { waitingFor: record.waitingFor } : {},
  }
}

/** Whether a component can key the ownership index. */
function indexable(component: unknown): component is object {
  return typeof component === 'object' && component !== null || typeof component === 'function'
}

/** Preserve error fields for a load result without fabricating a stack. */
export function errorDetails(error: unknown): CordisErrorDetails {
  if (typeof error !== 'object' || error === null) return { message: String(error) }
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message
    : Object.prototype.toString.call(error)
  const stack = 'stack' in error && typeof error.stack === 'string' ? error.stack : undefined
  return { message, ...stack === undefined ? {} : { stack } }
}

/**
 * What the authoring session reads about one render crash: the slot name, the
 * crash text, and (when it names a withheld global) the redirect that teaches
 * how to reach the replacement safely.
 */
function renderFailureMessage(slot: string, message: string): string {
  const redirect = Object.entries(DYNAMIC_CLIENT_REDIRECTS)
    .find(([name, text]) => message.includes(name) && !message.includes(text))?.[1]
  return `your entry in slot "${slot}" crashed while React rendered it: ${message}`
    + (redirect === undefined ? '' : `\n${redirect}`)
}
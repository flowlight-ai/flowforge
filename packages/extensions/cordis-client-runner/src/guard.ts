/**
 * The browser twin of the tool-cordis context facade: a whitelist of
 * lifecycle-safe verbs plus optional `ctx.get()` lookup and declared-service
 * property access, with framework internals withheld and assignments denied.
 * Two seats carry extra machinery: `slots` (automatic shadowing priority,
 * ledger recording and the `tool.view.cordis` key binding) and `theme`
 * (override source pinned to the package id, disposer hung on the fiber).
 *
 * This is API discipline, not a security boundary: a dynamic package's code is
 * as trusted as the host process that accepted its definition.
 *
 * @module @flowforge/cordis-client-runner/guard
 */

import type { DynamicCordisPackage, CordisDynamicPluginId, CordisDynamicPackageId } from './types.ts'
import type { ClientSlotsPort } from './ports/slots.ts'
import type { ServiceHostPort } from './ports/service-host.ts'
import { messages } from './messages.ts'

/** Facade verbs beyond declared services. */
const CTX_VERBS = new Set([
  'effect', 'on', 'once', 'provide', 'timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce',
])
const TIMER_VERBS = new Set(['timeout', 'interval', 'setTimeout', 'setInterval', 'throttle', 'debounce'])

/** One package's slot-registration ledger row (contribution projection source). */
export interface DynamicCordisSlotLedgerRow {
  /** Target slot name. */
  slot: string
  /** The assigned shadowing priority (globally unique — how winners match back to packages). */
  priority?: number
}

/** What the facade needs beyond the real host to govern one package. */
export interface DynamicCordisGuardEnv {
  /** The dispatched Package row. */
  pkg: DynamicCordisPackage
  /** Ledger sink: every slot registration this package makes. */
  ledger: DynamicCordisSlotLedgerRow[]
  /**
   * Ownership index sink for a seated component.
   * @param component - whatever the package passed as its component.
   */
  claim(component: unknown): void
  /** Allocate one page-local shadowing rank; later registrations sort first. */
  allocatePriority(): number
  /** Report one post-activation guard rejection to the owning Agent. */
  reportFailure(error: Error): void
  /** The bound key for a `tool.view.cordis` self registration (`pluginId.packageId`). */
  bindCordisViewKey(): string
}

/** Erased register options as this facade reads and rewrites them. */
interface ErasedSlotOptions {
  name?: string
  key?: string
  priority?: number
  [option: string]: unknown
}

/**
 * The slots seat: automatic shadowing priority, ledger recording and the
 * `tool.view.cordis` key binding around the traced service's own register.
 * Registered method-call receivers stay on the real service so its internal
 * `this` (fiber routing) is preserved, mirroring SlotRegistry.register.
 */
function guardedSlots(slots: ClientSlotsPort, env: DynamicCordisGuardEnv): unknown {
  return new Proxy(slots, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown
      if (prop !== 'register') return value
      return (rawOptions: unknown, component: unknown): unknown => {
        if (typeof rawOptions !== 'object' || rawOptions === null) {
          return rejectGuard(env, messages.slotNeedsName())
        }
        const options = { ...rawOptions as ErasedSlotOptions }
        const slot = options.name
        if (typeof slot !== 'string' || slot.length === 0) {
          return rejectGuard(env, messages.slotNameRequired())
        }
        if (slot === 'tool.view.cordis') {
          if (options.key !== 'self') {
            return rejectGuard(env, messages.cordisSelfKeyOnly())
          }
          options.key = env.bindCordisViewKey()
        }
        const spec = slots.spec(slot)
        let priority = options.priority
        if (spec === undefined || spec.kind !== 'chain') {
          priority = env.allocatePriority()
          options.priority = priority
        }
        const register = Reflect.get(target, 'register', target) as unknown as (
          opts: object, comp: unknown) => () => void
        const dispose = register.call(target, options, component)
        const ledgerRow: DynamicCordisSlotLedgerRow = { slot }
        if (priority !== undefined) ledgerRow.priority = priority
        env.ledger.push(ledgerRow)
        // After the registry accepted it: a rejected registration seats no entry,
        // so claiming one would index a component no crash can ever name.
        env.claim(component)
        return dispose
      }
    },
  })
}

/**
 * The theme seat: `overrideTokens`' source is FORCED to the package id and its
 * disposer is hung on the calling fiber so unload restores by construction.
 */
function guardedTheme(theme: { overrideTokens(source: string, tokens: unknown): () => void }, env: DynamicCordisGuardEnv, host: ServiceHostPort): unknown {
  return new Proxy(theme, {
    get(target, prop) {
      if (prop !== 'overrideTokens') return Reflect.get(target, prop, target)
      return (source: unknown, tokens: unknown): unknown => {
        if (tokens === undefined && typeof source === 'object' && source !== null) {
          return rejectGuard(env, messages.themeTwoArgs())
        }
        const method = Reflect.get(target, 'overrideTokens', target)
        const dispose = Reflect.apply(method, target, [env.bindCordisViewKey(), tokens]) as () => void
        // Fiber-owned lifetime; the returned handle stays valid for early removal.
        host.registerEffect(() => { dispose() }, 'cordis-client-runner: dynamic theme override layer')
        return dispose
      }
    },
  })
}

/**
 * Build the facade one dynamic plugin's `apply` receives. `ctx.get(name)`
 * performs optional lookup; direct `ctx.serviceName` access is gated by the
 * fiber's `inject` declaration; verbs are whitelisted; assignments are denied.
 * @param host - the package-local service host standing in for the real ctx.
 * @param env - package row + ledger sink + attribution wiring.
 * @returns the whitelisting proxy standing in for ctx.
 */
export function dynamicCordisContext(host: ServiceHostPort, env: DynamicCordisGuardEnv): ServiceHostPort {
  const declared = host.declaredServices()
  const denyRead = (prop: string): never => {
    if (host.get(prop) !== undefined) return rejectGuard(env, messages.deniedService(prop))
    return rejectGuard(env, messages.deniedRead(prop))
  }
  const readService = (name: string, requireDeclaration: boolean): unknown => {
    if (requireDeclaration && !declared.has(name)) return denyRead(name)
    const service = host.get(name)
    if (service === null || (typeof service !== 'object' && typeof service !== 'function')) return service
    if (name === 'slots') return guardedSlots(host.get<ClientSlotsPort>('slots') as ClientSlotsPort, env)
    if (name === 'theme') {
      return guardedTheme(host.get<{ overrideTokens(source: string, tokens: unknown): () => void }>('theme')!, env, host)
    }
    return service
  }
  return new Proxy(host, {
    get(target, prop) {
      if (prop === 'get') return (name: string): unknown => readService(name, false)
      if (typeof prop !== 'string') return undefined
      if (CTX_VERBS.has(prop)) {
        return (...args: unknown[]): unknown => {
          if (TIMER_VERBS.has(prop) && !declared.has('timer')) return denyRead('timer')
          const method = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[prop]
          if (typeof method !== 'function') return rejectGuard(env, messages.deniedRead(prop))
          return Reflect.apply(method, target, args)
        }
      }
      if (prop === 'registerEffect') {
        return (dispose: () => void, label?: string): (() => void) => target.registerEffect(dispose, label)
      }
      if (prop === 'declaredServices' || prop === 'setDeclaredServices' || prop === 'disposeEffects' || prop === 'provide') {
        return (target as unknown as Record<string, unknown>)[prop]
      }
      return readService(prop, true)
    },
    set(_target, prop) {
      return rejectGuard(env, messages.readOnly(String(prop)))
    },
    has: (_target, prop) => prop === 'get'
      || (typeof prop === 'string'
        && ((CTX_VERBS.has(prop) && (!TIMER_VERBS.has(prop) || declared.has('timer'))) || declared.has(prop))),
  }) as unknown as ServiceHostPort
}

function rejectGuard(env: DynamicCordisGuardEnv, message: string): never {
  const error = new Error(message)
  env.reportFailure(error)
  throw error
}

/** Bound key builder shared by the runner and guard. */
export function cordisViewKey(pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId): string {
  return `${pluginId}.${packageId}`
}
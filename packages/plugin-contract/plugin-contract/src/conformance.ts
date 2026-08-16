/**
 * Conformance: does a candidate application plugin actually satisfy the
 * contract? Mapped from the upstream application contract's `conformance/runner` in
 * spirit — FlowForge plugins mount in-process through cordis, so the runner
 * checks structural shape, not a wire handshake:
 *
 * 1. the kernel contract (R13 six points): `apply` or plugin class,
 *    `inject` service list, optional schemastery `schema`;
 * 2. the application contract: a VALID manifest whose declared lifecycle
 *    hooks the plugin really exports, and routes that resolve cleanly under
 *    `/api/v2/<pluginId>`.
 *
 * The host runs this at assembly time; every failure names its rule.
 *
 * @module @flowforge/plugin-contract/conformance
 */

import type { AppLifecycleHookName, PluginManifest } from './manifest.ts'
import { resolveRouteMounts } from './routes.ts'
import { validateManifest } from './validation.ts'

/**
 * The kernel-contract surface a cordis plugin exposes (R13). Typed
 * structurally so this package does not depend on cordis internals.
 */
export interface KernelPluginShape {
  readonly apply?: (ctx: unknown) => unknown
  readonly inject?: readonly string[]
  readonly schema?: unknown
}

/** Candidate under conformance check: the plugin plus its shipped manifest. */
export interface AppPluginCandidate {
  /** The cordis plugin (function with statics, or a class). */
  readonly plugin: unknown
  /** The raw manifest shipped beside it (untrusted until validated). */
  readonly manifest: unknown
}

export interface ConformanceFailure {
  readonly rule: string
  readonly message: string
}

export type ConformanceResult =
  | { readonly conformant: true; readonly manifest: PluginManifest; readonly failures: readonly [] }
  | { readonly conformant: false; readonly failures: readonly ConformanceFailure[] }

function failure(rule: string, message: string): ConformanceFailure {
  return { rule, message }
}

function pluginShapeOf(plugin: unknown): KernelPluginShape | undefined {
  // A bare function or class IS its apply (cordis convention); an object
  // plugin must expose one explicitly.
  if (typeof plugin === 'function') return plugin as unknown as KernelPluginShape
  if (typeof plugin === 'object' && plugin !== null) return plugin as KernelPluginShape
  return undefined
}

/**
 * Check one candidate against the full contract. Never throws — every
 * violation lands in `failures`, so a host can report the whole picture.
 */
export function checkAppPluginConformance(candidate: AppPluginCandidate): ConformanceResult {
  const failures: ConformanceFailure[] = []

  // --- kernel contract (R13) ---
  const shape = pluginShapeOf(candidate.plugin)
  if (shape === undefined) {
    failures.push(failure('kernel.apply', 'plugin must be a function (apply) or a plugin class'))
  } else if (typeof candidate.plugin !== 'function' && typeof shape.apply !== 'function') {
    failures.push(failure('kernel.apply', 'object plugins must expose apply(ctx)'))
  }
  if (shape !== undefined && shape.inject !== undefined) {
    if (!Array.isArray(shape.inject) || shape.inject.some(service => typeof service !== 'string' || service.length === 0)) {
      failures.push(failure('kernel.inject', 'inject must be an array of ctx.* service names'))
    }
  }

  // --- application contract: manifest ---
  const validated = validateManifest(candidate.manifest)
  if (!validated.valid) {
    for (const manifestError of validated.errors) {
      failures.push(failure('manifest', `${manifestError.instancePath || '/'}: ${manifestError.message}`))
    }
    return { conformant: false, failures }
  }
  const manifest = validated.manifest

  // --- routes resolve under /api/v2/<pluginId> without collision ---
  try {
    resolveRouteMounts(manifest)
  } catch (routeFailure) {
    failures.push(failure('routes', routeFailure instanceof Error ? routeFailure.message : String(routeFailure)))
  }

  // --- declared lifecycle hooks must actually exist on the plugin ---
  const hookOwner = (candidate.plugin as { prototype?: Record<string, unknown> }).prototype ?? (candidate.plugin as Record<string, unknown>)
  for (const hook of manifest.lifecycle?.hooks ?? []) {
    const implemented = typeof (hookOwner as Record<string, unknown>)[hook] === 'function'
      || typeof (candidate.plugin as Record<string, unknown>)[hook] === 'function'
    if (!implemented) {
      failures.push(failure('lifecycle', `manifest declares hook "${hook}" but the plugin does not implement it`))
    }
  }

  if (failures.length > 0) return { conformant: false, failures }
  return { conformant: true, manifest, failures: [] }
}

/** Every hook name the contract recognizes (closed set, for host UIs). */
export const KNOWN_APP_HOOKS: readonly AppLifecycleHookName[] = ['onInstall', 'onEnable', 'onDisable', 'onUninstall', 'onBeforeShutdown']

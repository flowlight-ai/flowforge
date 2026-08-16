/**
 * Application-level lifecycle hooks: the layer ABOVE the cordis kernel
 * lifecycle. The kernel contract (R13) owns `created → ready → dispose`
 * through the Context; the application contract adds install/enable/disable
 * semantics the host marketplace needs (approval, credential binding, route
 * mounting), same-source by composition: an application plugin IS a cordis
 * plugin, and these hooks ride on top of it — never replace it.
 *
 * @module @flowforge/plugin-contract/lifecycle
 */

import type { CredentialRequirement } from './manifest.ts'

/** Resolved credentials handed to `onEnable`, keyed by requirement id. */
export type ResolvedCredentials = Readonly<Record<string, string>>

/** Host services an application hook may use; the host injects the real ones. */
export interface AppPluginHost {
  /** Resolve a declared credential requirement to its secret value. */
  resolveCredential(requirement: CredentialRequirement): Promise<string | undefined>
  /** Ask the user for approval; returns false when declined. */
  requestApproval(purpose: string): Promise<boolean>
}

/**
 * The application-level hook surface. Every hook is optional; the manifest
 * `lifecycle.hooks` declaration must match what the plugin actually exports
 * (conformance-checked).
 */
export interface AppLifecycleHooks {
  /** Runs once when the plugin is first installed (before any enable). */
  onInstall?(host: AppPluginHost): Promise<void> | void
  /** Runs when the user activates the plugin; routes mount after it resolves. */
  onEnable?(host: AppPluginHost, credentials: ResolvedCredentials): Promise<void> | void
  /** Runs when the user deactivates the plugin; routes unmount before it. */
  onDisable?(host: AppPluginHost): Promise<void> | void
  /** Runs before uninstall; declared `retained` data survives it. */
  onUninstall?(host: AppPluginHost): Promise<void> | void
  /** Runs during host shutdown, before the cordis dispose cascade. */
  onBeforeShutdown?(): Promise<void> | void
}

/** Ordered hook names the host drives — install/enable pair, then mirrors. */
export const APP_LIFECYCLE_ORDER = ['onInstall', 'onEnable', 'onDisable', 'onUninstall', 'onBeforeShutdown'] as const

/**
 * Kernel↔application lifecycle correspondence (same-source, R13):
 * cordis `created` ⟷ manifest install (declaration accepted), cordis `ready`
 * ⟷ `onEnable` settled, cordis `dispose` ⟷ `onDisable`/`onUninstall`
 * settled. Hosts use this table for diagnostics, never to skip a phase.
 */
export const LIFECYCLE_CORRESPONDENCE = {
  created: 'onInstall',
  ready: 'onEnable',
  dispose: 'onDisable',
} as const

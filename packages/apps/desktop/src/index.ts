/**
 * Desktop contract layer for the FlowForge host — the framework-agnostic
 * seam a desktop shell (Electron later, tests today) implements: externalized
 * config, a context-isolated bridge contract, package-local invariants, and a
 * host-side orchestration policy. Port of clowder `desktop/` (service
 * orchestrator + browser shell), contract-only with Electron integration
 * deferred so every branch is unit-testable without a desktop runtime.
 * @module @flowforge/desktop
 */

export { DESKTOP_CONFIG_ENV_KEYS, resolveDesktopConfig, normalizeDesktopRoot } from './config.ts'
export type { DesktopConfig } from './config.ts'
export {
  DEFAULT_API_BASE_PATH,
  DEFAULT_API_PORT,
  DEFAULT_BACKEND_COMMAND,
  DEFAULT_HOST,
  DEFAULT_WEB_PORT,
} from './config.ts'

export { BRIDGE_CHANNEL, UPDATE_ACTIONS } from './bridge/contract.ts'
export type {
  BridgeContractPersistence,
  DesktopBridgeContract,
  SplashStatusMessage,
  UpdateAction,
  UpdateActionMessage,
  UpdateProgress,
  UpdatePrompt,
  UpdateSettings,
} from './bridge/contract.ts'

export { DesktopInvariantViolation, invariantBoolean, invariantUpdateAction, invariantVersion } from './bridge/invariant.ts'

export { InMemoryDesktopBridge } from './bridge.ts'
export type { BackendSpawner, DesktopLaunchResult, ReadinessProbe } from './shell.ts'
export { DesktopShellOrchestrator } from './shell.ts'
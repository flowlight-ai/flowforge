/**
 * Desktop bridge contract — the narrow, context-isolated surface a desktop
 * shell exposes to its web renderer (port of clowder `desktop/preload.js`,
 * see its `desktopBridge`). This module is framework-agnostic: it declares the
 * channel names, message shapes, and update-action vocabulary without ever
 * importing Electron, so the same contract drives the real host preload, a
 * test double, and future non-Electron shells.
 * @module @flowforge/desktop/bridge
 */

/** IPC channel for splash-status messages (host → renderer). */
export const BRIDGE_CHANNEL = {
  splashStatus: 'splash-status',
  updatePrompt: 'desktop-update:prompt',
  updateProgress: 'desktop-update:progress',
  updateSettingsGet: 'desktop-update:settings:get',
  updateSettingsSetAutoCheck: 'desktop-update:settings:set-auto-check',
  updateReady: 'desktop-update:ready',
  updateAction: 'desktop-update:action',
} as const

/** The closed set of user actions the web UI may raise against an update prompt. */
export const UPDATE_ACTIONS = ['download', 'install', 'later', 'skip', 'open-release', 'dismiss'] as const
/** Union of valid {@link UPDATE_ACTIONS} members. */
export type UpdateAction = (typeof UPDATE_ACTIONS)[number]

/** A splash-status message (`message` is the rendered text). */
export interface SplashStatusMessage {
  /** Human-readable splash text rendered by the renderer. */
  message: string
}

/** An update prompt pushed to the renderer. */
export interface UpdatePrompt {
  /** Version string the prompt refers to. */
  version: string
  /** Whether auto-check is enabled (rendered by the UI). */
  autoCheck: boolean
}

/** Update download/progress tick pushed to the renderer. */
export interface UpdateProgress {
  /** Total bytes when known, `null` for indeterminate progress. */
  total: number | null
  /** Bytes transferred so far. */
  transferred: number
}

/** Update settings returned by {@link BridgeContractPersistence.readSettings}. */
export interface UpdateSettings {
  /** Whether automatic update checks run. */
  autoCheck: boolean
}

/** An update action emitted by the renderer toward the shell. */
export interface UpdateActionMessage {
  /** One of {@link UPDATE_ACTIONS}. */
  action: UpdateAction
  /** Target version, validated as a non-empty string. */
  version: string
}

/**
 * The persistence half of the bridge contract — how auto-check preference is
 * read and written. Kept as its own interface so the electron host can back it
 * with IPC while a unit test uses an in-memory store.
 */
export interface BridgeContractPersistence {
  readSettings(): UpdateSettings | Promise<UpdateSettings>
  setAutoCheck(enabled: boolean): void | Promise<void>
}

/**
 * The renderer-facing surface of the desktop bridge, mirroring clowder's
 * `desktopBridge` shape as a transport-agnostic contract.
 */
export interface DesktopBridgeContract {
  onStatus(callback: (message: SplashStatusMessage) => void): () => void
  onUpdatePrompt(callback: (prompt: UpdatePrompt) => void): () => void
  onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void
  getUpdateSettings(): Promise<UpdateSettings>
  setUpdateAutoCheck(enabled: boolean): Promise<void>
  updatePromptReady(): Promise<void>
  sendUpdatePromptAction(action: UpdateAction, version: string): void
}
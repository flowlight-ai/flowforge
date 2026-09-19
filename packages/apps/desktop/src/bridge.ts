/**
 * In-memory desktop bridge bus — the testable, transport-free implementation of
 * {@link DesktopBridgeContract}. A real Electron host swaps this for IPC
 * bindings that satisfy the same contract, so the web renderer never learns the
 * difference. Kept deliberately small: subscribe/stub for status, update prompt
 * and progress, plus update-settings persistence delegated to an injected
 * {@link BridgeContractPersistence}.
 * @module @flowforge/desktop/bridge
 */

import type {
  DesktopBridgeContract,
  SplashStatusMessage,
  UpdatePrompt,
  UpdateProgress,
  UpdateSettings,
  BridgeContractPersistence,
} from './bridge/contract.ts'
import { invariantBoolean, invariantUpdateAction, invariantVersion } from './bridge/invariant.ts'

type Listener<T> = (payload: T) => void

/** A memory-backed {@link DesktopBridgeContract} with injectable persistence. */
export class InMemoryDesktopBridge implements DesktopBridgeContract {
  private statusListeners = new Set<Listener<SplashStatusMessage>>()
  private promptListeners = new Set<Listener<UpdatePrompt>>()
  private progressListeners = new Set<Listener<UpdateProgress>>()
  private events: { type: 'prompt-action'; payload: { action: string; version: string } }[] = []

  constructor(private readonly persistence: BridgeContractPersistence) {}

  /** Emit a splash-status message to current subscribers. */
  emitStatus(message: SplashStatusMessage): void {
    for (const listener of this.statusListeners) listener(message)
  }

  /** Emit an update prompt to current subscribers. */
  emitUpdatePrompt(prompt: UpdatePrompt): void {
    for (const listener of this.promptListeners) listener(prompt)
  }

  /** Emit an update progress tick to current subscribers. */
  emitUpdateProgress(progress: UpdateProgress): void {
    for (const listener of this.progressListeners) listener(progress)
  }

  /** Events recorded by {@link sendUpdatePromptAction}, replayable in tests. */
  recordedActions(): { action: string; version: string }[] {
    return this.events.map(event => event.payload)
  }

  onStatus(callback: (message: SplashStatusMessage) => void): () => void {
    this.statusListeners.add(callback)
    return () => this.statusListeners.delete(callback)
  }

  onUpdatePrompt(callback: (prompt: UpdatePrompt) => void): () => void {
    this.promptListeners.add(callback)
    return () => this.promptListeners.delete(callback)
  }

  onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void {
    this.progressListeners.add(callback)
    return () => this.progressListeners.delete(callback)
  }

  async getUpdateSettings(): Promise<UpdateSettings> {
    return this.persistence.readSettings()
  }

  async setUpdateAutoCheck(enabled: boolean): Promise<void> {
    await this.persistence.setAutoCheck(invariantBoolean(enabled))
  }

  async updatePromptReady(): Promise<void> {
    // No-op in the in-memory bus; the shell uses it to ack renderer readiness.
  }

  sendUpdatePromptAction(action: string, version: string): void {
    const validAction = invariantUpdateAction(action)
    const validVersion = invariantVersion(version)
    this.events.push({ type: 'prompt-action', payload: { action: validAction, version: validVersion } })
  }
}
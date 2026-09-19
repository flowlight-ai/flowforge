/**
 * Bridge-domain invariants: package-local assertion helpers that enforce the
 * update-action and version-shape gates so a forged renderer message can never
 * ride through (host treats renderer messages as hostile, matching the code
 * runtime's inbound-traffic stance). Framework-free, no external dependency.
 * @module @flowforge/desktop/bridge/invariant
 */

import { UPDATE_ACTIONS } from './contract.ts'
import type { UpdateAction } from './contract.ts'

/** Fail loudly with a desktop-scoped message. */
export class DesktopInvariantViolation extends Error {
  constructor(message: string) {
    super(`flowforge-desktop: ${message}`)
    this.name = 'DesktopInvariantViolation'
  }
}

/** Assert that a value is a valid {@link UpdateAction}. @returns the value. */
export function invariantUpdateAction(action: unknown): UpdateAction {
  if (typeof action !== 'string' || !(UPDATE_ACTIONS as readonly string[]).includes(action)) {
    throw new DesktopInvariantViolation(`invalid update action: ${String(action)}`)
  }
  return action as UpdateAction
}

/** Assert that a value is a non-empty string (version). @returns the value. */
export function invariantVersion(version: unknown): string {
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new DesktopInvariantViolation(`invalid update version: ${String(version)}`)
  }
  return version
}

/** Assert that a value is a boolean (auto-check preference). @returns the value. */
export function invariantBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new DesktopInvariantViolation(`expected boolean, got ${String(value)}`)
  }
  return value
}
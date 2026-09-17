/**
 * Error taxonomy for the world engine.
 *
 * Replaces the legacy `ValueError` / `TypeError` / `PermissionError` raises with
 * classifiable types so callers can react differently to a bad field, a
 * cross-world reference, and an invalid state transition.
 *
 * Ported from `python/legacy/core/world_engine/` (F093).
 */

/** A field failed model validation (pydantic `ValidationError`). */
export class WorldEngineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldEngineValidationError';
  }
}

/** An entity belongs to a different world than the layer it was registered on. */
export class WorldEngineOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldEngineOwnershipError';
  }
}

/** The requested state transition is not allowed from the current state. */
export class WorldEngineStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldEngineStateError';
  }
}

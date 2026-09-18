/**
 * Field validators reproducing the pydantic semantics the legacy models relied on.
 *
 * The Python models used `ConfigDict(extra="forbid")` plus `@field_validator`
 * hooks. TypeScript has no runtime model layer, so the equivalent checks live
 * here and are called from the `createX` factories in `citizens.ts` /
 * `core-identity.ts` — a model cannot be constructed in an invalid state.
 */

import { WorldEngineValidationError } from './errors.js';

/**
 * Reject unknown keys (`extra="forbid"`).
 * `model` is the model name used in the error message (pydantic named it too).
 */
export function assertKnownKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  model: string,
): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new WorldEngineValidationError(
      `${model}: unknown field(s) ${unknown.map((key) => `'${key}'`).join(', ')} (extra="forbid")`,
    );
  }
}

/** Reject blank/whitespace-only strings and trim the rest. */
export function requireNonEmpty(value: unknown, field: string, model = 'model'): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WorldEngineValidationError(`${model}.${field} must be a non-empty string`);
  }
  return value.trim();
}

/** Reject lists containing duplicates (`core_personality` / `value_anchors`). */
export function requireUnique(items: unknown, field: string, model = 'model'): readonly string[] {
  if (!Array.isArray(items)) {
    throw new WorldEngineValidationError(`${model}.${field} must be a list`);
  }
  const values = items.map((item) => requireNonEmpty(item, field, model));
  if (new Set(values).size !== values.length) {
    throw new WorldEngineValidationError(`${model}.${field} must not contain duplicates`);
  }
  return Object.freeze(values);
}

/** List of non-empty strings (no uniqueness requirement). */
export function requireStringList(items: unknown, field: string, model = 'model'): readonly string[] {
  if (!Array.isArray(items)) {
    throw new WorldEngineValidationError(`${model}.${field} must be a list`);
  }
  return Object.freeze(items.map((item) => requireNonEmpty(item, field, model)));
}

/** `Field(..., ge=0)` for integers. */
export function requireNonNegativeInt(value: unknown, field: string, model = 'model'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new WorldEngineValidationError(`${model}.${field} must be an integer >= 0`);
  }
  return value;
}

/** Membership check for the enum-like string unions (`decided_by`). */
export function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  model = 'model',
): T {
  const candidate = requireNonEmpty(value, field, model);
  if (!(allowed as readonly string[]).includes(candidate)) {
    throw new WorldEngineValidationError(
      `${model}.${field} must be one of ${allowed.map((item) => `'${item}'`).join(', ')}; got '${candidate}'`,
    );
  }
  return candidate as T;
}

/** Reject `undefined` / `null` required references (the legacy `is None` guards). */
export function requirePresent<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null) {
    throw new WorldEngineValidationError(`${field} must not be null`);
  }
  return value;
}

/** Freeze a record and assert at runtime that no writable surface leaked. */
export function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

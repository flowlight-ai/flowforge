/**
 * Python-semantics helpers.
 *
 * JavaScript and Python disagree on several operations the condition language
 * inherits from Python. This module is the single place where those
 * differences are reconciled, so the evaluator stays readable.
 *
 * Ported semantics from legacy `core/conditional_router.py`:
 *   - `_COMPARE_OPS` (`operator.eq` / `lt` / ... ) → {@link pythonEquals} /
 *     {@link pythonCompare}
 *   - `type(x).__name__` → {@link pythonTypeName}
 */

import { EvaluationError } from './errors.js';

/** Values the condition language can carry. */
export type ConditionValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | readonly ConditionValue[]
  | { readonly [key: string]: ConditionValue };

/**
 * Python type name for `type(x).__name__` parity.
 * JS `typeof` reports `object`/`undefined`, which would silently break
 * conditions such as `type(state.list) == "list"`.
 */
export function pythonTypeName(value: unknown): string {
  if (value === null) return 'none';
  if (value === undefined) return 'none';
  if (Array.isArray(value)) return 'list';
  if (value instanceof Set) return 'set';
  switch (typeof value) {
    case 'boolean':
      return 'bool';
    case 'number':
      return Number.isInteger(value) ? 'int' : 'float';
    case 'string':
      return 'str';
    case 'object':
      return 'dict';
    default:
      return typeof value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Python `==` semantics: structural for containers, `1 == 1.0` true,
 * `"1" == 1` false (`True == 1` is Python-true and preserved here because both
 * are primitives with an explicit boolean arm).
 */
export function pythonEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    // Python: True == 1 and False == 0.
    if (typeof left === 'number' && typeof right === 'boolean') return left === Number(right);
    if (typeof left === 'boolean' && typeof right === 'number') return Number(left) === right;
    return left === right;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => pythonEquals(item, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => key in right && pythonEquals(left[key], right[key]));
  }
  return false;
}

/** Comparison operators supported by the condition language. */
export type PythonCompareOperator = '<' | '<=' | '>' | '>=';

/**
 * Ordering comparison. Numbers compare numerically; strings compare
 * lexicographically (Python allows both). Any other pairing raises
 * {@link EvaluationError}, which mirrors the `TypeError` Python raised and
 * which the router treats as "skip this route".
 */
export function pythonCompare(
  left: unknown,
  right: unknown,
  operator: PythonCompareOperator,
): boolean {
  const bothNumbers = typeof left === 'number' && typeof right === 'number';
  const bothStrings = typeof left === 'string' && typeof right === 'string';
  if (!bothNumbers && !bothStrings) {
    throw new EvaluationError(
      `Cannot compare ${pythonTypeName(left)} with ${pythonTypeName(right)} using ${operator}`,
    );
  }
  switch (operator) {
    case '<':
      return (left as number | string) < (right as number | string);
    case '<=':
      return (left as number | string) <= (right as number | string);
    case '>':
      return (left as number | string) > (right as number | string);
    default:
      return (left as number | string) >= (right as number | string);
  }
}

/** `is` / `is not` — Python identity, approximated for primitives and null. */
export function pythonIs(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return (left ?? null) === (right ?? null);
  }
  if (typeof left === 'number' || typeof left === 'string' || typeof left === 'boolean') {
    return typeof right === typeof left && left === right;
  }
  return left === right;
}

/**
 * Truthiness for `not` / `and` / `or` — matches Python for the empty
 * containers the condition language can produce.
 */
export function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

/** `len(x)` — strings and containers only. */
export function pythonLength(value: unknown): number {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  if (value instanceof Set) return value.size;
  if (isPlainObject(value)) return Object.keys(value).length;
  throw new EvaluationError(`len() is not supported for ${pythonTypeName(value)}`);
}

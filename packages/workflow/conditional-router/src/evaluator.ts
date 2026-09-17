/**
 * AST evaluator for the condition language.
 *
 * This is the TypeScript counterpart of Python's whitelisted `_SafeEvaluator`:
 * it walks only the node kinds `parser.ts` can produce, resolves variables
 * against the supplied context, and exposes a fixed set of built-ins. No host
 * code is ever executed.
 *
 * Parity notes carried over from `conditional_router.py`:
 *   - **Member access on a missing key yields `none`** (Python's
 *     `dict.get(attr)` fallback), it is not an error. Index access *does*
 *     raise, mirroring the `KeyError`/`IndexError` wrapping in the source.
 *   - **`and` / `or` do not short-circuit** — the source evaluated every
 *     operand via a list comprehension before applying `all` / `any`.
 *   - `has_error()` / `retry_count()` read the routing context and ignore any
 *     arguments, exactly as the source did.
 */

import { EvaluationError, ExpressionError } from './errors.js';
import type { ComparisonOperator, ExpressionNode } from './parser.js';
import { pathExists, pathNotEmpty } from './path.js';
import {
  pythonCompare,
  pythonEquals,
  pythonIs,
  pythonLength,
  pythonTruthy,
  pythonTypeName,
} from './py-semantics.js';
import type { PythonCompareOperator } from './py-semantics.js';

/** Built-ins callable from a condition expression. */
const ALLOWED_BUILTINS = new Set(['len', 'type', 'has_error', 'retry_count', 'score_above']);

type EvaluationResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

const UNRESOLVED: EvaluationResult = { ok: false };

/** Evaluate `node` against `context`, propagating `ExpressionError`. */
export function evaluateNode(node: ExpressionNode, context: unknown): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'group':
      return evaluateNode(node.expression, context);
    case 'identifier':
      return resolveName(node.name, context);
    case 'member':
      return readMember(evaluateNode(node.object, context), node.property);
    case 'index':
      return readIndex(evaluateNode(node.object, context), evaluateNode(node.index, context));
    case 'call':
      return callBuiltin(node.callee, node.args.map((arg) => evaluateNode(arg, context)), context);
    case 'unary': {
      const operand = evaluateNode(node.operand, context);
      if (node.operator === 'not') return !pythonTruthy(operand);
      if (typeof operand !== 'number') {
        throw new EvaluationError(`Unary '-' expects a number, got ${pythonTypeName(operand)}`);
      }
      return -operand;
    }
    case 'logical': {
      // No short-circuit: parity with the source's eager operand evaluation.
      const values = node.operands.map((operand) => evaluateNode(operand, context));
      return node.operator === 'and'
        ? values.every((value) => pythonTruthy(value))
        : values.some((value) => pythonTruthy(value));
    }
    case 'compare':
      return evaluateComparison(node, context);
    case 'exists':
      return pathExists(context, chainToPath(node.operand));
    case 'notEmpty':
      return pathNotEmpty(context, chainToPath(node.operand));
    default: {
      const exhaustive: never = node;
      throw new ExpressionError(`Unsupported expression node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function resolveName(name: string, context: unknown): unknown {
  if (typeof context !== 'object' || context === null) {
    throw new ExpressionError(`Undefined variable: '${name}'`);
  }
  if (!(name in (context as Record<string, unknown>))) {
    throw new ExpressionError(`Undefined variable: '${name}'`);
  }
  return (context as Record<string, unknown>)[name];
}

function readMember(target: unknown, property: string): unknown {
  if (Array.isArray(target)) {
    throw new ExpressionError(`Cannot access attribute '${property}' on list`);
  }
  if (typeof target !== 'object' || target === null) {
    throw new ExpressionError(`Cannot access attribute '${property}' on ${pythonTypeName(target)}`);
  }
  const record = target as Record<string, unknown>;
  // Python's `dict.get(attr)` fallback: a missing key is `none`, not an error.
  return property in record ? record[property] : null;
}

function readIndex(target: unknown, index: unknown): unknown {
  if (typeof target === 'string') {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      throw new ExpressionError(`Cannot index str with ${pythonTypeName(index)}`);
    }
    if (index < 0 || index >= target.length) {
      throw new ExpressionError(`Cannot access index ${index} on str`);
    }
    return target[index] as string;
  }
  if (Array.isArray(target)) {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      throw new ExpressionError(`Cannot index list with ${pythonTypeName(index)}`);
    }
    if (index < 0 || index >= target.length) {
      throw new ExpressionError(`Cannot access index ${index} on list`);
    }
    return target[index];
  }
  if (typeof target === 'object' && target !== null) {
    const key = typeof index === 'string' ? index : String(index);
    const record = target as Record<string, unknown>;
    if (!(key in record)) {
      throw new ExpressionError(`Cannot access key '${key}' on dict`);
    }
    return record[key];
  }
  throw new ExpressionError(`Cannot index ${pythonTypeName(target)}`);
}

function evaluateComparison(
  node: Extract<ExpressionNode, { kind: 'compare' }>,
  context: unknown,
): boolean {
  let left = evaluateNode(node.left, context);
  for (let position = 0; position < node.operators.length; position += 1) {
    const operator = node.operators[position] as ComparisonOperator;
    const right = evaluateNode(node.comparators[position] as ExpressionNode, context);
    if (!applyComparison(operator, left, right)) return false;
    left = right;
  }
  return true;
}

function applyComparison(operator: ComparisonOperator, left: unknown, right: unknown): boolean {
  switch (operator) {
    case '==':
      return pythonEquals(left, right);
    case '!=':
      return !pythonEquals(left, right);
    case '<':
    case '<=':
    case '>':
    case '>=':
      return pythonCompare(left, right, operator as PythonCompareOperator);
    case 'is':
      return pythonIs(left, right);
    case 'is not':
      return !pythonIs(left, right);
    case 'in':
      return contains(right, left);
    case 'not in':
      return !contains(right, left);
    case 'contains':
      return contains(left, right);
    default:
      throw new ExpressionError(`Unsupported comparison operator: ${String(operator)}`);
  }
}

/** Python `item in container` semantics. */
function contains(container: unknown, item: unknown): boolean {
  if (typeof container === 'string') {
    if (typeof item !== 'string') {
      throw new EvaluationError(`'in <str>' expects a string, got ${pythonTypeName(item)}`);
    }
    return container.includes(item);
  }
  if (Array.isArray(container)) {
    return container.some((entry) => pythonEquals(entry, item));
  }
  if (container instanceof Set) {
    return [...container].some((entry) => pythonEquals(entry, item));
  }
  if (typeof container === 'object' && container !== null) {
    return typeof item === 'string' && item in (container as Record<string, unknown>);
  }
  throw new EvaluationError(`Argument of type ${pythonTypeName(container)} is not iterable`);
}

function callBuiltin(callee: string, args: readonly unknown[], context: unknown): unknown {
  if (!ALLOWED_BUILTINS.has(callee)) {
    throw new ExpressionError(`Function '${callee}' is not allowed`);
  }
  switch (callee) {
    case 'len':
      expectArity(callee, args, 1);
      return pythonLength(args[0]);
    case 'type':
      expectArity(callee, args, 1);
      return pythonTypeName(args[0]);
    case 'has_error': {
      const errors = readStateValue(context, 'errors');
      return Array.isArray(errors) && errors.length > 0;
    }
    case 'retry_count': {
      const retries = readStateValue(context, 'retry_count');
      return typeof retries === 'number' ? retries : 0;
    }
    case 'score_above': {
      expectArity(callee, args, 1);
      const threshold = args[0];
      if (typeof threshold !== 'number') {
        throw new EvaluationError(
          `score_above() expects a number threshold, got ${pythonTypeName(threshold)}`,
        );
      }
      const score = readStateValue(context, 'score') ?? readStateValue(context, 'audit_score') ?? 0;
      if (typeof score !== 'number') {
        throw new EvaluationError(`score_above() found non-numeric score: ${pythonTypeName(score)}`);
      }
      return score >= threshold;
    }
    default:
      throw new ExpressionError(`Unknown built-in function: '${callee}'`);
  }
}

function expectArity(callee: string, args: readonly unknown[], expected: number): void {
  if (args.length !== expected) {
    throw new ExpressionError(`${callee}() requires exactly ${expected} argument(s)`);
  }
}

function readStateValue(context: unknown, key: string): unknown {
  if (typeof context !== 'object' || context === null) return undefined;
  const state = (context as Record<string, unknown>)['state'];
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return undefined;
  return (state as Record<string, unknown>)[key];
}

/**
 * `exists` / `not_empty` deliberately do **not** use the ordinary member
 * semantics above. The source resolved them through `_resolve_path`, which
 * raises on a missing key, and then swallowed that error into `false`. Plain
 * member access, by contrast, fell back to `dict.get` and yielded `none`.
 * Rebuilding the path string and reusing {@link resolvePath} keeps the strict
 * behaviour (and numeric-index restriction) in one place.
 */
function chainToPath(node: ExpressionNode): string {
  switch (node.kind) {
    case 'identifier':
      return node.name;
    case 'member':
      return `${chainToPath(node.object)}.${node.property}`;
    case 'index': {
      if (node.index.kind !== 'literal' || typeof node.index.value !== 'number') {
        throw new ExpressionError(
          "'exists'/'not_empty' require a numeric index literal in the path",
        );
      }
      return `${chainToPath(node.object)}[${node.index.value}]`;
    }
    default:
      throw new ExpressionError("'exists'/'not_empty' can only be applied to a state path");
  }
}

/**
 * Non-throwing resolution used by callers that need "can this be evaluated?".
 * Any resolution or evaluation failure simply means "not resolvable".
 */
export function tryResolve(node: ExpressionNode, context: unknown): EvaluationResult {
  try {
    return { ok: true, value: evaluateNode(node, context) };
  } catch (error) {
    if (
      error instanceof ExpressionError ||
      error instanceof EvaluationError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return UNRESOLVED;
    }
    throw error;
  }
}

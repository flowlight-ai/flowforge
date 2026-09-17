/**
 * Public condition-evaluation API.
 *
 * Replaces `evaluate_condition()` from legacy `conditional_router.py`. In the
 * Python source a regex preprocessing pass rewrote `X exists`,
 * `X not_empty` and `X contains Y` before handing the string to `ast`; here the
 * parser understands those forms directly, so no textual rewriting happens
 * (and quoting/nesting cannot break the transformation).
 */

import { evaluateNode } from './evaluator.js';
import { parseExpression, type ExpressionNode } from './parser.js';

/**
 * Safely evaluate `expression` against `context` and coerce the result to a
 * boolean.
 *
 * @throws {ExpressionError} expression is invalid or uses a disallowed construct.
 * @throws {EvaluationError} expression is valid but hit a type mismatch.
 */
export function evaluateCondition(expression: string, context: unknown = {}): boolean {
  return Boolean(evaluateNode(parseExpression(expression), context));
}

/** Parse once, evaluate many — used by the router's construction-time checks. */
export function compileCondition(expression: string): ExpressionNode {
  return parseExpression(expression);
}

/** Evaluate a previously compiled condition. */
export function evaluateCompiled(node: ExpressionNode, context: unknown = {}): boolean {
  return Boolean(evaluateNode(node, context));
}

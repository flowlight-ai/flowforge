/**
 * @flowforge/workflow-conditional-router
 *
 * Declarative condition-based routing (port of legacy `core/conditional_router.py`,
 * F44 increment 1). Replaces hardcoded if-else strategy routing with a safe
 * expression language plus priority-ordered, YAML-declarable route rules.
 *
 * @example
 * ```ts
 * const router = new ConditionalRouter(
 *   [
 *     { name: 'hot', condition: "state.urgency == 'high'", target: 'hot_strategy', priority: 10 },
 *     { name: 'deep', condition: "state.intent == 'deep_research'", target: 'deep_strategy', priority: 5 },
 *   ],
 *   { defaultTarget: 'trending' },
 * );
 * const result = await router.route({ state: { urgency: 'high' } });
 * // → { target: 'hot_strategy', matchedRoute: 'hot', condition: "state.urgency == 'high'" }
 * ```
 */

export { EvaluationError, ExpressionError, RouteResolutionError } from './errors.js';
export { compileCondition, evaluateCompiled, evaluateCondition } from './expression.js';
export { evaluateNode, tryResolve } from './evaluator.js';
export { parseExpression } from './parser.js';
export type { ComparisonOperator, ExpressionNode } from './parser.js';
export { tokenize } from './tokenizer.js';
export type { Token, TokenType } from './tokenizer.js';
export { PathResolutionError, pathExists, pathNotEmpty, resolvePath } from './path.js';
export {
  pythonCompare,
  pythonEquals,
  pythonIs,
  pythonLength,
  pythonTruthy,
  pythonTypeName,
} from './py-semantics.js';
export type { ConditionValue, PythonCompareOperator } from './py-semantics.js';
export { ConditionalRouter, parseRouteConfig, parseRouterConfig } from './router.js';
export type {
  RouteConfig,
  RouteResult,
  RouterConfig,
  RouterLogger,
  RouterOptions,
} from './router.js';

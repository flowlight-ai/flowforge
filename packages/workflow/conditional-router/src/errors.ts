/**
 * Error taxonomy for the conditional router.
 *
 * Ported from legacy `core/conditional_router.py` (`ExpressionError` plus the
 * `ValueError` / `KeyError` raises). The three types are deliberately
 * **mutually non-inheriting** so that {@link ConditionalRouter.route} can tell
 * apart the two failure classes the Python source distinguished:
 *
 * - {@link ExpressionError} — the expression itself is invalid or unsafe
 *   (syntax error, unsupported construct, undefined variable, non-whitelisted
 *   function). Python re-raised these; so do we.
 * - {@link EvaluationError} — the expression is valid but evaluation hit a
 *   type mismatch (e.g. `1 < "a"`). Python's generic `except Exception` branch
 *   skipped the route and continued; so do we.
 * - {@link RouteResolutionError} — no route matched and no default target was
 *   configured (Python raised `ValueError`).
 */

/** The expression is invalid or uses a disallowed construct. */
export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/** The expression is valid but cannot be evaluated against this context. */
export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationError';
  }
}

/** No route matched and the router has no default target. */
export class RouteResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteResolutionError';
  }
}

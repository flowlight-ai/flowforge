/**
 * Declarative condition-based router.
 *
 * Ported from `ConditionalRouter` / `RouteConfig` / `RouterConfig` /
 * `RouteResult` in legacy `core/conditional_router.py`. Routes are evaluated in
 * priority order (highest first); among equal priorities the definition order is
 * preserved and the first match wins.
 *
 * Deliberate departures from the source (see design §2.2):
 *   - File IO is not performed here: `fromYaml` takes the YAML *text* and the
 *     host decides where it came from.
 *   - `toDict()` returns the configured router name. The source hard-coded
 *     `name: ""`, which made a serialised config unreadable.
 */

import { parse as parseYaml } from 'yaml';

import { ExpressionError, RouteResolutionError } from './errors.js';
import { evaluateCompiled, compileCondition } from './expression.js';
import type { ExpressionNode } from './parser.js';

/** A single routing rule. */
export interface RouteConfig {
  readonly name: string;
  readonly condition: string;
  readonly target: string;
  readonly priority: number;
  readonly description: string;
}

/** Top-level router configuration (mirrors the YAML structure). */
export interface RouterConfig {
  readonly name: string;
  readonly description: string;
  readonly default: string | null;
  readonly routes: readonly RouteConfig[];
}

/** Outcome of a routing decision. */
export interface RouteResult {
  /** Target selected for this decision. */
  readonly target: string;
  /** Name of the matching route, or `null` when the default was used. */
  readonly matchedRoute: string | null;
  /** Condition that matched (empty for the default). */
  readonly condition: string;
}

/** Minimal logging seam; the host injects its logger (default: silent). */
export interface RouterLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const SILENT_LOGGER: RouterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Options accepted by the {@link ConditionalRouter} constructor. */
export interface RouterOptions {
  readonly defaultTarget?: string | null;
  readonly name?: string;
  readonly logger?: RouterLogger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string, fallback?: string): string {
  const value = record[key];
  if (value === undefined) {
    if (fallback === undefined) {
      throw new ExpressionError(`Route config is missing required field '${key}'`);
    }
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new ExpressionError(`Route config field '${key}' must be a string`);
  }
  return value;
}

/**
 * Validate one route, including its condition syntax (the source validated it
 * in a pydantic `model_validator`, so an invalid rule could never be built).
 */
export function parseRouteConfig(input: unknown): RouteConfig {
  if (!isRecord(input)) {
    throw new ExpressionError('Route config must be an object');
  }
  const route: RouteConfig = {
    name: readString(input, 'name'),
    condition: readString(input, 'condition'),
    target: readString(input, 'target'),
    priority: typeof input['priority'] === 'number' ? input['priority'] : 0,
    description: readString(input, 'description', ''),
  };
  try {
    compileCondition(route.condition);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ExpressionError(
      `Route '${route.name}' has invalid condition syntax: '${route.condition}' — ${detail}`,
    );
  }
  return route;
}

/** Validate a whole router configuration (as parsed from YAML or a plain object). */
export function parseRouterConfig(input: unknown): RouterConfig {
  if (!isRecord(input)) {
    throw new ExpressionError('Router config must be an object');
  }
  const rawRoutes = input['routes'];
  const routes = Array.isArray(rawRoutes) ? rawRoutes.map(parseRouteConfig) : [];
  const defaultTarget = input['default'];
  if (defaultTarget !== undefined && defaultTarget !== null && typeof defaultTarget !== 'string') {
    throw new ExpressionError("Router config field 'default' must be a string or null");
  }
  return {
    name: readString(input, 'name', ''),
    description: readString(input, 'description', ''),
    default: typeof defaultTarget === 'string' ? defaultTarget : null,
    routes,
  };
}

/** Declarative condition-based router. */
export class ConditionalRouter {
  private routes: RouteConfig[];
  private readonly compiled: Map<string, ExpressionNode>;
  private defaultTarget: string | null;
  private readonly routerName: string;
  private readonly logger: RouterLogger;

  constructor(routes: readonly RouteConfig[], options: RouterOptions = {}) {
    this.routes = routes.map((route) => parseRouteConfig(route));
    this.compiled = new Map();
    for (const route of this.routes) {
      this.compiled.set(route.condition, compileCondition(route.condition));
    }
    this.defaultTarget = options.defaultTarget ?? null;
    this.routerName = options.name ?? '';
    this.logger = options.logger ?? SILENT_LOGGER;
    this.sortRoutes();
  }

  /** Build a router from an already-parsed configuration object. */
  static fromConfig(input: unknown): ConditionalRouter {
    const config = parseRouterConfig(input);
    return new ConditionalRouter(config.routes, {
      defaultTarget: config.default,
      name: config.name,
    });
  }

  /**
   * Build a router from YAML text.
   *
   * Expected shape:
   *
   *     name: my_router
   *     default: fallback_target
   *     routes:
   *       - name: route_a
   *         condition: "state.score >= 0.8"
   *         target: target_a
   *         priority: 10
   */
  static fromYaml(yamlText: string): ConditionalRouter {
    let parsed: unknown;
    try {
      parsed = parseYaml(yamlText) ?? {};
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ExpressionError(`Invalid router YAML: ${detail}`);
    }
    return ConditionalRouter.fromConfig(parsed);
  }

  /** Priority-descending; `Array.prototype.sort` is stable, so ties keep order. */
  private sortRoutes(): void {
    this.routes = [...this.routes].sort((left, right) => right.priority - left.priority);
  }

  /**
   * Evaluate every route against `context` and return the first match,
   * falling back to the configured default.
   *
   * @throws {ExpressionError} a route's condition is invalid (never skipped).
   * @throws {RouteResolutionError} nothing matched and no default is configured.
   */
  async route(context: Record<string, unknown> = {}): Promise<RouteResult> {
    for (const route of this.routes) {
      try {
        const node = this.compiled.get(route.condition) ?? compileCondition(route.condition);
        if (evaluateCompiled(node, context)) {
          this.logger.debug(
            `Route '${route.name}' matched (priority=${route.priority}), target='${route.target}'`,
          );
          return { target: route.target, matchedRoute: route.name, condition: route.condition };
        }
      } catch (error) {
        if (error instanceof ExpressionError) {
          this.logger.error(`Route '${route.name}' has invalid condition: '${route.condition}'`);
          throw error;
        }
        // Evaluation-time failure: skip this route and keep looking (source parity).
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Route '${route.name}' evaluation failed: ${detail}, skipping`);
      }
    }

    if (this.defaultTarget !== null) {
      this.logger.debug(`No route matched, using default: '${this.defaultTarget}'`);
      return { target: this.defaultTarget, matchedRoute: null, condition: '' };
    }

    throw new RouteResolutionError(
      `No route matched and no default configured. Evaluated ${this.routes.length} routes against context keys: ${Object.keys(context).join(', ')}`,
    );
  }

  /** Add a route and restore priority order. */
  addRoute(route: RouteConfig): void {
    const parsed = parseRouteConfig(route);
    this.routes = [...this.routes, parsed];
    this.compiled.set(parsed.condition, compileCondition(parsed.condition));
    this.sortRoutes();
    this.logger.info(
      `Added route '${parsed.name}' (priority=${parsed.priority}, target='${parsed.target}')`,
    );
  }

  /** Remove a route by name; throws when the name is unknown (source `KeyError`). */
  removeRoute(name: string): void {
    const remaining = this.routes.filter((route) => route.name !== name);
    if (remaining.length === this.routes.length) {
      throw new Error(`Route '${name}' not found`);
    }
    this.routes = remaining;
    this.logger.info(`Removed route '${name}'`);
  }

  /** Current routes, in priority order. */
  listRoutes(): readonly RouteConfig[] {
    return this.routes.map((route) => ({ ...route }));
  }

  /** Serialise the router configuration (name preserved, unlike the source). */
  toDict(): RouterConfig {
    return {
      name: this.routerName,
      description: '',
      default: this.defaultTarget,
      routes: this.listRoutes(),
    };
  }
}

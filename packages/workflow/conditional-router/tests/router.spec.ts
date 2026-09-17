import { describe, expect, it, vi } from 'vitest';

import { EvaluationError, ExpressionError, RouteResolutionError } from '../src/errors.js';
import {
  ConditionalRouter,
  parseRouteConfig,
  parseRouterConfig,
  type RouteConfig,
  type RouterLogger,
} from '../src/router.js';

const routes: RouteConfig[] = [
  { name: 'hot', condition: "state.urgency == 'high'", target: 'hot_strategy', priority: 10, description: '' },
  { name: 'deep', condition: "state.intent == 'deep_research'", target: 'deep_strategy', priority: 5, description: '' },
  { name: 'fallback-ish', condition: "state.intent == 'deep_research'", target: 'deep_alt', priority: 5, description: '' },
];

function fixtureLogger(): RouterLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('ConditionalRouter routing', () => {
  it('picks the highest-priority match and reports the route name', async () => {
    const router = new ConditionalRouter(routes, { defaultTarget: 'trending' });
    const result = await router.route({ state: { urgency: 'high', intent: 'deep_research' } });
    expect(result).toEqual({
      target: 'hot_strategy',
      matchedRoute: 'hot',
      condition: "state.urgency == 'high'",
    });
  });

  it('keeps definition order among equal priorities (stable sort)', async () => {
    const router = new ConditionalRouter(routes);
    const result = await router.route({ state: { intent: 'deep_research' } });
    expect(result.matchedRoute).toBe('deep');
    expect(result.target).toBe('deep_strategy');
  });

  it('falls back to the default target', async () => {
    const router = new ConditionalRouter(routes, { defaultTarget: 'trending' });
    const result = await router.route({ state: { urgency: 'low', intent: 'chat' } });
    expect(result).toEqual({ target: 'trending', matchedRoute: null, condition: '' });
  });

  it('throws RouteResolutionError when nothing matches and no default exists', async () => {
    const router = new ConditionalRouter(routes);
    await expect(router.route({ state: {} })).rejects.toThrow(RouteResolutionError);
    await expect(router.route({ state: {} })).rejects.toThrow(/context keys: state/);
  });

  it('skips a route whose evaluation raises EvaluationError, then matches a later one', async () => {
    const logger = fixtureLogger();
    const withLogger = new ConditionalRouter(
      [
        { name: 'broken-type', condition: 'state.score < "a"', target: 'never', priority: 10, description: '' },
        { name: 'fallback', condition: 'state.score exists', target: 'safe', priority: 1, description: '' },
      ],
      { logger },
    );
    const result = await withLogger.route({ state: { score: 0.5 } });
    expect(result.target).toBe('safe');
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('propagates ExpressionError instead of skipping the route', async () => {
    const router = new ConditionalRouter(
      [{ name: 'bad', condition: 'missing_root == 1', target: 'never', priority: 1, description: '' }],
      { defaultTarget: 'trending' },
    );
    await expect(router.route({ state: {} })).rejects.toThrow(ExpressionError);
  });
});

describe('ConditionalRouter rule management', () => {
  it('adds routes and restores priority order', () => {
    const router = new ConditionalRouter([routes[1] as RouteConfig]);
    router.addRoute({ name: 'hot', condition: "state.urgency == 'high'", target: 'hot_strategy', priority: 10, description: '' });
    expect(router.listRoutes().map((route) => route.name)).toEqual(['hot', 'deep']);
  });

  it('removes routes and rejects unknown names', () => {
    const router = new ConditionalRouter(routes);
    router.removeRoute('deep');
    expect(router.listRoutes().map((route) => route.name)).toEqual(['hot', 'fallback-ish']);
    expect(() => router.removeRoute('nope')).toThrow("Route 'nope' not found");
  });

  it('returns copies so callers cannot mutate internal state', () => {
    const router = new ConditionalRouter(routes);
    const listed = router.listRoutes() as RouteConfig[];
    listed[0] = { ...listed[0], name: 'mutated' } as RouteConfig;
    expect(router.listRoutes()[0]?.name).toBe('hot');
  });
});

describe('config parsing and validation', () => {
  it('validates condition syntax at construction time', () => {
    expect(() =>
      new ConditionalRouter([
        { name: 'bad', condition: 'state.score >', target: 'x', priority: 0, description: '' },
      ]),
    ).toThrow(/Route 'bad' has invalid condition syntax/);
  });

  it('fills defaults for optional fields and ignores unknown keys', () => {
    const parsed = parseRouteConfig({ name: 'n', condition: 'true', target: 't', extra: 1 });
    expect(parsed).toEqual({ name: 'n', condition: 'true', target: 't', priority: 0, description: '' });
  });

  it('rejects malformed configs', () => {
    expect(() => parseRouteConfig({ condition: 'true', target: 't' })).toThrow(ExpressionError);
    expect(() => parseRouteConfig({ name: 'n', target: 't' })).toThrow(ExpressionError);
    expect(() => parseRouterConfig({ name: 'r', default: 3 })).toThrow(ExpressionError);
    expect(() => parseRouterConfig('not-an-object')).toThrow(ExpressionError);
  });

  it('parses a router config with routes and a default', () => {
    const config = parseRouterConfig({
      name: 'my_router',
      description: 'demo',
      default: 'trending',
      routes: [{ name: 'hot', condition: "state.urgency == 'high'", target: 'hot_strategy', priority: 10 }],
    });
    expect(config.name).toBe('my_router');
    expect(config.default).toBe('trending');
    expect(config.routes).toHaveLength(1);
    expect(config.routes[0]?.description).toBe('');
  });
});

describe('YAML loading and serialisation', () => {
  const yaml = `
name: my_router
description: "Demo router"
default: fallback_target

routes:
  - name: hot
    condition: "state.urgency == 'high'"
    target: hot_strategy
    priority: 10
    description: "High urgency route"
  - name: deep
    condition: "state.intent == 'deep_research'"
    target: deep_strategy
    priority: 5
`;

  it('loads routes from YAML text and routes traffic', async () => {
    const router = ConditionalRouter.fromYaml(yaml);
    expect(router.listRoutes().map((route) => route.name)).toEqual(['hot', 'deep']);
    expect((await router.route({ state: { urgency: 'high' } })).target).toBe('hot_strategy');
    expect((await router.route({ state: { intent: 'deep_research' } })).target).toBe(
      'deep_strategy',
    );
    expect((await router.route({ state: {} })).target).toBe('fallback_target');
  });

  it('round-trips through toDict, preserving name and default', async () => {
    const router = ConditionalRouter.fromYaml(yaml);
    const dict = router.toDict();
    expect(dict.name).toBe('my_router');
    expect(dict.default).toBe('fallback_target');
    const rebuilt = ConditionalRouter.fromConfig(dict);
    expect((await rebuilt.route({ state: { urgency: 'high' } })).target).toBe('hot_strategy');
  });

  it('treats an empty YAML document as an empty config', async () => {
    const router = ConditionalRouter.fromYaml('');
    expect(router.listRoutes()).toHaveLength(0);
    await expect(router.route({})).rejects.toThrow(RouteResolutionError);
  });

  it('reports malformed YAML as an ExpressionError', () => {
    expect(() => ConditionalRouter.fromYaml('routes: [')).toThrow(ExpressionError);
  });
});

describe('logger seam', () => {
  it('is silent by default and injectable', async () => {
    const logger = fixtureLogger();
    const router = new ConditionalRouter(routes, { logger });
    await router.route({ state: { urgency: 'high' } });
    expect(logger.debug).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('error taxonomy', () => {
  it('keeps ExpressionError and EvaluationError disjoint', () => {
    expect(new EvaluationError('x')).not.toBeInstanceOf(ExpressionError);
    expect(new RouteResolutionError('x')).not.toBeInstanceOf(ExpressionError);
  });
});

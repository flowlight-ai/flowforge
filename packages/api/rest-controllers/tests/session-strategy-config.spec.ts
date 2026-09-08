/**
 * Session strategy config controller + resolution contract tests.
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { SessionStrategyConfigController } from '../src/controllers/session-strategy-config.ts';
import { MemorySessionStrategyOverrideStore, type SessionStrategyLowerSource } from '../src/pure/session-strategy.ts';

function req(method: string, url: string, opts: { body?: unknown } = {}): HttpRequest {
  return { method, url, headers: {}, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}) };
}

const lower: SessionStrategyLowerSource = {
  getByCatId: (catId) => (catId === 'cat-a' ? { mode: 'balanced', name: 'balanced' } : null),
};

function make(cats = ['cat-a', 'cat-b']) {
  const overrideStore = new MemorySessionStrategyOverrideStore();
  const controller = new SessionStrategyConfigController({ cats, overrideStore, lowerSource: lower });
  return { controller, overrideStore };
}

describe('SessionStrategyConfigController GET', () => {
  it('returns effective strategy with provenance for all cats', async () => {
    const { controller } = make();
    const res = await controller.handle(req('GET', '/api/config/session-strategy'));
    expect(res.status).toBe(200);
    const configs = (res.body as { configs: Array<{ catId: string; source: string }> }).configs;
    expect(configs).toHaveLength(2);
    expect(configs.find((c) => c.catId === 'cat-a')?.source).toBe('config');
    expect(configs.find((c) => c.catId === 'cat-b')?.source).toBe('default');
  });
  it('prefers an override over the lower source', async () => {
    const { controller, overrideStore } = make();
    overrideStore.set('cat-a', { mode: 'fast' });
    const res = await controller.handle(req('GET', '/api/config/session-strategy'));
    const catA = (res.body as { configs: Array<{ catId: string; source: string }> }).configs.find((c) => c.catId === 'cat-a');
    expect(catA?.source).toBe('override');
  });
});

describe('SessionStrategyConfigController override', () => {
  it('rejects an unknown cat with 404', async () => {
    const { controller } = make();
    const res = await controller.handle(req('PATCH', '/api/config/session-strategy/nope', { body: { strategy: {} } }));
    expect(res.status).toBe(404);
  });
  it('rejects a malformed override with 400', async () => {
    const { controller } = make();
    const res = await controller.handle(req('PATCH', '/api/config/session-strategy/cat-a', { body: { strategy: 7 } }));
    expect(res.status).toBe(400);
  });
  it('sets an override and falls back after delete', async () => {
    const { controller, overrideStore } = make();
    const set = await controller.handle(req('PATCH', '/api/config/session-strategy/cat-a', { body: { strategy: { mode: 'fast' } } }));
    expect(set.status).toBe(200);
    expect((set.body as { source: string }).source).toBe('override');
    expect(overrideStore.get('cat-a')).toEqual({ mode: 'fast' });
    const del = await controller.handle(req('DELETE', '/api/config/session-strategy/cat-a'));
    expect(del.status).toBe(200);
    expect((del.body as { source: string }).source).toBe('config');
  });
});
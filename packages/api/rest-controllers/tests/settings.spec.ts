/**
 * Settings controller contract tests (self-built CRUD).
 */
import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '../src/ports/http.ts';
import { SettingsController } from '../src/controllers/settings.ts';
import { MemorySettingsStore, type SettingsValidator } from '../src/ports/stores.ts';
import { DefaultRequestContextResolver } from '../src/ports/request-context.ts';

function req(
  method: string,
  url: string,
  opts: { headers?: Record<string, string | undefined>; body?: unknown; query?: Record<string, string> } = {},
): HttpRequest {
  return { method, url, headers: opts.headers ?? {}, ...(opts.body !== undefined ? { body: opts.body as Record<string, unknown> } : {}), ...(opts.query ? { query: opts.query } : {}) };
}

function makeController(validator?: SettingsValidator) {
  const store = new MemorySettingsStore();
  const controller = new SettingsController({
    store,
    identity: new DefaultRequestContextResolver(),
    ...(validator ? { validator } : {}),
  });
  return { store, controller };
}

describe('SettingsController', () => {
  it('lists settings and enforces a valid scope', async () => {
    const { store, controller } = makeController();
    store.set({ key: 'model', scope: 'user', value: 'deepseek', updatedBy: 'u1', updatedAt: 1, version: 0 });
    store.set({ key: 'theme', scope: 'global', value: 'dark', updatedBy: 'u1', updatedAt: 1, version: 0 });

    const res = await controller.handle(req('GET', '/api/settings', { query: { scope: 'user' } }));
    expect(res.status).toBe(200);
    const body = res.body as { settings: Array<{ key: string }>; totalMatches: number; truncated: boolean };
    expect(body.settings.map((s) => s.key)).toEqual(['model']);
    expect(body.totalMatches).toBe(1);
    expect(body.truncated).toBe(false);

    const badScope = await controller.handle(req('GET', '/api/settings', { query: { scope: 'nope' } }));
    expect(badScope.status).toBe(400);
  });

  it('reads a single setting and returns 404 when missing', async () => {
    const { store, controller } = makeController();
    store.set({ key: 'model', scope: 'user', value: 'deepseek', updatedBy: 'u1', updatedAt: 1, version: 0 });
    const found = await controller.handle(req('GET', '/api/settings/model', { query: { scope: 'user' } }));
    expect(found.status).toBe(200);
    expect((found.body as { value: string }).value).toBe('deepseek');
    const missing = await controller.handle(req('GET', '/api/settings/nope'));
    expect(missing.status).toBe(404);
  });

  it('writes a validated setting with the acting user', async () => {
    const { controller } = makeController((key, value) => (key === 'model' && value !== 'deepseek' ? 'only deepseek allowed' : null));
    const ok = await controller.handle(
      req('PUT', '/api/settings/model', { body: { value: 'deepseek' }, headers: { 'x-cat-cafe-user': 'u9' } }),
    );
    expect(ok.status).toBe(200);
    expect((ok.body as { value: string }).value).toBe('deepseek');

    const invalid = await controller.handle(req('PUT', '/api/settings/model', { body: { value: 'gpt' } }));
    expect(invalid.status).toBe(400);
  });

  it('rejects malformed payloads with 400', async () => {
    const { controller } = makeController();
    const res = await controller.handle(req('PUT', '/api/settings/model', { body: { scope: 7 } }));
    expect(res.status).toBe(400);
    expect((res.body as { details?: unknown }).details).toBeDefined();
  });

  it('removes a setting and reports missing removals', async () => {
    const { store, controller } = makeController();
    store.set({ key: 'model', scope: 'user', value: 'deepseek', updatedBy: 'u1', updatedAt: 1, version: 0 });
    const removed = await controller.handle(req('DELETE', '/api/settings/model', { query: { scope: 'user' } }));
    expect(removed.status).toBe(200);
    expect((removed.body as { ok: boolean }).ok).toBe(true);
    const again = await controller.handle(req('DELETE', '/api/settings/model'));
    expect(again.status).toBe(404);
  });
});
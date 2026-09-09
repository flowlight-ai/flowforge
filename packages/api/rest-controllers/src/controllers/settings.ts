/**
 * Settings REST controller (self-built CRUD feline for A2).
 *
 * Read/write/validate settings records against an injected ISettingsStore with
 * an optional value validator. Host binds real model/credential settings in EP2.
 */

import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver } from '../ports/request-context.ts';
import type { ISettingsStore, SettingsValidator } from '../ports/stores.ts';
import { settingsWriteBodySchema } from '../contract/settings.ts';
import type { SettingsEnvelope } from '../contract/settings.ts';

export interface SettingsControllerOptions {
  store: ISettingsStore;
  identity: RequestContextResolver;
  validator?: SettingsValidator;
}

export class SettingsController extends RestControllerBase {
  constructor(private readonly opts: SettingsControllerOptions) {
    super();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // GET /api/settings?scope=&userId=
    this.get('/api/settings', async (req) => {
      const scope = req.query?.scope ?? 'user';
      if (!['user', 'global', 'workspace'].includes(scope)) {
        return { status: 400, body: { error: 'Invalid scope' } };
      }
      const userId = this.opts.identity.resolveUserId(req) ?? undefined;
      const list = await this.opts.store.list(scope, scope === 'user' ? userId : undefined);
      const settings = list.map((r) => ({ key: r.key, scope: r.scope, value: r.value, source: 'stored' as const }));
      const envelope: SettingsEnvelope = { settings, totalMatches: settings.length, truncated: false };
      return { status: 200, body: envelope };
    });

    // GET /api/settings/:key
    this.get('/api/settings/:key', async (req) => {
      const key = req.params?.key ?? '';
      const scope = req.query?.scope ?? 'user';
      const record = await this.opts.store.get(key, scope);
      if (!record) return { status: 404, body: { error: 'Setting not found' } };
      return { status: 200, body: { key, scope, value: record.value, source: 'stored' } };
    });

    // PUT /api/settings/:key
    this.put('/api/settings/:key', (req) => {
      const key = req.params?.key ?? '';
      // key is carried by the URL path, not the body; inject it so the schema can
      // validate the full record regardless of the client-supplied payload.
      const payload =
        typeof req.body === 'object' && req.body !== null ? { key, ...(req.body as Record<string, unknown>) } : { key };
      const parsed = settingsWriteBodySchema.safeParse(payload);
      if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid settings payload', details: parsed.error.flatten() } };
      }
      const { value, scope } = parsed.data;
      if (this.opts.validator) {
        const invalid = this.opts.validator(key, value);
        if (invalid !== null) return { status: 400, body: { error: invalid } };
      }
      const userId = this.opts.identity.resolveUserId(req) ?? 'system';
      this.opts.store.set({ key, scope, value, updatedBy: userId, updatedAt: Date.now(), version: 0 });
      return { status: 200, body: { key, scope, value } };
    });

    // DELETE /api/settings/:key
    this.delete('/api/settings/:key', (req) => {
      const key = req.params?.key ?? '';
      const scope = req.query?.scope ?? 'user';
      const removed = this.opts.store.remove(key, scope);
      if (!removed) return { status: 404, body: { error: 'Setting not found' } };
      return { status: 200, body: { ok: true } };
    });
  }
}
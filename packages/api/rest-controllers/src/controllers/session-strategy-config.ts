/**
 * Session strategy configuration controller (F33 Phase 3; pure + injectable store).
 *
 * GET    /api/config/session-strategy            — all variant cats' effective strategy + source
 * PATCH  /api/config/session-strategy/:catId     — set a runtime override
 * DELETE /api/config/session-strategy/:catId     — remove runtime override (fall back to lower sources)
 */

import { z } from 'zod';
import { RestControllerBase } from '../ports/http.ts';
import {
  executionStatusFor,
  getSessionStrategyWithSource,
  type SessionStrategyLowerSource,
  type SessionStrategyOverrideStore,
  UNAVAILABLE_CONTEXT_CAPABILITY,
} from '../pure/session-strategy.ts';
import type { AgentContextCapability } from '../contract/session.ts';

const setOverrideSchema = z.object({
  strategy: z.record(z.string(), z.unknown()),
});

export interface SessionStrategyConfigControllerOptions {
  /** All registered variant cat ids. */
  cats: string[];
  overrideStore: SessionStrategyOverrideStore;
  lowerSource: SessionStrategyLowerSource;
  /** Optional per-cat context capability probe (defaults to unavailable). */
  resolveContextCapability?: (catId: string) => AgentContextCapability;
}

export class SessionStrategyConfigController extends RestControllerBase {
  constructor(private readonly opts: SessionStrategyConfigControllerOptions) {
    super();
    this.registerRoutes();
  }

  private capabilityFor(catId: string): AgentContextCapability {
    return this.opts.resolveContextCapability ? this.opts.resolveContextCapability(catId) : UNAVAILABLE_CONTEXT_CAPABILITY;
  }

  private registerRoutes(): void {
    this.get('/api/config/session-strategy', () => {
      const configs = this.opts.cats.map((catId) => {
        const effective = getSessionStrategyWithSource(catId, {
          overrideStore: this.opts.overrideStore,
          lowerSource: this.opts.lowerSource,
        });
        return {
          catId,
          strategy: effective.strategy,
          source: effective.source,
          execution: executionStatusFor(this.capabilityFor(catId), effective.strategy),
        };
      });
      return { status: 200, body: { configs } };
    });

    this.patch('/api/config/session-strategy/:catId', (req) => {
      const catId = req.params?.catId ?? '';
      if (!this.opts.cats.includes(catId)) {
        return { status: 404, body: { error: `Unknown cat: ${catId}` } };
      }
      const parsed = setOverrideSchema.safeParse(req.body);
      if (!parsed.success) {
        return { status: 400, body: { error: 'Invalid strategy', details: parsed.error.flatten() } };
      }
      this.opts.overrideStore.set(catId, parsed.data.strategy);
      return {
        status: 200,
        body: getSessionStrategyWithSource(catId, {
          overrideStore: this.opts.overrideStore,
          lowerSource: this.opts.lowerSource,
        }),
      };
    });

    this.delete('/api/config/session-strategy/:catId', (req) => {
      const catId = req.params?.catId ?? '';
      this.opts.overrideStore.delete(catId);
      return {
        status: 200,
        body: getSessionStrategyWithSource(catId, {
          overrideStore: this.opts.overrideStore,
          lowerSource: this.opts.lowerSource,
        }),
      };
    });
  }
}
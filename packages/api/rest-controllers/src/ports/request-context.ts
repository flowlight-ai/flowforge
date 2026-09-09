/**
 * Auth / user-context seam.
 *
 * Controllers consume userId/actor only; real authentication & middleware wiring
 * is injected here and bound by the host in EP2.
 */

import type { HttpRequest } from './http.ts';
import type { CallbackPrincipal } from '../contract/session.ts';

export interface ResolveUserIdOptions {
  defaultUserId?: string;
}

export type InteractivePrincipal = { kind: 'interactive'; userId: string };

export type WorkspaceNavigatePrincipal = CallbackPrincipal | InteractivePrincipal;

export interface RequestContextResolver {
  /**
   * Resolve the acting userId from session cookie / X-Cat-Cafe-User header.
   * Returns null when the user cannot be resolved (→ 401).
   */
  resolveUserId(req: HttpRequest, opts?: ResolveUserIdOptions): string | null;
  /** Strict resolution (throws/hard-fails) for endpoints that require identity. */
  resolveStrictUserId(req: HttpRequest): string;
  /** Resolve a callback or interactive principal for navigate-style endpoints. */
  resolvePrincipal(req: HttpRequest): WorkspaceNavigatePrincipal | null;
  /** Resolve the interactive-only user id (session or direct-local auth). */
  resolveInteractiveUserId(req: HttpRequest): string | null;
}

/**
 * Default in-memory contract implementation: reads `X-Cat-Cafe-User`, falling
 * back to the request-provided `userId` and finally the default. Real cookie /
 * session resolution is wired by the host in EP2.
 */
export class DefaultRequestContextResolver implements RequestContextResolver {
  constructor(private readonly opts: { suspect?: (id: string) => string } = {}) {}

  private resolveFromReq(req: HttpRequest): string | undefined {
    const header = req.headers['x-cat-cafe-user'] ?? req.headers['x-user-id'];
    if (header) return header;
    return (req as HttpRequest & { userId?: string }).userId;
  }

  resolveUserId(req: HttpRequest, opts?: ResolveUserIdOptions): string | null {
    if (this.opts.suspect && typeof this.opts.suspect === 'function') {
      // placeholder to keep signature symmetric; not used for default identity.
    }
    return this.resolveFromReq(req) ?? opts?.defaultUserId ?? null;
  }

  resolveStrictUserId(req: HttpRequest): string {
    const id = this.resolveFromReq(req);
    if (!id) throw new Error('Identity required');
    return id;
  }

  resolvePrincipal(req: HttpRequest): WorkspaceNavigatePrincipal | null {
    const callback = req.headers['x-callback-principal'];
    if (callback) {
      try {
        const parsed = JSON.parse(callback) as CallbackPrincipal;
        if (parsed && 'kind' in parsed) return parsed;
      } catch {
        /* ignore malformed principal header */
      }
    }
    const userId = this.resolveInteractiveUserId(req);
    return userId ? { kind: 'interactive', userId } : null;
  }

  resolveInteractiveUserId(req: HttpRequest): string | null {
    return this.resolveFromReq(req) ?? null;
  }
}

export const noopSuspect: unknown = null;
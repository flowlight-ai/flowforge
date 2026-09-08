/**
 * Workspace navigate controller — authorized navigation to a workspace target.
 *
 * Rebuilds clowder routes/workspace-navigate-handler.ts. Preflights a skill
 * consumption receipt and broadcasts an in-app navigation intent via the socket
 * seam. The callback-principal / interactive identity is resolved by the injected
 * `RequestContextResolver`.
 */

import { MESSAGES } from '../contract/messages.ts';
import { RestControllerBase } from '../ports/http.ts';
import type { RequestContextResolver, WorkspaceNavigatePrincipal } from '../ports/request-context.ts';
import type {
  SkillConsumptionReceiptService,
  SocketManagerSeam,
} from '../ports/skill-receipt.ts';
import {
  skillConsumptionFailureStatus,
  skillConsumptionScope,
  workspaceDeliveryStatus,
} from '../ports/skill-receipt.ts';

export interface WorkspaceNavigateControllerOptions {
  identity: RequestContextResolver;
  navigation: WorkspaceNavigationPort;
  /** In-app socket broadcast seam (host binds socket.io in EP2). */
  socket?: SocketManagerSeam;
  /** Skill consumption preflight seam (host binds in EP2). */
  skillReceipts?: SkillConsumptionReceiptService;
  /** Resolve a principal into a concrete workspace target. */
  resolveTarget?: (principal: WorkspaceNavigatePrincipal, input: { href: string }) => Promise<unknown> | unknown;
}

/** Injected navigation sink — the host performs the real project/workspace open. */
export interface WorkspaceNavigationPort {
  navigate(input: { href: string; principal: WorkspaceNavigatePrincipal; target?: unknown }): void | Promise<void>;
}

export class NoopWorkspaceNavigation implements WorkspaceNavigationPort {
  async navigate(): Promise<void> {
    /* contract no-op; host wires real navigation in EP2. */
  }
}

export class WorkspaceNavigateController extends RestControllerBase {
  constructor(private readonly opts: WorkspaceNavigateControllerOptions) {
    super();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    // POST /api/workspace/navigate
    this.post('/api/workspace/navigate', async (req) => {
      const body = req.body as Record<string, unknown> | undefined;
      const href = typeof body?.href === 'string' ? body.href : '';
      if (!href) return { status: 400, body: { error: MESSAGES.hrefRequired } };
      if (href.length > 200) return { status: 400, body: { error: MESSAGES.queryTooLong } };

      const principal = this.opts.identity.resolvePrincipal(req);
      if (!principal) return { status: 401, body: { error: MESSAGES.authenticationRequired } };

      // Skill-consumption preflight for invocation principals.
      if (principal.kind === 'invocation' && this.opts.skillReceipts) {
        const scope = skillConsumptionScope(principal);
        const preflight = await this.opts.skillReceipts.verifyPrepared('workspace.navigate', scope, 'web');
        if (!preflight.ok) {
          return { status: skillConsumptionFailureStatus(preflight.reason ?? ''), body: { error: preflight.reason } };
        }
      }

      let target: unknown;
      try {
        target = this.opts.resolveTarget ? await this.opts.resolveTarget(principal, { href }) : undefined;
      } catch {
        return { status: 500, body: { error: MESSAGES.internalError } };
      }

      // Emit an in-app broadcast intent (best-effort).
      const delivery: unknown = await this.opts.navigation.navigate({ href, principal, target });

      // Record applied receipt best-effort.
      const deliveryStatus = workspaceDeliveryStatus(delivery) ?? 'queued';
      if (principal.kind === 'invocation' && this.opts.skillReceipts) {
        const scope = skillConsumptionScope(principal);
        void this.opts.skillReceipts
          .recordApplied({ handle: 'workspace.navigate', scope, outcome: { kind: 'navigation', deliveryStatus } })
          .catch(() => {});
      }
      return { status: 200, body: { href, deliveryStatus, target } };
    });
  }
}
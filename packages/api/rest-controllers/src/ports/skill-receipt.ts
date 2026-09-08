/**
 * Misc seams: skill-consumption receipts + socket broadcast.
 */

import type { HttpRequest } from './http.ts';

/** Skill consumption receipt seam (F095 phase F); host binds real service in EP2. */
export interface SkillConsumptionReceiptService {
  verifyPrepared(
    handle: string,
    scope: SkillConsumptionScope,
    consumer: string,
  ): Promise<{ ok: boolean; reason?: string }>;
  recordApplied(input: {
    handle: string;
    scope: SkillConsumptionScope;
    outcome: { kind: string; deliveryStatus: string };
  }): Promise<{ ok: boolean; reason?: string; receipt?: unknown }>;
}

export interface SkillConsumptionScope {
  userId: string;
  threadId: string;
  invocationId: string;
  catId: string;
}

export class UnavailableSkillConsumptionReceiptService implements SkillConsumptionReceiptService {
  async verifyPrepared(handle: string, scope: SkillConsumptionScope, consumer: string): Promise<{ ok: boolean }> {
    void handle;
    void scope;
    void consumer;
    return { ok: true };
  }
  async recordApplied(input: {
    handle: string;
    scope: SkillConsumptionScope;
    outcome: { kind: string; deliveryStatus: string };
  }): Promise<{ ok: boolean; receipt?: unknown }> {
    return { ok: true, receipt: { intraday: input.handle } };
  }
}

/** Socket broadcast seam (host binds real socket.io in EP2). */
export interface SocketManagerSeam {
  broadcastToRoom(room: string, event: string, data: unknown): void;
}

export class MemorySocketManager implements SocketManagerSeam {
  readonly emitted: Array<{ room: string; event: string; data: unknown }> = [];
  broadcastToRoom(room: string, event: string, data: unknown): void {
    this.emitted.push({ room, event, data });
  }
}

import type { WorkspaceNavigatePrincipal } from './request-context.ts';

/** Skill consumption preflight outcome resolver (pure). */
export function skillConsumptionFailureStatus(reason: string): number {
  if (reason === 'expired') return 410;
  if (reason === 'source_revision_changed' || reason === 'already_consumed') return 409;
  return 404;
}

export function skillConsumptionScope(principal: Extract<WorkspaceNavigatePrincipal, { kind: 'invocation' }>): SkillConsumptionScope {
  return {
    userId: principal.userId,
    threadId: principal.threadId,
    invocationId: principal.invocationId,
    catId: principal.catId,
  };
}

export function workspaceDeliveryStatus(value: unknown): 'applied' | 'queued' | 'blocked' | 'unconfirmed' | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = (value as { deliveryStatus?: unknown }).deliveryStatus;
  return candidate === 'applied' || candidate === 'queued' || candidate === 'blocked' || candidate === 'unconfirmed'
    ? candidate
    : null;
}

export function isRawRequest(req: HttpRequest): boolean {
  return req.headers['content-type'] === 'application/octet-stream';
}
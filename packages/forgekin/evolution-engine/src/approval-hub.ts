/**
 * CL-033 Approval Hub — 跨 thread 统一审批中心。
 * TS 重写自 Python `core/approval_hub.py`（内存骨架实现，对齐原文语义）。
 *
 * 职责：
 * - 接收 Forgekin 提交的审批请求
 * - operator 一键 approve / reject / defer
 * - 超时自动拒绝（purgeExpired 标记为 expired）
 * - 统计待审批/已决策分布
 */

/** 审批请求类型。 */
export const APPROVAL_REQUEST_TYPES = [
  'code_merge',
  'config_change',
  'schedule_change',
  'scope_expansion',
  'external_call',
] as const;

export type ApprovalRequestType = (typeof APPROVAL_REQUEST_TYPES)[number];

export const APPROVAL_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type ApprovalPriority = (typeof APPROVAL_PRIORITIES)[number];

/** 审批请求（对齐 Python ApprovalRequest）。 */
export interface ApprovalRequest {
  readonly requestId: string;
  /** 发起 Forgekin ID */
  readonly forgekinId: string;
  /** 来源 thread */
  readonly threadId: string;
  readonly requestType: ApprovalRequestType;
  readonly title: string;
  readonly description: string;
  /** PR url / config diff 等 */
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  /** 超时自动拒绝（UTC ISO） */
  readonly expiresAt: string;
  readonly priority: ApprovalPriority;
}

export function makeApprovalRequest(init: {
  requestId: string;
  forgekinId: string;
  threadId: string;
  requestType: ApprovalRequestType;
  title: string;
  description: string;
  expiresAt: string | Date;
  payload?: Record<string, unknown>;
  priority?: ApprovalPriority;
  createdAt?: string;
}): ApprovalRequest {
  return {
    requestId: init.requestId,
    forgekinId: init.forgekinId,
    threadId: init.threadId,
    requestType: init.requestType,
    title: init.title,
    description: init.description,
    payload: { ...(init.payload ?? {}) },
    createdAt: init.createdAt ?? new Date().toISOString(),
    expiresAt:
      init.expiresAt instanceof Date
        ? init.expiresAt.toISOString()
        : typeof init.expiresAt === 'number'
          ? new Date(init.expiresAt).toISOString()
          : init.expiresAt,
    priority: init.priority ?? 'medium',
  };
}

export const APPROVAL_DECISIONS = ['approved', 'rejected', 'deferred'] as const;
export type ApprovalDecisionKind = (typeof APPROVAL_DECISIONS)[number];

/** 审批决策（对齐 Python ApprovalDecision）。 */
export interface ApprovalDecision {
  readonly requestId: string;
  readonly decision: ApprovalDecisionKind;
  /** operator 或代理 Forgekin ID */
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly comments: string;
  /** 批准条件（如 "需夏洛克 review 后合入"） */
  readonly conditions: string[];
}

export interface ApprovalHubStats {
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
  readonly deferred: number;
  readonly expired: number;
}

function isExpired(expiresAt: string, nowMs: number): boolean {
  return Date.parse(expiresAt) < nowMs;
}

/**
 * Approval Hub — 跨 thread 统一审批中心（内存实现）。
 *
 * 决策校验：request_id 存在 + 未过期 + 未决策，三者任一不满足即失败。
 */
export class ApprovalHub {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly decisions = new Map<string, ApprovalDecision>();
  private readonly nowFn: () => number;

  constructor(options: { nowFn?: () => number } = {}) {
    this.nowFn = options.nowFn ?? Date.now;
  }

  /** 提交审批，返回 request_id。 */
  submit(request: ApprovalRequest): string {
    this.requests.set(request.requestId, request);
    return request.requestId;
  }

  /** 获取单个审批请求。 */
  get(requestId: string): ApprovalRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /** 列出待审批（未决策且未过期），可按 forgekin_id 过滤。 */
  listPending(forgekinId?: string): ApprovalRequest[] {
    const nowMs = this.nowFn();
    const pending: ApprovalRequest[] = [];
    for (const [rid, req] of this.requests) {
      if (this.decisions.has(rid)) continue;
      if (isExpired(req.expiresAt, nowMs)) continue;
      if (forgekinId !== undefined && req.forgekinId !== forgekinId) continue;
      pending.push(req);
    }
    return pending;
  }

  /** 列出所有审批请求，可按 status 过滤（pending/approved/rejected/deferred/expired）。 */
  listAll(status?: string): ApprovalRequest[] {
    const nowMs = this.nowFn();
    const result: ApprovalRequest[] = [];
    for (const [rid, req] of this.requests) {
      const decision = this.decisions.get(rid);
      let reqStatus: string;
      if (decision === undefined) {
        reqStatus = isExpired(req.expiresAt, nowMs) ? 'expired' : 'pending';
      } else if (decision.decision === 'deferred' && decision.comments === 'expired') {
        reqStatus = 'expired';
      } else {
        reqStatus = decision.decision;
      }
      if (status === undefined || reqStatus === status) {
        result.push(req);
      }
    }
    return result;
  }

  /** 决策（自动校验 request_id 存在 + 未过期 + 未决策）。 */
  decide(decision: Omit<ApprovalDecision, 'decidedAt' | 'conditions' | 'comments'> & {
    decidedAt?: string;
    comments?: string;
    conditions?: string[];
  }): { ok: boolean; reason: string } {
    const req = this.requests.get(decision.requestId);
    if (req === undefined) {
      return { ok: false, reason: `request_id 不存在: ${decision.requestId}` };
    }
    if (isExpired(req.expiresAt, this.nowFn())) {
      return { ok: false, reason: `request 已过期: ${decision.requestId}` };
    }
    if (this.decisions.has(decision.requestId)) {
      return { ok: false, reason: `request 已决策: ${decision.requestId}` };
    }
    this.decisions.set(decision.requestId, {
      requestId: decision.requestId,
      decision: decision.decision,
      decidedBy: decision.decidedBy,
      comments: decision.comments ?? '',
      conditions: decision.conditions ?? [],
      decidedAt: decision.decidedAt ?? new Date().toISOString(),
    });
    return { ok: true, reason: 'ok' };
  }

  /** operator 一键批准（decide 的便捷封装）。 */
  approve(params: {
    requestId: string;
    decidedBy: string;
    comments?: string;
    conditions?: string[];
  }): { ok: boolean; reason: string } {
    return this.decide({
      requestId: params.requestId,
      decision: 'approved',
      decidedBy: params.decidedBy,
      comments: params.comments ?? '',
      conditions: params.conditions ?? [],
    });
  }

  /** operator 一键拒绝（decide 的便捷封装）。 */
  reject(params: {
    requestId: string;
    decidedBy: string;
    comments?: string;
  }): { ok: boolean; reason: string } {
    return this.decide({
      requestId: params.requestId,
      decision: 'rejected',
      decidedBy: params.decidedBy,
      comments: params.comments ?? '',
    });
  }

  /** 清理过期请求，返回清理数量（标记为 deferred + comments=expired）。 */
  purgeExpired(): number {
    const nowMs = this.nowFn();
    const expiredIds: string[] = [];
    for (const [rid, req] of this.requests) {
      if (isExpired(req.expiresAt, nowMs) && !this.decisions.has(rid)) {
        expiredIds.push(rid);
      }
    }
    for (const rid of expiredIds) {
      this.decisions.set(rid, {
        requestId: rid,
        decision: 'deferred',
        decidedBy: 'system',
        decidedAt: new Date().toISOString(),
        comments: 'expired',
        conditions: [],
      });
    }
    return expiredIds.length;
  }

  /** 统计 {pending, approved, rejected, deferred, expired}。 */
  getStats(): ApprovalHubStats {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let deferred = 0;
    let expired = 0;
    const nowMs = this.nowFn();
    for (const [rid, req] of this.requests) {
      const decision = this.decisions.get(rid);
      if (decision === undefined) {
        if (isExpired(req.expiresAt, nowMs)) {
          expired += 1;
        } else {
          pending += 1;
        }
      } else if (decision.decision === 'approved') {
        approved += 1;
      } else if (decision.decision === 'rejected') {
        rejected += 1;
      } else if (decision.decision === 'deferred') {
        if (decision.comments === 'expired') {
          expired += 1;
        } else {
          deferred += 1;
        }
      }
    }
    return { pending, approved, rejected, deferred, expired };
  }
}

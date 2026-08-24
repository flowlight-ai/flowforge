/**
 * approval-hub — T7.20 CL-033 Approval Hub 统一审批中心验证。
 *
 * 覆盖：submit/get / listPending 过滤（未决策 + 未过期 + forgekin 过滤）/
 * decide 三重校验 / approve/reject 便捷封装 / purgeExpired / getStats /
 * listAll 状态映射。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { describe, expect, it } from 'vitest';
import {
  ApprovalHub,
  makeApprovalRequest,
} from '../src/approval-hub.js';

function makeRequest(hub: ApprovalHub, init: Record<string, unknown> = {}) {
  const now = Date.now();
  const expiresAt = (init['expiresAt'] as number | undefined) ?? now + 60_000;
  const req = makeApprovalRequest({
    requestId: init['requestId'] as string ?? `req-${Math.random()}`,
    forgekinId: init['forgekinId'] as string ?? 'luban',
    threadId: 'self_dev:framework',
    requestType: 'config_change',
    title: 'Framework 变更',
    description: 'desc',
    expiresAt: new Date(expiresAt),
  });
  hub.submit(req);
  return req;
}

describe('ApprovalHub', () => {
  it('submit/get 往返', () => {
    const hub = new ApprovalHub();
    const req = makeRequest(hub, { requestId: 'req-1' });
    expect(hub.get('req-1')).toEqual(req);
    expect(hub.get('nope')).toBeNull();
  });

  it('listPending 仅未决策且未过期，可按 forgekin_id 过滤', () => {
    const now = Date.now();
    const hub = new ApprovalHub({ nowFn: () => now });
    makeRequest(hub, { requestId: 'a', forgekinId: 'luban', expiresAt: now + 60_000 });
    makeRequest(hub, { requestId: 'b', forgekinId: 'sherlock', expiresAt: now + 60_000 });
    makeRequest(hub, { requestId: 'c', forgekinId: 'luban', expiresAt: now - 1 }); // 已过期

    expect(hub.listPending().map((r) => r.requestId)).toEqual(['a', 'b']);
    expect(hub.listPending('luban').map((r) => r.requestId)).toEqual(['a']);

    // 决策后不再 pending
    hub.approve({ requestId: 'a', decidedBy: 'operator' });
    expect(hub.listPending().map((r) => r.requestId)).toEqual(['b']);
  });

  it('decide 三重校验：不存在 / 已过期 / 已决策', () => {
    const now = Date.now();
    const hub = new ApprovalHub({ nowFn: () => now });
    makeRequest(hub, { requestId: 'a', expiresAt: now + 60_000 });
    makeRequest(hub, { requestId: 'b', expiresAt: now - 1 });

    expect(hub.decide({ requestId: 'nope', decision: 'approved', decidedBy: 'op' }).ok).toBe(false);
    expect(hub.decide({ requestId: 'b', decision: 'approved', decidedBy: 'op' }).ok).toBe(false);

    const first = hub.approve({ requestId: 'a', decidedBy: 'operator' });
    expect(first.ok).toBe(true);
    const second = hub.approve({ requestId: 'a', decidedBy: 'operator' });
    expect(second.ok).toBe(false);
    expect(second.reason).toContain('已决策');
  });

  it('approve/reject 便捷封装记录决策', () => {
    const hub = new ApprovalHub();
    makeRequest(hub, { requestId: 'a' });
    makeRequest(hub, { requestId: 'b' });

    hub.approve({ requestId: 'a', decidedBy: 'operator', comments: 'ok', conditions: ['需 review'] });
    hub.reject({ requestId: 'b', decidedBy: 'operator', comments: 'no' });

    const stats = hub.getStats();
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
  });

  it('purgeExpired 标记过期请求为 deferred+expired 并返回数量', () => {
    const now = Date.now();
    const hub = new ApprovalHub({ nowFn: () => now });
    makeRequest(hub, { requestId: 'expired', expiresAt: now - 1 });
    makeRequest(hub, { requestId: 'fresh', expiresAt: now + 60_000 });

    expect(hub.purgeExpired()).toBe(1);
    const stats = hub.getStats();
    expect(stats.expired).toBe(1);
    expect(stats.pending).toBe(1);

    // 二次 purge 不重复计数
    expect(hub.purgeExpired()).toBe(0);
  });

  it('getStats 全量分布：pending/approved/rejected/deferred/expired', () => {
    const now = Date.now();
    const hub = new ApprovalHub({ nowFn: () => now });
    makeRequest(hub, { requestId: 'p', expiresAt: now + 60_000 }); // pending
    makeRequest(hub, { requestId: 'ap', expiresAt: now + 60_000 }); // approved
    makeRequest(hub, { requestId: 'rj', expiresAt: now + 60_000 }); // rejected
    makeRequest(hub, { requestId: 'df', expiresAt: now + 60_000 }); // deferred (manual)
    makeRequest(hub, { requestId: 'ex', expiresAt: now - 1 }); // expired

    hub.approve({ requestId: 'ap', decidedBy: 'op' });
    hub.reject({ requestId: 'rj', decidedBy: 'op' });
    hub.decide({ requestId: 'df', decision: 'deferred', decidedBy: 'op', comments: '稍后' });
    hub.purgeExpired();

    expect(hub.getStats()).toEqual({
      pending: 1,
      approved: 1,
      rejected: 1,
      deferred: 1,
      expired: 1,
    });
  });

  it('listAll 状态映射：pending/approved/rejected/deferred/expired', () => {
    const now = Date.now();
    const hub = new ApprovalHub({ nowFn: () => now });
    makeRequest(hub, { requestId: 'p', expiresAt: now + 60_000 });
    makeRequest(hub, { requestId: 'ap', expiresAt: now + 60_000 });
    makeRequest(hub, { requestId: 'ex', expiresAt: now - 1 });

    hub.approve({ requestId: 'ap', decidedBy: 'op' });

    expect(hub.listAll('pending').map((r) => r.requestId)).toEqual(['p']);
    expect(hub.listAll('approved').map((r) => r.requestId)).toEqual(['ap']);
    expect(hub.listAll('expired').map((r) => r.requestId)).toEqual(['ex']);
    expect(hub.listAll()).toHaveLength(3);
  });
});

/**
 * C25 Concierge Stores 测试（F229，clowder concierge stores 直译）。
 *
 * 覆盖：
 *  - MemoryConciergeKeyValueStore CAS 语义（setNx/deleteIf/addToSet）
 *  - RelayReceipt 状态机（INV R1-R4：先落记录、手动重试、索引）
 *  - PendingConfirmation 状态机（INV C1/C3：持久化保持、双发防护靠 CAS）
 *  - TriagePlan 状态机（INV T1-T3：proposed 先落、确认后 dispatch、failed 重试）
 *    + claimTransition CAS 防并发双 dispatch
 *  - InvestigationJob 状态机（INV I1-I3：fail-closed deadline、done 必有 report、
 *    claimDoneWithReport 原子性）+ isJobExpired
 *  - ConciergeConfigStore 默认解析（gemini35 → roster[0] → sonnet）+ FIX-3 stale 校验
 */

import { describe, expect, it } from 'vitest';
import type {
  ConfirmationStatus,
  InvestigationJob,
  InvestigationJobStatus,
  PendingConfirmation,
  RelayReceipt,
  RelayReceiptStatus,
  TriagePlan,
  TriagePlanStatus,
} from '../src/models.js';
import { MemoryConciergeKeyValueStore } from '../src/concierge/kv-store.js';
import { KvConciergeRelayStore } from '../src/concierge/relay-store.js';
import { KvConciergeConfirmationStore } from '../src/concierge/confirmation-store.js';
import { KvConciergeTriagePlanStore } from '../src/concierge/triage-plan-store.js';
import {
  KvConciergeInvestigationJobStore,
  isJobExpired,
} from '../src/concierge/investigation-job-store.js';
import { KvConciergeConfigStore, resolveDefaultDutyCatProfileId } from '../src/concierge/config-store.js';

const T0 = 1_700_000_000_000;

// ─── KV store CAS 语义 ─────────────────────────────────────────────────────

describe('C25 MemoryConciergeKeyValueStore：KV + Set 语义', () => {
  it('set/get/覆盖写 + setNx 原子 claim', async () => {
    const kv = new MemoryConciergeKeyValueStore();
    expect(await kv.get('k')).toBeNull();
    await kv.set('k', 'v1');
    expect(await kv.get('k')).toBe('v1');
    expect(await kv.setNx('k', 'v2')).toBe(false); // 已存在 → 拒绝
    expect(await kv.get('k')).toBe('v1');
    await kv.set('k', 'v2'); // 非 NX 覆盖
    expect(await kv.get('k')).toBe('v2');
    expect(await kv.setNx('k2', 'v')).toBe(true);
  });

  it('deleteIf CAS-DEL：值匹配才删', async () => {
    const kv = new MemoryConciergeKeyValueStore();
    await kv.set('k', 'expected');
    expect(await kv.deleteIf('k', 'wrong')).toBe(false);
    expect(await kv.get('k')).toBe('expected');
    expect(await kv.deleteIf('k', 'expected')).toBe(true);
    expect(await kv.get('k')).toBeNull();
  });

  it('addToSet 幂等 + setMembers 去重快照', async () => {
    const kv = new MemoryConciergeKeyValueStore();
    expect(await kv.addToSet('s', 'a')).toBe(true);
    expect(await kv.addToSet('s', 'a')).toBe(false);
    expect(await kv.addToSet('s', 'b')).toBe(true);
    expect((await kv.setMembers('s')).sort()).toEqual(['a', 'b']);
    expect(await kv.setMembers('missing')).toEqual([]);
  });
});

// ─── RelayReceipt（INV R1-R4）──────────────────────────────────────────────

describe('C25 RelayReceipt：draft → confirmed → dispatched | dispatch_failed', () => {
  function receipt(overrides: Partial<RelayReceipt> = {}): RelayReceipt {
    return {
      id: 'r-1',
      userId: 'user-1',
      conciergeThreadId: 'ct-1',
      targetThreadId: 'tt-1',
      targetCats: ['cat-a'],
      originalText: '帮我问问',
      sourceMessageId: 'msg-1',
      clientMessageId: 'cm-1',
      status: 'confirmed',
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    };
  }

  it('INV R1/R4：create 先落记录（get 立即可见），仅索引自己的用户', async () => {
    const store = new KvConciergeRelayStore(new MemoryConciergeKeyValueStore());
    await store.create(receipt());
    expect((await store.get('r-1'))?.status).toBe('confirmed');
    // 旁路禁令：另一个用户看不到
    expect(await store.listByUser('user-2')).toEqual([]);
    const mine = await store.listByUser('user-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.id).toBe('r-1');
  });

  it('INV R2：dispatch_failed 后手动重试 → confirmed（不自动重试）', async () => {
    const store = new KvConciergeRelayStore(new MemoryConciergeKeyValueStore());
    await store.create(receipt());
    await store.updateStatus('r-1', 'dispatch_failed');
    expect((await store.get('r-1'))?.status).toBe('dispatch_failed');
    // 手动重试路径
    await store.updateStatus('r-1', 'confirmed');
    expect((await store.get('r-1'))?.status).toBe('confirmed');
    // 不存在 → 静默
    await store.updateStatus('r-missing', 'dispatched' as RelayReceiptStatus);
  });

  it('INV R3：clientMessageId 幂等 key 原样保留（不重生成）', async () => {
    const store = new KvConciergeRelayStore(new MemoryConciergeKeyValueStore());
    await store.create(receipt({ clientMessageId: 'cm-fixed' }));
    await store.updateStatus('r-1', 'dispatched');
    expect((await store.get('r-1'))?.clientMessageId).toBe('cm-fixed');
  });

  it('listByUser 按 createdAt 倒序（最新在前）', async () => {
    const store = new KvConciergeRelayStore(new MemoryConciergeKeyValueStore());
    await store.create(receipt({ id: 'r-old', createdAt: T0 }));
    await store.create(receipt({ id: 'r-new', createdAt: T0 + 1000 }));
    const mine = await store.listByUser('user-1');
    expect(mine.map((r) => r.id)).toEqual(['r-new', 'r-old']);
  });
});

// ─── PendingConfirmation（INV C1/C3）───────────────────────────────────────

describe('C25 PendingConfirmation：rendered → confirmed | cancelled', () => {
  function confirmation(status: ConfirmationStatus = 'rendered'): PendingConfirmation {
    return {
      id: 'c-1',
      userId: 'user-1',
      messageId: 'msg-1',
      action: { kind: 'concierge_teleport', threadId: 'tt-1' },
      status,
      createdAt: T0,
      updatedAt: T0,
    };
  }

  it('INV C3：确认/取消状态持久化，重新读取保持', async () => {
    const store = new KvConciergeConfirmationStore(new MemoryConciergeKeyValueStore());
    await store.create(confirmation());
    await store.updateStatus('c-1', 'confirmed');
    expect((await store.get('c-1'))?.status).toBe('confirmed');
    await store.updateStatus('c-1', 'cancelled');
    expect((await store.get('c-1'))?.status).toBe('cancelled');
  });

  it('listByUser 索引 + 倒序；不存在静默', async () => {
    const store = new KvConciergeConfirmationStore(new MemoryConciergeKeyValueStore());
    await store.create(confirmation());
    await store.create({ ...confirmation(), id: 'c-2', createdAt: T0 + 1 }); // 同用户第二条
    await store.create({ ...confirmation(), id: 'c-3', userId: 'user-2' });
    const mine = await store.listByUser('user-1');
    expect(mine).toHaveLength(2);
    expect(mine[0]!.id).toBe('c-2');
    await store.updateStatus('missing', 'confirmed');
  });
});

// ─── TriagePlan（INV T1-T3 + CAS）──────────────────────────────────────────

describe('C25 TriagePlan：proposed → confirmed → dispatched → completed | failed', () => {
  function plan(status: TriagePlanStatus = 'proposed', overrides: Partial<TriagePlan> = {}): TriagePlan {
    return {
      id: 'tp-1',
      userId: 'user-1',
      sourceMessageId: 'msg-1',
      originalText: '帮我查一下',
      intent: 'go',
      target: { threadId: 'tt-1', threadTitle: '目标' },
      status,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    };
  }

  it('INV T1/T2：proposed 先落 → confirmed 后 dispatch（状态机顺序）', async () => {
    const store = new KvConciergeTriagePlanStore(new MemoryConciergeKeyValueStore());
    await store.create(plan());
    expect((await store.get('tp-1'))?.status).toBe('proposed');
    await store.updateStatus('tp-1', 'confirmed');
    await store.updateStatus('tp-1', 'dispatched');
    const dispatched = (await store.get('tp-1'))!;
    expect(dispatched.status).toBe('dispatched');
    expect(dispatched.dispatchedAt).toBeDefined();
    await store.updateStatus('tp-1', 'completed');
    const completed = (await store.get('tp-1'))!;
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
  });

  it('INV T3：failed 可手动重试（failed → confirmed → dispatched）', async () => {
    const store = new KvConciergeTriagePlanStore(new MemoryConciergeKeyValueStore());
    await store.create(plan());
    await store.updateStatus('tp-1', 'confirmed');
    await store.updateStatus('tp-1', 'dispatched');
    await store.updateStatus('tp-1', 'failed');
    expect((await store.get('tp-1'))?.status).toBe('failed');
    await store.updateStatus('tp-1', 'confirmed');
    expect((await store.get('tp-1'))?.status).toBe('confirmed');
  });

  it('claimTransition CAS：状态不匹配拒绝（防并发双 dispatch）', async () => {
    const store = new KvConciergeTriagePlanStore(new MemoryConciergeKeyValueStore());
    await store.create(plan());
    expect(await store.claimTransition('tp-1', 'proposed', 'confirmed')).toBe(true);
    // 第二次 claim confirmed（模拟并发）→ 已被消费
    expect(await store.claimTransition('tp-1', 'proposed', 'confirmed')).toBe(false);
    expect((await store.get('tp-1'))?.status).toBe('confirmed');
    // 不存在 → false
    expect(await store.claimTransition('missing', 'proposed', 'confirmed')).toBe(false);
  });

  it('setResult / setTargetCats / setConfirmationMessageId 字段写入', async () => {
    const store = new KvConciergeTriagePlanStore(new MemoryConciergeKeyValueStore());
    await store.create(plan());
    await store.setConfirmationMessageId('tp-1', 'card-msg-9');
    await store.setTargetCats('tp-1', ['cat-b']);
    await store.setResult('tp-1', { relayReceiptId: 'r-9' });
    const saved = (await store.get('tp-1'))!;
    expect(saved.confirmationMessageId).toBe('card-msg-9');
    expect(saved.target.targetCats).toEqual(['cat-b']);
    expect(saved.result?.relayReceiptId).toBe('r-9');
  });
});

// ─── InvestigationJob（INV I1-I3）──────────────────────────────────────────

describe('C25 InvestigationJob：queued → running → done | failed | cancelled', () => {
  function job(status: InvestigationJobStatus = 'queued', overrides: Partial<InvestigationJob> = {}): InvestigationJob {
    return {
      id: 'ij-1',
      userId: 'user-1',
      triagePlanId: 'tp-1',
      query: 'RAG 性能问题',
      scope: ['memory', 'docs'],
      status,
      createdAt: T0,
      updatedAt: T0,
      deadline: T0 + 60_000,
      ...overrides,
    };
  }

  it('INV I3：isJobExpired 仅对非终态生效（deadline 到期 fail-closed）', () => {
    const queued = job('queued');
    expect(isJobExpired(queued, T0 + 59_999)).toBe(false);
    expect(isJobExpired(queued, T0 + 60_000)).toBe(true);
    // 终态永不 expired
    expect(isJobExpired(job('done', { completedAt: T0 }), T0 + 999_999)).toBe(false);
    expect(isJobExpired(job('cancelled'), T0 + 999_999)).toBe(false);
  });

  it('INV I1：queued/running → cancelled；claimTransition CAS 原子', async () => {
    const store = new KvConciergeInvestigationJobStore(new MemoryConciergeKeyValueStore());
    await store.create(job());
    expect(await store.claimTransition('ij-1', 'queued', 'running')).toBe(true);
    expect(await store.claimTransition('ij-1', 'queued', 'running')).toBe(false);
    expect((await store.get('ij-1'))?.status).toBe('running');
    expect(await store.claimTransition('ij-1', 'running', 'cancelled')).toBe(true);
    expect((await store.get('ij-1'))?.status).toBe('cancelled');
  });

  it('INV I2：claimDoneWithReport 原子 — running → done 且 report 同写；非 running 拒绝', async () => {
    const store = new KvConciergeInvestigationJobStore(new MemoryConciergeKeyValueStore());
    await store.create(job());
    // 非 running → 拒绝（done 不可能缺 report）
    expect(
      await store.claimDoneWithReport('ij-1', { summary: 's', anchors: [] }),
    ).toBe(false);
    await store.claimTransition('ij-1', 'queued', 'running');
    const report = {
      summary: '结论',
      anchors: [{ handle: 'R1', kind: 'thread' as const, threadId: 'tt-1', title: 'T', relevance: '高' }],
    };
    expect(await store.claimDoneWithReport('ij-1', report)).toBe(true);
    const done = (await store.get('ij-1'))!;
    expect(done.status).toBe('done');
    expect(done.report?.summary).toBe('结论');
    expect(done.completedAt).toBeDefined();
  });

  it('getByTriagePlan 1:1 关联查找', async () => {
    const store = new KvConciergeInvestigationJobStore(new MemoryConciergeKeyValueStore());
    await store.create(job());
    expect((await store.getByTriagePlan('tp-1'))?.id).toBe('ij-1');
    expect(await store.getByTriagePlan('tp-missing')).toBeNull();
  });

  it('updateStatus 簿记 startedAt/completedAt；不存在静默', async () => {
    const store = new KvConciergeInvestigationJobStore(new MemoryConciergeKeyValueStore());
    await store.create(job());
    await store.updateStatus('ij-1', 'running');
    expect((await store.get('ij-1'))?.startedAt).toBeDefined();
    await store.updateStatus('ij-1', 'done');
    expect((await store.get('ij-1'))?.completedAt).toBeDefined();
    await store.updateStatus('missing', 'cancelled');
  });
});

// ─── ConciergeConfigStore ──────────────────────────────────────────────────

describe('C25 ConciergeConfigStore：默认解析 + FIX-3 stale 校验', () => {
  it('dutyCatProfileId 解析：gemini35 优先 → roster[0] → sonnet', () => {
    expect(resolveDefaultDutyCatProfileId(() => [])).toBe('sonnet');
    expect(resolveDefaultDutyCatProfileId(() => ['cat-a', 'cat-b'])).toBe('cat-a');
    expect(resolveDefaultDutyCatProfileId(() => ['cat-a', 'gemini35'])).toBe('gemini35');
    expect(resolveDefaultDutyCatProfileId()).toBe('sonnet'); // 缺省空 roster
  });

  it('未配置用户返回 defaults（含解析后的 dutyCatProfileId）', async () => {
    const store = new KvConciergeConfigStore(new MemoryConciergeKeyValueStore(), () => ['gemini35', 'cat-a']);
    const config = await store.get('user-1');
    expect(config.enabled).toBe(true);
    expect(config.dutyCatProfileId).toBe('gemini35');
    expect(config.ballPosition).toBeNull();
  });

  it('FIX-3：stale dutyCatProfileId（不在 roster）重新解析', async () => {
    const kv = new MemoryConciergeKeyValueStore();
    const store = new KvConciergeConfigStore(kv, () => ['cat-a']);
    const stale = { ...(await store.get('user-1')), dutyCatProfileId: 'ghost-cat' };
    await store.put('user-1', stale);
    const reloaded = await store.get('user-1');
    expect(reloaded.dutyCatProfileId).toBe('cat-a');
  });

  it('put/get 往返保留用户配置（TTL=0 持久化语义）', async () => {
    const store = new KvConciergeConfigStore(new MemoryConciergeKeyValueStore(), () => []);
    const custom = {
      ...(await store.get('user-1')),
      displayName: '小砚',
      muted: true,
      skin: 'yanyan-codex' as const,
    };
    await store.put('user-1', custom);
    const reloaded = await store.get('user-1');
    expect(reloaded.displayName).toBe('小砚');
    expect(reloaded.muted).toBe(true);
  });
});

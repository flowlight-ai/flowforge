/**
 * C28 HumanDisposition 包测试 — @flowforge/cats-human-disposition。
 *
 * 覆盖：
 *  - ctx.plugin(CatsHumanDisposition) → ctx.catsHumanDisposition 挂载 + 工厂
 *  - F281 类型：feedback discriminatedUnion / ledger entry 身份一致性 / isEligible
 *  - HumanDispositionLedger：Memory KV + CAS append（applied/replay/conflict）
 *    + listByOwner/listBySubject 分页 + cursor 严格校验
 *  - adapters：三场景 build 函数 + opaque proof mint
 *  - context-service：exact-subject 反馈投影（fail-closed + 渲染）
 *  - keys：base64url 编码 + 长度校验
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@flowforge/cordis';
import CatsHumanDisposition, {
  HumanDispositionFeedbackContextService,
  HumanDispositionLedger,
  HumanDispositionLedgerCursorError,
  HumanDispositionLedgerInvariantError,
  InMemoryHumanDispositionReceiptIndex,
  MemoryHumanDispositionLedgerKV,
  buildHumanDispositionLedgerEntry,
  buildHumanDispositionLedgerReceipt,
  buildPersonMemoryDispositionLedgerEntry,
  buildSessionHandoffDispositionLedgerEntry,
  buildWaitCancellationDispositionLedgerEntry,
  humanDispositionLedgerEntrySchema,
  humanDispositionLedgerReceiptSchema,
  humanDispositionFeedbackInputSchema,
  humanDispositionReceiptAppendArguments,
  isHumanDispositionEnvelopeEligible,
  mintPersonMemoryDispositionOpaqueProof,
  type HumanDispositionLedgerEntry,
  type HumanDispositionLedgerKV,
  type HumanDispositionProducerEntryLoader,
  type HumanDispositionServerBinding,
  type SubjectProofResolverPort,
} from '../src/index.js';
import { HumanDispositionKeys } from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withHumanDisposition(): Promise<Context> {
  const ctx = new Context();
  const fiber = await ctx.plugin(CatsHumanDisposition) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

/** 构造一个 canonical server binding（session-handoff 拒绝场景）。 */
function makeBinding(overrides: Partial<HumanDispositionServerBinding> = {}): HumanDispositionServerBinding {
  return {
    interactionKind: 'session_handoff',
    subjectRef: 'session:s-1',
    proposalId: 'proposal-1',
    decision: 'rejected',
    producerCatId: 'codex-sol',
    ownerUserId: 'owner-1',
    decidedAt: 1_700_000_000_000,
    scope: { kind: 'exact_subject' },
    expiry: { kind: 'none' },
    invalidator: { kind: 'none' },
    sourceRef: 'F225:session-handoff:proposal-1:reject',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<HumanDispositionLedgerEntry> = {}): HumanDispositionLedgerEntry {
  return buildHumanDispositionLedgerEntry({ reasonCode: 'wrong_lane' }, makeBinding(overrides.episode as never));
}

/** 内存 producer loader：从 entries 表按 receipt 精确返回（hydrate 一致性校验用）。 */
function memoryLoader(entries: HumanDispositionLedgerEntry[]): HumanDispositionProducerEntryLoader {
  const bySourceRef = new Map(entries.map((e) => [e.episode.sourceRef, e]));
  return {
    async loadEntry({ receipt }) {
      const entry = bySourceRef.get(receipt.sourceRef);
      if (!entry) return null;
      // 对齐 clowder producer 契约：返回的 entry 必须与 receipt 一致，否则 hydrate 拒绝
      return humanDispositionLedgerEntrySchema.parse(entry);
    },
  };
}

describe('C28 HumanDispositionService — Cordis 服务生命周期', () => {
  it('mounts at ctx.catsHumanDisposition after ctx.plugin(CatsHumanDisposition)', async () => {
    const ctx = await withHumanDisposition();
    expect(ctx.catsHumanDisposition).toBeInstanceOf(CatsHumanDisposition);
  });

  it('工厂：createLedger / createContextService / createReceiptIndex', async () => {
    const ctx = await withHumanDisposition();
    const svc = ctx.catsHumanDisposition;
    const ledger = svc.createLedger({ loadEntry: vi.fn(async () => null) });
    expect(ledger).toBeInstanceOf(HumanDispositionLedger);
    const contextSvc = svc.createContextService({
      subjectResolver: { resolve: vi.fn() },
      ledger: { query: vi.fn() },
    });
    expect(contextSvc).toBeInstanceOf(HumanDispositionFeedbackContextService);
    expect(svc.createReceiptIndex()).toBeInstanceOf(InMemoryHumanDispositionReceiptIndex);
  });
});

describe('C28 F281 类型 — zod schemas + 纯函数', () => {
  it('feedback discriminatedUnion：other 需要 detail，其余拒绝额外字段', () => {
    expect(humanDispositionFeedbackInputSchema.parse({ reasonCode: 'wrong' })).toEqual({ reasonCode: 'wrong' });
    expect(humanDispositionFeedbackInputSchema.safeParse({ reasonCode: 'other' }).success).toBe(false);
    expect(humanDispositionFeedbackInputSchema.safeParse({ reasonCode: 'wrong', detail: 'x' }).success).toBe(false);
    expect(humanDispositionFeedbackInputSchema.parse({ reasonCode: 'other', detail: '说不清' }))
      .toEqual({ reasonCode: 'other', detail: '说不清' });
  });

  it('ledger entry：episode 与 envelope 身份必须一致（superRefine）', () => {
    const entry = makeEntry();
    expect(humanDispositionLedgerEntrySchema.parse(entry)).toEqual(entry);
    // 不一致：episode 与 envelope 的 decision 不同
    const broken = {
      ...entry,
      episode: { ...entry.episode, decision: 'cancelled' as const },
    };
    expect(humanDispositionLedgerEntrySchema.safeParse(broken).success).toBe(false);
  });

  it('buildHumanDispositionLedgerReceipt 只含 4 字段', () => {
    const receipt = buildHumanDispositionLedgerReceipt(makeEntry());
    expect(Object.keys(receipt).sort()).toEqual(['decidedAt', 'interactionKind', 'sourceRef', 'subjectRef']);
    expect(humanDispositionLedgerReceiptSchema.parse(receipt)).toEqual(receipt);
  });

  it('isHumanDispositionEnvelopeEligible：autoInject + lineage + invalidator 判定', () => {
    const entry = makeEntry(); // wrong_lane autoInject=true, invalidator none
    const envelope = entry.envelope!;
    expect(
      isHumanDispositionEnvelopeEligible(envelope, {
        subjectRef: envelope.subjectRef,
        proposalLineage: { status: 'not_applicable' },
        now: 1_700_000_001_000,
        invalidatorTruth: { kind: 'none', status: 'not_applicable' },
      }),
    ).toBe(true);
    // reason=other 不自动注入
    const other = buildHumanDispositionLedgerEntry({ reasonCode: 'other', detail: 'x' }, makeBinding());
    expect(
      isHumanDispositionEnvelopeEligible(other.envelope!, {
        subjectRef: other.envelope!.subjectRef,
        proposalLineage: { status: 'not_applicable' },
        now: 1_700_000_001_000,
        invalidatorTruth: { kind: 'none', status: 'not_applicable' },
      }),
    ).toBe(false);
    // subject 不匹配
    expect(
      isHumanDispositionEnvelopeEligible(envelope, {
        subjectRef: 'other-subject',
        proposalLineage: { status: 'not_applicable' },
        now: 1_700_000_001_000,
        invalidatorTruth: { kind: 'none', status: 'not_applicable' },
      }),
    ).toBe(false);
  });
});

describe('C28 HumanDispositionLedger — Memory KV + CAS + 分页', () => {
  function seedLedger(entries: HumanDispositionLedgerEntry[]): { kv: MemoryHumanDispositionLedgerKV; ledger: HumanDispositionLedger } {
    const kv = new MemoryHumanDispositionLedgerKV();
    const loader = memoryLoader(entries);
    const ledger = new HumanDispositionLedger(kv, loader);
    return { kv, ledger };
  }

  it('CAS append：NEW → APPLIED；同 receipt → REPLAY；同 sourceRef 不同内容 → CONFLICT', async () => {
    const { kv, ledger } = seedLedger([]);
    const entry = makeEntry();
    const receipt = buildHumanDispositionLedgerReceipt(entry);
    const args = humanDispositionReceiptAppendArguments('owner-1', receipt);
    expect(await kv.appendReceipt(args)).toBe('APPLIED');
    expect(await kv.appendReceipt(args)).toBe('REPLAY');
    const conflict = { ...receipt, decidedAt: receipt.decidedAt + 1 };
    expect(await kv.appendReceipt(humanDispositionReceiptAppendArguments('owner-1', conflict))).toBe('CONFLICT');
    expect(ledger).toBeDefined();
  });

  it('appendReceipt 拒绝非法 receipt（字段校验）', async () => {
    const kv = new MemoryHumanDispositionLedgerKV();
    const receipt = buildHumanDispositionLedgerReceipt(makeEntry());
    // 对齐 lua 语义：append 参数已序列化为 JSON，坏字段在 KV 内 preflight 拒绝
    const badArgs = {
      keys: humanDispositionReceiptAppendArguments('owner-1', receipt).keys,
      arguments: [
        JSON.stringify({ ...receipt, extra: 'x' }),
        receipt.sourceRef,
        receipt.subjectRef,
        String(receipt.decidedAt),
      ] as [string, string, string, string],
    };
    expect(await kv.appendReceipt(badArgs)).toBe('INVALID_RECEIPT');
  });

  it('get / listByOwner / listBySubject 走 producer hydrate（receipt 一致才返回）', async () => {
    const e1 = makeEntry({ episode: { decidedAt: 100 } as never });
    const e2 = makeEntry({ episode: { decidedAt: 200, subjectRef: 'session:s-2', sourceRef: 'F225:session-handoff:proposal-2:reject' } as never });
    const { kv, ledger } = seedLedger([e1, e2]);
    for (const e of [e1, e2]) {
      await kv.appendReceipt(humanDispositionReceiptAppendArguments('owner-1', buildHumanDispositionLedgerReceipt(e)));
    }

    const byOwner = await ledger.listByOwner('owner-1', { limit: 10 });
    expect(byOwner.entries).toHaveLength(2);
    expect(byOwner.entries[0].episode.decidedAt).toBe(200); // zrevrange 倒序

    const bySubject = await ledger.listBySubject('owner-1', 'session:s-2', { limit: 10 });
    expect(bySubject.entries).toHaveLength(1);
    expect(bySubject.entries[0].episode.subjectRef).toBe('session:s-2');

    expect(await ledger.get('owner-1', e1.episode.sourceRef)).not.toBeNull();
    expect(await ledger.get('owner-1', 'missing')).toBeNull();
  });

  it('query：interactionKind 过滤 + cursor 严格校验（失效 cursor 抛错）', async () => {
    const e1 = makeEntry({ episode: { decidedAt: 100 } as never });
    const e2 = buildHumanDispositionLedgerEntry(undefined, makeBinding({ interactionKind: 'wait_cancel', decision: 'cancelled', sourceRef: 'wc:1', decidedAt: 200 }));
    const { kv, ledger } = seedLedger([e1, e2]);
    for (const e of [e1, e2]) {
      await kv.appendReceipt(humanDispositionReceiptAppendArguments('owner-1', buildHumanDispositionLedgerReceipt(e)));
    }

    const filtered = await ledger.query('owner-1', { limit: 10, interactionKind: 'wait_cancel' });
    expect(filtered.entries).toHaveLength(1);
    expect(filtered.entries[0].episode.interactionKind).toBe('wait_cancel');

    // 严格模式：cursor 不存在 → CursorError；cursor 存在但 score 不匹配 → CursorError
    await expect(
      ledger.query('owner-1', { limit: 10, cursor: { sourceRef: 'nope', decidedAt: 1 } }),
    ).rejects.toThrow(HumanDispositionLedgerCursorError);
    await expect(
      ledger.query('owner-1', { limit: 10, cursor: { sourceRef: e1.episode.sourceRef, decidedAt: 999 } }),
    ).rejects.toThrow(HumanDispositionLedgerCursorError);
  });

  it('strictHydration：索引存在但 producer 无法 hydrate → InvariantError', async () => {
    const kv = new MemoryHumanDispositionLedgerKV();
    const ledger = new HumanDispositionLedger(kv, { loadEntry: vi.fn(async () => null) });
    const entry = makeEntry();
    await kv.appendReceipt(humanDispositionReceiptAppendArguments('owner-1', buildHumanDispositionLedgerReceipt(entry)));
    await expect(ledger.query('owner-1', { limit: 10 })).rejects.toThrow(HumanDispositionLedgerInvariantError);
  });
});

describe('C28 adapters — 三场景 ledger entry', () => {
  it('session-handoff 拒绝', () => {
    const entry = buildSessionHandoffDispositionLedgerEntry({
      proposal: { proposalId: 'p-1', sourceSessionId: 's-1', sourceCatId: 'cat-1', userId: 'u-1' },
      decidedAt: 100,
      feedback: { reasonCode: 'wrong_lane' },
    });
    expect(entry.episode.interactionKind).toBe('session_handoff');
    expect(entry.episode.decision).toBe('rejected');
    expect(entry.envelope?.feedback.reasonCode).toBe('wrong_lane');
  });

  it('person-memory proposal 拒绝（opaque proof）+ mint 校验', () => {
    const proof = mintPersonMemoryDispositionOpaqueProof(() => new Uint8Array(32).fill(7));
    expect(proof.opaqueLineageHandle).toMatch(/^f281_lineage_[A-Za-z0-9_-]{43}$/);
    const entry = buildPersonMemoryDispositionLedgerEntry({
      canonical: { ownerUserId: 'u-1', requesterCatId: 'cat-1' },
      proof,
      decidedAt: 200,
      feedback: { reasonCode: 'wrong' },
    });
    expect(entry.episode.subjectRef).toBe(proof.opaqueLineageHandle);
    expect(entry.episode.invalidator).toBeUndefined(); // episode 无 invalidator
    expect(entry.envelope?.invalidator).toEqual({
      kind: 'source_superseded',
      supersessionKey: proof.opaqueSupersessionHandle,
    });
  });

  it('wait-cancel（actor 必须匹配 owner，否则拒绝）', () => {
    const event = {
      v: 1 as const,
      eventId: 'wait-termination:hold_ball:hold-ball-123:user_cancel',
      kind: 'wait.terminated' as const,
      waitId: 'hold-ball-123',
      waitKind: 'hold_ball' as const,
      generation: 1,
      subjectRef: 'wait:hold_ball:hold-ball-123',
      threadId: 'thread-1',
      ownerUserId: 'owner-1',
      ownerCatId: 'codex-sol',
      reason: 'user_cancel' as const,
      actor: { kind: 'user' as const, userId: 'owner-1' },
      at: 123,
    };
    const entry = buildWaitCancellationDispositionLedgerEntry({ event });
    expect(entry.episode.decision).toBe('cancelled');
    expect(entry.episode.sourceRef).toBe(event.eventId);
    expect(() =>
      buildWaitCancellationDispositionLedgerEntry({
        event: { ...event, actor: { kind: 'user', userId: 'someone-else' } } as never,
      }),
    ).toThrow();
  });
});

describe('C28 context-service — exact-subject 反馈投影', () => {
  it('无验证候选 → 返回空字符串', async () => {
    const svc = new HumanDispositionFeedbackContextService({
      subjectResolver: { resolve: vi.fn(async () => ({ status: 'unknown' })) },
      ledger: { query: vi.fn() },
    });
    expect(await svc.prepare({ ownerUserId: 'u-1', text: '昨天的代码评审' })).toBe('');
  });

  it('验证候选 + eligible envelope → 渲染定向修正上下文', async () => {
    // person-memory 拒绝：invalidator=source_superseded 才可被 exact-subject 反馈引擎拾取
    const proof = mintPersonMemoryDispositionOpaqueProof(() => new Uint8Array(32).fill(7));
    const entry = buildPersonMemoryDispositionLedgerEntry({
      canonical: { ownerUserId: 'u-1', requesterCatId: 'cat-1' },
      proof,
      decidedAt: 1_700_000_000_000,
      feedback: { reasonCode: 'wrong_lane' },
    });
    const ledger = {
      query: vi.fn(async () => ({ entries: [entry], scannedCount: 1 })),
    };
    const resolver: SubjectProofResolverPort = {
      resolve: vi.fn(async ({ phrase }) => ({
        status: 'verified',
        subjectRef: entry.envelope!.subjectRef,
        currentSupersessionKey: proof.opaqueSupersessionHandle,
      })),
    };
    const svc = new HumanDispositionFeedbackContextService({ subjectResolver: resolver, ledger });
    const context = await svc.prepare({ ownerUserId: 'u-1', text: '某个候选词', now: 1_700_000_001_000 });
    expect(context).toContain('[human-disposition-feedback]');
    expect(context).toContain('reason=wrong_lane correction=reroute_exact_subject');
    expect(context).toContain('[/human-disposition-feedback]');
  });

  it('候选解析异常 → fail-closed（跳过并返回空）', async () => {
    const warn = vi.fn();
    const svc = new HumanDispositionFeedbackContextService({
      subjectResolver: { resolve: vi.fn(async () => { throw new Error('boom'); }) },
      ledger: { query: vi.fn() },
      logger: { warn },
    });
    expect(await svc.prepare({ ownerUserId: 'u-1', text: '某个候选词' })).toBe('');
    expect(warn).toHaveBeenCalledWith({ reason: 'unprovable_exact_subject_feedback' }, expect.any(String));
  });
});

describe('C28 keys + receipt-index', () => {
  it('HumanDispositionKeys：base64url 编码 + 1..500 校验', () => {
    expect(HumanDispositionKeys.receipts('owner-1')).toBe(`human-disposition:receipts:${Buffer.from('owner-1').toString('base64url')}`);
    expect(HumanDispositionKeys.subject('owner-1', 's-1')).toContain('human-disposition:subject:');
    expect(() => HumanDispositionKeys.receipts('')).toThrow('must contain 1..500 characters');
    expect(() => HumanDispositionKeys.receipts('x'.repeat(501))).toThrow('must contain 1..500 characters');
  });

  it('InMemoryHumanDispositionReceiptIndex：applied → replay → conflict', () => {
    const index = new InMemoryHumanDispositionReceiptIndex();
    const receipt = buildHumanDispositionLedgerReceipt(makeEntry());
    expect(index.append('owner-1', receipt)).toBe('applied');
    expect(index.append('owner-1', receipt)).toBe('replay');
    expect(index.append('owner-1', { ...receipt, decidedAt: receipt.decidedAt + 1 })).toBe('conflict');
    expect(index.get('owner-1', receipt.sourceRef)).toEqual(receipt);
  });

  it('MemoryHumanDispositionLedgerKV zrevrange WITHSCORES 扁平数组', async () => {
    const kv = new MemoryHumanDispositionLedgerKV();
    const loader = { loadEntry: vi.fn(async () => null) };
    const ledger = new HumanDispositionLedger(kv, loader);
    expect(ledger).toBeDefined();
    const entry = makeEntry();
    await kv.appendReceipt(humanDispositionReceiptAppendArguments('owner-1', buildHumanDispositionLedgerReceipt(entry)));
    const raw = await kv.zrevrange(HumanDispositionKeys.episodes('owner-1'), 0, -1, true);
    expect(raw).toHaveLength(2);
    expect(raw[0]).toBe(entry.episode.sourceRef);
    expect(raw[1]).toBe(String(entry.episode.decidedAt));
  });
});

describe('C28 KV 注入 — 宿主自定义 HumanDispositionLedgerKV', () => {
  it('注入 KV 全程透传（记录调用）', async () => {
    const calls: string[] = [];
    const kv: HumanDispositionLedgerKV = {
      hget: vi.fn(async () => null),
      zrevrange: vi.fn(async () => []),
      zrevrank: vi.fn(async () => null),
      zscore: vi.fn(async () => null),
      appendReceipt: vi.fn(async (args) => { calls.push(args.keys.join('|')); return 'APPLIED'; }),
    };
    const ledger = new HumanDispositionLedger(kv, { loadEntry: vi.fn(async () => null) });
    const entry = makeEntry();
    await ledger.get('owner-1', entry.episode.sourceRef);
    expect(calls).toHaveLength(0); // hget 返回 null 不触发 append
    await kv.appendReceipt(humanDispositionReceiptAppendArguments('owner-1', buildHumanDispositionLedgerReceipt(entry)));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('human-disposition:receipts:');
  });
});

/**
 * C29 Taste 包测试 — @flowforge/cats-taste。
 *
 * 覆盖：
 *  - ctx.plugin(CatsTaste) → ctx.catsTaste 挂载 + 工厂
 *  - taste-routing-guard：中英文品味信号关键词 / 空 corpus / 无信号
 *  - InMemoryTasteProposalStore：pending→approving→approved 状态机 / 幂等 /
 *    Phase-I publication envelope（commitEnvelope 身份校验 / abortStaged）
 *  - approve 管线：成功 / 幂等 / rejected / not_found / claim_lost /
 *    writer 失败回滚 / checkpoint 恢复（recovered=true）/ partial checkpoint
 *  - write-vignette：slug 推导 / frontmatter / index 分节插入 + 幂等 /
 *    GitRunner mock（main-only / dirty 拒绝 / 幂等跳过 / commit 失败回滚 / sensitive 直写）
 *  - FileTasteRepository：worktree 解析 refs/heads/main / lock key
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Context } from '@flowforge/cordis';
import type { TasteProposal } from '@flowforge/cats-shared';

import CatsTaste, {
  FileTasteRepository,
  InMemoryTasteProposalStore,
  TasteProposalKeys,
  TasteService,
  approveTasteProposal,
  createVignetteWriter,
  deriveSlug,
  detectTasteSignal,
  formatVignette,
  insertIntoIndex,
  nodeGitRunner,
  type ApprovalLock,
  type GitRunner,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withTaste(): Promise<Context> {
  const ctx = new Context();
  const fiber = (await ctx.plugin(CatsTaste)) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

function makeProposalInput(overrides: Partial<Parameters<InMemoryTasteProposalStore['create']>[0]> = {}) {
  return {
    userId: 'u-1',
    catId: 'cat-1',
    threadId: 'thr-1',
    scene: '用户指出回复太客服腔',
    quote: '太客服了，像脚本',
    tags: ['活人感'],
    dimension: 'authentic-expression' as const,
    privacy: 'public' as const,
    ...overrides,
  };
}

function baseProposal(overrides: Partial<TasteProposal> = {}): TasteProposal {
  return {
    id: 'proposal-000001',
    userId: 'u-1',
    catId: 'cat-1',
    threadId: 'thr-1',
    scene: 'scene',
    quote: 'quote',
    tags: ['t1'],
    dimension: 'visual-quality',
    privacy: 'public',
    status: 'pending',
    createdAt: 1_700_000_000_000,
    publication: { state: 'staged', stagedAt: 1_700_000_000_000 },
    ...overrides,
  };
}

function fakeLock(): ApprovalLock & { acquired: string[]; released: number } {
  const acquired: string[] = [];
  let released = 0;
  return {
    acquired,
    get released() {
      return released;
    },
    async acquire(key: string) {
      acquired.push(key);
      return () => {
        released++;
      };
    },
  };
}

function fakeRunner(
  handlers: Record<string, (args: string[]) => { ok: boolean; stdout?: string; err?: unknown }>,
): GitRunner {
  return {
    async exec(args, _cwd) {
      const op = handlers[args[0] ?? ''];
      if (!op) return { ok: false, err: new Error(`unexpected git ${args.join(' ')}`) };
      return op(args);
    },
  };
}

/** 注入 rev-parse/worktree 的 runner：把 root 视为持有 refs/heads/main 的仓库根。 */
function gitRootRunner(root: string, handlers: Parameters<typeof fakeRunner>[0]): GitRunner {
  return fakeRunner({
    'rev-parse': () => ({ ok: true, stdout: root }),
    worktree: () => ({ ok: true, stdout: `worktree ${root}\0branch refs/heads/main\0` }),
    ...handlers,
  });
}

// ---------------------------------------------------------------------------
// 插件挂载 + 工厂
// ---------------------------------------------------------------------------

describe('CatsTaste plugin', () => {
  it('mounts ctx.catsTaste with factory methods', async () => {
    const ctx = await withTaste();
    expect(ctx.catsTaste).toBeInstanceOf(TasteService);
    expect(ctx.catsTaste.createStore()).toBeInstanceOf(InMemoryTasteProposalStore);
    expect(typeof ctx.catsTaste.createVignetteWriter('x')).toBe('function');
    expect(ctx.catsTaste.detectTasteSignal({ rationale: '品味' })).not.toBeNull();
    const repo = ctx.catsTaste.createRepository('x');
    expect(repo).toBeInstanceOf(FileTasteRepository);
  });

  it('exposes keys with stable layout', () => {
    expect(TasteProposalKeys.detail('proposal-1')).toContain('proposal-1');
    expect(TasteProposalKeys.userPending('u-1')).toContain('u-1');
    expect(TasteProposalKeys.userSettled('u-1')).toContain('u-1');
    expect(TasteProposalKeys.dedup('u-1', 'cr-1')).toContain('cr-1');
  });
});

// ---------------------------------------------------------------------------
// taste-routing-guard
// ---------------------------------------------------------------------------

describe('detectTasteSignal', () => {
  it('detects Chinese taste keywords', () => {
    for (const kw of ['品味', '审美', '太客服', '不美', '活人感', '脚手架', '第一性原理', '数学之美', '这就是我要的']) {
      expect(detectTasteSignal({ rationale: `这句话很${kw}` })?.suggestedTool).toBe('cat_cafe_propose_taste');
    }
  });

  it('detects English keywords case-insensitively', () => {
    expect(detectTasteSignal({ afterContent: 'That gave me an AHA moment' })?.reason).toContain('aha');
    expect(detectTasteSignal({ afterContent: 'this is ai slop' })?.reason).toContain('ai slop');
  });

  it('returns null for empty corpus or no signal', () => {
    expect(detectTasteSignal({})).toBeNull();
    expect(detectTasteSignal({ rationale: '   ' })).toBeNull();
    expect(detectTasteSignal({ rationale: '普通内容', afterContent: '无信号' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// InMemoryTasteProposalStore
// ---------------------------------------------------------------------------

describe('InMemoryTasteProposalStore', () => {
  it('creates pending proposal with staged publication', () => {
    const store = new InMemoryTasteProposalStore();
    const p = store.create(makeProposalInput());
    expect(p.status).toBe('pending');
    expect(p.publication).toMatchObject({ state: 'staged' });
    expect(store.get(p.id)).toEqual(p);
    expect(store.get('missing')).toBeNull();
  });

  it('lists pending/actionable/settled with desc ordering', () => {
    const store = new InMemoryTasteProposalStore();
    const a = store.create(makeProposalInput({ dimension: 'visual-quality', tags: ['a'] }));
    const b = store.create(makeProposalInput({ dimension: 'visual-quality', tags: ['b'] }));
    store.claimForApproval(a.id, 'op-1');
    store.markRejected(b.id, 'no', 'op-1');

    expect(store.listPending('u-1').map((p) => p.id)).toEqual([]);
    expect(store.listActionable('u-1').map((p) => p.id)).toEqual([a.id]);
    expect(store.listSettledByUser('u-1').map((p) => p.id)).toEqual([b.id]);
    expect(store.listSettledByUser('other')).toEqual([]);
  });

  it('claim → checkpoint → finalize state machine', () => {
    const store = new InMemoryTasteProposalStore();
    const p = store.create(makeProposalInput());
    expect(store.claimForApproval('missing', 'op')).toBeNull();

    const claimed = store.claimForApproval(p.id, 'op-1');
    expect(claimed?.status).toBe('approving');
    expect(claimed?.approvedBy).toBe('op-1');
    // 非 pending 不可再 claim
    expect(store.claimForApproval(p.id, 'op-2')).toBeNull();

    const checkpointed = store.recordWriteCheckpoint(p.id, { vignetteSlug: 's', vignettePath: 'v' });
    expect(checkpointed?.vignetteSlug).toBe('s');
    expect(store.recordWriteCheckpoint('missing', { vignetteSlug: 's', vignettePath: 'v' })).toBeNull();

    const approved = store.finalizeApproval(p.id, 'op-1', 's', 'v');
    expect(approved?.status).toBe('approved');
    expect(approved?.approvedBy).toBe('op-1');
    expect(approved?.approvedAt).toBeTypeOf('number');
    // 已终态不可再操作
    expect(store.finalizeApproval(p.id, 'op', 's', 'v')).toBeNull();
    expect(store.rollbackClaim(p.id)).toBe(false);
    expect(store.markRejected(p.id, 'no', 'op')).toBeNull();
  });

  it('rollbackClaim resets approving → pending and clears writer fields', () => {
    const store = new InMemoryTasteProposalStore();
    const p = store.create(makeProposalInput());
    store.claimForApproval(p.id, 'op-1');
    store.recordWriteCheckpoint(p.id, { vignetteSlug: 's', vignettePath: 'v' });
    expect(store.rollbackClaim(p.id)).toBe(true);
    const rolledBack = store.get(p.id)!;
    expect(rolledBack.status).toBe('pending');
    expect(rolledBack.approvedBy).toBeUndefined();
    expect(rolledBack.vignetteSlug).toBeUndefined();
    expect(rolledBack.vignettePath).toBeUndefined();
    expect(store.rollbackClaim(p.id)).toBe(false);
  });

  it('markRejected is one-shot from pending', () => {
    const store = new InMemoryTasteProposalStore();
    const p = store.create(makeProposalInput());
    const rejected = store.markRejected(p.id, '不符合', 'op-1');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectedBy).toBe('op-1');
    expect(rejected?.rejectionReason).toBe('不符合');
    expect(store.markRejected(p.id, 'again', 'op')).toBeNull();
    // rejected 不可 approve
    expect(store.claimForApproval(p.id, 'op')).toBeNull();
  });

  it('dedup reservation is atomic and idempotent', () => {
    const store = new InMemoryTasteProposalStore();
    expect(store.getDedupProposalId('u-1', 'cr-1')).toBeNull();
    expect(store.reserveDedup('u-1', 'cr-1', 'proposal-a')).toBe('proposal-a');
    expect(store.reserveDedup('u-1', 'cr-1', 'proposal-b')).toBe('proposal-a');
    expect(store.getDedupProposalId('u-1', 'cr-1')).toBe('proposal-a');
    // proposal 不存在时 release 生效
    store.releaseDedup('u-1', 'cr-1', 'proposal-a');
    expect(store.getDedupProposalId('u-1', 'cr-1')).toBeNull();
    // proposal 存在时 release 不生效（路由层先 reserve 再 create）
    store.reserveDedup('u-1', 'cr-2', 'keep-me');
    store.create(makeProposalInput({ proposalId: 'keep-me', clientRequestId: 'cr-2' }));
    expect(store.getDedupProposalId('u-1', 'cr-2')).toBe('keep-me');
    store.releaseDedup('u-1', 'cr-2', 'keep-me');
    expect(store.getDedupProposalId('u-1', 'cr-2')).toBe('keep-me');
  });

  it('commitEnvelope validates identity and anchors staged publication', async () => {
    const store = new InMemoryTasteProposalStore();
    const p = store.create(makeProposalInput());
    const envelope = {
      canonicalProposalId: p.id,
      sourceFeatureId: 'F221' as const,
      ownerUserId: 'u-1',
      requesterCatId: 'cat-1',
      createdAt: p.createdAt,
      originRef: { kind: 'message' as const, threadId: 'thr-1', messageId: 'msg-1' },
      approvalCardRef: { threadId: 'thr-1', messageId: 'card-1' },
    };
    await store.commitEnvelope(p.id, envelope);
    expect((await store.getPublication(p.id))?.state).toBe('anchored');
    // 重复相同 envelope 幂等
    await store.commitEnvelope(p.id, envelope);
    // 身份不匹配抛错
    await expect(store.commitEnvelope(p.id, { ...envelope, ownerUserId: 'u-2' })).rejects.toThrow(
      'does not match canonical proposal',
    );
    await expect(store.commitEnvelope('missing', envelope)).rejects.toThrow('proposal not found');
  });

  it('abortStaged deletes only staged proposals and releases dedup', async () => {
    const store = new InMemoryTasteProposalStore();
    const staged = store.create(makeProposalInput({ clientRequestId: 'cr-x' }));
    const anchored = store.create(makeProposalInput({ proposalId: 'keep-2' }));
    await store.commitEnvelope(anchored.id, {
      canonicalProposalId: anchored.id,
      sourceFeatureId: 'F221',
      ownerUserId: 'u-1',
      requesterCatId: 'cat-1',
      createdAt: anchored.createdAt,
      originRef: { kind: 'message', threadId: 'thr-1', messageId: 'msg-1' },
      approvalCardRef: { threadId: 'thr-1', messageId: 'card-1' },
    });
    await store.abortStaged(staged.id, 'expired');
    await store.abortStaged(anchored.id, 'expired');
    expect(store.get(staged.id)).toBeNull();
    expect(store.get(anchored.id)).not.toBeNull();
    expect(store.getDedupProposalId('u-1', 'cr-x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// approve 管线
// ---------------------------------------------------------------------------

describe('approveTasteProposal', () => {
  it('runs full pipeline: claim → write → checkpoint → finalize', async () => {
    const store = new InMemoryTasteProposalStore();
    const proposal = store.create(makeProposalInput());
    const lock = fakeLock();
    const writer = vi.fn(async () => ({ slug: 'visual-quality-t1-000001', path: 'docs/taste/vignettes/x.md' }));

    const result = await approveTasteProposal(proposal.id, 'op-1', {
      store,
      lock,
      lockKey: () => 'key-1',
      writeVignette: writer,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recovered).toBe(false);
      expect(result.proposal.status).toBe('approved');
      expect(result.proposal.vignetteSlug).toBe('visual-quality-t1-000001');
    }
    expect(lock.acquired).toEqual(['key-1']);
    expect(lock.released).toBe(1);
    expect(writer).toHaveBeenCalledOnce();
  });

  it('is idempotent for already-approved proposals (no lock, no writer)', async () => {
    const store = new InMemoryTasteProposalStore();
    const proposal = store.create(makeProposalInput());
    store.claimForApproval(proposal.id, 'op-1');
    store.recordWriteCheckpoint(proposal.id, { vignetteSlug: 's', vignettePath: 'v' });
    store.finalizeApproval(proposal.id, 'op-1', 's', 'v');
    const lock = fakeLock();
    const writer = vi.fn();

    const result = await approveTasteProposal(proposal.id, 'op-1', {
      store,
      lock,
      lockKey: () => 'k',
      writeVignette: writer,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recovered).toBe(false);
    expect(lock.acquired).toEqual([]);
    expect(writer).not.toHaveBeenCalled();
  });

  it('rejects already-rejected proposals', async () => {
    const store = new InMemoryTasteProposalStore();
    const proposal = store.create(makeProposalInput());
    store.markRejected(proposal.id, 'no', 'op-1');
    const result = await approveTasteProposal(proposal.id, 'op-2', {
      store,
      lock: fakeLock(),
      lockKey: () => 'k',
      writeVignette: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('returns not_found for missing proposals', async () => {
    const store = new InMemoryTasteProposalStore();
    const result = await approveTasteProposal('missing', 'op-1', {
      store,
      lock: fakeLock(),
      lockKey: () => 'k',
      writeVignette: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('recovers from durable checkpoint without re-running writer (recovered=true)', async () => {
    const store = new InMemoryTasteProposalStore();
    const proposal = store.create(makeProposalInput());
    // 模拟 crash 后：claim + checkpoint 已持久，finalize 未执行
    store.claimForApproval(proposal.id, 'op-1');
    store.recordWriteCheckpoint(proposal.id, { vignetteSlug: 's', vignettePath: 'v' });
    const lock = fakeLock();
    const writer = vi.fn();

    const result = await approveTasteProposal(proposal.id, 'op-1', {
      store,
      lock,
      lockKey: () => 'k',
      writeVignette: writer,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recovered).toBe(true);
      expect(result.proposal.status).toBe('approved');
    }
    expect(writer).not.toHaveBeenCalled();
  });

  it('rolls back claim when writer throws (approving → pending)', async () => {
    const store = new InMemoryTasteProposalStore();
    const proposal = store.create(makeProposalInput());
    const writer = vi.fn(async () => {
      throw new Error('disk full');
    });
    const result = await approveTasteProposal(proposal.id, 'op-1', {
      store,
      lock: fakeLock(),
      lockKey: () => 'k',
      writeVignette: writer,
    });
    expect(result).toMatchObject({ ok: false, reason: 'write_failed', error: 'disk full' });
    const rolledBack = store.get(proposal.id)!;
    expect(rolledBack.status).toBe('pending');
    expect(rolledBack.approvedBy).toBeUndefined();
  });

  it('refuses partial checkpoint (slug xor path)', async () => {
    // store 不直接暴露 partial 变异：用 Object.create 保留原型链方法，
    // 仅覆盖 get 返回“有 vignetteSlug 无 vignettePath”的 partial 快照。
    const partialStore = new InMemoryTasteProposalStore();
    const p2 = partialStore.create(makeProposalInput());
    partialStore.claimForApproval(p2.id, 'op-1');
    partialStore.recordWriteCheckpoint(p2.id, { vignetteSlug: 's', vignettePath: 'v' });
    const customStore = Object.create(partialStore) as InMemoryTasteProposalStore;
    customStore.get = async (id: string) => {
      if (id !== p2.id) return null;
      const found = partialStore.get(id)!;
      return { ...found, vignettePath: undefined };
    };
    const result = await approveTasteProposal(p2.id, 'op-1', {
      store: customStore,
      lock: fakeLock(),
      lockKey: () => 'k',
      writeVignette: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'write_failed' });
    expect(result.ok).toBe(false);
  });

  it('reports claim_lost when checkpoint fails after writer succeeded', async () => {
    const failingStore = new InMemoryTasteProposalStore();
    const p = failingStore.create(makeProposalInput());
    failingStore.claimForApproval(p.id, 'op-1');

    // writer 执行期间并发竞争者抢先 finalize，使 recordWriteCheckpoint 返回 null
    const writer = vi.fn(async () => {
      failingStore.finalizeApproval(p.id, 'op-other', 'x', 'y');
      return { slug: 's', path: 'v' };
    });
    const result = await approveTasteProposal(p.id, 'op-1', {
      store: failingStore,
      lock: fakeLock(),
      lockKey: () => 'k',
      writeVignette: writer,
    });
    expect(result).toMatchObject({ ok: false, reason: 'claim_lost' });
  });

  it('propagates lockKey errors as write_failed', async () => {
    const store = new InMemoryTasteProposalStore();
    const proposal = store.create(makeProposalInput());
    const result = await approveTasteProposal(proposal.id, 'op-1', {
      store,
      lock: fakeLock(),
      lockKey: () => {
        throw new Error('no repo');
      },
      writeVignette: vi.fn(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'write_failed', error: 'no repo' });
  });

  it('releases lock even when writer throws', async () => {
    const store = new InMemoryTasteProposalStore();
    const proposal = store.create(makeProposalInput());
    const lock = fakeLock();
    await approveTasteProposal(proposal.id, 'op-1', {
      store,
      lock,
      lockKey: () => 'k',
      writeVignette: async () => {
        throw new Error('boom');
      },
    });
    expect(lock.released).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// write-vignette（GitRunner mock）
// ---------------------------------------------------------------------------

describe('write-vignette', () => {
  it('deriveSlug builds dimension-tag-suffix', () => {
    const slug = deriveSlug(baseProposal({ tags: ['活人感'], dimension: 'authentic-expression', id: 'p-abcdef' }));
    expect(slug).toBe('authentic-expression-活人感-abcdef');
  });

  it('formatVignette emits YAML frontmatter', () => {
    const md = formatVignette(baseProposal({ quote: '太"客服"了\n第二行' }));
    expect(md).toContain('---');
    expect(md).toContain('when: 2023-11-14');
    expect(md).toContain('- "太\\"客服\\"了\\n第二行"');
    expect(md).toContain('dimension: visual-quality');
    expect(md).toContain('proposalId: proposal-000001');
  });

  it('insertIntoIndex inserts under matching dimension section', () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-idx-'));
    try {
      const indexPath = join(root, 'docs/taste/index.md');
      mkdirSync(join(root, 'docs/taste'), { recursive: true });
      writeFileSync(indexPath, '# Taste Index\n\n### 视觉品质\n\n- [旧](vignettes/old.md)\n\n## 如何新增 vignette\n', 'utf8');
      const previous = insertIntoIndex(indexPath, 'slug-1', baseProposal());
      expect(previous).toContain('旧');
      const updated = readFileSync(indexPath, 'utf8');
      expect(updated.indexOf('slug-1')).toBeGreaterThan(updated.indexOf('### 视觉品质'));
      // 幂等：再次插入返回原文且不重复
      expect(insertIntoIndex(indexPath, 'slug-1', baseProposal())).toBe(updated);
      expect(readFileSync(indexPath, 'utf8')).toBe(updated);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('insertIntoIndex creates minimal index when missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-idx2-'));
    try {
      const indexPath = join(root, 'docs/taste/index.md');
      mkdirSync(join(root, 'docs/taste'), { recursive: true });
      const previous = insertIntoIndex(indexPath, 'slug-2', baseProposal());
      expect(previous).toBeNull();
      expect(readFileSync(indexPath, 'utf8')).toContain('vignettes/slug-2.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('insertIntoIndex falls back before 如何新增 section', () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-idx3-'));
    try {
      const indexPath = join(root, 'docs/taste/index.md');
      mkdirSync(join(root, 'docs/taste'), { recursive: true });
      writeFileSync(indexPath, '# Taste Index\n\n## 如何新增 vignette\n', 'utf8');
      insertIntoIndex(indexPath, 'slug-3', baseProposal({ dimension: 'creative-craft' }));
      const updated = readFileSync(indexPath, 'utf8');
      expect(updated.indexOf('slug-3')).toBeLessThan(updated.indexOf('## 如何新增'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('public write commits vignette + index on main with clean paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-w-'));
    try {
      const gitCommands: string[][] = [];
      const runner = gitRootRunner(root, {
        branch: () => ({ ok: true, stdout: 'main' }),
        status: () => ({ ok: true, stdout: '' }),
        add: (args) => {
          gitCommands.push(args);
          return { ok: true, stdout: '' };
        },
        commit: (args) => {
          gitCommands.push(args);
          return { ok: true, stdout: '[main abc123] taste' };
        },
      });
      const writer = createVignetteWriter(root, runner);
      const result = await writer(baseProposal({ tags: ['极简'], dimension: 'architecture-aesthetics' }));
      expect(result.path.replace(/\\/g, '/')).toContain('docs/taste/vignettes/');
      expect(existsSync(join(root, result.path))).toBe(true);
      expect(existsSync(join(root, 'docs/taste/index.md'))).toBe(true);
      expect(gitCommands.some((c) => c[0] === 'add')).toBe(true);
      expect(gitCommands.some((c) => c[0] === 'commit' && c.some((arg) => arg.includes('taste(F221): add vignette')))).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses non-main branch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-w2-'));
    try {
      const runner = gitRootRunner(root, {
        branch: () => ({ ok: true, stdout: 'dev' }),
        status: () => ({ ok: true, stdout: '' }),
      });
      const writer = createVignetteWriter(root, runner);
      await expect(writer(baseProposal())).rejects.toThrow('only "main" is allowed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses dirty output paths before any write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-w3-'));
    try {
      const runner = gitRootRunner(root, {
        branch: () => ({ ok: true, stdout: 'main' }),
        status: () => ({ ok: true, stdout: ' M docs/taste/index.md\n' }),
      });
      const writer = createVignetteWriter(root, runner);
      await expect(writer(baseProposal())).rejects.toThrow('dirty output path');
      expect(existsSync(join(root, 'docs/taste/vignettes'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips write when prior attempt is durably committed (idempotent retry)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-w4-'));
    try {
      const proposal = baseProposal({ tags: ['极简'], dimension: 'architecture-aesthetics' });
      const slug = deriveSlug(proposal);
      const vignettePath = join(root, 'docs/taste/vignettes', `${slug}.md`);
      const indexPath = join(root, 'docs/taste/index.md');
      mkdirSync(join(root, 'docs/taste/vignettes'), { recursive: true });
      writeFileSync(vignettePath, formatVignette(proposal), 'utf8');
      writeFileSync(indexPath, `# Taste Index\n\n### 架构审美\n\n- [x](vignettes/${slug}.md)\n`, 'utf8');

      let statusCalls = 0;
      let commitCalls = 0;
      const runner = gitRootRunner(root, {
        branch: () => ({ ok: true, stdout: 'main' }),
        status: () => {
          statusCalls++;
          return { ok: true, stdout: '' };
        },
        commit: () => {
          commitCalls++;
          return { ok: true, stdout: '' };
        },
      });
      const writer = createVignetteWriter(root, runner);
      const result = await writer(proposal);
      expect(result.slug).toBe(slug);
      expect(commitCalls).toBe(0);
      expect(statusCalls).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rolls back files when commit fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-w5-'));
    try {
      const indexPath = join(root, 'docs/taste/index.md');
      mkdirSync(join(root, 'docs/taste'), { recursive: true });
      writeFileSync(indexPath, '# Taste Index\n', 'utf8');
      const previous = readFileSync(indexPath, 'utf8');

      const runner = gitRootRunner(root, {
        branch: () => ({ ok: true, stdout: 'main' }),
        status: () => ({ ok: true, stdout: '' }),
        add: () => ({ ok: true, stdout: '' }),
        commit: () => ({ ok: false, err: new Error('commit rejected') }),
        reset: () => ({ ok: true, stdout: '' }),
      });
      const writer = createVignetteWriter(root, runner);
      await expect(writer(baseProposal())).rejects.toThrow('Vignette write failed');
      // vignette 删除、index 恢复
      expect(existsSync(join(root, 'docs/taste/vignettes/visual-quality-t1-000001.md'))).toBe(false);
      expect(readFileSync(indexPath, 'utf8')).toBe(previous);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sensitive writes file only, no git', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-w6-'));
    try {
      const gitCalls: string[] = [];
      const writer = createVignetteWriter(root, {
        exec: async (args: string[]) => {
          if (args[0] === 'rev-parse') return { ok: true, stdout: root };
          if (args[0] === 'worktree') return { ok: true, stdout: `worktree ${root}\0branch refs/heads/main\0` };
          gitCalls.push(args[0]);
          return { ok: true, stdout: '' };
        },
      } as GitRunner);
      const result = await writer(baseProposal({ privacy: 'sensitive' }));
      expect(result.path.replace(/\\/g, '/')).toContain('private/taste/');
      expect(existsSync(join(root, result.path))).toBe(true);
      // 仅写文件：rev-parse/worktree 定位之外不应有任何 git 操作
      expect(gitCalls).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// FileTasteRepository
// ---------------------------------------------------------------------------

describe('FileTasteRepository', () => {
  it('resolves canonical root from worktree list owning refs/heads/main', async () => {
    const mainRoot = mkdtempSync(join(tmpdir(), 'taste-main-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'taste-run-'));
    try {
      const runner = fakeRunner({
        'rev-parse': () => ({ ok: true, stdout: runtimeRoot }),
        worktree: () => ({
          ok: true,
          stdout: `worktree ${mainRoot}\0branch refs/heads/main\0worktree ${runtimeRoot}\0branch refs/heads/runtime\0`,
        }),
      });
      const repo = new FileTasteRepository(runtimeRoot, runner);
      expect(await repo.canonicalRoot()).toBe(mainRoot);
      expect(await repo.approvalLockKey()).toBe(join(mainRoot, 'docs/taste/index.md'));
    } finally {
      rmSync(mainRoot, { recursive: true, force: true });
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('throws when no refs/heads/main worktree exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taste-nom-'));
    try {
      const runner = fakeRunner({
        'rev-parse': () => ({ ok: true, stdout: root }),
        worktree: () => ({ ok: true, stdout: `worktree ${root}\0branch refs/heads/dev\0` }),
      });
      const repo = new FileTasteRepository(root, runner);
      await expect(repo.canonicalRoot()).rejects.toThrow('cannot find a checked-out refs/heads/main');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('nodeGitRunner executes real git', async () => {
    const result = await nodeGitRunner.exec(['--version'], process.cwd());
    expect(result.ok).toBe(true);
  });
});

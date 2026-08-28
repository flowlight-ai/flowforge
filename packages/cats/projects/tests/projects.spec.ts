/**
 * C28 Projects 包测试 — @flowforge/cats-projects。
 *
 * 覆盖：
 *  - ctx.plugin(CatsProjects) → ctx.catsProjects 挂载 + 全部工厂
 *  - computeBucket 纯函数：A-tag 硬门控 + 五桶各分支
 *  - detectRisks 8 信号自动检测
 *  - IntentCardStore：create / triage / listByProject(bucket)
 *  - ExternalProjectStore：P2-1 路径逃逸防护 + Memory KV 注入
 *  - SliceStore：per-project order 计数器 + reorder
 *  - ResolutionStore：open → answered / escalated 状态机
 *  - NeedAuditFrameStore：sponsor/successMetric 必填 + upsert
 *  - ExecutionDigestStore / RefluxPatternStore / generateSortableId
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@flowforge/cordis';
import CatsProjects, {
  ExecutionDigestStore,
  ExternalProjectStore,
  IntentCardStore,
  MemoryExternalProjectKV,
  NeedAuditFrameStore,
  ProjectsService,
  RefluxPatternStore,
  ResolutionStore,
  SliceStore,
  computeBucket,
  detectRisks,
  generateSortableId,
  type CreateIntentCardInput,
  type ExternalProjectKV,
  type IntentCard,
} from '../src/index.js';

/** Track plugin fibers so each test tears down cleanly. */
const fibers: Array<{ dispose: () => Promise<void> | void }> = [];
afterEach(async () => {
  while (fibers.length) {
    const fiber = fibers.pop()!;
    await fiber.dispose();
  }
});

async function withProjects(): Promise<Context> {
  const ctx = new Context();
  const fiber = await ctx.plugin(CatsProjects) as unknown as { dispose: () => Promise<void> | void };
  fibers.push(fiber);
  return ctx;
}

function makeCardInput(overrides: Partial<CreateIntentCardInput> = {}): CreateIntentCardInput {
  return {
    projectId: 'proj-1',
    actor: '运维值班员',
    contextTrigger: '告警出现',
    goal: '修复 CPU 飙高问题',
    objectState: 'CPU 使用率恢复正常',
    successSignal: 'CPU < 60% 持续 10 分钟',
    nonGoal: '不重启生产节点',
    sourceTag: 'Q',
    sourceDetail: '用户工单 #42',
    decisionOwner: 'oncall',
    confidence: 3,
    originalText: 'CPU 告警时快速恢复',
    ...overrides,
  };
}

describe('C28 computeBucket — triage 纯函数', () => {
  it('A-tag 硬门控：任何评分都进 validate_first/evidence', () => {
    const decision = computeBucket(
      { clarity: 3, groundedness: 3, necessity: 3, coupling: 1, sizeBand: 'S' },
      'A',
    );
    expect(decision).toEqual({ bucket: 'validate_first', resolutionPath: 'evidence' });
  });

  it('5 维全达标（S/M）→ build_now', () => {
    expect(computeBucket({ clarity: 2, groundedness: 2, necessity: 2, coupling: 2, sizeBand: 'M' }, 'Q'))
      .toEqual({ bucket: 'build_now', resolutionPath: null });
  });

  it('necessity ≥ 2 但 clarity < 2 → clarify_first/confirmation', () => {
    expect(computeBucket({ clarity: 1, groundedness: 3, necessity: 2, coupling: 1, sizeBand: 'S' }, 'Q'))
      .toEqual({ bucket: 'clarify_first', resolutionPath: 'confirmation' });
  });

  it('clarity ≥ 2 但 groundedness < 2 → validate_first/evidence', () => {
    expect(computeBucket({ clarity: 2, groundedness: 1, necessity: 3, coupling: 1, sizeBand: 'S' }, 'Q'))
      .toEqual({ bucket: 'validate_first', resolutionPath: 'evidence' });
  });

  it('clarity+groundedness ≥ 2 但 necessity < 2 → challenge/escalation', () => {
    expect(computeBucket({ clarity: 2, groundedness: 2, necessity: 1, coupling: 2, sizeBand: 'S' }, 'Q'))
      .toEqual({ bucket: 'challenge', resolutionPath: 'escalation' });
  });

  it('其余 → later', () => {
    expect(computeBucket({ clarity: 1, groundedness: 1, necessity: 1, coupling: 3, sizeBand: 'XL' }, 'Q'))
      .toEqual({ bucket: 'later', resolutionPath: null });
  });
});

describe('C28 detectRisks — 8 信号自动检测', () => {
  function cardOf(overrides: Partial<IntentCard>): IntentCard {
    return {
      id: 'ic-1',
      projectId: 'proj-1',
      actor: '运维值班员',
      contextTrigger: '告警',
      goal: '修复 CPU 飙高问题',
      objectState: 'CPU 恢复正常',
      successSignal: 'CPU < 60%',
      nonGoal: '不重启',
      sourceTag: 'Q',
      sourceDetail: '工单 #42',
      decisionOwner: 'oncall',
      confidence: 3,
      dependencyTags: [],
      riskSignals: [],
      triage: null,
      originalText: 'x',
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    };
  }

  it('空依赖/正常卡片 → 无信号', () => {
    expect(detectRisks(cardOf({}))).toEqual([]);
  });

  it('hollow_verbs：goal 含 vague verb', () => {
    const signals = detectRisks(cardOf({ goal: 'improve performance' }));
    expect(signals.map((s) => s.signal)).toContain('hollow_verbs');
  });

  it('missing_actors：actor 为 system/none/空', () => {
    for (const actor of ['system', 'n/a', '']) {
      expect(detectRisks(cardOf({ actor })).map((s) => s.signal)).toContain('missing_actors');
    }
  });

  it('unknown_data_source：提到 data 但 sourceDetail 为空', () => {
    const signals = detectRisks(cardOf({ sourceDetail: '', goal: '查询 database 表' }));
    expect(signals.map((s) => s.signal)).toContain('unknown_data_source');
  });

  it('missing_success_signal：successSignal 为空', () => {
    expect(detectRisks(cardOf({ successSignal: '' })).map((s) => s.signal)).toContain('missing_success_signal');
  });

  it('missing_edge_cases：无边界词且 nonGoal 为空', () => {
    const signals = detectRisks(cardOf({ nonGoal: '' }));
    expect(signals.map((s) => s.signal)).toContain('missing_edge_cases');
  });

  it('hidden_dependencies：依赖标签 ≥ 4', () => {
    const signals = detectRisks(cardOf({ dependencyTags: ['a', 'b', 'c', 'd'] }));
    expect(signals.map((s) => s.signal)).toContain('hidden_dependencies');
  });

  it('ai_fake_specificity：A-tag + 空 objectState', () => {
    const signals = detectRisks(cardOf({ sourceTag: 'A', objectState: '' }));
    expect(signals.map((s) => s.signal)).toContain('ai_fake_specificity');
  });

  it('scope_creep：goal 含 expansive 语言', () => {
    const signals = detectRisks(cardOf({ goal: '重构 enterprise 全模块' }));
    expect(signals.map((s) => s.signal)).toContain('scope_creep');
  });
});

describe('C28 ProjectsService — Cordis 服务生命周期', () => {
  it('mounts at ctx.catsProjects after ctx.plugin(CatsProjects)', async () => {
    const ctx = await withProjects();
    expect(ctx.catsProjects).toBeInstanceOf(CatsProjects);
  });

  it('工厂全部可用并返回正确实例类型', async () => {
    const ctx = await withProjects();
    const svc: ProjectsService = ctx.catsProjects;
    expect(svc.createIntentCardStore()).toBeInstanceOf(IntentCardStore);
    expect(svc.createNeedAuditFrameStore()).toBeInstanceOf(NeedAuditFrameStore);
    expect(svc.createResolutionStore()).toBeInstanceOf(ResolutionStore);
    expect(svc.createSliceStore()).toBeInstanceOf(SliceStore);
    expect(svc.createRefluxPatternStore()).toBeInstanceOf(RefluxPatternStore);
    expect(svc.createExecutionDigestStore()).toBeInstanceOf(ExecutionDigestStore);
    const external = svc.createExternalProjectStore();
    expect(external).toBeInstanceOf(ExternalProjectStore);
  });
});

describe('C28 IntentCardStore — Stage 1-2', () => {
  it('create → triage → listByProject(bucket) 过滤', () => {
    const store = new IntentCardStore();
    const card = store.create(makeCardInput());
    expect(card.id).toMatch(/^ic-/);
    expect(card.triage).toBeNull();

    const triaged = store.triage(card.id, { clarity: 3, groundedness: 3, necessity: 3, coupling: 1, sizeBand: 'S' });
    expect(triaged?.triage?.bucket).toBe('build_now');

    expect(store.listByProject('proj-1', 'build_now')).toHaveLength(1);
    expect(store.listByProject('proj-1', 'later')).toHaveLength(0);
  });

  it('triage 不存在的 id → null；delete 生效', () => {
    const store = new IntentCardStore();
    expect(store.triage('nope', { clarity: 3, groundedness: 3, necessity: 3, coupling: 1, sizeBand: 'S' })).toBeNull();
    const card = store.create(makeCardInput());
    expect(store.delete(card.id)).toBe(true);
    expect(store.getById(card.id)).toBeNull();
  });
});

describe('C28 ExternalProjectStore — P2-1 防护 + KV 注入', () => {
  it('backlogPath 逃逸 sourcePath → 抛错（P2-1）', async () => {
    const store = new ExternalProjectStore();
    await expect(
      store.create('u1', { name: 'x', description: 'd', sourcePath: '/repo/app', backlogPath: '../secret' }),
    ).rejects.toThrow('backlogPath must not escape sourcePath');
  });

  it('create → listByUser 按时间倒序 → update → delete', async () => {
    const store = new ExternalProjectStore();
    const p1 = await store.create('u1', { name: 'a', description: 'd', sourcePath: '/repo/app' });
    const p2 = await store.create('u1', { name: 'b', description: 'd', sourcePath: '/repo/app' });
    expect(p1.backlogPath).toBe('docs/ROADMAP.md');
    expect(p1.id).toMatch(/^ep-/);

    const list = await store.listByUser('u1');
    expect(list.map((p) => p.id)).toEqual([p2.id, p1.id]); // zrevrange 倒序

    const updated = await store.update(p1.id, { description: 'new desc' });
    expect(updated?.description).toBe('new desc');

    expect(await store.delete(p2.id)).toBe(true);
    expect(await store.getById(p2.id)).toBeNull();
  });

  it('宿主注入自定义 KV 实现（记录调用）', async () => {
    const calls: string[] = [];
    const kv: ExternalProjectKV = {
      hset: vi.fn(async () => { calls.push('hset'); }),
      hgetall: vi.fn(async () => null),
      del: vi.fn(async () => { calls.push('del'); }),
      zadd: vi.fn(async () => { calls.push('zadd'); }),
      zrem: vi.fn(async () => { calls.push('zrem'); }),
      zrevrange: vi.fn(async () => []),
    };
    const store = new ExternalProjectStore(kv);
    await store.create('u1', { name: 'a', description: 'd', sourcePath: '/repo/app' });
    expect(calls).toEqual(['hset', 'zadd']);
  });

  it('MemoryExternalProjectKV 负索引 zrevrange', async () => {
    const kv = new MemoryExternalProjectKV();
    await kv.zadd('k', 1, 'a');
    await kv.zadd('k', 3, 'c');
    await kv.zadd('k', 2, 'b');
    expect(await kv.zrevrange('k', 0, -1)).toEqual(['c', 'b', 'a']);
    expect(await kv.zrevrange('k', 0, 0)).toEqual(['c']);
    expect(await kv.zrevrange('k', -2, -1)).toEqual(['b', 'a']);
  });
});

describe('C28 SliceStore — per-project order 计数器', () => {
  it('同项目 order 递增；跨项目独立计数', () => {
    const store = new SliceStore();
    const s1 = store.create('p1', { name: 'slice-1', sliceType: 'value', description: 'd', actor: 'a', workflow: 'w', verifiableOutcome: 'o' });
    const s2 = store.create('p1', { name: 'slice-2', sliceType: 'value', description: 'd', actor: 'a', workflow: 'w', verifiableOutcome: 'o' });
    const other = store.create('p2', { name: 'slice-3', sliceType: 'learning', description: 'd', actor: 'a', workflow: 'w', verifiableOutcome: 'o' });
    expect(s1.order).toBe(0);
    expect(s2.order).toBe(1);
    expect(other.order).toBe(0);
    expect(store.listByProject('p1').map((s) => s.order)).toEqual([0, 1]);
  });

  it('reorder 交换 order；listByType 过滤', () => {
    const store = new SliceStore();
    const base = { sliceType: 'value' as const, description: 'd', actor: 'a', workflow: 'w', verifiableOutcome: 'o' };
    const s1 = store.create('p1', { name: 'a', ...base });
    const s2 = store.create('p1', { name: 'b', ...base });
    expect(store.reorder(s1.id, s2.id)).toBe(true);
    expect(store.getById(s1.id)?.order).toBe(1);
    expect(store.getById(s2.id)?.order).toBe(0);
    expect(store.reorder('nope', s2.id)).toBe(false);
    expect(store.listByType('p1', 'value')).toHaveLength(2);
    expect(store.listByType('p1', 'learning')).toHaveLength(0);
  });
});

describe('C28 ResolutionStore — Stage 3 澄清队列', () => {
  it('create open → answer answered → escalate escalated → listOpen 过滤', () => {
    const store = new ResolutionStore();
    const item = store.create('p1', { cardId: 'ic-1', path: 'confirmation', question: '确认范围？', options: ['A', 'B'], recommendation: 'A' });
    expect(item.status).toBe('open');
    expect(store.listOpen('p1')).toHaveLength(1);

    const answered = store.answer(item.id, { answer: 'A' });
    expect(answered?.status).toBe('answered');
    expect(answered?.answeredAt).not.toBeNull();
    expect(store.listOpen('p1')).toHaveLength(0);

    const escalated = store.escalate(item.id);
    expect(escalated?.status).toBe('escalated');
    expect(store.listByCard('ic-1')).toHaveLength(1);
  });
});

describe('C28 NeedAuditFrameStore — 每项目一帧', () => {
  it('sponsor/successMetric 必填校验', () => {
    const store = new NeedAuditFrameStore();
    expect(() => store.upsert('p1', { sponsor: '', motivation: 'm', successMetric: 's', constraints: 'c', currentWorkflow: 'w', provenanceMap: 'm' }))
      .toThrow('sponsor is required');
    expect(() => store.upsert('p1', { sponsor: 's', motivation: 'm', successMetric: '', constraints: 'c', currentWorkflow: 'w', provenanceMap: 'm' }))
      .toThrow('successMetric is required');
  });

  it('upsert 同项目更新单帧', () => {
    const store = new NeedAuditFrameStore();
    const f1 = store.upsert('p1', { sponsor: 's1', motivation: 'm', successMetric: 'metric-1', constraints: 'c', currentWorkflow: 'w', provenanceMap: 'm' });
    const f2 = store.upsert('p1', { sponsor: 's1', motivation: 'm2', successMetric: 'metric-1', constraints: 'c', currentWorkflow: 'w', provenanceMap: 'm' });
    expect(f1.id).toBe(f2.id);
    expect(f2.motivation).toBe('m2');
    expect(store.getByProject('p1')?.id).toBe(f1.id);
  });
});

describe('C28 ExecutionDigestStore — F070 digest', () => {
  it('create → listByProject / listByThread / listAll 按 completedAt 倒序', () => {
    const store = new ExecutionDigestStore();
    const base = {
      userId: 'u1',
      projectPath: '/repo/app',
      threadId: 't-1',
      catId: 'cat-1',
      missionPack: { mission: 'm', workItem: 'wi', phase: 'p', doneWhen: [], links: [] },
      summary: 's',
      filesChanged: [],
      status: 'completed' as const,
      doneWhenResults: [],
      nextSteps: [],
    };
    const d1 = store.create({ ...base, completedAt: 100 });
    const d2 = store.create({ ...base, completedAt: 200 });
    expect(d1.id).toMatch(/^ed-/);
    expect(store.listByProject('/repo/app', 'u1').map((d) => d.id)).toEqual([d2.id, d1.id]);
    expect(store.listByThread('t-1', 'u1')).toHaveLength(2);
    expect(store.listAll('u1')).toHaveLength(2);
    expect(store.listAll('u2')).toHaveLength(0);
  });
});

describe('C28 RefluxPatternStore — 方法论经验', () => {
  it('create → listByProject / listByCategory / delete', () => {
    const store = new RefluxPatternStore();
    const p = store.create('p1', { category: 'methodology', title: 't', insight: 'i', evidence: 'e' });
    expect(p.id).toMatch(/^rfx-/);
    expect(store.listByProject('p1')).toHaveLength(1);
    expect(store.listByCategory('p1', 'risk_pattern')).toHaveLength(0);
    expect(store.delete(p.id)).toBe(true);
    expect(store.getById(p.id)).toBeUndefined();
  });
});

describe('C28 generateSortableId — 可排序 ID', () => {
  it('格式：16 位时间戳-6 位序号-8 位 uuid', () => {
    const id = generateSortableId(1_700_000_000_000);
    expect(id).toMatch(/^\d{16}-\d{6}-[0-9a-f]{8}$/);
  });

  it('同时间戳连续生成有序递增（序号段）', () => {
    const a = generateSortableId(5);
    const b = generateSortableId(5);
    expect(b > a).toBe(true);
  });

  it('非法时间戳抛 RangeError', () => {
    expect(() => generateSortableId(-1)).toThrow(RangeError);
    expect(() => generateSortableId(Number.NaN)).toThrow(RangeError);
  });
});

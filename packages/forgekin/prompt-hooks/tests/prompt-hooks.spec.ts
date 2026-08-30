/**
 * prompt-hooks 插件包测试 — C41（F237 Phase 1+2）。
 *
 * 覆盖：manifest parser 校验 / registry 扫描真实资产 46 hooks / 校验规则
 * （order 冲突、目录前缀、模板缺失）/ pipeline 执行（disabled/skipped/fired/
 * template_missing/TEMPLATE_VARIANT/CONTENT passthrough）/ builder scope 过滤
 * / trace 双层持久化 / Cordis 插件挂载。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '@flowforge/cordis';
import { afterEach, describe, expect, it } from 'vitest';

import { parseHookManifest } from '../src/hook-manifest-parser.js';
import { HookRegistry } from '../src/hook-registry.js';
import { HookPipeline, estimateTokens, hashContent } from '../src/hook-pipeline.js';
import { PipelinePromptBuilder } from '../src/prompt-builder.js';
import { InjectionTraceStore, MemoryTraceBackend } from '../src/injection-trace.js';
import { InputGatedResolver, ResolverRegistry, VariantPickerResolver } from '../src/resolvers.js';
import ForgePromptHooksService from '../src/index.js';
import type { AssemblerInput, ResolveResult } from '../src/types.js';

// ---------------------------------------------------------------------------
// 资产路径（真实包资产）
// ---------------------------------------------------------------------------

const ASSETS_ROOT = fileURLToPath(new URL('../assets/', import.meta.url));
const HOOKS_DIR = join(ASSETS_ROOT, 'prompt-hooks');
const TEMPLATES_DIR = join(ASSETS_ROOT, 'prompt-templates');

// ---------------------------------------------------------------------------
// 测试 helper
// ---------------------------------------------------------------------------

/** 构造最小完整 AssemblerInput（全字段，可覆盖）。 */
function makeInput(overrides: Partial<AssemblerInput> = {}): AssemblerInput {
  return {
    catId: 'test-cat',
    catConfig: {
      displayName: 'Test Cat',
      name: 'test',
      roleDescription: '',
      personality: '',
      mentionPatterns: [],
    },
    runtimeModel: 'gpt-4o',
    providerLabel: 'test',
    callableMentions: { mentions: [], hasDuplicateDisplayNames: false, uniqueHandleExample: null },
    rosterContent: null,
    workflowTriggerContent: null,
    coCreatorName: '',
    coCreatorHandles: '',
    governanceDigest: '',
    mcpToolsSection: '',
    packMasksBlock: null,
    packWorkflowsBlock: null,
    packGuardrailBlock: null,
    packDefaultsBlock: null,
    packWorldDriverSummary: null,
    mode: 'independent',
    chainIndex: null,
    chainTotal: null,
    mcpAvailable: false,
    nativeL0Injected: false,
    a2aEnabled: false,
    directMessage: null,
    crossThreadReplyHint: null,
    pingPongWarning: null,
    teammates: [],
    mentionRoutingItems: [],
    promptTags: [],
    activeParticipants: [],
    routingPolicyParts: null,
    sopStageHint: null,
    voiceMode: false,
    bootcampState: null,
    threadId: null,
    bootcampMemberCount: null,
    guidePromptLines: null,
    conciergeLines: null,
    worldContext: null,
    alwaysOnDocsBlock: null,
    activeSignalsBlock: null,
    a2aBallCheckContent: null,
    handoffDecisionTreeContent: null,
    coCreatorFirstMention: '',
    ...overrides,
  };
}

/** 合法 S1 清单模板。 */
function validYaml(id = 'S1', extra = ''): string {
  return [
    `id: ${id}`,
    'name: Test Hook',
    'stage: session-init',
    'order: 100',
    'version: 1',
    'enabled: true',
    'template: tpl.md',
    'inputs: []',
    'disableable: true',
    'safetyTier: readonly',
    'transparencyTier: visible-by-default',
    'governanceTier: human-gated',
    extra,
  ].join('\n');
}

/** 创建含 hook.yaml + 可选模板的 hook 子目录，返回目录路径。 */
function writeHookDir(base: string, entry: string, yaml: string, template?: string): string {
  const dir = join(base, entry);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hook.yaml'), yaml);
  if (template !== undefined) writeFileSync(join(dir, 'tpl.md'), template);
  return dir;
}

// ---------------------------------------------------------------------------
// manifest parser
// ---------------------------------------------------------------------------

describe('hook-manifest-parser', () => {
  it('解析合法 hook.yaml', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-hook-parser-'));
    try {
      writeFileSync(join(dir, 'hook.yaml'), validYaml());
      const result = parseHookManifest(join(dir, 'hook.yaml'));
      expect(result.ok).toBe(true);
      expect(result.manifest).toMatchObject({ id: 'S1', stage: 'session-init', order: 100, enabled: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('拒绝非法 ID 格式（小写/符号）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-hook-parser-'));
    try {
      writeFileSync(join(dir, 'hook.yaml'), validYaml('s1'));
      const result = parseHookManifest(join(dir, 'hook.yaml'));
      expect(result.ok).toBe(false);
      expect(result.errors.join(';')).toContain('does not match pattern');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('拒绝缺失必填字段与非法枚举', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-hook-parser-'));
    try {
      const bad = validYaml().replace('safetyTier: readonly', 'safetyTier: nope').replace('order: 100', '');
      writeFileSync(join(dir, 'hook.yaml'), bad);
      const result = parseHookManifest(join(dir, 'hook.yaml'));
      expect(result.ok).toBe(false);
      expect(result.errors.join(';')).toContain("'order' must be a finite number");
      expect(result.errors.join(';')).toContain("'safetyTier' must be one of");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('拒绝非对象 YAML 根', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-hook-parser-'));
    try {
      writeFileSync(join(dir, 'hook.yaml'), '- a\n- b');
      const result = parseHookManifest(join(dir, 'hook.yaml'));
      expect(result.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

describe('HookRegistry', () => {
  it('扫描真实资产：46 hooks 全部注册且 stage/order 分布正确', () => {
    const registry = new HookRegistry(HOOKS_DIR, TEMPLATES_DIR);
    const manifests = registry.scan();
    expect(manifests).toHaveLength(46);
    expect(registry.size()).toBe(46);

    const session = registry.getStageHooks('session-init');
    const turn = registry.getStageHooks('per-turn');
    expect(session).toHaveLength(22); // S1-S13 + B1 + C1 + L1-L7
    expect(turn).toHaveLength(24); // D1-D21 + R1-R2 + N1

    // order 升序
    const orders = turn.map((h) => h.manifest.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    // ID 集合完整
    const ids = manifests.map((m) => m.id).sort();
    expect(ids).toEqual(
      [
        'B1', 'C1',
        'D1', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17', 'D18', 'D19',
        'D2', 'D20', 'D21', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9',
        'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7',
        'N1', 'R1', 'R2',
        'S1', 'S10', 'S11', 'S12', 'S13', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9',
      ].sort(),
    );

    // 模板路径：hook 子目录优先（B1 自带），集中目录回退（D8/S6）
    expect(registry.getHook('B1')!.templatePath).toContain('prompt-hooks');
    expect(registry.getHook('D8')!.templatePath).toContain('prompt-templates');
    expect(registry.getHook('S6')!.templatePath).toContain('prompt-templates');
  });

  it('同 stage order 冲突：后者跳过并告警', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-reg-'));
    try {
      writeHookDir(base, 's1-a', validYaml('S1'), 'tpl');
      writeHookDir(base, 's1-b', validYaml('S2'), 'tpl');
      const registry = new HookRegistry(base);
      const manifests = registry.scan();
      expect(manifests).toHaveLength(1);
      expect(manifests[0]!.id).toBe('S1');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('目录前缀不匹配 manifest.id 小写：跳过', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-reg-'));
    try {
      writeHookDir(base, 'wrong-prefix', validYaml('S1'));
      const registry = new HookRegistry(base);
      expect(registry.scan()).toHaveLength(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('模板缺失：跳过', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-reg-'));
    try {
      const yaml = validYaml().replace('template: tpl.md', 'template: missing.md');
      writeHookDir(base, 's1-x', yaml);
      const registry = new HookRegistry(base);
      expect(registry.scan()).toHaveLength(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('目录不存在：scan 返回空且不抛错', () => {
    const registry = new HookRegistry(join(tmpdir(), 'no-such-hooks-dir'));
    expect(registry.scan()).toEqual([]);
    expect(registry.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pipeline
// ---------------------------------------------------------------------------

describe('HookPipeline', () => {
  it('hashContent：sha256 前 16 hex；estimateTokens：len/4 向上取整', () => {
    expect(hashContent('hello')).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hashContent('hello'))).toBe(true);
    expect(estimateTokens('hello')).toBe(2); // 5/4 → 2
    expect(estimateTokens('')).toBe(0);
  });

  it('disabled hook 不产出 patch，事件为 disabled', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-pipe-'));
    try {
      writeHookDir(base, 's1-x', validYaml().replace('enabled: true', 'enabled: false'), 'content');
      const registry = new HookRegistry(base);
      registry.scan();

      const pipeline = new HookPipeline(registry, new Map(), () => null);
      const { patches, events } = pipeline.executeStage('session-init', makeInput());
      expect(patches).toHaveLength(0);
      expect(events[0]!).toMatchObject({ hookId: 'S1', status: 'disabled', disabledBy: 'manifest' });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('resolver 返回 skipped：不产出 patch，事件带 reason', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-pipe-'));
    try {
      writeHookDir(base, 's1-x', validYaml(), 'content');
      const registry = new HookRegistry(base);
      registry.scan();

      const resolvers = new Map([['S1', new InputGatedResolver({ requireNonEmptyFields: ['mcpToolsSection'] })]]);
      const pipeline = new HookPipeline(registry, resolvers, () => null);
      const { patches, events } = pipeline.executeStage('session-init', makeInput()); // mcpToolsSection=''
      expect(patches).toHaveLength(0);
      expect(events[0]!).toMatchObject({ hookId: 'S1', status: 'skipped', reasonCode: 'condition_not_met' });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('fired：文件回退渲染 + patch + trace（version/hash/tokens）', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-pipe-'));
    try {
      writeHookDir(base, 's1-x', validYaml(), 'Hello {{NAME}}');
      const registry = new HookRegistry(base);
      registry.scan();

      const pipeline = new HookPipeline(registry, new Map(), () => null);
      const { patches, events } = pipeline.executeStage('session-init', makeInput());
      // 主 renderer 返回 null → 文件回退渲染 {{NAME}} 无 vars → 保留原文
      expect(patches).toHaveLength(1);
      expect(patches[0]!.content).toBe('Hello {{NAME}}');
      expect(patches[0]!.order).toBe(100);
      expect(events[0]!).toMatchObject({ hookId: 'S1', status: 'fired', version: 1 });
      expect(events[0]!).toHaveProperty('contentHash');
      expect(events[0]!).toHaveProperty('tokenEstimate');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('主 renderer 生效 + vars 渲染 + TEMPLATE_VARIANT 变体选择', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-pipe-'));
    try {
      const yaml = validYaml('D7').replace('stage: session-init', 'stage: per-turn');
      writeHookDir(base, 'd7-x', yaml, 'tpl');
      const registry = new HookRegistry(base);
      registry.scan();

      const resolvers = new Map([
        ['D7', new VariantPickerResolver({ field: 'mode', variants: { serial: 'D7-serial' } })],
      ]);
      const renderer = (segmentId: string, vars: Record<string, string>) =>
        segmentId === 'D7-serial' ? `serial-mode(${vars.MODE ?? 'none'})` : null;
      const pipeline = new HookPipeline(registry, resolvers, renderer);
      const { patches } = pipeline.executeStage('per-turn', makeInput({ mode: 'serial' }));
      expect(patches).toHaveLength(1);
      expect(patches[0]!.content).toBe('serial-mode(none)');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('CONTENT passthrough：跳过模板渲染（模板缺失也触发）', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-pipe-'));
    try {
      const yaml = validYaml('S13').replace('template: tpl.md', 'template: missing-template.md');
      const hookDir = writeHookDir(base, 's13-x', yaml);
      const parsed = parseHookManifest(join(hookDir, 'hook.yaml'));
      expect(parsed.ok).toBe(true);

      // 直接构造 RegisteredHook 绕过 registry 模板校验
      const resolvers = new Map([
        ['S13', { resolve: (): ResolveResult => ({ status: 'fired', vars: { CONTENT: 'pre-rendered' } }) }],
      ]);
      const fakeRegistry = {
        getStageHooks: () => [
          {
            manifest: parsed.manifest!,
            dirPath: hookDir,
            templatePath: join(hookDir, 'missing-template.md'),
          },
        ],
      } as unknown as HookRegistry;
      const pipeline = new HookPipeline(fakeRegistry, resolvers, () => null);
      const { patches } = pipeline.executeStage('session-init', makeInput());
      expect(patches).toHaveLength(1);
      expect(patches[0]!.content).toBe('pre-rendered');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('template_missing：resolver 触发但渲染无内容 → skipped trace', () => {
    const base = mkdtempSync(join(tmpdir(), 'ff-hook-pipe-'));
    try {
      const yaml = validYaml().replace('template: tpl.md', 'template: nope.md');
      const hookDir = writeHookDir(base, 's1-x', yaml);
      const parsed = parseHookManifest(join(hookDir, 'hook.yaml'));
      expect(parsed.ok).toBe(true);

      const fakeRegistry = {
        getStageHooks: () => [
          {
            manifest: parsed.manifest!,
            dirPath: hookDir,
            templatePath: join(hookDir, 'nope.md'),
          },
        ],
      } as unknown as HookRegistry;
      const pipeline = new HookPipeline(fakeRegistry, new Map(), () => null);
      const { patches, events } = pipeline.executeStage('session-init', makeInput());
      expect(patches).toHaveLength(0);
      expect(events[0]!).toMatchObject({ status: 'skipped', reasonCode: 'template_missing' });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('assemblePatches：双换行连接且保持顺序', () => {
    expect(
      HookPipeline.assemblePatches([
        { hookId: 'S1', content: 'a', order: 100 },
        { hookId: 'S2', content: 'b', order: 200 },
      ]),
    ).toBe('a\n\nb');
  });
});

// ---------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------

describe('PipelinePromptBuilder', () => {
  it('scope 过滤：默认 session=S 系 / turn=D 系', () => {
    const registry = new HookRegistry(HOOKS_DIR, TEMPLATES_DIR);
    registry.scan();
    const builder = new PipelinePromptBuilder(registry, new Map(), () => 'segment');

    const session = builder.buildSessionPrompt(makeInput());
    // S1-S13 全部 fire → 13 段（B/C/L 被 scope 过滤）
    expect(session.split('\n\n')).toHaveLength(13);

    const turn = builder.buildTurnPrompt(makeInput());
    expect(turn.split('\n\n')).toHaveLength(21); // D1-D21
  });

  it('自定义 scope 正则生效', () => {
    const registry = new HookRegistry(HOOKS_DIR, TEMPLATES_DIR);
    registry.scan();
    const builder = new PipelinePromptBuilder(registry, new Map(), () => 'segment', {
      sessionScope: /^L\d/,
    });
    const session = builder.buildSessionPrompt(makeInput());
    expect(session.split('\n\n')).toHaveLength(7); // L1-L7
  });

  it('annotateSegments：fired 带内容，其余空标记', () => {
    const registry = new HookRegistry(HOOKS_DIR, TEMPLATES_DIR);
    registry.scan();
    const builder = new PipelinePromptBuilder(registry, new Map(), () => 'segment');
    const out = builder.buildSessionPrompt(makeInput(), { annotateSegments: true });
    expect(out).toContain('── [S1] S1 ──\nsegment');
    expect(out).toContain('── [S13] S13 ──');
  });

  it('buildSystemPrompt：全量输出 + 双 trace', () => {
    const registry = new HookRegistry(HOOKS_DIR, TEMPLATES_DIR);
    registry.scan();
    const builder = new PipelinePromptBuilder(registry, new Map(), () => 'segment');
    const { prompt, sessionTrace, turnTrace } = builder.buildSystemPrompt(makeInput(), makeInput());
    expect(sessionTrace.patches).toHaveLength(22); // session-init 全量
    expect(turnTrace.patches).toHaveLength(24); // per-turn 全量
    expect(prompt).toContain('segment');
  });

  it('drainCapturedTraces：取一次清空', () => {
    const registry = new HookRegistry(HOOKS_DIR, TEMPLATES_DIR);
    registry.scan();
    const builder = new PipelinePromptBuilder(registry, new Map(), () => 'segment');
    builder.buildSessionPrompt(makeInput());
    const first = builder.drainCapturedTraces();
    expect(first.session?.patches.length).toBeGreaterThan(0);
    const second = builder.drainCapturedTraces();
    expect(second.session).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// injection trace store
// ---------------------------------------------------------------------------

describe('InjectionTraceStore', () => {
  const summary = {
    turnId: 't1',
    sessionId: 's1',
    threadId: 'th1',
    catId: 'cat1',
    timestamp: 1000,
    hooks: [],
    delivery: [],
    totalTokens: 42,
    totalHooksFired: 1,
    totalHooksSkipped: 0,
    totalDurationMs: 5,
  };

  const detail = {
    turnId: 't1',
    threadId: 'th1',
    catId: 'cat1',
    timestamp: 1000,
    hooks: [],
  };

  it('persist/get/list/delete 全链路（内存后端）', async () => {
    const store = new InjectionTraceStore(new MemoryTraceBackend());
    await store.persist(summary, detail);

    expect(await store.getSummary('th1', 't1')).toMatchObject({ turnId: 't1', totalTokens: 42 });
    expect(await store.getDetail('th1', 't1')).toMatchObject({ turnId: 't1' });
    expect(await store.getSummary('th1', 'missing')).toBeNull();

    const { turnIds, total } = await store.listTurnIds('th1');
    expect(turnIds).toEqual(['t1']);
    expect(total).toBe(1);

    const { summaries } = await store.listSummaries('th1');
    expect(summaries).toHaveLength(1);

    await store.deleteTurn('th1', 't1');
    expect(await store.getSummary('th1', 't1')).toBeNull();
    expect(await store.listTurnIds('th1')).toEqual({ turnIds: [], total: 0 });
  });

  it('多 turn 按 timestamp 降序 + 分页', async () => {
    const store = new InjectionTraceStore(new MemoryTraceBackend());
    for (let i = 1; i <= 3; i += 1) {
      await store.persist(
        { ...summary, turnId: `t${i}`, timestamp: 1000 + i },
        { ...detail, turnId: `t${i}`, timestamp: 1000 + i },
      );
    }
    const page1 = await store.listTurnIds('th1', { limit: 2 });
    expect(page1.turnIds).toEqual(['t3', 't2']);
    expect(page1.total).toBe(3);
    const page2 = await store.listTurnIds('th1', { limit: 2, offset: 2 });
    expect(page2.turnIds).toEqual(['t1']);
  });

  it('损坏 JSON：get 返回 null 不抛错', async () => {
    const backend = new MemoryTraceBackend();
    await backend.set('injection-trace-summary:th1:bad', '{not-json');
    const store = new InjectionTraceStore(backend);
    expect(await store.getSummary('th1', 'bad')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolvers
// ---------------------------------------------------------------------------

describe('ResolverRegistry + 内置 resolvers', () => {
  it('register/get/ids/size/clear', () => {
    const reg = new ResolverRegistry();
    reg.registerResolver('S1', new InputGatedResolver({ requireFields: ['catId'] }));
    reg.registerResolvers({ D1: new InputGatedResolver({ requireFields: ['catId'] }) });
    expect(reg.size()).toBe(2);
    expect(reg.getResolver('S1')).toBeDefined();
    expect(reg.getResolver('X9')).toBeUndefined();
    expect([...reg.getRegisteredResolverIds()].sort()).toEqual(['D1', 'S1']);
    expect(reg.toReadonlyMap().size).toBe(2);
    reg.clear();
    expect(reg.size()).toBe(0);
  });

  it('InputGatedResolver：缺失/空/等值不满足 → skipped', () => {
    const resolver = new InputGatedResolver({
      requireNonEmptyFields: ['rosterContent'],
      equals: { mode: 'serial' },
    });
    expect(resolver.resolve(makeInput()).status).toBe('skipped');
    expect(resolver.resolve(makeInput({ rosterContent: 'x', mode: 'independent' })).status).toBe('skipped');
    expect(resolver.resolve(makeInput({ rosterContent: 'x', mode: 'serial' }))).toMatchObject({
      status: 'fired',
      vars: {},
    });
  });

  it('VariantPickerResolver：匹配变体 / 无匹配用缺省', () => {
    const resolver = new VariantPickerResolver({
      field: 'mode',
      variants: { serial: 'D7-serial' },
      defaultVariant: 'D7-solo',
    });
    const r1 = resolver.resolve(makeInput({ mode: 'serial' }));
    expect(r1.status).toBe('fired');
    if (r1.status === 'fired') expect(r1.vars).toEqual({ TEMPLATE_VARIANT: 'D7-serial' });
    const r2 = resolver.resolve(makeInput({ mode: 'parallel' }));
    expect(r2.status).toBe('fired');
    if (r2.status === 'fired') expect(r2.vars).toEqual({ TEMPLATE_VARIANT: 'D7-solo' });
  });
});

// ---------------------------------------------------------------------------
// 插件挂载
// ---------------------------------------------------------------------------

describe('ForgePromptHooksService (Cordis plugin)', () => {
  const fibers: { dispose: () => Promise<void> | void }[] = [];

  afterEach(async () => {
    while (fibers.length) {
      const fiber = fibers.pop()!;
      await fiber.dispose();
    }
  });

  it('ctx.plugin 挂载 ctx.forgePromptHooks，扫描 46 hooks 且管线可执行', async () => {
    const ctx = new Context();
    const fiber = (await ctx.plugin(ForgePromptHooksService)) as unknown as {
      dispose: () => Promise<void> | void;
    };
    fibers.push(fiber);
    try {
      expect(ctx.forgePromptHooks).toBeDefined();
      expect(ctx.forgePromptHooks.registrySize()).toBe(46);

      // 注册业务 resolver 后执行
      ctx.forgePromptHooks.registerResolver('S6', {
        resolve: () => ({ status: 'fired', vars: { CONTENT: 'workflow-triggers' } }),
      });
      const result = ctx.forgePromptHooks.executeStage('session-init', makeInput());
      expect(result.patches.length).toBeGreaterThan(0);

      // builder 入口
      const prompt = ctx.forgePromptHooks.buildTurnPrompt(makeInput());
      expect(prompt.length).toBeGreaterThan(0);

      // trace 入口
      await ctx.forgePromptHooks.persistTrace(
        {
          turnId: 't1', sessionId: 's1', threadId: 'th1', catId: 'cat1', timestamp: 1,
          hooks: [], delivery: [], totalTokens: 0, totalHooksFired: 0, totalHooksSkipped: 0, totalDurationMs: 0,
        },
        { turnId: 't1', threadId: 'th1', catId: 'cat1', timestamp: 1, hooks: [] },
      );
      expect(await ctx.forgePromptHooks.getSummary('th1', 't1')).not.toBeNull();
      expect(ctx.forgePromptHooks.resolverIds()).toContain('S6');
    } finally {
      void ctx;
    }
  });

  it('可注入 hooksDir/templatesDir/traceBackend 配置', async () => {
    const ctx = new Context();
    const backend = new MemoryTraceBackend();
    const fiber = (await ctx.plugin(ForgePromptHooksService, {
      hooksDir: HOOKS_DIR,
      templatesDir: TEMPLATES_DIR,
      traceBackend: backend,
    })) as unknown as { dispose: () => Promise<void> | void };
    fibers.push(fiber);
    try {
      expect(ctx.forgePromptHooks.registrySize()).toBe(46);
      await expect(ctx.forgePromptHooks.getSummary('th', 't')).resolves.toBeNull();
    } finally {
      void ctx;
    }
  });
});

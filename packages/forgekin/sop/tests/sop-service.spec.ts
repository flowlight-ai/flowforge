/**
 * SopService — T7.24 SOP 域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeSop 挂载（默认 Plugin + 带 options）
 * - register / get / has / ids 注册门面
 * - executor 惰性创建与复用
 * - executeSop / executeStage / progress 便捷门面
 * - loadDir 从目录加载
 * - registerChecker 扩展自定义谓词
 * - snapshot 快照
 *
 * @module @flowforge/forgekin-sop/tests
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, { SopService } from '../src/index.js';
import {
  makeHardRule,
  makePredicateConfig,
  makeSOPDefinition,
  makeSOPStage,
  PredicateType,
  Severity,
} from '../src/models.js';

function simpleSop(id: string) {
  return makeSOPDefinition({
    id,
    stages: [
      makeSOPStage({
        id: 'gate',
        label: 'Gate',
        hardRules: [
          makeHardRule({
            id: 'r1',
            text: 'manual gate',
            predicate: makePredicateConfig({ type: PredicateType.MANUAL_ONLY }),
          }),
        ],
      }),
    ],
  });
}

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeSop', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeSop).toBeInstanceOf(SopService);
    expect(ctx.forgeSop.ids()).toEqual([]);
  });

  it('options.sops 预置定义', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { sops: new Map([['dev', simpleSop('dev')]]) });
    expect(ctx.forgeSop.has('dev')).toBe(true);
    expect(ctx.forgeSop.get('dev').stages).toHaveLength(1);
  });

  it('get 未注册 id 抛错', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(() => ctx.forgeSop.get('ghost')).toThrow('SOP not registered: ghost');
  });
});

describe('执行门面', () => {
  it('executor 惰性创建且同 id 复用', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { sops: new Map([['dev', simpleSop('dev')]]) });
    const exec1 = ctx.forgeSop.executor('dev');
    const exec2 = ctx.forgeSop.executor('dev');
    expect(exec1).toBe(exec2);
  });

  it('executeSop 全流程通过', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { sops: new Map([['dev', simpleSop('dev')]]) });
    const result = await ctx.forgeSop.executeSop('dev', 'feat-1');
    expect(result.success).toBe(true);
    expect(result.stageResults).toHaveLength(1);
  });

  it('executeStage 单阶段门禁', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { sops: new Map([['dev', simpleSop('dev')]]) });
    const stage = await ctx.forgeSop.executeStage('dev', 'gate');
    expect(stage.passed).toBe(true);
  });

  it('progress 反映执行进度', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { sops: new Map([['dev', simpleSop('dev')]]) });
    const progress = ctx.forgeSop.progress('dev');
    expect(progress.sopId).toBe('dev');
    expect(progress.totalStages).toBe(1);
    expect(progress.isCompleted).toBe(false);
  });

  it('register 覆盖后重建 executor', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { sops: new Map([['dev', simpleSop('dev')]]) });
    const before = ctx.forgeSop.executor('dev');
    ctx.forgeSop.register(
      makeSOPDefinition({ id: 'dev', stages: [makeSOPStage({ id: 'a' }), makeSOPStage({ id: 'b' })] }),
    );
    const after = ctx.forgeSop.executor('dev');
    expect(after).not.toBe(before);
    expect(ctx.forgeSop.progress('dev').totalStages).toBe(2);
  });
});

describe('谓词扩展与直接检查', () => {
  it('check 直接执行谓词（注入 env）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { checkerOptions: { env: { TOKEN: 'x' } } });
    const result = await ctx.forgeSop.check(
      makePredicateConfig({ type: PredicateType.ENV_CHECK, envVars: ['TOKEN'] }),
    );
    expect(result.passed).toBe(true);
  });

  it('registerChecker 注册自定义检查器并参与门禁', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    ctx.forgeSop.registerChecker('never', async () => ({
      passed: false,
      message: 'never passes',
      evidence: {},
    }));
    ctx.forgeSop.register(
      makeSOPDefinition({
        id: 'strict',
        stages: [
          makeSOPStage({
            id: 'gate',
            hardRules: [
              makeHardRule({
                id: 'n1',
                text: 'never rule',
                severity: Severity.BLOCKER,
                predicate: makePredicateConfig({ type: 'never' as PredicateType }),
              }),
            ],
          }),
        ],
      }),
    );
    const result = await ctx.forgeSop.executeSop('strict', 'feat-x');
    expect(result.success).toBe(false);
    expect(result.blockerMessages[0]).toContain('never passes');
  });
});

describe('YAML 加载门面', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sop-svc-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loadFile 加载并注册', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const path = join(dir, 'one.yaml');
    await writeFile(path, 'id: one\nstages:\n  - id: s1\n', 'utf-8');
    const sop = await ctx.forgeSop.loadFile(path);
    expect(sop.id).toBe('one');
    expect(ctx.forgeSop.has('one')).toBe(true);
  });

  it('loadDir 批量加载并返回 ids', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    await writeFile(join(dir, 'a.yaml'), 'id: sop-a\nstages:\n  - id: s1\n', 'utf-8');
    await writeFile(join(dir, 'b.yaml'), 'id: sop-b\nstages: []\n', 'utf-8');
    const ids = await ctx.forgeSop.loadDir(dir);
    expect(ids.sort()).toEqual(['sop-a', 'sop-b']);
    expect(ctx.forgeSop.ids().sort()).toEqual(['sop-a', 'sop-b']);
  });
});

describe('snapshot', () => {
  it('汇总 sops / 阶段数 / 规则数', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { sops: new Map([['dev', simpleSop('dev')]]) });
    const snap = ctx.forgeSop.snapshot();
    expect(snap.count).toBe(1);
    expect(snap.sops[0]).toMatchObject({
      id: 'dev',
      domain: 'engineering',
      stages: 1,
      hardRules: 1,
      pitfalls: 0,
    });
  });
});

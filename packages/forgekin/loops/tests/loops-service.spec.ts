/**
 * LoopsService — T7.7 五自进化闭环域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeLoops 挂载 + 构造校验（llmClient / projectRoot 必填）
 * - getLoop 按名查找 / 未知类型抛错
 * - snapshot 五闭环快照（doc/code/framework/review/test + 觉醒阶门控）
 * - runOnce 委托（I1 门控贯通）
 *
 * @module @flowforge/forgekin-loops/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  LoopsService,
  LoopsServiceOptions,
  SelfDevCodeLoop,
  SelfDevDocLoop,
  SelfDevFrameworkLoop,
  SelfDevReviewLoop,
  SelfDevTestLoop,
} from '../src/index.js';
import { AwakeningStageBlockedError } from '../src/errors.js';
import {
  FakeLlmChatClient,
  goodDocContent,
  reviewPassJson,
  writePlanJson,
} from './fake-llm.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-svc-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeOptions() {
  return {
    llmClient: llm,
    forgekinConfig: { projectRoot: root },
    awakeningStage: 'E5',
  };
}

describe('LoopsService 插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeLoops（五个闭环实例化）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, makeOptions());
    expect(ctx.forgeLoops).toBeInstanceOf(LoopsService);
    expect(ctx.forgeLoops.docLoop).toBeInstanceOf(SelfDevDocLoop);
    expect(ctx.forgeLoops.codeLoop).toBeInstanceOf(SelfDevCodeLoop);
    expect(ctx.forgeLoops.frameworkLoop).toBeInstanceOf(SelfDevFrameworkLoop);
    expect(ctx.forgeLoops.reviewLoop).toBeInstanceOf(SelfDevReviewLoop);
    expect(ctx.forgeLoops.testLoop).toBeInstanceOf(SelfDevTestLoop);
  });

  it('缺 llmClient → 构造抛错（红线 12 依赖注入）', async () => {
    const ctx = new Context();
    await expect(ctx.plugin(LoopsService, { forgekinConfig: { projectRoot: root } } as unknown as LoopsServiceOptions))
      .rejects.toThrow(/llmClient/);
  });

  it('缺 projectRoot → 构造抛错（红线 11 路径不硬编码）', async () => {
    const ctx = new Context();
    await expect(ctx.plugin(LoopsService, { llmClient: llm, forgekinConfig: {} } as unknown as LoopsServiceOptions))
      .rejects.toThrow(/projectRoot/);
  });
});

describe('getLoop / snapshot', () => {
  it('getLoop 按名返回实例，未知类型抛错', async () => {
    const ctx = new Context();
    await ctx.plugin(LoopsService, makeOptions());
    expect(ctx.forgeLoops.getLoop('doc')).toBe(ctx.forgeLoops.docLoop);
    expect(ctx.forgeLoops.getLoop('code')).toBe(ctx.forgeLoops.codeLoop);
    expect(ctx.forgeLoops.getLoop('framework')).toBe(ctx.forgeLoops.frameworkLoop);
    expect(ctx.forgeLoops.getLoop('review')).toBe(ctx.forgeLoops.reviewLoop);
    expect(ctx.forgeLoops.getLoop('test')).toBe(ctx.forgeLoops.testLoop);
    expect(() => ctx.forgeLoops.getLoop('nope')).toThrow(/未知闭环类型/);
  });

  it('snapshot 返回五闭环类型与觉醒阶门控', async () => {
    const ctx = new Context();
    await ctx.plugin(LoopsService, makeOptions());
    expect(ctx.forgeLoops.snapshot()).toEqual([
      { loopType: 'doc', minAwakeningStage: 'E3' },
      { loopType: 'code', minAwakeningStage: 'E4' },
      { loopType: 'framework', minAwakeningStage: 'E5' },
      { loopType: 'review', minAwakeningStage: 'E3' },
      { loopType: 'test', minAwakeningStage: 'E3' },
    ]);
  });
});

describe('runOnce 委托', () => {
  it('doc 闭环成功：经 service 委托完成五步循环', async () => {
    const ctx = new Context();
    await ctx.plugin(LoopsService, makeOptions());
    llm.queue.push(writePlanJson('docs/svc.md', goodDocContent));
    llm.queue.push(reviewPassJson);

    const result = await ctx.forgeLoops.runOnce('doc', { force_targets: ['docs/svc.md'] });
    expect(result.summary.passed).toBe(1);
    expect(await fs.readFile(path.join(root, 'docs/svc.md'), 'utf-8')).toContain('# 指南');
  });

  it('I1 门控贯通：E4 下执行 framework 闭环 → AwakeningStageBlockedError', async () => {
    const ctx = new Context();
    await ctx.plugin(LoopsService, {
      llmClient: llm,
      forgekinConfig: { projectRoot: root },
      awakeningStage: 'E4',
    });
    await expect(ctx.forgeLoops.runOnce('framework', { force_targets: ['cfg.yaml'] }))
      .rejects.toThrow(AwakeningStageBlockedError);
  });
});

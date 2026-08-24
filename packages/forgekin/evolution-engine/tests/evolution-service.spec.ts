/**
 * evolution-service — T7.20 进化引擎域 Cordis 插件契约验证。
 *
 * 覆盖：ctx.forgeEvolution 挂载 / 默认组件装配（engine/hub/router/reflector
 * /closeGate）/ createQcLoop / evaluate & execute 委托 / runtime 装配
 * （llmClient + forgekinConfigs）/ foreman 装配（foremanOptions）。
 *
 * @module @flowforge/forgekin-evolution-engine/tests
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, { EvolutionService } from '../src/index.js';
import { FakeLlmChatClient } from './fake-llm.js';
import { makeForemanConfig } from '../src/foreman.js';

let root: string;
let llm: FakeLlmChatClient;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forgekin-evosvc-'));
  llm = new FakeLlmChatClient();
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function forgekinConfigs() {
  return {
    wenxin: { projectRoot: root },
    sherlock: { projectRoot: root },
    luban: { projectRoot: root },
    vangogh: { projectRoot: root },
    davinci: { projectRoot: root },
  };
}

describe('EvolutionService 插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeEvolution + 默认组件装配', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeEvolution).toBeInstanceOf(EvolutionService);
    expect(ctx.forgeEvolution.engine).toBeTruthy();
    expect(ctx.forgeEvolution.approvalHub).toBeTruthy();
    expect(ctx.forgeEvolution.metacognition).toBeTruthy();
    expect(ctx.forgeEvolution.reflector).toBeTruthy();
    expect(ctx.forgeEvolution.closeGate).toBeTruthy();
    expect(ctx.forgeEvolution.runtime).toBeNull();
    expect(ctx.forgeEvolution.foreman).toBeNull();
  });

  it('提供 llmClient + forgekinConfigs → 装配 SelfDevRuntime（5 闭环注册）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { llmClient: llm, forgekinConfigs: forgekinConfigs() });
    expect(ctx.forgeEvolution.runtime).not.toBeNull();
    const loops = ctx.forgeEvolution.runtime!.engine.listSelfDevLoops();
    expect(Object.keys(loops).sort()).toEqual(['doc', 'code', 'framework', 'review', 'test'].sort());
  });

  it('提供 foremanOptions → 装配 ContinuousForeman', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      llmClient: llm,
      forgekinConfigs: forgekinConfigs(),
      foremanOptions: {
        config: makeForemanConfig({ loopIntervalSeconds: 0.5 }),
      },
    });
    expect(ctx.forgeEvolution.foreman).not.toBeNull();
  });
});

describe('EvolutionService 便捷委托', () => {
  it('evaluate 委托 engine.evaluate', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const result = await ctx.forgeEvolution.evaluate({
      metacognition: { successes: 10, trials: 10, evidence_completeness: 0.9, self_reported: 0.9 },
    });
    expect(result.meta.metacognition_route?.route).toBe('proceed');
  });

  it('execute 委托 engine.execute（unknown mode → error）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const result = await ctx.forgeEvolution.execute({ mode: 'bogus', action: 'x' });
    expect(result.status).toBe('error');
  });

  it('createQcLoop 返回 CL-034 7 步循环实例', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const loop = ctx.forgeEvolution.createQcLoop({ maxIterations: 2 });
    const report = await loop.run('t', { a: 1 });
    expect(report.finalStatus).toBe('passed');
    expect(report.stepResults).toHaveLength(7);
  });
});

/**
 * ExternalAgentsService — T7.9 外部 Agent 适配器域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeExternalAgents 挂载
 * - getAdapter / isAvailable / invoke 门面委托
 * - helmAdapter 任务级 Helm 桥（注入 emitter / 全局 emitter / 空发射器兜底）
 * - snapshot 快照（kinds / available / binaries）
 *
 * @module @flowforge/forgekin-external-agents/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, { ExternalAgentsService } from '../src/index.js';
import { ExternalAgentError, ExternalAgentKind } from '../src/external-agent.js';
import { HelmEventEmitter } from '../src/helm-adapter.js';

/** 记录事件的假发射器 */
class FakeEmitter implements HelmEventEmitter {
  readonly calls: string[] = [];

  async emitLlmStart(): Promise<void> {
    this.calls.push('start');
  }

  async emitLlmReasoning(): Promise<void> {
    this.calls.push('reasoning');
  }

  async emitLlmStream(): Promise<void> {
    this.calls.push('stream');
  }

  async emitLlmEnd(): Promise<void> {
    this.calls.push('end');
  }
}

const RESOLVE_ALL: (binary: string) => string | null = (binary) => `/usr/bin/${binary}`;

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeExternalAgents（默认六适配器）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeExternalAgents).toBeInstanceOf(ExternalAgentsService);
    const snap = ctx.forgeExternalAgents.snapshot();
    expect(snap.kinds).toHaveLength(5);
    expect(snap.kinds).toContain('claude_code');
    expect(snap.kinds).not.toContain('custom');
  });
});

describe('门面委托', () => {
  it('getAdapter 返回已注册适配器；未注册 → ExternalAgentError', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { resolveBinary: RESOLVE_ALL });
    expect(ctx.forgeExternalAgents.getAdapter(ExternalAgentKind.CODEX).config.binary).toBe('codex');
    const ctx2 = new Context();
    const empty = new ExternalAgentsService(ctx2, {
      adapters: new Map(),
      resolveBinary: RESOLVE_ALL,
    });
    expect(() => empty.getAdapter(ExternalAgentKind.CUSTOM)).toThrow(ExternalAgentError);
    expect(() => empty.getAdapter(ExternalAgentKind.CUSTOM)).toThrow(/not registered/);
  });

  it('isAvailable 委托适配器探测', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { resolveBinary: RESOLVE_ALL });
    expect(ctx.forgeExternalAgents.isAvailable(ExternalAgentKind.TRAE)).toBe(true);
  });

  it('invoke 委托并透传 prompt / extraArgs / timeout', async () => {
    const calls: { args: string[]; prompt: string }[] = [];
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      resolveBinary: RESOLVE_ALL,
      spawnFn: async (args: string[]) => {
        calls.push({ args, prompt: args[args.length - 1]! });
        return 'ok';
      },
    });
    const out = await ctx.forgeExternalAgents.invoke(ExternalAgentKind.OPENCODE, '生成测试', {
      extraArgs: ['--model', 'gpt-4o'],
      timeout: 30,
    });
    expect(out).toBe('ok');
    expect(calls[0]!.args).toEqual(['opencode', '--model', 'gpt-4o', '--prompt', '生成测试']);
  });
});

describe('Helm 桥', () => {
  it('helmAdapter 使用注入 emitter 且 taskId 正确', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const emitter = new FakeEmitter();
    const bridge = ctx.forgeExternalAgents.helmAdapter('task-9', emitter);
    expect(bridge.taskId).toBe('task-9');
    await bridge.onStart('writer', 'm', null);
    await bridge.onEnd('writer', 'resp', 1);
    expect(emitter.calls).toEqual(['start', 'end']);
  });

  it('helmAdapter 缺省 emitter → 全局 emitter；无全局 → 空发射器不崩溃', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    const emitter = new FakeEmitter();
    ctx.forgeExternalAgents.setHelmEmitter(emitter);
    const bridge = ctx.forgeExternalAgents.helmAdapter('task-9');
    await bridge.onReasoning('writer', '思考');
    expect(emitter.calls).toEqual(['reasoning']);
    ctx.forgeExternalAgents.setHelmEmitter(null);
    const silent = ctx.forgeExternalAgents.helmAdapter('task-9');
    await expect(silent.onStream('writer', 'x')).resolves.toBeUndefined();
  });
});

describe('snapshot 快照', () => {
  it('kinds / binaries / available 摘要', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, { resolveBinary: RESOLVE_ALL });
    const snap = ctx.forgeExternalAgents.snapshot();
    expect(snap.binaries.claude_code).toBe('claude');
    expect(snap.available).toEqual(snap.kinds);
    expect(snap.kinds.sort()).toEqual(['claude_code', 'codex', 'gemini', 'opencode', 'trae']);
  });
});

/**
 * LimbAdaptersService — T6.6 Cordis 插件挂载与 EAC 契约门面验证。
 *
 * 覆盖（对齐 limb-core/limb-terminal 插件测试惯例）：
 * - `ctx.plugin(LimbAdaptersService)` 挂载 ctx.limbAdapters
 * - 默认导出 Plugin 函数等价挂载
 * - get/list/isAvailable/buildSpawnArgs/createParser/parsePlainText/describe 门面
 * - 未注册 kind 抛错；注入自定义 registry
 */

import { Context } from '@flowforge/cordis';
import { describe, expect, it } from 'vitest';
import LimbAdaptersPlugin, { LimbAdaptersService } from '../src/index.js';
import { createLimbCliAdapterRegistry } from '../src/registry.js';
import type { CliAdapter } from '../src/types.js';

describe('LimbAdaptersService Cordis 插件挂载', () => {
  it('ctx.plugin(LimbAdaptersService) 挂载 ctx.limbAdapters', async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(LimbAdaptersService);

    expect(ctx.limbAdapters).toBeInstanceOf(LimbAdaptersService);
    expect(ctx.limbAdapters.list().length).toBe(5);
    await fiber.dispose();
  });

  it('默认导出 Plugin 函数等价挂载', async () => {
    const ctx = new Context();
    await LimbAdaptersPlugin(ctx, {});
    expect(ctx.limbAdapters).toBeInstanceOf(LimbAdaptersService);
  });
});

describe('LimbAdaptersService EAC 契约门面', () => {
  it('get / list / describe', () => {
    const service = new LimbAdaptersService(new Context(), {});
    expect(service.get('codex')?.config.binary).toBe('codex');
    expect(service.list().map((a) => a.config.kind)).toEqual(['claude', 'codex', 'gemini', 'agy', 'opencode']);
    expect(service.describe('gemini')?.defaultTimeoutMs).toBe(120_000);
    expect(service.describe('custom')).toBeUndefined();
  });

  it('isAvailable 基于注入 PATH', () => {
    const service = new LimbAdaptersService(new Context(), {});
    expect(service.isAvailable('claude', '')).toBe(false);
    expect(service.isAvailable('custom', '')).toBe(false);
  });

  it('buildSpawnArgs 带 binary 前缀', () => {
    const service = new LimbAdaptersService(new Context(), {});
    expect(service.buildSpawnArgs('claude', { prompt: 'hi' })).toEqual([
      'claude', '-p', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', 'hi',
    ]);
  });

  it('createParser 按 kind 创建流式解析器', () => {
    const service = new LimbAdaptersService(new Context(), {});
    const parser = service.createParser('codex');
    expect(parser.transform({ type: 'thread.started', thread_id: 'thr' })).toEqual({
      type: 'session_init',
      sessionId: 'thr',
      timestamp: expect.any(Number),
    });
  });

  it('parsePlainText 仅 agy 返回分类结果（其余 undefined）', () => {
    const service = new LimbAdaptersService(new Context(), {});
    expect(service.parsePlainText('agy', 'Error: timed out waiting for response.')).toMatchObject({
      kind: 'error',
      errorKind: 'timeout',
    });
    expect(service.parsePlainText('claude', 'whatever')).toBeUndefined();
    expect(service.parsePlainText('custom', 'whatever')).toBeUndefined();
  });

  it('未注册 kind → buildSpawnArgs / createParser 抛错', () => {
    const service = new LimbAdaptersService(new Context(), {});
    expect(() => service.buildSpawnArgs('custom')).toThrow('CLI adapter not registered: custom');
    expect(() => service.createParser('custom')).toThrow('CLI adapter not registered: custom');
  });

  it('注入自定义 registry（组合根装配）', () => {
    const fake: CliAdapter = {
      config: { kind: 'custom', binary: 'my-cli', description: 'injected', defaultTimeoutMs: 5_000 },
      isAvailable: () => true,
      buildSpawnArgs: () => ['run'],
      createParser: () => ({ transform: () => null }),
    };
    const registry = createLimbCliAdapterRegistry([fake]);
    const service = new LimbAdaptersService(new Context(), { registry });
    expect(service.list()).toEqual([fake]);
    expect(service.buildSpawnArgs('custom')).toEqual(['my-cli', 'run']);
  });
});

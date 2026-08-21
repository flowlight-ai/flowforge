/**
 * SoulService — T7.1 灵魂印记域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeSoul 挂载 + 生命周期
 * - forge/verify/get/listByNamespace + 注册表注入
 *
 * @module @flowforge/forgekin-soul/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  MemorySoulImprintRegistry,
  SoulService,
} from '../src/index.js';

async function createCtx(): Promise<{ ctx: Context; service: SoulService }> {
  const ctx = new Context();
  await ctx.plugin(SoulService);
  return { ctx, service: ctx.forgeSoul };
}

describe('SoulService 插件挂载', () => {
  it('ctx.plugin(SoulService) 挂载 ctx.forgeSoul', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeSoul).toBeInstanceOf(SoulService);
  });

  it('自定义注册表注入 + 默认 Memory 注册表', async () => {
    const registry = new MemorySoulImprintRegistry();
    const ctx = new Context();
    await ctx.plugin(SoulService, { registry });
    expect(ctx.forgeSoul.registry).toBe(registry);
    const { ctx: ctx2 } = await createCtx();
    expect(ctx2.forgeSoul.registry).toBeInstanceOf(MemorySoulImprintRegistry);
  });
});

describe('印记生命周期', () => {
  it('forge → verify → get → listByNamespace 全链路', async () => {
    const { service } = await createCtx();
    const imprint = await service.forge(
      { species: 'coder', stages: ['awakening'] },
      ['anchor-1'],
      'forgemind',
    );
    expect(service.verify(imprint)).toBe(true);
    expect((await service.get(imprint.imprintHash))?.namespace).toBe('forgemind');
    const listed = await service.listByNamespace('forgemind');
    expect(listed.map((i) => i.imprintHash)).toEqual([imprint.imprintHash]);
    expect(await service.listByNamespace('other-ns')).toEqual([]);
  });

  it('命名空间隔离：同参数不同 namespace 各自登记', async () => {
    const { service } = await createCtx();
    const a = await service.forge({ species: 'coder' }, ['x'], 'ns-a');
    const b = await service.forge({ species: 'coder' }, ['x'], 'ns-b');
    expect(a.imprintHash).not.toBe(b.imprintHash);
    expect(await service.listByNamespace('ns-a')).toHaveLength(1);
    expect(await service.listByNamespace('ns-b')).toHaveLength(1);
  });

  it('输入校验：空 namespace / 空锚点拒绝', async () => {
    const { service } = await createCtx();
    await expect(service.forge({}, [], 'ns')).rejects.toThrow();
    await expect(service.forge({}, ['a'], '')).rejects.toThrow();
  });

  it('篡改印记 verify 失败', async () => {
    const { service } = await createCtx();
    const imprint = await service.forge({ species: 'coder' }, ['a'], 'ns');
    expect(service.verify({ ...imprint, seedParams: { species: 'writer' } })).toBe(false);
  });
});

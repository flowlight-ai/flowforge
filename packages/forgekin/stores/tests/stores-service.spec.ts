/**
 * StoresService — T7.22 存储治理域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeStores 挂载（WAL / 集合 / 治理三实例化）
 * - 依赖注入：wal / collections / governance / governanceConfig 可注入
 * - 便捷委托：walAppend / createCollection / computeAuthority 贯通
 *
 * @module @flowforge/forgekin-stores/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, {
  CollectionManager,
  MemoryEntry,
  MemoryGovernance,
  StoresService,
  WalStatus,
  WriteAheadLog,
} from '../src/index.js';

describe('StoresService 插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeStores（WAL/集合/治理实例化）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeStores).toBeInstanceOf(StoresService);
    expect(ctx.forgeStores.wal).toBeInstanceOf(WriteAheadLog);
    expect(ctx.forgeStores.collections).toBeInstanceOf(CollectionManager);
    expect(ctx.forgeStores.governance).toBeInstanceOf(MemoryGovernance);
  });

  it('依赖注入：wal / collections / governance / governanceConfig 可注入', async () => {
    const ctx = new Context();
    const wal = new WriteAheadLog();
    const collections = new CollectionManager();
    const governance = new MemoryGovernance({ verified_sources: ['sherlock'] });
    await ctx.plugin(Plugin, { wal, collections, governance });
    expect(ctx.forgeStores.wal).toBe(wal);
    expect(ctx.forgeStores.collections).toBe(collections);
    expect(ctx.forgeStores.governance).toBe(governance);
  });

  it('governanceConfig 生效（未注入 governance 时用于新建）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      governanceConfig: { authority_base: 0.8, decay_min_score: 0.2 },
    });
    const entry = new MemoryEntry({ content: 'x', source: 'unknown' });
    expect(await ctx.forgeStores.governance.compute_authority(entry)).toBe(0.8);
  });
});

describe('便捷委托', () => {
  it('walAppend 贯通 WAL（append → mark_committed → get）', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);

    const id = await ctx.forgeStores.walAppend('publish', 'wechat:col-1', { id: 100 });
    await ctx.forgeStores.wal.mark_committed(id);
    const entry = await ctx.forgeStores.wal.get(id);
    expect(entry.status).toBe(WalStatus.COMMITTED);
  });

  it('createCollection 贯通集合管理', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);

    const collection = await ctx.forgeStores.createCollection('sop', 'programming');
    const found = await ctx.forgeStores.collections.find_by_domain('programming');
    expect(found.map((c) => c.collection_id)).toContain(collection.collection_id);
  });

  it('computeAuthority 贯通治理', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin, {
      governanceConfig: { verified_sources: ['spiritforge'] },
    });
    const entry = new MemoryEntry({ content: 'x', source: 'spiritforge' });
    expect(await ctx.forgeStores.computeAuthority(entry)).toBeCloseTo(0.7, 6);
  });
});

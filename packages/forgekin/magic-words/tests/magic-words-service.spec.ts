/**
 * MagicWordsService — T7.14 魔法词域 Cordis 插件契约验证。
 *
 * 覆盖：
 * - ctx.forgeMagicWords 挂载
 * - detect / phrases / words / snapshot 门面
 *
 * @module @flowforge/forgekin-magic-words/tests
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@flowforge/cordis';
import Plugin, { MagicWordsService } from '../src/index.js';
import { MagicWordTrigger } from '../src/magic-words.js';

describe('插件挂载', () => {
  it('ctx.plugin(Plugin) 挂载 ctx.forgeMagicWords', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeMagicWords).toBeInstanceOf(MagicWordsService);
  });

  it('detect 委托核心检测', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeMagicWords.detect('用第一性原理分析')?.trigger)
      .toBe(MagicWordTrigger.STOP_AND_AUDIT);
    expect(ctx.forgeMagicWords.detect('普通指令')).toBeNull();
  });

  it('words / phrases / snapshot 门面', async () => {
    const ctx = new Context();
    await ctx.plugin(Plugin);
    expect(ctx.forgeMagicWords.words).toHaveLength(4);
    expect(ctx.forgeMagicWords.phrases()).toContain('星星罐子');
    const snap = ctx.forgeMagicWords.snapshot();
    expect(snap.count).toBe(4);
    expect(snap.phrases).toHaveLength(4);
  });
});

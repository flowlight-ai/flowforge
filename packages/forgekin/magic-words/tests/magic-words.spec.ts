/**
 * detectMagicWord / allPhrases — T7.14 魔法词核心验证。
 *
 * 覆盖：
 * - 四条魔法词各自映射到正确触发动作
 * - 多魔法词指令返回第一个匹配
 * - 无匹配 / 空指令 → null
 * - allPhrases 返回四条短语
 *
 * @module @flowforge/forgekin-magic-words/tests
 */

import { describe, expect, it } from 'vitest';
import {
  allPhrases,
  detectMagicWord,
  MAGIC_WORDS,
  MagicWordTrigger,
} from '../src/magic-words.js';

describe('四条魔法词触发动作', () => {
  it('第一性原理 → stop_and_audit', () => {
    expect(detectMagicWord('请用第一性原理重新审视这个设计')?.trigger)
      .toBe(MagicWordTrigger.STOP_AND_AUDIT);
  });

  it('我能猜出来 → stop_and_read_source', () => {
    expect(detectMagicWord('别我能猜出来，去读源码')?.trigger)
      .toBe(MagicWordTrigger.STOP_AND_READ_SOURCE);
  });

  it('下次一定 → stop_and_signoff', () => {
    expect(detectMagicWord('不要下次一定，现在就做')?.trigger)
      .toBe(MagicWordTrigger.STOP_AND_SIGNOFF);
  });

  it('星星罐子 → stop_all_side_effects', () => {
    expect(detectMagicWord('星星罐子！立刻停止写入')?.trigger)
      .toBe(MagicWordTrigger.STOP_ALL_SIDE_EFFECTS);
  });
});

describe('匹配边界', () => {
  it('多个魔法词 → 返回表中第一个匹配', () => {
    const mw = detectMagicWord('第一性原理 和 星星罐子 都出现了');
    expect(mw?.phrase).toBe('第一性原理');
  });

  it('无魔法词 → null', () => {
    expect(detectMagicWord('继续正常执行任务')).toBeNull();
  });

  it('空指令 → null', () => {
    expect(detectMagicWord('')).toBeNull();
  });
});

describe('allPhrases / MAGIC_WORDS', () => {
  it('allPhrases 返回四条短语', () => {
    expect(allPhrases()).toEqual(['第一性原理', '我能猜出来', '下次一定', '星星罐子']);
  });

  it('MAGIC_WORDS 四条且每条带 description', () => {
    expect(MAGIC_WORDS).toHaveLength(4);
    for (const mw of MAGIC_WORDS) {
      expect(mw.description).toBeTruthy();
      expect(mw.trigger).not.toBe(MagicWordTrigger.NONE);
    }
  });
});

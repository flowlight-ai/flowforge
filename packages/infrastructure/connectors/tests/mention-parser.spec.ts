/**
 * mention-parser 契约测试。
 * 覆盖首文命中、默认 CatId 回退、零宽字符/markdown 噪声清洗、边界符号。
 */

import { describe, expect, it } from 'vitest';

import { parseMentions } from '../src/index.ts';

const DEFAULT = 'cat-default';

function patterns(map: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(map));
}

describe('parseMentions', () => {
  it('命中首个出现的猫（@简称）', () => {
    const text = '帮我看看 @宪宪 的这个文件，再对比 @布偶猫';
    const result = parseMentions(text, patterns({ 'cat-x': ['宪宪'], 'cat-y': ['布偶猫'] }), DEFAULT);
    expect(result.targetCatId).toBe('cat-x');
    expect(result.matched).toBe(true);
  });

  it('未命中任何猫时回退 defaultCatId', () => {
    const text = '普通消息没有提及';
    const result = parseMentions(text, patterns({ 'cat-x': ['宪宪'] }), DEFAULT);
    expect(result.targetCatId).toBe(DEFAULT);
    expect(result.matched).toBe(false);
  });

  it('清洗零宽字符后仍能命中', () => {
    // 在两个字符间插入零宽空格（U+200B）
    const text = '请@宪\u200B宪 协助';
    const result = parseMentions(text, patterns({ 'cat-x': ['宪宪'] }), DEFAULT);
    expect(result.targetCatId).toBe('cat-x');
  });

  it('清洗 markdown 粗体/斜体标记（@ 前后）', () => {
    const boldBefore = '**@宪宪** 请处理';
    const close = parseMentions(boldBefore, patterns({ 'cat-x': ['宪宪'] }), DEFAULT);
    expect(close.targetCatId).toBe('cat-x');

    const mdAfter = '@宪宪* 处理下';
    expect(parseMentions(mdAfter, patterns({ 'cat-x': ['宪宪'] }), DEFAULT).targetCatId).toBe('cat-x');
  });

  it('@ 后须在合法边界（空白/标点/结尾）才命中', () => {
    // '宪宪子' 不是 '宪宪' 的合法命中（后跟词字符）
    const result = parseMentions('@宪宪子 帮忙', patterns({ 'cat-x': ['宪宪'] }), DEFAULT);
    expect(result.matched).toBe(false);
  });
});
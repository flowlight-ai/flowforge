/**
 * similarity — 领域推断 / 签名 / 关键词重叠相似度验证。
 *
 * 覆盖：episodeDomain / computeSignature 确定性 / 跨领域 0.0 /
 * 0.7-0.3 加权 / keywordOverlap Jaccard。
 *
 * @module @flowforge/forgekin-auto-dream/tests
 */

import { describe, expect, it } from 'vitest';
import { EpisodeCard } from '../src/models.js';
import { SimilarityCalculator, episodeDomain } from '../src/similarity.js';

function makeEpisode(overrides: Partial<ConstructorParameters<typeof EpisodeCard>[0]> = {}): EpisodeCard {
  return new EpisodeCard({
    task_snapshot: '修复构建失败',
    transferable_method: 'run tests fix errors',
    non_transferable_facts: 'uses pnpm',
    safety_boundary: 'none',
    ...overrides,
  });
}

describe('episodeDomain 领域推断', () => {
  it('中文/英文医学关键词 → medical', () => {
    expect(episodeDomain(makeEpisode({ task_snapshot: '医学影像诊断辅助' }))).toBe('medical');
    expect(episodeDomain(makeEpisode({ task_snapshot: 'medical record parsing' }))).toBe('medical');
  });

  it('中文/英文法律关键词 → legal', () => {
    expect(episodeDomain(makeEpisode({ task_snapshot: '合同法律审查' }))).toBe('legal');
    expect(episodeDomain(makeEpisode({ task_snapshot: 'legal compliance check' }))).toBe('legal');
  });

  it('其他 → development', () => {
    expect(episodeDomain(makeEpisode())).toBe('development');
  });
});

describe('computeSignature 幂等签名', () => {
  it('相同内容产生相同 16 位签名，内容不同则不同', () => {
    const a = makeEpisode();
    const b = makeEpisode();
    const sigA = SimilarityCalculator.computeSignature(a);
    expect(sigA).toMatch(/^[0-9a-f]{16}$/);
    expect(SimilarityCalculator.computeSignature(b)).toBe(sigA);
    const c = makeEpisode({ transferable_method: 'completely different method' });
    expect(SimilarityCalculator.computeSignature(c)).not.toBe(sigA);
  });

  it('实例方法与静态方法结果一致', () => {
    const calc = new SimilarityCalculator();
    const ep = makeEpisode();
    expect(calc.computeSignature(ep)).toBe(SimilarityCalculator.computeSignature(ep));
  });
});

describe('similarity 相似度', () => {
  it('跨领域直接 0.0', () => {
    const dev = makeEpisode();
    const med = makeEpisode({ task_snapshot: '医学病例分析' });
    expect(SimilarityCalculator.similarity(dev, med)).toBe(0.0);
  });

  it('相同内容 → 1.0（方法 0.7 + 事实 0.3）', () => {
    const a = makeEpisode();
    const b = makeEpisode();
    expect(SimilarityCalculator.similarity(a, b)).toBeCloseTo(1.0, 10);
  });

  it('部分重叠按 0.7 方法 + 0.3 事实加权', () => {
    const a = makeEpisode({
      transferable_method: 'alpha beta',
      non_transferable_facts: 'one two',
    });
    const b = makeEpisode({
      transferable_method: 'alpha beta',
      non_transferable_facts: 'three four',
    });
    // 方法重叠 1.0，事实重叠 0.0 → 0.7
    expect(SimilarityCalculator.similarity(a, b)).toBeCloseTo(0.7, 10);
  });

  it('空方法文本 → 0.0', () => {
    const a = makeEpisode({ transferable_method: '', non_transferable_facts: '' });
    const b = makeEpisode();
    expect(SimilarityCalculator.similarity(a, b)).toBe(0.0);
  });
});

describe('keywordOverlap Jaccard', () => {
  it('完全相同 → 1.0；完全不相交 → 0.0', () => {
    expect(SimilarityCalculator.keywordOverlap('a b c', 'c b a')).toBe(1.0);
    expect(SimilarityCalculator.keywordOverlap('a b', 'c d')).toBe(0.0);
  });

  it('部分重叠按交集/并集计算', () => {
    // {a, b} ∩ {b, c} = {b}，并集 {a, b, c} → 1/3
    expect(SimilarityCalculator.keywordOverlap('a b', 'b c')).toBeCloseTo(1 / 3, 10);
  });

  it('空字符串或纯空白 → 0.0', () => {
    expect(SimilarityCalculator.keywordOverlap('', 'a b')).toBe(0.0);
    expect(SimilarityCalculator.keywordOverlap('   ', 'a b')).toBe(0.0);
  });
});

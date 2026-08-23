/**
 * judge — RuleBasedJudge 评审规则契约验证（对齐 Python _score）。
 *
 * 覆盖：完全匹配 1.0 / 重叠 ≥80% 0.8 / ≥50% 0.5 / 否则 0.0 / 空输出。
 *
 * @module @flowforge/forgekin-eval-ledger/tests
 */

import { describe, expect, it } from 'vitest';
import { RuleBasedJudge } from '../src/judge.js';
import { TestCase } from '../src/models.js';

const testCase = new TestCase({
  case_id: 'c1',
  case_type: 'standard_success',
  input: 'q',
  expected: 'alpha beta gamma delta epsilon',
});

describe('RuleBasedJudge.score', () => {
  it('完全匹配 = 1.0', () => {
    expect(RuleBasedJudge.score(testCase.expected, 'alpha beta gamma delta epsilon')).toBe(1.0);
    expect(RuleBasedJudge.score('  x y ', 'x y')).toBe(1.0);
  });

  it('重叠 ≥80% = 0.8', () => {
    // 5 词中命中 4 词 = 0.8
    expect(RuleBasedJudge.score(testCase.expected, 'alpha beta gamma delta zeta')).toBe(0.8);
  });

  it('重叠 ≥50% = 0.5', () => {
    // 5 词中命中 3 词 = 0.6 → 0.5 档
    expect(RuleBasedJudge.score(testCase.expected, 'alpha beta gamma one two')).toBe(0.5);
  });

  it('完全不匹配 / 空输出 = 0.0', () => {
    expect(RuleBasedJudge.score(testCase.expected, 'one two')).toBe(0.0);
    expect(RuleBasedJudge.score(testCase.expected, '')).toBe(0.0);
    expect(RuleBasedJudge.score('', 'anything')).toBe(0.0);
  });
});

describe('RuleBasedJudge.judge', () => {
  it('返回 [score_a, score_b, notes]', async () => {
    const judge = new RuleBasedJudge();
    const [scoreA, scoreB, notes] = await judge.judge(testCase, 'one two', testCase.expected);
    expect(scoreA).toBe(0.0);
    expect(scoreB).toBe(1.0);
    expect(notes).toContain('rule-based');
    expect(notes).toContain('score_a=0.00');
    expect(notes).toContain('score_b=1.00');
  });
});

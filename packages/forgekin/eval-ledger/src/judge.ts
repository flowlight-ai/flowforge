/**
 * judge — 单 case 评审协议（对齐 Python CaseJudgeProtocol / RuleBasedJudge）。
 *
 * 生产环境应注入 LLM 评审器（复用任务级 Eval 三方信号交叉），
 * RuleBasedJudge 为无 LLM 依赖的默认评审器。
 *
 * @module @flowforge/forgekin-eval-ledger
 */

import type { TestCase } from './models.js';

/** 单 case 评审协议（可注入 LLM 评审器或规则评审器）。 */
export interface CaseJudge {
  /**
   * 评审 A/B 输出，返回 [score_a, score_b, notes]。
   *
   * @param testCase 测试用例（含 input / expected）
   * @param actualA A 组实际输出（前测）
   * @param actualB B 组实际输出（后测）
   */
  judge(testCase: TestCase, actualA: string, actualB: string): Promise<readonly [number, number, string]>;
}

/**
 * 基于规则的默认评审器（无 LLM 依赖，用于骨架实现）。
 *
 * 评审规则：
 * - 与 expected 完全匹配 = 1.0
 * - 关键词重叠 ≥ 80% = 0.8
 * - 关键词重叠 ≥ 50% = 0.5
 * - 完全不匹配 = 0.0
 */
export class RuleBasedJudge implements CaseJudge {
  async judge(testCase: TestCase, actualA: string, actualB: string): Promise<readonly [number, number, string]> {
    const scoreA = RuleBasedJudge.score(testCase.expected, actualA);
    const scoreB = RuleBasedJudge.score(testCase.expected, actualB);
    const notes = `rule-based: score_a=${scoreA.toFixed(2)}, score_b=${scoreB.toFixed(2)}`;
    return [scoreA, scoreB, notes];
  }

  static score(expected: string, actual: string): number {
    if (!actual) {
      return 0.0;
    }
    if (actual.trim() === expected.trim()) {
      return 1.0;
    }
    const expectedWords = new Set(expected.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
    const actualWords = new Set(actual.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
    if (expectedWords.size === 0) {
      return 0.0;
    }
    let overlapCount = 0;
    for (const word of expectedWords) {
      if (actualWords.has(word)) {
        overlapCount += 1;
      }
    }
    const overlap = overlapCount / expectedWords.size;
    if (overlap >= 0.8) {
      return 0.8;
    }
    if (overlap >= 0.5) {
      return 0.5;
    }
    return 0.0;
  }
}

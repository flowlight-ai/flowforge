/**
 * runner — ReplayABRunner 七步流程执行器（对齐 Python，CL-004）。
 *
 * 执行 7 步流程（design.md v7.1-§D7.6.3）：
 * Step 1: 选取测试用例集（3 smoke + 5 promotion）
 * Step 2: 前测（A 组）— 使用当前方法库（锻典）条目
 * Step 3: 后测（B 组）— 使用提案修改后的方法库条目
 * Step 4: 计算净增益 = post_score - pre_score
 * Step 5: 烟雾门校验（3 cases, ≥2/3 pass）
 * Step 6: 晋升门校验（5 cases, ≥3/5 pass, 覆盖 3 类）
 * Step 7: 决策（净增益 > min_net_gain AND 双门通过 → 允许合入）
 *
 * @module @flowforge/forgekin-eval-ledger
 */

import {
  CaseResult,
  EvalLedger,
  PROMOTION_CASE_COUNT,
  PROMOTION_PASS_THRESHOLD,
  REQUIRED_CASE_TYPES,
  SMOKE_CASE_COUNT,
  SMOKE_PASS_THRESHOLD,
  TestCase,
  genEvalId,
  type JudgeRubric,
} from './models.js';
import type { CaseJudge } from './judge.js';
import type { EvalLedgerStore } from './store.js';

/** A/B 组执行器签名：async (case) => 输出文本 */
export type CaseRunner = (testCase: TestCase) => Promise<string>;

export interface ReplayABRunnerOptions {
  readonly judge?: CaseJudge | undefined;
  readonly minNetGain?: number | undefined;
}

export interface RunReplayAbOptions extends ReplayABRunnerOptions {
  readonly runnerA?: CaseRunner | undefined;
  readonly runnerB?: CaseRunner | undefined;
}

/** Replay A/B 流程执行器（CL-004）。 */
export class ReplayABRunner {
  readonly store: EvalLedgerStore;
  readonly judge: CaseJudge;
  readonly minNetGain: number;

  constructor(store: EvalLedgerStore, options: ReplayABRunnerOptions = {}) {
    this.store = store;
    this.judge = options.judge ?? store.judge;
    this.minNetGain = options.minNetGain ?? store.minNetGain;
  }

  /**
   * 执行 Replay A/B 7 步流程，返回 EvalLedger。
   *
   * @param methodId 被评估的方法库（锻典）条目 ID
   * @param proposalId 关联的进化提案 ID
   * @param testCases 测试用例集（≥8：3 smoke + 5 promotion）
   * @param options.runnerA A 组执行器（前测，使用当前方法库条目）
   * @param options.runnerB B 组执行器（后测，使用提案修改后的方法库条目）
   */
  async runReplayAb(
    methodId: string,
    proposalId: string,
    testCases: readonly TestCase[],
    options: RunReplayAbOptions = {},
  ): Promise<EvalLedger> {
    // Step 1: 校验测试用例集
    this.validateTestCases(testCases);

    const evalId = genEvalId(methodId, proposalId);

    // Step 2 + Step 3: 前测 + 后测（顺序执行每个 case）
    const caseResults: CaseResult[] = [];
    for (const testCase of testCases) {
      const actualA = options.runnerA ? await options.runnerA(testCase) : '';
      const actualB = options.runnerB ? await options.runnerB(testCase) : '';
      const [scoreA, scoreB, notes] = await this.judge.judge(testCase, actualA, actualB);
      caseResults.push(
        new CaseResult({
          case_id: testCase.case_id,
          actual_a: actualA,
          actual_b: actualB,
          score_a: scoreA,
          score_b: scoreB,
          passed: scoreB > scoreA,
          judge_notes: notes,
        }),
      );
    }

    // Step 4: 计算净增益
    const preScore = ReplayABRunner.avgScore(caseResults, 'score_a');
    const postScore = ReplayABRunner.avgScore(caseResults, 'score_b');
    const netGain = postScore - preScore;

    // 计算 judge_rubric 四维净增益（骨架：用整体分数填充）
    const judgeRubric = ReplayABRunner.computeJudgeRubric(caseResults);

    // Step 5: 烟雾门校验
    const smokeResults = caseResults.filter((_, i) => testCases[i]?.is_smoke);
    const smokePassedCount = smokeResults.filter((cr) => cr.passed).length;
    const smokeGatePassed = smokePassedCount >= SMOKE_PASS_THRESHOLD;

    // Step 6: 晋升门校验
    const promotionCases = testCases.filter((tc) => !tc.is_smoke);
    const promotionResults = caseResults.filter((_, i) => !testCases[i]?.is_smoke);
    const promotionPassedCount = promotionResults.filter((cr) => cr.passed).length;
    const typeCoverageOk = ReplayABRunner.checkCaseTypeCoverage(promotionCases);
    const promotionGatePassed = promotionPassedCount >= PROMOTION_PASS_THRESHOLD && typeCoverageOk;

    // Step 7: 决策
    const merged = netGain > this.minNetGain && smokeGatePassed && promotionGatePassed;
    const rejectReason = this.computeRejectReason(netGain, smokeGatePassed, promotionGatePassed, merged);

    // 构造 cases 字段
    const casesDict = caseResults.map((cr, i) => ReplayABRunner.caseResultToDict(cr, testCases[i] as TestCase));

    const ledger = new EvalLedger({
      eval_id: evalId,
      method_id: methodId,
      proposal_id: proposalId,
      pre_score: preScore,
      post_score: postScore,
      net_gain: netGain,
      cases: casesDict,
      judge_rubric: judgeRubric,
      smoke_gate_passed: smokeGatePassed,
      promotion_gate_passed: promotionGatePassed,
      merged,
      reject_reason: rejectReason,
    });

    this.store.save(ledger);
    return ledger;
  }

  /** 校验测试用例集（Step 1）。 */
  validateTestCases(testCases: readonly TestCase[]): void {
    const totalRequired = SMOKE_CASE_COUNT + PROMOTION_CASE_COUNT;
    if (testCases.length < totalRequired) {
      throw new Error(
        `测试用例数不足：需要 ≥${totalRequired} 个` +
          `（${SMOKE_CASE_COUNT} smoke + ${PROMOTION_CASE_COUNT} promotion），实际 ${testCases.length} 个`,
      );
    }
    const smokeCount = testCases.filter((tc) => tc.is_smoke).length;
    const promotionCount = testCases.filter((tc) => !tc.is_smoke).length;
    if (smokeCount < SMOKE_CASE_COUNT) {
      throw new Error(`smoke case 数不足：需要 ≥${SMOKE_CASE_COUNT}，实际 ${smokeCount}`);
    }
    if (promotionCount < PROMOTION_CASE_COUNT) {
      throw new Error(`promotion case 数不足：需要 ≥${PROMOTION_CASE_COUNT}，实际 ${promotionCount}`);
    }
  }

  /** 校验 promotion cases 是否覆盖 3 类（Step 6 子检查）。 */
  static checkCaseTypeCoverage(promotionCases: readonly TestCase[]): boolean {
    const coveredTypes = new Set(promotionCases.map((tc) => tc.case_type));
    return REQUIRED_CASE_TYPES.every((t) => coveredTypes.has(t));
  }

  /** 计算平均分。 */
  static avgScore(results: readonly CaseResult[], scoreField: 'score_a' | 'score_b'): number {
    if (results.length === 0) {
      return 0.0;
    }
    const total = results.reduce((acc, cr) => acc + cr[scoreField], 0);
    return total / results.length;
  }

  /**
   * 计算 judge_rubric 四维（骨架：用整体分数填充）。
   * 实际生产应由 LLM 评审器分别打分。
   */
  static computeJudgeRubric(caseResults: readonly CaseResult[]): JudgeRubric {
    if (caseResults.length === 0) {
      return {
        boundary_compliance: 0.0,
        evidence_handling: 0.0,
        knowledge_application: 0.0,
        human_edit_volume: 0.0,
      };
    }
    const avgB = caseResults.reduce((acc, cr) => acc + cr.score_b, 0) / caseResults.length;
    return {
      boundary_compliance: avgB,
      evidence_handling: avgB,
      knowledge_application: avgB,
      human_edit_volume: Math.max(0.0, 1.0 - avgB), // 反向评分
    };
  }

  /** 计算拒绝原因（Step 7）。 */
  private computeRejectReason(netGain: number, smokePassed: boolean, promotionPassed: boolean, merged: boolean): string {
    if (merged) {
      return '';
    }
    const reasons: string[] = [];
    if (netGain <= this.minNetGain) {
      reasons.push(`net_gain=${netGain.toFixed(4)} ≤ min_net_gain=${this.minNetGain.toFixed(4)}`);
    }
    if (!smokePassed) {
      reasons.push('smoke_gate 未通过');
    }
    if (!promotionPassed) {
      reasons.push('promotion_gate 未通过');
    }
    return reasons.length > 0 ? reasons.join('; ') : 'unknown';
  }

  /** CaseResult + TestCase 转 dict（存入 EvalLedger.cases）。 */
  static caseResultToDict(cr: CaseResult, tc: TestCase): Record<string, unknown> {
    return {
      case_id: cr.case_id,
      case_type: tc.case_type,
      is_smoke: tc.is_smoke,
      input: tc.input,
      expected: tc.expected,
      actual_a: cr.actual_a,
      actual_b: cr.actual_b,
      score_a: cr.score_a,
      score_b: cr.score_b,
      passed: cr.passed,
      judge_notes: cr.judge_notes,
    };
  }
}

/**
 * 顶层 API：执行 Replay A/B 7 步流程（CL-004）。
 * store 不提供则创建临时 store；judge 不提供则使用 RuleBasedJudge。
 */
export async function runReplayAb(
  methodId: string,
  proposalId: string,
  testCases: readonly TestCase[],
  store: EvalLedgerStore,
  options: RunReplayAbOptions = {},
): Promise<EvalLedger> {
  const runner = new ReplayABRunner(store, options);
  return runner.runReplayAb(methodId, proposalId, testCases, options);
}

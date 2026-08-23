/**
 * models — Eval Ledger 数据模型（CL-004 进化级 Eval）。
 *
 * 对齐 Python `evolution/eval_ledger.py` + `evolution/models.py EvalLedger`：
 * 常量（净增益阈值 / 双门参数）+ TestCase/CaseResult + EvalLedger 记录。
 *
 * 与任务级 Eval 区分：
 * - 任务级 Eval：评估单次任务执行质量（quality_score ≥ 0.85）
 * - 进化级 Eval：评估进化提案的净增益（net_gain > min_net_gain + 双门通过）
 *
 * @module @flowforge/forgekin-eval-ledger
 */

import { randomBytes } from 'node:crypto';

// ========== 常量（design.md v7.1-§D7.3/D7.6）==========

/** 默认净增益阈值（design.md v7.1-§D7.3 安全门设计） */
export const DEFAULT_MIN_NET_GAIN = 0.05;
export const SMOKE_CASE_COUNT = 3;
export const SMOKE_PASS_THRESHOLD = 2; // ≥2/3 pass
export const PROMOTION_CASE_COUNT = 5;
export const PROMOTION_PASS_THRESHOLD = 3; // ≥3/5 pass

/** promotion cases 必须覆盖的三类 */
export type CaseType =
  | 'standard_success'
  | 'boundary_should_escalate'
  | 'conflict_counter_example';

export const REQUIRED_CASE_TYPES: readonly CaseType[] = [
  'standard_success',
  'boundary_should_escalate',
  'conflict_counter_example',
];

// ========== 数据模型 ==========

export interface TestCaseInit {
  readonly case_id: string;
  readonly case_type: CaseType;
  readonly input: string;
  readonly expected: string;
  /** True = smoke case, False = promotion case */
  readonly is_smoke?: boolean;
}

/**
 * 测试用例（A/B 配对）。每个 case 在 A 组（前测）和 B 组（后测）中
 * 跑相同输入，比较输出分数。
 */
export class TestCase {
  readonly case_id: string;
  readonly case_type: CaseType;
  readonly input: string;
  readonly expected: string;
  readonly is_smoke: boolean;

  constructor(init: TestCaseInit) {
    this.case_id = init.case_id;
    this.case_type = init.case_type;
    this.input = init.input;
    this.expected = init.expected;
    this.is_smoke = init.is_smoke ?? false;
  }
}

export interface CaseResultInit {
  readonly case_id: string;
  readonly actual_a?: string;
  readonly actual_b?: string;
  readonly score_a?: number;
  readonly score_b?: number;
  readonly passed?: boolean;
  readonly judge_notes?: string;
}

/** 单个 case 的 A/B 测试结果。 */
export class CaseResult {
  readonly case_id: string;
  /** A 组实际输出（前测） */
  readonly actual_a: string;
  /** B 组实际输出（后测） */
  readonly actual_b: string;
  /** 0.0~1.0 */
  readonly score_a: number;
  /** 0.0~1.0 */
  readonly score_b: number;
  /** B 组是否优于 A 组 */
  readonly passed: boolean;
  readonly judge_notes: string;

  constructor(init: CaseResultInit) {
    this.case_id = init.case_id;
    this.actual_a = init.actual_a ?? '';
    this.actual_b = init.actual_b ?? '';
    this.score_a = init.score_a ?? 0.0;
    this.score_b = init.score_b ?? 0.0;
    this.passed = init.passed ?? false;
    this.judge_notes = init.judge_notes ?? '';
  }
}

// ========== EvalLedger 记录（evolution/models.py）==========

export interface JudgeRubric {
  boundary_compliance: number;
  evidence_handling: number;
  knowledge_application: number;
  human_edit_volume: number;
}

export interface EvalLedgerInit {
  readonly eval_id: string;
  /** 关联 MethodCard.method_id（被评估的方法库/锻典条目） */
  readonly method_id: string;
  /** 关联 EvolutionProposal.proposal_id */
  readonly proposal_id?: string;
  /** 前测分数（A 组）0.0~1.0 */
  readonly pre_score?: number;
  /** 后测分数（B 组）0.0~1.0 */
  readonly post_score?: number;
  /** 净增益 = post_score - pre_score，必须 > min_net_gain 才允许合入 */
  readonly net_gain?: number;
  /** A/B paired cases（≥8：3 smoke + 5 promotion） */
  readonly cases?: readonly Record<string, unknown>[];
  readonly judge_rubric?: JudgeRubric;
  readonly smoke_gate_passed?: boolean;
  readonly promotion_gate_passed?: boolean;
  /** net_gain > min_net_gain AND 双门通过 */
  readonly merged?: boolean;
  /** 拒绝原因（merged=false 时填充） */
  readonly reject_reason?: string;
  readonly created_at?: string;
}

/**
 * Eval Ledger — Replay A/B 验证知识净增益（进化级 Eval，CL-004）。
 *
 * judge_rubric 四维：boundary_compliance / evidence_handling /
 * knowledge_application / human_edit_volume。
 * Smoke gate: 3 cases, ≥2/3 pass；
 * Promotion gate: 5 cases, ≥3/5 pass, 覆盖 3 类。
 */
export class EvalLedger {
  readonly eval_id: string;
  readonly method_id: string;
  readonly proposal_id: string;
  readonly pre_score: number;
  readonly post_score: number;
  readonly net_gain: number;
  readonly cases: Record<string, unknown>[];
  readonly judge_rubric: JudgeRubric;
  readonly smoke_gate_passed: boolean;
  readonly promotion_gate_passed: boolean;
  readonly merged: boolean;
  readonly reject_reason: string;
  readonly created_at: string;

  constructor(init: EvalLedgerInit) {
    this.eval_id = init.eval_id;
    this.method_id = init.method_id;
    this.proposal_id = init.proposal_id ?? '';
    this.pre_score = init.pre_score ?? 0.0;
    this.post_score = init.post_score ?? 0.0;
    this.net_gain = init.net_gain ?? 0.0;
    this.cases = [...(init.cases ?? [])];
    this.judge_rubric = init.judge_rubric ?? {
      boundary_compliance: 0.0,
      evidence_handling: 0.0,
      knowledge_application: 0.0,
      human_edit_volume: 0.0,
    };
    this.smoke_gate_passed = init.smoke_gate_passed ?? false;
    this.promotion_gate_passed = init.promotion_gate_passed ?? false;
    this.merged = init.merged ?? false;
    this.reject_reason = init.reject_reason ?? '';
    this.created_at = init.created_at ?? new Date().toISOString();
  }
}

/** 生成 eval_id：eval-{method_id}-{proposal_id}-{timestamp}-{random6}。 */
export function genEvalId(methodId: string, proposalId: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = randomBytes(3).toString('hex');
  // 截断 method_id / proposal_id 防止过长
  const m = methodId ? methodId.slice(0, 24) : 'unknown';
  const p = proposalId ? proposalId.slice(0, 24) : 'unknown';
  return `eval-${m}-${p}-${ts}-${rand}`;
}

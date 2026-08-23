/**
 * contract — Eval Contract 五问（对齐 Python core/eval/contract.py）。
 *
 * 每块 harness 组件必须回答 Eval Contract 五问（roleagent.md §5.2）：
 * 1. 谁评估（agent 自己 / 跨 agent / operator / 自动探针）
 * 2. 评估什么（功能正确性 / 性能 / 协作贡献 / 愿景对齐）
 * 3. 何时评估（每次调用 / 每个任务 / 每天 / 每周）
 * 4. 评估信号（trace / 用户反馈 / 自动探针 / 三方信号交叉）
 * 5. 评估后做什么（通过 / 返工 / sunset / 升级 operator）
 *
 * Contract 是 harness 组件接入 Eval 自代谢系统的入口契约。
 *
 * @module @flowforge/forgekin-eval-ledger
 */

// ========== 枚举：五问的推荐取值（非强制约束，允许自由文本）==========

/** 谁评估——evaluator 身份类别（第一问） */
export enum EvaluatorType {
  SELF = 'self',
  CROSS_AGENT = 'cross_agent',
  OPERATOR = 'operator',
  AUTO_PROBE = 'auto_probe',
}

/** 评估什么——评估维度类别（第二问） */
export enum EvaluationTarget {
  FUNCTIONAL_CORRECTNESS = 'functional_correctness',
  PERFORMANCE = 'performance',
  COLLABORATION_CONTRIBUTION = 'collaboration_contribution',
  VISION_ALIGNMENT = 'vision_alignment',
}

/** 何时评估——评估频率类别（第三问） */
export enum EvaluationTiming {
  PER_CALL = 'per_call',
  PER_TASK = 'per_task',
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

/** 评估后做什么——评估后动作类别（第五问） */
export enum PostEvaluationAction {
  PASS = 'pass',
  REWORK = 'rework',
  /** 退役（Build to Delete sunset 信号） */
  SUNSET = 'sunset',
  ESCALATE_OPERATOR = 'escalate_operator',
}

/**
 * Eval 域成熟度——诚实标注，禁止虚报。
 * - experimental: 信号采集不稳定，归因规则未验证
 * - stable: 信号采集可靠，归因规则经过验证
 * - mature: 三方信号交叉稳定，归因规则经过长期验证
 */
export enum EvalMaturity {
  EXPERIMENTAL = 'experimental',
  STABLE = 'stable',
  MATURE = 'mature',
}

// ========== 五问数据模型 ==========

export interface FiveQuestionsInit {
  /** 谁评估（推荐 EvaluatorType 取值） */
  readonly who_evaluates: string;
  /** 评估什么（推荐 EvaluationTarget 取值） */
  readonly what_to_evaluate: string;
  /** 何时评估（推荐 EvaluationTiming 取值） */
  readonly when_to_evaluate: string;
  /** 评估信号来源列表（trace / human / auto / three_signal_cross） */
  readonly evaluation_signals?: readonly string[];
  /** 评估后做什么（推荐 PostEvaluationAction 取值） */
  readonly post_evaluation_action: string;
}

/** Eval Contract 五问——每块 harness 组件必须回答的五个问题。 */
export class FiveQuestions {
  readonly who_evaluates: string;
  readonly what_to_evaluate: string;
  readonly when_to_evaluate: string;
  readonly evaluation_signals: string[];
  readonly post_evaluation_action: string;

  constructor(init: FiveQuestionsInit) {
    this.who_evaluates = init.who_evaluates;
    this.what_to_evaluate = init.what_to_evaluate;
    this.when_to_evaluate = init.when_to_evaluate;
    this.evaluation_signals = [...(init.evaluation_signals ?? [])];
    this.post_evaluation_action = init.post_evaluation_action;
  }
}

// ========== Eval Contract 主模型 ==========

export interface EvalContractInit {
  readonly contract_id: string;
  /** 被评估的 harness 组件引用（如 "teamact.loop" / "harness.durable_state"） */
  readonly component_ref: string;
  readonly five_questions: FiveQuestions | FiveQuestionsInit;
  readonly maturity?: EvalMaturity;
  readonly created_at?: string;
  readonly updated_at?: string;
}

/** Eval Contract——harness 组件接入 Eval 自代谢系统的契约（F018）。 */
export class EvalContract {
  readonly contract_id: string;
  readonly component_ref: string;
  readonly five_questions: FiveQuestions;
  /** 该 eval 契约的成熟度（诚实标注） */
  readonly maturity: EvalMaturity;
  readonly created_at: string;
  readonly updated_at: string;

  constructor(init: EvalContractInit) {
    this.contract_id = init.contract_id;
    this.component_ref = init.component_ref;
    this.five_questions = init.five_questions instanceof FiveQuestions ? init.five_questions : new FiveQuestions(init.five_questions);
    this.maturity = init.maturity ?? EvalMaturity.EXPERIMENTAL;
    const now = new Date().toISOString();
    this.created_at = init.created_at ?? now;
    this.updated_at = init.updated_at ?? now;
  }

  /** 生成人类可读摘要（用于 trace 日志 / operator 展示）。 */
  toSummary(): string {
    const fq = this.five_questions;
    const signals = fq.evaluation_signals.length > 0 ? fq.evaluation_signals.join('/') : '(none)';
    return (
      `EvalContract[${this.contract_id}] ` +
      `component=${this.component_ref} ` +
      `maturity=${this.maturity} ` +
      `who=${fq.who_evaluates} ` +
      `what=${fq.what_to_evaluate} ` +
      `when=${fq.when_to_evaluate} ` +
      `signals=[${signals}] ` +
      `action=${fq.post_evaluation_action}`
    );
  }
}

// ========== ContractRegistry —— 契约注册表 ==========

/**
 * Eval Contract 注册表——按 component_ref 索引（一个组件一个 contract）。
 * 契约存储在内存 Map（控制面骨架；铁律 4 不直接操作数据库）。
 */
export class ContractRegistry {
  private readonly contracts = new Map<string, EvalContract>();

  /**
   * 注册一个 Eval Contract。
   * 若 component_ref 已存在，覆盖旧契约（harness 组件升级时契约随之更新）。
   */
  async register(contract: EvalContract): Promise<void> {
    this.contracts.set(contract.component_ref, contract);
  }

  /** 按 component_ref 查询契约，不存在返回 undefined。 */
  async get(componentRef: string): Promise<EvalContract | undefined> {
    return this.contracts.get(componentRef);
  }

  /** 列出所有已注册契约的 component_ref。 */
  async listComponents(): Promise<string[]> {
    return [...this.contracts.keys()];
  }

  /** 返回所有已注册契约。 */
  async allContracts(): Promise<EvalContract[]> {
    return [...this.contracts.values()];
  }
}

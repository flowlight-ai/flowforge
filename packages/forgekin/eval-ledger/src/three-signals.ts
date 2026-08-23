/**
 * three-signals — 三方信号交叉验证（对齐 Python core/eval/three_signals.py）。
 *
 * 只看 trace 不够，必须三方信号交叉（roleagent.md §5.3）：
 * - trace 信号：执行轨迹（agent 做了什么）
 * - 用户信号：用户反馈 / 摩擦信号（用户感受到了什么）
 * - 探针信号：自动探针（客观指标，如 benchmark）
 *
 * 三方一致 → 高置信度共识；两方一致 → 多数共识记录分歧；
 * 三方分歧 → 无共识，升级 operator。
 *
 * @module @flowforge/forgekin-eval-ledger
 */

import { randomBytes } from 'node:crypto';

/** 三方信号类型（roleagent.md §5.3） */
export enum SignalType {
  /** 执行轨迹信号（agent 做了什么） */
  TRACE = 'trace',
  /** 用户反馈信号（用户感受到了什么，含摩擦信号） */
  HUMAN = 'human',
  /** 自动探针信号（客观指标，如 benchmark / 定期探针） */
  AUTO = 'auto',
}

export interface SignalInit {
  readonly signal_id?: string;
  readonly signal_type: SignalType;
  readonly source: string;
  /** 信号内容（推荐 dict 含 verdict/score 字段） */
  readonly content?: unknown;
  readonly timestamp?: string;
  /** 信号置信度（0.0-1.0） */
  readonly confidence?: number;
  /** 关联的 harness 组件引用 */
  readonly component_ref?: string | undefined;
}

/** 三方信号——单条信号数据模型。 */
export class Signal {
  readonly signal_id: string;
  readonly signal_type: SignalType;
  readonly source: string;
  readonly content: unknown;
  readonly timestamp: string;
  readonly confidence: number;
  readonly component_ref: string | undefined;

  constructor(init: SignalInit) {
    if (init.confidence !== undefined && (init.confidence < 0 || init.confidence > 1)) {
      throw new Error(`信号置信度必须在 0.0-1.0 之间，实际 ${init.confidence}`);
    }
    this.signal_id = init.signal_id ?? `sig-${randomBytes(6).toString('hex')}`;
    this.signal_type = init.signal_type;
    this.source = init.source;
    this.content = init.content ?? null;
    this.timestamp = init.timestamp ?? new Date().toISOString();
    this.confidence = init.confidence ?? 0.5;
    this.component_ref = init.component_ref;
  }
}

export interface CrossValidationResultInit {
  /** 是否达成共识（至少两方一致） */
  readonly consensus: boolean;
  /** 共识值（"pass" / "fail" / null） */
  readonly consensus_value?: string | null;
  /** 分歧描述列表 */
  readonly disagreements?: readonly string[];
  /** 建议（proceed / proceed_with_caution / escalate_operator） */
  readonly recommendation: string;
  readonly confidence?: number;
  readonly signal_count?: number;
}

/** 三方信号交叉验证结果（roleagent.md §5.3）。 */
export class CrossValidationResult {
  readonly consensus: boolean;
  readonly consensus_value: string | null;
  readonly disagreements: string[];
  readonly recommendation: string;
  readonly confidence: number;
  readonly signal_count: number;

  constructor(init: CrossValidationResultInit) {
    this.consensus = init.consensus;
    this.consensus_value = init.consensus_value ?? null;
    this.disagreements = [...(init.disagreements ?? [])];
    this.recommendation = init.recommendation;
    this.confidence = init.confidence ?? 0.5;
    this.signal_count = init.signal_count ?? 0;
  }
}

/** 共识判定阈值：信号置信度 >= 此值视为 "pass"，否则 "fail" */
const CONFIDENCE_PASS_THRESHOLD = 0.5;

/**
 * 从信号中提取归一化判定值（"pass" / "fail"）。
 *
 * 提取优先级：
 * 1. content 为 dict 且含 verdict → 直接使用（warn 归入 fail）
 * 2. content 为 dict 且含 score → score >= 0.85 → pass
 * 3. 否则按 confidence 判定（>= 0.5 → pass）
 */
export function extractVerdict(signal: Signal): 'pass' | 'fail' {
  const content = signal.content;
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const dict = content as Record<string, unknown>;
    const verdict = dict['verdict'];
    if (verdict === 'pass' || verdict === 'fail' || verdict === 'warn') {
      // warn 归入 fail（需要关注）
      return verdict === 'warn' ? 'fail' : verdict;
    }
    const score = dict['score'];
    if (typeof score === 'number') {
      return score >= 0.85 ? 'pass' : 'fail';
    }
  }
  // 回退到 confidence
  return signal.confidence >= CONFIDENCE_PASS_THRESHOLD ? 'pass' : 'fail';
}

/** 三方信号交叉验证器——采集 + 交叉验证。 */
export class ThreeSignalCrossValidator {
  /** 采集 trace 信号——执行轨迹（轨迹经济学：采集有成本）。 */
  async collectTraceSignal(traceData: Record<string, unknown>): Promise<Signal> {
    return new Signal({
      signal_type: SignalType.TRACE,
      source: typeof traceData['source'] === 'string' ? traceData['source'] : 'trace_collector',
      content: traceData,
      confidence: typeof traceData['confidence'] === 'number' ? traceData['confidence'] : 0.5,
      component_ref: typeof traceData['component_ref'] === 'string' ? traceData['component_ref'] : undefined,
    });
  }

  /** 采集用户信号——用户反馈 / 摩擦信号（harness eval 关键输入）。 */
  async collectHumanSignal(humanFeedback: Record<string, unknown>): Promise<Signal> {
    return new Signal({
      signal_type: SignalType.HUMAN,
      source: typeof humanFeedback['source'] === 'string' ? humanFeedback['source'] : 'user_feedback',
      content: humanFeedback,
      confidence: typeof humanFeedback['confidence'] === 'number' ? humanFeedback['confidence'] : 0.5,
      component_ref: typeof humanFeedback['component_ref'] === 'string' ? humanFeedback['component_ref'] : undefined,
    });
  }

  /** 采集自动探针信号——客观指标（benchmark 分数 / 延迟 / 成功率）。 */
  async collectAutoSignal(autoMetric: Record<string, unknown>): Promise<Signal> {
    return new Signal({
      signal_type: SignalType.AUTO,
      source: typeof autoMetric['source'] === 'string' ? autoMetric['source'] : 'benchmark_probe',
      content: autoMetric,
      confidence: typeof autoMetric['confidence'] === 'number' ? autoMetric['confidence'] : 0.5,
      component_ref: typeof autoMetric['component_ref'] === 'string' ? autoMetric['component_ref'] : undefined,
    });
  }

  /**
   * 三方信号交叉验证。
   *
   * 验证逻辑（roleagent.md §5.3）：
   * - 三方一致 → consensus=true，recommendation="proceed"
   * - 两方一致 → consensus=true（多数），recommendation="proceed_with_caution"（pass 多数）
   * - 三方分歧 / 平票 / 不足两方 → consensus=false，recommendation="escalate_operator"
   * - fail 多数 → consensus 但 escalate_operator
   *
   * 综合置信度 = 平均置信度 × (共识信号数 / 总信号数)。
   */
  async crossValidate(signals: readonly Signal[]): Promise<CrossValidationResult> {
    if (signals.length === 0) {
      return new CrossValidationResult({
        consensus: false,
        consensus_value: null,
        disagreements: ['无信号输入'],
        recommendation: 'escalate_operator',
        confidence: 0.0,
        signal_count: 0,
      });
    }

    // 提取每条信号的判定值
    const verdicts = signals.map((s) => extractVerdict(s));
    const signalCount = signals.length;

    // 统计 pass / fail 票数
    const passCount = verdicts.filter((v) => v === 'pass').length;
    const failCount = signalCount - passCount;

    // 多数投票
    let majorityVerdict: 'pass' | 'fail' | null;
    let majorityCount: number;
    if (passCount > failCount) {
      majorityVerdict = 'pass';
      majorityCount = passCount;
    } else if (failCount > passCount) {
      majorityVerdict = 'fail';
      majorityCount = failCount;
    } else {
      // 平票（如 1 pass 1 fail）→ 无共识
      majorityVerdict = null;
      majorityCount = passCount;
    }

    // 共识判定
    const consensus = majorityVerdict !== null && majorityCount >= 2;

    // 分歧记录
    const disagreements: string[] = [];
    if (signalCount >= 2 && majorityVerdict !== null) {
      signals.forEach((sig, i) => {
        const v = verdicts[i] as 'pass' | 'fail';
        if (v !== majorityVerdict) {
          disagreements.push(`信号 ${sig.signal_id}（${sig.signal_type}/${sig.source}）判定为 '${v}'，与多数 '${majorityVerdict}' 不一致`);
        }
      });
    }

    // 建议生成
    let recommendation: string;
    if (!consensus || majorityVerdict === null) {
      recommendation = 'escalate_operator';
    } else if (majorityVerdict === 'fail') {
      recommendation = 'escalate_operator';
    } else if (disagreements.length > 0) {
      recommendation = 'proceed_with_caution';
    } else {
      recommendation = 'proceed';
    }

    // 综合置信度 = 平均置信度 × (共识信号数 / 总信号数)
    const avgConf = signals.reduce((acc, s) => acc + s.confidence, 0) / signalCount;
    const agreementRatio = majorityVerdict !== null ? majorityCount / signalCount : 0.0;
    const combinedConfidence = avgConf * agreementRatio;

    return new CrossValidationResult({
      consensus,
      consensus_value: majorityVerdict,
      disagreements,
      recommendation,
      confidence: Math.round(combinedConfidence * 10000) / 10000,
      signal_count: signalCount,
    });
  }
}

/**
 * feedback-loop — 外环质量门控（对齐 Python `harness/feedback_loop.py` FR-HRN-03）。
 *
 * - 4 维评分：correctness / completeness / coherence / safety
 * - 分类门：PASS / CONDITIONAL / FAIL
 * - 三种模式：full（2 LLM 调用）/ lightweight（1 次，默认）/ skip（0 次自动通过）
 * - 启发式回退：无 LLM 或调用失败时按内容特征评分（长度/结构/段落/失败词/重复）
 * - 数据富集短内容自动 PASS（P0-22：数据类 agent 返回短 content 属正常）
 * - FAIL → 状态降级 partial + quality_warning（不回内环，P0-29 语义）
 *
 * @module @flowforge/forgekin-harness-eval
 */

import {
  ClassificationGate,
  EvaluationMode,
  FEEDBACK_DIMENSIONS,
  type FeedbackResult,
} from './types.js';
import { clamp01 } from './evaluator.js';

/** LLM 评审客户端接口——可注入（缺省无 LLM → 纯启发式）。 */
export interface FeedbackJudgeClient {
  /** 发送 prompt，返回评审文本；失败抛错或返回 null。 */
  readonly judge: (prompt: string) => Promise<string | null>;
}

/** FeedbackLoop 配置（对齐 feedback_loop.py __init__）。 */
export interface FeedbackLoopOptions {
  /** 评估模式：full / lightweight / skip（默认 lightweight） */
  readonly evaluationMode?: EvaluationMode | undefined;
  /** 质量阈值（默认 0.7，full 模式分类用） */
  readonly qualityThreshold?: number | undefined;
  /** 最大自校正轮次（默认 1） */
  readonly maxCorrections?: number | undefined;
  /** LLM 评审客户端（缺省纯启发式） */
  readonly llmClient?: FeedbackJudgeClient | undefined;
}

/** 输出内容提取优先级（对齐 feedback_loop.py P0-29 字段优先级）。 */
const CONTENT_KEYS = [
  'report',
  'edited_draft',
  'polished_content',
  'content',
  'response',
  'output',
  'draft',
  'final_answer',
] as const;

/** 数据富集字段（P0-22：content 短但有实质数据的字段）。 */
const DATA_FIELD_KEYS = [
  'records',
  'indicators',
  'financial',
  'kline_data',
  'prediction',
  'risk_assessment',
  'report',
  'data',
  'result',
  'output',
] as const;

/** 失败指示词（启发式 lightweight 判定）。 */
const FAILURE_INDICATORS = [
  'i cannot',
  "i can't",
  'unable to',
  'error:',
  'failed to',
  'not possible',
  '作为ai',
] as const;

/** 质量门控结果——在 result 上附加的 `_feedback` 元数据。 */
export interface FeedbackMeta {
  readonly gate: ClassificationGate;
  readonly mode: EvaluationMode;
  readonly scores?: Readonly<Record<string, number>> | undefined;
  readonly reason?: string | undefined;
  readonly action?: string | undefined;
  readonly duration_ms?: number | undefined;
}

/** 带质量标记的执行结果。 */
export interface EvaluatedOutput {
  /** 原结果字段（浅拷贝） */
  readonly result: Readonly<Record<string, unknown>>;
  /** 质量门控元数据 */
  readonly feedback?: FeedbackMeta | undefined;
  /** FAIL 时状态降级为 partial */
  readonly status?: string | undefined;
  /** FAIL 时置 quality_warning */
  readonly quality_warning?: boolean | undefined;
}

/**
 * FeedbackLoop——外环质量门控（全局守卫，post-execute 钩子）。
 *
 * 与 Reflexion 的关系：内环先跑（模式内快速迭代），外环做最终评审；
 * 外环 FAIL 直接降级 partial + quality_warning，不回内环。
 */
export class FeedbackLoop {
  readonly evaluationMode: EvaluationMode;
  readonly qualityThreshold: number;
  readonly maxCorrections: number;
  private readonly llmClient?: FeedbackJudgeClient | undefined;
  private evaluationCount = 0;
  private readonly gateCounts: Record<ClassificationGate, number> = {
    [ClassificationGate.PASS]: 0,
    [ClassificationGate.CONDITIONAL]: 0,
    [ClassificationGate.FAIL]: 0,
  };

  constructor(options: FeedbackLoopOptions = {}) {
    this.evaluationMode = options.evaluationMode ?? EvaluationMode.LIGHTWEIGHT;
    this.qualityThreshold = options.qualityThreshold ?? 0.7;
    this.maxCorrections = options.maxCorrections ?? 1;
    this.llmClient = options.llmClient;
  }

  /**
   * 评估执行结果（对齐 evaluate() 双调用约定）。
   *
   * @param result 执行结果字典
   * @param evaluationMode 可选覆盖模式
   * @returns 带 _feedback 元数据的结果
   */
  async evaluate(
    result: Readonly<Record<string, unknown>>,
    evaluationMode?: EvaluationMode,
  ): Promise<EvaluatedOutput> {
    const mode = evaluationMode ?? this.evaluationMode;
    if (mode === EvaluationMode.SKIP) {
      return { result, feedback: { gate: ClassificationGate.PASS, mode, reason: 'skip' } };
    }

    this.evaluationCount += 1;
    const start = Date.now();
    const content = extractContent(result);

    // 短内容处理（P0-22）：数据富集字段 → 自动 PASS；否则 FAIL（产出质量问题）
    if (content.length === 0 || content.trim().length < 100) {
      if (hasSubstantialData(result)) {
        this.gateCounts[ClassificationGate.PASS] += 1;
        return this.finish({
          result,
          feedback: {
            gate: ClassificationGate.PASS,
            mode,
            reason: 'data_rich_short_content_auto_pass',
            action: 'none',
            duration_ms: Date.now() - start,
          },
        });
      }
      this.gateCounts[ClassificationGate.FAIL] += 1;
      return this.finish({
        result,
        feedback: {
          gate: ClassificationGate.FAIL,
          mode,
          reason: 'output_too_short_for_evaluation',
          action: 'downgraded',
          duration_ms: Date.now() - start,
        },
        status: 'partial',
        quality_warning: true,
      });
    }

    let feedback: FeedbackMeta;
    if (mode === EvaluationMode.FULL) {
      const scores = await this.fullEvaluation(content);
      const gate = this.classifyWithScores(scores);
      feedback = { gate, mode, scores, duration_ms: Date.now() - start };
    } else {
      const gate = await this.lightweightEvaluation(content);
      feedback = { gate, mode, duration_ms: Date.now() - start };
    }

    this.gateCounts[feedback.gate] += 1;
    if (feedback.gate === ClassificationGate.FAIL) {
      return this.finish({
        result,
        feedback: { ...feedback, action: 'downgraded' },
        status: 'partial',
        quality_warning: true,
      });
    }
    if (feedback.gate === ClassificationGate.CONDITIONAL) {
      feedback = { ...feedback, action: 'accepted_with_warning' };
    }
    return this.finish({ result, feedback });
  }

  // ========== Full 模式：4 维评分（LLM → 启发式回退）==========

  private async fullEvaluation(content: string): Promise<Record<string, number>> {
    if (this.llmClient) {
      try {
        const judge = await this.llmClient.judge(buildJudgePrompt(content));
        if (judge) {
          const parsed = parseScoringResponse(judge);
          return parsed.dimension_scores;
        }
      } catch {
        // 回退到启发式
      }
    }
    return heuristicScores(content);
  }

  // ========== Lightweight 模式：单次分类门（LLM → 启发式回退）==========

  private async lightweightEvaluation(content: string): Promise<ClassificationGate> {
    if (this.llmClient) {
      try {
        const response = await this.llmClient.judge(buildCombinedPrompt(content));
        if (response) {
          const parsed = parseScoringResponse(response);
          return this.classifyWithScores({ overall: parsed.overall_score });
        }
      } catch {
        // 回退到启发式
      }
    }
    return heuristicGate(content);
  }

  // ========== 分类门 ==========

  /** 基于 4 维分数分类（对齐 _classify_with_scores：均值阈值 + 关键维度兜底）。 */
  private classifyWithScores(scores: Readonly<Record<string, number>>): ClassificationGate {
    const dims = FEEDBACK_DIMENSIONS.filter((d) => scores[d] !== undefined);
    const values = dims.map((d) => scores[d] as number);
    const avg = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : scores['overall'] ?? 0;

    if (avg >= this.qualityThreshold) {
      return values.some((v) => v < 0.4) ? ClassificationGate.CONDITIONAL : ClassificationGate.PASS;
    }
    if (avg >= this.qualityThreshold * 0.7) {
      return ClassificationGate.CONDITIONAL;
    }
    return ClassificationGate.FAIL;
  }

  // ========== 状态 ==========

  /** 运行状态快照（对齐 get_status）。 */
  getStatus(): Readonly<{
    enabled: boolean;
    evaluationMode: EvaluationMode;
    qualityThreshold: number;
    evaluationCount: number;
    gateCounts: Readonly<Record<ClassificationGate, number>>;
  }> {
    return {
      enabled: this.evaluationMode !== EvaluationMode.SKIP,
      evaluationMode: this.evaluationMode,
      qualityThreshold: this.qualityThreshold,
      evaluationCount: this.evaluationCount,
      gateCounts: { ...this.gateCounts },
    };
  }

  /** 从结果构造 FeedbackResult 结构（供调用方统一消费）。 */
  toFeedbackResult(
    output: EvaluatedOutput,
    issues: readonly string[] = [],
    recommendations: readonly string[] = [],
  ): FeedbackResult {
    const f = output.feedback;
    return {
      gate: f?.gate ?? ClassificationGate.PASS,
      overall_score:
        f?.scores && FEEDBACK_DIMENSIONS.length > 0
          ? FEEDBACK_DIMENSIONS.reduce((s, d) => s + (f.scores?.[d] ?? 0), 0) / FEEDBACK_DIMENSIONS.length
          : output.quality_warning === true
            ? 0
            : 1,
      dimension_scores: f?.scores ?? {},
      issues,
      recommendations,
      mode: f?.mode ?? EvaluationMode.LIGHTWEIGHT,
      llm_calls: f?.mode === EvaluationMode.FULL ? 2 : f?.mode === EvaluationMode.LIGHTWEIGHT ? 1 : 0,
    };
  }

  private finish(output: EvaluatedOutput): EvaluatedOutput {
    return output;
  }
}

// ========== 内容提取（P0-29 字段优先级）==========

/** 从结果中提取待评估文本（report 优先于 content，支持嵌套 dict）。 */
export function extractContent(result: Readonly<Record<string, unknown>>): string {
  for (const key of CONTENT_KEYS) {
    const val = result[key];
    if (typeof val === 'string' && val.trim()) {
      return val;
    }
    if (val && typeof val === 'object') {
      const nested = extractContent(val as Readonly<Record<string, unknown>>);
      if (nested.trim()) {
        return nested;
      }
    }
  }
  return '';
}

/** 数据富集判定（P0-22）：content 短但有实质数据字段。 */
export function hasSubstantialData(result: Readonly<Record<string, unknown>>): boolean {
  for (const key of DATA_FIELD_KEYS) {
    const v = result[key];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length > 0) return true;
    if (typeof v === 'object' && Object.keys(v).length > 0) return true;
    if (typeof v === 'string' && v.length > 100) return true;
  }
  return false;
}

// ========== 启发式评分（无 LLM 回退）==========

/** 4 维启发式评分（对齐 feedback_loop.py _full_evaluation 启发式分支）。 */
export function heuristicScores(content: string): Record<string, number> {
  const len = content.length;
  const correctness = len < 100 ? 0.3 : len <= 500 ? 0.5 : 0.6;
  const hasStructure = /[#\-*1.•]/.test(content);
  const completeness = hasStructure ? 0.5 : 0.3;
  const hasParagraphs = content.includes('\n\n');
  const coherence = hasParagraphs ? 0.5 : 0.3;
  const safety = 0.7;
  return { correctness, completeness, coherence, safety };
}

/** 启发式分类门（对齐 _lightweight_evaluation 启发式分支）。 */
export function heuristicGate(content: string): ClassificationGate {
  const lower = content.toLowerCase();
  if (FAILURE_INDICATORS.some((ind) => lower.includes(ind))) {
    return ClassificationGate.CONDITIONAL;
  }
  const words = content.split(/\s+/).filter(Boolean);
  if (words.length < 20) {
    return ClassificationGate.CONDITIONAL;
  }
  if (words.length > 50) {
    const unique = new Set(words.map((w) => w.toLowerCase()));
    if (unique.size / words.length < 0.3) {
      return ClassificationGate.FAIL;
    }
  }
  return ClassificationGate.PASS;
}

// ========== Prompt 构建与响应解析 ==========

/** 构建 lightweight 合并评审 prompt。 */
export function buildCombinedPrompt(content: string): string {
  return [
    'You are a quality judge. Evaluate the following agent output.',
    'Respond with JSON: {"overall_score": 0.0-1.0, "dimension_scores": {"correctness": x, "completeness": x, "coherence": x, "safety": x}, "issues": [], "recommendations": []}',
    '',
    content.slice(0, 3000),
  ].join('\n');
}

/** 构建 full 模式独立评审 prompt。 */
export function buildJudgePrompt(content: string): string {
  return [
    'You are an independent quality judge. Assess correctness, completeness, coherence and safety of:',
    '',
    content.slice(0, 3000),
  ].join('\n');
}

/** 解析 LLM 评分响应（JSON 提取 + 失败兜底，对齐 _parse_scoring_response）。 */
export function parseScoringResponse(response: string): {
  overall_score: number;
  dimension_scores: Record<string, number>;
  issues: string[];
  recommendations: string[];
} {
  const jsonStr = extractJson(response);
  if (jsonStr === null) {
    return {
      overall_score: 0.5,
      dimension_scores: { correctness: 0.5, completeness: 0.5, coherence: 0.5, safety: 0.5 },
      issues: ['Failed to parse judge response'],
      recommendations: [],
    };
  }
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    const dims = (data['dimension_scores'] as Record<string, unknown> | undefined) ?? {};
    const dimension_scores: Record<string, number> = {};
    for (const dim of FEEDBACK_DIMENSIONS) {
      const v = dims[dim];
      dimension_scores[dim] = clamp01(typeof v === 'number' ? v : 0.5);
    }
    const overall = clamp01(typeof data['overall_score'] === 'number' ? (data['overall_score'] as number) : 0.5);
    return {
      overall_score: overall,
      dimension_scores,
      issues: toStringArray(data['issues']),
      recommendations: toStringArray(data['recommendations']),
    };
  } catch {
    return {
      overall_score: 0.5,
      dimension_scores: { correctness: 0.5, completeness: 0.5, coherence: 0.5, safety: 0.5 },
      issues: ['Failed to parse judge response'],
      recommendations: [],
    };
  }
}

/** 从响应中提取 JSON 块（```json ... ``` 或首尾大括号）。 */
export function extractJson(response: string): string | null {
  const fence = response.indexOf('```json');
  if (fence !== -1) {
    const start = fence + 7;
    const end = response.indexOf('```', start);
    return end !== -1 ? response.slice(start, end).trim() : response.slice(start).trim();
  }
  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  return start !== -1 && end > start ? response.slice(start, end + 1) : null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') return [value];
  return [];
}

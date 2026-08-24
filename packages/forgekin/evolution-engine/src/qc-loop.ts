/**
 * CL-034 QC Loop 7-Step — Maine Coon 3-Layer Reviewer Split QC 循环。
 * TS 重写自 Python `evolution/qc_loop.py`。
 *
 * 规格大纲（design v7.1-§D7.11）：
 * - Maine Coon 3-Layer Reviewer Split（架构 / 逻辑 / 细节 三层独立审查）
 * - 7 步 QC 循环（prepare/scan/analyze/fix/verify/iterate/close）
 * - 与 Eval 自代谢的协议接口
 *
 * 骨架实现（与 Python 对齐）：所有 _stepXxx 返回固定 PASS 结构，
 * run() 顺序执行 7 步并生成 QCLoopReport，max_iterations 默认 3 次
 * 但骨架实现只跑 1 次（不真正迭代）。
 */

/** QC Loop 7 步枚举。 */
export const QC_STEPS = [
  'prepare',
  'scan',
  'analyze',
  'fix',
  'verify',
  'iterate',
  'close',
] as const;

export type QCStep = (typeof QC_STEPS)[number];

/** Maine Coon 3-Layer Reviewer 三层。 */
export const REVIEWER_LAYERS = ['architecture', 'logic', 'detail'] as const;

export type ReviewerLayer = (typeof REVIEWER_LAYERS)[number];

/** 单个 QC 问题：{severity, location, description, suggestion}。 */
export interface QCIssue {
  readonly severity: string;
  readonly location: string;
  readonly description: string;
  readonly suggestion: string;
}

/** 单层 reviewer 审查报告。 */
export interface ReviewerReport {
  readonly layer: ReviewerLayer;
  /** 审查 Forgekin ID */
  readonly reviewerId: string;
  readonly issues: QCIssue[];
  readonly passCount: number;
  readonly failCount: number;
  readonly reviewedAt: string;
}

/** 单步 QC 执行结果。 */
export interface QCStepResult {
  readonly step: QCStep;
  readonly passed: boolean;
  readonly output: Record<string, unknown>;
  readonly durationSeconds: number;
  readonly error: string | null;
}

export type QCFinalStatus = 'passed' | 'failed' | 'aborted';

/** 完整 QC Loop 报告。 */
export interface QCLoopReport {
  readonly targetId: string;
  readonly iterationCount: number;
  readonly finalStatus: QCFinalStatus;
  readonly stepResults: QCStepResult[];
  readonly reviewerReports: ReviewerReport[];
  readonly startedAt: string;
  readonly completedAt: string;
}

/** 计时函数（可注入，测试用假时钟）。 */
export type NowMsFn = () => number;

/**
 * QC Loop 7-Step — Maine Coon 3-Layer Reviewer QC 循环。
 *
 * 骨架实现：7 步顺序执行，所有步骤返回固定 PASS 结构；
 * max_iterations 默认 3，骨架实现只跑 1 次（不真正迭代）。
 */
export class QCLoop {
  private readonly maxIterations: number;
  private readonly nowMs: NowMsFn;
  private lastReport: QCLoopReport | null = null;

  constructor(options: { maxIterations?: number; nowMs?: NowMsFn } = {}) {
    const maxIterations = options.maxIterations ?? 3;
    if (maxIterations < 1) {
      throw new Error(`max_iterations must be >= 1, got ${maxIterations}`);
    }
    this.maxIterations = maxIterations;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  /** 执行 7 步 QC 循环（骨架：单次执行 7 步，不真正迭代）。 */
  async run(targetId: string, targetArtifacts: Record<string, unknown>): Promise<QCLoopReport> {
    const startedAt = new Date(this.nowMs()).toISOString();
    const stepResults: QCStepResult[] = [];
    const reviewerReports: ReviewerReport[] = [];

    stepResults.push(this.stepPrepare(targetId, targetArtifacts));
    stepResults.push(this.stepScan(targetId, targetArtifacts));
    stepResults.push(this.stepAnalyze(targetId, targetArtifacts));

    // 填充 reviewer_reports（骨架：三层空报告）
    for (const layer of REVIEWER_LAYERS) {
      reviewerReports.push({
        layer,
        reviewerId: `${layer}_reviewer_skeleton`,
        issues: [],
        passCount: 1,
        failCount: 0,
        reviewedAt: new Date(this.nowMs()).toISOString(),
      });
    }

    // 骨架：无 issues，fix 步骤空操作
    stepResults.push(this.stepFix(targetId, targetArtifacts, []));
    stepResults.push(this.stepVerify(targetId, targetArtifacts));
    stepResults.push(this.stepIterate(targetId, 1));
    stepResults.push(this.stepClose(targetId, 'passed'));

    const report: QCLoopReport = {
      targetId,
      iterationCount: 1,
      finalStatus: 'passed',
      stepResults,
      reviewerReports,
      startedAt,
      completedAt: new Date(this.nowMs()).toISOString(),
    };
    this.lastReport = report;
    return report;
  }

  // ── 7 步方法（与 Python 公共别名对齐，直接以公共方法暴露） ──

  /** Step 1: 准备 — 识别审查范围。 */
  stepPrepare(_targetId: string, artifacts: Record<string, unknown>): QCStepResult {
    const start = this.nowMs();
    return {
      step: 'prepare',
      passed: true,
      output: {
        scope: Object.keys(artifacts),
        artifact_count: Object.keys(artifacts).length,
      },
      durationSeconds: (this.nowMs() - start) / 1000,
      error: null,
    };
  }

  /** Step 2: 扫描 — 自动化 lint/type/test。 */
  stepScan(_targetId: string, _artifacts: Record<string, unknown>): QCStepResult {
    const start = this.nowMs();
    return {
      step: 'scan',
      passed: true,
      output: { lint_passed: true, type_check_passed: true, test_passed: true },
      durationSeconds: (this.nowMs() - start) / 1000,
      error: null,
    };
  }

  /** Step 3: 分析 — 三层 reviewer 独立审查。 */
  stepAnalyze(_targetId: string, _artifacts: Record<string, unknown>): QCStepResult {
    const start = this.nowMs();
    return {
      step: 'analyze',
      passed: true,
      output: { layers: [...REVIEWER_LAYERS], issues_total: 0 },
      durationSeconds: (this.nowMs() - start) / 1000,
      error: null,
    };
  }

  /** Step 4: 修复 — 根据 reviewer 意见修复。 */
  stepFix(_targetId: string, _artifacts: Record<string, unknown>, issues: QCIssue[]): QCStepResult {
    const start = this.nowMs();
    return {
      step: 'fix',
      passed: true,
      output: { issues_addressed: 0, issues_total: issues.length },
      durationSeconds: (this.nowMs() - start) / 1000,
      error: null,
    };
  }

  /** Step 5: 验证 — 回归测试 + 三层复审。 */
  stepVerify(_targetId: string, _artifacts: Record<string, unknown>): QCStepResult {
    const start = this.nowMs();
    return {
      step: 'verify',
      passed: true,
      output: { regression_passed: true, reviewer_resign_off: true },
      durationSeconds: (this.nowMs() - start) / 1000,
      error: null,
    };
  }

  /** Step 6: 迭代 — 决定是否继续迭代（骨架：永不继续）。 */
  stepIterate(_targetId: string, currentIteration: number): QCStepResult {
    const start = this.nowMs();
    return {
      step: 'iterate',
      passed: true,
      output: {
        current_iteration: currentIteration,
        max_iterations: this.maxIterations,
        continue_iteration: false,
      },
      durationSeconds: (this.nowMs() - start) / 1000,
      error: null,
    };
  }

  /** Step 7: 关闭 — 达标后输出 QC 报告。 */
  stepClose(_targetId: string, finalStatus: string): QCStepResult {
    const start = this.nowMs();
    return {
      step: 'close',
      passed: true,
      output: { final_status: finalStatus, report_generated: true },
      durationSeconds: (this.nowMs() - start) / 1000,
      error: null,
    };
  }

  /** 返回上次 QC Loop 报告。 */
  getLastReport(): QCLoopReport | null {
    return this.lastReport;
  }
}

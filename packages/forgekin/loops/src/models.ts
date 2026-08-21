/**
 * loops 域数据模型 — 五步循环各阶段的输入输出（对齐 Python `evolution/self_dev_base.py` §1）。
 */
import { randomUUID } from 'node:crypto';

const hex12 = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

/** 开发任务 — Discover 阶段输出（对齐 DevTask） */
export interface DevTask {
  readonly taskId: string;
  /** "doc" | "code" | "framework" | "review" | "test" */
  readonly loopType: string;
  /** 目标文件/目录路径（相对项目根，禁止绝对路径硬编码） */
  readonly targetPath: string;
  /** "create" | "update" | "delete" */
  readonly modificationType: string;
  /** 任务描述（自然语言） */
  readonly description: string;
  /** "low" | "normal" | "high" | "critical" */
  readonly priority: string;
  /** 额外上下文（如来源 Eval Ledger ID） */
  readonly context: Record<string, unknown>;
  readonly createdAt: string;
}

/** 修改方案 — Plan 阶段输出（对齐 DevPlan） */
export interface DevPlan {
  readonly planId: string;
  readonly taskId: string;
  /** 具体步骤列表（每步含 action/params） */
  readonly steps: Array<Record<string, unknown>>;
  /** 预期效果 */
  readonly expectedEffect: string;
  /** 风险评估 */
  readonly riskAssessment: string;
  /** 是否需要 operator 显式批准（I8 Framework 必为 true） */
  readonly requiresApproval: boolean;
  /** 生成此方案的 LLM 模型（审计可追溯） */
  readonly llmModel: string;
  readonly createdAt: string;
}

/** 修改结果 — Act 阶段输出（对齐 DevResult） */
export interface DevResult {
  readonly resultId: string;
  readonly planId: string;
  /** 变更文件列表 */
  readonly changedFiles: string[];
  /** diff 摘要（自然语言描述） */
  readonly diffSummary: string;
  readonly success: boolean;
  readonly errorMessage: string;
  /** Act 阶段耗时（毫秒） */
  readonly elapsedMs: number;
  readonly createdAt: string;
}

/** 验证结果 — Verify 阶段输出（对齐 VerifyResult） */
export interface VerifyResult {
  readonly verifyId: string;
  readonly resultId: string;
  readonly passed: boolean;
  /** 具体检查项 [{name, passed, detail}] */
  readonly checks: Array<Record<string, unknown>>;
  readonly failureReasons: string[];
  /** T7 铁律：LLM 审核是否通过 */
  readonly llmReviewPassed: boolean;
  readonly elapsedMs: number;
  readonly createdAt: string;
}

/** 单次循环执行记录 — 用于审计和 Persist 沉淀（对齐 LoopExecutionRecord）
 * 运行期逐步累积：reflectCount/finalPassed/finishedAt/persisted/persistPayload 在循环中赋值。 */
export interface LoopExecutionRecord {
  readonly recordId: string;
  readonly loopType: string;
  readonly task: DevTask;
  /** 含每次 Reflect 后的新 Plan */
  readonly plansHistory: DevPlan[];
  readonly resultsHistory: DevResult[];
  readonly verifiesHistory: VerifyResult[];
  finalPassed: boolean;
  reflectCount: number;
  /** 是否已沉淀到治理层 */
  persisted: boolean;
  persistPayload: Record<string, unknown>;
  readonly startedAt: string;
  finishedAt: string | undefined;
}

export function makeDevTask(init: Partial<Omit<DevTask, 'taskId' | 'createdAt'>> & Pick<DevTask, 'loopType' | 'targetPath' | 'modificationType' | 'description'>): DevTask {
  return {
    taskId: `task-${hex12()}`,
    priority: 'normal',
    context: {},
    createdAt: new Date().toISOString(),
    ...init,
  };
}

export function makeDevPlan(init: Partial<Omit<DevPlan, 'planId' | 'createdAt'>> & Pick<DevPlan, 'taskId' | 'steps' | 'expectedEffect' | 'riskAssessment'>): DevPlan {
  return {
    planId: `plan-${hex12()}`,
    requiresApproval: false,
    llmModel: '',
    createdAt: new Date().toISOString(),
    ...init,
  };
}

export function makeDevResult(init: Partial<Omit<DevResult, 'resultId' | 'createdAt'>> & Pick<DevResult, 'planId' | 'diffSummary' | 'success'>): DevResult {
  return {
    resultId: `result-${hex12()}`,
    changedFiles: [],
    errorMessage: '',
    elapsedMs: 0,
    createdAt: new Date().toISOString(),
    ...init,
  };
}

export function makeVerifyResult(init: Partial<Omit<VerifyResult, 'verifyId' | 'createdAt'>> & Pick<VerifyResult, 'resultId' | 'passed' | 'checks'>): VerifyResult {
  return {
    verifyId: `verify-${hex12()}`,
    failureReasons: [],
    llmReviewPassed: false,
    elapsedMs: 0,
    createdAt: new Date().toISOString(),
    ...init,
  };
}

export function makeLoopExecutionRecord(init: Partial<Omit<LoopExecutionRecord, 'recordId' | 'startedAt'>> & Pick<LoopExecutionRecord, 'loopType' | 'task'>): LoopExecutionRecord {
  return {
    recordId: `rec-${hex12()}`,
    plansHistory: [],
    resultsHistory: [],
    verifiesHistory: [],
    finalPassed: false,
    reflectCount: 0,
    persisted: false,
    persistPayload: {},
    startedAt: new Date().toISOString(),
    finishedAt: undefined,
    ...init,
  };
}

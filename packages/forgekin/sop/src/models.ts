/**
 * @flowforge/forgekin-sop — SOP 数据模型
 *
 * 对齐 Python `sop/models.py`：阶段、硬规则、陷阱、谓词配置与执行状态。
 * SOP 用于管控多智能体自开发方法论的阶段流转：
 * - SOPExecutor 管控阶段门禁（hardRules / pitfalls）
 * - LoopExecutor 管控阶段内的实际任务执行
 *
 * TS 约定：全字段必填 interface + make* 工厂填默认值
 * （规避 exactOptionalPropertyTypes 样板），datetime 用 ISO 字符串。
 */

/** 规则严重程度（对齐 Severity 枚举） */
export const Severity = {
  /** 阻断规则，未通过则禁止进入下一阶段 */
  BLOCKER: 'blocker',
  /** 警告级别，记录但不阻断 */
  WARN: 'warn',
} as const;

export type Severity = (typeof Severity)[keyof typeof Severity];

/** 谓词检查器类型（对齐 PredicateType 枚举） */
export const PredicateType = {
  /** 手动检查（返回 passed=true，附 reason 说明） */
  MANUAL_ONLY: 'manual_only',
  /** 检查 git 仓库状态（ahead/behind/clean） */
  GIT_STATE_PREDICATE: 'git_state_predicate',
  /** 检查环境变量 */
  ENV_CHECK: 'env_check',
  /** 检查命令模式匹配（正则） */
  COMMAND_PATTERN: 'command_pattern',
  /** 检查命令序列（mustInclude / antiPattern） */
  COMMAND_SEQUENCE: 'command_sequence',
  /** 检查 handle 约束（reviewer_not_author / guardian_handoff_present） */
  HANDLE_CHECK: 'handle_check',
  /** SHA 去重检查 */
  SHA_DEDUP: 'sha_dedup',
  /** feature doc 准备就绪检查 */
  FEATURE_DOC_READINESS_CHECK: 'feature_doc_readiness_check',
} as const;

export type PredicateType = (typeof PredicateType)[keyof typeof PredicateType];

/** 工厂入参辅助类型：全部可选且显式允许 undefined（exactOptionalPropertyTypes） */
type PartialWithUndefined<T> = { [K in keyof T]?: T[K] | undefined };

/** 运行时上下文（last_command / command_history / author / reviewer / guardian / current_sha / seen_shas / feature_doc / cwd） */
export type PredicateContext = Record<string, unknown>;

/**
 * 谓词配置 — 描述如何检查一条规则（对齐 PredicateConfig）。
 *
 * 通过 type 字段路由到对应检查器，其余字段作为检查器参数。
 * 常用字段（按 type 不同而异）：
 * - reason: manual_only 的说明文本
 * - repository / branch / checks / beforeCommand: git_state_predicate
 * - envVars: env_check
 * - mustMatch / mustNotMatch: command_pattern
 * - mustInclude / antiPattern / cwdContains: command_sequence
 * - constraint: handle_check
 */
export interface PredicateConfig {
  readonly type: PredicateType;
  readonly reason: string;
  readonly repository: string;
  readonly branch: string;
  readonly checks: string[];
  readonly beforeCommand: string;
  readonly envVars: string[];
  readonly mustMatch: string;
  readonly mustNotMatch: string;
  readonly mustInclude: string[];
  readonly antiPattern: string[];
  readonly cwdContains: string;
  readonly constraint: string;
}

export type PredicateConfigInit = { type: PredicateType } & PartialWithUndefined<
  Omit<PredicateConfig, 'type'>
>;

/** 构造 PredicateConfig（对齐 Pydantic 默认值） */
export function makePredicateConfig(init: PredicateConfigInit): PredicateConfig {
  return {
    type: init.type,
    reason: init.reason ?? '',
    repository: init.repository ?? 'current',
    branch: init.branch ?? 'main',
    checks: init.checks ?? [],
    beforeCommand: init.beforeCommand ?? '',
    envVars: init.envVars ?? [],
    mustMatch: init.mustMatch ?? '',
    mustNotMatch: init.mustNotMatch ?? '',
    mustInclude: init.mustInclude ?? [],
    antiPattern: init.antiPattern ?? [],
    cwdContains: init.cwdContains ?? '',
    constraint: init.constraint ?? '',
  };
}

/** 谓词检查结果（对齐 PredicateResult） */
export interface PredicateResult {
  readonly passed: boolean;
  readonly message: string;
  readonly evidence: Record<string, unknown>;
}

export function makePredicateResult(
  init: { passed: boolean } & PartialWithUndefined<Pick<PredicateResult, 'message' | 'evidence'>>,
): PredicateResult {
  return {
    passed: init.passed,
    message: init.message ?? '',
    evidence: init.evidence ?? {},
  };
}

/** 硬规则 — 阻断性或警告性的强制规则（对齐 HardRule） */
export interface HardRule {
  readonly id: string;
  readonly text: string;
  readonly severity: Severity;
  readonly predicate: PredicateConfig;
}

export function makeHardRule(
  init: Pick<HardRule, 'id' | 'text' | 'predicate'> & PartialWithUndefined<Pick<HardRule, 'severity'>>,
): HardRule {
  return {
    id: init.id,
    text: init.text,
    severity: init.severity ?? Severity.BLOCKER,
    predicate: init.predicate,
  };
}

/** 陷阱 — 阶段执行中需要警惕的常见错误（对齐 Pitfall，默认 warn） */
export interface Pitfall {
  readonly id: string;
  readonly text: string;
  readonly severity: Severity;
  readonly predicate: PredicateConfig;
}

export function makePitfall(
  init: Pick<Pitfall, 'id' | 'text' | 'predicate'> & PartialWithUndefined<Pick<Pitfall, 'severity'>>,
): Pitfall {
  return {
    id: init.id,
    text: init.text,
    severity: init.severity ?? Severity.WARN,
    predicate: init.predicate,
  };
}

/** SOP 阶段定义（对齐 SOPStage） */
export interface SOPStage {
  readonly id: string;
  readonly label: string;
  /** 建议使用的 skill 名称（用于路由到 LoopExecutor） */
  readonly suggestedSkill: string;
  readonly hardRules: HardRule[];
  readonly pitfalls: Pitfall[];
  /** 是否可选阶段（可选阶段失败不阻断主流程） */
  readonly optional: boolean;
}

export function makeSOPStage(
  init: Pick<SOPStage, 'id'> & PartialWithUndefined<Omit<SOPStage, 'id'>>,
): SOPStage {
  return {
    id: init.id,
    label: init.label ?? '',
    suggestedSkill: init.suggestedSkill ?? '',
    hardRules: init.hardRules ?? [],
    pitfalls: init.pitfalls ?? [],
    optional: init.optional ?? false,
  };
}

/** SOP 完整定义 — 一个完整的标准作业流程（对齐 SOPDefinition） */
export interface SOPDefinition {
  readonly id: string;
  readonly domain: string;
  readonly label: string;
  readonly description: string;
  readonly stages: SOPStage[];
}

export function makeSOPDefinition(
  init: Pick<SOPDefinition, 'id'> & PartialWithUndefined<Omit<SOPDefinition, 'id'>>,
): SOPDefinition {
  return {
    id: init.id,
    domain: init.domain ?? 'engineering',
    label: init.label ?? '',
    description: init.description ?? '',
    stages: init.stages ?? [],
  };
}

/** 单条规则检查结果摘要（对齐 engine `_check_rule` 的 summary dict） */
export interface RuleSummary {
  readonly ruleId: string;
  readonly text: string;
  readonly severity: Severity;
  readonly passed: boolean;
  readonly message: string;
  readonly evidence: Record<string, unknown>;
}

/** 单个阶段的执行结果（对齐 SOPStageResult，executedAt 为 ISO 字符串） */
export interface SOPStageResult {
  readonly stageId: string;
  readonly stageLabel: string;
  readonly passed: boolean;
  readonly hardRuleResults: RuleSummary[];
  readonly pitfallResults: RuleSummary[];
  readonly blockerMessages: string[];
  readonly warningMessages: string[];
  readonly executedAt: string;
}

/**
 * SOP 执行状态 — 跨阶段持久化的执行上下文（对齐 SOPExecutionState）。
 * 字段可变：engine 在流转过程中原地更新。
 */
export interface SOPExecutionState {
  sopId: string;
  featureId: string;
  stageIndex: number;
  stageResults: Record<string, SOPStageResult>;
  startedAt: string;
  completed: boolean;
}

export function makeSOPExecutionState(init: { sopId: string }): SOPExecutionState {
  return {
    sopId: init.sopId,
    featureId: '',
    stageIndex: 0,
    stageResults: {},
    startedAt: new Date().toISOString(),
    completed: false,
  };
}

/** SOP 完整执行结果（对齐 SOPExecutionResult） */
export interface SOPExecutionResult {
  readonly sopId: string;
  readonly featureId: string;
  readonly success: boolean;
  readonly stageResults: SOPStageResult[];
  readonly finalStageId: string;
  readonly blockerMessages: string[];
  readonly warningMessages: string[];
  readonly startedAt: string;
  readonly completedAt: string | null;
}

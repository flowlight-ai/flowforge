/**
 * @flowforge/forgekin-sop — SOP 执行引擎
 *
 * 对齐 Python `sop/engine.py`：阶段门禁检查与流转控制。
 * SOPExecutor 是 FlowForge 与 LoopExecutor 之间的桥接层：
 * - SOPExecutor 管控阶段门禁（hardRules / pitfalls）
 * - LoopExecutor / WorkflowExecutor 管控阶段内的实际任务执行
 *
 * 关键设计（遵守铁律）：
 * - 不直接执行任务，只做门禁检查和阶段推进（铁律3）
 * - 不直接操作数据库（铁律4），状态由 CheckpointManager 持久化
 * - 不硬编码路径/密钥（铁律5），所有配置从 YAML 加载
 */
import { promises as fs } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  HardRule,
  makePredicateConfig,
  makeSOPDefinition,
  makeSOPExecutionState,
  makeSOPStage,
  Pitfall,
  PredicateConfig,
  PredicateContext,
  PredicateResult,
  RuleSummary,
  Severity,
  SOPDefinition,
  SOPExecutionResult,
  SOPExecutionState,
  SOPStage,
  SOPStageResult,
} from './models.js';
import { PredicateChecker } from './predicate.js';

/** 执行进度快照（对齐 get_progress 返回 dict，字段转 camelCase） */
export interface SOPProgress {
  readonly sopId: string;
  readonly currentStageIndex: number;
  readonly totalStages: number;
  readonly completedStages: number;
  readonly remainingStages: number;
  readonly currentStageId: string;
  readonly currentStageLabel: string;
  readonly isCompleted: boolean;
}

/**
 * SOP 执行器 — 阶段门禁检查与流转控制（对齐 SOPExecutor）。
 *
 * 只负责：
 * 1. 检查每个阶段的 hard_rules（blocker 未通过则阻断）
 * 2. 收集 pitfalls 警告
 * 3. 推进或回退阶段
 * 4. 记录执行结果
 *
 * 实际任务执行由 LoopExecutor / WorkflowExecutor 完成，SOPExecutor
 * 通过 suggestedSkill 字段提示应使用哪个 skill。
 */
export class SOPExecutor {
  /** 当前 SOP 定义（对齐 sop 属性） */
  readonly sop: SOPDefinition;
  readonly checker: PredicateChecker;
  /** 当前执行状态（对齐 state 属性） */
  state: SOPExecutionState;

  constructor(sopDefinition: SOPDefinition, predicateChecker: PredicateChecker) {
    this.sop = sopDefinition;
    this.checker = predicateChecker;
    this.state = makeSOPExecutionState({ sopId: sopDefinition.id });
  }

  /** 获取当前阶段（所有阶段已完成时抛 RangeError，对齐 IndexError） */
  getCurrentStage(): SOPStage {
    if (this.state.stageIndex >= this.sop.stages.length) {
      throw new RangeError(
        `stage_index ${this.state.stageIndex} out of range (total ${this.sop.stages.length} stages)`,
      );
    }
    return this.sop.stages[this.state.stageIndex]!;
  }

  /** 按 ID 查找阶段（未找到返回 null） */
  getStage(stageId: string): SOPStage | null {
    return this.sop.stages.find((stage) => stage.id === stageId) ?? null;
  }

  /**
   * 推进到下一阶段（对齐 advance_stage）。
   *
   * @returns true 表示成功推进；false 表示已到达最后一个阶段（标记 completed）
   */
  advanceStage(): boolean {
    if (this.state.stageIndex >= this.sop.stages.length - 1) {
      this.state.completed = true;
      return false;
    }
    this.state.stageIndex += 1;
    return true;
  }

  /** 获取执行进度（对齐 get_progress） */
  getProgress(): SOPProgress {
    const total = this.sop.stages.length;
    const current = this.state.stageIndex;
    const currentStage = current < total ? this.sop.stages[current] : undefined;
    return {
      sopId: this.sop.id,
      currentStageIndex: current,
      totalStages: total,
      completedStages: current,
      remainingStages: Math.max(0, total - current),
      currentStageId: currentStage?.id ?? '',
      currentStageLabel: currentStage?.label ?? '',
      isCompleted: this.state.completed,
    };
  }

  /** 检查单条规则（对齐 _check_rule），返回 (result, summary) */
  async checkRule(
    rule: HardRule | Pitfall,
    context: PredicateContext,
  ): Promise<{ result: PredicateResult; summary: RuleSummary }> {
    const result = await this.checker.check(rule.predicate, context);
    const summary: RuleSummary = {
      ruleId: rule.id,
      text: rule.text,
      severity: rule.severity,
      passed: result.passed,
      message: result.message,
      evidence: result.evidence,
    };
    return { result, summary };
  }

  /**
   * 执行单个阶段的门禁检查（对齐 execute_stage）。
   *
   * 流程：检查 hard_rules（blocker 未通过 → blockerMessages，warn → warningMessages）
   * → 检查 pitfalls（可选阶段的 blocker 降级为 warning）→ 可选阶段的 hard_rule
   * blocker 也降级并清空 → 记录到 state.stageResults。
   */
  async executeStage(stageId: string, context: PredicateContext = {}): Promise<SOPStageResult> {
    const stage = this.getStage(stageId);
    if (!stage) {
      return {
        stageId,
        stageLabel: '',
        passed: false,
        hardRuleResults: [],
        pitfallResults: [],
        blockerMessages: [`stage '${stageId}' not found in SOP '${this.sop.id}'`],
        warningMessages: [],
        executedAt: new Date().toISOString(),
      };
    }

    const hardRuleResults: RuleSummary[] = [];
    const pitfallResults: RuleSummary[] = [];
    const blockerMessages: string[] = [];
    const warningMessages: string[] = [];

    // 检查 hard_rules
    for (const rule of stage.hardRules) {
      const { result, summary } = await this.checkRule(rule, context);
      hardRuleResults.push(summary);
      if (!result.passed) {
        const msg = `[${rule.id}] ${rule.text} — ${result.message}`;
        if (rule.severity === Severity.BLOCKER) {
          blockerMessages.push(msg);
        } else {
          warningMessages.push(msg);
        }
      }
    }

    // 检查 pitfalls
    for (const pitfall of stage.pitfalls) {
      const { result, summary } = await this.checkRule(pitfall, context);
      pitfallResults.push(summary);
      if (!result.passed) {
        const msg = `[${pitfall.id}] ${pitfall.text} — ${result.message}`;
        if (pitfall.severity === Severity.BLOCKER) {
          // pitfall 的 blocker 仅在非可选阶段才阻断
          if (stage.optional) {
            warningMessages.push(`(optional stage) ${msg}`);
          } else {
            blockerMessages.push(msg);
          }
        } else {
          warningMessages.push(msg);
        }
      }
    }

    // 可选阶段失败不阻断主流程
    let stagePassed = stage.optional ? true : blockerMessages.length === 0;
    if (stage.optional && blockerMessages.length > 0) {
      // 可选阶段的 blocker 降级为 warning
      for (const m of blockerMessages) {
        warningMessages.push(`(optional, downgraded) ${m}`);
      }
      blockerMessages.length = 0;
      stagePassed = true;
    }

    const stageResult: SOPStageResult = {
      stageId: stage.id,
      stageLabel: stage.label,
      passed: stagePassed,
      hardRuleResults,
      pitfallResults,
      blockerMessages,
      warningMessages,
      executedAt: new Date().toISOString(),
    };

    // 记录到执行状态
    this.state.stageResults[stage.id] = stageResult;
    return stageResult;
  }

  /**
   * 执行完整 SOP — 按顺序执行所有阶段（对齐 execute_sop）。
   *
   * 阶段未通过即 break（success=false）；全部通过则 success=true + completed。
   */
  async executeSop(featureId: string, context: PredicateContext = {}): Promise<SOPExecutionResult> {
    const startedAt = new Date().toISOString();
    this.state = {
      ...makeSOPExecutionState({ sopId: this.sop.id }),
      featureId,
      stageIndex: 0,
      startedAt,
      completed: false,
    };

    const stageResults: SOPStageResult[] = [];
    const allBlockerMessages: string[] = [];
    const allWarningMessages: string[] = [];
    let finalStageId = '';
    let success = false;

    let halted = false;
    for (let index = 0; index < this.sop.stages.length; index += 1) {
      const stage = this.sop.stages[index]!;
      this.state.stageIndex = index;
      finalStageId = stage.id;

      const stageResult = await this.executeStage(stage.id, context);
      stageResults.push(stageResult);
      allBlockerMessages.push(...stageResult.blockerMessages);
      allWarningMessages.push(...stageResult.warningMessages);

      if (!stageResult.passed) {
        halted = true;
        break;
      }
    }
    if (!halted) {
      // 所有阶段都通过（对齐 Python for-else：未 break）
      success = true;
      this.state.completed = true;
    }

    return {
      sopId: this.sop.id,
      featureId,
      success,
      stageResults,
      finalStageId,
      blockerMessages: allBlockerMessages,
      warningMessages: allWarningMessages,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  /** 重置执行状态到初始值（对齐 reset） */
  reset(): void {
    this.state = makeSOPExecutionState({ sopId: this.sop.id });
  }

  /** 从当前阶段继续执行（不重置 stageIndex，对齐 resume_from_current） */
  resumeFromCurrent(): void {
    this.state.completed = false;
  }
}

/* ------------------------------------------------------------------ */
/* YAML 加载（snake_case → camelCase，对齐 load_sop_from_yaml / dir） */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`SOP YAML invalid: ${what} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`SOP YAML invalid: ${what} must be a string`);
  }
  return value;
}

function asStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`SOP YAML invalid: ${what} must be a list of strings`);
  }
  return value as string[];
}

function parsePredicateConfig(raw: unknown, what: string): PredicateConfig {
  const data = asRecord(raw, what);
  const type = data.type;
  if (typeof type !== 'string' || type.length === 0) {
    throw new Error(`SOP YAML invalid: ${what}.type is required`);
  }
  return makePredicateConfig({
    type: type as PredicateConfig['type'],
    reason: data.reason !== undefined ? asString(data.reason, `${what}.reason`) : undefined,
    repository:
      data.repository !== undefined ? asString(data.repository, `${what}.repository`) : undefined,
    branch: data.branch !== undefined ? asString(data.branch, `${what}.branch`) : undefined,
    checks: data.checks !== undefined ? asStringArray(data.checks, `${what}.checks`) : undefined,
    beforeCommand:
      data.before_command !== undefined
        ? asString(data.before_command, `${what}.before_command`)
        : undefined,
    envVars:
      data.env_vars !== undefined ? asStringArray(data.env_vars, `${what}.env_vars`) : undefined,
    mustMatch:
      data.must_match !== undefined ? asString(data.must_match, `${what}.must_match`) : undefined,
    mustNotMatch:
      data.must_not_match !== undefined
        ? asString(data.must_not_match, `${what}.must_not_match`)
        : undefined,
    mustInclude:
      data.must_include !== undefined
        ? asStringArray(data.must_include, `${what}.must_include`)
        : undefined,
    antiPattern:
      data.anti_pattern !== undefined
        ? asStringArray(data.anti_pattern, `${what}.anti_pattern`)
        : undefined,
    cwdContains:
      data.cwd_contains !== undefined
        ? asString(data.cwd_contains, `${what}.cwd_contains`)
        : undefined,
    constraint:
      data.constraint !== undefined ? asString(data.constraint, `${what}.constraint`) : undefined,
  });
}

function parseRule(raw: unknown, what: string, defaultSeverity: Severity): HardRule | Pitfall {
  const data = asRecord(raw, what);
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error(`SOP YAML invalid: ${what}.id is required`);
  }
  if (typeof data.text !== 'string') {
    throw new Error(`SOP YAML invalid: ${what}.text is required`);
  }
  const severity =
    data.severity !== undefined ? (asString(data.severity, `${what}.severity`) as Severity) : defaultSeverity;
  return {
    id: data.id,
    text: data.text,
    severity,
    predicate: parsePredicateConfig(data.predicate, `${what}.predicate`),
  };
}

function parseStage(raw: unknown, what: string): SOPStage {
  const data = asRecord(raw, what);
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error(`SOP YAML invalid: ${what}.id is required`);
  }
  const hardRulesRaw = data.hard_rules;
  const pitfallsRaw = data.pitfalls;
  if (hardRulesRaw !== undefined && !Array.isArray(hardRulesRaw)) {
    throw new Error(`SOP YAML invalid: ${what}.hard_rules must be a list`);
  }
  if (pitfallsRaw !== undefined && !Array.isArray(pitfallsRaw)) {
    throw new Error(`SOP YAML invalid: ${what}.pitfalls must be a list`);
  }
  return makeSOPStage({
    id: data.id,
    label: data.label !== undefined ? asString(data.label, `${what}.label`) : undefined,
    suggestedSkill:
      data.suggested_skill !== undefined
        ? asString(data.suggested_skill, `${what}.suggested_skill`)
        : undefined,
    hardRules: hardRulesRaw?.map((r, i) => parseRule(r, `${what}.hard_rules[${i}]`, Severity.BLOCKER)),
    pitfalls: pitfallsRaw?.map((r, i) => parseRule(r, `${what}.pitfalls[${i}]`, Severity.WARN)),
    optional: data.optional !== undefined ? Boolean(data.optional) : undefined,
  });
}

/** 从解析后的 YAML 数据构造 SOPDefinition（对齐 SOPDefinition.model_validate） */
export function parseSopDefinition(raw: unknown): SOPDefinition {
  const data = asRecord(raw, 'SOP definition');
  if (typeof data.id !== 'string' || data.id.length === 0) {
    throw new Error('SOP YAML invalid: id is required');
  }
  const stagesRaw = data.stages;
  if (stagesRaw !== undefined && !Array.isArray(stagesRaw)) {
    throw new Error('SOP YAML invalid: stages must be a list');
  }
  return makeSOPDefinition({
    id: data.id,
    domain: data.domain !== undefined ? asString(data.domain, 'domain') : undefined,
    label: data.label !== undefined ? asString(data.label, 'label') : undefined,
    description:
      data.description !== undefined ? asString(data.description, 'description') : undefined,
    stages: stagesRaw?.map((s, i) => parseStage(s, `stages[${i}]`)),
  });
}

/** 从 YAML 文件加载 SOP 定义（对齐 load_sop_from_yaml） */
export async function loadSopFromYaml(yamlPath: string): Promise<SOPDefinition> {
  const text = await fs.readFile(resolve(yamlPath), 'utf-8');
  return parseSopDefinition(parseYaml(text));
}

/**
 * 从目录加载所有 SOP 定义（对齐 load_sops_from_dir）。
 *
 * 仅扫描 *.yaml（与 Python glob 一致），单个文件解析失败跳过不中断。
 */
export async function loadSopsFromDir(sopsDir: string): Promise<Map<string, SOPDefinition>> {
  const sops = new Map<string, SOPDefinition>();
  let entries: string[];
  try {
    entries = await fs.readdir(resolve(sopsDir));
  } catch {
    return sops;
  }
  for (const name of entries.sort()) {
    if (!name.endsWith('.yaml')) {
      continue;
    }
    try {
      const sop = await loadSopFromYaml(resolve(sopsDir, name));
      sops.set(sop.id, sop);
    } catch {
      // 对齐 Python：单文件失败仅记录，不中断目录加载
    }
  }
  return sops;
}

/** 目录内 yaml 文件名（不含扩展名），便于日志/诊断 */
export function sopFileName(yamlPath: string): string {
  return basename(yamlPath, '.yaml');
}

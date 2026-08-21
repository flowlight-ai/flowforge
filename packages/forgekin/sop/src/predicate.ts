/**
 * @flowforge/forgekin-sop — SOP 谓词检查器
 *
 * 对齐 Python `sop/predicate.py`：各类门禁检查的具体实现。
 * 每个检查器接收 PredicateConfig 并返回 PredicateResult；
 * PredicateChecker 按 type 字段路由到对应检查器，支持 register 扩展。
 *
 * TS 改造点（可注入测试设计）：
 * - 外部命令经 RunCommandFn 注入（默认 spawn 实现，30s 超时 kill）
 * - 环境变量经 env 注入（默认 process.env）
 * - 默认工作目录经 cwd 注入（默认 process.cwd()）
 * - command_pattern / command_sequence / handle_check / sha_dedup /
 *   feature_doc 五类检查器无上下文时先返回 passed=true + 提示，
 *   有上下文时在 check() 末尾经 applyContext 后处理重新评估（对齐
 *   Python `_apply_context`）
 */
import { spawn } from 'node:child_process';
import {
  makePredicateResult,
  PredicateConfig,
  PredicateContext,
  PredicateResult,
  PredicateType,
} from './models.js';

/** 命令执行结果（对齐 _run_command 三元组） */
export interface CommandOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 可注入的命令执行函数（对齐 _run_command 签名） */
export type RunCommandFn = (
  cmd: readonly string[],
  cwd: string | undefined,
  timeoutMs: number,
) => Promise<CommandOutcome>;

/** 默认命令执行器：spawn + 30s 超时 kill（对齐 _run_command） */
export function defaultRunCommand(
  cmd: readonly string[],
  cwd: string | undefined,
  timeoutMs: number,
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd;
    if (bin === undefined) {
      resolve({ code: -1, stdout: '', stderr: 'command execution failed: empty command' });
      return;
    }
    let child;
    try {
      child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (exc) {
      resolve({ code: -1, stdout: '', stderr: `command execution failed: ${exc}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      resolve({ code: -1, stdout: '', stderr: `command timed out after ${timeoutMs / 1000}s` });
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const message =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `command not found: ${err.message}`
          : `command execution failed: ${err.message}`;
      resolve({ code: -1, stdout: '', stderr: message });
    });
    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** 谓词检查器函数类型（对齐 PredicateCheckerFn） */
export type PredicateCheckerFn = (config: PredicateConfig) => Promise<PredicateResult>;

export interface PredicateCheckerOptions {
  /** 命令执行器（测试注入） */
  readonly runCommand?: RunCommandFn | undefined;
  /** 环境变量表（默认 process.env） */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  /** 默认工作目录（默认 process.cwd()） */
  readonly cwd?: string | undefined;
}

/**
 * 谓词检查器注册与分发（对齐 PredicateChecker）。
 *
 * 根据 PredicateConfig.type 路由到对应的 async 检查函数；
 * 支持 register 注册/覆盖自定义检查器以扩展新类型。
 */
export class PredicateChecker {
  readonly checkers = new Map<string, PredicateCheckerFn>();
  readonly runCommand: RunCommandFn;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;

  constructor(options: PredicateCheckerOptions = {}) {
    this.runCommand = options.runCommand ?? defaultRunCommand;
    this.env = options.env ?? process.env;
    this.cwd = options.cwd ?? process.cwd();
    this.registerDefaults();
  }

  /** 注册或覆盖一个谓词检查器（对齐 register） */
  register(predicateType: PredicateType | string, checker: PredicateCheckerFn): void {
    this.checkers.set(predicateType, checker);
  }

  /**
   * 执行谓词检查（对齐 check）。
   *
   * - 未注册 type → passed=false
   * - 检查器抛异常 → passed=false + exception evidence
   * - 提供非空 context 时对需要上下文的检查器进行后处理
   */
  async check(config: PredicateConfig, context?: PredicateContext): Promise<PredicateResult> {
    const checker = this.checkers.get(config.type);
    if (!checker) {
      return makePredicateResult({
        passed: false,
        message: `no checker registered for predicate type: ${config.type}`,
        evidence: { type: config.type },
      });
    }

    let result: PredicateResult;
    try {
      result = await checker(config);
    } catch (exc) {
      return makePredicateResult({
        passed: false,
        message: `checker exception: ${exc instanceof Error ? exc.message : String(exc)}`,
        evidence: {
          type: config.type,
          exception: exc instanceof Error ? exc.message : String(exc),
        },
      });
    }

    // Python `if context:` — 空对象视为无上下文，跳过 applyContext
    if (context && Object.keys(context).length > 0) {
      result = this.applyContext(config, result, context);
    }
    return result;
  }

  registerDefaults(): void {
    this.checkers.set(PredicateType.MANUAL_ONLY, (config) => this.checkManualOnly(config));
    this.checkers.set(PredicateType.GIT_STATE_PREDICATE, (config) => this.checkGitState(config));
    this.checkers.set(PredicateType.ENV_CHECK, (config) => this.checkEnv(config));
    this.checkers.set(PredicateType.COMMAND_PATTERN, (config) =>
      this.checkCommandPattern(config),
    );
    this.checkers.set(PredicateType.COMMAND_SEQUENCE, (config) =>
      this.checkCommandSequence(config),
    );
    this.checkers.set(PredicateType.HANDLE_CHECK, (config) => this.checkHandle(config));
    this.checkers.set(PredicateType.SHA_DEDUP, (config) => this.checkShaDedup(config));
    this.checkers.set(PredicateType.FEATURE_DOC_READINESS_CHECK, (config) =>
      this.checkFeatureDocReadiness(config),
    );
  }

  /** 手动检查 — 恒 passed=true，附 reason 说明（对齐 check_manual_only） */
  async checkManualOnly(config: PredicateConfig): Promise<PredicateResult> {
    const reason = config.reason || 'manual check required';
    return makePredicateResult({
      passed: true,
      message: `manual check: ${reason}`,
      evidence: { reason, automated: false },
    });
  }

  /**
   * 检查 git 仓库状态（对齐 check_git_state）。
   *
   * checks 项：ahead_zero / behind_zero / clean
   */
  async checkGitState(config: PredicateConfig): Promise<PredicateResult> {
    const branch = config.branch || 'main';
    const checks = config.checks.length > 0 ? [...config.checks] : ['ahead_zero', 'behind_zero'];
    const evidence: Record<string, unknown> = {
      branch,
      checks: [...checks],
      before_command: config.beforeCommand,
    };

    // 获取当前分支
    const rev = await this.runCommand(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], undefined, 30_000);
    if (rev.code !== 0) {
      return makePredicateResult({
        passed: false,
        message: `failed to get current branch: ${rev.stdout}`,
        evidence,
      });
    }
    const currentBranch = rev.stdout;
    evidence.current_branch = currentBranch;

    // 获取与远端的 ahead/behind 计数
    const counts = await this.runCommand(
      ['git', 'rev-list', '--left-right', '--count', `origin/${branch}...HEAD`],
      undefined,
      30_000,
    );
    let ahead = -1;
    let behind = -1;
    if (counts.code === 0) {
      const parts = counts.stdout.split(/\s+/).filter((p) => p.length > 0);
      const p0 = Number(parts[0]);
      const p1 = Number(parts[1]);
      if (parts.length >= 2 && Number.isInteger(p0) && Number.isInteger(p1)) {
        behind = p0;
        ahead = p1;
      }
    }
    evidence.ahead = ahead;
    evidence.behind = behind;

    // 检查工作区是否干净
    let clean: boolean | null = null;
    if (checks.includes('clean')) {
      const status = await this.runCommand(['git', 'status', '--porcelain'], undefined, 30_000);
      clean = status.code === 0 && status.stdout === '';
      evidence.clean = clean;
    }

    // 评估检查项
    const failures: string[] = [];
    if (checks.includes('ahead_zero') && ahead > 0) {
      failures.push(`branch is ahead of origin/${branch} by ${ahead} commits`);
    }
    if (checks.includes('behind_zero') && behind > 0) {
      failures.push(`branch is behind origin/${branch} by ${behind} commits`);
    }
    if (checks.includes('clean') && clean === false) {
      failures.push('working tree has uncommitted changes');
    }

    if (failures.length > 0) {
      return makePredicateResult({ passed: false, message: failures.join('; '), evidence });
    }
    return makePredicateResult({
      passed: true,
      message: `git state OK on branch ${currentBranch}`,
      evidence,
    });
  }

  /** 检查环境变量是否已设置（对齐 check_env） */
  async checkEnv(config: PredicateConfig): Promise<PredicateResult> {
    const envVars = config.envVars;
    if (envVars.length === 0) {
      return makePredicateResult({
        passed: true,
        message: 'no env vars to check',
        evidence: { checked: [] },
      });
    }

    const missing: string[] = [];
    const present: Record<string, boolean> = {};
    for (const name of envVars) {
      const value = this.env[name] ?? '';
      const isSet = value.length > 0;
      present[name] = isSet;
      if (!isSet) {
        missing.push(name);
      }
    }

    const evidence: Record<string, unknown> = { checked: envVars, present, missing };
    if (missing.length > 0) {
      return makePredicateResult({
        passed: false,
        message: `missing env vars: ${missing.join(', ')}`,
        evidence,
      });
    }
    return makePredicateResult({
      passed: true,
      message: `all ${envVars.length} env vars present`,
      evidence,
    });
  }

  /** 命令模式检查（静态段）— 无上下文时提示需要 last_command（对齐 check_command_pattern） */
  async checkCommandPattern(config: PredicateConfig): Promise<PredicateResult> {
    const evidence: Record<string, unknown> = {
      must_match: config.mustMatch,
      must_not_match: config.mustNotMatch,
    };
    if (!config.mustMatch && !config.mustNotMatch) {
      return makePredicateResult({ passed: true, message: 'no patterns to check', evidence });
    }
    return makePredicateResult({
      passed: true,
      message: 'command pattern check requires runtime context (last_command)',
      evidence,
    });
  }

  /** 命令序列检查（静态段）— 无上下文时提示需要 command_history（对齐 check_command_sequence） */
  async checkCommandSequence(config: PredicateConfig): Promise<PredicateResult> {
    const evidence: Record<string, unknown> = {
      must_include: [...config.mustInclude],
      anti_pattern: [...config.antiPattern],
      cwd_contains: config.cwdContains,
    };
    if (!config.mustInclude.length && !config.antiPattern.length && !config.cwdContains) {
      return makePredicateResult({
        passed: true,
        message: 'no sequence constraints to check',
        evidence,
      });
    }
    return makePredicateResult({
      passed: true,
      message: 'command sequence check requires runtime context (command_history)',
      evidence,
    });
  }

  /** handle 约束检查（静态段）（对齐 check_handle） */
  async checkHandle(config: PredicateConfig): Promise<PredicateResult> {
    const constraint = config.constraint;
    const evidence: Record<string, unknown> = { constraint };
    if (!constraint) {
      return makePredicateResult({
        passed: false,
        message: 'no handle constraint specified',
        evidence,
      });
    }
    if (constraint !== 'reviewer_not_author' && constraint !== 'guardian_handoff_present') {
      return makePredicateResult({
        passed: false,
        message: `unknown handle constraint: ${constraint}`,
        evidence,
      });
    }
    return makePredicateResult({
      passed: true,
      message: `handle check '${constraint}' requires runtime context (author/reviewer/guardian)`,
      evidence,
    });
  }

  /** SHA 去重检查（静态段）（对齐 check_sha_dedup） */
  async checkShaDedup(config: PredicateConfig): Promise<PredicateResult> {
    return makePredicateResult({
      passed: true,
      message: 'sha dedup check requires runtime context (current_sha, seen_shas)',
      evidence: { reason: config.reason || 'sha dedup check' },
    });
  }

  /** feature doc 准备就绪检查（静态段）（对齐 check_feature_doc_readiness） */
  async checkFeatureDocReadiness(config: PredicateConfig): Promise<PredicateResult> {
    return makePredicateResult({
      passed: true,
      message: 'feature doc readiness check requires runtime context (feature_doc)',
      evidence: { reason: config.reason || 'feature doc readiness check' },
    });
  }

  /** 对需要运行时上下文的检查结果进行后处理（对齐 _apply_context） */
  applyContext(
    config: PredicateConfig,
    result: PredicateResult,
    context: PredicateContext,
  ): PredicateResult {
    switch (config.type) {
      case PredicateType.COMMAND_PATTERN:
        return this.evaluateCommandPattern(config, result, context);
      case PredicateType.COMMAND_SEQUENCE:
        return this.evaluateCommandSequence(config, result, context);
      case PredicateType.HANDLE_CHECK:
        return this.evaluateHandleCheck(config, result, context);
      case PredicateType.SHA_DEDUP:
        return this.evaluateShaDedup(config, result, context);
      case PredicateType.FEATURE_DOC_READINESS_CHECK:
        return this.evaluateFeatureDoc(config, result, context);
      default:
        return result;
    }
  }

  /** 评估命令模式匹配（对齐 _evaluate_command_pattern） */
  evaluateCommandPattern(
    config: PredicateConfig,
    result: PredicateResult,
    context: PredicateContext,
  ): PredicateResult {
    const lastCommand = typeof context.last_command === 'string' ? context.last_command : '';
    const evidence: Record<string, unknown> = { ...result.evidence, last_command: lastCommand };

    if (!lastCommand) {
      return makePredicateResult({
        passed: false,
        message: 'command_pattern check failed: no last_command in context',
        evidence,
      });
    }

    if (config.mustMatch) {
      let matched = false;
      try {
        matched = new RegExp(config.mustMatch).test(lastCommand);
      } catch {
        return makePredicateResult({
          passed: false,
          message: `invalid must_match pattern: ${config.mustMatch}`,
          evidence,
        });
      }
      if (!matched) {
        return makePredicateResult({
          passed: false,
          message: `command '${lastCommand}' does not match required pattern: ${config.mustMatch}`,
          evidence,
        });
      }
    }

    if (config.mustNotMatch) {
      let matched = false;
      try {
        matched = new RegExp(config.mustNotMatch).test(lastCommand);
      } catch {
        return makePredicateResult({
          passed: false,
          message: `invalid must_not_match pattern: ${config.mustNotMatch}`,
          evidence,
        });
      }
      if (matched) {
        return makePredicateResult({
          passed: false,
          message: `command '${lastCommand}' matches forbidden pattern: ${config.mustNotMatch}`,
          evidence,
        });
      }
    }

    return makePredicateResult({
      passed: true,
      message: `command pattern OK: '${lastCommand}'`,
      evidence,
    });
  }

  /** 评估命令序列约束（对齐 _evaluate_command_sequence） */
  evaluateCommandSequence(
    config: PredicateConfig,
    result: PredicateResult,
    context: PredicateContext,
  ): PredicateResult {
    const commandHistory = Array.isArray(context.command_history)
      ? context.command_history.filter((c): c is string => typeof c === 'string')
      : [];
    const cwd = typeof context.cwd === 'string' ? context.cwd : this.cwd;
    const evidence: Record<string, unknown> = {
      ...result.evidence,
      command_history: commandHistory,
      cwd,
    };

    // cwd_contains 检查
    if (config.cwdContains && !cwd.includes(config.cwdContains)) {
      return makePredicateResult({
        passed: false,
        message: `cwd '${cwd}' does not contain '${config.cwdContains}'`,
        evidence,
      });
    }

    // must_include：所有命令都必须在历史中出现（子串匹配）
    if (config.mustInclude.length > 0) {
      const missing = config.mustInclude.filter(
        (cmd) => !commandHistory.some((hist) => hist.includes(cmd)),
      );
      if (missing.length > 0) {
        return makePredicateResult({
          passed: false,
          message: `command sequence missing required commands: ${JSON.stringify(missing)}`,
          evidence,
        });
      }
    }

    // anti_pattern：任一禁止命令出现即失败
    if (config.antiPattern.length > 0) {
      const violated = config.antiPattern.filter((cmd) =>
        commandHistory.some((hist) => hist.includes(cmd)),
      );
      if (violated.length > 0) {
        return makePredicateResult({
          passed: false,
          message: `command sequence contains forbidden commands: ${JSON.stringify(violated)}`,
          evidence,
        });
      }
    }

    return makePredicateResult({ passed: true, message: 'command sequence OK', evidence });
  }

  /** 评估 handle 约束（对齐 _evaluate_handle_check） */
  evaluateHandleCheck(
    config: PredicateConfig,
    result: PredicateResult,
    context: PredicateContext,
  ): PredicateResult {
    const author = typeof context.author === 'string' ? context.author : '';
    const reviewer = typeof context.reviewer === 'string' ? context.reviewer : '';
    const guardian = typeof context.guardian === 'string' ? context.guardian : '';
    const evidence: Record<string, unknown> = {
      ...result.evidence,
      author,
      reviewer,
      guardian,
    };

    if (config.constraint === 'reviewer_not_author') {
      if (!author || !reviewer) {
        return makePredicateResult({
          passed: false,
          message:
            'handle check reviewer_not_author requires both author and reviewer in context',
          evidence,
        });
      }
      if (reviewer === author) {
        return makePredicateResult({
          passed: false,
          message: `reviewer '${reviewer}' is the same as author '${author}'`,
          evidence,
        });
      }
      return makePredicateResult({
        passed: true,
        message: `reviewer '${reviewer}' is not author '${author}'`,
        evidence,
      });
    }

    if (config.constraint === 'guardian_handoff_present') {
      if (!guardian) {
        return makePredicateResult({
          passed: false,
          message: 'handle check guardian_handoff_present requires guardian in context',
          evidence,
        });
      }
      if (guardian === author) {
        return makePredicateResult({
          passed: false,
          message: `guardian '${guardian}' is the same as author '${author}'`,
          evidence,
        });
      }
      if (guardian === reviewer) {
        return makePredicateResult({
          passed: false,
          message: `guardian '${guardian}' is the same as reviewer '${reviewer}'`,
          evidence,
        });
      }
      return makePredicateResult({
        passed: true,
        message: `guardian '${guardian}' is independent of author and reviewer`,
        evidence,
      });
    }

    return result;
  }

  /** 评估 SHA 去重（对齐 _evaluate_sha_dedup） */
  evaluateShaDedup(
    _config: PredicateConfig,
    result: PredicateResult,
    context: PredicateContext,
  ): PredicateResult {
    const currentSha = typeof context.current_sha === 'string' ? context.current_sha : '';
    const seenShas = Array.isArray(context.seen_shas)
      ? context.seen_shas.filter((s): s is string => typeof s === 'string')
      : [];
    const evidence: Record<string, unknown> = {
      ...result.evidence,
      current_sha: currentSha,
      seen_shas: [...seenShas],
    };

    if (!currentSha) {
      return makePredicateResult({
        passed: false,
        message: 'sha_dedup check requires current_sha in context',
        evidence,
      });
    }
    if (seenShas.includes(currentSha)) {
      return makePredicateResult({
        passed: false,
        message: `current_sha '${currentSha}' has already been processed`,
        evidence,
      });
    }
    return makePredicateResult({
      passed: true,
      message: `current_sha '${currentSha}' is new`,
      evidence,
    });
  }

  /** 评估 feature doc 准备就绪（对齐 _evaluate_feature_doc） */
  evaluateFeatureDoc(
    _config: PredicateConfig,
    result: PredicateResult,
    context: PredicateContext,
  ): PredicateResult {
    const featureDoc: unknown = context.feature_doc ?? {};
    const isPlainObject =
      typeof featureDoc === 'object' && featureDoc !== null && !Array.isArray(featureDoc);
    const evidence: Record<string, unknown> = {
      ...result.evidence,
      feature_doc_keys: isPlainObject ? Object.keys(featureDoc) : [],
    };

    if (
      !featureDoc ||
      (isPlainObject && Object.keys(featureDoc as Record<string, unknown>).length === 0)
    ) {
      return makePredicateResult({
        passed: false,
        message: 'feature_doc_readiness_check requires feature_doc in context',
        evidence,
      });
    }
    if (!isPlainObject) {
      return makePredicateResult({
        passed: false,
        message: 'feature_doc must be a dict',
        evidence,
      });
    }

    const doc = featureDoc as Record<string, unknown>;
    const requiredKeys = ['acceptance_criteria', 'requirements'];
    const missing = requiredKeys.filter((k) => !(k in doc));
    if (missing.length > 0) {
      return makePredicateResult({
        passed: false,
        message: `feature_doc missing required keys: ${JSON.stringify(missing)}`,
        evidence,
      });
    }
    return makePredicateResult({ passed: true, message: 'feature doc is ready', evidence });
  }
}

/**
 * SelfDevLoopBase — 自进化闭环抽象基类（对齐 Python `evolution/self_dev_base.py` §3）。
 *
 * 五步循环：Discover→Plan→Act→Verify→Persist + Reflect 重试（I3 ≤3 次）。
 * 关键不变量（F046 §2.6）：
 * - I1 觉醒阶门控：doc/review/test=E3 / code=E4 / framework=E5
 * - I2 Scope Guard 前置检查：所有 Act 操作前必须通过（VISION.md/CONTRIBUTING.md/SOP.md/decisions/ 不可变）
 * - I3 Reflect 上限 3 次：Verify 失败后最多重试 3 次
 * - I4 LLM 审核必经（T7 铁律）：LLM 生成内容必须再调用 LLM 审核
 * - I8 Framework 需 approval：SelfDevFrameworkLoop 的所有 Act 必须 operator 显式批准
 */
import {
  DevPlan,
  DevResult,
  DevTask,
  LoopExecutionRecord,
  VerifyResult,
  makeDevPlan,
  makeLoopExecutionRecord,
} from './models.js';
import {
  AwakeningStageBlockedError,
  ScopeGuardBlockedError,
} from './errors.js';
import {
  LlmChatClient,
  PersistEngine,
} from './types.js';

/** Reflect 重试上限（I3） */
export const MAX_REFLECT_RETRIES = 3;

/** 觉醒阶顺序（spec.md §2.5）：E1 哑役阶 / E2 役使阶 / E3 受限自主阶 / E4 自主阶 / E5 完全自主阶 / E6 超越阶 */
export const AWAKENING_STAGE_ORDER = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];

/** 受保护路径白名单（I2 Scope Guard 前置检查；铁律：VISION/rules/核心 ADR 不可变） */
export const PROTECTED_PATH_PATTERNS = [
  'VISION.md',
  'CONTRIBUTING.md',
  'SOP.md',
  'decisions/', // 所有 ADR 不可变（新增 ADR 不在此限）
];

/** 闭环配置（红线 11：路径不硬编码，从 forgekinConfig 读取） */
export interface ForgekinConfig {
  /** 项目根目录（必须） */
  readonly projectRoot: string;
  /** Forgekin ID（审计用） */
  readonly forgekinId?: string | undefined;
  /** 受保护路径扩展白名单 */
  readonly protectedPaths?: string[] | undefined;
  /** 其余配置透传（docs_dir/max_age_days/approval_callback 等） */
  readonly [key: string]: unknown;
}

export interface SelfDevLoopOptions {
  readonly llmClient: LlmChatClient;
  readonly forgekinConfig: ForgekinConfig;
  readonly persistEngine?: PersistEngine | undefined;
  /** 当前可进化智能体觉醒阶（E1-E6） */
  readonly awakeningStage?: string | undefined;
}

export interface RunOnceSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly reflectTotal: number;
}

export interface RunOnceResult {
  readonly loopType: string;
  readonly records: LoopExecutionRecord[];
  readonly summary: RunOnceSummary;
}

export abstract class SelfDevLoopBase {
  /** 子类必须覆盖的类属性 */
  abstract readonly loopType: string; // "doc" | "code" | "framework" | "review" | "test"
  /** 子类按 F046 §2.2 覆盖：doc=E3 / code=E4 / framework=E5 / review=E3 / test=E3 */
  abstract readonly minAwakeningStage: string;

  protected readonly llmClient: LlmChatClient;
  protected readonly forgekinConfig: ForgekinConfig;
  protected readonly persistEngine: PersistEngine | undefined;
  protected readonly awakeningStage: string;
  protected readonly protectedPaths: string[];

  constructor(options: SelfDevLoopOptions) {
    if (options.llmClient === undefined || options.llmClient === null) {
      throw new Error('llmClient 不能为 null（红线 12：依赖注入）');
    }
    if (!options.forgekinConfig.projectRoot) {
      throw new Error('forgekinConfig 必须包含 projectRoot（红线 11：路径不硬编码）');
    }
    this.llmClient = options.llmClient;
    this.forgekinConfig = options.forgekinConfig;
    this.persistEngine = options.persistEngine;
    this.awakeningStage = options.awakeningStage ?? 'E3';
    this.protectedPaths = [...PROTECTED_PATH_PATTERNS, ...(options.forgekinConfig.protectedPaths ?? [])];
  }

  // ── 访问器 ──────────────────────────────────────────────────────

  get projectRoot(): string {
    return this.forgekinConfig.projectRoot;
  }

  // ── 抽象方法 — 子类必须实现 ─────────────────────────────────────

  /** 发现任务（返回 DevTask 列表，按优先级排序） */
  abstract discover(context: Record<string, unknown>): Promise<DevTask[]>;

  /** 设计方案（通常调用 LLM） */
  abstract plan(task: DevTask): Promise<DevPlan>;

  /** 执行修改（plan.requiresApproval=true 且未批准时抛 ApprovalRequiredError） */
  abstract act(plan: DevPlan): Promise<DevResult>;

  /** 验证效果 */
  abstract verify(result: DevResult): Promise<VerifyResult>;

  // ── 通用实现 — 五步循环框架 ─────────────────────────────────────

  /** I1 觉醒阶门控 — 检查当前可进化智能体觉醒阶是否达到闭环要求 */
  checkAwakeningStage(currentStage?: string | undefined): void {
    const stage = currentStage ?? this.awakeningStage;
    const currentIdx = AWAKENING_STAGE_ORDER.indexOf(stage);
    const requiredIdx = AWAKENING_STAGE_ORDER.indexOf(this.minAwakeningStage);
    if (currentIdx < 0 || requiredIdx < 0 || currentIdx < requiredIdx) {
      throw new AwakeningStageBlockedError(this.loopType, stage, this.minAwakeningStage);
    }
  }

  /**
   * I2 Scope Guard 前置检查 — 目标路径是否在受保护白名单中。
   * 特例（F046 §2.6 I2）：`decisions/` pattern 允许 create 操作（新增 ADR），阻止 update/delete。
   */
  preActScopeGuardCheck(task: DevTask, plan: DevPlan): void {
    // 检查 task.targetPath
    for (const pattern of this.protectedPaths) {
      if (pattern === 'decisions/' && task.modificationType === 'create') {
        continue; // 特例：decisions/ 允许 create 新 ADR
      }
      if (task.targetPath.includes(pattern)) {
        throw new ScopeGuardBlockedError(task.targetPath, `匹配受保护模式 ${JSON.stringify(pattern)}（VISION/rules/ADR 不可变）`);
      }
    }
    // 检查 plan.steps 中的所有 path 字段
    for (const step of plan.steps) {
      const stepPath = typeof step.path === 'string' ? step.path : '';
      const stepAction = typeof step.action === 'string' ? step.action : '';
      if (!stepPath) {
        continue;
      }
      for (const pattern of this.protectedPaths) {
        if (pattern === 'decisions/' && stepAction === 'create_adr') {
          continue; // 特例：decisions/ 允许 create_adr action
        }
        if (stepPath.includes(pattern)) {
          throw new ScopeGuardBlockedError(stepPath, `step 匹配受保护模式 ${JSON.stringify(pattern)}`);
        }
      }
    }
  }

  /**
   * I3 反思并重新规划 — 基于真实执行反馈生成新方案（默认走 LLM）。
   * LLM 失败时返回最小化修复方案（避免阻塞循环）。
   */
  async reflectAndReplan(task: DevTask, result: DevResult, verify: VerifyResult): Promise<DevPlan> {
    const failureReasons = verify.failureReasons.length > 0 ? verify.failureReasons : ['未提供具体失败原因'];
    const reflectPrompt = [
      '你是 FlowForge 自我演进的反思助手。请基于以下真实执行反馈重新设计修改方案.',
      '',
      '【原始任务】',
      `类型: ${task.loopType}`,
      `目标: ${task.targetPath}`,
      `描述: ${task.description}`,
      '',
      '【上次执行结果】',
      `成功: ${result.success}`,
      `变更文件: ${result.changedFiles.join(', ')}`,
      `diff 摘要: ${result.diffSummary}`,
      `错误: ${result.errorMessage}`,
      '',
      '【验证失败原因】',
      ...failureReasons.map((r) => `- ${r}`),
      '',
      '【请输出 JSON】',
      '{"steps": [{"action": "...", "params": {...}}], "expected_effect": "...", "risk_assessment": "..."}',
    ].join('\n');

    let content = '';
    let model = '';
    try {
      const llmResult = await this.llmClient.chat([
        { role: 'system', content: '你是专业的代码反思与方案重构助手.' },
        { role: 'user', content: reflectPrompt },
      ]);
      content = llmResult.content;
      model = llmResult.model ?? '';
    } catch {
      // LLM 失败时返回最小化的修复方案（避免阻塞循环）
      content = '{"steps": [], "expected_effect": "LLM 反思失败，待人工介入", "risk_assessment": "high"}';
      model = 'fallback';
    }

    const parsed = this.parseJsonLoose(content);
    return makeDevPlan({
      taskId: task.taskId,
      steps: Array.isArray(parsed?.steps) ? parsed.steps : [],
      expectedEffect: typeof parsed?.expected_effect === 'string' ? parsed.expected_effect : '反思后重新规划',
      riskAssessment: typeof parsed?.risk_assessment === 'string' ? parsed.risk_assessment : '待评估',
      requiresApproval: false,
      llmModel: model,
    });
  }

  /**
   * I4 LLM 审核（T7 铁律）— LLM 生成内容必须再调用 LLM 审核通过。
   * 返回 { passed, score, issues, suggestions }。
   */
  async llmReviewContent(content: string, contentType: string, reviewCriteria?: string | undefined): Promise<Record<string, unknown>> {
    const criteria = reviewCriteria ?? [
      '1. 内容是否准确无误（无虚构信息）',
      '2. 是否符合项目规范（命名/格式/分层）',
      '3. 是否有安全风险（硬编码/越权/绕过 DI）',
      '4. 是否有可维护性问题',
    ].join('\n');

    const reviewPrompt = [
      `你是 FlowForge 的 LLM 审核员。请审核以下 ${contentType} 内容是否符合标准.`,
      '',
      '【审核标准】',
      criteria,
      '',
      '【待审核内容】',
      content,
      '',
      '【请输出 JSON】',
      '{"passed": true|false, "score": 0.0-1.0, "issues": ["问题1"], "suggestions": ["建议1"]}',
    ].join('\n');

    let reviewContent = '';
    try {
      const llmResult = await this.llmClient.chat(
        [
          { role: 'system', content: '你是严格的内容审核员.' },
          { role: 'user', content: reviewPrompt },
        ],
        { temperature: 0.3 }, // 审核需要确定性
      );
      reviewContent = llmResult.content;
    } catch (e) {
      return {
        passed: false,
        score: 0.0,
        issues: [`LLM 审核调用失败: ${e instanceof Error ? e.message : String(e)}`],
        suggestions: [],
      };
    }

    const parsed = this.parseJsonLoose(reviewContent);
    if (parsed === null || typeof parsed !== 'object') {
      return { passed: false, score: 0.0, issues: ['审核响应解析失败'], suggestions: [] };
    }
    return {
      passed: parsed.passed === true,
      score: typeof parsed.score === 'number' ? parsed.score : 0.0,
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
    };
  }

  /**
   * 沉淀经验到治理层（ForgeMindEngine 三模式）：
   * - knowledge_evolution.create_episode_card → EpisodeCard（L0 原始记录）
   * - knowledge_evolution.distill_episode → MethodCard（Verify 通过时）
   * - process_evolution.create_proposal → 流程改进提案（Reflect ≥2 次时）
   */
  async persist(record: LoopExecutionRecord): Promise<Record<string, unknown>> {
    if (this.persistEngine === undefined) {
      record.persistPayload = { skipped: true, reason: '未注入 persistEngine' };
      return record.persistPayload;
    }
    try {
      const lastResult = record.resultsHistory.at(-1);
      const episodeResult = await this.persistEngine.execute({
        mode: 'knowledge_evolution',
        action: 'create_episode_card',
        payload: {
          taskSnapshot: `[${record.loopType}] ${record.task.modificationType} ${record.task.targetPath}: ${record.task.description}`,
          evidenceMap: {
            verifyPassed: record.finalPassed,
            reflectCount: record.reflectCount,
            changedFiles: lastResult?.changedFiles ?? [],
          },
          decisionTimeline: record.plansHistory.map((p) => ({
            step: 'plan',
            expectedEffect: p.expectedEffect,
            riskAssessment: p.riskAssessment,
          })),
          transferableMethod: this.extractTransferableMethod(record),
          nonTransferableFacts: record.task.targetPath,
          safetyBoundary: `觉醒阶门控 ${this.minAwakeningStage}；Scope Guard 前置检查通过`,
          distillationDirection: record.finalPassed ? 'method_card' : 'memory',
        },
      });
      const episodeId = typeof episodeResult.episode_id === 'string' ? episodeResult.episode_id : '';

      let methodId: string | undefined;
      if (record.finalPassed && episodeId) {
        const distillResult = await this.persistEngine.execute({
          mode: 'knowledge_evolution',
          action: 'distill_episode',
          payload: { episodeId },
        });
        if (typeof distillResult.method_id === 'string') {
          methodId = distillResult.method_id;
        }
      }

      let proposalId: string | undefined;
      // Reflect 次数 ≥ 2 时提交流程改进提案（同类错误反复出现）
      if (record.reflectCount >= 2) {
        const proposalResult = await this.persistEngine.execute({
          mode: 'process_evolution',
          action: 'create_proposal',
          payload: {
            triggerType: 'repeated_error',
            trigger: `${record.loopType} 闭环 Reflect ${record.reflectCount} 次才通过`,
            evidence: [
              `task_id=${record.task.taskId}`,
              `failure_reasons=${record.verifiesHistory[0]?.failureReasons ?? []}`,
            ],
            rootCause: 'Plan 阶段方案不够稳健，需改进提示词或上下文构造',
            lever: 'memory',
            verify: '下次同类任务 Reflect 次数 ≤ 1',
            target: 'sop',
          },
        });
        if (typeof proposalResult.proposal_id === 'string') {
          proposalId = proposalResult.proposal_id;
        }
      }

      record.persisted = true;
      record.persistPayload = { episodeId, methodId, proposalId };
      return record.persistPayload;
    } catch (e) {
      record.persistPayload = { error: e instanceof Error ? e.message : String(e) };
      return record.persistPayload;
    }
  }

  /** 从执行记录中提取可迁移方法（子类可覆盖） */
  protected extractTransferableMethod(record: LoopExecutionRecord): string {
    const lastResult = record.resultsHistory.at(-1);
    if (!lastResult) {
      return '';
    }
    if (record.finalPassed) {
      return `${record.loopType} 闭环成功执行 ${record.task.modificationType} 操作：${lastResult.diffSummary.slice(0, 200)}`;
    }
    return `${record.loopType} 闭环失败：${lastResult.errorMessage.slice(0, 200)}`;
  }

  /** 宽松 JSON 解析（支持 ```json 代码块包裹） */
  protected parseJsonLoose(content: string): Record<string, unknown> | null {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (parsed !== null && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 非 JSON 响应：返回 null
    }
    return null;
  }

  /**
   * 执行一次完整的五步循环（Discover→Plan→Act→Verify→Persist）。
   * context 支持 awakening_stage 覆盖当前觉醒阶。
   */
  async runOnce(context: Record<string, unknown>): Promise<RunOnceResult> {
    // I1 觉醒阶门控前置检查
    const stageOverride = typeof context.awakening_stage === 'string' ? context.awakening_stage : undefined;
    this.checkAwakeningStage(stageOverride);

    // Step 1: Discover
    const tasks = await this.discover(context);

    const records: LoopExecutionRecord[] = [];
    let passedCount = 0;
    let failedCount = 0;
    let reflectTotal = 0;

    for (const task of tasks) {
      const plan = await this.plan(task);

      // I2 Scope Guard 前置检查（act 前）
      try {
        this.preActScopeGuardCheck(task, plan);
      } catch (e) {
        if (e instanceof ScopeGuardBlockedError) {
          records.push(makeLoopExecutionRecord({
            loopType: this.loopType,
            task,
            plansHistory: [plan],
            finalPassed: false,
            finishedAt: new Date().toISOString(),
          }));
          failedCount += 1;
          continue;
        }
        throw e;
      }

      // Step 3-4: Act → Verify，含 I3 Reflect 重试
      let result = await this.act(plan);
      let verify = await this.verify(result);

      const record = makeLoopExecutionRecord({
        loopType: this.loopType,
        task,
        plansHistory: [plan],
        resultsHistory: [result],
        verifiesHistory: [verify],
      });

      let retries = 0;
      while (!verify.passed && retries < MAX_REFLECT_RETRIES) {
        retries += 1;
        const newPlan = await this.reflectAndReplan(task, result, verify);

        // Reflect 后的新 plan 也要通过 Scope Guard
        try {
          this.preActScopeGuardCheck(task, newPlan);
        } catch (e) {
          if (e instanceof ScopeGuardBlockedError) {
            record.plansHistory.push(newPlan);
            record.finalPassed = false;
            record.reflectCount = retries;
            record.finishedAt = new Date().toISOString();
            records.push(record);
            failedCount += 1;
            reflectTotal += retries;
            break;
          }
          throw e;
        }

        const newResult = await this.act(newPlan);
        const newVerify = await this.verify(newResult);

        record.plansHistory.push(newPlan);
        record.resultsHistory.push(newResult);
        record.verifiesHistory.push(newVerify);

        result = newResult;
        verify = newVerify;
        if (verify.passed) {
          break;
        }
      }

      // while 因 retries 耗尽正常退出（未 break 且未通过）：记录失败
      if (record.finishedAt === undefined) {
        record.reflectCount = retries;
        record.finalPassed = verify.passed;
        record.finishedAt = new Date().toISOString();

        // Step 5: Persist 沉淀经验
        try {
          await this.persist(record);
        } catch {
          // Persist 失败不阻塞循环
        }

        records.push(record);
        if (verify.passed) {
          passedCount += 1;
        } else {
          failedCount += 1;
        }
        reflectTotal += retries;
      }
    }

    return {
      loopType: this.loopType,
      records,
      summary: { total: records.length, passed: passedCount, failed: failedCount, reflectTotal },
    };
  }
}

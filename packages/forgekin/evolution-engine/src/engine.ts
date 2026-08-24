/**
 * ForgeMind Engine — 统一管理三模式自我进化（v7.0 Forge Nurturing 体系主引擎）。
 * TS 重写自 Python `evolution/engine.py`（ADR-012：SelfEvolutionEngine → ForgeMindEngine）。
 *
 * 集成 Scope Guard (Mode A) + Process Evolution (Mode B) + Knowledge Evolution (Mode C)，
 * 共享五级知识成熟度阶梯（@flowforge/forgekin-stage）和元认知路由。
 *
 * 三模式分工：
 * - Mode A (Scope Guard): 防御 — 偏离愿景时温柔提醒
 * - Mode B (Process Evolution): 防御→改进 — 同类错误反复出现时提流程改进
 * - Mode C (Knowledge Evolution): 进攻→成长 — 有价值知识沉淀为可复用资产
 *
 * 治理层（三模式）与执行层（SelfDev 闭环）解耦：
 * 执行层通过 registerSelfDevLoop 注入（红线 9：不硬编码子类；红线 12：DI）。
 */

import type { SelfDevLoopBase } from '@flowforge/forgekin-loops';
import { KnowledgeEvolution } from '@flowforge/forgekin-knowledge';
import {
  KnowledgeMaturityLadder,
  type MaturityLevel,
  type PromotionUsageData,
} from '@flowforge/forgekin-stage';
import {
  MetacognitionRouter,
  type RouteConfidenceResult,
} from './metacognition.js';
import { ProcessEvolution } from './process-evolution.js';
import { ScopeGuard } from './scope-guard.js';
import type { EvolutionProposal } from './models.js';

/** 评估上下文（snake_case 字段对齐 Python evaluate(context) 契约）。 */
export interface EvaluateContext {
  mode?: 'scope_guard' | 'process_evolution' | 'knowledge_evolution' | 'auto';
  scope_guard?: {
    current_vision?: string;
    new_idea?: string;
    current_ac?: string[];
    feature_id?: string;
    agent?: string;
  };
  process_evolution?: {
    error_history?: Record<string, unknown>[];
    user_corrections?: Array<{ generalizable?: boolean }>;
    sop_gaps?: string[];
    review_findings?: Array<{ systemic?: boolean }>;
  };
  knowledge_evolution?: {
    reusability?: boolean;
    non_obviousness?: boolean;
    decay_risk?: boolean;
    episode_data?: Record<string, unknown>;
  };
  metacognition?: {
    successes?: number;
    trials?: number;
    evidence_completeness?: number;
    self_reported?: number;
    is_high_risk?: boolean;
  };
}

/** 建议动作：{mode, action, payload}。 */
export interface SuggestedAction {
  readonly mode: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
}

/** evaluate() 返回结构。 */
export interface EvaluateResult {
  readonly suggested_actions: SuggestedAction[];
  readonly meta: {
    readonly mode: string;
    readonly evaluated_at: string;
    readonly actions_count: number;
    readonly metacognition_route: RouteConfidenceResult | null;
  };
}

/** execute(action) 入参。 */
export interface EvolutionAction {
  readonly mode: string;
  readonly action: string;
  readonly payload?: Record<string, unknown>;
}

export interface ForgeMindEngineOptions {
  /** Mode C 蒸馏引擎（缺省新建；DI 注入 forgekin-knowledge 实例可跨域共享） */
  readonly knowledgeEvolution?: KnowledgeEvolution | undefined;
  /** 成熟度阶梯（缺省新建） */
  readonly maturityLadder?: KnowledgeMaturityLadder | undefined;
  /** Scope Guard（缺省新建） */
  readonly scopeGuard?: ScopeGuard | undefined;
  /** Process Evolution（缺省新建） */
  readonly processEvolution?: ProcessEvolution | undefined;
  /** 元认知路由（缺省新建） */
  readonly metacognition?: MetacognitionRouter | undefined;
}

/**
 * ForgeMind Engine — 统一管理三模式自我进化。
 *
 * evaluate(context) 评估上下文返回建议动作；execute(action) 执行动作；
 * registerSelfDevLoop/runSelfDevLoop 为 F046 SelfDev 三闭环执行层集成入口。
 */
export class ForgeMindEngine {
  readonly scopeGuard: ScopeGuard;
  readonly processEvolution: ProcessEvolution;
  readonly knowledgeEvolution: KnowledgeEvolution;
  readonly maturityLadder: KnowledgeMaturityLadder;
  readonly metacognition: MetacognitionRouter;
  /** F046 SelfDev 三闭环执行层（按 loopType 注册，避免硬编码子类 — 红线 9） */
  private readonly selfDevLoops = new Map<string, SelfDevLoopBase>();

  constructor(options: ForgeMindEngineOptions = {}) {
    this.scopeGuard = options.scopeGuard ?? new ScopeGuard();
    this.processEvolution = options.processEvolution ?? new ProcessEvolution();
    this.knowledgeEvolution = options.knowledgeEvolution ?? (new KnowledgeEvolution());
    this.maturityLadder = options.maturityLadder ?? new KnowledgeMaturityLadder();
    this.metacognition = options.metacognition ?? new MetacognitionRouter();
  }

  /**
   * 评估当前上下文，返回建议动作。
   *
   * mode 为 "auto"（默认）时依次评估三模式；
   * context.metacognition 存在时附加元认知路由结果。
   */
  async evaluate(context: EvaluateContext): Promise<EvaluateResult> {
    const mode = context.mode ?? 'auto';
    const actions: SuggestedAction[] = [];

    if (mode === 'scope_guard' || mode === 'auto') {
      actions.push(...this.evaluateScopeGuard(context));
    }

    if (mode === 'process_evolution' || mode === 'auto') {
      actions.push(...(await this.evaluateProcessEvolution(context)));
    }

    if (mode === 'knowledge_evolution' || mode === 'auto') {
      actions.push(...this.evaluateKnowledgeEvolution(context));
    }

    let metaRoute: RouteConfidenceResult | null = null;
    const mcCtx = context.metacognition;
    if (mcCtx) {
      metaRoute = this.evaluateMetacognition(mcCtx);
    }

    return {
      suggested_actions: actions,
      meta: {
        mode,
        evaluated_at: new Date().toISOString(),
        actions_count: actions.length,
        metacognition_route: metaRoute,
      },
    };
  }

  /** 执行建议动作（按 mode 分发；未知 mode 返回 error）。 */
  async execute(action: EvolutionAction): Promise<Record<string, unknown>> {
    const payload = action.payload ?? {};
    if (action.mode === 'scope_guard') {
      return this.executeScopeGuard(action.action, payload);
    }
    if (action.mode === 'process_evolution') {
      return this.executeProcessEvolution(action.action, payload);
    }
    if (action.mode === 'knowledge_evolution') {
      return this.executeKnowledgeEvolution(action.action, payload);
    }
    return { status: 'error', reason: `unknown mode '${action.mode}'` };
  }

  // ── SelfDev 三闭环（F046 执行层） ──────────────────────────────

  /**
   * 注册 SelfDev 闭环实例（DI 注入，红线 12）。
   *
   * 治理层不硬编码导入 SelfDevDoc/Code/Framework 子类（红线 9），
   * 子类实例通过本方法注入，按 loopType 索引。
   *
   * @throws loopType 为空或已注册时抛错（禁止重复注册）。
   */
  registerSelfDevLoop(loop: SelfDevLoopBase): void {
    const loopType = loop.loopType;
    if (!loopType) {
      throw new Error('SelfDev 闭环实例必须设置 loopType 类属性');
    }
    if (this.selfDevLoops.has(loopType)) {
      throw new Error(`SelfDev 闭环 '${loopType}' 已注册（禁止重复注册）`);
    }
    this.selfDevLoops.set(loopType, loop);
  }

  /** 获取已注册的 SelfDev 闭环实例。 */
  getSelfDevLoop(loopType: string): SelfDevLoopBase | null {
    return this.selfDevLoops.get(loopType) ?? null;
  }

  /** 列出所有已注册的 SelfDev 闭环（loopType -> minAwakeningStage）。 */
  listSelfDevLoops(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [loopType, loop] of this.selfDevLoops) {
      result[loopType] = loop.minAwakeningStage;
    }
    return result;
  }

  /**
   * 运行指定类型的 SelfDev 闭环（F046 §3 Phase 5 集成入口）。
   *
   * 觉醒阶门控由 SelfDevLoopBase.checkAwakeningStage 内部执行（I1）；
   * 若可进化智能体觉醒阶低于闭环要求，抛出 AwakeningStageBlockedError。
   *
   * @throws loopType 未注册时抛错。
   */
  async runSelfDevLoop(
    loopType: string,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    const loop = this.selfDevLoops.get(loopType);
    if (loop === undefined) {
      throw new Error(
        `SelfDev 闭环 '${loopType}' 未注册（请先调用 registerSelfDevLoop）`,
      );
    }
    return loop.runOnce(context);
  }

  // ── Mode A: Scope Guard ────────────────────────────────────────

  private evaluateScopeGuard(context: EvaluateContext): SuggestedAction[] {
    const sgCtx = context.scope_guard;
    if (!sgCtx) {
      return [];
    }
    const vision = sgCtx.current_vision ?? '';
    const newIdea = sgCtx.new_idea ?? '';
    const currentAc = sgCtx.current_ac ?? [];
    const featureId = sgCtx.feature_id ?? '';

    const signals = this.scopeGuard.detectSignals(vision, newIdea, currentAc);
    // 触发条件：2 个普通信号或 1 个强信号
    const strong = signals.filter((s) => s !== 'not_serving_vision');
    const normal = signals.filter((s) => s === 'not_serving_vision');
    const triggered = strong.length >= 1 || normal.length >= 2;

    if (!triggered) {
      return [];
    }

    const actions: SuggestedAction[] = [
      {
        mode: 'scope_guard',
        action: 'remind',
        payload: {
          feature_id: featureId,
          signals,
          vision,
          new_direction: newIdea,
        },
      },
    ];
    if (this.scopeGuard.checkDivergencePattern(featureId)) {
      actions.push({
        mode: 'scope_guard',
        action: 'suggest_split_feat',
        payload: { feature_id: featureId },
      });
    }
    return actions;
  }

  private executeScopeGuard(
    actionName: string,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (actionName === 'remind') {
      const featureId = String(payload['feature_id'] ?? '');
      if (!this.scopeGuard.shouldRemind(featureId)) {
        return { status: 'skipped', reason: 'max reminds reached for phase' };
      }
      const count = this.scopeGuard.getPhaseTriggerCount(featureId) + 1;
      const reminder = this.scopeGuard.generateReminder(
        String(payload['vision'] ?? ''),
        String(payload['new_direction'] ?? ''),
        count,
      );
      this.scopeGuard.logTrigger({
        featureId,
        signalType: Array.isArray(payload['signals'])
          ? (payload['signals'] as string[]).join(',')
          : String(payload['signals'] ?? ''),
        action: 'remind',
        outcome: reminder,
        agent: 'scope_guard',
      });
      return { status: 'ok', reminder };
    }
    if (actionName === 'suggest_split_feat') {
      const featureId = String(payload['feature_id'] ?? '');
      return {
        status: 'ok',
        suggestion: `feat ${featureId} 触发 ≥3 次偏离，建议拆分`,
      };
    }
    return { status: 'error', reason: `unknown scope_guard action '${actionName}'` };
  }

  // ── Mode B: Process Evolution ──────────────────────────────────

  private async evaluateProcessEvolution(
    context: EvaluateContext,
  ): Promise<SuggestedAction[]> {
    const peCtx = context.process_evolution;
    if (!peCtx) {
      return [];
    }
    const triggerType = this.processEvolution.detectTrigger({
      errorHistory: peCtx.error_history ?? [],
      userCorrections: peCtx.user_corrections ?? [],
      sopGaps: peCtx.sop_gaps ?? [],
      reviewFindings: peCtx.review_findings ?? [],
    });
    if (triggerType === null) {
      return [];
    }
    return [
      {
        mode: 'process_evolution',
        action: 'create_proposal',
        payload: { trigger_type: triggerType },
      },
    ];
  }

  private executeProcessEvolution(
    actionName: string,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (actionName === 'create_proposal') {
      const triggerType = String(payload['trigger_type'] ?? '');
      const proposal = this.processEvolution.createProposal({
        triggerType,
        trigger: String(payload['trigger'] ?? ''),
        evidence: Array.isArray(payload['evidence'])
          ? (payload['evidence'] as string[])
          : [],
        rootCause: String(payload['root_cause'] ?? ''),
        lever: String(payload['lever'] ?? 'memory'),
        verify: String(payload['verify'] ?? ''),
        target: String(payload['target'] ?? ''),
      });
      const { valid, errors } = this.processEvolution.validateProposal(proposal);
      return {
        status: valid ? 'ok' : 'validation_failed',
        proposal_id: proposal.proposalId,
        validation_errors: errors,
      };
    }
    if (actionName === 'accept_proposal') {
      const proposalId = String(payload['proposal_id'] ?? '');
      const proposal = this.processEvolution.acceptProposal(
        proposalId,
        String(payload['commit_ref'] ?? ''),
      );
      if (proposal === null) {
        return {
          status: 'error',
          reason: 'proposal not found or not in proposed status',
        };
      }
      this.processEvolution.scheduleReplayCheck(proposalId);
      return { status: 'ok', proposal_id: proposal.proposalId };
    }
    return { status: 'error', reason: `unknown process_evolution action '${actionName}'` };
  }

  // ── Mode C: Knowledge Evolution ────────────────────────────────

  private evaluateKnowledgeEvolution(context: EvaluateContext): SuggestedAction[] {
    const keCtx = context.knowledge_evolution;
    if (!keCtx) {
      return [];
    }
    const should = this.knowledgeEvolution.shouldDistill(
      keCtx.reusability ?? false,
      keCtx.non_obviousness ?? false,
      keCtx.decay_risk ?? false,
    );
    if (!should) {
      return [];
    }
    return [
      {
        mode: 'knowledge_evolution',
        action: 'create_episode_card',
        payload: keCtx.episode_data ?? {},
      },
    ];
  }

  private executeKnowledgeEvolution(
    actionName: string,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (actionName === 'create_episode_card') {
      const episode = this.knowledgeEvolution.createEpisodeCard({
        taskSnapshot: String(payload['task_snapshot'] ?? ''),
        evidenceMap: (payload['evidence_map'] as Record<string, unknown>) ?? {},
        decisionTimeline: (payload['decision_timeline'] as Record<string, unknown>[]) ?? [],
        collaborationPivots: (payload['collaboration_pivots'] as Record<string, unknown>[]) ?? [],
        transferableMethod: String(payload['transferable_method'] ?? ''),
        nonTransferableFacts: String(payload['non_transferable_facts'] ?? ''),
        safetyBoundary: String(payload['safety_boundary'] ?? ''),
        distillationDirection: (payload['distillation_direction'] as
          | 'method_card'
          | 'skill_draft'
          | 'memory'
          | undefined) ?? 'method_card',
      });
      return { status: 'ok', episode_id: episode.episodeId };
    }
    if (actionName === 'distill_episode') {
      const episodeId = String(payload['episode_id'] ?? '');
      const result = this.knowledgeEvolution.distillEpisode(episodeId);
      if (typeof result === 'string') {
        return { status: 'ok', direction: result };
      }
      return { status: 'ok', method_id: result.methodId };
    }
    return {
      status: 'error',
      reason: `unknown knowledge_evolution action '${actionName}'`,
    };
  }

  // ── Metacognition ──────────────────────────────────────────────

  private evaluateMetacognition(mcCtx: NonNullable<EvaluateContext['metacognition']>): RouteConfidenceResult {
    const successes = mcCtx.successes ?? 0;
    const trials = mcCtx.trials ?? 0;
    const isHighRisk = mcCtx.is_high_risk ?? false;

    // 高风险域用 Wilson 下界，否则用 Laplace 平滑可靠度
    const dr = isHighRisk
      ? this.metacognition.computeWilsonLowerBound(successes, trials)
      : this.metacognition.computeDomainReliability(successes, trials);

    return this.metacognition.routeConfidence({
      domainReliability: dr,
      evidenceCompleteness: mcCtx.evidence_completeness ?? 0.0,
      selfReported: mcCtx.self_reported ?? 0.0,
      isHighRisk,
    });
  }

  // ── 成熟度辅助 ─────────────────────────────────────────────────

  /** 检查知识对象的成熟度晋升（同步，无 I/O）。 */
  checkMaturityPromotion(
    knowledgeId: string,
    currentLevel: MaturityLevel,
    usageData: PromotionUsageData,
  ): MaturityLevel | null {
    return this.maturityLadder.checkPromotion(knowledgeId, currentLevel, usageData);
  }

  /** 检查知识对象的成熟度降级（同步，无 I/O）。 */
  checkMaturityDemotion(
    knowledgeId: string,
    currentLevel: MaturityLevel,
    recentPerformance: boolean[],
  ): MaturityLevel | null {
    return this.maturityLadder.checkDemotion(knowledgeId, currentLevel, recentPerformance);
  }

  /** 读取提案列表（透传 Mode B 存储，供 service/operator 查询）。 */
  getProposals(status?: string): EvolutionProposal[] {
    return this.processEvolution.getProposals(status);
  }
}

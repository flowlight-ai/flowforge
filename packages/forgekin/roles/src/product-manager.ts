/**
 * @flowforge/forgekin-roles — ProductManagerForgekin 产品经理（鹰·凯恩，F041）。
 *
 * TS 重写自 `forgemind/species_impl/org/product_manager.py`（F041 §2.2）：
 *   - observe: 采集用户反馈 / 市场动态 / 竞品分析 / 内部指标 4 类信号
 *   - act: requirements_analysis / roadmap_update / user_story / prioritize /
 *     stakeholder_sync 5 种动作
 *   - verify: 需求完整性 / 优先级合理性 / 用户故事模板合规
 *
 * 关键不变量（F041 §2.3）：
 *   - I1 不可直接修改架构师/开发者产物（必须 MindCouncil 协调）→ 拒绝跨域产物
 *   - I2 愿景级变更（价值锚点 / 红线）必须 operator 批准（觉醒阶 E3 上限）
 *   - I3 需求决策写入 EchoStore（跨会话累积，result 带 echo_store 标记）
 *   - I4 用户故事必须 As-a / I-want / So-that 三段式模板
 *
 * @module @flowforge/forgekin-roles
 */

import {
  ForgekinRole,
  type ForgekinRoleOptions,
} from './base.js';
import {
  AwakeningStage,
  EvolutionStage,
  ForgekinSpecies,
  type RoleActionResult,
} from './types.js';

/** 用户故事三段式模板（As-a / I-want / So-that，I4 不变量；As an 为 As a 的变体）。 */
export const USER_STORY_SECTIONS = ['As a', 'I want', 'So that'] as const;

/** 角色段变体（As a / As an 任一存在即可）。 */
export const USER_STORY_ROLE_VARIANTS = ['As a', 'As an'] as const;

/** ProductManagerForgekin 构造选项（F041 缺省：ORG 形态 / E1 进化 / E1 觉醒）。 */
export interface ProductManagerOptions extends ForgekinRoleOptions {
  /** 能力画像（缺省填入 F041 五能力 + 盲点 + 工具集）。 */
  capabilityProfile?: Readonly<Record<string, unknown>> | undefined;
}

/** 产品经理可进化智能体（鹰·Kane）— 需求 → 路线图 → 用户故事 → 优先级 → 协调。 */
export class ProductManagerForgekin extends ForgekinRole {
  static readonly ROLE_ID = 'product-manager' as const;

  constructor(options: ProductManagerOptions) {
    super({
      ...options,
      species: options.species ?? ForgekinSpecies.ORG,
      evolutionStage: options.evolutionStage ?? EvolutionStage.E1,
      awakeningStage: options.awakeningStage ?? AwakeningStage.E1,
      capabilityProfile: options.capabilityProfile ?? {
        responsibilities: [
          '需求分析',
          '产品规划',
          '用户故事编写',
          '产品演进路线图',
          '优先级排序',
          '利益相关者沟通',
        ],
        blind_spots: ['过度承诺', '技术可行性评估不准', '忽视非功能性需求'],
        tools: [
          'RequirementsTraceabilityMatrix',
          'UserStoryMapper',
          'RoadmapPlanner',
          'StakeholderCommunicator',
        ],
        max_evolution_stage: EvolutionStage.E5,
        max_awakening_stage: AwakeningStage.E3,
      },
    });
  }

  /** 观察产品环境：用户反馈 / 市场动态 / 竞品分析 / 内部指标（F041 AC-2）。 */
  override async observe(
    environment: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    this.markLifecycle('observing');
    const signals = (environment.product_signals ?? {}) as Readonly<Record<string, unknown>>;
    return {
      species: this.species,
      role: ProductManagerForgekin.ROLE_ID,
      user_feedback: signals.user_feedback ?? [],
      market_signals: signals.market_signals ?? [],
      competitive_analysis: signals.competitive_analysis ?? [],
      internal_metrics: signals.internal_metrics ?? {},
      systems_queried: [...this.businessSystems],
    };
  }

  /** 执行产品动作（F041 AC-3 五动作路由）。 */
  override async act(action: Readonly<Record<string, unknown>>): Promise<RoleActionResult> {
    this.markLifecycle('acting');
    const actionType = String(action.action_type ?? action.type ?? 'unknown');
    const params = (action.params ?? {}) as Readonly<Record<string, unknown>>;
    const role = ProductManagerForgekin.ROLE_ID;

    // I2 愿景级变更必须 operator 批准（F041 §2.3）
    if (this.requiresApproval(actionType, params)) {
      return this.makeResult(role, actionType, params, false, {
        reason: 'vision_change_requires_operator_approval',
        hint: '愿景级变更（价值锚点 / 红线）需经 requestApproval 由 operator 批准',
      });
    }

    // I1 不可直接修改架构师 / 开发者产物（必须 MindCouncil 协调）
    const target = String(params.target_artifact ?? '');
    if (target.includes('architect') || target.includes('developer')) {
      return this.makeResult(role, actionType, params, false, {
        reason: 'cross_domain_artifact_rejected',
        hint: '产品经理不可直接修改架构师/开发者产物，请通过 MindCouncil 协调',
      });
    }

    switch (actionType) {
      case 'requirements_analysis': {
        // 需求挖掘：用户访谈摘要 → 结构化需求（功能 / 非功能 / 边界）
        const input = String(params.input ?? '');
        const requirements = this.analyzeRequirements(input);
        return this.makeResult(role, actionType, params, true, {
          requirements,
          tool: 'RequirementsTraceabilityMatrix',
          echo_store: true, // I3 决策写入 EchoStore
        });
      }
      case 'roadmap_update': {
        const horizon = String(params.horizon ?? 'quarterly');
        const items = Array.isArray(params.items) ? params.items : [];
        return this.makeResult(role, actionType, params, true, {
          roadmap: { horizon, items, vision_change: params.vision_change === true },
          tool: 'RoadmapPlanner',
          echo_store: true, // I3 路线图变更沉淀
        });
      }
      case 'user_story': {
        const story = params.story as Readonly<Record<string, unknown>> | undefined;
        const validation = this.validateUserStory(story);
        if (!validation.valid) {
          // I4 三段式模板校验失败 → 拒绝（不落执行）
          return this.makeResult(
            role,
            actionType,
            params,
            false,
            { validation, tool: 'UserStoryMapper' },
            {},
            'rejected',
          );
        }
        return this.makeResult(role, actionType, params, true, {
          story: {
            as_a: story?.['As a'] ?? story?.['As an'] ?? story?.as_a,
            i_want: story?.['I want'] ?? story?.i_want,
            so_that: story?.['So that'] ?? story?.so_that,
          },
          validation,
          tool: 'UserStoryMapper',
        });
      }
      case 'prioritize': {
        const model = String(params.model ?? 'moscow').toLowerCase();
        const backlog = Array.isArray(params.backlog) ? params.backlog : [];
        const ordered = this.prioritizeBacklog(backlog, model);
        return this.makeResult(role, actionType, params, true, {
          model,
          ordered,
          tool: model === 'rice' ? 'RoadmapPlanner' : 'RequirementsTraceabilityMatrix',
          echo_store: true, // I3 优先级决策沉淀
        });
      }
      case 'stakeholder_sync': {
        const stakeholders = Array.isArray(params.stakeholders) ? params.stakeholders : [];
        const topic = String(params.topic ?? '');
        return this.makeResult(role, actionType, params, true, {
          summary: this.syncStakeholders(stakeholders, topic),
          stakeholders,
          tool: 'StakeholderCommunicator',
        });
      }
      default:
        throw new RangeError(`未知 action.type=${actionType}`);
    }
  }

  /** 验证产品决策：合规 + 执行 + 用户故事模板（F041 §2.2 verify）。 */
  override async verify(result: RoleActionResult): Promise<boolean> {
    this.markLifecycle('verifying');
    const compliance = result.complianceCheck;
    if (!compliance.valueAnchorsRespected || !compliance.charterAligned) return false;
    if (!result.executed) return false;
    // I4 用户故事动作额外校验三段式
    if (result.actionType === 'user_story') {
      const story = (result.result.story ?? {}) as Readonly<Record<string, unknown>>;
      return this.validateUserStory(story).valid;
    }
    return true;
  }

  // ── I2 审批：愿景级变更（价值锚点 / 红线）必须 operator 批准 ────

  override requiresApproval(
    actionType: string,
    params?: Readonly<Record<string, unknown>>,
  ): boolean {
    return actionType === 'roadmap_update' && params?.vision_change === true;
  }

  // ── 领域工具（F041 §2.1 工具集）──────────────────────────────

  /** 需求分析：输入摘要 → 结构化需求（功能 / 非功能 / 边界）。 */
  private analyzeRequirements(input: string): Record<string, unknown>[] {
    if (input.trim() === '') return [];
    return [
      {
        id: 'REQ-1',
        source: input.slice(0, 64),
        functional: true,
        non_functional: false,
        boundary: false,
      },
    ];
  }

  /** 用户故事三段式校验（As-a / I-want / So-that，I4；As an 为 As a 变体）。 */
  private validateUserStory(
    story: Readonly<Record<string, unknown>> | undefined,
  ): { valid: boolean; missing: string[] } {
    if (story === undefined) return { valid: false, missing: [...USER_STORY_SECTIONS] };
    const missing: string[] = [];
    // 角色段：As a / As an 任一存在即可（F041 模板变体）
    const roleOk = USER_STORY_ROLE_VARIANTS.some((v) => {
      const value = story[v] ?? story[v.toLowerCase().replace(/ /g, '_')];
      return typeof value === 'string' && value.trim() !== '';
    });
    if (!roleOk) missing.push('As a');
    // 目的段：I want / So that 必填
    for (const section of ['I want', 'So that'] as const) {
      const value = story[section] ?? story[section.toLowerCase().replace(/ /g, '_')];
      if (typeof value !== 'string' || value.trim() === '') {
        missing.push(section);
      }
    }
    return { valid: missing.length === 0, missing };
  }

  /** 优先级排序：MoSCoW / RICE 两种模型（F041 AC-5）。 */
  private prioritizeBacklog(backlog: unknown[], model: string): unknown[] {
    if (model === 'rice') {
      // RICE = (Reach × Impact × Confidence) / Effort，缺省估算降序
      return [...backlog].sort((a, b) => this.riceScore(b) - this.riceScore(a));
    }
    // MoSCoW：Must / Should / Could / Won't 四档降序
    const rank = { must: 0, should: 1, could: 2, wont: 3, "won't": 3 };
    return [...backlog].sort((a, b) => {
      const am = String((a as Readonly<Record<string, unknown>>).moscow ?? 'could').toLowerCase();
      const bm = String((b as Readonly<Record<string, unknown>>).moscow ?? 'could').toLowerCase();
      return (rank[am as keyof typeof rank] ?? 2) - (rank[bm as keyof typeof rank] ?? 2);
    });
  }

  /** RICE 评分（缺省估算：reach=100 / impact=3 / confidence=0.8 / effort=1）。 */
  private riceScore(item: unknown): number {
    const it = (item ?? {}) as Readonly<Record<string, unknown>>;
    const reach = Number(it.reach ?? 100);
    const impact = Number(it.impact ?? 3);
    const confidence = Number(it.confidence ?? 0.8);
    const effort = Number(it.effort ?? 1) || 1;
    return (reach * impact * confidence) / effort;
  }

  /** 利益相关者沟通摘要（跨智能体协调，F041 核心能力 5）。 */
  private syncStakeholders(stakeholders: unknown[], topic: string): string {
    if (stakeholders.length === 0) return '无利益相关者待同步';
    return `已向 ${stakeholders.length} 位利益相关者同步：${topic || '产品方向'}`;
  }
}

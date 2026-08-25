/**
 * @flowforge/forgekin-roles — DeliveryManagerForgekin 交付经理（象·牛顿，F044）。
 *
 * TS 重写自 `forgemind/species_impl/org/delivery_manager.py`（F044 §2.2）：
 *   - observe: 采集项目状态 / 里程碑 / 风险 / 资源 4 类信号
 *   - act: plan_project / track_progress / mitigate_risk /
 *     coordinate_resources / quality_gate 5 种动作
 *   - verify: 里程碑达成 / 风险缓解 / 质量门禁通过
 *
 * 关键不变量（F044 §2.3）：
 *   - I1 资源重新分配必须 operator 批准（觉醒阶 E3 上限）
 *   - I2 质量门禁不可绕过（DoD 未满足禁止放行）
 *   - I3 阻塞级风险必须上报（不静默）
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

/** DeliveryManagerForgekin 构造选项（F044 缺省：ORG 形态 / E1 进化 / E1 觉醒）。 */
export interface DeliveryManagerOptions extends ForgekinRoleOptions {
  /** 能力画像（缺省填入 F044 五能力 + 盲点 + 工具集）。 */
  capabilityProfile?: Readonly<Record<string, unknown>> | undefined;
}

/** 交付经理可进化智能体（象·牛顿）— 规划 → 跟踪 → 风控 → 资源 → 质量门禁。 */
export class DeliveryManagerForgekin extends ForgekinRole {
  static readonly ROLE_ID = 'delivery-manager' as const;

  /** 已上报的阻塞级风险（I3：不静默）。 */
  private readonly escalatedRisks: string[] = [];

  constructor(options: DeliveryManagerOptions) {
    super({
      ...options,
      species: options.species ?? ForgekinSpecies.ORG,
      evolutionStage: options.evolutionStage ?? EvolutionStage.E1,
      awakeningStage: options.awakeningStage ?? AwakeningStage.E1,
      capabilityProfile: options.capabilityProfile ?? {
        responsibilities: [
          '项目规划（WBS / 甘特图 / 关键路径）',
          '进度跟踪（里程碑 / 燃尽图 / 状态报告）',
          '风险管理（识别 / 评估 / 缓解 / 上报）',
          '资源协调（跨团队分配 / 负载均衡）',
          '质量门禁（DoD / 验收标准 / 发布门槛）',
        ],
        blind_spots: ['风险识别滞后', '资源冲突预判不足'],
        tools: [
          'ProjectPlanner',
          'ProgressTracker',
          'RiskManager',
          'ResourceCoordinator',
          'QualityGate',
        ],
        max_evolution_stage: EvolutionStage.E3,
        max_awakening_stage: AwakeningStage.E3,
      },
    });
  }

  /** 观察交付环境：项目状态 / 里程碑 / 风险 / 资源（F044 AC-2）。 */
  override async observe(
    environment: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    this.markLifecycle('observing');
    const signals = (environment.delivery_signals ?? {}) as Readonly<Record<string, unknown>>;
    return {
      species: this.species,
      role: DeliveryManagerForgekin.ROLE_ID,
      project_status: signals.project_status ?? {},
      milestones: signals.milestones ?? [],
      risks: signals.risks ?? [],
      resources: signals.resources ?? {},
      systems_queried: [...this.businessSystems],
    };
  }

  /** 执行交付动作（F044 AC-3 五动作路由）。 */
  override async act(action: Readonly<Record<string, unknown>>): Promise<RoleActionResult> {
    this.markLifecycle('acting');
    const actionType = String(action.action_type ?? action.type ?? 'unknown');
    const params = (action.params ?? {}) as Readonly<Record<string, unknown>>;
    const role = DeliveryManagerForgekin.ROLE_ID;

    // I1 资源重新分配必须 operator 批准（F044 §2.3）
    if (this.requiresApproval(actionType, params)) {
      return this.makeResult(role, actionType, params, false, {
        reason: 'resource_reallocation_requires_operator_approval',
        hint: '资源重新分配需经 requestApproval 由 operator 批准',
      });
    }

    switch (actionType) {
      case 'plan_project': {
        const scope = String(params.scope ?? '');
        const milestones = Array.isArray(params.milestones) ? params.milestones : [];
        return this.makeResult(role, actionType, params, true, {
          plan: {
            scope,
            wbs: `WBS-${this.forgekinId}`,
            milestones,
            critical_path: [],
          },
          tool: 'ProjectPlanner',
        });
      }
      case 'track_progress': {
        const milestone = String(params.milestone ?? '');
        const progress = Number(params.progress ?? 0);
        return this.makeResult(role, actionType, params, true, {
          progress: { milestone, percent: progress, status: progress >= 100 ? 'done' : 'in_progress' },
          tool: 'ProgressTracker',
        });
      }
      case 'mitigate_risk': {
        const risk = String(params.risk ?? '');
        const severity = String(params.severity ?? 'low').toLowerCase();
        if (severity === 'blocker') {
          // I3 阻塞级风险必须上报（不静默）
          this.escalatedRisks.push(risk);
          return this.makeResult(role, actionType, params, true, {
            mitigation: { risk, severity, status: 'escalated_to_operator' },
            tool: 'RiskManager',
          });
        }
        return this.makeResult(role, actionType, params, true, {
          mitigation: { risk, severity, status: 'mitigated', actions: [] },
          tool: 'RiskManager',
        });
      }
      case 'coordinate_resources': {
        const resource = String(params.resource ?? '');
        const from = String(params.from ?? '');
        const to = String(params.to ?? '');
        return this.makeResult(role, actionType, params, true, {
          allocation: { resource, from, to, status: 'applied' },
          tool: 'ResourceCoordinator',
        });
      }
      case 'quality_gate': {
        const stage = String(params.stage ?? 'release');
        const dod = (params.dod ?? {}) as Readonly<Record<string, boolean>>;
        const unmet = Object.entries(dod)
          .filter(([, passed]) => passed !== true)
          .map(([k]) => k);
        if (unmet.length > 0) {
          // I2 质量门禁不可绕过：DoD 未满足禁止放行
          return this.makeResult(
            role,
            actionType,
            params,
            false,
            {
              gate: { stage, passed: false, unmet },
              tool: 'QualityGate',
            },
            {},
            'rejected',
          );
        }
        return this.makeResult(role, actionType, params, true, {
          gate: { stage, passed: true, unmet: [] },
          tool: 'QualityGate',
        });
      }
      default:
        throw new RangeError(`未知 action.type=${actionType}`);
    }
  }

  /** 验证交付结果：合规 + 执行 + 质量门禁不可绕过（F044 §2.2 verify）。 */
  override async verify(result: RoleActionResult): Promise<boolean> {
    this.markLifecycle('verifying');
    const compliance = result.complianceCheck;
    if (!compliance.valueAnchorsRespected || !compliance.charterAligned) return false;
    if (!result.executed) return false;
    // I2 质量门禁：通过才可放行（rejected 结果 verify 恒 false）
    if (result.actionType === 'quality_gate') {
      const gate = (result.result.gate ?? {}) as Readonly<Record<string, unknown>>;
      return gate.passed === true;
    }
    return true;
  }

  // ── I1 审批：资源重新分配必须 operator 批准 ──────────────────

  override requiresApproval(
    actionType: string,
    params?: Readonly<Record<string, unknown>>,
  ): boolean {
    return actionType === 'coordinate_resources' && params?.reallocate === true;
  }
}

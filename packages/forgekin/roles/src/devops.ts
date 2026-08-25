/**
 * @flowforge/forgekin-roles — DevOpsForgekin 运维（蜂鸟·闪电，F042）。
 *
 * TS 重写自 `forgemind/species_impl/org/devops.py`（F042 §2.2）：
 *   - observe: 采集服务健康 / 指标 / 事故 / 容量 4 类信号
 *   - act: deploy / auto_heal / scale / degrade / tune 5 种动作
 *   - verify: 部署结果 / 自愈效果 / 容量水位
 *
 * 关键不变量（F042 §2.3）：
 *   - I1 重大变更（部署 / 回滚）必须 operator 批准（觉醒阶 E4 上限）
 *   - I2 自愈动作必须先写 WAL（F021 副作用日志，失败可回滚）
 *   - I3 Tier 0 物理副作用禁止自愈（可降级，必须 operator 介入）
 *   - I4 部署必须支持金丝雀发布（可灰度放量）
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

/** Tier 0 服务 — 物理副作用禁止自愈（I3）。 */
export const TIER_0 = 0;

/** DevOpsForgekin 构造选项（F042 缺省：ORG 形态 / E1 进化 / E1 觉醒）。 */
export interface DevOpsOptions extends ForgekinRoleOptions {
  /** 能力画像（缺省填入 F042 五能力 + 盲点 + 工具集）。 */
  capabilityProfile?: Readonly<Record<string, unknown>> | undefined;
}

/** 运维可进化智能体（蜂鸟·闪电）— 部署 → 自愈 → 伸缩 → 降级 → 调优。 */
export class DevOpsForgekin extends ForgekinRole {
  static readonly ROLE_ID = 'devops' as const;

  constructor(options: DevOpsOptions) {
    super({
      ...options,
      species: options.species ?? ForgekinSpecies.ORG,
      evolutionStage: options.evolutionStage ?? EvolutionStage.E1,
      awakeningStage: options.awakeningStage ?? AwakeningStage.E1,
      capabilityProfile: options.capabilityProfile ?? {
        responsibilities: [
          '持续部署',
          '自愈（故障检测 / 自动恢复）',
          '容量伸缩',
          '优雅降级',
          '性能调优',
        ],
        blind_spots: ['变更风险评估不足', '容量规划滞后'],
        tools: [
          'DeploymentOrchestrator',
          'MonitoringStack',
          'IncidentResponder',
          'PerformanceProfiler',
          'CapacityPlanner',
        ],
        max_evolution_stage: EvolutionStage.E4,
        max_awakening_stage: AwakeningStage.E4,
      },
    });
  }

  /** 观察运维环境：服务健康 / 指标 / 事故 / 容量（F042 AC-2）。 */
  override async observe(
    environment: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    this.markLifecycle('observing');
    const signals = (environment.ops_signals ?? {}) as Readonly<Record<string, unknown>>;
    return {
      species: this.species,
      role: DevOpsForgekin.ROLE_ID,
      service_health: signals.service_health ?? {},
      metrics: signals.metrics ?? {},
      incidents: signals.incidents ?? [],
      capacity: signals.capacity ?? {},
      systems_queried: [...this.businessSystems],
    };
  }

  /** 执行运维动作（F042 AC-3 五动作路由）。 */
  override async act(action: Readonly<Record<string, unknown>>): Promise<RoleActionResult> {
    this.markLifecycle('acting');
    const actionType = String(action.action_type ?? action.type ?? 'unknown');
    const params = (action.params ?? {}) as Readonly<Record<string, unknown>>;
    const role = DevOpsForgekin.ROLE_ID;

    // I1 重大变更（部署 / 回滚）必须 operator 批准（F042 §2.3）
    if (this.requiresApproval(actionType, params)) {
      return this.makeResult(role, actionType, params, false, {
        reason: 'major_change_requires_operator_approval',
        hint: '重大变更（部署 / 回滚 / 大规模伸缩）需经 requestApproval 由 operator 批准',
      });
    }

    switch (actionType) {
      case 'deploy': {
        const target = String(params.target ?? '');
        const canary = Number(params.canary_percent ?? 0); // I4 金丝雀放量
        // I2 部署前先写 WAL（F021 副作用日志）
        const wal = this.writeWal(actionType, { target, canary });
        if (!wal.ok) {
          return this.makeResult(role, actionType, params, false, {
            reason: 'wal_write_failed',
            hint: wal.error,
          });
        }
        return this.makeResult(role, actionType, params, true, {
          deployment: {
            target,
            strategy: canary > 0 && canary < 100 ? 'canary' : 'full',
            canary_percent: canary,
            status: 'in_progress',
          },
          wal_entry: wal.entry,
          tool: 'DeploymentOrchestrator',
        });
      }
      case 'auto_heal': {
        const tier = Number(params.tier ?? 1);
        if (tier === TIER_0) {
          // I3 Tier 0 物理副作用禁止自愈 → 拒绝，必须 operator 介入
          return this.makeResult(
            role,
            actionType,
            params,
            false,
            {
              reason: 'tier0_auto_heal_rejected',
              hint: 'Tier 0 服务物理副作用禁止自愈，请 operator 人工介入',
            },
            {},
            'rejected',
          );
        }
        // I2 自愈先写 WAL，失败可回滚
        const wal = this.writeWal(actionType, { tier, incident: params.incident });
        if (!wal.ok) {
          return this.makeResult(role, actionType, params, false, {
            reason: 'wal_write_failed',
            hint: wal.error,
          });
        }
        return this.makeResult(role, actionType, params, true, {
          heal_plan: {
            tier,
            incident: params.incident ?? null,
            action: 'restart_or_rollback',
          },
          wal_entry: wal.entry,
          tool: 'IncidentResponder',
        });
      }
      case 'scale': {
        const from = Number(params.from ?? 1);
        const to = Number(params.to ?? from);
        return this.makeResult(role, actionType, params, true, {
          scaling: { from, to, delta: to - from, status: 'applied' },
          tool: 'CapacityPlanner',
        });
      }
      case 'degrade': {
        const level = String(params.level ?? 'graceful');
        return this.makeResult(role, actionType, params, true, {
          degradation: { level, status: 'applied' },
          tool: 'MonitoringStack',
        });
      }
      case 'tune': {
        const param = String(params.param ?? '');
        const value = params.value ?? null;
        return this.makeResult(role, actionType, params, true, {
          tuning: { param, value, status: 'applied' },
          tool: 'PerformanceProfiler',
        });
      }
      default:
        throw new RangeError(`未知 action.type=${actionType}`);
    }
  }

  /** 验证运维结果：合规 + 执行 + 部署/自愈 WAL 落盘（F042 §2.2 verify）。 */
  override async verify(result: RoleActionResult): Promise<boolean> {
    this.markLifecycle('verifying');
    const compliance = result.complianceCheck;
    if (!compliance.valueAnchorsRespected || !compliance.charterAligned) return false;
    if (!result.executed) return false;
    // I2 部署 / 自愈必须有 WAL 记录
    if (result.actionType === 'deploy' || result.actionType === 'auto_heal') {
      return result.result.wal_entry !== undefined;
    }
    return true;
  }

  // ── I1 审批：重大变更（部署 / 回滚 / 大规模伸缩）必须 operator 批准 ──

  override requiresApproval(
    actionType: string,
    params?: Readonly<Record<string, unknown>>,
  ): boolean {
    if (params?.major_change !== true) return false;
    return actionType === 'deploy' || actionType === 'scale' || actionType === 'degrade';
  }

  // ── 领域工具（F042 §2.1 工具集）──────────────────────────────

  /** 副作用 WAL 写入（F021）：部署 / 自愈前先落日志，失败可回滚（I2）。 */
  private writeWal(
    actionType: string,
    detail: Readonly<Record<string, unknown>>,
  ): { ok: true; entry: Record<string, unknown> } | { ok: false; error: string } {
    if (detail.target === undefined && detail.incident === undefined && detail.tier === undefined) {
      return { ok: false, error: 'WAL 缺少副作用目标（target / incident / tier）' };
    }
    return {
      ok: true,
      entry: {
        wal_id: `wal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action_type: actionType,
        detail,
        written_at: new Date().toISOString(),
        status: 'pending',
      },
    };
  }
}

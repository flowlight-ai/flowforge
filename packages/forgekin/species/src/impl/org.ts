/**
 * @flowforge/forgekin-species — 组织Forgekin（OrgForgekin）
 *
 * TS 移植自 `forgemind/species_impl/org.py`。承载于人类组织（公司 /
 * 团队 / 社区 / 城市），通过业务系统 API / 数据库 / IM 通道接入，建立
 * "观察业务状态 → 推理组织决策 → 行动（决策建议/流程触发）→ 验证业务
 * 指标"的现实闭环。
 *
 * @module @flowforge/forgekin-species
 */

import type { SoulImprint } from '@flowforge/forgekin-soul';
import type { AwakeningStage, EvolutionStage } from '@flowforge/forgekin-stage';
import { ForgekinBase, type ForgekinLLMClient } from '../base.js';
import { ForgekinSpecies } from '../species-enum.js';

/** OrgForgekin 构造入参 */
export interface OrgForgekinInit {
  forgekin_id: string;
  name: string;
  soul_imprint: SoulImprint;
  evolution_stage?: EvolutionStage | undefined;
  awakening_stage?: AwakeningStage | undefined;
  capability_profile?: Readonly<Record<string, unknown>> | undefined;
  forgekin_config?: Readonly<Record<string, unknown>> | undefined;
  llm_client?: ForgekinLLMClient | undefined;
  /** 组织章程（虚拟设定层） */
  org_charter?: string | null | undefined;
  /** 角色矩阵（虚拟设定层） */
  role_matrix?: Readonly<Record<string, unknown>> | undefined;
  /** 业务系统接入列表（如 ["erp", "crm", "im:feishu"]） */
  business_systems?: readonly string[] | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 组织Forgekin（OrgForgekin / Organizational Spirit Agent） */
export class OrgForgekin extends ForgekinBase {
  readonly orgCharter: string | null;
  readonly roleMatrix: Record<string, unknown>;
  readonly businessSystems: string[];

  constructor(init: OrgForgekinInit) {
    super({ ...init, species: ForgekinSpecies.ORG });
    this.orgCharter = init.org_charter ?? null;
    this.roleMatrix = { ...(init.role_matrix ?? {}) };
    this.businessSystems = [...(init.business_systems ?? [])];
  }

  /**
   * 观察组织环境（业务系统 API / IM 通道数据）。
   *
   * environment 应含 `business_signals`（业务指标 / 员工状态 / 市场动态 / 合规事件）。
   */
  override async observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('observing');
    const signals = asRecord(environment['business_signals']);
    const systems = Array.isArray(signals['systems'])
      ? signals['systems'].filter((s): s is string => typeof s === 'string')
      : [];
    return {
      species: this.species,
      business_metrics: asRecord(signals['business_metrics']),
      org_health: asRecord(signals['org_health']),
      compliance_events: Array.isArray(signals['compliance_events']) ? signals['compliance_events'] : [],
      market_signals: Array.isArray(signals['market_signals']) ? signals['market_signals'] : [],
      systems_queried: this.businessSystems.filter((s) => systems.includes(s)),
    };
  }

  /**
   * 执行组织决策（决策建议 / 流程触发 / 资源调度）。
   *
   * 涉及资源调度（资金 / 人力）的决策必须降级为建议（E1/E2）
   * 或经 operator 确认后执行（E3+）。
   */
  override async act(action: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
    this.setLifecycleState('acting');
    const actionType = typeof action['action_type'] === 'string' ? action['action_type'] : 'unknown';
    const params = asRecord(action['params']);
    return {
      species: this.species,
      action_type: actionType,
      params,
      executed: false, // 默认降级为建议
      decision_record: 'pending_operator_review',
      compliance_check: {
        charter_aligned: true,
        regulatory_compliant: true,
        value_anchors_respected: true,
      },
    };
  }

  /** 验证组织决策是否改善业务指标（且未触发合规事件） */
  override async verify(actionResult: Readonly<Record<string, unknown>>): Promise<boolean> {
    this.setLifecycleState('verifying');
    const compliance = asRecord(actionResult['compliance_check']);
    if (compliance['value_anchors_respected'] !== true) {
      return false;
    }
    if (compliance['charter_aligned'] !== true) {
      return false;
    }
    return actionResult['executed'] === true;
  }
}

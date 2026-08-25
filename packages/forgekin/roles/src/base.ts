/**
 * @flowforge/forgekin-roles — ForgekinRole 抽象基类（T7.28，F041-F044 公共契约）。
 *
 * TS 重写自 `forgemind/base.py` ForgekinBase + `species_impl/org.py`：
 *   - 三方法契约 observe / act / verify（观察 → 行动 → 验证闭环）
 *   - 生命周期状态机 created → observing/acting/verifying
 *   - 能力判定 canSelfEvolve（觉醒阶 ≥ E4）/ canForgeNewForgekin（进化阶 = E6）
 *   - describe() 描述字典（谱系追踪 / 日志 / UI）
 *   - 审批辅助：需 operator 批准的动作降级为建议（decision_record）
 *
 * @module @flowforge/forgekin-roles
 */

import { AwakeningStage, EvolutionStage, ForgekinSpecies, RoleActionResult, RoleId } from './types.js';

/** ForgekinRole 构造选项（对齐 base.py __init__ 参数）。 */
export interface ForgekinRoleOptions {
  /** Forgekin 唯一 ID（如 "forgemind:keane"）。 */
  forgekinId: string;
  /** Forgekin 显示名（如 "凯恩"）。 */
  name: string;
  /** 形态（缺省 ORG 组织形态，对齐 F041-F044 feature 文档）。 */
  species?: ForgekinSpecies | undefined;
  /** 进化阶（缺省 E1）。 */
  evolutionStage?: EvolutionStage | undefined;
  /** 觉醒阶（缺省 E1）。 */
  awakeningStage?: AwakeningStage | undefined;
  /** 能力画像（长期能力主体）。 */
  capabilityProfile?: Readonly<Record<string, unknown>> | undefined;
  /** 完整 YAML 配置（personality/role/llm/value_anchors 等，只读视图）。 */
  forgekinConfig?: Readonly<Record<string, unknown>> | undefined;
  /** 组织设定层：组织章程（OrgForgekin 专属）。 */
  orgCharter?: string | null | undefined;
  /** 组织设定层：角色矩阵（OrgForgekin 专属）。 */
  roleMatrix?: Readonly<Record<string, unknown>> | undefined;
  /** 业务系统接入列表（如 ["erp", "crm", "im:feishu"]）。 */
  businessSystems?: readonly string[] | undefined;
}

/** ForgekinRole — 特种角色抽象基类（observe/act/verify 三方法契约）。 */
export abstract class ForgekinRole {
  readonly forgekinId: string;
  readonly name: string;
  readonly species: ForgekinSpecies;
  readonly evolutionStage: EvolutionStage;
  readonly awakeningStage: AwakeningStage;
  readonly capabilityProfile: Readonly<Record<string, unknown>>;
  readonly orgCharter: string | null;
  readonly roleMatrix: Readonly<Record<string, unknown>>;
  readonly businessSystems: readonly string[];
  protected readonly forgekinConfig: Readonly<Record<string, unknown>>;
  private lifecycle: string = 'created';

  constructor(options: ForgekinRoleOptions) {
    if (!options.forgekinId || options.forgekinId.trim() === '') {
      throw new RangeError('forgekinId 不能为空');
    }
    if (!options.name || options.name.trim() === '') {
      throw new RangeError('name 不能为空');
    }
    this.forgekinId = options.forgekinId.trim();
    this.name = options.name.trim();
    this.species = options.species ?? ForgekinSpecies.ORG;
    this.evolutionStage = options.evolutionStage ?? EvolutionStage.E1;
    this.awakeningStage = options.awakeningStage ?? AwakeningStage.E1;
    this.capabilityProfile = { ...options.capabilityProfile };
    this.orgCharter = options.orgCharter ?? null;
    this.roleMatrix = { ...options.roleMatrix };
    this.businessSystems = [...(options.businessSystems ?? [])];
    this.forgekinConfig = { ...options.forgekinConfig };
  }

  // ── 抽象契约：观察 → 行动 → 验证 ─────────────────────────────

  /** 观察环境（对齐 base.py observe：感知端闭环）。 */
  abstract observe(environment: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>>;

  /** 在环境中执行动作（对齐 base.py act：行动端闭环）。 */
  abstract act(action: Readonly<Record<string, unknown>>): Promise<RoleActionResult>;

  /** 验证动作结果是否达成预期（对齐 base.py verify：验证端闭环）。 */
  abstract verify(result: RoleActionResult): Promise<boolean>;

  // ── 能力判定（对齐 base.py）──────────────────────────────────

  /** 觉醒阶 ≥ E4 Evolving — 可自我进化。 */
  canSelfEvolve(): boolean {
    return AwakeningStage.canSelfEvolve(this.awakeningStage);
  }

  /** 进化阶 = E6 ForgeMind — 可锻造新 Forgekin。 */
  canForgeNewForgekin(): boolean {
    return EvolutionStage.canForgeNewForgekin(this.evolutionStage);
  }

  // ── 生命周期（对齐 base.py _lifecycle_state）─────────────────

  /** 当前生命周期状态（created → observing/acting/verifying）。 */
  get lifecycleState(): string {
    return this.lifecycle;
  }

  /** 更新生命周期状态（内部方法，子类在 observe/act/verify 中调用）。 */
  protected markLifecycle(state: 'observing' | 'acting' | 'verifying'): void {
    this.lifecycle = state;
  }

  // ── 审批辅助（对齐 org.py act 的降级语义）────────────────────

  /**
   * 判断动作是否需要 operator 批准（子类按觉醒阶/不变量覆写）。
   * 缺省 false；返回 true 时 act() 降级为建议（decision_record=pending_operator_review）。
   *
   * @param actionType 动作类型（角色各自的 5 种 action.type 之一）
   * @param params 动作参数（供不变量判断，如 vision_change / blocking / major_change / reallocate）
   */
  protected requiresApproval(_actionType: string, _params?: Readonly<Record<string, unknown>>): boolean {
    return false;
  }

  /**
   * 构造统一动作结果（对齐 org.py act 返回结构）。
   *
   * @param executed 是否实际执行（false = 降级为建议）
   * @param compliance 合规检查（缺省全部通过）
   * @param decisionRecord 决策记录覆写（缺省 executed ? applied : pending_operator_review）
   */
  protected makeResult(
    role: RoleId,
    actionType: string,
    params: Readonly<Record<string, unknown>>,
    executed: boolean,
    result: Readonly<Record<string, unknown>>,
    compliance: {
      charterAligned?: boolean;
      regulatoryCompliant?: boolean;
      valueAnchorsRespected?: boolean;
    } = {},
    decisionRecord?: string,
  ): RoleActionResult {
    return {
      role,
      actionType,
      params,
      executed,
      decisionRecord: decisionRecord ?? (executed ? 'applied' : 'pending_operator_review'),
      complianceCheck: {
        charterAligned: compliance.charterAligned ?? true,
        regulatoryCompliant: compliance.regulatoryCompliant ?? true,
        valueAnchorsRespected: compliance.valueAnchorsRespected ?? true,
      },
      result,
    };
  }

  // ── 描述字典（对齐 base.py describe）─────────────────────────

  /** 返回角色描述字典（谱系追踪 / 日志 / UI 展示）。 */
  describe(): Record<string, unknown> {
    return {
      forgekin_id: this.forgekinId,
      name: this.name,
      species: this.species,
      species_chinese: ForgekinSpecies.chineseName(this.species),
      evolution_stage: this.evolutionStage,
      evolution_stage_chinese: EvolutionStage.chineseName(this.evolutionStage),
      awakening_stage: this.awakeningStage,
      awakening_stage_chinese: AwakeningStage.chineseName(this.awakeningStage),
      lifecycle_state: this.lifecycle,
      can_self_evolve: this.canSelfEvolve(),
      can_forge_new_forgekin: this.canForgeNewForgekin(),
    };
  }

  toString(): string {
    return `<${this.constructor.name} id=${this.forgekinId} name=${this.name} evo=${this.evolutionStage} awk=${this.awakeningStage}>`;
  }
}

/**
 * @flowforge/forgekin-roles — T7.28 特种角色子代理类型定义（F041-F044）。
 *
 * TS 重写自 `forgemind/species.py` + `forgemind/base.py` 的形态/阶枚举
 * 与 `forgemind/species_impl/org.py` 的 observe/act/verify 契约：
 *   - ForgekinSpecies: 五大形态（bio/org/obj/virtual/hybrid）
 *   - EvolutionStage: 进化阶 E1-E6（能力成熟度，E6 ForgeMind 可锻造新 Forgekin）
 *   - AwakeningStage: 觉醒阶 E1-E6（自主性等级，E4+ 可自我进化）
 *   - RoleActionResult: act() 统一返回结构（decision_record / compliance_check）
 *
 * @module @flowforge/forgekin-roles
 */

/** Forgekin 五大形态（`forgemind/species.py`）。 */
export enum ForgekinSpecies {
  /** 生物形态（动物/植物/精灵等自然灵智体）。 */
  BIO = 'bio',
  /** 组织形态（公司/团队/社区/城市等承载于人类组织）。 */
  ORG = 'org',
  /** 物灵形态（承载于物理物件/设备）。 */
  OBJ = 'obj',
  /** 虚拟形态（承载于虚拟世界/数字空间）。 */
  VIRTUAL = 'virtual',
  /** 混合形态（多源融合）。 */
  HYBRID = 'hybrid',
}

export namespace ForgekinSpecies {
  /** 返回形态中文名（对齐 Python 的 chinese_name 属性）。 */
  export function chineseName(species: ForgekinSpecies): string {
    switch (species) {
      case ForgekinSpecies.BIO:
        return '生物形态';
      case ForgekinSpecies.ORG:
        return '组织形态';
      case ForgekinSpecies.OBJ:
        return '物灵形态';
      case ForgekinSpecies.VIRTUAL:
        return '虚拟形态';
      case ForgekinSpecies.HYBRID:
        return '混合形态';
    }
  }
}

/** 进化阶 E1-E6（能力成熟度阶梯，`forgemind/stages.py`）。 */
export enum EvolutionStage {
  E1 = 'E1',
  E2 = 'E2',
  E3 = 'E3',
  E4 = 'E4',
  E5 = 'E5',
  E6 = 'E6',
}

export namespace EvolutionStage {
  /** 进化阶中文名。 */
  export function chineseName(stage: EvolutionStage): string {
    switch (stage) {
      case EvolutionStage.E1:
        return '初生';
      case EvolutionStage.E2:
        return '成长';
      case EvolutionStage.E3:
        return '成熟';
      case EvolutionStage.E4:
        return '进化';
      case EvolutionStage.E5:
        return '高阶';
      case EvolutionStage.E6:
        return '锻造';
    }
  }

  /** E6 ForgeMind — 可锻造新 Forgekin（对齐 base.py can_forge_new_forgekin）。 */
  export function canForgeNewForgekin(stage: EvolutionStage): boolean {
    return stage === EvolutionStage.E6;
  }
}

/** 觉醒阶 E1-E6（自主性等级，`forgemind/stages.py`）。 */
export enum AwakeningStage {
  /** 全导阶 — 仅执行 operator 明确指令。 */
  E1 = 'E1',
  /** 建议阶 — 建议需 operator 确认后执行。 */
  E2 = 'E2',
  /** 受限自主阶 — 在 tool allow-list / cost ceiling 内自主。 */
  E3 = 'E3',
  /** 进化阶 Evolving — 可自主优化自身能力。 */
  E4 = 'E4',
  E5 = 'E5',
  E6 = 'E6',
}

export namespace AwakeningStage {
  /** 觉醒阶中文名。 */
  export function chineseName(stage: AwakeningStage): string {
    switch (stage) {
      case AwakeningStage.E1:
        return '全导';
      case AwakeningStage.E2:
        return '建议';
      case AwakeningStage.E3:
        return '受限自主';
      case AwakeningStage.E4:
        return '进化';
      case AwakeningStage.E5:
        return '高阶';
      case AwakeningStage.E6:
        return '完全';
    }
  }

  /** E4+ Evolving — 可自我进化（对齐 base.py can_self_evolve）。 */
  export function canSelfEvolve(stage: AwakeningStage): boolean {
    return stage === AwakeningStage.E4 || stage === AwakeningStage.E5 || stage === AwakeningStage.E6;
  }
}

/** 特种角色标识（T7.28 四角色，F041-F044）。 */
export type RoleId = 'product-manager' | 'devops' | 'security-officer' | 'delivery-manager';

/** act() 统一返回结构（对齐 `species_impl/org.py` 的决策记录语义）。 */
export interface RoleActionResult {
  /** 角色 ID（species.value 等价物）。 */
  readonly role: RoleId;
  /** 动作类型（角色各自的 5 种 action.type 之一）。 */
  readonly actionType: string;
  /** 动作参数（回显）。 */
  readonly params: Readonly<Record<string, unknown>>;
  /** 是否已执行（false = 降级为建议，等待 operator 审批）。 */
  readonly executed: boolean;
  /** 决策记录状态（applied / pending_operator_review / rejected）。 */
  readonly decisionRecord: string;
  /** 合规检查（对齐 org.py compliance_check 三要素）。 */
  readonly complianceCheck: {
    /** 章程对齐（产品/组织价值锚点）。 */
    readonly charterAligned: boolean;
    /** 监管合规（安全/法规边界）。 */
    readonly regulatoryCompliant: boolean;
    /** 价值锚点尊重（不可违反的底线）。 */
    readonly valueAnchorsRespected: boolean;
  };
  /** 动作特有结果（由各角色处理器填充）。 */
  readonly result: Readonly<Record<string, unknown>>;
}

/**
 * @flowforge/forgekin-species — ForgekinSpecies 五大形态枚举
 *
 * TS 移植自 `forgemind/species.py`：
 * - bio（生物Forgekin）/ org（组织Forgekin）/ obj（物品Forgekin）/
 *   virtual（虚拟Forgekin）/ hybrid（混合Forgekin）
 * - fromString 大小写不敏感，未知值抛错（对齐 Python from_string ValueError）
 *
 * @module @flowforge/forgekin-species/species-enum
 */

/** ForgekinSpecies 五大形态（对齐 naming-contract.md#2.3） */
export enum ForgekinSpecies {
  BIO = 'bio', // 生物Forgekin — 猫 / 狗 / 鸟 / 鱼 / 昆虫群体
  ORG = 'org', // 组织Forgekin — 公司 / 团队 / 社区 / 城市
  OBJ = 'obj', // 物品Forgekin — 桌椅 / 灯具 / 家电 / 工具
  VIRTUAL = 'virtual', // 虚拟Forgekin — 童话 / 神话 / 历史 / 游戏角色
  HYBRID = 'hybrid', // 混合Forgekin — 多形态融合
}

const CHINESE_NAMES: Record<ForgekinSpecies, string> = {
  [ForgekinSpecies.BIO]: '生物Forgekin',
  [ForgekinSpecies.ORG]: '组织Forgekin',
  [ForgekinSpecies.OBJ]: '物品Forgekin',
  [ForgekinSpecies.VIRTUAL]: '虚拟Forgekin',
  [ForgekinSpecies.HYBRID]: '混合Forgekin',
};

const CLASS_NAMES: Record<ForgekinSpecies, string> = {
  [ForgekinSpecies.BIO]: 'BioForgekin',
  [ForgekinSpecies.ORG]: 'OrgForgekin',
  [ForgekinSpecies.OBJ]: 'ObjForgekin',
  [ForgekinSpecies.VIRTUAL]: 'VirtualForgekin',
  [ForgekinSpecies.HYBRID]: 'HybridForgekin',
};

export namespace ForgekinSpecies {
  /** 从字符串解析形态枚举，大小写不敏感（对齐 Python from_string） */
  export function fromString(value: string): ForgekinSpecies {
    const normalized = value.trim().toLowerCase();
    for (const species of Object.values(ForgekinSpecies)) {
      if (species === normalized) {
        return species;
      }
    }
    const valid = Object.values(ForgekinSpecies).join(', ');
    throw new Error(`未知的ForgekinSpecies形态: ${JSON.stringify(value)}（合法值: ${valid}）。详见 [doc:design/naming-contract.md#2.3]`);
  }

  /** 该形态的中文名 */
  export function chineseName(species: ForgekinSpecies): string {
    return CHINESE_NAMES[species];
  }

  /** 该形态对应的实现类名（species_factory 兜底推导用） */
  export function className(species: ForgekinSpecies): string {
    return CLASS_NAMES[species];
  }
}

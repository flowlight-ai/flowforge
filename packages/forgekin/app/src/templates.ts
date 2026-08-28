/**
 * @flowforge/forgekin-app — F026 通用 Forgekin 模板注册
 *
 * TS 移植自 `forgemind/plugins.py` `_DEFAULT_FORGEKIN_TEMPLATES`。
 * forgemind 应用层养"通用 Forgekin"——区别于 *Forge 的"垂直业务 Forgekin"。
 * 模板随包内置，外部插件可通过 ForgeMindAppService.registerForgekins 扩展。
 *
 * @module @flowforge/forgekin-app/templates
 */

import { ForgekinSpecies } from '@flowforge/forgekin-species';

/** 通用 Forgekin 模板（ForgeMindPlugin.register_forgekins 的注册单元） */
export interface ForgekinTemplate {
  readonly name: string;
  readonly species: ForgekinSpecies;
  /** 愿景需求描述（锻造提示词输入） */
  readonly requirement: string;
  /** 世界观/物理主体/组织章程等形态专属字段（透传为 seed_params） */
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
}

/** 默认通用 Forgekin 模板（孙悟空 / 家猫橘子 / 客厅吊灯 / 某科技公司） */
export const DEFAULT_FORGEKIN_TEMPLATES: readonly ForgekinTemplate[] = [
  {
    name: '孙悟空',
    species: ForgekinSpecies.VIRTUAL,
    requirement: '西游记神话角色，取经愿景，与唐僧/八戒Forgekin长期协作',
    extras: { worldview: '西游记神话体系' },
  },
  {
    name: '家猫橘子',
    species: ForgekinSpecies.BIO,
    requirement: '宠物猫，需要健康监测、喂食互动、行为画像',
    extras: { biological_subject: 'cat:bengal:orange' },
  },
  {
    name: '客厅吊灯',
    species: ForgekinSpecies.OBJ,
    requirement: '智能灯具，节能+用户舒适愿景，与家电Forgekin组队',
    extras: {
      iot_protocol: 'matter',
      function_boundary: ['switch', 'dim', 'color_temperature'],
    },
  },
  {
    name: '某科技公司',
    species: ForgekinSpecies.ORG,
    requirement: '组织Forgekin，业务决策+组织健康+合规治理',
    extras: { org_charter: '科技创新、合规经营、员工成长' },
  },
];

/** 模板 ID 前缀（对齐 Python forgekin_registry.register(name=f"forgemind:template:{name}")） */
export function templateId(name: string): string {
  return `forgemind:template:${name}`;
}

/**
 * @flowforge/forgekin-app — F026 通用锻造技能注册
 *
 * TS 移植自 `forgemind/plugins.py` `register_forge_skills`。
 * 通用锻造技能是所有 Forgekin 可加载的基础能力包：
 *   - forgemind:observe — 观察环境（5 形态通用入口）
 *   - forgemind:act — 执行动作（遵守觉醒阶约束）
 *   - forgemind:verify — 验证动作结果（Eval 自代谢信号源）
 *   - forgemind:forge_new — 锻造新 Forgekin（仅 E6 ForgeMind 阶可用）
 *
 * @module @flowforge/forgekin-app/skills
 */

/** 通用锻造技能（ForgeMindPlugin.register_forge_skills 的注册单元） */
export interface ForgeSkill {
  readonly name: string;
  readonly skill_type: 'native' | string;
  readonly description: string;
  /** 觉醒阶下限（如 "E1"；forge_new 需 "E4"） */
  readonly awakening_min: string;
  /** 进化阶下限（仅 forge_new 声明 "E6"） */
  readonly evolution_min?: string | undefined;
}

/** 默认通用锻造技能清单（4 项） */
export const DEFAULT_FORGE_SKILLS: readonly ForgeSkill[] = [
  {
    name: 'forgemind:observe',
    skill_type: 'native',
    description: '观察环境（5 形态通用入口，详见 ForgekinBase.observe）',
    awakening_min: 'E1',
  },
  {
    name: 'forgemind:act',
    skill_type: 'native',
    description: '执行动作（遵守觉醒阶自主范围约束）',
    awakening_min: 'E1',
  },
  {
    name: 'forgemind:verify',
    skill_type: 'native',
    description: '验证动作结果（Eval 自代谢信号源）',
    awakening_min: 'E1',
  },
  {
    name: 'forgemind:forge_new',
    skill_type: 'native',
    description: '锻造新Forgekin（仅 E6 ForgeMind阶可用，达成 operator 养万物愿景）',
    evolution_min: 'E6',
    awakening_min: 'E4',
  },
];

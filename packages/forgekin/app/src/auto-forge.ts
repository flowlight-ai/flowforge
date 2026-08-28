/**
 * @flowforge/forgekin-app — F026 自我进化配置注册（F100 Mode A/B/C）
 *
 * TS 移植自 `forgemind/plugins.py` `register_auto_forge_config`。
 * F100 自我进化三模式（review.md §13.1）：
 *   - Mode A — Scope Guard（范围守卫）: 防止Forgekin越权修改愿景/规范/架构
 *   - Mode B — Process Evolution（流程进化）: 改进Forgekin自身工作方式
 *   - Mode C — Knowledge Evolution（知识进化）: 蒸馏新知识到锻典
 * 新锻造 Forgekin 默认仅启用 Mode A，Mode B/C 需觉醒阶 ≥ E4 后由 operator 显式授权。
 *
 * @module @flowforge/forgekin-app/auto-forge
 */

/** 自我进化配置（ForgeMindPlugin.register_auto_forge_config 的注册单元） */
export interface AutoForgeConfig {
  /** 目标 Forgekin 模板（如 "forgemind:template:*"） */
  readonly forgekin_id: string;
  /** 范围守卫（Mode A）：只读/可写路径白名单 */
  readonly scope_guard: {
    readonly readonly_paths: readonly string[];
    readonly writable_paths: readonly string[];
  };
  /** 启用的进化模式（默认仅 ["ModeA_ScopeGuard"]） */
  readonly evolution_modes: readonly string[];
  /** Eval 台账策略（F018 Eval Contract） */
  readonly eval_ledger_policy: {
    readonly replay_ab_required: boolean;
    readonly min_net_gain: number;
  };
  /** Mode B/C 的觉醒阶下限（如 "E4"） */
  readonly awakening_min_for_mode_b: string;
  readonly awakening_min_for_mode_c: string;
}

/** 默认自我进化配置（对齐内置 auto-forge.yaml 与 Python 注册内容） */
export const DEFAULT_AUTO_FORGE_CONFIGS: readonly AutoForgeConfig[] = [
  {
    forgekin_id: 'forgemind:template:*',
    scope_guard: {
      readonly_paths: [
        'VISION.md#7',
        'rules.md#红线',
        'decisions/013-all-things-spirit-mind-vision.md',
      ],
      writable_paths: ['forgemind/config/prompts.yaml', 'forgemind/species_impl/'],
    },
    evolution_modes: ['ModeA_ScopeGuard'],
    eval_ledger_policy: {
      replay_ab_required: true,
      min_net_gain: 0.05,
    },
    awakening_min_for_mode_b: 'E4',
    awakening_min_for_mode_c: 'E4',
  },
];

/** 从 YAML 配置字典解析 auto_forge 段（宽松解析，缺省回落内置默认） */
export function parseAutoForgeConfigs(raw: unknown): AutoForgeConfig[] {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const configs = src['configs'];
  if (!Array.isArray(configs)) {
    return [...DEFAULT_AUTO_FORGE_CONFIGS];
  }
  const parsed: AutoForgeConfig[] = [];
  for (const item of configs) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const cfg = item as Record<string, unknown>;
    const scopeGuard = (typeof cfg['scope_guard'] === 'object' && cfg['scope_guard'] !== null
      ? cfg['scope_guard']
      : {}) as Record<string, unknown>;
    const evalPolicy = (typeof cfg['eval_ledger_policy'] === 'object' && cfg['eval_ledger_policy'] !== null
      ? cfg['eval_ledger_policy']
      : {}) as Record<string, unknown>;
    const strList = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    parsed.push({
      forgekin_id: typeof cfg['forgekin_id'] === 'string' ? cfg['forgekin_id'] : 'forgemind:template:*',
      scope_guard: {
        readonly_paths: strList(scopeGuard['readonly_paths']),
        writable_paths: strList(scopeGuard['writable_paths']),
      },
      evolution_modes: strList(cfg['evolution_modes']),
      eval_ledger_policy: {
        replay_ab_required: typeof evalPolicy['replay_ab_required'] === 'boolean' ? evalPolicy['replay_ab_required'] : true,
        min_net_gain: typeof evalPolicy['min_net_gain'] === 'number' ? evalPolicy['min_net_gain'] : 0.05,
      },
      awakening_min_for_mode_b: typeof cfg['awakening_min_for_mode_b'] === 'string' ? cfg['awakening_min_for_mode_b'] : 'E4',
      awakening_min_for_mode_c: typeof cfg['awakening_min_for_mode_c'] === 'string' ? cfg['awakening_min_for_mode_c'] : 'E4',
    });
  }
  return parsed;
}

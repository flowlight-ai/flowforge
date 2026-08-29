/**
 * @flowforge/harness-env-registry — C39 环境变量注册表 Cordis 插件。
 *
 * TS 移植自 clowder-ai `config/env-registry.ts`（1931 行）：
 *   - EnvDefinition/ENV_VARS 单一事实源（FF_* 系改名，R17）
 *   - buildEnvSummary 汇总 + sensitive/url 掩码
 *   - isEditableEnvVar* 运行期可编辑策略（fail-closed）
 *
 * 插件化改造决策：
 *   - 纯函数层 `env-registry.ts` 不依赖 Cordis（可独立引用/测试）
 *   - 插件层挂载 `ctx.envRegistry`：summary() / lookup(name) / editable 三件套
 *   - env 改名 FF_* 系（R17）：CAT_CAFE_* → FF_*；CAT_TEMPLATE_PATH → FF_TEMPLATE_PATH；
 *     DEFAULT_CAT_ID → FF_DEFAULT_CAT_ID
 *
 * 消费者加载默认插件：
 * ```ts
 * import EnvRegistry from '@flowforge/harness-env-registry'
 * ctx.plugin(EnvRegistry)
 * // ctx.envRegistry.summary() / ctx.envRegistry.lookup('FF_GLOBAL_CONFIG_ROOT')
 * ```
 *
 * @module @flowforge/harness-env-registry
 */

import { Context, Service } from '@flowforge/cordis';

import {
  ENV_CATEGORIES,
  ENV_VARS,
  buildEnvSummary,
  filterSensitiveEditableKeys,
  hasSensitiveEditableVars,
  isEditableEnvVar,
  isEditableEnvVarName,
  isSensitiveEditableEnvVar,
  maskUrlCredentials,
  type EnvCategory,
  type EnvDefinition,
} from './env-registry.js';

export * from './env-registry.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** env 注册表域（C39）：单一事实源 + 汇总掩码 + 可编辑策略 */
    envRegistry: EnvRegistryService;
  }
}

/** buildEnvSummary 的返回项：注册表条目 + 当前值（掩码后）。 */
export type EnvSummaryEntry = EnvDefinition & { currentValue: string | null };

/**
 * env 注册表服务 — 挂载 `ctx.envRegistry`。
 *
 * 提供：
 *   - summary()：全部可见条目的当前值汇总（敏感/URL 掩码）
 *   - lookup(name)：按名查注册表条目
 *   - editable(name) / sensitiveEditable(name)：可编辑性判定
 *   - maskUrlCredentials(raw)：URL 凭据掩码工具
 */
export class EnvRegistryService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'envRegistry');
  }

  /** 注册表全量条目（只读引用）。 */
  entries(): readonly EnvDefinition[] {
    return ENV_VARS;
  }

  /** 按名查注册表条目（未注册返回 undefined）。 */
  lookup(name: string): EnvDefinition | undefined {
    return ENV_VARS.find((def) => def.name === name);
  }

  /** 类别展示名映射。 */
  categories(): Record<EnvCategory, string> {
    return { ...ENV_CATEGORIES };
  }

  /** 汇总当前值（sensitive → '***'，url → 掩码凭据，未设置 → null）。 */
  summary(): EnvSummaryEntry[] {
    return buildEnvSummary();
  }

  /** 该变量名是否可运行期编辑（注册 + hub 可见 + 策略允许）。 */
  editable(name: string): boolean {
    return isEditableEnvVarName(name);
  }

  /** 该变量是否敏感且 opt-in 可编辑（需 owner 门禁）。 */
  sensitiveEditable(name: string): boolean {
    const def = this.lookup(name);
    return def !== undefined && isSensitiveEditableEnvVar(def);
  }

  /** 给定变量名集合中是否存在敏感可编辑项。 */
  hasSensitiveEditable(names: Iterable<string>): boolean {
    return hasSensitiveEditableVars(names);
  }

  /** 从给定变量名中筛出敏感可编辑项（审计过滤）。 */
  filterSensitiveEditable(names: Iterable<string>): string[] {
    return filterSensitiveEditableKeys(names);
  }

  /** URL 凭据掩码工具（用户名 → ***，密码清空；非 URL → ***）。 */
  maskUrlCredentials(raw: string): string {
    return maskUrlCredentials(raw);
  }
}

export default EnvRegistryService;

/** 便捷引用（类型/常量直达）。 */
export { ENV_CATEGORIES, ENV_VARS, isEditableEnvVar, isSensitiveEditableEnvVar };

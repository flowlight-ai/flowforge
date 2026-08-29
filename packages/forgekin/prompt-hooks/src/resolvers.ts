/**
 * Resolver Registry — C41（F237 Phase 2-B）。
 *
 * clowder-ai 原版内置 46 个 cats 业务专属 resolver（S1-S13/B1/C1/D1-D21/
 * R1-R2/N1），依赖猫目录/路由状态。flowforge 插件化改造决策：
 *   - 不直接移植业务 resolver，改为提供通用内置 resolver + 注册表 API：
 *     - alwaysFire：无条件触发（无 resolver 的 hook 默认路径）
 *     - inputGated：按 AssemblerInput 字段判定（存在/非空/等值）
 *     - variantPicker：按输入字段选择 TEMPLATE_VARIANT（D7/D15 多模板模式）
 *   - 宿主通过 registerResolver(hookId, resolver) 注入业务判定逻辑
 *   - ResolverRegistry 类实例化持有（无模块级单例），随插件生命周期
 */

import type { AssemblerInput, HookResolver, ResolveResult } from './types.js';

// ---------------------------------------------------------------------------
// 通用内置 resolvers（无业务依赖，纯函数）
// ---------------------------------------------------------------------------

/** 无条件触发 — 无 vars（无 resolver 的 hook 走此路径）。 */
export const alwaysFireResolver: HookResolver = {
  resolve(): ResolveResult {
    return { status: 'fired', vars: {} };
  },
};

/** 按输入字段判定：字段存在且（可选）非空时触发。 */
export class InputGatedResolver implements HookResolver {
  constructor(
    private readonly options: {
      /** 必须存在的字段（input[field] !== undefined）。缺省空数组。 */
      requireFields?: readonly string[];
      /** 必须非空的字段（input[field] 为 null/''/空数组时跳过）。 */
      requireNonEmptyFields?: readonly string[];
      /** 等值约束：字段 → 期望值。 */
      equals?: Readonly<Record<string, unknown>>;
      /** 跳过 reasonCode（缺省 'condition_not_met'）。 */
      reasonCode?: string;
    },
  ) {}

  resolve(input: AssemblerInput): ResolveResult {
    const inputAny = input as unknown as Record<string, unknown>;

    for (const field of this.options.requireFields ?? []) {
      if (inputAny[field] === undefined) {
        return {
          status: 'skipped',
          reasonCode: this.options.reasonCode ?? 'condition_not_met',
          reason: `Input field '${field}' is missing`,
        };
      }
    }

    for (const field of this.options.requireNonEmptyFields ?? []) {
      const value = inputAny[field];
      const empty =
        value === null ||
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && value.length === 0);
      if (empty) {
        return {
          status: 'skipped',
          reasonCode: this.options.reasonCode ?? 'condition_not_met',
          reason: `Input field '${field}' is empty`,
        };
      }
    }

    for (const [field, expected] of Object.entries(this.options.equals ?? {})) {
      if (inputAny[field] !== expected) {
        return {
          status: 'skipped',
          reasonCode: this.options.reasonCode ?? 'condition_not_met',
          reason: `Input field '${field}' != expected value`,
        };
      }
    }

    return { status: 'fired', vars: {} };
  }
}

/** 按输入字段选择模板变体（D7/D15 多模板模式）。 */
export class VariantPickerResolver implements HookResolver {
  constructor(
    private readonly options: {
      /** 判定字段（如 mode）。 */
      field: string;
      /** 字段值 → 变体段 id（如 mode='serial' → 'D7-mode-serial'）。 */
      variants: Readonly<Record<string, string>>;
      /** 无匹配时的缺省变体（缺省 = hookId 本身）。 */
      defaultVariant?: string;
    },
  ) {}

  resolve(input: AssemblerInput): ResolveResult {
    const value = (input as unknown as Record<string, unknown>)[this.options.field];
    const variant = this.options.variants[String(value)];
    if (!variant) {
      return {
        status: 'fired',
        vars: this.options.defaultVariant ? { TEMPLATE_VARIANT: this.options.defaultVariant } : {},
      };
    }
    return { status: 'fired', vars: { TEMPLATE_VARIANT: variant } };
  }
}

/** CONTENT 直通：组装好的内容直接作为补丁输出（S6/S13 模式）。 */
export class ContentPassthroughResolver implements HookResolver {
  constructor(
    private readonly options: {
      /** 内容来源字段（input[field] 非空时触发并作为 CONTENT）。 */
      field: string;
    },
  ) {}

  resolve(input: AssemblerInput): ResolveResult {
    const value = (input as unknown as Record<string, unknown>)[this.options.field];
    if (value === undefined || value === null || value === '') {
      return {
        status: 'skipped',
        reasonCode: 'content_unavailable',
        reason: `Content field '${this.options.field}' is empty`,
      };
    }
    return { status: 'fired', vars: { CONTENT: String(value) } };
  }
}

// ---------------------------------------------------------------------------
// ResolverRegistry — 实例化注册表（插件生命周期持有）
// ---------------------------------------------------------------------------

export class ResolverRegistry {
  private readonly map = new Map<string, HookResolver>();

  /** 注册 hookId → resolver（覆盖同名已有项）。 */
  registerResolver(hookId: string, resolver: HookResolver): void {
    this.map.set(hookId, resolver);
  }

  /** 批量注册（如宿主导入的 46 个业务 resolver 表）。 */
  registerResolvers(resolvers: Readonly<Record<string, HookResolver>>): void {
    for (const [hookId, resolver] of Object.entries(resolvers)) {
      this.map.set(hookId, resolver);
    }
  }

  /** 取 resolver（未注册返回 undefined → 管线按无条件触发处理）。 */
  getResolver(hookId: string): HookResolver | undefined {
    return this.map.get(hookId);
  }

  /** 已注册 resolver ID 列表。 */
  getRegisteredResolverIds(): readonly string[] {
    return [...this.map.keys()];
  }

  /** 已注册数量。 */
  size(): number {
    return this.map.size;
  }

  /** 只读快照（供 HookPipeline 构造）。 */
  toReadonlyMap(): ReadonlyMap<string, HookResolver> {
    return new Map(this.map);
  }

  /** 清空（测试用）。 */
  clear(): void {
    this.map.clear();
  }
}

/**
 * cats-catalog 端口与类型（C37/C38）。
 *
 * 插件化改造决策（对照 clowder 强依赖）：
 * - `McpCapabilitiesInheritor`：能力继承钩子端口（对应 clowder
 *   capabilities/capability-orchestrator.ts `inheritFullyBlockedMcpCapabilitiesForNewCatsSync`），
 *   缺省 noop — catalog 域不直接读写 capabilities 文件
 * - `CatalogCacheInvalidator`：配置缓存清理端口（对应 clowder cat-config-loader
 *   `_resetCachedConfig` + cat-budgets/clearBudgetCache + cat-voices/clearVoiceCache），
 *   缺省 noop — C40 cat-config-loader 接入时由宿主注入
 * - `CatalogFileValidator`：写入前校验端口（对应 clowder cat-config-loader `loadCatConfig`），
 *   缺省内置校验（JSON 解析 + toAllCatConfigs duplicate-catId + mention alias 唯一性）
 */

import type { CatCafeConfig } from '@flowforge/cats-shared';

/** 通用 record 别名（墓碑/迁移操作的对象形态）。 */
export type RecordOf = Record<string, unknown>;

/** F161: ACP 传输配置（原 clowder `config/cat-config-loader.ts` AcpVariantConfig）。 */
export interface AcpVariantConfig {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}

/** 能力继承钩子端口：新 cat 回填后调用（缺省 noop）。 */
export type McpCapabilitiesInheritor = (
  projectRoot: string,
  newCatIds: readonly string[],
  existingCatIds: ReadonlySet<string>,
) => boolean;

/** 配置缓存清理端口（缺省 noop）。 */
export type CatalogCacheInvalidator = () => void;

/** 写入前校验端口：解析 + 校验 catalog 文件（抛错即拒绝写入）。 */
export type CatalogFileValidator = (catalogJsonPath: string) => CatCafeConfig;

export const noopMcpCapabilitiesInheritor: McpCapabilitiesInheritor = () => false;

export const noopCacheInvalidator: CatalogCacheInvalidator = () => {};

/** 模块级端口（可被宿主替换；缺省内置实现见 runtime-cat-catalog.ts）。 */
export const catalogPorts: {
  mcpCapabilitiesInheritor: McpCapabilitiesInheritor;
  cacheInvalidator: CatalogCacheInvalidator;
  catalogFileValidator: CatalogFileValidator;
} = {
  mcpCapabilitiesInheritor: noopMcpCapabilitiesInheritor,
  cacheInvalidator: noopCacheInvalidator,
  catalogFileValidator: defaultCatalogFileValidator,
};

/** 缺省校验器占位 — 由 runtime-cat-catalog.ts 注册真实实现（避免循环依赖）。 */
export function defaultCatalogFileValidator(_catalogJsonPath: string): CatCafeConfig {
  throw new Error('cats-catalog: defaultCatalogFileValidator not wired');
}

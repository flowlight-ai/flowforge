/**
 * @flowforge/cats-cat-config-loader — Cat 配置加载器 + .cat-cafe 运行态 JSON（C38/C40）。
 *
 * TS 移植自 clowder-ai `config/cat-config-loader.ts` + `.cat-cafe/` 运行态文件：
 *   - schema：zod v1/v2 版本化配置 + deepMergeConfig 原子键/深度合并语义
 *   - loader：cat-template.json base + .cat-cafe/cat-catalog.json overlay
 *     合并加载（模板 breed 过滤）+ 显式文件直读
 *   - accessors：roster/reviewPolicy/coCreator/sessionChain/可用性等无缓存访问器
 *   - runtime-json：accounts/capabilities/user-preferences/mcp-resolved 运行态
 *     文档 zod 校验 + tmp+rename 原子写
 *
 * @module @flowforge/cats-cat-config-loader
 */

import { Context, Service } from '@flowforge/cordis';

import { loadCatConfig, loadResolvedCatConfig, type CatConfigLoaderDeps } from './loader.ts';
import { RuntimeJsonStore, type RuntimeJsonStoreDeps } from './runtime-json.ts';
import type { CatCafeConfig } from './schema.ts';

export {
  catHasRole,
  findCatVariant,
  getCatFamily,
  getCoCreatorConfig,
  getCoCreatorMentionPatterns,
  getReviewPolicy,
  getRoster,
  isCatAvailable,
  isCatLead,
  isSessionChainEnabled,
  resolveCatId,
  resolveVariantMentionPatterns,
} from './accessors.ts';
export { loadCatConfig, loadResolvedCatConfig, mergeTemplateWithCatalog } from './loader.ts';
export type { CatConfigLoaderDeps } from './loader.ts';
export {
  RuntimeJsonStore,
  runtimeAccountSchema,
  runtimeCapabilitySchema,
  runtimeFileName,
  runtimeMcpResolvedSchema,
  runtimeUserPreferencesSchema,
  type RuntimeAccount,
  type RuntimeCapability,
  type RuntimeFileKind,
  type RuntimeJsonStoreDeps,
  type RuntimeMcpResolved,
  type RuntimeTypedKind,
  type RuntimeUserPreferences,
} from './runtime-json.ts';
export {
  catCafeConfigSchema,
  deepMergeConfig,
  getDefaultVariant,
  parseCatConfig,
  type CatBreed,
  type CatCafeConfig,
  type CatVariant,
  type CoCreatorConfig,
  type ReviewPolicy,
  type Roster,
  type RosterEntry,
} from './schema.ts';

declare module '@flowforge/cordis' {
  interface Context {
    /** Cat 配置加载器（C40）+ .cat-cafe 运行态 JSON（C38）。 */
    forgeCatConfigLoader: CatConfigLoaderService;
  }
}

export interface CatConfigLoaderServiceOptions {
  /** 显式模板路径或注入 fs/env。 */
  loader?: CatConfigLoaderDeps;
  /** .cat-cafe 运行态 JSON 存储。 */
  runtimeJsonBaseDir?: string;
  runtimeJson?: RuntimeJsonStoreDeps;
}

export class CatConfigLoaderService extends Service {
  readonly loader: CatConfigLoaderDeps;
  readonly runtimeJson: RuntimeJsonStore | undefined;

  constructor(ctx: Context, options: CatConfigLoaderServiceOptions = {}) {
    super(ctx, 'forgeCatConfigLoader');
    this.loader = options.loader ?? {};
    this.runtimeJson = options.runtimeJsonBaseDir
      ? new RuntimeJsonStore(options.runtimeJsonBaseDir, options.runtimeJson ?? {})
      : undefined;
  }

  /** 加载解析后的 cat 配置（模板 + catalog overlay）。 */
  loadResolved(): CatCafeConfig {
    return loadResolvedCatConfig(this.loader);
  }

  /** 显式文件直读。 */
  loadFrom(filePath: string): CatCafeConfig {
    return loadCatConfig(filePath, this.loader);
  }
}

export default CatConfigLoaderService;

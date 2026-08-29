/**
 * @flowforge/cats-catalog — C37/C38 档案目录与 .cat-cafe 运行态 JSON Cordis 插件。
 *
 * TS 移植自 clowder-ai `config/`（cat-catalog-store / catalog-accounts /
 * user-preferences-store / runtime-cat-catalog / cat-catalog-bootstrap-roster /
 * template-variant-backfill / template-variant-tombstones）：
 *   - cat-catalog.json：bootstrap（种子 breed + roster 裁剪）/ P5 变体迁移 /
 *     模板回填白名单 / 墓碑 / 原子写（temp+rename）
 *   - accounts.json：全局账号 + provider-profiles/项目段/homedir 凭据迁移
 *   - user-preferences.json：共享偏好 + messageDisposition 三作用域解析
 *   - runtime CRUD：create/update/delete cat + co-creator，mention alias 唯一性 +
 *     duplicate catId + defaultVariantId/mentionPatterns 校验
 *
 * 插件化改造决策：
 *   - `McpCapabilitiesInheritor` 端口注入（缺省 noop；capabilities 域由宿主接入）
 *   - `CatalogCacheInvalidator` 端口注入（缺省 noop；C40 cat-config-loader 接入）
 *   - `CatalogFileValidator` 端口（内置 parseCatConfig 关键不变量，可被宿主覆盖）
 *   - env 改名 FF_* 系（R17）：FF_GLOBAL_CONFIG_ROOT / FF_TEMPLATE_PATH /
 *     FF_DEFAULT_CAT_ID / FF_SKIP_HOMEDIR_MIGRATION / FF_TEST_SANDBOX*
 *
 * 消费者加载默认插件：
 * ```ts
 * import CatsCatalog from '@flowforge/cats-catalog'
 * ctx.plugin(CatsCatalog)
 * // ctx.catsCatalog.read(projectRoot) / .bootstrap(projectRoot, templatePath)
 * // .accounts(projectRoot) / .preferences(projectRoot) / .createCat(...)
 * ```
 *
 * @module @flowforge/cats-catalog
 */

import { Context, Service } from '@flowforge/cordis';
import type { AccountConfig, CatCafeConfig, UserPreferences } from '@flowforge/cats-shared';

import { bootstrapCatCatalog, readCatCatalog, readCatCatalogRaw, writeCatCatalog } from './cat-catalog-store.js';
import { deleteCatalogAccount, readCatalogAccounts, writeCatalogAccount } from './catalog-accounts.js';
import { readUserPreferences, updateUserPreferences } from './user-preferences-store.js';
import {
  createRuntimeCat,
  deleteRuntimeCat,
  readRuntimeCatCatalog,
  refreshRuntimeCatCatalogCaches,
  resolveProjectTemplatePath,
  updateRuntimeCat,
  updateRuntimeCoCreator,
  validateCatalogFile,
  type RuntimeCatInput,
  type RuntimeCatUpdate,
  type RuntimeCoCreatorUpdate,
} from './runtime-cat-catalog.js';
import type {
  CatalogCacheInvalidator,
  CatalogFileValidator,
  McpCapabilitiesInheritor,
} from './types.js';
import { catalogPorts, noopCacheInvalidator, noopMcpCapabilitiesInheritor } from './types.js';
import { resolveMessageDispositionPreference, saveMessageDispositionPreference } from './user-preferences-store.js';
import type { MessageDispositionPreferenceSnapshot, MessageWorkDisposition } from '@flowforge/cats-shared';

// Re-export 核心实现 + 类型。
export { bootstrapCatCatalog, readCatCatalog, readCatCatalogRaw, writeCatCatalog, isBuiltinClientId } from './cat-catalog-store.js';
export { resolveCatCatalogPath } from './cat-catalog-store.js';
export {
  deleteCatalogAccount,
  hasLegacyProviderProfiles,
  readCatalogAccounts,
  resetMigrationState,
  writeCatalogAccount,
} from './catalog-accounts.js';
export { resolveAccountsPath } from './catalog-accounts.js';
export {
  MESSAGE_DISPOSITION_PRODUCT_DEFAULT,
  readUserPreferences,
  resolveMessageDispositionPreference,
  saveMessageDispositionPreference,
  updateUserPreferences,
} from './user-preferences-store.js';
export {
  assertNoDuplicateCatIds,
  createRuntimeCat,
  deleteRuntimeCat,
  readRuntimeCatCatalog,
  refreshRuntimeCatCatalogCaches,
  resolveProjectTemplatePath,
  updateRuntimeCat,
  updateRuntimeCoCreator,
  validateCatalogFile,
} from './runtime-cat-catalog.js';
export type { RuntimeCatInput, RuntimeCatUpdate, RuntimeCoCreatorUpdate } from './runtime-cat-catalog.js';
export { pickSeedBreed, pruneRosterToRuntimeBreeds } from './cat-catalog-bootstrap-roster.js';
export type { RuntimeBreedWithCatIds } from './cat-catalog-bootstrap-roster.js';
export {
  hasOccupiedMentionAlias,
  isTemplateBreedBackfillAllowed,
  isTemplateVariantBackfillAllowed,
  normalizeMentionAlias,
} from './template-variant-backfill.js';
export type { TemplateBreedBackfillInput, TemplateVariantBackfillInput } from './template-variant-backfill.js';
export {
  TEMPLATE_VARIANT_TOMBSTONES_KEY,
  addTemplateVariantTombstone,
  collectTemplateVariantTombstoneCatIds,
  isTemplateVariantTombstoned,
} from './template-variant-tombstones.js';
export type { TemplateVariantTombstoneInput } from './template-variant-tombstones.js';
export type { AcpVariantConfig, CatalogCacheInvalidator, CatalogFileValidator, McpCapabilitiesInheritor } from './types.js';
export { catalogPorts } from './types.js';

declare module '@flowforge/cordis' {
  interface Context {
    /** 档案目录 + 运行态 JSON 域（C37/C38）：catalog / accounts / preferences / runtime CRUD */
    catsCatalog: CatalogService;
  }
}

/**
 * catalog 域服务 — 组装 C37/C38 文件层工厂。
 *
 * 挂载 `ctx.catsCatalog`，提供：
 *   - bootstrap(projectRoot, templatePath?)：cat-catalog.json 引导/升级修复
 *   - read(projectRoot) / readRaw(projectRoot) / write(projectRoot, catalog)
 *   - accounts(projectRoot) / writeAccount / deleteAccount
 *   - preferences(projectRoot) / updatePreferences / disposition 三件套
 *   - createCat / updateCat / deleteCat / updateCoCreator / refreshCaches
 *   - setMcpCapabilitiesInheritor / setCacheInvalidator / setCatalogFileValidator
 *     （端口覆盖，宿主接线用）
 */
export class CatalogService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'catsCatalog');
  }

  /** cat-catalog.json 引导/升级修复（幂等）。 */
  bootstrap(projectRoot: string, templatePath?: string): string {
    const resolvedTemplate = templatePath ?? resolveProjectTemplatePath(projectRoot);
    return bootstrapCatCatalog(projectRoot, resolvedTemplate);
  }

  /** 读取运行态目录（含一次 P5 迁移）。 */
  read(projectRoot: string): CatCafeConfig | null {
    return readCatCatalog(projectRoot);
  }

  /** 读取原始 JSON 字符串（迁移后可能重写）。 */
  readRaw(projectRoot: string): string | null {
    return readCatCatalogRaw(projectRoot);
  }

  /** 直接写入目录（不做校验；CRUD 路径请用 createCat/updateCat）。 */
  write(projectRoot: string, catalog: CatCafeConfig): string {
    return writeCatCatalog(projectRoot, catalog);
  }

  /** 读取运行态目录（read-or-bootstrap，缺失即引导）。 */
  readRuntime(projectRoot: string): CatCafeConfig {
    return readRuntimeCatCatalog(projectRoot);
  }

  /** 全局账号（含全部迁移，每进程每源一次）。 */
  accounts(projectRoot: string): Record<string, AccountConfig> {
    return readCatalogAccounts(projectRoot);
  }

  /** 写单个账号。 */
  writeAccount(projectRoot: string, ref: string, account: AccountConfig): void {
    writeCatalogAccount(projectRoot, ref, account);
  }

  /** 删除账号（不存在则忽略）。 */
  deleteAccount(projectRoot: string, ref: string): void {
    deleteCatalogAccount(projectRoot, ref);
  }

  /** 共享偏好读取。 */
  preferences(projectRoot: string): UserPreferences {
    return readUserPreferences(projectRoot);
  }

  /** 共享偏好更新（update 函数形态，崩溃安全 temp+rename）。 */
  updatePreferences(projectRoot: string, update: (current: UserPreferences) => UserPreferences): UserPreferences {
    return updateUserPreferences(projectRoot, update);
  }

  /** messageDisposition 解析（thread → global → product 缺省 next_work）。 */
  disposition(projectRoot: string, threadId?: string): MessageDispositionPreferenceSnapshot {
    return resolveMessageDispositionPreference(projectRoot, threadId);
  }

  /** messageDisposition 保存（global/thread/onboarding 三作用域）。 */
  saveDisposition(
    projectRoot: string,
    input:
      | { scope: 'global'; disposition: MessageWorkDisposition | null }
      | { scope: 'thread'; threadId: string; disposition: MessageWorkDisposition | null }
      | { scope: 'onboarding'; seen: true },
  ): MessageDispositionPreferenceSnapshot {
    return saveMessageDispositionPreference(projectRoot, input);
  }

  /** 运行时创建猫（查重 + 校验写）。 */
  createCat(projectRoot: string, input: RuntimeCatInput): CatCafeConfig {
    return createRuntimeCat(projectRoot, input);
  }

  /** 运行时更新猫（默认变体写 breed 身份 / 多变体独立字段）。 */
  updateCat(projectRoot: string, catId: string, patch: RuntimeCatUpdate): CatCafeConfig {
    return updateRuntimeCat(projectRoot, catId, patch);
  }

  /** 运行时删除猫（变体/breed + roster + 模板墓碑）。 */
  deleteCat(projectRoot: string, catId: string): CatCafeConfig {
    return deleteRuntimeCat(projectRoot, catId);
  }

  /** 运行时更新 co-creator（v2 owner 配置）。 */
  updateCoCreator(projectRoot: string, patch: RuntimeCoCreatorUpdate): CatCafeConfig {
    return updateRuntimeCoCreator(projectRoot, patch);
  }

  /** 清理下游配置缓存（端口）。 */
  refreshCaches(): void {
    refreshRuntimeCatCatalogCaches();
  }

  /** 覆盖 MCP 能力继承钩子端口（缺省 noop）。 */
  setMcpCapabilitiesInheritor(inheritor: McpCapabilitiesInheritor): void {
    catalogPorts.mcpCapabilitiesInheritor = inheritor;
  }

  /** 覆盖配置缓存清理端口（缺省 noop）。 */
  setCacheInvalidator(invalidator: CatalogCacheInvalidator): void {
    catalogPorts.cacheInvalidator = invalidator;
  }

  /** 覆盖写入前校验端口（缺省内置 parseCatConfig 关键不变量）。 */
  setCatalogFileValidator(validator: CatalogFileValidator): void {
    catalogPorts.catalogFileValidator = validator;
  }

  /** 复位端口为缺省（测试用）。 */
  resetPorts(): void {
    catalogPorts.mcpCapabilitiesInheritor = noopMcpCapabilitiesInheritor;
    catalogPorts.cacheInvalidator = noopCacheInvalidator;
    catalogPorts.catalogFileValidator = validateCatalogFile;
  }
}

export default CatalogService;

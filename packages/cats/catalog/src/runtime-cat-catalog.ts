/**
 * 运行时猫档案 CRUD（C37）。
 *
 * TS 移植自 clowder-ai `config/runtime-cat-catalog.ts`（641 行）：
 *   - readRuntimeCatCatalog：read-or-bootstrap
 *   - createRuntimeCat：catId 查重 + breed 构建 + v2 roster 条目 + 校验写
 *   - updateRuntimeCat：默认变体写 breed 身份、多变体写 variant 独立字段
 *     （displayName-only patch 快照 name 防 P2 名随显示名漂移）
 *   - updateRuntimeCoCreator：owner 配置归一化
 *   - deleteRuntimeCat：变体/breed 删除 + roster 清理 + 模板变体墓碑
 *
 * 插件化改造决策（对照 clowder 强依赖）：
 *   - `loadCatConfig` 校验 → 内置 `validateCatalogFile`（parseCatConfig 关键不变量：
 *     defaultVariantId 引用存在 / mentionPatterns 非空 / duplicate catId），并注册到
 *     `catalogPorts.catalogFileValidator` 供外部覆盖（C40 cat-config-loader 接入）
 *   - `toAllCatConfigs` duplicate-catId 硬错误 → `assertNoDuplicateCatIds` 纯函数
 *   - `_resetCachedConfig/clearBudgetCache/clearVoiceCache` → `catalogPorts.cacheInvalidator`
 *   - `resolveProjectTemplatePath` → 内置（FF_TEMPLATE_PATH env 覆盖，逃逸防护）
 *   - `AcpVariantConfig` → 本包 types.ts 定义
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type {
  CatBreed,
  CatCafeConfig,
  CatColor,
  CliConfig,
  ClientId,
  CoCreatorConfig,
  ContextBudget,
  Roster,
  VoiceConfig,
} from '@flowforge/cats-shared';
import { createCatId } from '@flowforge/cats-shared';

import { bootstrapCatCatalog, readCatCatalog, resolveCatCatalogPath } from './cat-catalog-store.js';
import { isRecord, readJsonFile, writeAtomicVia } from './fs-utils.js';
import { addTemplateVariantTombstone, type TemplateVariantTombstoneInput } from './template-variant-tombstones.js';
import { catalogPorts, type AcpVariantConfig } from './types.js';

export interface RuntimeCatInput {
  catId: string;
  breedId?: string;
  name: string;
  displayName: string;
  variantLabel?: string;
  nickname?: string;
  avatar: string;
  color: CatColor;
  mentionPatterns: string[];
  accountRef?: string;
  roleDescription: string;
  personality?: string;
  teamStrengths?: string;
  caution?: string | null;
  strengths?: string[];
  sessionChain?: boolean;
  clientId: ClientId;
  defaultModel: string;
  mcpSupport: boolean;
  /** F247 KD-17: cloud-only cats (Remote MCP) omit cli to skip local dispatch. */
  cli?: CliConfig;
  commandArgs?: string[];
  cliConfigArgs?: string[];
  contextBudget?: ContextBudget;
  voiceConfig?: VoiceConfig;
  /** clowder-ai#340 P5: Model provider name (renamed from ocProviderName). */
  provider?: string;
  /** F161: ACP transport config — presence triggers ACP transport instead of CLI. */
  acp?: AcpVariantConfig;
}

export interface RuntimeCatUpdate {
  name?: string;
  displayName?: string;
  variantLabel?: string | null;
  nickname?: string;
  avatar?: string;
  color?: CatColor;
  mentionPatterns?: string[];
  accountRef?: string | null;
  roleDescription?: string;
  personality?: string;
  teamStrengths?: string;
  caution?: string | null;
  strengths?: string[];
  sessionChain?: boolean;
  clientId?: ClientId;
  defaultModel?: string;
  mcpSupport?: boolean;
  /** F247 KD-17: cli null to remove (cloud-only mode), CliConfig to update, undefined to skip. */
  cli?: CliConfig | null;
  commandArgs?: string[];
  cliConfigArgs?: string[];
  contextBudget?: ContextBudget | null;
  voiceConfig?: VoiceConfig | null;
  /** clowder-ai#340 P5: Model provider name (renamed from ocProviderName). */
  provider?: string | null;
  available?: boolean;
  /** F161: ACP transport config — null to remove, undefined to skip. */
  acp?: AcpVariantConfig | null;
}

export interface RuntimeCoCreatorUpdate {
  name?: string;
  aliases?: string[];
  mentionPatterns?: string[];
  timeZone?: string;
  avatar?: string | null;
  color?: CatColor | null;
}

interface BreedVariantLocation {
  breedIndex: number;
  variantIndex: number;
  breed: RecordOf;
  variant: RecordOf;
  resolvedCatId: string;
  isDefaultVariant: boolean;
}

type RecordOf = Record<string, unknown>;

/** 解析模板路径（FF_TEMPLATE_PATH env 覆盖；必须位于 projectRoot 内）。 */
export function resolveProjectTemplatePath(projectRoot: string): string {
  const envPath = process.env.FF_TEMPLATE_PATH?.trim();
  if (envPath) {
    const resolvedEnvPath = resolve(envPath);
    const rel = relative(resolve(projectRoot), resolvedEnvPath);
    if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')) return resolvedEnvPath;
  }
  return resolve(projectRoot, 'cat-template.json');
}

function normalizeMentionPatterns(_catId: string, mentionPatterns: readonly string[]): string[] {
  const values = mentionPatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => (pattern.startsWith('@') ? pattern : `@${pattern}`));
  return Array.from(new Set(values));
}

function normalizeCoCreatorMentionPatterns(mentionPatterns: readonly string[]): string[] {
  const values = mentionPatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
    .map((pattern) => (pattern.startsWith('@') ? pattern : `@${pattern}`));
  return Array.from(new Set(values));
}

function findTemplateVariantTombstoneInput(projectRoot: string, catId: string): TemplateVariantTombstoneInput | null {
  const template = readJsonFile<{ breeds?: Array<RecordOf> }>(resolveProjectTemplatePath(projectRoot));
  if (!template || !Array.isArray(template.breeds)) return null;

  for (const breedUnknown of template.breeds) {
    if (!isRecord(breedUnknown)) continue;
    if (typeof breedUnknown.id !== 'string') continue;
    const breedCatId = typeof breedUnknown.catId === 'string' ? breedUnknown.catId : undefined;
    const variants = Array.isArray(breedUnknown.variants) ? breedUnknown.variants : [];
    for (const variantUnknown of variants) {
      if (!isRecord(variantUnknown)) continue;
      if (typeof variantUnknown.id !== 'string') continue;
      const resolvedCatId = typeof variantUnknown.catId === 'string' ? variantUnknown.catId : breedCatId;
      if (resolvedCatId !== catId) continue;
      return {
        breedId: breedUnknown.id,
        variantId: variantUnknown.id,
        catId: resolvedCatId,
      };
    }
  }
  return null;
}

function readOrBootstrapCatalog(projectRoot: string): CatCafeConfig {
  const templatePath = resolveProjectTemplatePath(projectRoot);
  bootstrapCatCatalog(projectRoot, templatePath);
  const catalog = readCatCatalog(projectRoot);
  if (!catalog) {
    throw new Error(`Runtime cat catalog missing at ${projectRoot}`);
  }
  return catalog;
}

/**
 * parseCatConfig 关键不变量校验（clowder cat-config-loader 对应部分）：
 *   - JSON 可解析
 *   - 每个 breed 的 defaultVariantId 必须引用存在的 variant
 *   - 每个 breed 的 mentionPatterns 至少一项
 *   - 展开全部 variant 后 catId 全局唯一（duplicate = 硬错误）
 * 返回规范化 catalog（结构化拷贝）。
 */
export function validateCatalogFile(catalogJsonPath: string): CatCafeConfig {
  const raw = readFileSync(catalogJsonPath, 'utf-8');
  const catalog = JSON.parse(raw) as CatCafeConfig;
  for (const breed of catalog.breeds) {
    const found = breed.variants.find((variant) => variant.id === breed.defaultVariantId);
    if (!found) {
      throw new Error(`Breed "${breed.id}": defaultVariantId "${breed.defaultVariantId}" not found in variants`);
    }
    if (breed.mentionPatterns.length === 0) {
      throw new Error(`Breed "${breed.id}": mentionPatterns must have at least one entry`);
    }
  }
  assertNoDuplicateCatIds(catalog);
  return structuredClone(catalog) as CatCafeConfig;
}

/** F32-b R3: catId uniqueness — duplicate is a hard error (startup failure). */
export function assertNoDuplicateCatIds(catalog: CatCafeConfig): void {
  const seen = new Map<string, string>();
  for (const breed of catalog.breeds) {
    const breedCatId = breed.catId;
    for (const variant of breed.variants) {
      const catId = variant.catId ?? breedCatId;
      if (!catId) continue;
      const holder = seen.get(catId);
      if (holder) {
        throw new Error(
          `Duplicate catId "${catId}": variant "${variant.id}" in breed "${breed.id}" ` +
            `conflicts with already registered cat in breed "${holder}". Each variant must have a unique catId.`,
        );
      }
      seen.set(catId, breed.id);
    }
  }
}

/** 注册内置校验器（可被宿主覆盖，C40 cat-config-loader 接入时替换）。 */
catalogPorts.catalogFileValidator = validateCatalogFile;

function invalidateRuntimeCatalogCaches(): void {
  catalogPorts.cacheInvalidator();
}

function validatePersistedCatalog(projectRoot: string): CatCafeConfig {
  invalidateRuntimeCatalogCaches();
  return catalogPorts.catalogFileValidator(join(projectRoot, '.cat-cafe', 'cat-catalog.json'));
}

function assertUniqueMentionAliases(catalog: CatCafeConfig): void {
  const aliasHolders = new Map<string, string>();
  for (const breed of catalog.breeds) {
    for (const variant of breed.variants) {
      const catId = variant.catId ?? breed.catId;
      if (!catId) continue;
      const isDefault = variant.id === breed.defaultVariantId;
      const mentionPatterns =
        variant.mentionPatterns && variant.mentionPatterns.length > 0
          ? variant.mentionPatterns
          : isDefault
            ? breed.mentionPatterns
            : [`@${catId}`];
      for (const mentionPattern of mentionPatterns) {
        const trimmed = mentionPattern.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        const holder = aliasHolders.get(key);
        if (holder && holder !== catId) {
          throw new Error(`mention alias "${trimmed}" is already used by cat "${holder}"`);
        }
        aliasHolders.set(key, catId);
      }
    }
  }

  const coCreatorMentionPatterns = catalog.version === 2 ? (catalog.coCreator?.mentionPatterns ?? []) : [];
  for (const mentionPattern of coCreatorMentionPatterns) {
    const trimmed = mentionPattern.trim();
    if (!trimmed) continue;
    const holder = aliasHolders.get(trimmed.toLowerCase());
    if (holder) {
      throw new Error(`co-creator mention alias "${trimmed}" conflicts with cat "${holder}"`);
    }
  }
}

function writeAndValidateCatalog(projectRoot: string, catalog: unknown): CatCafeConfig {
  const candidate = catalog as CatCafeConfig;
  assertUniqueMentionAliases(candidate);
  const catalogPath = resolveCatCatalogPath(projectRoot);
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeAtomicVia(catalogPath, (tempPath) => {
    // Validate the candidate against the temp file before rename (crash-safe swap).
    writeFileSync(tempPath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf-8');
    validateCatalogFile(tempPath);
  });
  return validatePersistedCatalog(projectRoot);
}

function findBreedVariant(catalog: CatCafeConfig, catId: string): BreedVariantLocation | null {
  for (const [breedIndex, breed] of catalog.breeds.entries()) {
    for (const [variantIndex, variant] of breed.variants.entries()) {
      const resolvedCatId = variant.catId ?? breed.catId;
      if (resolvedCatId !== catId) continue;
      return {
        breedIndex,
        variantIndex,
        breed: breed as unknown as RecordOf,
        variant: variant as unknown as RecordOf,
        resolvedCatId,
        isDefaultVariant: variant.id === breed.defaultVariantId,
      };
    }
  }
  return null;
}

function createBreedFromInput(input: RuntimeCatInput): CatBreed {
  const variantId = `${input.catId}-default`;
  return {
    id: input.breedId?.trim() || input.catId,
    catId: createCatId(input.catId),
    name: input.name,
    displayName: input.displayName,
    ...(input.nickname != null && input.nickname.trim().length > 0 ? { nickname: input.nickname.trim() } : {}),
    avatar: input.avatar,
    color: input.color,
    mentionPatterns: normalizeMentionPatterns(input.catId, input.mentionPatterns),
    roleDescription: input.roleDescription,
    defaultVariantId: variantId,
    ...(input.sessionChain !== undefined ? { features: { sessionChain: input.sessionChain } } : {}),
    variants: [
      {
        id: variantId,
        clientId: input.clientId,
        ...(input.variantLabel != null && input.variantLabel.trim().length > 0
          ? { variantLabel: input.variantLabel.trim() }
          : {}),
        defaultModel: input.defaultModel,
        mcpSupport: input.mcpSupport,
        // F247 KD-17: omit cli for cloud-only cats (Remote MCP, no local dispatch).
        ...(input.cli ? { cli: input.cli } : {}),
        ...(input.accountRef != null && input.accountRef.trim().length > 0
          ? { accountRef: input.accountRef.trim() }
          : {}),
        ...(input.commandArgs && input.commandArgs.length > 0 ? { commandArgs: input.commandArgs } : {}),
        ...(input.cliConfigArgs && input.cliConfigArgs.length > 0 ? { cliConfigArgs: input.cliConfigArgs } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.contextBudget ? { contextBudget: input.contextBudget } : {}),
        ...(input.voiceConfig !== undefined ? { voiceConfig: input.voiceConfig } : {}),
        ...(input.personality != null && input.personality.trim().length > 0 ? { personality: input.personality } : {}),
        ...(input.teamStrengths != null && input.teamStrengths.trim().length > 0
          ? { teamStrengths: input.teamStrengths.trim() }
          : {}),
        ...(input.caution !== undefined
          ? { caution: input.caution && input.caution.trim().length > 0 ? input.caution.trim() : null }
          : {}),
        ...(input.strengths ? { strengths: input.strengths } : {}),
        ...(input.acp ? { acp: input.acp } : {}),
      },
    ],
  } as unknown as CatBreed;
}

function cloneCatalog(catalog: CatCafeConfig): CatCafeConfig {
  return structuredClone(catalog) as CatCafeConfig;
}

function buildDefaultRuntimeRosterEntry(
  _catId: string,
  family: string,
  displayName: string,
  available: boolean,
): { family: string; roles: string[]; lead: false; available: boolean; evaluation: string } {
  return {
    family,
    roles: ['assistant'],
    lead: false,
    available,
    evaluation: `${displayName} runtime member`,
  };
}

export function readRuntimeCatCatalog(projectRoot: string): CatCafeConfig {
  return readOrBootstrapCatalog(projectRoot);
}

export function createRuntimeCat(projectRoot: string, input: RuntimeCatInput): CatCafeConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  if (findBreedVariant(catalog, input.catId)) {
    throw new Error(`Cat "${input.catId}" already exists in runtime catalog`);
  }
  const nextBreed = createBreedFromInput(input) as unknown as RecordOf;
  (catalog as unknown as { breeds: CatBreed[] }).breeds = [...catalog.breeds, nextBreed as unknown as CatBreed];
  if (catalog.version === 2) {
    (catalog as { roster: Roster }).roster = {
      ...catalog.roster,
      [input.catId]: buildDefaultRuntimeRosterEntry(
        input.catId,
        String(nextBreed.id ?? input.catId),
        String(nextBreed.displayName ?? nextBreed.name ?? input.catId),
        true,
      ),
    };
  }
  return writeAndValidateCatalog(projectRoot, catalog);
}

export function updateRuntimeCat(projectRoot: string, catId: string, patch: RuntimeCatUpdate): CatCafeConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  const located = findBreedVariant(catalog, catId);
  if (!located) {
    throw new Error(`Cat "${catId}" not found in runtime catalog`);
  }

  const breed = catalog.breeds[located.breedIndex] as unknown as RecordOf;
  const variant = (breed.variants as unknown as RecordOf[])[located.variantIndex] as RecordOf;
  const shouldWriteBreedIdentity = located.isDefaultVariant && (breed.variants as unknown[]).length === 1;

  if (patch.name !== undefined) {
    if (shouldWriteBreedIdentity) {
      breed.name = patch.name;
      delete variant.name;
    } else {
      variant.name = patch.name;
    }
  }
  if (patch.nickname !== undefined) {
    const nickname = patch.nickname.trim();
    if (shouldWriteBreedIdentity) {
      if (nickname.length > 0) {
        breed.nickname = nickname;
      } else {
        delete breed.nickname;
      }
      delete variant.nickname;
    } else if (nickname.length > 0) {
      variant.nickname = nickname;
    } else {
      variant.nickname = null;
    }
  }
  if (patch.roleDescription !== undefined) {
    variant.roleDescription = patch.roleDescription;
  }

  if (patch.displayName !== undefined) {
    if (shouldWriteBreedIdentity) {
      breed.displayName = patch.displayName;
      delete variant.displayName;
    } else {
      // Multi-variant breed: keep name/displayName editing independent.
      // toAllCatConfigs resolves `name` as `variant.name ?? variant.displayName ?? breed.name`;
      // if we overwrite variant.displayName without a variant.name override,
      // the resolved name silently follows the new displayName (P2 finding).
      // Snapshot the currently-resolved name into variant.name so a
      // displayName-only patch cannot alter this member's resolved name.
      if (variant.name === undefined) {
        variant.name = variant.displayName ?? breed.name;
      }
      variant.displayName = patch.displayName;
    }
  }

  if (patch.variantLabel !== undefined) {
    if (patch.variantLabel && patch.variantLabel.trim().length > 0) {
      variant.variantLabel = patch.variantLabel.trim();
    } else {
      delete variant.variantLabel;
    }
  }

  if (patch.avatar !== undefined) {
    if (located.isDefaultVariant) {
      breed.avatar = patch.avatar;
      delete variant.avatar;
    } else {
      variant.avatar = patch.avatar;
    }
  }

  if (patch.color !== undefined) {
    if (located.isDefaultVariant) {
      breed.color = patch.color;
      delete variant.color;
    } else {
      variant.color = patch.color;
    }
  }

  if (patch.mentionPatterns !== undefined) {
    const normalized = normalizeMentionPatterns(catId, patch.mentionPatterns);
    if (located.isDefaultVariant) {
      breed.mentionPatterns = normalized;
      delete variant.mentionPatterns;
    } else {
      variant.mentionPatterns = normalized;
    }
  }

  if (patch.accountRef !== undefined) {
    if (patch.accountRef && patch.accountRef.trim().length > 0) {
      variant.accountRef = patch.accountRef.trim();
    } else {
      delete variant.accountRef;
    }
  }
  if (patch.personality !== undefined) {
    if (patch.personality && patch.personality.trim().length > 0) {
      variant.personality = patch.personality;
    } else {
      delete variant.personality;
    }
  }
  if (patch.teamStrengths !== undefined) {
    if (patch.teamStrengths && patch.teamStrengths.trim().length > 0) {
      variant.teamStrengths = patch.teamStrengths.trim();
    } else {
      delete variant.teamStrengths;
    }
  }
  if (patch.caution !== undefined) {
    variant.caution = patch.caution && patch.caution.trim().length > 0 ? patch.caution.trim() : null;
  }
  if (patch.strengths !== undefined) {
    if (patch.strengths.length > 0) {
      variant.strengths = patch.strengths;
    } else {
      delete variant.strengths;
    }
  }
  if (patch.sessionChain !== undefined) {
    variant.sessionChain = patch.sessionChain;
  }
  if (patch.clientId !== undefined) variant.clientId = patch.clientId;
  if (patch.defaultModel !== undefined) variant.defaultModel = patch.defaultModel;
  if (patch.mcpSupport !== undefined) variant.mcpSupport = patch.mcpSupport;
  // F247 KD-17: patch.cli === null means remove (cloud-only mode); object means update.
  if (patch.cli !== undefined) {
    if (patch.cli === null) {
      delete variant.cli;
    } else {
      variant.cli = patch.cli;
    }
  }
  if (patch.contextBudget !== undefined) {
    if (patch.contextBudget) {
      variant.contextBudget = patch.contextBudget;
    } else {
      delete variant.contextBudget;
    }
  }
  if (patch.voiceConfig !== undefined) {
    if (patch.voiceConfig) {
      variant.voiceConfig = patch.voiceConfig;
    } else {
      delete variant.voiceConfig;
    }
  }
  if (patch.commandArgs !== undefined) {
    if (patch.commandArgs.length > 0) {
      variant.commandArgs = patch.commandArgs;
    } else {
      delete variant.commandArgs;
    }
  }
  if (patch.cliConfigArgs !== undefined) {
    if (patch.cliConfigArgs.length > 0) {
      variant.cliConfigArgs = patch.cliConfigArgs;
    } else {
      delete variant.cliConfigArgs;
    }
  }
  if (patch.provider !== undefined) {
    if (patch.provider) {
      variant.provider = patch.provider;
    } else {
      delete variant.provider;
    }
  }
  // F161: ACP transport config — null removes it (revert to CLI transport).
  if (patch.acp !== undefined) {
    if (patch.acp) {
      variant.acp = patch.acp;
    } else {
      variant.acp = null;
    }
  }
  if (patch.available !== undefined && catalog.version === 2) {
    const existingEntry = catalog.roster[catId];
    (catalog as { roster: Roster }).roster = {
      ...catalog.roster,
      [catId]: existingEntry
        ? { ...existingEntry, available: patch.available }
        : buildDefaultRuntimeRosterEntry(
            catId,
            String(breed.id ?? catId),
            String(breed.displayName ?? breed.name ?? catId),
            patch.available,
          ),
    };
  }

  return writeAndValidateCatalog(projectRoot, catalog);
}

export function updateRuntimeCoCreator(projectRoot: string, patch: RuntimeCoCreatorUpdate): CatCafeConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  if (catalog.version !== 2) {
    throw new Error('Owner config requires a version 2 runtime catalog');
  }

  const currentOwner = (catalog.coCreator ?? {
    name: 'co-creator',
    aliases: [],
    mentionPatterns: ['@co-creator', '@co-creator'],
  }) as CoCreatorConfig;

  const nextOwner: RecordOf = {
    ...currentOwner,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.aliases !== undefined
      ? {
          aliases: Array.from(new Set(patch.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0))),
        }
      : {}),
    ...(patch.mentionPatterns !== undefined
      ? {
          mentionPatterns: normalizeCoCreatorMentionPatterns(patch.mentionPatterns),
        }
      : {}),
  };

  if (patch.timeZone !== undefined) {
    nextOwner.timeZone = patch.timeZone.trim();
  }

  if (patch.avatar !== undefined) {
    if (patch.avatar && patch.avatar.trim().length > 0) {
      nextOwner.avatar = patch.avatar.trim();
    } else {
      delete nextOwner.avatar;
    }
  }

  if (patch.color !== undefined) {
    if (patch.color) {
      nextOwner.color = patch.color;
    } else {
      delete nextOwner.color;
    }
  }

  const normalizedOwner: CoCreatorConfig = {
    name: String(nextOwner.name ?? currentOwner.name),
    aliases: Array.isArray(nextOwner.aliases) ? (nextOwner.aliases as string[]) : [...currentOwner.aliases],
    mentionPatterns: Array.isArray(nextOwner.mentionPatterns)
      ? (nextOwner.mentionPatterns as string[])
      : [...currentOwner.mentionPatterns],
    ...(typeof nextOwner.timeZone === 'string' ? { timeZone: nextOwner.timeZone } : {}),
    ...(typeof nextOwner.avatar === 'string' ? { avatar: nextOwner.avatar } : {}),
    ...(nextOwner.color ? { color: nextOwner.color as CatColor } : {}),
  };

  (catalog as { coCreator: CoCreatorConfig }).coCreator = normalizedOwner;
  return writeAndValidateCatalog(projectRoot, catalog);
}

export function deleteRuntimeCat(projectRoot: string, catId: string): CatCafeConfig {
  const catalog = cloneCatalog(readOrBootstrapCatalog(projectRoot));
  const located = findBreedVariant(catalog, catId);
  if (!located) {
    throw new Error(`Cat "${catId}" not found in runtime catalog`);
  }
  const templateVariantTombstoneInput = findTemplateVariantTombstoneInput(projectRoot, catId);
  const breed = catalog.breeds[located.breedIndex] as unknown as RecordOf;
  const variants = breed.variants as unknown[];
  if (variants.length === 1) {
    (catalog as unknown as { breeds: CatBreed[] }).breeds = catalog.breeds.filter((_: unknown, index: number) => index !== located.breedIndex);
  } else {
    (breed.variants as unknown[]) = variants.filter((_: unknown, index: number) => index !== located.variantIndex);
    if (located.isDefaultVariant) {
      const remaining = breed.variants as Array<{ id?: unknown }>;
      breed.defaultVariantId = remaining[0]?.id ?? breed.defaultVariantId;
    }
  }

  if (catalog.version === 2 && catId in catalog.roster) {
    const nextRoster = { ...catalog.roster };
    delete nextRoster[catId];
    (catalog as { roster: Roster }).roster = nextRoster;
  }

  if (templateVariantTombstoneInput) {
    addTemplateVariantTombstone(catalog as unknown as RecordOf, templateVariantTombstoneInput);
  }

  return writeAndValidateCatalog(projectRoot, catalog);
}

export function refreshRuntimeCatCatalogCaches(): void {
  invalidateRuntimeCatalogCaches();
}

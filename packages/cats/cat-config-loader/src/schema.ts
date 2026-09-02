/**
 * Cat 配置合并与校验（C40，clowder config/cat-config-loader.ts 移植）。
 *
 * - zod v1/v2 版本化 schema：breeds（defaultVariantId 引用 + mentionPatterns
 *   非空后置校验）/ roster / reviewPolicy / coCreator（owner 迁移）
 * - deepMergeConfig：模板 base 与 .cat-cafe/cat-catalog.json overlay 深合并，
 *   cli/agyProfile/color/voiceConfig/acp 为原子键整替换，id 数组按键合并，
 *   其余对象递归、原始值/普通数组覆盖
 * - parseCatConfig 后置校验
 *
 * 本包自包含类型，不与 @flowforge/cats-shared 强耦合（loader 语义移植）。
 */

import { z } from 'zod';

// ── 基础 schema ──────────────────────────────────────────────

const mentionPatternSchema = z.string().min(2).regex(/^@/, 'mentionPattern must start with @');

const colorSchema = z.object({ primary: z.string(), secondary: z.string() });

const cliConfigSchema = z.object({
  command: z.string().min(1),
  outputFormat: z.string().min(1),
  defaultArgs: z.array(z.string()).optional(),
  effort: z.string().trim().min(1).optional(),
  serviceTier: z.enum(['standard', 'fast']).optional(),
  contextWindow: z.number().int().positive().optional(),
  carrier: z.enum(['exec_json', 'app_server']).optional(),
});

const agyProfileSchema = z
  .object({
    enabled: z.boolean().optional(),
    profileId: z.string().min(1).optional(),
    homeRoot: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    autoApprove: z.boolean().optional(),
    trustedWorkspaces: z.array(z.string().min(1)).optional(),
  })
  .optional();

const sessionStrategySchema = z
  .object({
    strategy: z.enum(['handoff', 'compress', 'hybrid']),
    thresholds: z
      .object({
        warn: z.number().min(0).max(1),
        action: z.number().min(0).max(1),
      })
      .refine((t) => t.warn < t.action, { message: 'thresholds.warn must be less than thresholds.action' })
      .optional(),
    handoff: z
      .object({ preSealMemoryDump: z.boolean(), bootstrapDepth: z.enum(['extractive', 'generative']) })
      .optional(),
    compress: z
      .object({ maxCompressions: z.number().int().positive().optional(), trackPostCompression: z.boolean() })
      .optional(),
    hybrid: z.object({ maxCompressions: z.number().int().positive() }).optional(),
    turnBudget: z.number().int().positive().optional(),
    safetyMargin: z.number().int().positive().optional(),
  })
  .optional();

const catVariantSchema = z
  .object({
    id: z.string().min(1),
    catId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    nickname: z.string().nullable().optional(),
    variantLabel: z.string().min(1).optional(),
    mentionPatterns: z.array(mentionPatternSchema).optional(),
    source: z.string().optional(),
    accountRef: z.string().min(1).optional(),
    clientId: z.string().min(1),
    defaultModel: z.string(),
    mcpSupport: z.boolean(),
    cli: cliConfigSchema.optional(),
    agyProfile: agyProfileSchema,
    commandArgs: z.array(z.string().min(1)).optional(),
    cliConfigArgs: z.array(z.string().min(1)).optional(),
    provider: z.string().trim().min(1).optional(),
    roleDescription: z.string().min(1).optional(),
    sessionChain: z.boolean().optional(),
    sessionStrategy: sessionStrategySchema,
    personality: z.string().optional(),
    avatar: z.string().min(1).optional(),
    color: colorSchema.optional(),
    contextWindow: z.number().int().positive().optional(),
    teamStrengths: z.string().optional(),
    caution: z.string().nullable().optional(),
    restrictions: z.array(z.string().min(1)).optional(),
  })
  .superRefine((variant, ctx) => {
    // F254 D2: cli.carrier 是 codex 专用；其它 client 拒绝（读侧防手编走私）
    if (variant.cli?.carrier !== undefined && variant.clientId !== 'openai') {
      ctx.addIssue({
        code: 'custom',
        path: ['cli', 'carrier'],
        message: `cli.carrier is codex-only, but variant "${variant.id}" has clientId "${variant.clientId}"`,
      });
    }
  });

const catBreedSchema = z.object({
  id: z.string().min(1),
  relationshipKey: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, 'relationshipKey must be a safe profile path segment')
    .optional(),
  catId: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  nickname: z.string().nullable().optional(),
  avatar: z.string().min(1),
  color: colorSchema,
  mentionPatterns: z.array(mentionPatternSchema).min(1),
  roleDescription: z.string().min(1),
  defaultVariantId: z.string().min(1),
  variants: z.array(catVariantSchema).min(1),
  features: z
    .object({
      sessionChain: z.boolean().optional(),
      sessionStrategy: sessionStrategySchema,
      missionHub: z.object({ selfClaimScope: z.enum(['disabled', 'once', 'thread', 'global']).optional() }).optional(),
    })
    .optional(),
  teamStrengths: z.string().optional(),
  caution: z.string().nullable().optional(),
  restrictions: z.array(z.string().min(1)).optional(),
});

const rosterEntrySchema = z.object({
  family: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  lead: z.boolean(),
  available: z.boolean(),
  evaluation: z.string().min(1),
});

const reviewPolicySchema = z.object({
  requireDifferentFamily: z.boolean(),
  preferActiveInThread: z.boolean(),
  preferLead: z.boolean(),
  excludeUnavailable: z.boolean(),
});

const coCreatorConfigSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  mentionPatterns: z.array(mentionPatternSchema).min(1),
  timeZone: z.string().trim().min(1).optional(),
  avatar: z.string().min(1).optional(),
  color: colorSchema.optional(),
});

const catCafeConfigSchemaV1 = z.object({
  version: z.literal(1),
  breeds: z.array(catBreedSchema),
});

const catCafeConfigSchemaV2 = z
  .object({
    version: z.literal(2),
    breeds: z.array(catBreedSchema),
    roster: z.record(z.string(), rosterEntrySchema),
    reviewPolicy: reviewPolicySchema,
    coCreator: coCreatorConfigSchema.optional(),
    /** @deprecated 兼容；parse 时迁移到 coCreator。 */
    owner: coCreatorConfigSchema.optional(),
  })
  .transform((data) => {
    const { owner: legacyOwner, ...rest } = data;
    if (!rest.coCreator && legacyOwner) {
      return { ...rest, coCreator: legacyOwner };
    }
    return rest;
  });

export const catCafeConfigSchema = z.union([catCafeConfigSchemaV1, catCafeConfigSchemaV2]);

export type CatCafeConfig = z.infer<typeof catCafeConfigSchemaV2> | z.infer<typeof catCafeConfigSchemaV1>;
export type CatBreed = z.infer<typeof catBreedSchema>;
export type CatVariant = z.infer<typeof catVariantSchema>;
export type RosterEntry = z.infer<typeof rosterEntrySchema>;
export type Roster = Record<string, RosterEntry>;
export type ReviewPolicy = z.infer<typeof reviewPolicySchema>;
export type CoCreatorConfig = z.infer<typeof coCreatorConfigSchema>;

// ── 深合并 ──────────────────────────────────────────────────

/** 原子键：整替换，防止跨 provider 泄漏陈旧子字段。 */
const ATOMIC_OBJECT_KEYS = new Set(['cli', 'agyProfile', 'color', 'voiceConfig', 'acp']);

type HasId = Record<string, unknown> & { id: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isIdArray(arr: unknown[]): arr is HasId[] {
  return (
    arr.length > 0 &&
    arr.every((item) => isPlainObject(item) && typeof (item as Record<string, unknown>).id === 'string')
  );
}

function mergeById(base: HasId[], overlay: HasId[]): HasId[] {
  const baseMap = new Map(base.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const result: HasId[] = [];
  for (const oItem of overlay) {
    seen.add(oItem.id);
    const bItem = baseMap.get(oItem.id);
    result.push(bItem ? (deepMergeConfig(bItem, oItem) as HasId) : oItem);
  }
  for (const bItem of base) {
    if (!seen.has(bItem.id)) result.push(bItem);
  }
  return result;
}

export function deepMergeConfig(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const bVal = base[key];
    const oVal = overlay[key];
    if (ATOMIC_OBJECT_KEYS.has(key)) {
      merged[key] = oVal;
    } else if (Array.isArray(oVal) && Array.isArray(bVal) && oVal.length > 0 && isIdArray(oVal) && isIdArray(bVal)) {
      merged[key] = mergeById(bVal, oVal);
    } else if (isPlainObject(oVal) && isPlainObject(bVal)) {
      merged[key] = deepMergeConfig(bVal, oVal);
    } else {
      merged[key] = oVal;
    }
  }
  return merged;
}

// ── 解析与后置校验 ──────────────────────────────────────────

export function parseCatConfig(raw: string): CatCafeConfig {
  const json: unknown = JSON.parse(raw);
  const result = catCafeConfigSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid cat config:\n${issues.join('\n')}`);
  }

  for (const breed of result.data.breeds) {
    const found = breed.variants.find((variant) => variant.id === breed.defaultVariantId);
    if (!found) {
      throw new Error(`Breed "${breed.id}": defaultVariantId "${breed.defaultVariantId}" not found in variants`);
    }
    if (breed.mentionPatterns.length === 0) {
      throw new Error(`Breed "${breed.id}": mentionPatterns must have at least one entry`);
    }
  }

  return result.data;
}

export function getDefaultVariant(breed: CatBreed): CatVariant {
  const found = breed.variants.find((variant) => variant.id === breed.defaultVariantId);
  if (!found) throw new Error(`Default variant "${breed.defaultVariantId}" not found for breed "${breed.id}"`);
  return found;
}

/**
 * Cat 配置访问器（C40，clowder cat-config-loader.ts accessor 子集移植）。
 *
 * 无全局缓存 — 全部接受 cfg 参数，纯函数可测。默认值语义与上游一致：
 * roster 缺省可用；reviewPolicy 缺省 requireDifferentFamily=true 等四项；
 * coCreator 缺省 @co-creator 词条；sessionChain 未配置默认 enabled。
 */

import type { CatBreed, CatCafeConfig, CatVariant, CoCreatorConfig, ReviewPolicy, Roster } from './schema.ts';

const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  requireDifferentFamily: true,
  preferActiveInThread: true,
  preferLead: true,
  excludeUnavailable: true,
};

const DEFAULT_CO_CREATOR_PATTERNS = ['@co-creator'] as const;

export function getRoster(cfg: CatCafeConfig | undefined): Roster {
  if (!cfg || cfg.version === 1) return {};
  return cfg.roster;
}

export function getReviewPolicy(cfg: CatCafeConfig | undefined): ReviewPolicy {
  if (!cfg || cfg.version === 1) return DEFAULT_REVIEW_POLICY;
  return cfg.reviewPolicy;
}

export function isCatAvailable(catId: string, cfg: CatCafeConfig | undefined): boolean {
  const entry = getRoster(cfg)[catId];
  return entry?.available !== false;
}

export function getCatFamily(catId: string, cfg: CatCafeConfig | undefined): string | undefined {
  return getRoster(cfg)[catId]?.family;
}

export function catHasRole(catId: string, role: string, cfg: CatCafeConfig | undefined): boolean {
  const entry = getRoster(cfg)[catId];
  return entry?.roles.includes(role) ?? false;
}

export function isCatLead(catId: string, cfg: CatCafeConfig | undefined): boolean {
  const entry = getRoster(cfg)[catId];
  return entry?.lead ?? false;
}

export function getCoCreatorConfig(cfg: CatCafeConfig | undefined): CoCreatorConfig {
  if (!cfg || cfg.version === 1 || !cfg.coCreator) {
    return { name: 'co-creator', aliases: [], mentionPatterns: [...DEFAULT_CO_CREATOR_PATTERNS] };
  }
  return cfg.coCreator;
}

export function getCoCreatorMentionPatterns(cfg: CatCafeConfig | undefined): readonly string[] {
  const coCreator = getCoCreatorConfig(cfg);
  const patterns = new Set(coCreator.mentionPatterns.map((pattern) => pattern.toLowerCase()));
  for (const pattern of DEFAULT_CO_CREATOR_PATTERNS) patterns.add(pattern.toLowerCase());
  return [...patterns];
}

export function findCatVariant(cfg: CatCafeConfig, catId: string): { breed: CatBreed; variant: CatVariant } | undefined {
  for (const breed of cfg.breeds) {
    for (const variant of breed.variants) {
      const resolvedCatId = variant.catId ?? breed.catId;
      if (resolvedCatId === catId) return { breed, variant };
    }
  }
  return undefined;
}

/** F32-b：variant 无 catId 时回落 breed.catId；variant 自定义 catId 优先。 */
export function resolveCatId(breed: CatBreed, variant: CatVariant): string {
  return variant.catId ?? breed.catId;
}

/** variant 级 mention 覆盖；否则默认 variant 继承 breed patterns；其余回落 @catId。 */
export function resolveVariantMentionPatterns(
  breed: CatBreed,
  variant: CatVariant,
  catId: string,
): string[] {
  if (variant.mentionPatterns && variant.mentionPatterns.length > 0) return variant.mentionPatterns;
  if (variant.id === breed.defaultVariantId && breed.mentionPatterns.length > 0) return breed.mentionPatterns;
  return [`@${catId}`];
}

/** F24 session chain：variant 显式 > breed.features.sessionChain !== false > true。 */
export function isSessionChainEnabled(catId: string, cfg: CatCafeConfig | undefined): boolean {
  if (!cfg) return true;
  const found = findCatVariant(cfg, catId);
  if (!found) return true;
  const { breed, variant } = found;
  if (variant.sessionChain !== undefined) return variant.sessionChain;
  return breed.features?.sessionChain !== false;
}

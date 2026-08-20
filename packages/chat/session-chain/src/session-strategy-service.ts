/**
 * ChatSessionStrategyService — F33 session-strategy-config Cordis 服务
 * （阶段5 批次6，ctx.chatSessionStrategy）。
 *
 * 移植自 clowder-ai `config/session-strategy.ts` 与 `routes/session-strategy-config.ts`
 * （全量移植，R13 一切皆插件 + 注册中心抽离）：
 * - `get` / `getWithSource`：per-cat 有效策略解析（layered lookup）
 * - `setOverride` / `deleteOverride`：runtime override（宿主注入持久化，缺省进程内 Map）
 * - `list`：全部已注册 cat 的有效策略 + source + override 状态（对齐 PATCH 前 GET 面）
 * - `decide`：`shouldTakeAction` 纯函数包装（context health → StrategyAction）
 *
 * Lookup order（Phase 3）：runtime override → config_file → breed_code → provider_default →
 * global_default。provider/breed 解析经 options 注入（缺省读 `ctx.catsRegistry` 子集，
 * 未装载时 provider 未知 → 按全局缺省）。
 *
 * @module @flowforge/chat-session-chain/strategy-service
 */

import { Context, Service } from '@flowforge/cordis'
import type { SessionStrategyConfig, StrategyAction } from '@flowforge/cats-shared'
import {
  DEFAULT_STRATEGY_BY_PROVIDER,
  GLOBAL_DEFAULT_STRATEGY,
  HYBRID_MAX_COMPRESSIONS,
} from './invariant.ts'

/** 有效策略来源（对齐 clowder StrategySource）。 */
export type StrategySource = 'runtime_override' | 'config_file' | 'breed_code' | 'provider_default' | 'global_default'

/** 深度 partial（嵌套 thresholds/handoff/compress/hybrid 允许只覆盖部分字段）。
 * 分布条件类型：`T[K]` 为 `X | undefined`（可选属性）时仍递归到 `X`。 */
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

/** 解析依赖（宿主可注入 provider/breed 查询；缺省无 providers 注册）。 */
export interface SessionStrategyServiceOptions {
  /** catId → provider clientId 解析（clowder catRegistry.tryGet().config.clientId）。 */
  resolveProvider?: (catId: string) => string | undefined
  /** catId → breedId 解析。 */
  resolveBreedId?: (catId: string) => string | undefined
  /** all registered catIds。 */
  listCatIds?: () => string[]
  /** 持久化 override 注入（缺省进程内 Map）。 */
  overrideStore?: StrategyOverrideStore
  /** config_file 层策略（clowder getConfigSessionStrategy）。 */
  configSessionStrategy?: (catId: string) => DeepPartial<SessionStrategyConfig> | undefined
  /** breed 层策略表。 */
  strategyByBreed?: Record<string, DeepPartial<SessionStrategyConfig>>
}

/** override 存取接口（可代理 Redis）。 */
export interface StrategyOverrideStore {
  get(catId: string): DeepPartial<SessionStrategyConfig> | undefined
  set(catId: string, override: DeepPartial<SessionStrategyConfig>): void
  delete(catId: string): boolean
  all(): Map<string, DeepPartial<SessionStrategyConfig>>
}

/** 默认进程内 override store。 */
class MemoryOverrideStore implements StrategyOverrideStore {
  private readonly map = new Map<string, DeepPartial<SessionStrategyConfig>>()
  get(catId: string): DeepPartial<SessionStrategyConfig> | undefined {
    return this.map.get(catId)
  }
  set(catId: string, override: DeepPartial<SessionStrategyConfig>): void {
    this.map.set(catId, override)
  }
  delete(catId: string): boolean {
    return this.map.delete(catId)
  }
  all(): Map<string, DeepPartial<SessionStrategyConfig>> {
    return new Map(this.map)
  }
}

/**
 * 会话策略服务（mount at ctx.chatSessionStrategy）。
 */
export class ChatSessionStrategyService extends Service {
  private readonly opts: Required<Pick<SessionStrategyServiceOptions, 'overrideStore'>> &
    SessionStrategyServiceOptions

  constructor(ctx: Context, options: SessionStrategyServiceOptions = {}) {
    super(ctx, 'chatSessionStrategy')
    this.opts = options.overrideStore ? { ...options, overrideStore: options.overrideStore } : { ...options, overrideStore: new MemoryOverrideStore() }
  }

  private resolveProvider(catId: string): string | undefined {
    if (this.opts.resolveProvider) return this.opts.resolveProvider(catId)
    return undefined
  }

  /** 有效策略（仅 effective）。 */
  get(catId: string): SessionStrategyConfig {
    return this.getWithSource(catId).effective
  }

  /** 有效策略 + source（对齐 getSessionStrategyWithSource）。 */
  getWithSource(catId: string): { effective: SessionStrategyConfig; source: StrategySource } {
    const fallback = this.resolveFallback(catId)
    const override = this.opts.overrideStore.get(catId)
    if (override) {
      const merged = mergeStrategyConfig(fallback.effective, override)
      return { effective: validateProviderCapability(merged, catId, this.resolveProvider(catId)), source: 'runtime_override' }
    }
    return { effective: validateProviderCapability(fallback.effective, catId, this.resolveProvider(catId)), source: fallback.source }
  }

  /** 列出全部已注册 cat 的有效策略 + source + override 状态。 */
  list(): Array<{
    catId: string
    effective: SessionStrategyConfig
    source: StrategySource
    hasOverride: boolean
    override: DeepPartial<SessionStrategyConfig> | null
    hybridCapable: boolean
  }> {
    const ids = this.opts.listCatIds?.() ?? []
    const allOverrides = this.opts.overrideStore.all()
    return ids.map((catId) => {
      const provider = this.resolveProvider(catId)
      const { effective, source } = this.getWithSource(catId)
      const override = allOverrides.get(catId)
      return {
        catId,
        effective,
        source,
        hasOverride: override != null,
        override: override ?? null,
        hybridCapable: HOOK_CAPABLE_PROVIDERS.has(provider ?? ''),
      }
    })
  }

  /** PATCH — 设置 runtime override（合并时校验 hybrid 能力）。 */
  setOverride(catId: string, override: DeepPartial<SessionStrategyConfig>): { catId: string; effective: SessionStrategyConfig; source: StrategySource; override: DeepPartial<SessionStrategyConfig> } {
    if (!override || Object.keys(override).length === 0) {
      throw new ChatSessionStrategyError(422, 'Empty override — use deleteOverride to remove an override')
    }
    const provider = this.resolveProvider(catId)
    if (override.strategy === 'hybrid' && provider && !HOOK_CAPABLE_PROVIDERS.has(provider)) {
      throw new ChatSessionStrategyError(
        422,
        `hybrid strategy requires a hook-capable provider (${[...HOOK_CAPABLE_PROVIDERS].join(', ')}), but this cat's provider is "${provider}"`,
      )
    }
    this.opts.overrideStore.set(catId, override)
    const { effective, source } = this.getWithSource(catId)
    return { catId, effective, source, override }
  }

  /** DELETE — 移除 runtime override。 */
  deleteOverride(catId: string): { catId: string; effective: SessionStrategyConfig; source: StrategySource; deleted: boolean } {
    const existed = this.opts.overrideStore.delete(catId)
    const { effective, source } = this.getWithSource(catId)
    return { catId, effective, source, deleted: existed }
  }

  /** shouldTakeAction 包装（strategy 缺省按 catId 解析）。 */
  decide(catId: string, input: {
    fillRatio: number
    windowTokens: number
    usedTokens: number
    compressionCount: number
  }): StrategyAction {
    return shouldTakeAction(input.fillRatio, input.windowTokens, input.usedTokens, input.compressionCount, this.get(catId))
  }

  private resolveFallback(catId: string): { effective: SessionStrategyConfig; source: StrategySource } {
    const base = this.getBaseStrategy(catId)

    // config_file 层（breed level）。
    const configOverride = this.opts.configSessionStrategy?.(catId)
    if (configOverride) {
      return { effective: mergeStrategyConfig(base, configOverride), source: 'config_file' }
    }
    // breed_code 层。
    const breedId = this.opts.resolveBreedId?.(catId)
    const breedTable = this.opts.strategyByBreed ?? {}
    const breedOverride = (breedId ? breedTable[breedId] : undefined) ?? breedTable[catId]
    if (breedOverride) {
      return { effective: mergeStrategyConfig(base, breedOverride), source: 'breed_code' }
    }
    // provider_default / global_default。
    const provider = this.resolveProvider(catId)
    if (provider && DEFAULT_STRATEGY_BY_PROVIDER[provider]) {
      return { effective: base, source: 'provider_default' }
    }
    return { effective: base, source: 'global_default' }
  }

  private getBaseStrategy(catId: string): SessionStrategyConfig {
    const provider = this.resolveProvider(catId)
    if (provider) {
      const providerDefault = DEFAULT_STRATEGY_BY_PROVIDER[provider]
      if (providerDefault) return providerDefault
    }
    return GLOBAL_DEFAULT_STRATEGY
  }
}

/** 策略服务业务错误。 */
export class ChatSessionStrategyError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ChatSessionStrategyError'
    this.status = status
  }
}

/** 支持压缩事件信号（PreCompact hook）的 provider（hybrid 策略必需）。 */
export const HOOK_CAPABLE_PROVIDERS: ReadonlySet<string> = new Set(['anthropic'])

/**
 * 纯函数：deep-merge partial override 进 base（嵌套 thresholds/handoff/compress/hybrid
 * 逐项合并，partial { thresholds:{action} } 保留 warn）。
 */
export function mergeStrategyConfig(
  base: SessionStrategyConfig,
  override: DeepPartial<SessionStrategyConfig>,
): SessionStrategyConfig {
  const merged: SessionStrategyConfig = {
    strategy: override.strategy ?? base.strategy,
    thresholds: { ...base.thresholds, ...override.thresholds },
    ...(base.turnBudget !== undefined ? { turnBudget: base.turnBudget } : {}),
    ...(base.safetyMargin !== undefined ? { safetyMargin: base.safetyMargin } : {}),
  }
  if (override.turnBudget !== undefined) merged.turnBudget = override.turnBudget
  if (override.safetyMargin !== undefined) merged.safetyMargin = override.safetyMargin
  if (base.handoff || override.handoff) {
    merged.handoff = { ...base.handoff, ...override.handoff } as NonNullable<SessionStrategyConfig['handoff']>
  }
  if (base.compress || override.compress) {
    merged.compress = { ...base.compress, ...override.compress } as NonNullable<SessionStrategyConfig['compress']>
  }
  if (base.hybrid || override.hybrid) {
    merged.hybrid = { ...base.hybrid, ...override.hybrid } as NonNullable<SessionStrategyConfig['hybrid']>
  }
  return merged
}

/**
 * 纯函数：context health + strategy → StrategyAction（对齐 clowder shouldTakeAction）。
 * 预算耗尽按策略分支；达到 action 阈值按 handoff/compress/hybrid 决策。
 */
export function shouldTakeAction(
  fillRatio: number,
  windowTokens: number,
  usedTokens: number,
  compressionCount: number,
  strategy: SessionStrategyConfig,
): StrategyAction {
  const turnBudget = strategy.turnBudget ?? 12_000
  const safetyMargin = strategy.safetyMargin ?? 4_000
  const remaining = windowTokens - usedTokens

  // Budget exhausted — strategy-aware。
  if (remaining < turnBudget + safetyMargin) {
    if (strategy.strategy === 'compress') {
      return { type: 'allow_compress' }
    }
    if (strategy.strategy === 'hybrid') {
      const max = strategy.hybrid?.maxCompressions ?? HYBRID_MAX_COMPRESSIONS
      if (compressionCount < max) {
        return { type: 'allow_compress' }
      }
    }
    return { type: 'seal', reason: 'budget_exhausted' }
  }

  // Below action threshold。
  if (fillRatio < strategy.thresholds.action) {
    if (fillRatio >= strategy.thresholds.warn) {
      return { type: 'warn' }
    }
    return { type: 'none' }
  }

  // At or above action threshold — branch by strategy。
  switch (strategy.strategy) {
    case 'handoff':
      return { type: 'seal', reason: 'threshold' }
    case 'compress':
      return { type: 'allow_compress' }
    case 'hybrid': {
      const max = strategy.hybrid?.maxCompressions ?? HYBRID_MAX_COMPRESSIONS
      if (compressionCount >= max) {
        return { type: 'seal_after_compress', reason: 'max_compressions' }
      }
      return { type: 'allow_compress' }
    }
  }
}

/**
 * Phase 1 guard：hybrid 需 hook-capable provider；否则降级到 handoff。
 */
export function validateProviderCapability(
  config: SessionStrategyConfig,
  _catId: string,
  provider: string | undefined,
): SessionStrategyConfig {
  if (config.strategy !== 'hybrid') return config
  if (!provider || !HOOK_CAPABLE_PROVIDERS.has(provider)) {
    return { ...config, strategy: 'handoff' }
  }
  return config
}
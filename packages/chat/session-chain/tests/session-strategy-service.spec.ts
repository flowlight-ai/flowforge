/**
 * ChatSessionStrategyService — F33 session-strategy-config 服务契约验证
 * （阶段5 批次6，T5.4.3）。
 *
 * 覆盖（对齐 clowder-ai `config/session-strategy.ts` + `routes/session-strategy-config.ts`）：
 * - 分层查找：runtime_override → config_file → breed_code → provider_default → global_default
 * - setOverride / deleteOverride / list（override 状态 + hybridCapable 投影）
 * - decide：shouldTakeAction 纯函数包装
 * - 纯函数：mergeStrategyConfig（嵌套 partial 合并）/ shouldTakeAction（各预算/阈值分支）/
 *   validateProviderCapability（hybrid 降级）
 *
 * @module @flowforge/chat-session-chain/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId } from '@flowforge/cats-shared'
import type { SessionStrategyConfig } from '@flowforge/cats-shared'
import {
  ChatSessionStrategyError,
  ChatSessionStrategyService,
  mergeStrategyConfig,
  shouldTakeAction,
  validateProviderCapability,
} from '../src/index.ts'

const CAT_A = createCatId('cat_a')
const CAT_HYBRID = createCatId('cat_hybrid')

const BASE: SessionStrategyConfig = {
  strategy: 'handoff',
  thresholds: { warn: 0.75, action: 0.85 },
  turnBudget: 12_000,
  safetyMargin: 4_000,
}

interface Harness {
  ctx: Context
  strategy: ChatSessionStrategyService
}

function harness(opts: ConstructorParameters<typeof ChatSessionStrategyService>[1] = {}): Harness {
  const ctx = new Context()
  const strategy = new ChatSessionStrategyService(ctx, opts)
  return { ctx, strategy }
}

describe('ChatSessionStrategyService — layered lookup', () => {
  it('falls back to global default when no provider/override is registered', () => {
    const h = harness()
    const { effective, source } = h.strategy.getWithSource(CAT_A)
    expect(source).toBe('global_default')
    expect(effective.strategy).toBe('handoff')
    expect(effective.thresholds.action).toBe(0.85)
  })

  it('uses provider default when the provider is known', () => {
    const h = harness({ resolveProvider: (id) => (id === CAT_A ? 'anthropic' : undefined) })
    const { effective, source } = h.strategy.getWithSource(CAT_A)
    expect(source).toBe('provider_default')
    expect(effective.thresholds.warn).toBe(0.8)
    expect(effective.thresholds.action).toBe(0.9)
  })

  it('prefers breed_code over provider default', () => {
    const h = harness({
      resolveProvider: () => 'anthropic',
      resolveBreedId: (id) => (id === CAT_A ? 'breed_x' : undefined),
      strategyByBreed: { breed_x: { strategy: 'compress', thresholds: { warn: 0.6, action: 0.7 } } },
    })
    const { effective, source } = h.strategy.getWithSource(CAT_A)
    expect(source).toBe('breed_code')
    expect(effective.strategy).toBe('compress')
    // 合并保留 provider 层 turnBudget
    expect(effective.turnBudget).toBe(12_000)
  })

  it('prefers config_file over breed_code', () => {
    const h = harness({
      // hybrid 策略要求 hook-capable provider（anthropic），否则 validateProviderCapability 降级 handoff
      resolveProvider: () => 'anthropic',
      configSessionStrategy: (id) => (id === CAT_A ? { strategy: 'hybrid', hybrid: { maxCompressions: 4 } } : undefined),
      resolveBreedId: () => 'breed_x',
      strategyByBreed: { breed_x: { strategy: 'compress' } },
    })
    const { effective, source } = h.strategy.getWithSource(CAT_A)
    expect(source).toBe('config_file')
    expect(effective.strategy).toBe('hybrid')
    expect(effective.hybrid?.maxCompressions).toBe(4)
  })

  it('prefers runtime override over everything', () => {
    const h = harness({
      resolveProvider: () => 'anthropic',
      configSessionStrategy: (id) => (id === CAT_A ? { strategy: 'compress' } : undefined),
    })
    h.strategy.setOverride(CAT_A, { strategy: 'compress', thresholds: { warn: 0.5, action: 0.6 } })
    const { effective, source } = h.strategy.getWithSource(CAT_A)
    expect(source).toBe('runtime_override')
    expect(effective.strategy).toBe('compress')
    // 嵌套合并：override 只覆盖 thresholds 的 warn/action，保留 base 的 turnBudget
    expect(effective.turnBudget).toBe(12_000)
  })
})

describe('ChatSessionStrategyService — setOverride / deleteOverride / list', () => {
  it('sets an override and reflects it in get()', () => {
    const h = harness()
    const result = h.strategy.setOverride(CAT_A, { strategy: 'compress' })
    expect(result.source).toBe('runtime_override')
    expect(result.effective.strategy).toBe('compress')
    expect(h.strategy.get(CAT_A).strategy).toBe('compress')
  })

  it('rejects an empty override', () => {
    const h = harness()
    expect(() => h.strategy.setOverride(CAT_A, {})).toThrow(ChatSessionStrategyError)
  })

  it('rejects hybrid override for a non-hook-capable provider', () => {
    const h = harness({ resolveProvider: () => 'openai' })
    expect(() => h.strategy.setOverride(CAT_A, { strategy: 'hybrid' })).toThrow(ChatSessionStrategyError)
  })

  it('deletes an override and restores the fallback', () => {
    const h = harness({ resolveProvider: () => 'anthropic' })
    h.strategy.setOverride(CAT_A, { strategy: 'compress' })
    const deleted = h.strategy.deleteOverride(CAT_A)
    expect(deleted.deleted).toBe(true)
    expect(deleted.source).toBe('provider_default')
    expect(deleted.effective.strategy).toBe('handoff')
  })

  it('lists effective strategies with override status and hybrid capability', () => {
    const h = harness({
      resolveProvider: (id) => (id === CAT_HYBRID ? 'anthropic' : 'openai'),
      listCatIds: () => [CAT_A, CAT_HYBRID],
    })
    h.strategy.setOverride(CAT_HYBRID, { strategy: 'hybrid' })
    const rows = h.strategy.list()
    expect(rows).toHaveLength(2)
    const hybridRow = rows.find((r) => r.catId === CAT_HYBRID)!
    expect(hybridRow.hasOverride).toBe(true)
    expect(hybridRow.hybridCapable).toBe(true)
    const plainRow = rows.find((r) => r.catId === CAT_A)!
    expect(plainRow.hasOverride).toBe(false)
    expect(plainRow.hybridCapable).toBe(false)
  })
})

describe('ChatSessionStrategyService — decide', () => {
  it('wraps shouldTakeAction with the effective strategy', () => {
    const h = harness()
    h.strategy.setOverride(CAT_A, { strategy: 'compress' })
    const action = h.strategy.decide(CAT_A, {
      fillRatio: 0.9, windowTokens: 100_000, usedTokens: 60_000, compressionCount: 0,
    })
    expect(action.type).toBe('allow_compress')
  })
})

describe('mergeStrategyConfig — nested partial merge', () => {
  it('merges thresholds depth-first, preserving untouched keys', () => {
    const merged = mergeStrategyConfig(BASE, { thresholds: { action: 0.9 } })
    expect(merged.thresholds).toEqual({ warn: 0.75, action: 0.9 })
    expect(merged.turnBudget).toBe(12_000)
  })

  it('merges optional strategy sub-objects', () => {
    const base: SessionStrategyConfig = {
      ...BASE,
      handoff: { preSealMemoryDump: true, bootstrapDepth: 'extractive' },
      hybrid: { maxCompressions: 2 },
    }
    const merged = mergeStrategyConfig(base, {
      handoff: { bootstrapDepth: 'generative' },
      hybrid: { maxCompressions: 4 },
    })
    expect(merged.handoff).toEqual({ preSealMemoryDump: true, bootstrapDepth: 'generative' })
    expect(merged.hybrid).toEqual({ maxCompressions: 4 })
  })
})

describe('shouldTakeAction — strategy-aware decisions', () => {
  it('returns none below the warn threshold', () => {
    expect(shouldTakeAction(0.5, 100_000, 40_000, 0, BASE)).toEqual({ type: 'none' })
  })

  it('returns warn in the warn band', () => {
    expect(shouldTakeAction(0.8, 100_000, 40_000, 0, BASE)).toEqual({ type: 'warn' })
  })

  it('returns seal threshold for handoff strategy at/above action', () => {
    expect(shouldTakeAction(0.9, 100_000, 40_000, 0, BASE)).toEqual({ type: 'seal', reason: 'threshold' })
  })

  it('seals on budget exhaustion for handoff strategy', () => {
    expect(shouldTakeAction(0.9, 20_000, 10_000, 0, BASE)).toEqual({ type: 'seal', reason: 'budget_exhausted' })
  })

  it('allows compression for compress strategy', () => {
    const compress: SessionStrategyConfig = { ...BASE, strategy: 'compress' }
    expect(shouldTakeAction(0.9, 20_000, 10_000, 0, compress)).toEqual({ type: 'allow_compress' })
    expect(shouldTakeAction(0.9, 100_000, 40_000, 0, compress)).toEqual({ type: 'allow_compress' })
  })

  it('hybrid allows compression until maxCompressions, then seals', () => {
    const hybrid: SessionStrategyConfig = { ...BASE, strategy: 'hybrid', hybrid: { maxCompressions: 2 } }
    expect(shouldTakeAction(0.9, 100_000, 40_000, 1, hybrid)).toEqual({ type: 'allow_compress' })
    expect(shouldTakeAction(0.9, 100_000, 40_000, 2, hybrid)).toEqual({
      type: 'seal_after_compress', reason: 'max_compressions',
    })
  })
})

describe('validateProviderCapability — hybrid degradation', () => {
  it('downgrades hybrid to handoff when the provider is not hook-capable', () => {
    const hybrid: SessionStrategyConfig = { ...BASE, strategy: 'hybrid' }
    const result = validateProviderCapability(hybrid, CAT_A, 'openai')
    expect(result.strategy).toBe('handoff')
  })

  it('keeps hybrid for a hook-capable provider', () => {
    const hybrid: SessionStrategyConfig = { ...BASE, strategy: 'hybrid' }
    const result = validateProviderCapability(hybrid, CAT_A, 'anthropic')
    expect(result.strategy).toBe('hybrid')
  })
})

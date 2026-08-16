/**
 * Contract suite: YAML assembly, enable precedence (enabled → allowlist →
 * rollout bucket → expiry), stable md5 bucketing, fallback policy and the
 * documented Python-bug fixes (expiry disables; default rollout 100).
 */

import { describe, expect, it } from 'vitest'
import { FeatureFlagManager, rolloutBucket } from '../src/index.ts'

const YAML = `
features:
  new_compaction: true
  v2_scheduler:
    enabled: true
    rollout_percentage: 25
    allowed_projects: [flowlight]
    fallback_to_old: false
    switch_strategy: ab_parallel
    description: scheduler rewrite
  dead_flag:
    enabled: true
    rollout_percentage: 100
`

describe('YAML assembly (R17)', () => {
  it('loads boolean shorthand and full records', () => {
    const manager = new FeatureFlagManager()
    manager.loadFromYamlText(YAML)
    expect(manager.allFlags().size).toBe(3)
    const scheduler = manager.getFlag('v2_scheduler')
    expect(scheduler).toMatchObject({
      enabled: true,
      rolloutPercentage: 25,
      allowedProjects: ['flowlight'],
      fallbackToOld: false,
      switchStrategy: 'ab_parallel',
      description: 'scheduler rewrite',
    })
  })

  it('ignores malformed documents without throwing', () => {
    const manager = new FeatureFlagManager()
    manager.loadFromYamlText('features: [not, a, map]')
    manager.loadFromYamlText('')
    expect(manager.allFlags().size).toBe(0)
  })
})

describe('isEnabled precedence', () => {
  it('unknown or disabled flags are off', () => {
    const manager = new FeatureFlagManager()
    manager.loadFromYamlText(YAML)
    expect(manager.isEnabled('ghost')).toBe(false)
    manager.setFlag('dead_flag', false)
    expect(manager.isEnabled('dead_flag')).toBe(false)
  })

  it('boolean shorthand is fully on (documented fix: default rollout 100)', () => {
    const manager = new FeatureFlagManager()
    manager.loadFromYamlText(YAML)
    expect(manager.isEnabled('new_compaction')).toBe(true)
  })

  it('enforces the project allowlist when a project is given', () => {
    const manager = new FeatureFlagManager()
    manager.loadFromYamlText(YAML)
    // not in the allowlist → off regardless of the rollout bucket
    expect(manager.isEnabled('v2_scheduler', 'other')).toBe(false)
    // no project identity → allowlist skipped, only the bucket decides
    expect(manager.isEnabled('v2_scheduler')).toBe(rolloutBucket('v2_scheduler', 'default') < 25)
  })

  it('rollout bucketing is stable and matches the md5 formula', () => {
    const bucket = rolloutBucket('v2_scheduler', 'flowlight')
    expect(bucket).toBeGreaterThanOrEqual(0)
    expect(bucket).toBeLessThan(100)
    expect(rolloutBucket('v2_scheduler', 'flowlight')).toBe(bucket)

    const manager = new FeatureFlagManager()
    manager.loadFromYamlText(YAML)
    const flag = manager.getFlag('v2_scheduler')
    if (flag === undefined) throw new Error('flag missing')
    const enabled = bucket < 25 && flag.allowedProjects.includes('flowlight')
    expect(manager.isEnabled('v2_scheduler', 'flowlight')).toBe(enabled)
  })

  it('expires flags (documented fix: expiry DISABLES, Python inverted this)', () => {
    let nowSeconds = 1000
    const manager = new FeatureFlagManager(() => nowSeconds)
    manager.setFlag('temp', true)
    const flag = manager.getFlag('temp')
    if (flag === undefined) throw new Error('flag missing')
    flag.expiresAt = 2000
    expect(manager.isEnabled('temp')).toBe(true)
    nowSeconds = 2001
    expect(manager.isEnabled('temp')).toBe(false)
  })
})

describe('fallback policy', () => {
  it('defaults to falling back to the old path unless declared otherwise', () => {
    const manager = new FeatureFlagManager()
    manager.loadFromYamlText(YAML)
    expect(manager.shouldFallback('new_compaction')).toBe(true)
    expect(manager.shouldFallback('v2_scheduler')).toBe(false)
    expect(manager.shouldFallback('ghost')).toBe(true)
  })
})

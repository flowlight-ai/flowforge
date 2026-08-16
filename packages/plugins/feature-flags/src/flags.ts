/**
 * Feature flags: old/new path switching, gradual rollout and A-B
 * validation. Mapped from flowforge Python legacy `core/feature_flags.py`
 * (F24) with two documented fixes: (1) the Python `is_enabled` returned
 * TRUE for expired flags (inverted branch) — here an expired flag is
 * disabled; (2) Python defaulted `rollout_percentage` to 0, silently
 * disabling every enabled flag — here the default is 100 (enabled = on).
 *
 * Rollout bucketing keeps the Python formula (md5 over `name:project`,
 * mod 100) so a flag's audience is identical across the two stacks.
 *
 * YAML assembly follows R17 (js-yaml, same loader family as the cordis
 * loader).
 *
 * @module @flowforge/feature-flags/flags
 */

import { createHash } from 'node:crypto'
import { load } from 'js-yaml'

/** How a flag flips traffic between old and new paths. */
export type SwitchStrategy = 'feature_flag' | 'ab_parallel' | 'hard_switch'

const SWITCH_STRATEGIES: readonly SwitchStrategy[] = ['feature_flag', 'ab_parallel', 'hard_switch']

/** One feature flag declaration. */
export interface FeatureFlag {
  readonly name: string
  enabled: boolean
  rolloutPercentage: number
  allowedProjects: readonly string[]
  fallbackToOld: boolean
  switchStrategy: SwitchStrategy
  createdAt: number
  /** Epoch seconds; undefined = never expires. */
  expiresAt?: number
  description: string
}

function createFlag(name: string, enabled: boolean): FeatureFlag {
  return {
    name,
    enabled,
    rolloutPercentage: 100,
    allowedProjects: [],
    fallbackToOld: true,
    switchStrategy: 'feature_flag',
    createdAt: Date.now() / 1000,
    description: '',
  }
}

/** Stable rollout bucket: md5(`name:subject`) mod 100, same as Python. */
export function rolloutBucket(name: string, subject: string): number {
  const digest = createHash('md5').update(`${name}:${subject}`).digest('hex')
  return Number(BigInt(`0x${digest}`) % 100n)
}

/**
 * Feature flag manager. Construct empty and `loadFromYamlText` /
 * `setFlag`, or hydrate from the R17 assembly document:
 *
 * ```yaml
 * features:
 *   new_compaction: true
 *   v2_scheduler:
 *     enabled: true
 *     rollout_percentage: 25
 *     allowed_projects: [flowlight]
 * ```
 */
export class FeatureFlagManager {
  private readonly flags = new Map<string, FeatureFlag>()

  constructor(private readonly now: () => number = () => Date.now() / 1000) {}

  /** Load flags from a parsed YAML assembly document ({ features: ... }). */
  loadFromRecord(data: unknown): void {
    if (typeof data !== 'object' || data === null) return
    const features = (data as { features?: unknown }).features
    if (typeof features !== 'object' || features === null || Array.isArray(features)) return
    for (const [name, config] of Object.entries(features as Record<string, unknown>)) {
      if (typeof config === 'boolean') {
        this.flags.set(name, createFlag(name, config))
      } else if (typeof config === 'object' && config !== null) {
        const record = config as Record<string, unknown>
        const strategy = record.switch_strategy
        this.flags.set(name, {
          ...createFlag(name, record.enabled === true),
          rolloutPercentage: typeof record.rollout_percentage === 'number' ? record.rollout_percentage : 100,
          allowedProjects: Array.isArray(record.allowed_projects) ? record.allowed_projects.map(String) : [],
          fallbackToOld: record.fallback_to_old !== false,
          switchStrategy: SWITCH_STRATEGIES.includes(strategy as SwitchStrategy)
            ? (strategy as SwitchStrategy)
            : 'feature_flag',
          description: typeof record.description === 'string' ? record.description : '',
        })
      }
    }
  }

  /** Load flags from YAML text (R17). Empty/invalid documents load nothing. */
  loadFromYamlText(text: string): void {
    this.loadFromRecord(load(text))
  }

  /**
   * Is the new path enabled for (name, project)? Order: existence →
   * enabled → allowlist → rollout bucket → expiry.
   */
  isEnabled(name: string, project?: string): boolean {
    const flag = this.flags.get(name)
    if (flag === undefined) return false
    if (!flag.enabled) return false
    if (flag.allowedProjects.length > 0 && project !== undefined && !flag.allowedProjects.includes(project)) {
      return false
    }
    if (flag.rolloutPercentage < 100) {
      if (rolloutBucket(name, project ?? 'default') >= flag.rolloutPercentage) return false
    }
    // Fixed vs Python: an EXPIRED flag is disabled (Python inverted this).
    if (flag.expiresAt !== undefined && this.now() > flag.expiresAt) return false
    return true
  }

  getFlag(name: string): FeatureFlag | undefined {
    return this.flags.get(name)
  }

  /** Create-or-update the enabled bit of a flag. */
  setFlag(name: string, enabled: boolean): void {
    const existing = this.flags.get(name)
    if (existing !== undefined) existing.enabled = enabled
    else this.flags.set(name, createFlag(name, enabled))
  }

  /** Should a failed new path fall back to the old one? (default: yes) */
  shouldFallback(name: string): boolean {
    return this.flags.get(name)?.fallbackToOld ?? true
  }

  allFlags(): ReadonlyMap<string, FeatureFlag> {
    return this.flags
  }
}

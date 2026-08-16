/**
 * @flowforge/feature-flags — feature flag manager (F24): old/new path
 * switching, stable rollout bucketing, project allowlists, expiry and
 * fallback policy. Mapped from flowforge Python legacy
 * `core/feature_flags.py`.
 *
 * @module @flowforge/feature-flags
 */

export type { FeatureFlag, SwitchStrategy } from './flags.ts'
export { FeatureFlagManager, rolloutBucket } from './flags.ts'

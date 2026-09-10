/**
 * @flowforge/forgekin-sop-assets — SopAsset content schema (sop-definitions).
 *
 * A *content asset* is a declarative, validated SOP definition that the
 * `@flowforge/forgekin-sop` engine can bind to. Unlike the engine's runtime
 * models (SOPDefinition/SOPStage + factories), these assets are authored
 * content: full required-field interfaces with `make*` factories filling
 * defaults (avoids exactOptionalPropertyTypes boilerplate).
 */

export const SopRuleSeverity = {
  BLOCKER: 'blocker',
  WARN: 'warn',
} as const

export type SopRuleSeverity = (typeof SopRuleSeverity)[keyof typeof SopRuleSeverity]

/** A single guard statement inside a stage (hard rule or pitfall). */
export interface SopRuleAsset {
  id: string
  text: string
  severity: SopRuleSeverity
}

export function makeSopRuleAsset(init: Pick<SopRuleAsset, 'id' | 'text'> & { severity?: SopRuleSeverity }): SopRuleAsset {
  return { id: init.id, text: init.text, severity: init.severity ?? SopRuleSeverity.BLOCKER }
}

export interface SopStageAsset {
  id: string
  label: string
  /** Route the engine to a suggested skill for this stage. */
  suggestedSkill?: string
  optional?: boolean
  hardRules?: SopRuleAsset[]
  pitfalls?: SopRuleAsset[]
}

export function makeSopStageAsset(init: SopStageAsset): SopStageAsset {
  return {
    id: init.id,
    label: init.label,
    ...(init.suggestedSkill !== undefined ? { suggestedSkill: init.suggestedSkill } : {}),
    optional: init.optional ?? false,
    hardRules: init.hardRules ?? [],
    pitfalls: init.pitfalls ?? [],
  }
}

export interface SopAsset {
  id: string
  domain: string
  label: string
  description: string
  stages: SopStageAsset[]
  /** Expected skill dependencies that must be mounted before the SOP runs. */
  requiredSkills?: string[]
}

export function makeSopAsset(init: SopAsset): SopAsset {
  return {
    id: init.id,
    domain: init.domain,
    label: init.label,
    description: init.description,
    stages: init.stages.map(makeSopStageAsset),
    ...(init.requiredSkills !== undefined ? { requiredSkills: init.requiredSkills } : {}),
  }
}

/** Raw form of an asset before factory normalization (parsing seam target). */
export type RawSopAsset = {
  id?: unknown
  domain?: unknown
  label?: unknown
  description?: unknown
  stages?: unknown
  requiredSkills?: unknown
}
import { makeSopAsset, SopRuleSeverity, type RawSopAsset, type SopAsset, type SopRuleAsset } from './sop-asset-model.ts'

export interface SopAssetIssue {
  assetId?: string
  severity: 'error' | 'warning'
  path: string
  message: string
}

/**
 * Pure validator over a normalized SopAsset. Returns a list of issues; an empty
 * list means the asset is valid and safe to register/bind.
 */
export function validateSopAsset(asset: SopAsset): SopAssetIssue[] {
  const issues: SopAssetIssue[] = []

  if (!asset.id.trim()) issues.push({ assetId: asset.id, severity: 'error', path: 'id', message: 'asset id must be non-empty' })
  if (!asset.domain.trim()) issues.push({ assetId: asset.id, severity: 'error', path: 'domain', message: 'domain must be non-empty' })
  if (!asset.label.trim()) issues.push({ assetId: asset.id, severity: 'error', path: 'label', message: 'label must be non-empty' })
  if (asset.stages.length === 0) {
    issues.push({ assetId: asset.id, severity: 'error', path: 'stages', message: 'an SOP asset must declare at least one stage' })
  }

  if (asset.requiredSkills) {
    for (const skill of asset.requiredSkills) {
      if (!skill.trim()) issues.push({ assetId: asset.id, severity: 'warning', path: 'requiredSkills', message: 'requiredSkill entries must be non-empty' })
    }
  }

  const stageIds = new Set<string>()
  for (const stage of asset.stages) {
    const path = `stages[${stage.id}]`
    if (!stage.id.trim()) {
      issues.push({ assetId: asset.id, severity: 'error', path, message: 'stage id must be non-empty' })
      continue
    }
    if (stageIds.has(stage.id)) {
      issues.push({ assetId: asset.id, severity: 'error', path, message: `duplicate stage id "${stage.id}"` })
    }
    stageIds.add(stage.id)

    if (!stage.label.trim()) issues.push({ assetId: asset.id, severity: 'error', path: `${path}.label`, message: 'stage label must be non-empty' })
    if (stage.suggestedSkill !== undefined && !stage.suggestedSkill.trim()) {
      issues.push({ assetId: asset.id, severity: 'warning', path: `${path}.suggestedSkill`, message: 'suggestedSkill must be non-empty when present' })
    }

    const ruleIds = new Set<string>()
    for (const rule of [...(stage.hardRules ?? []), ...(stage.pitfalls ?? [])]) {
      if (!rule.id.trim()) {
        issues.push({ assetId: asset.id, severity: 'error', path: `${path}.rules`, message: 'rule id must be non-empty' })
        continue
      }
      if (ruleIds.has(rule.id)) issues.push({ assetId: asset.id, severity: 'error', path: `${path}.rules[${rule.id}]`, message: `duplicate rule id "${rule.id}"` })
      ruleIds.add(rule.id)
      if (!isSeverity(rule.severity)) {
        issues.push({ assetId: asset.id, severity: 'error', path: `${path}.rules[${rule.id}].severity`, message: `invalid severity "${String(rule.severity)}"` })
      }
    }
  }

  return issues
}

export function isSopAssetValid(asset: SopAsset): boolean {
  return !validateSopAsset(asset).some((issue) => issue.severity === 'error')
}

/**
 * Parse a raw (fully or partially typed) asset payload into a normalized
 * SopAsset, then validate it. Throws a descriptive Error listing all error
 * issues when the payload is invalid.
 */
export function parseAndValidateSopAsset(raw: RawSopAsset): SopAsset {
  const normalized = makeSopAsset(normalizeRaw(raw))
  const issues = validateSopAsset(normalized)
  const errors = issues.filter((issue) => issue.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`invalid sop asset: ${errors.map((issue) => issue.message).join('; ')}`)
  }
  return normalized
}

function normalizeRaw(raw: RawSopAsset): SopAsset {
  return {
    id: stringOr(raw.id, ''),
    domain: stringOr(raw.domain, 'engineering'),
    label: stringOr(raw.label, ''),
    description: stringOr(raw.description, ''),
    stages: normalizeStages(raw.stages),
    ...(Array.isArray(raw.requiredSkills) ? { requiredSkills: raw.requiredSkills.map((s) => stringOr(s, '')) } : {}),
  }
}

function normalizeStages(value: unknown): SopAsset['stages'] {
  if (!Array.isArray(value)) return []
  return value.map((stage) => makeSopStageFromRaw(stage))
}

function makeSopStageFromRaw(value: unknown): SopAsset['stages'][number] {
  const record = toRecord(value)
  return {
    id: stringOr(record.id, ''),
    label: stringOr(record.label, ''),
    ...(record.suggestedSkill !== undefined ? { suggestedSkill: stringOr(record.suggestedSkill, '') } : {}),
    optional: typeof record.optional === 'boolean' ? record.optional : false,
    hardRules: normalizeRules(record.hardRules),
    pitfalls: normalizeRules(record.pitfalls, SopRuleSeverity.WARN),
  }
}

function normalizeRules(value: unknown, defaultSeverity: SopRuleSeverity = SopRuleSeverity.BLOCKER): SopRuleAsset[] {
  if (!Array.isArray(value)) return []
  return value.map((rule) => {
    const record = toRecord(rule)
    return {
      id: stringOr(record.id, ''),
      text: stringOr(record.text, ''),
      severity: isSeverity(record.severity) ? record.severity : defaultSeverity,
    }
  })
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function isSeverity(value: unknown): value is SopRuleSeverity {
  return value === SopRuleSeverity.BLOCKER || value === SopRuleSeverity.WARN
}
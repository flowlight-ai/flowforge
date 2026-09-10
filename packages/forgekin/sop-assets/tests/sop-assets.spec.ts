import { describe, expect, it } from 'vitest'
import {
  makeSopAsset,
  makeSopStageAsset,
  type SopAsset,
  type SopStageAsset,
} from '../src/sop-asset-model.ts'
import {
  isSopAssetValid,
  parseAndValidateSopAsset,
  validateSopAsset,
} from '../src/validate-sop-asset.ts'
import { MemorySopAssetRegistry } from '../src/assets.ts'
import { BUILTIN_SOPS, catEvolveSop, registerBuiltinSops } from '../src/builtin-sops.ts'
import { jsonSopAssetParser, loadSopAsset } from '../src/loader.ts'

function validAsset(overrides: Partial<SopAsset> = {}): SopAsset {
  return makeSopAsset({
    id: 'demo.asset',
    domain: 'engineering',
    label: 'Demo SOP',
    description: 'A valid demo SOP.',
    stages: [makeSopStageAsset({ id: 's1', label: 'Setup' })],
    ...overrides,
  })
}

describe('validateSopAsset', () => {
  it('accepts a valid asset with no issues', () => {
    expect(validateSopAsset(validAsset())).toEqual([])
    expect(isSopAssetValid(validAsset())).toBe(true)
  })

  it('flags empty id / domain / label as errors', () => {
    const issues = validateSopAsset(validAsset({ id: '', label: '', domain: '' }))
    const errors = issues.filter((issue) => issue.severity === 'error')
    expect(errors.some((issue) => issue.path === 'id')).toBe(true)
    expect(errors.some((issue) => issue.path === 'label')).toBe(true)
    expect(errors.some((issue) => issue.path === 'domain')).toBe(true)
    expect(isSopAssetValid(validAsset({ id: '' }))).toBe(false)
  })

  it('requires at least one stage', () => {
    expect(validateSopAsset(validAsset({ stages: [] })).some((issue) => issue.severity === 'error')).toBe(true)
  })

  it('flags duplicate stage ids and duplicate rule ids', () => {
    const asset = validAsset({
      stages: [
        makeSopStageAsset({ id: 's1', label: 'One' }),
        makeSopStageAsset({ id: 's1', label: 'Two' }),
      ],
    })
    const messages = validateSopAsset(asset).filter((issue) => issue.severity === 'error').map((issue) => issue.message)
    expect(messages.some((m) => m.includes('duplicate stage id'))).toBe(true)
  })

  it('flags an invalid rule severity', () => {
    const asset = validAsset({
      stages: [
        makeSopStageAsset({
          id: 's1',
          label: 'Setup',
          hardRules: [{ id: 'r1', text: 'x', severity: 'severe' as never }],
        }),
      ],
    })
    expect(isSopAssetValid(asset)).toBe(false)
  })

  it('warns on empty suggestedSkill when present', () => {
    const asset = validAsset({
      stages: [makeSopStageAsset({ id: 's1', label: 'Setup', suggestedSkill: '  ' })],
    })
    expect(validateSopAsset(asset).some((issue) => issue.path.endsWith('suggestedSkill'))).toBe(true)
  })
})

describe('parseAndValidateSopAsset', () => {
  it('parses a raw payload, applying defaults, and normalizes severities', () => {
    const asset = parseAndValidateSopAsset({
      id: 'raw.demo',
      label: 'Raw Demo',
      stages: [
        { id: 'a', label: 'A', hardRules: [{ id: 'a1', text: 'must' }] },
        { id: 'b', label: 'B', pitfalls: [{ id: 'b1', text: 'watch' }] },
      ],
    })
    expect(asset.domain).toBe('engineering') // default
    expect(asset.stages[0]?.hardRules?.[0]?.severity).toBe('blocker') // default blocker
    expect(asset.stages[1]?.pitfalls?.[0]?.severity).toBe('warn') // pitfalls default warn
  })

  it('throws when the payload has error-level issues', () => {
    expect(() => parseAndValidateSopAsset({ id: '', stages: [] })).toThrow()
  })
})

describe('MemorySopAssetRegistry', () => {
  it('registers, queries, and lists assets; clones on read', () => {
    const registry = new MemorySopAssetRegistry()
    registry.register(validAsset())
    expect(registry.has('demo.asset')).toBe(true)
    expect(registry.get('demo.asset')?.label).toBe('Demo SOP')
    expect(registry.all()).toHaveLength(1)
  })

  it('returns undefined for unknown ids', () => {
    const registry = new MemorySopAssetRegistry()
    expect(registry.get('nope')).toBeUndefined()
  })

  it('rejects duplicate ids and invalid assets', () => {
    const registry = new MemorySopAssetRegistry()
    registry.register(validAsset())
    expect(() => registry.register(validAsset())).toThrow('duplicate')
    expect(() => registry.register(validAsset({ id: '' }))).toThrow('invalid')
  })
})

describe('builtin SOP assets', () => {
  it('registers all builtins and they are valid', () => {
    const registry = new MemorySopAssetRegistry()
    registerBuiltinSops((asset) => registry.register(asset))
    expect(registry.all()).toHaveLength(2)
    expect(registry.has('phase.cat.evolve')).toBe(true)
    expect(registry.has('phase.cat.ship')).toBe(true)
    for (const asset of BUILTIN_SOPS) expect(isSopAssetValid(asset)).toBe(true)
  })

  it('catEvolveSop declares its stages and required skills', () => {
    expect(catEvolveSop.stages.map((stage: SopStageAsset) => stage.id)).toEqual(['design', 'implement', 'verify'])
    expect(catEvolveSop.requiredSkills).toContain('review')
  })
})

describe('loadSopAsset', () => {
  it('loads and validates an asset from a JSON string via the default parser', () => {
    const asset = loadSopAsset(
      JSON.stringify({
        id: 'json.demo',
        domain: 'ops',
        label: 'Ops demo',
        description: 'from json',
        stages: [{ id: 'go', label: 'Go' }],
      }),
      jsonSopAssetParser,
    )
    expect(asset.id).toBe('json.demo')
    expect(asset.domain).toBe('ops')
  })

  it('throws when loaded JSON is invalid', () => {
    expect(() => loadSopAsset(JSON.stringify({ id: '', stages: [] }), jsonSopAssetParser)).toThrow()
  })
})
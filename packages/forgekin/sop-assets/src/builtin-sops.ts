import { makeSopAsset, type SopAsset } from './sop-asset-model.ts'

/**
 * Builtin SOP content assets (sop-definitions content). These are the default
 * standard operating procedures shipped with the framework; additional assets
 * can be authored and loaded via the loader.
 */

/** phase.cat.evolve — 契约导向的 Forgekin 自开发 SOP。 */
export const catEvolveSop: SopAsset = makeSopAsset({
  id: 'phase.cat.evolve',
  domain: 'engineering',
  label: 'Contract-driven Cat Evolution',
  description: 'Evolve a Forgekin (cat) through contract-first design, implementation, and verification.',
  requiredSkills: ['design-doc', 'code-index', 'review'],
  stages: [
    {
      id: 'design',
      label: 'Contract & Design',
      suggestedSkill: 'design-doc',
      hardRules: [{ id: 'design.doc.present', text: 'A design document must exist before implementation.', severity: 'blocker' }],
      pitfalls: [{ id: 'design.scope.creep', text: 'Avoid expanding scope beyond the approved contract.', severity: 'warn' }],
    },
    {
      id: 'implement',
      label: 'Implementation',
      suggestedSkill: 'code-index',
      optional: false,
      hardRules: [{ id: 'impl.follows.design', text: 'Implementation must follow the approved design.', severity: 'blocker' }],
    },
    {
      id: 'verify',
      label: 'Verification',
      suggestedSkill: 'review',
      optional: false,
      hardRules: [{ id: 'verify.ci.green', text: 'All checks and tests must pass.', severity: 'blocker' }],
    },
  ],
})

/** phase.cat.ship — 发布/交接 SOP。 */
export const catShipSop: SopAsset = makeSopAsset({
  id: 'phase.cat.ship',
  domain: 'delivery',
  label: 'Cat Release & Handoff',
  description: 'Package, version, and hand off a Forgekin release with provenance.',
  requiredSkills: ['release', 'changelog'],
  stages: [
    {
      id: 'prepare',
      label: 'Prepare Release',
      hardRules: [{ id: 'release.change.log', text: 'Changelog must be updated.', severity: 'blocker' }],
    },
    {
      id: 'handoff',
      label: 'Handoff & Provenance',
      optional: true,
      pitfalls: [{ id: 'handoff.missing.owner', text: 'Ensure a named owner takes custody.', severity: 'warn' }],
    },
  ],
})

export const BUILTIN_SOPS: SopAsset[] = [catEvolveSop, catShipSop]

export function registerBuiltinSops(register: (asset: SopAsset) => void): void {
  for (const asset of BUILTIN_SOPS) register(asset)
}
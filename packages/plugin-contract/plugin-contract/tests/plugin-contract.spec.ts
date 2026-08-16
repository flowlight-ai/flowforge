/**
 * Contract suite: capability table, manifest validation (JSON + YAML
 * assembly), route mounting (R18), grants fail-closed boundary, and host
 * conformance. Fixtures mirror the upstream application contract's committed
 * fixtures/manifest/{valid,invalid} cases, translated to FlowForge names.
 */

import { describe, expect, it } from 'vitest'
import {
  API_V2_PREFIX,
  CAPABILITY_TABLE,
  DATA_CLASS_ALLOWED_STRATEGIES,
  L0_CAPABILITIES,
  L1_CAPABILITIES,
  L2_CAPABILITIES,
  MAX_GRANT_ITEMS,
  VALID_CAPABILITIES,
  checkAppPluginConformance,
  getCapabilityLayer,
  grantsOfFeatures,
  loadManifestYaml,
  manifestCapabilities,
  resolveRouteMounts,
  validateEffectiveGrants,
  validateManifest,
  validateRouteMount,
  type PluginManifest,
} from '../src/index.ts'

const validManifest = {
  pluginId: 'taste-memory',
  version: '0.3.1',
  contractVersion: '0.1.0',
  name: 'Taste Memory',
  description: 'Remembers the user taste across sessions',
  features: [{
    id: 'recall',
    name: 'Taste recall',
    resources: [{ type: 'store', id: 'taste' }],
    capabilities: ['memory.query', 'memory.append'],
  }],
  data: [
    { name: 'taste-index', dataClass: 'derived-user-visible', strategy: 'retained' },
    { name: 'probe-cache', dataClass: 'cache', strategy: 'lifecycle' },
  ],
  runtime: { transport: 'builtin' },
  routes: [
    { path: '/tastes', methods: ['GET', 'POST'] },
    { path: '/tastes/:tasteId', methods: ['GET', 'DELETE'] },
  ],
  credentials: [{ id: 'openai-key', provider: 'openai', purpose: 'embed taste vectors', required: false }],
  lifecycle: { hooks: ['onEnable', 'onDisable'] },
}

describe('capability table', () => {
  it('partitions the closed enum into L0/L1/L2 without overlap', () => {
    const higher = new Set<string>([...L1_CAPABILITIES, ...L2_CAPABILITIES])
    const overlap = L0_CAPABILITIES.filter(capability => higher.has(capability))
    expect(overlap).toEqual([])
    expect(VALID_CAPABILITIES.size).toBe(L0_CAPABILITIES.length + L1_CAPABILITIES.length + L2_CAPABILITIES.length)
    expect(MAX_GRANT_ITEMS).toBe(VALID_CAPABILITIES.size)
  })

  it('resolves every table member to its owning layer, nothing outside', () => {
    expect(getCapabilityLayer('plugin.config.read')).toBe('L0')
    expect(getCapabilityLayer('messaging.send')).toBe('L1')
    expect(getCapabilityLayer('secret.read')).toBe('L2')
    expect(getCapabilityLayer('host.everything')).toBeUndefined()
    for (const layer of Object.keys(CAPABILITY_TABLE) as Array<keyof typeof CAPABILITY_TABLE>) {
      for (const capability of CAPABILITY_TABLE[layer]) {
        expect(getCapabilityLayer(capability)).toBe(layer)
      }
    }
  })
})

describe('validateManifest', () => {
  it('accepts a full valid manifest and exposes its capability union', () => {
    const result = validateManifest(validManifest)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.manifest.pluginId).toBe('taste-memory')
    expect(manifestCapabilities(result.manifest)).toEqual(['memory.query', 'memory.append'])
  })

  it('rejects an unknown capability with its exact instance path', () => {
    const result = validateManifest({
      ...validManifest,
      features: [{ id: 'f', name: 'F', resources: [], capabilities: ['memory.query', 'host.takeover'] }],
    })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors).toContainEqual(expect.objectContaining({
      instancePath: '/features/0/capabilities/1',
      keyword: 'enum',
      message: expect.stringContaining('host.takeover'),
    }))
  })

  it('rejects semver ranges and leading-zero prereleases', () => {
    for (const bad of ['^0.3.1', '0.3', '1.0.0-01', 'latest']) {
      const result = validateManifest({ ...validManifest, version: bad })
      expect(result.valid, `version ${bad}`).toBe(false)
    }
    const buildMeta = validateManifest({ ...validManifest, version: '1.0.0+build.7' })
    expect(buildMeta.valid).toBe(true)
  })

  it('requires an entrypoint for stdio/ipc runtimes but not builtin', () => {
    expect(validateManifest({ ...validManifest, runtime: { transport: 'stdio' } }).valid).toBe(false)
    expect(validateManifest({ ...validManifest, runtime: { transport: 'ipc', entrypoint: ' ' } }).valid).toBe(false)
    expect(validateManifest({ ...validManifest, runtime: { transport: 'stdio', entrypoint: './bin/agent.mjs' } }).valid).toBe(true)
    expect(validateManifest({ ...validManifest, runtime: { transport: 'builtin', entrypoint: '@flowforge/taste' } }).valid).toBe(true)
  })

  it('enforces data-class x strategy pairings from the schema-owned table', () => {
    const denied = validateManifest({
      ...validManifest,
      data: [{ name: 'drafts', dataClass: 'user-authored', strategy: 'lifecycle' }],
    })
    expect(denied.valid).toBe(false)
    if (denied.valid) return
    expect(denied.errors[0]?.message).toContain('not allowed for data class "user-authored"')
    expect(DATA_CLASS_ALLOWED_STRATEGIES['user-authored']).not.toContain('lifecycle')
  })

  it('rejects user-authored lifecycle hooks (closed hook surface)', () => {
    const result = validateManifest({ ...validManifest, lifecycle: { hooks: ['onEnable', 'onUserWroteThis'] } })
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors).toContainEqual(expect.objectContaining({
      instancePath: '/lifecycle/hooks/1',
      message: expect.stringContaining('user-authored hooks are not permitted'),
    }))
  })

  it('rejects non-object roots and reports every field problem at once', () => {
    expect(validateManifest(null).valid).toBe(false)
    expect(validateManifest('manifest').valid).toBe(false)
    const result = validateManifest({ pluginId: 'Bad_Id', version: 'x', contractVersion: 'y', features: 'no' })
    expect(result.valid).toBe(false)
    if (result.valid) return
    const paths = result.errors.map(e => e.instancePath)
    expect(paths).toContain('/pluginId')
    expect(paths).toContain('/version')
    expect(paths).toContain('/contractVersion')
    expect(paths).toContain('/name')
    expect(paths).toContain('/features')
    expect(paths).toContain('/runtime')
  })
})

describe('loadManifestYaml (R17 assembly format)', () => {
  it('parses a YAML manifest through the same validation as JSON', () => {
    const yaml = `
pluginId: taste-memory
version: 0.3.1
contractVersion: 0.1.0
name: Taste Memory
features:
  - id: recall
    name: Taste recall
    resources:
      - type: store
        id: taste
    capabilities:
      - memory.query
runtime:
  transport: builtin
`
    const result = loadManifestYaml(yaml)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.manifest.pluginId).toBe('taste-memory')
  })

  it('surfaces YAML parse failures as a single structural error', () => {
    const result = loadManifestYaml('pluginId: [unclosed')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.errors[0]?.keyword).toBe('parse')
  })
})

describe('route mounting (R18)', () => {
  it('mounts declared suffixes under /api/v2/<pluginId>', () => {
    const result = validateManifest(validManifest)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const mounts = resolveRouteMounts(result.manifest)
    expect(mounts.map(mount => mount.fullPath)).toEqual([
      `${API_V2_PREFIX}/taste-memory/tastes`,
      `${API_V2_PREFIX}/taste-memory/tastes/:tasteId`,
    ])
  })

  it('rejects paths outside the suffix grammar and empty method lists', () => {
    expect(validateRouteMount({ path: 'tastes', methods: ['GET'] })).toContain('must start with "/"')
    expect(validateRouteMount({ path: '/tastes/', methods: ['GET'] })).toContain('must not end with "/"')
    expect(validateRouteMount({ path: '/Tastes', methods: ['GET'] }).length).toBeGreaterThan(0)
    expect(validateRouteMount({ path: '/..', methods: ['GET'] }).length).toBeGreaterThan(0)
    expect(validateRouteMount({ path: '/tastes', methods: [] })).toContain('at least one HTTP method')
    expect(validateRouteMount({ path: '/tastes', methods: ['FETCH' as never] }).length).toBeGreaterThan(0)
    expect(validateRouteMount({ path: '/tastes/:id', methods: ['GET'] })).toEqual([])
  })

  it('fails the boot on duplicate mounts and unsafe plugin ids', () => {
    const duplicated: PluginManifest = {
      ...validManifest as PluginManifest,
      routes: [
        { path: '/tastes', methods: ['GET'] },
        { path: '/tastes', methods: ['POST'] },
      ],
    }
    expect(() => resolveRouteMounts(duplicated)).toThrow(/duplicate route mount/)
    expect(() => resolveRouteMounts({ ...validManifest, pluginId: 'Taste Memory' } as PluginManifest))
      .toThrow(/not URL-safe/)
  })
})

describe('grants (fail-closed authorization boundary)', () => {
  it('accepts unique known capabilities including the empty set', () => {
    expect(validateEffectiveGrants([])).toBe(true)
    expect(validateEffectiveGrants([...VALID_CAPABILITIES])).toBe(true)
  })

  it('rejects duplicates, unknown values, and oversized sets', () => {
    expect(validateEffectiveGrants(['messaging.send', 'messaging.send'])).toBe(false)
    expect(validateEffectiveGrants(['host.takeover'])).toBe(false)
    expect(validateEffectiveGrants([...VALID_CAPABILITIES, 'plugin.config.read'])).toBe(false)
  })

  it('derives effective grants as the deduplicated feature union', () => {
    expect(grantsOfFeatures(['memory.query', 'memory.append', 'memory.query'])).toEqual(['memory.query', 'memory.append'])
  })
})

describe('checkAppPluginConformance', () => {
  function makePlugin(hooks: Record<string, () => void> = {}): (ctx: unknown) => void {
    const plugin = Object.assign((_ctx: unknown) => undefined, hooks)
    ;(plugin as { inject?: string[] }).inject = ['settings']
    return plugin
  }

  it('passes a function plugin whose declared hooks are implemented', () => {
    const result = checkAppPluginConformance({
      plugin: makePlugin({ onEnable: () => undefined, onDisable: () => undefined }),
      manifest: validManifest,
    })
    expect(result.conformant).toBe(true)
    if (!result.conformant) return
    expect(result.manifest.pluginId).toBe('taste-memory')
  })

  it('fails when a declared hook is not implemented', () => {
    const result = checkAppPluginConformance({ plugin: makePlugin({ onEnable: () => undefined }), manifest: validManifest })
    expect(result.conformant).toBe(false)
    if (result.conformant) return
    expect(result.failures).toContainEqual(expect.objectContaining({
      rule: 'lifecycle',
      message: expect.stringContaining('"onDisable"'),
    }))
  })

  it('fails non-plugin values and invalid manifests, naming every rule', () => {
    expect(checkAppPluginConformance({ plugin: 42, manifest: validManifest }).failures[0]?.rule).toBe('kernel.apply')
    const bad = checkAppPluginConformance({
      plugin: makePlugin(),
      manifest: { ...validManifest, lifecycle: { hooks: ['onEnable', 'onDisable'] }, features: [{ id: 'f', name: 'F', resources: [], capabilities: ['nope'] }] },
    })
    expect(bad.conformant).toBe(false)
    if (bad.conformant) return
    expect(bad.failures.every(failure => failure.rule === 'manifest')).toBe(true)
  })
})

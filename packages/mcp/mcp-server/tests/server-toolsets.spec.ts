import { describe, expect, it } from 'vitest';
import {
  applyReadonlyFilter,
  bindMcpImplementation,
  defineMcpTool,
  parseToolsetEnv,
} from '../src/index.js';
import type { FamilyToolDefinition } from '../src/tool-governance-snapshot.js';

const readBoundary = {
  authorizationPaths: [
    {
      principal: 'invocation-cat' as const,
      credentialSource: 'invocation-record' as const,
      scope: { kind: 'global-governed' as const },
      enforcementRef: 'file:governance.md',
    },
  ],
  risk: { level: 'read' as const, openWorld: false },
};

function makeTool(name: string, profiles: ReadonlyArray<string>): FamilyToolDefinition {
  const def = defineMcpTool({
    name,
    description: `Tool ${name}`,
    operation: { kind: 'single', action: 'read', inputSchema: {}, boundary: readBoundary },
    implementation: bindMcpImplementation('module:cat-shared#readX', async () => ({})),
    policy: {
      resourceFamily: 'fam',
      schemaDelivery: { policy: 'host-default', evidenceRef: 'file:governance.md' },
      runtimeProfiles: profiles as FamilyToolDefinition['policy']['runtimeProfiles'],
      owner: { domainCell: 'architecture-cell:x', surface: 'mcp-surface-governance' },
      standaloneReason: { disposition: 'consolidation-candidate', kind: 'same-resource-lifecycle', evidenceRef: 'file:governance.md' },
      activeState: 'canonical',
      cognitiveEntryPoints: [{ kind: 'tool-description', ref: 'file:governance.md' }],
      verification: [{ kind: 'test', ref: 'test:governance' }],
    },
  });
  return { ...def, serverFamily: 'collab' };
}

const registry: readonly FamilyToolDefinition[] = [
  makeTool('full_tool', ['full']),
  makeTool('ro_only', ['readonly']),
  makeTool('ak_only', ['agent-key']),
  makeTool('desk_fable', ['desktop:fable-phase0']),
  makeTool('desk_cloud', ['desktop:cloud-pro-phase0']),
];

describe('parseToolsetEnv', () => {
  it('parses env fixture into a structured ToolsetEnv', () => {
    const env = parseToolsetEnv({
      CAT_CAFE_READONLY: 'true',
      CAT_CAFE_AGENT_KEY_SECRET: 'abc',
      CAT_CAFE_DESKTOP_MODE: 'fable-phase0',
    } as NodeJS.ProcessEnv);
    expect(env.readonly).toBe(true);
    expect(env.hasAgentKey).toBe(true);
    expect(env.desktopMode).toBe('fable-phase0');
  });

  it('trims empty desktop mode to undefined and ignores non-true readonly', () => {
    const env = parseToolsetEnv({ CAT_CAFE_DESKTOP_MODE: '  ' } as NodeJS.ProcessEnv);
    expect(env.desktopMode).toBeUndefined();
    expect(env.readonly).toBe(false);
  });
});

describe('applyReadonlyFilter precedence', () => {
  it('desktop strict whitelist wins over readonly/full', () => {
    const out = applyReadonlyFilter(registry, { desktopMode: 'fable-phase0' });
    expect(out.map((t) => t.name)).toEqual(['desk_fable']);
  });

  it('cloud-pro desktop whitelist selects its own profile', () => {
    const out = applyReadonlyFilter(registry, { desktopMode: 'cloud-pro-phase0' });
    expect(out.map((t) => t.name)).toEqual(['desk_cloud']);
  });

  it('full mode (no readonly, no desktop) returns every tool unchanged', () => {
    const out = applyReadonlyFilter(registry, {});
    expect(out.map((t) => t.name)).toEqual([
      'full_tool',
      'ro_only',
      'ak_only',
      'desk_fable',
      'desk_cloud',
    ]);
  });

  it('readonly mode keeps readonly ∪ (agent-key when key present)', () => {
    const ro = applyReadonlyFilter(registry, { readonly: true });
    expect(ro.map((t) => t.name)).toEqual(['ro_only']);
    const withKey = applyReadonlyFilter(registry, { readonly: true, hasAgentKey: true });
    expect(withKey.map((t) => t.name)).toEqual(['ro_only', 'ak_only']);
  });

  it('unknown desktop mode throws fail-fast', () => {
    expect(() => applyReadonlyFilter(registry, { desktopMode: 'bogus' })).toThrow(/Unknown CAT_CAFE_DESKTOP_MODE/);
  });
});
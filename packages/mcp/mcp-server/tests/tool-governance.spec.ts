import { describe, expect, it } from 'vitest';
import {
  bindMcpImplementation,
  buildCanonicalToolRegistry,
  defineMcpTool,
  deriveProfileNames,
  projectCanonicalToolRegistry,
  projectServerFamily,
} from '../src/index.js';
import type { FamilyToolDefinition, McpServerFamily } from '../src/tool-governance-snapshot.js';
import type { McpActionBoundary, McpToolDefinition, McpToolDefinitionInput } from '../src/tool-governance-types.js';

const readBoundary: McpActionBoundary = {
  authorizationPaths: [
    {
      principal: 'invocation-cat',
      credentialSource: 'invocation-record',
      scope: { kind: 'global-governed' },
      enforcementRef: 'file:governance.md',
    },
  ],
  risk: { level: 'read', openWorld: false },
};

const writeBoundary: McpActionBoundary = {
  authorizationPaths: [
    {
      principal: 'invocation-cat',
      credentialSource: 'invocation-record',
      scope: { kind: 'owner', resourceRef: '@cat' },
      enforcementRef: 'file:governance.md',
    },
  ],
  risk: { level: 'write', openWorld: false },
};

function baseInput(partial: Partial<McpToolDefinitionInput>): McpToolDefinitionInput {
  return {
    name: 'x_tool',
    description: 'A governed tool',
    operation: { kind: 'single', action: 'read', inputSchema: {}, boundary: readBoundary },
    implementation: bindMcpImplementation('module:cat-shared#readX', async () => ({ value: 1 })),
    policy: {
      resourceFamily: 'x',
      schemaDelivery: { policy: 'host-default', evidenceRef: 'file:governance.md' },
      runtimeProfiles: ['full', 'readonly'],
      owner: { domainCell: 'architecture-cell:x', surface: 'mcp-surface-governance' },
      standaloneReason: { disposition: 'consolidation-candidate', kind: 'same-resource-lifecycle', evidenceRef: 'file:governance.md' },
      activeState: 'canonical',
      cognitiveEntryPoints: [{ kind: 'tool-description', ref: 'file:governance.md' }],
      verification: [{ kind: 'test', ref: 'test:governance' }],
    },
    ...partial,
  };
}

describe('defineMcpTool derivation', () => {
  it('derives effectiveRisk / annotations / actionInventory / inputSchema for a single operation', () => {
    const tool = defineMcpTool(baseInput({}));
    expect(tool.actionInventory).toEqual(['read']);
    expect(tool.effectiveRisk).toEqual({ level: 'read', openWorld: false });
    expect(tool.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(tool.inputSchema).toEqual({});
    expect(Object.isFrozen(tool)).toBe(true);
  });

  it('derives write/destructive risk and exposes the operation handler', async () => {
    const tool = defineMcpTool(
      baseInput({
        operation: {
          kind: 'single',
          action: 'nuke',
          inputSchema: { type: 'object', properties: { force: { type: 'boolean' } } },
          boundary: { ...writeBoundary, risk: { level: 'destructive', openWorld: true } },
        },
      }),
    );
    expect(tool.effectiveRisk).toEqual({ level: 'destructive', openWorld: true });
    expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(tool.inputSchema).toMatchObject({ type: 'object' });
    expect(tool.handler).toBeTypeOf('function');
  });

  it('derives actionInventory from a discriminated operation and rejects empty/dup actions', () => {
    const tool = defineMcpTool({
      ...baseInput({}),
      operation: {
        kind: 'discriminated',
        discriminator: 'action',
        variants: [
          { action: 'create', inputSchema: {}, boundary: writeBoundary },
          { action: 'destroy', inputSchema: {}, boundary: writeBoundary },
        ],
      },
    });
    expect(tool.actionInventory).toEqual(['create', 'destroy']);
    expect(() => defineMcpTool(baseInput({ operation: { kind: 'single', action: '  ', inputSchema: {}, boundary: readBoundary } }))).toThrow();
    expect(() =>
      defineMcpTool(
        baseInput({
          operation: {
            kind: 'discriminated',
            discriminator: 'action',
            variants: [
              { action: 'go', inputSchema: {}, boundary: writeBoundary },
              { action: 'go', inputSchema: {}, boundary: writeBoundary },
            ],
          },
        }),
      ),
    ).toThrow(/Duplicate/);
  });

  it('bindMcpImplementation rejects malformed refs', () => {
    expect(() => bindMcpImplementation('bogus', async () => ({}))).toThrow();
    expect(() => bindMcpImplementation('module:m#x', async () => ({}))).not.toThrow();
  });
});

describe('deriveProfileNames', () => {
  it('returns sorted names for a given runtime profile', () => {
    const b = defineMcpTool(baseInput({ name: 'b_tool', policy: { ...baseInput({}).policy, runtimeProfiles: ['full'] } }));
    const a = defineMcpTool(baseInput({ name: 'a_tool' }));
    expect(deriveProfileNames([b, a], 'readonly')).toEqual(['a_tool']);
  });
});

describe('buildCanonicalToolRegistry', () => {
  const toolA: McpToolDefinition = defineMcpTool(baseInput({ name: 'tools.a', description: 'first' }));
  const toolB: McpToolDefinition = defineMcpTool(
    baseInput({
      name: 'tools.b',
      description: 'second',
      policy: { ...baseInput({}).policy, runtimeProfiles: ['full', 'readonly', 'agent-key'] },
    }),
  );

  it('builds and sorts a registry across families', () => {
    const sources: Record<McpServerFamily, readonly McpToolDefinition[]> = {
      collab: [toolB],
      memory: [toolA],
      signals: [],
      limb: [],
      audio: [],
      finance: [],
    };
    const registry = buildCanonicalToolRegistry(sources);
    expect(registry.map((t) => t.name)).toEqual(['tools.a', 'tools.b']);
    expect(registry[0]!.serverFamily).toBe('memory');
  });

  it('throws on duplicate tool names', () => {
    const sources: Record<McpServerFamily, readonly McpToolDefinition[]> = {
      collab: [toolA],
      memory: [toolA],
      signals: [],
      limb: [],
      audio: [],
      finance: [],
    };
    expect(() => buildCanonicalToolRegistry(sources)).toThrow(/Duplicate/);
  });
});

describe('projectCanonicalToolRegistry', () => {
  const registry: readonly FamilyToolDefinition[] = (() => {
    const full = defineMcpTool(baseInput({ name: 'f_tool' }));
    const ro = defineMcpTool(
      baseInput({ name: 'r_tool', policy: { ...baseInput({}).policy, runtimeProfiles: ['readonly'] } }),
    );
    const ak = defineMcpTool(
      baseInput({ name: 'k_tool', policy: { ...baseInput({}).policy, runtimeProfiles: ['agent-key'] } }),
    );
    const desk = defineMcpTool(
      baseInput({
        name: 'd_tool',
        policy: { ...baseInput({}).policy, runtimeProfiles: ['desktop:fable-phase0'] },
      }),
    );
    return buildCanonicalToolRegistry({
      collab: [full, ro, ak, desk],
      memory: [],
      signals: [],
      limb: [],
      audio: [],
      finance: [],
    });
  })();

  it('full projection returns only full-profile tools', () => {
    const projected = projectCanonicalToolRegistry(registry, {});
    expect(projected.map((t) => t.name)).toEqual(['f_tool']);
  });

  it('readonly projection intersects readonly ∪ agent-key (agent-key gated)', () => {
    const ro = projectCanonicalToolRegistry(registry, { readonly: true });
    expect(ro.map((t) => t.name)).toEqual(['f_tool', 'r_tool']);
    const withKey = projectCanonicalToolRegistry(registry, { readonly: true, hasAgentKey: true });
    expect(withKey.map((t) => t.name)).toEqual(['f_tool', 'k_tool', 'r_tool']);
  });

  it('desktop projection is a strict whitelist and unknown modes throw', () => {
    const desk = projectCanonicalToolRegistry(registry, { desktopMode: 'fable-phase0' });
    expect(desk.map((t) => t.name)).toEqual(['d_tool']);
    expect(() => projectCanonicalToolRegistry(registry, { desktopMode: 'bogus' })).toThrow(/Unknown/);
  });

  it('projectServerFamily filters to one family', () => {
    const collab = projectServerFamily(registry, 'collab', {});
    expect(collab.map((t) => t.name)).toEqual(['f_tool']);
  });
});
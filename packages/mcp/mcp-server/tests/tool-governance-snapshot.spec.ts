import { describe, expect, it } from 'vitest';
import {
  bindMcpImplementation,
  buildCanonicalToolRegistry,
  compareMcpSurfaceProtocol,
  compareMcpSurfaceRegistry,
  createMcpSurfaceSnapshot,
  defineMcpTool,
} from '../src/index.js';
import type { McpServerFamily } from '../src/tool-governance-snapshot.js';
import type { ResolvedImplementationCatalog } from '../src/tool-governance-types.js';

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

function baseTool(name: string) {
  return defineMcpTool({
    name,
    description: `Tool ${name} does governed work`,
    operation: { kind: 'single', action: 'read', inputSchema: {}, boundary: readBoundary },
    implementation: bindMcpImplementation('module:cat-shared#readX', async () => ({})),
    policy: {
      resourceFamily: 'fam',
      schemaDelivery: { policy: 'host-default', evidenceRef: 'file:governance.md' },
      runtimeProfiles: ['full', 'readonly'],
      owner: { domainCell: 'architecture-cell:x', surface: 'mcp-surface-governance' },
      standaloneReason: { disposition: 'consolidation-candidate', kind: 'same-resource-lifecycle', evidenceRef: 'file:governance.md' },
      activeState: 'canonical',
      cognitiveEntryPoints: [{ kind: 'tool-description', ref: 'file:governance.md' }],
      verification: [{ kind: 'test', ref: 'test:governance' }],
    },
  });
}

function catalog(): ResolvedImplementationCatalog {
  return new Map([
    ['module:cat-shared#readX', { moduleDigest: 'sha256:abc', exportName: 'readX', compilerSymbolId: 'readX' }],
  ]);
}

function toFamily(defs: ReturnType<typeof baseTool>[], family: McpServerFamily) {
  const sources: Record<McpServerFamily, readonly (typeof defs[0])[]> = {
    collab: family === 'collab' ? defs : [],
    memory: family === 'memory' ? defs : [],
    signals: [],
    limb: [],
    audio: [],
    finance: [],
  };
  return buildCanonicalToolRegistry(sources);
}

function snapshot(defs: ReturnType<typeof baseTool>[], family: McpServerFamily, protectedBaseSha = 'sha256:base') {
  return createMcpSurfaceSnapshot(toFamily(defs, family), {
    protectedBaseSha,
    implementationCatalog: catalog(),
  });
}

describe('createMcpSurfaceSnapshot', () => {
  it('produces schemaVersion 2 with stable digests and token counts', () => {
    const a = snapshot([baseTool('a')], 'collab');
    const b = snapshot([baseTool('a')], 'collab');
    expect(a.schemaVersion).toBe(2);
    expect(a.comparisonEncoding).toBe('cl100k_base');
    expect(a.tools[0]!.descriptionDigest).toBe(b.tools[0]!.descriptionDigest);
    expect(a.tools[0]!.inputSchemaDigest).toBe(b.tools[0]!.inputSchemaDigest);
    expect(a.tools[0]!.descriptionTokensCl100kBase).toBeGreaterThan(0);
    expect(a.tools[0]!.descriptionCharacters).toBeGreaterThan(0);
  });

  it('throws when implementation evidence is missing', () => {
    const missing = new Map<string, never>();
    expect(() =>
      createMcpSurfaceSnapshot(toFamily([baseTool('a')], 'collab'), {
        protectedBaseSha: 'sha256:base',
        implementationCatalog: missing,
      }),
    ).toThrow(/Missing implementation evidence/);
  });
});

describe('compareMcpSurfaceRegistry', () => {
  it('reports added/removed names, action, profile and schemaDelivery changes', () => {
    const beforeDefs = [baseTool('a'), baseTool('b')];
    const afterDefs = [baseTool('a'), baseTool('c')];
    // alter a's delivery + profiles
    const aAfter = {
      ...afterDefs[0]!,
      policy: {
        ...afterDefs[0]!.policy,
        schemaDelivery: { policy: 'always-visible', evidenceRef: 'file:governance.md' },
        runtimeProfiles: ['full'],
      },
    };

    const before = snapshot(beforeDefs, 'collab');
    const after = createMcpSurfaceSnapshot(
      toFamily([aAfter, baseTool('c')], 'collab'),
      { protectedBaseSha: 'sha256:base', implementationCatalog: catalog() },
    );

    const delta = compareMcpSurfaceRegistry(before, after);
    expect(delta.addedNames).toEqual(['c']);
    expect(delta.removedNames).toEqual(['b']);
    expect(delta.profileChanges).toEqual([
      { name: 'a', added: [], removed: ['readonly'] },
      { name: 'b', added: [], removed: ['full', 'readonly'] },
      { name: 'c', added: ['full', 'readonly'], removed: [] },
    ]);
    expect(delta.schemaDeliveryChanges).toHaveLength(3);
    expect(delta.schemaDeliveryChanges[0]!.name).toBe('a');
    expect(delta.schemaDeliveryChanges[0]!.before?.policy).toBe('host-default');
    expect(delta.schemaDeliveryChanges[0]!.after?.policy).toBe('always-visible');
  });
});

describe('compareMcpSurfaceProtocol', () => {
  it('reports parity findings across families, descriptions and missing tools', () => {
    const expected = snapshot([baseTool('a')], 'collab');
    const driftDef = { ...baseTool('a'), description: 'Completely different text' };
    const otherFamily = toFamily([driftDef], 'memory');
    const additions = toFamily([baseTool('new_tool')], 'collab');
    const actualWithAdd = createMcpSurfaceSnapshot(
      [...otherFamily, ...additions],
      { protectedBaseSha: 'sha256:base', implementationCatalog: catalog() },
    );

    const findings = compareMcpSurfaceProtocol(expected, actualWithAdd);
    expect(findings.some((f) => f.field === 'description')).toBe(true);
    expect(findings.some((f) => f.field === 'serverFamily')).toBe(true);
    expect(findings.some((f) => f.name === 'new_tool' && f.field === 'missing')).toBe(true);
  });
});
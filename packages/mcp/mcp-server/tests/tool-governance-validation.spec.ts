import { describe, expect, it } from 'vitest';
import { bindMcpImplementation, defineMcpTool, validateToolGovernance } from '../src/index.js';
import { digestMcpInputSchema } from '../src/tool-governance-snapshot.js';
import type {
  EvidenceRef,
  McpActionBoundary,
  McpToolDefinition,
  McpToolDefinitionInput,
  ProtectedToolSnapshot,
  ResolvedEvidenceCatalog,
  ResolvedImplementationCatalog,
} from '../src/tool-governance-types.js';

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

function input(partial: Partial<McpToolDefinitionInput>): McpToolDefinitionInput {
  return {
    name: 'x_tool',
    description: 'A governed tool',
    operation: { kind: 'single', action: 'read', inputSchema: {}, boundary: readBoundary },
    implementation: bindMcpImplementation('module:cat-shared#readX', async () => ({})),
    policy: {
      resourceFamily: 'x',
      schemaDelivery: { policy: 'host-default', evidenceRef: 'file:governance.md' },
      runtimeProfiles: ['full'],
      owner: { domainCell: 'architecture-cell:x', surface: 'mcp-surface-governance' },
      standaloneReason: { disposition: 'consolidation-candidate', kind: 'same-resource-lifecycle', evidenceRef: 'file:governance.md' },
      activeState: 'canonical',
      cognitiveEntryPoints: [{ kind: 'tool-description', ref: 'file:governance.md' }],
      verification: [{ kind: 'test', ref: 'test:governance' }],
    },
    ...partial,
  };
}

/** A fully-valid context: every defining fixture passes with ok === true. */
function validContext() {
  const existingRefs: ReadonlySet<EvidenceRef> = new Set([
    'file:governance.md',
    'architecture-cell:x',
    'test:governance',
  ]);
  const implementationCatalog: ResolvedImplementationCatalog = new Map([
    ['module:cat-shared#readX', { moduleDigest: 'sha256:abc', exportName: 'readX', compilerSymbolId: 'readX' }],
  ]);
  const evidenceCatalog: ResolvedEvidenceCatalog = { existingRefs, admissionClaims: new Map() };
  const protectedBase: ReadonlyMap<string, ProtectedToolSnapshot> = new Map([
    [
      'x_tool',
      {
        name: 'x_tool',
        resourceFamily: 'x',
        actions: ['read'],
        risk: { level: 'read', openWorld: false },
        inputSchemaDigest: digestMcpInputSchema({}),
      } as ProtectedToolSnapshot,
    ],
  ]);
  return { evidenceCatalog, implementationCatalog, protectedBase };
}

describe('validateToolGovernance — valid baseline', () => {
  it('returns ok for a clean governed definition', () => {
    const { evidenceCatalog, implementationCatalog, protectedBase } = validContext();
    const def = defineMcpTool(input({}));
    const result = validateToolGovernance([def], { evidenceCatalog, implementationCatalog, protectedBase });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe('validateToolGovernance finding codes', () => {
  function run(defs: McpToolDefinition[], ctx: ReturnType<typeof validContext>) {
    return validateToolGovernance(defs, ctx).findings.map((f) => f.code);
  }

  it('duplicate-tool-name', () => {
    const ctx = validContext();
    const a = defineMcpTool(input({ name: 'dup' }));
    const b = defineMcpTool(input({ name: 'dup' }));
    expect(run([a, b], ctx)).toContain('duplicate-tool-name');
  });

  it('unresolved-evidence-ref', () => {
    const ctx = validContext();
    const def = defineMcpTool(
      input({ policy: { ...input({}).policy, cognitiveEntryPoints: [{ kind: 'tool-description', ref: 'file:nope.md' }] } }),
    );
    expect(run([def], ctx)).toContain('unresolved-evidence-ref');
  });

  it('unresolved-implementation-binding', () => {
    const ctx = validContext();
    ctx.implementationCatalog.delete('module:cat-shared#readX');
    const def = defineMcpTool(input({}));
    expect(run([def], ctx)).toContain('unresolved-implementation-binding');
  });

  it('invalid-policy', () => {
    const ctx = validContext();
    const def = defineMcpTool(
      input({ policy: { ...input({}).policy, schemaDelivery: { policy: 'bogus' as never, evidenceRef: 'file:governance.md' } } }),
    );
    expect(run([def], ctx)).toContain('invalid-policy');
  });

  it('protected-base-drift', () => {
    const ctx = validContext();
    ctx.protectedBase = new Map([
      ["mig_tool", { name: 'mig_tool', resourceFamily: 'orig', actions: ['different'], risk: { level: 'read', openWorld: false }, inputSchemaDigest: 'sha256:zzz' } as ProtectedToolSnapshot],
    ]);
    const def = defineMcpTool(
      input({
        name: 'mig_tool',
        policy: { ...input({}).policy, activeState: 'migration-candidate' },
      }),
    );
    expect(run([def], ctx)).toContain('protected-base-drift');
  });

  it('admission-subject-mismatch', () => {
    const ctx = validContext();
    ctx.protectedBase = new Map([
      ["fam_keeper", { name: 'fam_keeper', resourceFamily: 'fam', actions: ['read'], risk: { level: 'read', openWorld: false }, inputSchemaDigest: 'sha256:k' }],
    ]);
    ctx.evidenceCatalog = {
      ...ctx.evidenceCatalog,
      existingRefs: new Set([...ctx.evidenceCatalog.existingRefs, 'adr:1']),
      admissionClaims: new Map([
        [
          'adr:1',
          [
            {
              ref: 'adr:1',
              subject: { toolName: 'SOMEONE_ELSE', resourceFamily: 'fam', boundaryKind: 'resource-entry' },
              decision: 'accepted' as const,
              sourceDigest: 'sha256:zzz',
            },
          ],
        ],
      ]),
    };
    const def = defineMcpTool(
      input({
        name: 'fam_new',
        policy: {
          ...input({}).policy,
          resourceFamily: 'fam',
          standaloneReason: { disposition: 'accepted-boundary', kind: 'resource-entry', admissionRef: 'adr:1' },
        },
      }),
    );
    expect(run([def], ctx)).toContain('admission-subject-mismatch');
  });

  it('mixed-action-boundary', () => {
    const ctx = validContext();
    const def = defineMcpTool(
      input({
        operation: {
          kind: 'discriminated',
          discriminator: 'action',
          variants: [
            { action: 'create', inputSchema: {}, boundary: writeBoundary },
            { action: 'read', inputSchema: {}, boundary: readBoundary },
          ],
        },
      }),
    );
    expect(run([def], ctx)).toContain('mixed-action-boundary');
  });

  it('unjustified-family-growth', () => {
    const ctx = validContext();
    ctx.protectedBase = new Map([
      ["fam_keeper", { name: 'fam_keeper', resourceFamily: 'fam', actions: ['read'], risk: { level: 'read', openWorld: false }, inputSchemaDigest: 'sha256:k' }],
    ]);
    const def = defineMcpTool(input({ name: 'fam_new', policy: { ...input({}).policy, resourceFamily: 'fam' } }));
    expect(run([def], ctx)).toContain('unjustified-family-growth');
  });

  it('new-family-requires-resource-entry', () => {
    const ctx = validContext();
    const def = defineMcpTool(input({ name: 'brand_new', policy: { ...input({}).policy, resourceFamily: 'brand' } }));
    expect(run([def], ctx)).toContain('new-family-requires-resource-entry');
  });

  it('hidden-operation-discriminator', () => {
    const ctx = validContext();
    const def = defineMcpTool(
      input({
        operation: {
          kind: 'single',
          action: 'read',
          inputSchema: {
            type: 'object',
            properties: { action: { type: 'string', enum: ['read', 'write'] } },
          },
          boundary: readBoundary,
        },
      }),
    );
    expect(run([def], ctx)).toContain('hidden-operation-discriminator');
  });
});
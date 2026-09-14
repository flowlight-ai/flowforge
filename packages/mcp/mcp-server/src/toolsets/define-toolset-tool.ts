/**
 * EP1-1b toolset catalog helper.
 *
 * Converts concise per-tool catalog inputs into EP1-1a's {@link McpToolDefinition}
 * via the shared `defineMcpTool` derivation chain, so governance, annotations,
 * effective risk and input-schema derivation stay identical to the rest of the
 * framework. The handler is bound to the injected {@link CallbackTransportPort}.
 *
 * Per design §2.3, authorization paths are derived from a strict local enum
 * (AuthorizationHint) rather than `@cat-cafe/shared` string assembly; unknown
 * hints fail fast so governance surfaces are never silently omitted.
 */

import { bindMcpImplementation, defineMcpTool } from '../tool-governance.js';
import type {
  McpActionBoundary,
  McpAuthorizationPath,
  McpRisk,
  McpRuntimeProfile,
  McpStandaloneReason,
  McpToolDefinition,
} from '../tool-governance-types.js';
import type { FamilyToolDefinition, McpServerFamily } from '../tool-governance-snapshot.js';
import {
  createCallbackInvoker,
  type CallbackRoute,
  type CallbackTransportPort,
} from './callback-transport.js';

/** Strict local authority catalogue (design §2.3). */
export type AuthorizationHint = 'callback-owner' | 'agent-key' | 'read-only' | 'local-operator';

const AUTHORITY_HINTS: readonly AuthorizationHint[] = [
  'callback-owner',
  'agent-key',
  'read-only',
  'local-operator',
];

export type ToolsetToolInput = {
  name: string;
  description: string;
  action: string;
  risk: McpRisk;
  /** Field-name → Zod shape (zod v4), same shape the framework consumes. */
  inputSchema: Record<string, unknown>;
  resourceFamily: string;
  runtimeProfiles: NonEmptyProfiles;
  /** Evidence refs referenced by authorizationPaths + standaloneReason. */
  admissionRef: `file:${string}`;
  /** Origin export from the clowder source (for provenance / implementation ref). */
  sourceExport: string;
  authorizationHint: AuthorizationHint;
  route: CallbackRoute;
  /** Boundary kind for the `accepted-boundary` standalone disposition (default `resource-entry`). */
  standaloneKind?: Extract<McpStandaloneReason, { disposition: 'accepted-boundary' }>['kind'];
};

type NonEmptyProfiles = readonly [McpRuntimeProfile, ...McpRuntimeProfile[]];

function assertAuthorizationHint(hint: AuthorizationHint): void {
  if (!AUTHORITY_HINTS.includes(hint)) {
    throw new Error(`Unknown AuthorizationHint: "${String(hint)}" — governance surface omitted`);
  }
}

/**
 * Map an authority hint onto enforcement-ref'd authorization paths.
 * `enforcementRef` is back-filled from the same `admissionRef` evidence chain.
 */
function authorizationPaths(hint: AuthorizationHint, enforcementRef: `file:${string}`): McpAuthorizationPath[] {
  switch (hint) {
    case 'callback-owner':
      return [
        {
          principal: 'invocation-cat',
          credentialSource: 'invocation-record',
          scope: { kind: 'owner', resourceRef: 'callback' },
          enforcementRef,
        },
      ];
    case 'agent-key':
      return [
        {
          principal: 'agent-key-cat',
          credentialSource: 'agent-key',
          scope: { kind: 'global-governed' },
          enforcementRef,
        },
      ];
    case 'read-only':
      return [
        {
          principal: 'invocation-cat',
          credentialSource: 'invocation-record',
          scope: { kind: 'owner-private' },
          enforcementRef,
        },
      ];
    case 'local-operator':
      return [
        {
          principal: 'local-operator',
          credentialSource: 'local-process',
          scope: { kind: 'local-runtime' },
          enforcementRef,
        },
      ];
    default:
      throw new Error(`Unhandled AuthorizationHint: "${String(hint)}"`);
  }
}

function nonEmpty<T>(values: readonly T[]): [T, ...T[]] {
  if (values.length === 0) throw new Error('authorizationPaths and runtimeProfiles must be non-empty');
  return values as [T, ...T[]];
}

/** Build a full EP1-1a tool definition from a concise catalog input. */
export function defineMcpToolsetTool(
  port: CallbackTransportPort,
  input: ToolsetToolInput,
): McpToolDefinition {
  const { admissionRef } = input;
  const paths = nonEmpty(authorizationPaths(input.authorizationHint, admissionRef));
  const boundary: McpActionBoundary = { authorizationPaths: paths, risk: input.risk };
  const standalone: Extract<McpStandaloneReason, { disposition: 'accepted-boundary' }> = {
    disposition: 'accepted-boundary',
    kind: input.standaloneKind ?? 'resource-entry',
    admissionRef,
  };
  return defineMcpTool({
    name: input.name,
    description: input.description,
    operation: {
      kind: 'single',
      action: input.action,
      inputSchema: input.inputSchema,
      boundary,
    },
    implementation: bindMcpImplementation(`module:${input.sourceExport}#callback`, createCallbackInvoker(port, input.route)),
    policy: {
      resourceFamily: input.resourceFamily,
      schemaDelivery: { policy: 'host-default', evidenceRef: admissionRef },
      runtimeProfiles: input.runtimeProfiles,
      owner: { domainCell: 'architecture-cell:mcp-surface-governance', surface: 'mcp-surface-governance' },
      standaloneReason: standalone,
      activeState: 'canonical',
      cognitiveEntryPoints: [{ kind: 'tool-description', ref: admissionRef }],
      verification: [{ kind: 'contract', ref: `test:toolsets/${input.name}` }],
    },
  });
}

export type ToolsetToolInputWithFamily = ToolsetToolInput & { serverFamily: McpServerFamily };

/** Build an array of family-tagged tool definitions for one tool group. */
export function defineMcpToolsetTools(
  port: CallbackTransportPort,
  serverFamily: McpServerFamily,
  inputs: readonly ToolsetToolInput[],
): readonly FamilyToolDefinition[] {
  return inputs.map((input) => {
    assertAuthorizationHint(input.authorizationHint);
    const definition = defineMcpToolsetTool(port, input);
    return { ...definition, serverFamily };
  });
}
/**
 * EP1-1b canonical tool sources: the single executable aggregate for the four
 * migrated families (collab / memory / signals / limb).
 *
 * finance and audio are excluded per Q3 (2026-09-10). Each toolset is a factory
 * parameterized by the injected {@link CallbackTransportPort}; the catalog is
 * static (governance + schema), only the outbound transport is supplied by the
 * host at assembly time (design §2.1).
 */

import type { McpToolDefinition } from '../tool-governance-types.js';
import type { CanonicalToolSources } from '../canonical-tool-registry.js';
import { buildCanonicalToolRegistry } from '../canonical-tool-registry.js';
import type { CallbackTransportPort } from './callback-transport.js';
import { buildCapabilityEvolutionChangeToolset } from './collab/capability-evolution-change.js';
import { buildEntrustedWorkReadToolset } from './collab/entrusted-work-read.js';

function concat(...groups: readonly (readonly McpToolDefinition[])[]): readonly McpToolDefinition[] {
  return groups.flat() as readonly McpToolDefinition[];
}

/**
 * Build the port-parameterized canonical tool sources. The returned families are
 * ready to be projected/registered via the EP1-1a assembly mechanism.
 */
export function buildCanonicalToolSources(port: CallbackTransportPort): CanonicalToolSources {
  return {
    collab: concat(
      buildCapabilityEvolutionChangeToolset(port),
      buildEntrustedWorkReadToolset(port),
    ),
    memory: [],
    signals: [],
    limb: [],
    // finance / audio excluded per Q3 (2026-09-10) — left empty to keep the
    // six-family `CanonicalToolSources` type conformance without importing them.
    finance: [],
    audio: [],
  };
}

/** Build-and-validate the canonical registry for the injected transport. */
export function buildCanonicalToolRegistryForPort(port: CallbackTransportPort) {
  return buildCanonicalToolRegistry(buildCanonicalToolSources(port));
}

/** Static catalog-size anchor for contract tests (source-of-truth counts). */
export const TOOLSET_GROUP_ANCHOR = {
  collab: {
    capabilityEvolutionChange: 1,
    entrustedWorkRead: 1,
  },
  memory: {},
  signals: {},
  limb: {},
} as const;
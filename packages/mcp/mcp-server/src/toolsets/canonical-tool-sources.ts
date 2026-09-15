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
import { buildCallbackToolset } from './collab/callback.js';
import { buildCapabilityEvolutionChangeToolset } from './collab/capability-evolution-change.js';
import { buildEntrustedWorkReadToolset } from './collab/entrusted-work-read.js';
import { buildCommunityRouteAcceptanceToolset } from './collab/community-route-acceptance.js';
import { buildAutoDreamToolset } from './collab/auto-dream.js';
import { buildCapabilityEvolutionToolset } from './collab/capability-evolution.js';
import { buildCapabilityEvolutionRoundToolset } from './collab/capability-evolution-round.js';
import { buildEvalLifecycleToolset } from './collab/eval-lifecycle.js';
import { buildEventMemoryToolset } from './collab/event-memory.js';
import { buildExternalReviewVerdictToolset } from './collab/external-review-verdict.js';
import { buildExternalRuntimeSessionCallbackToolset } from './collab/external-runtime-session-callback.js';
import { buildGameActionToolset } from './collab/game-action.js';
import { buildHubActionToolset } from './collab/hub-action.js';
import { buildPawFeelDispositionToolset } from './collab/paw-feel-disposition.js';
import { buildPublishVerdictToolset } from './collab/publish-verdict.js';
import { buildRichBlockRulesToolset } from './collab/rich-block-rules.js';
import { buildScheduleToolset } from './collab/schedule.js';
import { buildShellToolset } from './collab/shell.js';
import { buildSkillConsumptionToolset } from './collab/skill-consumption.js';

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
      buildCallbackToolset(port),
      buildCapabilityEvolutionChangeToolset(port),
      buildEntrustedWorkReadToolset(port),
      buildCommunityRouteAcceptanceToolset(port),
      buildAutoDreamToolset(port),
      buildCapabilityEvolutionToolset(port),
      buildCapabilityEvolutionRoundToolset(port),
      buildEvalLifecycleToolset(port),
      buildEventMemoryToolset(port),
      buildExternalReviewVerdictToolset(port),
      buildExternalRuntimeSessionCallbackToolset(port),
      buildGameActionToolset(port),
      buildHubActionToolset(port),
      buildPawFeelDispositionToolset(port),
      buildPublishVerdictToolset(port),
      buildRichBlockRulesToolset(port),
      buildScheduleToolset(port),
      buildShellToolset(port),
      buildSkillConsumptionToolset(port),
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
    callback: 49,
    capabilityEvolutionChange: 1,
    entrustedWorkRead: 1,
    communityRouteAcceptance: 1,
    autoDream: 4,
    capabilityEvolution: 5,
    capabilityEvolutionRound: 3,
    evalLifecycle: 2,
    eventMemory: 3,
    externalReviewVerdict: 2,
    externalRuntimeSessionCallback: 3,
    gameAction: 1,
    hubAction: 2,
    pawFeelDisposition: 3,
    publishVerdict: 1,
    richBlockRules: 1,
    schedule: 4,
    shell: 1,
    skillConsumption: 3,
  },
  memory: {},
  signals: {},
  limb: {},
} as const;
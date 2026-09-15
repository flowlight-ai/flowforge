/**
 * collab/capability-evolution-change toolset (EP1-1b).
 *
 * Migrated from clowder `tools/capability-evolution-change-tools.ts` (B1). The
 * source handler invoked
 * `callbackPost('/api/callbacks/evolution-programs/${programId}/changes', …)`
 * with a URL-encoded path segment — reproduced via the `${programId}` template.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const bounded = (max: number) => z.string().trim().min(1).max(max);
const agentKeyCatId = bounded(120)
  .optional()
  .describe(
    'Persistent-agent identity selector. Required for shared agent-key MCP variants; ignored under invocation auth.',
  );
const changeAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('propose') }).strict(),
  z.object({ kind: z.literal('sync') }).strict(),
  z
    .object({
      kind: z.literal('decide'),
      decision: z.enum(['keep', 'tune', 'rollback', 'sunset', 'no_change']),
    })
    .strict(),
]);

export const CAPABILITY_EVOLUTION_CHANGE_SERVER_FAMILY = 'collab' as const;

export function buildCapabilityEvolutionChangeToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, CAPABILITY_EVOLUTION_CHANGE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_advance_evolution_program_change',
      description:
        'Advance the governed Change & Learn lane of a canonical Evolution Program with one operation-only action. ' +
        'Use propose only for an actionable intervention and from an authenticated invocation with an exact source message; use sync to import canonical Approval/dispatch/mutation/outcome progress; use decide only after a merged-and-loaded fresh outcome and an explicit value-owner/operator disposition. ' +
        'NOT for: sending an Approval, owner identity, target/version, Task/lease, mutation receipt or outcome — F246/F266/F313 and the asset owner resolve and own all of those. ' +
        'Output: appended/duplicate/conflict/waiting/blocked plus the ref-only Program projection. Rejected, withdrawn, superseded and drifted attempts require a fresh propose operation and remain side-effect-ineligible. ' +
        'GOTCHA: agent-key callers may only sync. Proposal and metabolism decisions fail closed without an invocation-bound owner source or a direct owner session.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: {
        programId: z.string().regex(/^evolution-program:[0-9a-f]{32}$/),
        expectedSequence: z.number().int().nonnegative().describe('Current Program sequence for CAS.'),
        clientMessageId: bounded(240).describe('Stable idempotency id for this owner lifecycle operation.'),
        action: changeAction.describe(
          'Operation only: request a canonical proposal, sync owner progress, or record an explicit metabolism decision.',
        ),
        agentKeyCatId,
      },
      resourceFamily: 'evolution-program',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: 'file:docs/features/F311-capability-evolution-workspace.md',
      sourceExport: 'handleAdvanceEvolutionProgramChange',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/evolution-programs/${programId}/changes',
        bodyKeys: ['expectedSequence', 'clientMessageId', 'action'],
      },
    },
  ]);
}
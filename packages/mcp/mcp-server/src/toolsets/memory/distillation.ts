/**
 * memory/distillation toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/distillation-tools.ts` (F152 Phase C). Three tools:
 *   - cat_cafe_mark_generalizable:  PATCH `/api/evidence/${anchor}/generalizable`
 *   - cat_cafe_nominate_for_global: POST  `/api/distillation/nominate`
 *   - cat_cafe_review_distillation: POST  `/api/distillation/${candidateId}/review`
 * Resource family `distillation`.
 *
 * NOTE(E2b memory): clowder's `handleMarkGeneralizable` used a `PATCH` verb via a
 * direct `fetch`. The injected `CallbackTransportPort` only carries POST/GET, so
 * the destructive/generalizability mutation is represented as a POST route with
 * the same `${anchor}` path template; a host extension would be needed to carry
 * the PATCH verb faithfully. All three handlers are reconcile-as-synthetic-POST
 * (see assemble/README §调和法).
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const markGeneralizableInputSchema = {
  anchor: z.string().min(1).describe('Evidence anchor to mark'),
  generalizable: z.boolean().describe('true = candidate for global reflow, false = project-private'),
};

const nominateForGlobalInputSchema = {
  anchor: z.string().min(1).describe('Evidence anchor to nominate'),
  projectPath: z.string().min(1).describe('Absolute path to project root'),
  personNames: z.array(z.string()).optional().describe('Person names to sanitize (blocklist)'),
};

const reviewDistillationInputSchema = {
  candidateId: z.string().min(1).describe('Distillation candidate ID'),
  decision: z.enum(['approve', 'reject']).describe('Review decision'),
  reviewerId: z.string().min(1).describe('Cat ID performing the review (e.g. "codex", "opus")'),
};

export const DISTILLATION_SERVER_FAMILY = 'memory' as const;
// F152 (expedition memory) governs cross-project distillation reflow.
const F152 = 'file:docs/features/F152-expedition-memory.md' as const;

export function buildDistillationToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, DISTILLATION_SERVER_FAMILY, [
    {
      name: 'cat_cafe_mark_generalizable',
      description:
        'Mark an evidence item (lesson/decision) as generalizable for cross-project reflow, or as project-private. ' +
        'Items marked generalizable=true become candidates for distillation to the global knowledge layer.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: markGeneralizableInputSchema,
      resourceFamily: 'distillation',
      runtimeProfiles: ['full'],
      admissionRef: F152,
      sourceExport: 'handleMarkGeneralizable',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/evidence/${anchor}/generalizable',
        bodyKeys: ['generalizable'],
      },
    },
    {
      name: 'cat_cafe_nominate_for_global',
      description:
        'Nominate a generalizable evidence item for distillation to global knowledge. ' +
        'The item must have generalizable=true. Creates a deidentified candidate for review.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: nominateForGlobalInputSchema,
      resourceFamily: 'distillation',
      runtimeProfiles: ['full'],
      admissionRef: F152,
      sourceExport: 'handleNominateForGlobal',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/distillation/nominate',
        bodyKeys: ['anchor', 'projectPath', 'personNames'],
      },
    },
    {
      name: 'cat_cafe_review_distillation',
      description:
        'Approve or reject a distillation candidate. Approved candidates are written to the global knowledge layer ' +
        'with project-specific identifiers removed. Rejected candidates are discarded.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: reviewDistillationInputSchema,
      resourceFamily: 'distillation',
      runtimeProfiles: ['full'],
      admissionRef: F152,
      sourceExport: 'handleReviewDistillation',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/distillation/${candidateId}/review',
        bodyKeys: ['decision', 'reviewerId'],
      },
    },
  ]);
}
/**
 * memory/perspective toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/perspective-tools.ts`. One tool
 * (`cat_cafe_run_perspective`, handler `handleRunPerspective`) which performs a
 * direct `fetch` GET against `/api/perspectives/{featureId}/{slug}/run`. Resource
 * family `evidence-navigation`.
 *
 * NOTE(E2b memory): the handler splits the `planId` input
 * (`<featureId>/<slug>`, e.g. `F209/f209-phase-d-orientation`) into two path
 * segments. The injected transport only resolves a single `${planId}` template
 * segment, so the route is declared as `/api/perspectives/${planId}/run`; the
 * featureId/slug split and encoding are host-layer concerns.
 */
import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const runPerspectiveInputSchema = {
  planId: z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .describe('Perspective plan id in the form <featureId>/<slug>, e.g. F209/f209-phase-d-orientation'),
  actorCatId: z.string().optional().describe('Cat id running the Perspective, e.g. codex'),
};

export const PERSPECTIVE_SERVER_FAMILY = 'memory' as const;
const F186 = 'file:docs/features/F186-library-memory-architecture.md' as const;

export function buildPerspectiveToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, PERSPECTIVE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_run_perspective',
      description:
        'Run a git-backed Perspective live query plan by id and return traceable steps, candidate anchors, typed reader route hints, degraded metadata, and warnings. ' +
        'Use this when a cat-authored plan should reopen a known investigation route. It returns route hints and anchors only; cats must invoke the typed reader to fetch evidence content. It does not write conclusions or store result sets.',
      action: 'derive',
      risk: { level: 'read', openWorld: false },
      inputSchema: runPerspectiveInputSchema,
      resourceFamily: 'evidence-navigation',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: F186,
      sourceExport: 'handleRunPerspective',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/perspectives/${planId}/run',
        paramKeys: ['actorCatId'],
      },
    },
  ]);
}
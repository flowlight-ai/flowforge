/**
 * collab/community-route-acceptance toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/community-route-acceptance-tool.ts`. The source
 * handler invoked
 * `callbackPost('/api/community-issues/${issueId}/validate-route', { decision, reason })`
 * — reproduced via the `${issueId}` template. Resource family `community-case`,
 * authority `assigned-callback`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const communityRouteAcceptanceInputSchema = {
  issueId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .describe('Canonical F168 community issue case id returned by the intake/triage surface.'),
  decision: z.enum(['accept', 'reject']).describe('Assigned-cat route decision for the pending case.'),
  reason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe('Concise evidence-based reason for accepting or rejecting the route.'),
};

export const COMMUNITY_ROUTE_ACCEPTANCE_SERVER_FAMILY = 'collab' as const;

export function buildCommunityRouteAcceptanceToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, COMMUNITY_ROUTE_ACCEPTANCE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_validate_community_route',
      description:
        'Accept or reject an F168 auto-routed community issue as the assigned cat. ' +
        'Use when: narrator/triage has assigned the current cat a real case with routeAcceptance=pending and the cat has independently verified the thread and custody. ' +
        'NOT for: triage, assigning another cat, operator owner decisions, changing a non-pending case, or bypassing external-author custody. ' +
        'Output: returns the canonical CommunityIssueItem after the route state transition; reject clears assignment and returns the case to pending-decision. ' +
        'GOTCHA: callback identity is supplied inside the MCP bridge—the API verifies that the caller is the assigned cat. Never copy callback credentials into shell commands or tool arguments.',
      action: 'validate',
      risk: { level: 'write', openWorld: false },
      inputSchema: communityRouteAcceptanceInputSchema,
      resourceFamily: 'community-case',
      runtimeProfiles: ['full'],
      admissionRef: 'file:docs/features/F168-community-route-acceptance.md',
      sourceExport: 'handleCommunityRouteAcceptance',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/community-issues/${issueId}/validate-route',
        bodyKeys: ['decision', 'reason'],
      },
    },
  ]);
}
/**
 * collab/entrusted-work-read toolset (EP1-1b).
 *
 * Migrated from clowder `tools/entrusted-work-read-tools.ts` (B1). The handler
 * was a `callbackPost('/api/callbacks/read-entrusted-work', …)`; per design §2.1
 * the transport is delegated to the injected {@link CallbackTransportPort}.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const readEntrustedWorkInputSchema = {
  taskId: z.string().trim().min(1).max(1_000).describe('Canonical entrusted-work Task ID'),
  observedRevision: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Previously observed Task contract revision; stale reads return no executable producer action'),
  agentKeyCatId: z.string().min(1).optional(),
};

export const ENTRUSTED_WORK_READ_SERVER_FAMILY = 'collab' as const;

export function buildEntrustedWorkReadToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, ENTRUSTED_WORK_READ_SERVER_FAMILY, [
    {
      name: 'cat_cafe_read_entrusted_work',
      description:
        'Read canonical entrusted-work owner truth for the current Task without mutating it. ' +
        'Web and cats receive the same refs/revisions/Artifact/time serializer. ' +
        'Producer receipts are discovered only through the closed F246/F292/F306 owner adapters; stale Task reads are inert and never expose actions.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readEntrustedWorkInputSchema,
      resourceFamily: 'task-workflow',
      runtimeProfiles: ['full', 'readonly', 'agent-key'],
      admissionRef: 'file:docs/features/F310-growing-real-delegation.md',
      sourceExport: 'handleReadEntrustedWork',
      authorizationHint: 'read-only',
      standaloneKind: 'progressive-disclosure',
      route: { method: 'POST', path: '/api/callbacks/read-entrusted-work', bodyKeys: ['taskId', 'observedRevision'] },
    },
  ]);
}
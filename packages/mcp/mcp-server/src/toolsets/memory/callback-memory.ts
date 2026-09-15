/**
 * memory/callback-memory toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/callback-memory-tools.ts`. The `callbackMemoryTools`
 * array surfaced one tool (`cat_cafe_retain_memory_callback`, handler
 * `handleCallbackRetainMemory`); the source's D16 notes that the older
 * search_evidence_callback / reflect_callback were merged into the public
 * search_evidence / reflect tools (evidence / collab families) and are NOT
 * re-ported here. Resource family `memory-write`.
 *
 * The single handler funnels through `callbackPost('/api/callbacks/retain-memory')`
 * and is reproduced via the injected callback transport verbatim.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const callbackRetainMemoryInputSchema = {
  content: z.string().trim().min(1).describe('Memory content to retain'),
  tags: z.array(z.string().min(1)).optional().describe('Optional memory tags'),
  metadata: z.record(z.string(), z.string()).optional().describe('Optional metadata (string values only)'),
};

export const CALLBACK_MEMORY_SERVER_FAMILY = 'memory' as const;
// F174 (callback auth lifecycle) governs the durable retain-memory transcript;
// no standaloneReason was declared on the source tool.
const F174 = 'file:docs/features/F174-callback-auth-lifecycle.md' as const;

export function buildCallbackMemoryToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, CALLBACK_MEMORY_SERVER_FAMILY, [
    {
      name: 'cat_cafe_retain_memory_callback',
      description:
        'Retain a durable memory item through Clowder AI callback endpoint. ' +
        'Use when you discover an important insight, decision, or lesson that should persist across sessions. ' +
        'Examples: architectural decisions made during discussion, gotchas discovered while debugging, ' +
        'cross-cat agreements. NOT for transient notes — only for knowledge worth remembering long-term. ' +
        'TIP: Add descriptive tags (e.g. ["redis", "pitfall"]) so future search_evidence queries can find it.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: callbackRetainMemoryInputSchema,
      resourceFamily: 'memory-write',
      runtimeProfiles: ['full'],
      admissionRef: F174,
      sourceExport: 'handleCallbackRetainMemory',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/retain-memory',
        bodyKeys: ['content', 'tags', 'metadata'],
      },
    },
  ]);
}
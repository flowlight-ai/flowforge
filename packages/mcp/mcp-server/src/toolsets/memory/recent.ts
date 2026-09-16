/**
 * memory/recent toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/recent-tools.ts` (F188 Phase F AC-F2). One tool
 * (`cat_cafe_list_recent`, handler `handleListRecent`) which performs a direct
 * `fetch` GET against `/api/library/recent`. Resource family `evidence-navigation`.
 *
 * NOTE(E2b memory): handled as a plain GET route mirroring the input keys; the
 * source's env-derived `currentThreadId`/recall-meta rendering stays host-layer.
 */
import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const listRecentInputSchema = {
  scope: z
    .enum(['docs', 'threads', 'memory', 'all', 'trajectories'])
    .optional()
    .describe(
      'Surface to scan. docs/threads/memory/all = evidence_docs kind filter; trajectories = F200 Phase D task_trajectories (search chain + files read/modified + outcome verification).',
    ),
  since: z.string().optional().describe('Time window: "7d" / "24h" / ISO 8601 date (default "7d")'),
  limit: z.number().int().min(1).max(100).optional().describe('Max items (default 20, max 100)'),
  kinds: z
    .array(z.string())
    .optional()
    .describe(
      'Filter by document kinds (feature / decision / architecture / lesson / plan / phase / discussion / research). Omit = all.',
    ),
};

export const RECENT_SERVER_FAMILY = 'memory' as const;
// F188 (library stewardship) governs the recent/zero-prior browse surface.
const F188 = 'file:docs/features/F188-library-stewardship.md' as const;

export function buildRecentToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, RECENT_SERVER_FAMILY, [
    {
      name: 'cat_cafe_list_recent',
      description: [
        'Browse recent docs/threads by time window, including architecture maps. NO query needed — designed for cold-start "我记得最近讨论过什么" / "压缩后扫一眼" scenarios.',
        'Use when: zero prior knowledge of what to search for; want to scan latest activity.',
        'Not for: precise anchor lookup → graph_resolve. Semantic search → search_evidence.',
        'Timestamp semantics: for docs/memory entries, updatedAt is the source file mtime (content activity), not index rebuild time; trajectories use task trajectory updatedAt.',
        'Scope/kinds tip: scope and kinds are intersected. If you ask for docs + discussion and get a scope/kinds nudge, try scope=threads or split the scan.',
        '',
        'v1 limitation (KD-8): does NOT accept collection scoping params. Sees public/internal collections only via server-side identity. Private collections excluded.',
      ].join('\n'),
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listRecentInputSchema,
      resourceFamily: 'evidence-navigation',
      runtimeProfiles: ['full', 'readonly', 'desktop:fable-phase0', 'desktop:cloud-pro-phase0'],
      admissionRef: F188,
      sourceExport: 'handleListRecent',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/library/recent',
        paramKeys: ['scope', 'since', 'limit', 'kinds'],
      },
    },
  ]);
}
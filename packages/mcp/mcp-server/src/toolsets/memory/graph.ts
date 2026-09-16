/**
 * memory/graph toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/graph-tools.ts` (F188 Phase F AC-F1). One tool
 * (`cat_cafe_graph_resolve`, handler `handleGraphResolve`) which performs a direct
 * `fetch` GET against `/api/library/graph/resolve`. Resource family
 * `evidence-navigation`.
 *
 * NOTE(E2b memory): handled as a plain GET route whose query params mirror the
 * input keys; the source's direct-fetch detail (unwrap of `data.graph`, recall-meta
 * rendering) stays host/render-layer and is not ported.
 */
import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const RELATION_TYPES = ['wikilink', 'doc_link', 'feature_ref', 'related_to'] as const;

const graphResolveInputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      'Precise anchor (e.g. F186) or fuzzy term (e.g. harness). Exact anchor → graph drill-down; fuzzy → candidate list.',
    ),
  depth: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .describe('Graph traversal depth (default 1, max 3 to avoid edge explosion)'),
  relations: z
    .array(z.enum(RELATION_TYPES))
    .optional()
    .describe('Filter edges by relation type subset (wikilink / doc_link / feature_ref / related_to). Omit = all.'),
};

export const GRAPH_SERVER_FAMILY = 'memory' as const;
// F186 (library memory architecture) anchors the knowledge-graph resolve surface.
const F186 = 'file:docs/features/F186-library-memory-architecture.md' as const;

export function buildGraphToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, GRAPH_SERVER_FAMILY, [
    {
      name: 'cat_cafe_graph_resolve',
      description: [
        'Drill into the knowledge graph by anchor or fuzzy query.',
        'Use when: you have a precise anchor (F186) and want neighbors/edges, OR a fuzzy term and need candidate anchors.',
        'Not for: pure semantic search → use search_evidence. Scanning recent activity → use list_recent.',
        'Depth tip: depth>=2 without a relations filter can trigger hub fan-out around super-hubs (F102/F188). Prefer depth=1 first, or pass relations to narrow traversal.',
        '',
        'RANKING (F200 live): Edge weights incorporate consumption frequency — paths cats traverse more often rank higher in candidate ordering. Constitutional edges are immune to demotion.',
        '',
        'v1 limitation (KD-8): does NOT accept collection scoping params. Visibility is server-derived from agent identity. Future versions may add dimension/collections after server-side identity wiring lands.',
      ].join('\n'),
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: graphResolveInputSchema,
      resourceFamily: 'evidence-navigation',
      runtimeProfiles: ['full', 'readonly', 'desktop:fable-phase0', 'desktop:cloud-pro-phase0'],
      admissionRef: F186,
      sourceExport: 'handleGraphResolve',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/library/graph/resolve',
        paramKeys: ['query', 'depth', 'relations'],
      },
    },
  ]);
}
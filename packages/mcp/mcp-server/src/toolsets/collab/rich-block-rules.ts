/**
 * collab/rich-block-rules toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/rich-block-rules-tool.ts`. The source handler
 * issued a direct `GET /api/callbacks/rich-block-rules` fetch with no params and
 * no args; reproduced here via the injected transport. Resource family
 * `artifact-surface`, local-runtime authority.
 */

import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const richBlockRulesInputSchema = {};

export const RICH_BLOCK_RULES_SERVER_FAMILY = 'collab' as const;

export function buildRichBlockRulesToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, RICH_BLOCK_RULES_SERVER_FAMILY, [
    {
      name: 'cat_cafe_get_rich_block_rules',
      description:
        'Get the full rich block usage rules (card/diff/checklist/media_gallery/audio/interactive). ' +
        'Call this BEFORE creating your first rich block in a session — it returns the full schema and constraints. ' +
        'You only need to call this once per session; the rules do not change within a session. ' +
        'GOTCHA: Without loading these rules first, you will likely produce invalid block JSON (wrong field names, missing required fields).',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: richBlockRulesInputSchema,
      resourceFamily: 'artifact-surface',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: 'file:docs/features/rich-block-rules.md',
      sourceExport: 'handleGetRichBlockRules',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/callbacks/rich-block-rules', paramKeys: [] },
    },
  ]);
}
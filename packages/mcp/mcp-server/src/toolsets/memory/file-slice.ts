/**
 * memory/file-slice toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/file-tools.ts` — the `fileSliceTools` array it
 * exports (one tool: `cat_cafe_read_file_slice`, handler `handleReadFileSlice`).
 * The parallel `fileTools` array (read_file / write_file / list_files) belongs to
 * a different family and is not ported here. Resource family `evidence-navigation`.
 *
 * NOTE(E2b memory): the handler is a **local read-only file slice reader** (path
 * boundary + `isPathAllowed` via `cat-cafe://collection/` manifest / env env) — it
 * does NOT issue any outbound callback. As in collab/shell, it is declared as a
 * `local-operator` tool with a placeholder GET route so a host extension may wire
 * the real local read; the boundary/validation itself is a host-layer concern.
 */
import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const readFileSliceInputSchema = {
  path: z.string().describe('The path to the file to read'),
  startLine: z.number().int().min(1).describe('1-based first line to include'),
  endLine: z.number().int().min(1).optional().describe('1-based final line to include; defaults to a bounded window'),
};

export const FILE_SLICE_SERVER_FAMILY = 'memory' as const;
const F209 = 'file:docs/features/F209-evidence-recall-optimization.md' as const;

export function buildFileSliceToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, FILE_SLICE_SERVER_FAMILY, [
    {
      name: 'cat_cafe_read_file_slice',
      description:
        'Read a bounded line range from a file within allowed directories. ' +
        'Use after search_evidence returns a sourcePath. Read-only; returns numbered lines and refuses large ranges.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readFileSliceInputSchema,
      resourceFamily: 'evidence-navigation',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: F209,
      sourceExport: 'handleReadFileSlice',
      authorizationHint: 'local-operator',
      route: {
        method: 'GET',
        path: '/api/callbacks/local/read-file-slice',
        paramKeys: ['path', 'startLine', 'endLine'],
      },
    },
  ]);
}
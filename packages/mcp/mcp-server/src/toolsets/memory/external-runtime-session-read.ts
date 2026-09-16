/**
 * memory/external-runtime-session-read toolset (EP1-1b, B5).
 *
 * Requested source: clowder `tools/external-runtime-session-tools.ts`, read-side
 * handlers (`externalRuntimeSessionReadTools`: `cat_cafe_list_external_runtime_sessions`
 * + `cat_cafe_read_external_runtime_session`).
 *
 * NOTE(E2b memory): those two read-side handlers — plus the callback-side
 * `register` handler — were ALREADY fully migrated in B3 under
 * `collab/external-runtime-session-callback.ts` (resourceFamily `runtime-session`,
 * counted in collab's 90 tools). Re-porting them here would create duplicate
 * canonical tool names, which `buildCanonicalToolRegistry` rejects. So this module
 * intentionally exports an EMPTY toolset (0 tools) and defers to the collab copy.
 * The memory family's external-runtime-session read intent is thus already
 * canonically covered by the collab group.
 */
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

export const EXTERNAL_RUNTIME_SESSION_READ_SERVER_FAMILY = 'memory' as const;

export function buildExternalRuntimeSessionReadToolset(port: CallbackTransportPort) {
  // Empty on purpose — see header NOTE(E2b memory). Collab already owns these tools.
  return defineMcpToolsetTools(port, EXTERNAL_RUNTIME_SESSION_READ_SERVER_FAMILY, []);
}
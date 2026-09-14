/**
 * EP1-1b toolset assembly entry point.
 *
 * `assembleMcpSeverToolsets(port)` returns the {@link CanonicalToolSources} that
 * a host wires into the EP1-1a `registerToolset` (via `buildCanonicalToolRegistry`).
 * Until the host injects a real {@link CallbackTransportPort}, callers may use
 * {@link unavailableCallbackPort}, which fails open (no tools registered), the
 * same fail-open posture EP1-1a has for a null callback config.
 */

import { buildCanonicalToolSources } from './canonical-tool-sources.js';
import { unavailableCallbackPort, type CallbackTransportPort } from './callback-transport.js';

export { unavailableCallbackPort } from './callback-transport.js';
export type { CallbackRequest, CallbackRoute, CallbackTransportPort } from './callback-transport.js';
export { buildCanonicalToolSources, buildCanonicalToolRegistryForPort, TOOLSET_GROUP_ANCHOR } from './canonical-tool-sources.js';
export {
  defineMcpToolsetTool,
  defineMcpToolsetTools,
} from './define-toolset-tool.js';
export type { AuthorizationHint, ToolsetToolInput } from './define-toolset-tool.js';

/** Alias kept for design §2.1 readability. */
export function assembleMcpSeverToolsets(port: CallbackTransportPort = unavailableCallbackPort) {
  return buildCanonicalToolSources(port);
}
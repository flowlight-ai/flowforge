/**
 * Injectable callback transport seam for EP1-1b domain toolsets.
 *
 * clowder's `tools/*-tools.ts` handlers almost all converge on two callbacks:
 * `callbackPost(path, body, opts)` and `callbackGet(path, params, opts)`, which
 * rely on the global `getCallbackConfig` + `fetch` and `@cat-cafe/shared`
 * (domain URL assembly). Per EP1-1b design §2.1, we do NOT re-introduce those
 * dependencies. Instead the handler is a thin invoker that forwards onto an
 * injected {@link CallbackTransportPort}; the host (plugin / MCP provider) wires
 * the real outbound transport (retry / degradation / agent-key selection /
 * KD-6 routing prefixes are host-layer concerns, intentionally not ported).
 */

import { errorResult, type ToolResult } from '../tool-result.js';

/** A single outbound callback request produced by a domain tool handler. */
export interface CallbackRequest {
  method: 'POST' | 'GET';
  /** Relative API path, e.g. `/api/callbacks/read-entrusted-work`. */
  path: string;
  /** JSON body for POST methods. */
  body?: Record<string, unknown>;
  /** URL-query params for GET methods. */
  params?: Record<string, string>;
  /** Persistent-agent identity selector (agent-key auth variants only). */
  agentKeyCatId?: string;
}

/** Host-provided transport for delivering {@link CallbackRequest}s. */
export type CallbackTransportPort = {
  readonly id: string;
  readonly send: (req: CallbackRequest) => Promise<ToolResult>;
};

/** Static callback route baked into a tool's handler. */
export type CallbackRoute = {
  method: 'POST' | 'GET';
  /**
   * Relative API path, e.g. `/api/callbacks/read-entrusted-work`. May contain
   * `${key}` segments that are substituted (URL-encoded) from the parsed input
   * (mirrors clowder handlers like
   * `/api/callbacks/evolution-programs/${programId}/changes`).
   */
  path: string;
  /** Input keys forwarded into the POST body, in order. */
  bodyKeys?: readonly string[];
  /** Input keys forwarded into the GET query params. */
  paramKeys?: readonly string[];
};

const NO_CONFIG_ERROR =
  'callback transport not configured (host has not wired a CallbackTransportPort for this call)';

/** URL-encode `${key}` template segments in `template` from `args`. */
function resolvePath(template: string, args: Record<string, unknown>): string {
  let out = template;
  for (const match of template.matchAll(/\$\{([\w.]+)\}/g)) {
    const key = match[1];
    if (key === undefined) continue;
    const value = args[key];
    if (value !== undefined && value !== null) {
      out = out.replace(`\${${key}}`, encodeURIComponent(String(value)));
    }
  }
  return out;
}

/** Builds a tool handler that forwards the parsed input onto `port` per `route`. */
export function createCallbackInvoker(
  port: CallbackTransportPort,
  route: CallbackRoute,
): (args: Record<string, unknown>) => Promise<ToolResult> {
  return async (args: Record<string, unknown>) => {
    const body: Record<string, unknown> = {};
    for (const key of route.bodyKeys ?? []) {
      if (key in args) body[key] = args[key];
    }
    const params: Record<string, string> = {};
    for (const key of route.paramKeys ?? []) {
      const value = args[key];
      if (value !== undefined && value !== null) params[key] = String(value);
    }
    const agentKeyCatId =
      typeof args['agentKeyCatId'] === 'string' ? (args['agentKeyCatId'] as string) : undefined;
    return port.send({
      method: route.method,
      path: resolvePath(route.path, args),
      ...(Object.keys(body).length > 0 ? { body } : {}),
      ...(Object.keys(params).length > 0 ? { params } : {}),
      ...(agentKeyCatId !== undefined ? { agentKeyCatId } : {}),
    });
  };
}

/** A no-op port that always errors, used before the host injects a real transport. */
export const unavailableCallbackPort: CallbackTransportPort = {
  id: 'unavailable',
  send: async () => errorResult(NO_CONFIG_ERROR),
};
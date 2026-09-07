/**
 * Injectable callback-config seam.
 *
 * Replaces the domain-coupled `getCallbackConfig` / `buildAuthHeaders` from
 * clowder's `tools/callback-tools.ts` with a local, settable config store so
 * the refresh loop and protocol tools stay self-contained and testable without
 * depending on `@cat-cafe/*` or clowder HTTP tools. When the config is null
 * the refresh loop is a no-op (matching the source behaviour).
 *
 * The owner process (plugin host / MCP provider) calls {@link setCallbackConfig}
 * to supply the callback endpoint + invocation credentials; units that read it
 * via {@link getCallbackConfig} treat a null value as "not configured".
 */

export interface CallbackConfig {
  apiUrl: string;
  invocationId?: string;
  callbackToken?: string;
  agentKeySecret?: string;
}

let currentCallbackConfig: CallbackConfig | null = null;

/** Replace the stored callback config. Pass `null` to disable callback calls. */
export function setCallbackConfig(config: CallbackConfig | null): void {
  currentCallbackConfig = config;
}

export function getCallbackConfig(): CallbackConfig | null {
  return currentCallbackConfig;
}

/**
 * Build the Authorization headers for a callback request from the config.
 * Prefers invocation credentials; falls back to the agent-key secret; otherwise
 * returns an empty header set.
 */
export function buildAuthHeaders(config: CallbackConfig): Record<string, string> {
  if (config.invocationId && config.callbackToken) {
    return {
      'x-invocation-id': config.invocationId,
      'x-callback-token': config.callbackToken,
    };
  }
  if (config.agentKeySecret) {
    return { 'x-agent-key-secret': config.agentKeySecret };
  }
  return {};
}
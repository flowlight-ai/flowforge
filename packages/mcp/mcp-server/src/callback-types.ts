/**
 * Local, self-contained declaration of callback auth failure reasons.
 *
 * Replaces the dependency on `@cat-cafe/shared` (which is forbidden in this
 * package) with an identical union + type guard so the refresh loop's
 * terminal-disposition handling stays faithful to the clowder source.
 */

/**
 * Single source of truth for callback auth failure reasons, mirroring the set
 * emitted by the clowder API's `makeCallbackAuthError` and consumed by the MCP
 * client's `parseAuthFailureReason`. Keep this in sync with the API side.
 */
export const CALLBACK_AUTH_FAILURE_REASONS = [
  'invalid_token',
  'unknown_invocation',
  'missing_creds',
  'stale_invocation',
  'completed',
  'failed',
  'interrupted',
  'replaced',
  'revoked',
  'canceled',
  'agent_key_expired',
  'agent_key_revoked',
  'agent_key_unknown',
  'agent_key_scope_mismatch',
] as const;

export type CallbackAuthFailureReason = (typeof CALLBACK_AUTH_FAILURE_REASONS)[number];

export function isCallbackAuthFailureReason(value: unknown): value is CallbackAuthFailureReason {
  return typeof value === 'string' && (CALLBACK_AUTH_FAILURE_REASONS as readonly string[]).includes(value);
}
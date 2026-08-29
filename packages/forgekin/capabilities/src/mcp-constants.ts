/**
 * Shared MCP constants — 拆分入口点 / 回调 env 键的单一真相源。
 *
 * 移植自 clowder-ai `config/capabilities/mcp-constants.ts`（#712）。
 * cat-cafe-* 为平台托管（managed）MCP server 的命名族：
 * collab/memory/signals/limb/audio/finance 六个拆分入口点。
 */

/** Map of split server name → dist entrypoint filename. */
export const CAT_CAFE_SPLIT_ENTRYPOINTS = new Map([
  ['cat-cafe-collab', 'collab.js'],
  ['cat-cafe-memory', 'memory.js'],
  ['cat-cafe-signals', 'signals.js'],
  ['cat-cafe-limb', 'limb.js'],
  ['cat-cafe-audio', 'audio.js'],
  ['cat-cafe-finance', 'finance.js'],
]);

/** Use the Node executable that is already running the hub for managed MCP servers. */
export function resolveCatCafeNodeCommand(): string {
  return process.execPath?.trim() || 'node';
}

const LEGACY_CAT_CAFE_MCP_ID = 'cat-cafe';

/** Expand managed MCP names so old monolith aliases cannot re-enter user merges. */
export function expandManagedMcpNamesForUserMerge(names: Iterable<string>): Set<string> {
  const expanded = new Set(names);
  let hasCatCafeFamily = expanded.has(LEGACY_CAT_CAFE_MCP_ID);
  for (const splitId of CAT_CAFE_SPLIT_ENTRYPOINTS.keys()) {
    if (expanded.has(splitId)) {
      hasCatCafeFamily = true;
      break;
    }
  }
  if (hasCatCafeFamily) {
    expanded.add(LEGACY_CAT_CAFE_MCP_ID);
    for (const splitId of CAT_CAFE_SPLIT_ENTRYPOINTS.keys()) expanded.add(splitId);
  }
  return expanded;
}

/** Callback env keys injected per-invocation into managed MCP servers. */
export const MCP_CALLBACK_ENV_KEYS = [
  'CAT_CAFE_API_URL',
  'CAT_CAFE_INVOCATION_ID',
  'CAT_CAFE_CALLBACK_TOKEN',
  'CAT_CAFE_USER_ID',
  'CAT_CAFE_CAT_ID',
  'CAT_CAFE_THREAD_ID',
  'CAT_CAFE_SIGNAL_USER',
  'CAT_CAFE_RUN_TYPE',
  'CAT_CAFE_AUDIT_TOPIC',
  // NOTE: CAT_CAFE_CREDENTIAL_FILE is intentionally NOT here — it is session-scoped
  // and injected by persistent provider carriers at session creation only.
  // A static per-invocation placeholder would collapse it back to a shared path
  // (#1099 review P1: superseded processes must not see newer invocation creds).
] as const;

/** Session-lifetime MCP env keys used by persistent provider carriers. */
export const MCP_SESSION_ENV_KEYS = ['CAT_CAFE_CREDENTIAL_FILE'] as const;

/** Patterns that indicate an env key value should be redacted in debug output. */
export const SENSITIVE_KEY_PATTERNS = [
  'KEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'CREDENTIAL',
  'AUTH',
  'BEARER',
  'COOKIE',
  'SESSION',
];

/** Build a debug-safe summary of MCP servers for structured logging. */
export function summarizeMcpInjection(
  mcpServers: Record<string, Record<string, unknown>>,
  opts?: { catId?: string; resolvedFrom?: string; provider?: string },
): Record<string, unknown> {
  return {
    provider: opts?.provider ?? 'unknown',
    ...(opts?.catId ? { catId: opts.catId } : {}),
    ...(opts?.resolvedFrom ? { resolvedFrom: opts.resolvedFrom } : {}),
    serverCount: Object.keys(mcpServers).length,
    servers: Object.entries(mcpServers).map(([name, cfg]) => ({
      name,
      type: cfg.type ?? 'stdio',
      command: cfg.command,
    })),
  };
}

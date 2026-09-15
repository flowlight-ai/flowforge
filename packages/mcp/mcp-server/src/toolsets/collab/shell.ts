/**
 * collab/shell toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/shell-tools.ts`. The source handler is a
 * read-only local shell exec (pwd/ls/cat/git log|status|rev-parse|diff|show) with
 * a whitelist + path-boundary guard (F061 Bug-F workaround) — it does NOT issue a
 * callback request. Resource family `runtime-control`, local-runtime authority.
 *
 * NOTE: the injected `CallbackTransportPort` only carries POST/GET callback
 * routes, so the local-runtime exec is declared as an `AuthorizationHint =
 * 'local-operator'` tool with a placeholder GET route. The read-only exec itself
 * (whitelist + `isPathAllowed` boundary) is a host-layer concern and is not
 * ported here.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const shellExecInputSchema = {
  commandLine: z.string().min(1).describe('The shell command to execute (read-only whitelist enforced)'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory (defaults to first ALLOWED_WORKSPACE_DIRS entry — typically the workspace repo root)'),
};

export const SHELL_SERVER_FAMILY = 'collab' as const;

export function buildShellToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, SHELL_SERVER_FAMILY, [
    {
      name: 'cat_cafe_shell_exec',
      description:
        'Run a read-only shell command (pwd/ls/cat/git log|status|rev-parse|diff|show) and return stdout/stderr/exitCode. ' +
        'Bypasses Antigravity UI permission gate (F061 Bug-F workaround). ' +
        'Write operations (rm/mv/cp/mkdir/git branch|checkout|commit/npm install/etc.) are REFUSED — use cascade run_command + user approval for those. ' +
        'Redis 6399 port is sanctum and refused. 30s timeout, 256KB output cap.',
      action: 'command',
      risk: { level: 'destructive', openWorld: false },
      inputSchema: shellExecInputSchema,
      resourceFamily: 'runtime-control',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: 'file:docs/features/F061-readonly-shell-exec.md',
      sourceExport: 'handleShellExec',
      authorizationHint: 'local-operator',
      route: {
        method: 'GET',
        path: '/api/callbacks/local/shell-exec',
        paramKeys: ['commandLine', 'cwd'],
      },
    },
  ]);
}
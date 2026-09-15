/**
 * collab/hub-action toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/hub-action-tools.ts` (F120 x F284 gate). Both
 * handlers converge on callback routes:
 *   - workspace_navigate: POST `/api/workspace/navigate`
 *   - preview_open:       POST `/api/preview/auto-open`
 * Resource family `artifact-surface`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const optionalContextSchemas = {
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe('Current Clowder AI thread id; pass when available to avoid tab leakage.'),
  worktreeId: z
    .string()
    .min(1)
    .optional()
    .describe('Target Clowder AI worktree id; pass when the action is worktree-scoped.'),
  catId: z.string().min(1).optional().describe('Calling cat id for audit/probe correlation.'),
  agentKeyCatId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Persistent-agent identity selector. Required for shared Antigravity MCP when CAT_CAFE_AGENT_KEY_FILES is configured; ignored when invocation credentials are present.',
    ),
};

const workspaceNavigateInputSchema = {
  path: z
    .string()
    .min(1)
    .describe('Codex-native absolute local path, or a repo-relative file/directory path when worktreeId is provided.'),
  action: z
    .enum(['reveal', 'open'])
    .optional()
    .describe(
      'Workspace navigation action. Use reveal for directories/uncertain targets; open for files. Default: reveal.',
    ),
  worktreeId: z
    .string()
    .min(1)
    .optional()
    .describe('Target worktree id for repo-relative paths; omit when path is absolute.'),
  line: z.number().int().min(1).optional().describe('Optional 1-based line number for action=open.'),
  threadId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Authenticated Clowder AI thread scope. Required for agent-key auth because persistent MCP has no invocation thread; omit for invocation auth to use its bound thread.',
    ),
  catId: optionalContextSchemas.catId,
  agentKeyCatId: optionalContextSchemas.agentKeyCatId,
};

const previewVisiblePageAdmissionSchema = z
  .object({
    expectedClientRevision: z.string().min(1),
    requiredDom: z
      .array(
        z.object({
          selector: z.string().min(1),
          textContains: z.string().min(1).optional(),
        }),
      )
      .min(1)
      .max(8),
    forbiddenText: z.array(z.string().min(1)).max(8).optional(),
  })
  .strict();

const previewOpenInputSchema = {
  port: z.number().int().min(1).max(65535).describe('Localhost port to open in Hub Browser Preview.'),
  path: z.string().min(1).optional().describe('Path on the localhost app to open. Default: /.'),
  worktreeId: optionalContextSchemas.worktreeId,
  threadId: optionalContextSchemas.threadId,
  catId: optionalContextSchemas.catId,
  agentKeyCatId: optionalContextSchemas.agentKeyCatId,
  visiblePageAdmission: previewVisiblePageAdmissionSchema
    .optional()
    .describe(
      'Optional fail-closed visible-page proof. Requires the exact target browser build revision plus bounded DOM/text assertions; applied is withheld until the rendered iframe attests through the Preview bridge.',
    ),
};

export const HUB_ACTION_SERVER_FAMILY = 'collab' as const;
const F120 = 'file:docs/features/F120-hub-action-gate.md' as const;

export function buildHubActionToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, HUB_ACTION_SERVER_FAMILY, [
    {
      name: 'cat_cafe_workspace_navigate',
      description:
        'Open or reveal an absolute local path or typed repo-relative path in the Hub Workspace panel. ' +
        'Use when: the user asks to open a local file, inspect logs/docs/code, or see a newly created artifact. ' +
        'NOT for: HTTP links or localhost apps (use normal links or cat_cafe_preview_open). ' +
        'Output: the accepted request plus deliveryStatus=applied|queued|blocked|unconfirmed and an audit probe. ' +
        'GOTCHA: ok:true means the request was accepted, not that the file is visible; only applied proves a connected Hub client changed Workspace state. ' +
        'Absolute paths need no worktreeId; repo-relative paths require one. threadId is required for agent-key auth and may be omitted for invocation auth. ' +
        'Shared persistent MCP callers pass agentKeyCatId; do not handwrite curl to /api/workspace/navigate.',
      action: 'command',
      risk: { level: 'write', openWorld: false },
      inputSchema: workspaceNavigateInputSchema,
      resourceFamily: 'artifact-surface',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F120,
      sourceExport: 'handleWorkspaceNavigate',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/workspace/navigate',
        bodyKeys: ['path', 'action', 'worktreeId', 'line', 'threadId', 'catId'],
      },
    },
    {
      name: 'cat_cafe_preview_open',
      description:
        'Open a localhost app in the Hub Browser Preview panel. ' +
        'Use after starting or discovering a dev server, or when the user asks to see frontend changes. ' +
        'Result: the Hub Browser panel auto-opens the localhost target through the preview gateway. ' +
        'Output: the accepted request plus deliveryStatus=applied|queued|blocked|unconfirmed. ' +
        'GOTCHA: allowed:true only means admission; only deliveryStatus=applied proves a connected Hub client ' +
        'applied the preview — never report "已打开" on unconfirmed/queued/blocked. For operator or visual acceptance, ' +
        'pass visiblePageAdmission; applied then requires an exact iframe origin/port, embedded client revision, and DOM proof. ' +
        'threadId is required for agent-key auth and may be omitted for invocation auth. ' +
        'GOTCHA: validate the target dev server first; shared persistent MCP callers pass agentKeyCatId; do not handwrite curl to /api/preview/auto-open.',
      action: 'derive',
      risk: { level: 'write', openWorld: false },
      inputSchema: previewOpenInputSchema,
      resourceFamily: 'artifact-surface',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F120,
      sourceExport: 'handlePreviewOpen',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/preview/auto-open',
        bodyKeys: ['port', 'path', 'worktreeId', 'threadId', 'catId', 'visiblePageAdmission'],
      },
    },
  ]);
}
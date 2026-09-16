/**
 * limb/limb toolset (EP1-1b, B6) — F126 四肢控制面.
 *
 * Migrated from clowder `tools/limb-tools.ts` (sourced from the clowder
 * migration-factory path, authority `callback-limb`, now canonical-injected).
 * Six tools (bare `limb_*` names, kept verbatim):
 *   - limb_list_available:  POST `/api/callback/limb/list`
 *   - limb_list_tools:      POST `/api/callback/limb/list-tools`
 *   - limb_invoke_tool:     POST `/api/callback/limb/invoke`
 *   - limb_pair_list:       POST `/api/callback/limb/pair/list`
 *   - limb_pair_approve:    POST `/api/callback/limb/pair/approve`
 *   - limb_bind_embodiment: POST `/api/callback/limb/embodiment/bind`
 * Resource families `limb-capability` / `limb-pairing` / `limb-embodiment`.
 *
 * NOTE(E2b limb): clowder's `callback-limb` authority adds an agent-key
 * authorization path on top of the owner callback; the `.limb` family is mapped to
 * `AuthorizationHint 'callback-owner'` (the primary owner-callback principal), with
 * `agentKeyCatId` still funnelled through the injected transport's transport-level
 * `agentKeyCatId` field (never inside the POST body). Host-layer concerns (baseUrl,
 * sidecar agent-key selection) are injected by the host.
 *
 * RECONCILIATION: all six handlers are already single POST callbacks; no verb
 * downgrade or path-template split is required. `limb_invoke_tool` forwards its
 * `params` object directly in the POST body.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const agentKeyCatIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Shared Antigravity MCP requires your own catId (e.g. "antig-opus") to select the correct sidecar agent key.');

const limbListAvailableInputSchema = {
  capability: z.string().optional().describe('Filter by capability category (e.g. "camera", "gpu_render")'),
  agentKeyCatId: agentKeyCatIdSchema,
};

const limbListToolsInputSchema = {
  nodeId: z.string().min(1).describe('Target limb node ID (from limb_list_available)'),
  command: z.string().optional().describe('Specific tool name (omit to return all tool schemas for the limb)'),
  agentKeyCatId: agentKeyCatIdSchema,
};

const limbInvokeToolInputSchema = {
  nodeId: z.string().min(1).describe('Target limb node ID (from limb_list_available)'),
  command: z.string().min(1).describe('Tool name to execute (from limb_list_tools, e.g. "weixin_mp.create_draft")'),
  params: z.record(z.string(), z.unknown()).optional().describe('Tool params (built per limb_list_tools schema)'),
  agentKeyCatId: agentKeyCatIdSchema,
};

const limbPairListInputSchema = {
  agentKeyCatId: agentKeyCatIdSchema,
};

const limbPairApproveInputSchema = {
  requestId: z.string().min(1).describe('Pairing request ID'),
  agentKeyCatId: agentKeyCatIdSchema,
};

const limbBindEmbodimentInputSchema = {
  nodeId: z.string().min(1).describe('Approved, online physical limb nodeId'),
  expressionRef: z.string().min(1).describe('Current cat registered expression-mapping ref'),
  voiceProfileRef: z.string().min(1).describe('Current cat registered voice-profile mapping ref'),
  volumePercent: z.number().min(0).max(100).describe('Speaker volume percentage'),
  agentKeyCatId: agentKeyCatIdSchema,
};

export const LIMB_SERVER_FAMILY = 'limb' as const;
// Admission/certificate evidence: mirrors clowder `tools/limb-tools.ts` (F126 四肢控制面).
const LIMB_REF = 'file:packages/mcp/mcp-server/src/toolsets/limb/limb.ts' as const;

export function buildLimbToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, LIMB_SERVER_FAMILY, [
    {
      name: 'limb_list_available',
      description:
        'Discover available limb nodes and their tool names. Returns nodeId, platform, capabilities (with command names), and status. ' +
        'Limbs are external devices or plugin-backed service endpoints (iPhone, WeChat MP, Xiaohongshu, Mac Mini, etc.) — NOT cats. ' +
        'Step 1 of 3: list_available → list_tools → invoke_tool. ' +
        'Returns tool names but NOT detailed parameter schemas — call limb_list_tools next to get schemas. ' +
        'Shared Antigravity MCP GOTCHA: pass agentKeyCatId to select the correct variant sidecar key.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: limbListAvailableInputSchema,
      resourceFamily: 'limb-capability',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: LIMB_REF,
      sourceExport: 'handleLimbListAvailable',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callback/limb/list', bodyKeys: ['capability'] },
    },
    {
      name: 'limb_list_tools',
      description:
        'Get detailed tool schemas for a specific limb node. Returns parameter descriptions, types, required flags, and defaults. ' +
        'Step 2 of 3: list_available → list_tools → invoke_tool. ' +
        'Pass nodeId (from limb_list_available) and optionally a specific command name. ' +
        'Without command: returns all tool schemas for the node. With command: returns schema for that specific tool only. ' +
        'Use the returned schema to construct the correct params for limb_invoke_tool. ' +
        'Shared Antigravity MCP GOTCHA: pass agentKeyCatId to select the correct variant sidecar key.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: limbListToolsInputSchema,
      resourceFamily: 'limb-capability',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: LIMB_REF,
      sourceExport: 'handleLimbListTools',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callback/limb/list-tools', bodyKeys: ['nodeId', 'command'] },
    },
    {
      name: 'limb_invoke_tool',
      description:
        'Invoke a tool on a specific limb node. Requires nodeId and command (tool name). ' +
        'Step 3 of 3: list_available → list_tools → invoke_tool. ' +
        'Examples: limb_invoke_tool(nodeId="weixin-mp", command="weixin_mp.create_draft", params={...}). ' +
        'GOTCHA: Get nodeId from limb_list_available and build params according to limb_list_tools schema — do not guess. ' +
        'Shared Antigravity MCP GOTCHA: pass agentKeyCatId to select the correct variant sidecar key.',
      action: 'create',
      risk: { level: 'destructive', openWorld: true },
      inputSchema: limbInvokeToolInputSchema,
      resourceFamily: 'limb-capability',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: LIMB_REF,
      sourceExport: 'handleLimbInvokeTool',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callback/limb/invoke', bodyKeys: ['nodeId', 'command', 'params'] },
    },
    {
      name: 'limb_pair_list',
      description:
        'List pending limb pairing requests. Remote devices must be approved by co-creator before cats can use them. ' +
        'Use to check if any new devices are waiting for approval. ' +
        'Shared Antigravity MCP GOTCHA: pass agentKeyCatId to select the correct variant sidecar key.',
      action: 'command',
      risk: { level: 'read', openWorld: false },
      inputSchema: limbPairListInputSchema,
      resourceFamily: 'limb-pairing',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: LIMB_REF,
      sourceExport: 'handleLimbPairList',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callback/limb/pair/list', bodyKeys: [] },
    },
    {
      name: 'limb_pair_approve',
      description:
        'Approve a limb pairing request. After approval, the remote device is automatically registered in the Registry ' +
        'and becomes available for cats to invoke. ' +
        'GOTCHA: Only co-creator should initiate approval — do not auto-approve without user consent. ' +
        'Shared Antigravity MCP GOTCHA: pass agentKeyCatId to select the correct variant sidecar key.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: limbPairApproveInputSchema,
      resourceFamily: 'limb-pairing',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: LIMB_REF,
      sourceExport: 'handleLimbPairApprove',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/callback/limb/pair/approve', bodyKeys: ['requestId'] },
    },
    {
      name: 'limb_bind_embodiment',
      description:
        'Bind one approved, online physical limb body to the current user, thread, and cat. ' +
        'The server derives identity from callback credentials; callers cannot provide userId/threadId/catId. ' +
        'GOTCHA: Only run after the owner explicitly asks to embody the current cat on that node.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: limbBindEmbodimentInputSchema,
      resourceFamily: 'limb-embodiment',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: LIMB_REF,
      sourceExport: 'handleLimbBindEmbodiment',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callback/limb/embodiment/bind',
        bodyKeys: ['nodeId', 'expressionRef', 'voiceProfileRef', 'volumePercent'],
      },
    },
  ]);
}
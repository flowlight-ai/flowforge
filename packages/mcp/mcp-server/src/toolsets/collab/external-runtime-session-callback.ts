/**
 * collab/external-runtime-session-callback toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/external-runtime-session-tools.ts`. All three
 * handlers target the external-runtime-session endpoints; `register` used
 * `callbackPost`, while `list`/`read` used a direct `GET fetch` with auth headers
 * — both are reproduced here via the injected callback transport:
 *   - register: POST `/api/callbacks/external-runtime-sessions/register`
 *   - list:     GET  `/api/external-runtime-sessions`        (query filters)
 *   - read:     GET  `/api/external-runtime-sessions/${sessionId}`
 * Resource family `runtime-session`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const runtimeSchema = z
  .literal('antigravity-desktop')
  .describe('External runtime identifier. Phase B supports antigravity-desktop.');

const agentKeyCatIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Persistent-agent identity selector. Required for shared Antigravity MCP when CAT_CAFE_AGENT_KEY_FILES is configured.',
  );

const bindingSchema = z
  .union([
    z.object({ mode: z.literal('orphan') }),
    z.object({ mode: z.literal('thread'), threadId: z.string().min(1) }),
  ])
  .optional()
  .describe('Optional binding target. Omit or use orphan for the hidden external runtime anchor.');

const registerExternalRuntimeSessionInputSchema = {
  runtime: runtimeSchema,
  runtimeSessionId: z.string().min(1).describe('Antigravity cascade/session id'),
  runtimeConversationId: z.string().min(1).optional().describe('Optional Antigravity conversation id'),
  catId: z.string().min(1).describe('Cat id represented by the agent-key'),
  model: z.string().min(1).describe('Runtime model identity'),
  title: z.string().min(1).optional().describe('Optional human-readable IDE session title'),
  startedAt: z.number().finite().describe('Runtime session start timestamp in epoch milliseconds'),
  lastObservedAt: z.number().finite().optional().describe('Latest observed activity timestamp in epoch milliseconds'),
  binding: bindingSchema,
  agentKeyCatId: agentKeyCatIdSchema,
};

const listExternalRuntimeSessionsInputSchema = {
  runtime: runtimeSchema.optional(),
  catId: z.string().min(1).optional().describe('Filter by cat id'),
  limit: z.number().int().min(1).max(100).optional().describe('Max sessions to return'),
};

const readExternalRuntimeSessionInputSchema = {
  sessionId: z.string().min(1).describe('Clowder AI SessionRecord id'),
};

export const EXTERNAL_RUNTIME_SESSION_CALLBACK_SERVER_FAMILY = 'collab' as const;
const F227 = 'file:docs/features/F227-session-chain-evidence.md' as const;

export function buildExternalRuntimeSessionCallbackToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, EXTERNAL_RUNTIME_SESSION_CALLBACK_SERVER_FAMILY, [
    {
      name: 'cat_cafe_register_external_runtime_session',
      description:
        'Register an Antigravity IDE-direct runtime session using persistent agent-key auth. ' +
        'Use when an IDE-direct conversation needs Clowder AI session-chain evidence without invocation callback credentials. ' +
        'Shared Antigravity MCP GOTCHA: pass agentKeyCatId so the right sidecar key is selected.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: registerExternalRuntimeSessionInputSchema,
      resourceFamily: 'runtime-session',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F227,
      sourceExport: 'handleRegisterExternalRuntimeSession',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/callbacks/external-runtime-sessions/register',
        bodyKeys: [
          'runtime',
          'runtimeSessionId',
          'runtimeConversationId',
          'catId',
          'model',
          'title',
          'startedAt',
          'lastObservedAt',
          'binding',
        ],
      },
    },
    {
      name: 'cat_cafe_list_external_runtime_sessions',
      description:
        'List orphan, dispatched, or IDE-direct external runtime sessions by runtime, cat, and recent activity. ' +
        'Use when an external runtime session looks lost, detached from the current thread, or needs cross-runtime drilldown. ' +
        'Use before reading digest/events when there is no normal Clowder AI thread yet.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listExternalRuntimeSessionsInputSchema,
      resourceFamily: 'runtime-session',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: F227,
      sourceExport: 'handleListExternalRuntimeSessions',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/external-runtime-sessions',
        paramKeys: ['runtime', 'catId', 'limit'],
      },
    },
    {
      name: 'cat_cafe_read_external_runtime_session',
      description:
        'Read one external runtime session metadata record and drilldown pointers. ' +
        'Use after list when you need the sessionId, runtime binding, digest pointer, or handoff event path for an external runtime session. ' +
        'After this, use cat_cafe_read_session_digest or cat_cafe_read_session_events with the returned sessionId.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readExternalRuntimeSessionInputSchema,
      resourceFamily: 'runtime-session',
      runtimeProfiles: ['full', 'readonly'],
      admissionRef: F227,
      sourceExport: 'handleReadExternalRuntimeSession',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/external-runtime-sessions/${sessionId}', paramKeys: [] },
    },
  ]);
}
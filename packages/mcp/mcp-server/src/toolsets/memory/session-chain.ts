/**
 * memory/session-chain toolset (EP1-1b, B5).
 *
 * Migrated from clowder `tools/session-chain-tools.ts` (F24 Phase D + F98). Four
 * tools (the source's D15 note removed `cat_cafe_session_search`, superseded by the
 * unified `search_evidence` entry point):
 *   - list_session_chain:           GET `/api/threads/${threadId}/sessions`
 *   - read_session_events:          GET `/api/sessions/${sessionId}/events`
 *   - read_session_digest:          GET `/api/sessions/${sessionId}/digest`
 *   - read_invocation_detail:       GET `/api/sessions/${sessionId}/invocations/${invocationId}`
 * Resource family `runtime-session`.
 *
 * NOTE(E2b memory): the source handlers issue direct `fetch` GETs with
 * `x-cat-cafe-user` / `x-cat-id` headers from env; those host-layer headers are not
 * part of the ported param set. `list_session_chain` applies its `limit` client-side
 * and so it is not forwarded as a query param.
 */
import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';

import type { CallbackTransportPort } from '../callback-transport.js';

const listSessionChainInputSchema = {
  threadId: z.string().min(1).describe('Thread ID'),
  catId: z.string().optional().describe('Filter by cat ID (any valid registered catId)'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results'),
};

const readSessionEventsInputSchema = {
  sessionId: z.string().min(1).describe('Session ID to read events from'),
  cursor: z.number().int().min(0).optional().describe('Start from event number (0-based)'),
  limit: z.number().int().min(1).max(200).optional().describe('Max events per page (default 50)'),
  view: z
    .enum(['raw', 'chat', 'handoff'])
    .optional()
    .describe(
      'View mode: raw (default, full JSONL events), chat (role/content pairs), handoff (per-invocation summaries)',
    ),
};

const readSessionDigestInputSchema = {
  sessionId: z.string().min(1).describe('Session ID to read digest from'),
};

const readInvocationDetailInputSchema = {
  sessionId: z.string().min(1).describe('Session ID containing the invocation'),
  invocationId: z.string().min(1).describe('Invocation ID to read events for'),
};

export const SESSION_CHAIN_SERVER_FAMILY = 'memory' as const;
// F227 (session-chain evidence) anchors sealed-transcript drill-down, as in the
// collab external-runtime-session group.
const F227 = 'file:docs/features/F227-session-chain-evidence.md' as const;

const FULL_DESKTOP = ['full', 'readonly', 'desktop:fable-phase0', 'desktop:cloud-pro-phase0'] as const;
const FULL_READONLY = ['full', 'readonly'] as const;

export function buildSessionChainToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, SESSION_CHAIN_SERVER_FAMILY, [
    {
      name: 'cat_cafe_list_session_chain',
      description:
        'List session chain for a thread. Shows session IDs, sequence numbers, status, and context health for each cat. ' +
        'Use when you need to find a specific session ID to drill into (e.g. "what did a specific cat do in thread X?"). ' +
        'WORKFLOW: list_session_chain → read_session_digest (overview first) → read_session_events (detail). ' +
        'TIP: Filter by catId to narrow results when a thread has many sessions from different cats.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listSessionChainInputSchema,
      resourceFamily: 'runtime-session',
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F227,
      sourceExport: 'handleListSessionChain',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/threads/${threadId}/sessions', paramKeys: ['catId'] },
    },
    {
      name: 'cat_cafe_read_session_events',
      description:
        'Read events from a sealed session transcript. Supports view modes: raw (default, full events), chat (role/content pairs), handoff (per-invocation summaries). Pagination via cursor. ' +
        'VIEW SELECTION: ' +
        'handoff (RECOMMENDED first) = per-invocation summaries with tool calls and key messages — best overview of what happened. ' +
        'chat = role/content message pairs — useful when you need to see the actual conversation flow. ' +
        'raw = full JSONL events — only when you need low-level event details (rarely needed). ' +
        'GOTCHA: Only sealed (completed) sessions are readable — in-progress sessions return empty. ' +
        'TIP: Start with view=handoff to get the big picture, then use read_invocation_detail for specific invocations.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readSessionEventsInputSchema,
      resourceFamily: 'runtime-session',
      runtimeProfiles: FULL_READONLY,
      admissionRef: F227,
      sourceExport: 'handleReadSessionEvents',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/sessions/${sessionId}/events',
        paramKeys: ['cursor', 'limit', 'view'],
      },
    },
    {
      name: 'cat_cafe_read_session_digest',
      description:
        'Read the extractive digest of a sealed session. Contains tool names, files touched, errors, and timing info. ' +
        'ALWAYS start here before reading full events — the digest gives you a quick overview ' +
        'so you know which parts of the session are worth drilling into. ' +
        'GOTCHA: Returns 404 if the session is not yet sealed (still in progress). ' +
        'TIP: After reading the digest, use read_session_events with view=handoff for more detail, ' +
        'or read_invocation_detail if the digest mentions a specific invocationId of interest.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readSessionDigestInputSchema,
      resourceFamily: 'runtime-session',
      runtimeProfiles: FULL_DESKTOP,
      admissionRef: F227,
      sourceExport: 'handleReadSessionDigest',
      authorizationHint: 'read-only',
      route: { method: 'GET', path: '/api/sessions/${sessionId}/digest', paramKeys: [] },
    },
    {
      name: 'cat_cafe_read_invocation_detail',
      description:
        'Read all events for a specific invocation within a sealed session. ' +
        'Use AFTER search_evidence or read_session_events (handoff view) returns an invocationId you want to inspect. ' +
        'This gives you the complete picture of one invocation: every tool call, response, and error. ' +
        'GOTCHA: You need both sessionId AND invocationId. Get sessionId from list_session_chain, ' +
        'and invocationId from read_session_events (handoff view) or search_evidence results.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: readInvocationDetailInputSchema,
      resourceFamily: 'runtime-session',
      runtimeProfiles: FULL_READONLY,
      admissionRef: F227,
      sourceExport: 'handleReadInvocationDetail',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/sessions/${sessionId}/invocations/${invocationId}',
        paramKeys: [],
      },
    },
  ]);
}
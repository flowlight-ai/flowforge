/**
 * collab/event-memory toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/event-memory-tools.ts` (F227). Three handlers:
 *   - teleport:          POST `/api/memory/teleport`          (resourceFamily thread-message)
 *   - list_events:       GET  `/api/memory/events`            (resourceFamily event-memory)
 *   - backfill_events:   POST `/api/memory/events/backfill`   (resourceFamily event-memory)
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const agentKeyCatId = z
  .string()
  .min(1)
  .optional()
  .describe(
    'Persistent-agent identity selector. Required for shared Antigravity MCP when CAT_CAFE_AGENT_KEY_FILES is configured.',
  );

const teleportInputSchema = {
  threadId: z.string().min(1).describe('Target Clowder AI thread id to teleport into.'),
  messageId: z
    .string()
    .min(1)
    .describe(
      'Exact message id to scroll to and highlight. Event Memory coordinate — a real message id, NOT an invocationId.',
    ),
  catId: z.string().min(1).optional().describe('Calling cat id for audit correlation.'),
  agentKeyCatId,
};

const listEventsInputSchema = {
  trigger: z
    .string()
    .min(1)
    .optional()
    .describe('Filter by trigger: human_brake | cat_brake | cat_shout | flywheel_selffix | lesson_settle.'),
  cat: z.string().min(1).optional().describe('Filter by the catId the event is about (当事猫 / braked cat).'),
  type: z.string().min(1).optional().describe('Filter by event type (e.g. a magic-word slug like 脚手架).'),
  threadId: z.string().min(1).optional().describe('Filter by thread.'),
  confidence: z.string().min(1).optional().describe('Filter by confidence: high | mid | low.'),
  cognitiveTransition: z.string().min(1).optional().describe('Filter by transition (e.g. user_brake, aha).'),
  since: z.number().int().optional().describe('Only events with timestamp >= since (ms epoch).'),
  until: z.number().int().optional().describe('Only events with timestamp <= until (ms epoch).'),
  limit: z.number().int().min(1).max(200).optional().describe('Max events (default unbounded, cap 200).'),
  offset: z.number().int().min(0).optional().describe('Paging offset.'),
  agentKeyCatId,
};

const backfillEventsInputSchema = {
  agentKeyCatId,
};

export const EVENT_MEMORY_SERVER_FAMILY = 'collab' as const;
const F227 = 'file:docs/features/F227-event-memory.md' as const;

export function buildEventMemoryToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, EVENT_MEMORY_SERVER_FAMILY, [
    {
      name: 'cat_cafe_teleport',
      description:
        'Teleport the Hub to an exact thread message (threadId + messageId). ' +
        'Use to jump to where a cognitive-transition event happened — e.g. from an Event Memory / timeline entry to its source message. ' +
        'Result: the Hub switches to the thread if needed and scrolls + highlights the target message. ' +
        'GOTCHA: pass a real messageId (Event Memory coordinate), not an invocationId; shared persistent MCP callers pass agentKeyCatId; do not handwrite curl to /api/memory/teleport.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: teleportInputSchema,
      resourceFamily: 'thread-message',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F227,
      sourceExport: 'handleTeleport',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/memory/teleport', bodyKeys: ['threadId', 'messageId', 'catId'] },
    },
    {
      name: 'cat_cafe_list_events',
      description:
        'Query Event Memory — the timeline of cognitive-transition events (magic-word brakes, self-checks, aha). ' +
        'Use to recall WHEN/WHERE a cat was braked or had a realization — e.g. "show my 脚手架 brakes" (filter cat + type). ' +
        'Returns events newest-first with their thread/message coordinates (jump there with cat_cafe_teleport). ' +
        'Read-only; filters: trigger/cat/type/threadId/confidence/cognitiveTransition/since/until + limit/offset.',
      action: 'read',
      risk: { level: 'read', openWorld: false },
      inputSchema: listEventsInputSchema,
      resourceFamily: 'event-memory',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F227,
      sourceExport: 'handleListEvents',
      authorizationHint: 'read-only',
      route: {
        method: 'GET',
        path: '/api/memory/events',
        paramKeys: [
          'trigger',
          'cat',
          'type',
          'threadId',
          'confidence',
          'cognitiveTransition',
          'since',
          'until',
          'limit',
          'offset',
        ],
      },
    },
    {
      name: 'cat_cafe_backfill_events',
      description:
        'Backfill historical magic-word events into Event Memory by scanning the persisted message corpus. ' +
        'Idempotent — safe to re-run (dedups by thread+message+type). Run once to populate the timeline with past ' +
        'brakes from before live capture existed. Returns {scanned, marked, skipped, failed}.',
      action: 'update',
      risk: { level: 'write', openWorld: false },
      inputSchema: backfillEventsInputSchema,
      resourceFamily: 'event-memory',
      runtimeProfiles: ['full', 'agent-key'],
      admissionRef: F227,
      sourceExport: 'handleBackfillEvents',
      authorizationHint: 'callback-owner',
      route: { method: 'POST', path: '/api/memory/events/backfill', bodyKeys: [] },
    },
  ]);
}
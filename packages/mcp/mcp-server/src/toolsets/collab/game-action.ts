/**
 * collab/game-action toolset (EP1-1b, B3).
 *
 * Migrated from clowder `tools/game-action-tools.ts`. The source handler issued
 * a direct `POST /api/game/${gameId}/action` fetch (not a callback); reproduced
 * here via the injected transport with the `${gameId}` template. Resource family
 * `game`.
 */

import { z } from 'zod';
import { defineMcpToolsetTools } from '../define-toolset-tool.js';
import type { CallbackTransportPort } from '../callback-transport.js';

const submitGameActionInputSchema = {
  gameId: z.string().min(1).describe('Game UUID'),
  round: z.number().int().min(1).describe('Current round number'),
  phase: z.string().min(1).describe('Current phase name (e.g. night_wolf, day_vote)'),
  seat: z.number().int().min(1).describe('Your seat number'),
  action: z.string().min(1).describe('Action type: kill/guard/divine/vote/speak/last_words'),
  target: z.number().int().min(1).optional().describe('Target seat number (for kill/guard/divine/vote)'),
  text: z.string().max(2000).optional().describe('Speech content (for speak/last_words)'),
  nonce: z.string().min(1).max(200).describe('Unique string for idempotency'),
};

export const GAME_ACTION_SERVER_FAMILY = 'collab' as const;

export function buildGameActionToolset(port: CallbackTransportPort) {
  return defineMcpToolsetTools(port, GAME_ACTION_SERVER_FAMILY, [
    {
      name: 'cat_cafe_submit_game_action',
      description:
        'Submit a game action (kill/guard/divine/vote/speak/last_words). ' +
        'Only use when you are woken up for a game phase that requires your action. ' +
        'Server validates round/phase/seat/role automatically — invalid actions are rejected. ' +
        'GOTCHA: Always include a unique nonce string for idempotency — duplicate nonces are silently deduplicated. ' +
        'GOTCHA: target is required for kill/guard/divine/vote; text is required for speak/last_words.',
      action: 'create',
      risk: { level: 'write', openWorld: false },
      inputSchema: submitGameActionInputSchema,
      resourceFamily: 'game',
      runtimeProfiles: ['full'],
      admissionRef: 'file:docs/features/game-action-runtime.md',
      sourceExport: 'handleSubmitGameAction',
      authorizationHint: 'callback-owner',
      route: {
        method: 'POST',
        path: '/api/game/${gameId}/action',
        bodyKeys: ['round', 'phase', 'seat', 'action', 'target', 'text', 'nonce'],
      },
    },
  ]);
}
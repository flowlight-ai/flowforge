/**
 * Game start/command schemas (S5-1).
 *
 * Faithful zod port of the input surfaces in clowder-ai `routes/games.ts`
 * (`seatSchema`, `gameStartSchema`) plus the `/game` command parse output, so
 * request/command bodies are validated at the boundary before reaching the
 * engine. Pure and framework-free; engine-level definitions (`GameDefinition`)
 * land with S5-2.
 * @module @flowforge/cats-games/schema
 */

import { z } from 'zod'
import { DEFAULT_PLAYER_COUNT, VALID_PLAYER_COUNTS, type ParsedGameCommand } from './command-interceptor.ts'

/** A seat in a game — structural shape validated at the API boundary. */
export const seatSchema = z.object({
  seatId: z.string().regex(/^P\d+$/),
  actorType: z.enum(['human', 'cat', 'system']),
  actorId: z.string().min(1),
  role: z.string(),
  alive: z.boolean(),
  properties: z.record(z.string(), z.unknown()).default({}),
})

/** The high-level start request consumed by POST /api/game/start. */
export const gameStartSchema = z.object({
  gameType: z.enum(['werewolf']),
  humanRole: z.enum(['player', 'god-view', 'detective']),
  playerCount: z
    .number()
    .int()
    .min(VALID_PLAYER_COUNTS[0]!)
    .max(VALID_PLAYER_COUNTS[VALID_PLAYER_COUNTS.length - 1]!)
    .default(DEFAULT_PLAYER_COUNT),
  catIds: z.array(z.string().min(1)).min(1),
  voiceMode: z.boolean().default(false),
  detectiveCatId: z.string().min(1).optional(),
})
export type GameStartInput = z.infer<typeof gameStartSchema>

/** Validated output of {@link parseGameCommand}. */
export const parsedGameCommandSchema = z.object({
  gameType: z.enum(['werewolf']),
  humanRole: z.enum(['player', 'god-view']),
  voiceMode: z.boolean(),
  playerCount: z.number().int().optional(),
  catIds: z.array(z.string().min(1)).optional(),
})

/** Narrow a runtime `ParsedGameCommand` to its validated form (or null). */
export function safeParseParsedGameCommand(
  command: ParsedGameCommand,
): ReturnType<typeof parsedGameCommandSchema.parse> | null {
  const result = parsedGameCommandSchema.safeParse(command)
  return result.success ? result.data : null
}
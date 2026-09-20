/**
 * Game Command Interceptor — pure decision surface (S5-1).
 *
 * Port of clowder-ai `game-command-interceptor.ts`. Parses `/game` chat commands
 * and builds seat assignments, free of any LLM / transport dependency so the
 * parsing and budgeting rules are unit-testable in isolation before the Werewolf
 * engine (S5-2) lands. All functions are deterministic and injected-free.
 * @module @flowforge/cats-games/command-interceptor
 */

import type { Seat } from '@flowforge/cats-shared'

/** Known game types that have engine implementations. */
export const KNOWN_GAME_TYPES = ['werewolf'] as const
export type KnownGameType = (typeof KNOWN_GAME_TYPES)[number]

/** Subcommands that should NOT be treated as game-start commands. */
export const GAME_SUBCOMMANDS = ['status', 'end'] as const

/** Valid human role values. */
export const VALID_HUMAN_ROLES = ['player', 'god-view'] as const
export type ValidHumanRole = (typeof VALID_HUMAN_ROLES)[number]

/** Valid board preset player counts (ascending). */
export const VALID_PLAYER_COUNTS = [6, 7, 8, 9, 10, 12] as const

/** Default player count used when a `/game` command omits a count. */
export const DEFAULT_PLAYER_COUNT = 7

const KNOWN_GAME_TYPE_SET = new Set<string>(KNOWN_GAME_TYPES)
const SUBCOMMAND_SET = new Set<string>(GAME_SUBCOMMANDS)
const VALID_HUMAN_ROLE_SET = new Set<string>(VALID_HUMAN_ROLES)

type PlayerCount = (typeof VALID_PLAYER_COUNTS)[number]

/** Clamp a number to the nearest valid preset player count. */
export function clampToPreset(n: number): PlayerCount {
  const min = VALID_PLAYER_COUNTS[0]!
  const max = VALID_PLAYER_COUNTS[VALID_PLAYER_COUNTS.length - 1]!
  if (n <= min) return min
  if (n >= max) return max
  // Find nearest valid preset (prefer lower if equidistant)
  let best: PlayerCount = min
  for (const preset of VALID_PLAYER_COUNTS) {
    if (preset <= n) best = preset
  }
  return best
}

/**
 * Filter `catIds` to only include IDs present in the allowed whitelist.
 * Deduplicates to prevent the same cat filling multiple seats.
 */
export function sanitizeCatIds(catIds: readonly string[], allowedIds: readonly string[]): string[] {
  const allowed = new Set(allowedIds)
  const seen = new Set<string>()
  return catIds.filter((id) => {
    if (!allowed.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Parsed `/game` start command, ready to be fed to the engine. */
export interface ParsedGameCommand {
  gameType: KnownGameType
  humanRole: ValidHumanRole
  voiceMode: boolean
  /** Player count from lobby config; undefined = use default */
  playerCount?: number
  /** Specific cat IDs from lobby config; undefined = use all cats */
  catIds?: string[]
}

/**
 * Parse a `/game` command from a chat message.
 * Returns null if the message is not a valid `/game` start command.
 *
 * Format: /game <type> <role> [<playerCount>] [<catIds>] [voice]
 * Examples:
 *   /game werewolf player
 *   /game werewolf player 9
 *   /game werewolf player 9 opus,sonnet,codex,gpt52,spark,gemini,gemini25
 *   /game werewolf god-view 7 opus,sonnet,codex voice
 */
export function parseGameCommand(content: string): ParsedGameCommand | null {
  const trimmed = content.trim()
  const lower = trimmed.toLowerCase()
  if (!lower.startsWith('/game ') && lower !== '/game') return null

  const parts = trimmed.split(/\s+/)
  // Need at least: /game <type> <role>
  if (parts.length < 3) return null

  const gameType = parts[1]!.toLowerCase()

  // Reject subcommands like /game status, /game end
  if (SUBCOMMAND_SET.has(gameType)) return null

  // Reject unknown game types
  if (!KNOWN_GAME_TYPE_SET.has(gameType)) return null

  const humanRole = parts[2]!.toLowerCase()
  if (!VALID_HUMAN_ROLE_SET.has(humanRole)) return null

  // Parse remaining parts: [playerCount] [catIds] [voice]
  let playerCount: number | undefined
  let catIds: string[] | undefined
  let voiceMode = false

  for (let i = 3; i < parts.length; i++) {
    const part = parts[i]!.toLowerCase()
    if (part === 'voice') {
      voiceMode = true
    } else if (/^\d+$/.test(part)) {
      playerCount = clampToPreset(parseInt(part, 10))
    } else if (!catIds) {
      // First non-voice, non-digit token = catIds (single or comma-separated)
      catIds = part.split(',').filter(Boolean)
    }
  }

  const result: ParsedGameCommand = {
    gameType: gameType as KnownGameType,
    humanRole: humanRole as ValidHumanRole,
    voiceMode,
  }
  // exactOptionalPropertyTypes: only set optional keys when present
  if (playerCount !== undefined) result.playerCount = playerCount
  if (catIds) result.catIds = catIds
  return result
}

/** Inputs required to build seat assignments for a game. */
export interface BuildSeatsInput {
  humanRole: 'player' | 'god-view' | 'detective'
  userId: string
  catIds: readonly string[]
  playerCount: number
}

/**
 * Build seat assignments for a game.
 *
 * - player mode: P1 = human, P2..Pn = cats
 * - god-view / detective mode: all seats are cats (human observes)
 *
 * Throws when there are not enough unique cats — each seat must have a unique
 * actor, so no seat duplication is allowed.
 */
export function buildGameSeats(input: BuildSeatsInput): Seat[] {
  const { humanRole, userId, catIds, playerCount } = input

  // Enforce minimum cat count — no seat duplication allowed
  const catSlotsNeeded = humanRole === 'player' ? playerCount - 1 : playerCount
  if (catIds.length < catSlotsNeeded) {
    throw new Error(
      `Not enough cats: need ${catSlotsNeeded} but got ${catIds.length}. Each seat must have a unique actor.`,
    )
  }

  const seats: Seat[] = []

  if (humanRole === 'player') {
    // P1 = human player
    seats.push({
      seatId: 'P1',
      actorType: 'human',
      actorId: userId,
      role: '',
      alive: true,
      properties: {},
    })
    // P2..Pn = AI cats (cycle if needed)
    for (let i = 1; i < playerCount; i++) {
      const catId = catIds[(i - 1) % catIds.length]!
      seats.push({
        seatId: `P${i + 1}`,
        actorType: 'cat',
        actorId: catId,
        role: '',
        alive: true,
        properties: {},
      })
    }
  } else {
    // god-view: all seats are cats
    for (let i = 0; i < playerCount; i++) {
      const catId = catIds[i % catIds.length]!
      seats.push({
        seatId: `P${i + 1}`,
        actorType: 'cat',
        actorId: catId,
        role: '',
        alive: true,
        properties: {},
      })
    }
  }

  return seats
}
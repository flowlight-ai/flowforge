import { describe, it, expect } from 'vitest'
import {
  parseGameCommand,
  sanitizeCatIds,
  buildGameSeats,
  clampToPreset,
  DEFAULT_PLAYER_COUNT,
  VALID_HUMAN_ROLES,
  KNOWN_GAME_TYPES,
} from '../src/command-interceptor.ts'

/** Unit tests for the `/game` command parser. */
describe('parseGameCommand', () => {
  it('parses the minimal /game werewolf player form', () => {
    const out = parseGameCommand('/game werewolf player')
    expect(out).toEqual({
      gameType: 'werewolf',
      humanRole: 'player',
      voiceMode: false,
      playerCount: undefined,
      catIds: undefined,
    })
  })

  it('handles "/game" without a trailing space', () => {
    // Bare "/game" is not a start command (too few parts) -> null
    expect(parseGameCommand('/game')).toBeNull()
  })

  it('parses playerCount and clamps to a valid preset', () => {
    const out = parseGameCommand('/game werewolf player 9')
    expect(out?.playerCount).toBe(9)
    // 11 is clamped down to the nearest preset (10)
    expect(parseGameCommand('/game werewolf player 11')?.playerCount).toBe(10)
    // 3 is clamped up to the minimum preset (6)
    expect(parseGameCommand('/game werewolf player 3')?.playerCount).toBe(6)
  })

  it('parses a comma-separated cat list and a voice flag', () => {
    const out = parseGameCommand('/game werewolf god-view 7 opus,sonnet,codex voice')
    expect(out).toEqual({
      gameType: 'werewolf',
      humanRole: 'god-view',
      voiceMode: true,
      playerCount: 7,
      catIds: ['opus', 'sonnet', 'codex'],
    })
  })

  it('is case-insensitive for type/role/voice', () => {
    const out = parseGameCommand('/GAME WEREWOLF Player VOICE')
    expect(out?.gameType).toBe('werewolf')
    expect(out?.humanRole).toBe('player')
    expect(out?.voiceMode).toBe(true)
  })

  it('rejects subcommands status/end', () => {
    expect(parseGameCommand('/game status')).toBeNull()
    expect(parseGameCommand('/game end')).toBeNull()
  })

  it('rejects unknown game types and human roles', () => {
    expect(parseGameCommand('/game mafia player')).toBeNull()
    expect(parseGameCommand('/game werewolf observer')).toBeNull()
  })

  it('rejects non-game messages', () => {
    expect(parseGameCommand('hello world')).toBeNull()
    expect(parseGameCommand('')).toBeNull()
    expect(parseGameCommand('   ')).toBeNull()
  })
})

/** Unit tests for cat allow-list sanitization. */
describe('sanitizeCatIds', () => {
  const allowed = ['opus', 'sonnet', 'codex']

  it('keeps allowed ids in order', () => {
    expect(sanitizeCatIds(['codex', 'opus'], allowed)).toEqual(['codex', 'opus'])
  })

  it('drops disallowed ids', () => {
    expect(sanitizeCatIds(['opus', 'gpt52', 'sonnet'], allowed)).toEqual(['opus', 'sonnet'])
  })

  it('deduplicates so one cat fills at most one seat', () => {
    expect(sanitizeCatIds(['opus', 'opus', 'codex', 'opus'], allowed)).toEqual(['opus', 'codex'])
  })
})

/** Unit tests for seat assignment building. */
describe('buildGameSeats', () => {
  it('player mode: P1 is human, P2..Pn are cats', () => {
    const seats = buildGameSeats({
      humanRole: 'player',
      userId: 'u-1',
      catIds: ['opus', 'sonnet', 'codex'],
      playerCount: 4,
    })
    expect(seats).toHaveLength(4)
    expect(seats[0]).toMatchObject({ seatId: 'P1', actorType: 'human', actorId: 'u-1', alive: true })
    expect(seats[1]).toMatchObject({ seatId: 'P2', actorType: 'cat', actorId: 'opus', alive: true })
    expect(seats[3]).toMatchObject({ seatId: 'P4', actorType: 'cat', actorId: 'codex', alive: true })
  })

  it('god-view mode: every seat is a cat (human observes)', () => {
    const seats = buildGameSeats({
      humanRole: 'god-view',
      userId: 'u-1',
      catIds: ['opus', 'sonnet'],
      playerCount: 2,
    })
    expect(seats.map((s) => s.actorType)).toEqual(['cat', 'cat'])
    expect(seats[0]!.actorId).toBe('opus')
    expect(seats[1]!.actorId).toBe('sonnet')
  })

  it('detective mode behaves like god-view (all cats)', () => {
    const seats = buildGameSeats({
      humanRole: 'detective',
      userId: 'u-1',
      catIds: ['codex'],
      playerCount: 1,
    })
    expect(seats[0]).toMatchObject({ seatId: 'P1', actorType: 'cat', actorId: 'codex' })
  })

  it('exact-fit god-view: each cat occupies a distinct seat', () => {
    const seats = buildGameSeats({
      humanRole: 'god-view',
      userId: 'u-1',
      catIds: ['a', 'b', 'c'],
      playerCount: 3,
    })
    expect(seats.map((s) => s.actorId)).toEqual(['a', 'b', 'c'])
  })

  it('throws when player mode lacks enough cats to avoid seat duplication', () => {
    // player mode with 8 seats needs 7 cats; only 2 provided
    expect(() =>
      buildGameSeats({ humanRole: 'player', userId: 'u-1', catIds: ['a', 'b'], playerCount: 8 }),
    ).toThrow(/Not enough cats/)
  })

  it('throws when god-view lacks enough cats', () => {
    expect(() =>
      buildGameSeats({ humanRole: 'god-view', userId: 'u-1', catIds: ['a'], playerCount: 3 }),
    ).toThrow(/Not enough cats/)
  })
})

/** Unit tests for the player-count clamp helper. */
describe('clampToPreset', () => {
  it('returns exact presets untouched', () => {
    expect(clampToPreset(6)).toBe(6)
    expect(clampToPreset(12)).toBe(12)
  })

  it('clamps below the minimum and above the maximum', () => {
    expect(clampToPreset(1)).toBe(6)
    expect(clampToPreset(99)).toBe(12)
  })
})

/** Surface sanity: exported constants stay internally consistent. */
describe('exports', () => {
  it('exposes the game-type/human-role vocabularies', () => {
    expect(KNOWN_GAME_TYPES).toEqual(['werewolf'])
    expect(VALID_HUMAN_ROLES).toEqual(['player', 'god-view'])
  })

  it('exposes a default player count within the valid presets', () => {
    expect(DEFAULT_PLAYER_COUNT).toBeGreaterThanOrEqual(6)
    expect(DEFAULT_PLAYER_COUNT).toBeLessThanOrEqual(12)
  })
})
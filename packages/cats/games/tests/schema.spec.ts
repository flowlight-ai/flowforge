import { describe, it, expect } from 'vitest'
import { gameStartSchema, parsedGameCommandSchema, seatSchema, safeParseParsedGameCommand } from '../src/schema.ts'
import { parseGameCommand } from '../src/command-interceptor.ts'

/** Unit tests for the game-start request schema. */
describe('gameStartSchema', () => {
  it('accepts a minimal start input with defaults applied', () => {
    const out = gameStartSchema.parse({ gameType: 'werewolf', humanRole: 'player', catIds: ['opus'] })
    expect(out.playerCount).toBe(7)
    expect(out.voiceMode).toBe(false)
  })

  it('rejects an unknown game type', () => {
    expect(() =>
      gameStartSchema.parse({ gameType: 'mafia', humanRole: 'player', catIds: ['opus'] }),
    ).toThrow()
  })

  it('rejects a playerCount outside the valid range', () => {
    expect(() =>
      gameStartSchema.parse({ gameType: 'werewolf', humanRole: 'player', playerCount: 4, catIds: ['opus'] }),
    ).toThrow()
  })

  it('rejects an empty cat list', () => {
    expect(() =>
      gameStartSchema.parse({ gameType: 'werewolf', humanRole: 'player', catIds: [] }),
    ).toThrow()
  })
})

/** Unit tests for the parsed `/game` command output schema. */
describe('parsedGameCommandSchema / safeParseParsedGameCommand', () => {
  it('validates a well-formed parsed command', () => {
    const command = parseGameCommand('/game werewolf player 9 opus,sonnet voice')
    expect(command).not.toBeNull()
    expect(parsedGameCommandSchema.safeParse(command).success).toBe(true)
  })

  it('rejects a malformed parsed command (unknown human role)', () => {
    const malformed = {
      gameType: 'werewolf',
      humanRole: 'observer',
      voiceMode: false,
    }
    expect(parsedGameCommandSchema.safeParse(malformed).success).toBe(false)
  })

  it('safeParseParsedGameCommand narrows to validated data or null', () => {
    const good = parseGameCommand('/game werewolf player')
    expect(safeParseParsedGameCommand(good!)).toMatchObject({ gameType: 'werewolf', humanRole: 'player' })

    const bad = { gameType: 'mafia', humanRole: 'player', voiceMode: false }
    expect(safeParseParsedGameCommand(bad as never)).toBeNull()
  })
})

/** Unit tests for the seat shape schema. */
describe('seatSchema', () => {
  it('accepts a conforming seat and defaults properties', () => {
    const seat = seatSchema.parse({ seatId: 'P1', actorType: 'human', actorId: 'u-1', role: 'villager', alive: true })
    expect(seat.properties).toEqual({})
  })

  it('rejects an invalid seat id', () => {
    expect(() =>
      seatSchema.parse({ seatId: 'x1', actorType: 'human', actorId: 'u-1', role: '', alive: true }),
    ).toThrow()
  })
})
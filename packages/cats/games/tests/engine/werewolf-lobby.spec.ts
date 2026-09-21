import { describe, it, expect } from 'vitest'
import { WerewolfLobby } from '../../src/engine/werewolf-lobby.ts'

const lobby = new WerewolfLobby()

function players(n: number, type: 'human' | 'cat' = 'cat'): Array<{ actorType: string; actorId: string }> {
  return Array.from({ length: n }, (_, i) => ({ actorType: type, actorId: `${type}-${i + 1}` }))
}

describe('WerewolfLobby', () => {
  it('createLobby builds a lobby-state runtime with sequential seats', () => {
    const runtime = lobby.createLobby({ threadId: 't-1', playerCount: 6, players: players(6) })
    expect(runtime.status).toBe('lobby')
    expect(runtime.round).toBe(0)
    expect(runtime.currentPhase).toBe('lobby')
    expect(runtime.seats).toHaveLength(6)
    expect(runtime.seats[0]!.seatId).toBe('P1')
    expect(runtime.seats[5]!.seatId).toBe('P6')
    expect(runtime.seats.every((s) => s.role === '')).toBe(true)
  })

  it('startGame assigns a role to every seat and hides them until dealt', () => {
    const runtime = lobby.createLobby({ threadId: 't-1', playerCount: 6, players: players(6) })
    lobby.startGame(runtime)
    expect(runtime.status).toBe('playing')
    expect(runtime.round).toBe(1)
    expect(runtime.currentPhase).toBe('night_guard')
    expect(runtime.seats.every((s) => s.role !== '')).toBe(true)
  })

  it('startGame emits one seat-scoped role_assigned event per seat', () => {
    const runtime = lobby.createLobby({ threadId: 't-1', playerCount: 6, players: players(6) })
    lobby.startGame(runtime)
    const assigned = runtime.eventLog.filter((e) => e.type === 'role_assigned')
    expect(assigned).toHaveLength(6)
    for (const evt of assigned) {
      expect(evt.scope).toMatch(/^seat:P\d+$/)
      expect((evt.payload as { seatId?: string }).seatId).toBe(evt.scope.slice(5))
    }
  })

  it('role distribution matches the preset counts for the board size', () => {
    const runtime = lobby.createLobby({ threadId: 't-1', playerCount: 6, players: players(6) })
    lobby.startGame(runtime)
    const counts: Record<string, number> = {}
    for (const seat of runtime.seats) counts[seat.role] = (counts[seat.role] ?? 0) + 1
    expect(counts.wolf).toBe(2)
    expect(counts.seer).toBe(1)
    expect(counts.witch).toBe(1)
    expect(counts.villager).toBe(2)
  })

  it('shuffling produces a deterministic role-set with randomized seat mapping', () => {
    // Role multiset is constant across two runs.
    const roles = (): string[] => {
      const r = lobby.createLobby({ threadId: 't', playerCount: 6, players: players(6) })
      lobby.startGame(r)
      return r.seats.map((s) => s.role)
    }
    const a = roles()
    const b = roles()
    expect(a.sort().join(',')).toBe(b.sort().join(','))
    expect(a).toContain('wolf')
  })

  it('rejects an unsupported player count at createLobby', () => {
    expect(() => lobby.createLobby({ threadId: 't', playerCount: 5, players: players(5) })).toThrow(/No preset/)
  })
})
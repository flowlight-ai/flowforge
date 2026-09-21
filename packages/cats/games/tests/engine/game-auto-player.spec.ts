import { describe, it, expect, vi } from 'vitest'
import { GameAutoPlayer } from '../../src/engine/game-auto-player.ts'
import { GameOrchestrator } from '../../src/engine/game-orchestrator.ts'
import type { GameWerewolfAIPlayer } from '../../src/llm/ai-player.ts'
import type { GameRuntime } from '@flowforge/cats-shared'
import { InMemoryGameStore, makeRuntime, RecordingSocket } from './game.helpers.ts'

function setup(seed: GameRuntime[], opts: { aiPlayerFactory?: (catId: string) => GameWerewolfAIPlayer | null } = {}) {
  const store = new InMemoryGameStore(seed)
  const socket = new RecordingSocket()
  const orchestrator = new GameOrchestrator({ gameStore: store, socketManager: socket })
  const ap = new GameAutoPlayer({ gameStore: store, orchestrator, aiPlayerFactory: opts.aiPlayerFactory })
  return { store, socket, orchestrator, ap }
}

describe('GameAutoPlayer', () => {
  it('recoverActiveGames starts loops for playing games only', async () => {
    const playing = makeRuntime({ gameId: 'g-playing', roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf' })
    const finished = makeRuntime({ gameId: 'g-finished', roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'day_exile', status: 'finished' })
    const { ap } = setup([playing, finished])
    const count = await ap.recoverActiveGames()
    expect(count).toBe(1)
    expect(ap.isLoopActive('g-playing')).toBe(true)
    ap.stopAllLoops()
    expect(ap.isLoopActive('g-playing')).toBe(false)
  })

  it('startLoop on a finished game exits without acting', async () => {
    const finished = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'day_exile', status: 'finished' })
    const { ap } = setup([finished])
    ap.startLoop('g-1')
    expect(ap.isLoopActive('g-1')).toBe(true)
    // Loop reads the finished runtime and returns promptly.
    await vi.waitFor(() => expect(ap.isLoopActive('g-1')).toBe(false))
  })

  it('drives cat wolves to submit night actions via random fallback', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf' })
    const { ap } = setup([r])
    ap.startLoop('g-1')

    // Both cat wolves (P1, P2) build random kill actions → action.submitted events.
    await vi.waitFor(
      () => {
        const submits = r.eventLog.filter((e) => e.type === 'action.submitted').length
        expect(submits).toBeGreaterThanOrEqual(1)
      },
      { timeout: 4000, interval: 200 },
    )
    ap.stopAllLoops()
  })

  it('stopAllLoops clears active loops and aborts in-flight loops', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf' })
    const { ap } = setup([r])
    ap.startLoop('g-1')
    expect(ap.isLoopActive('g-1')).toBe(true)
    ap.stopAllLoops()
    expect(ap.isLoopActive('g-1')).toBe(false)
  })

  it('startLoop is idempotent for the same game', async () => {
    const r = makeRuntime({ roles: ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'], currentPhase: 'night_wolf' })
    const { ap } = setup([r])
    ap.startLoop('g-1')
    ap.startLoop('g-1') // no-op
    ap.stopAllLoops()
    expect(ap.isLoopActive('g-1')).toBe(false)
  })
})
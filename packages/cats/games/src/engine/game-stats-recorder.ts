/**
 * Game stats recorder (S5-2c).
 *
 * Faithful, dependency-free port of clowder-ai `GameStatsRecorder.ts` trimmed to
 * the post-game report the {@link GameViewBuilder} attaches to a finished view.
 * Action counts (kill/divine/save) are derived from the `action.submitted` event
 * log the orchestrator emits, and an MVP is chosen from the winning side by
 * impact score. Pure — reads a finished `GameRuntime` only.
 * @module @flowforge/cats-games/engine/game-stats-recorder
 */

import type { GameResultStats, GameRuntime } from '@flowforge/cats-shared'

/** Build a post-game `GameResultStats` report from a finished runtime. */
export function extractDetailedStats(runtime: GameRuntime): GameResultStats {
  const winner = runtime.winner ?? 'unknown'
  const factionMap = new Map<string, string>()
  for (const roleDef of runtime.definition.roles) {
    factionMap.set(roleDef.name, roleDef.faction)
  }

  // Count actions per seat from the orchestrator's action.submitted events.
  const killCounts = new Map<string, number>()
  const saveCounts = new Map<string, number>()
  const divineCounts = new Map<string, number>()

  for (const event of runtime.eventLog) {
    if (event.type !== 'action.submitted') continue
    const payload = event.payload as { seatId?: string; actionName?: string }
    const seatId = payload.seatId
    if (!seatId) continue

    switch (payload.actionName) {
      case 'kill':
        killCounts.set(seatId, (killCounts.get(seatId) ?? 0) + 1)
        break
      case 'heal':
        saveCounts.set(seatId, (saveCounts.get(seatId) ?? 0) + 1)
        break
      case 'divine':
        divineCounts.set(seatId, (divineCounts.get(seatId) ?? 0) + 1)
        break
      default:
        break
    }
  }

  const players = runtime.seats.map((seat) => {
    const faction = factionMap.get(seat.role) ?? 'unknown'
    return {
      seatId: seat.seatId,
      actorId: seat.actorId,
      role: seat.role,
      faction,
      survived: seat.alive,
      won: faction === winner,
      killCount: killCounts.get(seat.seatId) ?? 0,
      savedCount: saveCounts.get(seat.seatId) ?? 0,
      divineCount: divineCounts.get(seat.seatId) ?? 0,
    }
  })

  // MVP: highest impact score on the winning side.
  const winningPlayers = players.filter((p) => p.won)
  let mvpSeatId = winningPlayers[0]?.seatId ?? players[0]?.seatId ?? 'P1'
  let mvpScore = -1
  let mvpReason = '存活到最后'

  for (const p of winningPlayers) {
    const score = p.killCount + p.savedCount * 2 + p.divineCount
    if (score > mvpScore) {
      mvpScore = score
      mvpSeatId = p.seatId
      if (p.killCount > 0) mvpReason = `击杀 ${p.killCount} 人`
      else if (p.savedCount > 0) mvpReason = `救治 ${p.savedCount} 人`
      else if (p.divineCount > 0) mvpReason = `查验 ${p.divineCount} 人`
    }
  }

  // If no winning player had actions, fall back to a surviving winner.
  if (mvpScore <= 0 && winningPlayers.length > 0) {
    const survivor = winningPlayers.find((p) => p.survived) ?? winningPlayers[0]
    if (survivor) {
      mvpSeatId = survivor.seatId
      mvpReason = '存活到最后'
    }
  }

  return {
    winner,
    rounds: runtime.round,
    duration: runtime.updatedAt - runtime.createdAt,
    mvpSeatId,
    mvpReason,
    players,
  }
}
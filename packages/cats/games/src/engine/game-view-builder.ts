/**
 * Game view builder (S5-2c).
 *
 * Faithful port of clowder-ai `game/GameViewBuilder.ts`. Builds a scoped, read-only
 * `GameView` from a `GameRuntime` for a specific viewer (`SeatId`, `'god'`, or
 * `detective:<seatId>`), applying role/faction masking and event visibility +
 * revealPolicy filtering. Pure — never mutates the runtime. The clowder display-name
 * enrichment (catRegistry) is replaced by an injectable `displayName` hint (default
 * identity) so the builder stays dependency-free.
 * @module @flowforge/cats-games/engine/game-view-builder
 */

import type { ActionStatus, EventScope, GameEvent, GameRuntime, GameView, PendingAction, SeatId, SeatView } from '@flowforge/cats-shared'
import { extractDetailedStats } from './game-stats-recorder.ts'

/** Injectable display-name enrichment for actor ids (default: identity). */
export interface BuildViewOptions {
  displayName?: (actorId: string) => string
}

/** Builds scoped `GameView` snapshots from a live game runtime. */
export class GameViewBuilder {
  /** Build a scoped view for a specific viewer. viewer: SeatId, 'god', or 'detective:Pn'. */
  static buildView(runtime: GameRuntime, viewer: SeatId | 'god' | `detective:${string}`, opts?: BuildViewOptions): GameView {
    const displayName = opts?.displayName ?? ((id: string): string => id)
    const isGod = viewer === 'god'
    const isDetective = typeof viewer === 'string' && viewer.startsWith('detective:')
    const boundSeatId = isDetective ? (viewer.slice(10) as SeatId) : undefined
    // Detective inherits bound seat's perspective; player sees own seat.
    const effectiveSeatId = boundSeatId ?? (isGod ? undefined : (viewer as SeatId))
    const viewerSeat = effectiveSeatId ? runtime.seats.find((s) => s.seatId === effectiveSeatId) : undefined
    // Dead players/bound-seats lose faction visibility (no faction leak after death).
    const viewerFaction = viewerSeat?.alive
      ? runtime.definition.roles.find((r) => r.name === viewerSeat.role)?.faction
      : undefined

    // Filter events by visibility + revealPolicy.
    const visibleEvents = runtime.eventLog.filter((e) => {
      // Scope check
      if (!isGod && !GameViewBuilder.isVisible(e.scope, effectiveSeatId as SeatId, viewerFaction)) {
        return false
      }
      // revealPolicy check (god always sees everything)
      if (!isGod && e.revealPolicy) {
        if (!GameViewBuilder.isRevealed(e, runtime)) return false
      }
      return true
    })

    // Build seat views with role masking.
    const seats: SeatView[] = runtime.seats.map((seat) => {
      const seatRole = runtime.definition.roles.find((r) => r.name === seat.role)
      const showRole =
        isGod ||
        seat.seatId === effectiveSeatId || // see own/bound seat's role
        (viewerFaction && seatRole?.faction === viewerFaction) // see faction mates

      // hasActed is sensitive during night phases — only god/detective or own seat can see it.
      const isPublicPhase = runtime.currentPhase?.startsWith('day_') ?? false
      const canSeeActed = isGod || isDetective || seat.seatId === effectiveSeatId || isPublicPhase

      const pending = runtime.pendingActions[seat.seatId] as PendingAction | undefined

      const sv: SeatView = {
        seatId: seat.seatId,
        actorType: seat.actorType,
        actorId: seat.actorId,
        displayName: displayName(seat.actorId),
        alive: seat.alive,
      }
      if (canSeeActed) sv.hasActed = !!pending

      // God view: expose per-seat actionStatus only for seats expected to act.
      if (isGod && seat.alive) {
        const phaseDef = runtime.definition.phases.find((p) => p.name === runtime.currentPhase)
        const actingRole = phaseDef?.actingRole
        const shouldAct = actingRole === '*' || (actingRole != null && seat.role === actingRole)
        if (shouldAct) {
          sv.actionStatus = (pending?.status as ActionStatus | undefined) ?? 'waiting'
        }
      }

      if (showRole) {
        sv.role = seat.role
        if (seatRole?.faction) sv.faction = seatRole.faction
      }
      return sv
    })

    const view: GameView = {
      gameId: runtime.gameId,
      threadId: runtime.threadId,
      gameType: runtime.gameType,
      status: runtime.status,
      currentPhase: runtime.currentPhase,
      round: runtime.round,
      seats,
      visibleEvents,
      config: {
        timeoutMs: runtime.config.timeoutMs,
        voiceMode: runtime.config.voiceMode,
        humanRole: runtime.config.humanRole,
        ...(runtime.config.humanSeat ? { humanSeat: runtime.config.humanSeat } : {}),
        ...(runtime.config.detectiveSeatId ? { detectiveSeatId: runtime.config.detectiveSeatId } : {}),
      },
    }
    if (runtime.phaseStartedAt !== undefined) view.phaseStartedAt = runtime.phaseStartedAt
    if (runtime.winner) view.winner = runtime.winner

    // Aggregate action progress (non-god views only — god has per-seat detail).
    if (!isGod) {
      const phaseDef = runtime.definition.phases.find((p) => p.name === runtime.currentPhase)
      if (phaseDef) {
        const actingRole = phaseDef.actingRole
        const expectedSeats =
          actingRole === '*'
            ? runtime.seats.filter((s) => s.alive)
            : runtime.seats.filter((s) => s.alive && s.role === actingRole)
        view.totalExpected = expectedSeats.length
        view.submittedCount = expectedSeats.filter((s) => !!runtime.pendingActions[s.seatId]).length
      }
    }

    // Attach detailed stats when the game is finished.
    if (runtime.status === 'finished') {
      view.gameStats = extractDetailedStats(runtime)
    }

    return view
  }

  /** Check if an event's revealPolicy allows it to be shown to a non-god viewer. */
  private static isRevealed(event: GameEvent, runtime: GameRuntime): boolean {
    if (!event.revealPolicy || event.revealPolicy === 'live') return true
    if (event.revealPolicy === 'phase_end') {
      // Events from prior rounds are always revealed (phase names recur across rounds).
      if (event.round < runtime.round) return true
      // Same round: visible only if current phase is different from the event's phase.
      return runtime.currentPhase !== event.phase
    }
    if (event.revealPolicy === 'game_end') {
      return runtime.status === 'finished'
    }
    return true
  }

  private static isVisible(scope: EventScope, viewer: SeatId, viewerFaction?: string): boolean {
    if (scope === 'public') return true
    if (scope === 'god' || scope === 'judge') return false
    if (scope === `seat:${viewer}`) return true
    if (viewerFaction && scope === `faction:${viewerFaction}`) return true
    return false
  }
}
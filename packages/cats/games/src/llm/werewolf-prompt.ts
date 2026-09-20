/**
 * Werewolf role-specific system prompts (S5-2a).
 *
 * Faithful port of clowder-ai `werewolf/werewolf-prompts.ts` — pure string
 * builders that shape context-aware prompts for AI cat players. Each role sees
 * only the information it should know, derived from a scoped `GameView`.
 * No LLM/IO involvement; fully deterministic and unit-testable.
 * @module @flowforge/cats-games/llm/werewolf-prompt
 */

import type { GameView } from '@flowforge/cats-shared'

/**
 * Build the system prompt for an AI player of the given `role` from a scoped
 * game view at a given round. Delegates per-role to a role section builder.
 */
export function buildWerewolfPrompt(role: string, view: GameView, round: number): string {
  const base = buildBaseContext(view, round)
  const roleSection = buildRoleSection(role, view)
  return `${base}\n\n${roleSection}`
}

/** Shared context: round, current phase, alive/dead seats and visible events. */
export function buildBaseContext(view: GameView, round: number): string {
  const aliveSeats = view.seats.filter((s) => s.alive)
  const deadSeats = view.seats.filter((s) => !s.alive)

  let ctx = `You are playing Werewolf (狼人杀). Round ${round}, phase: ${view.currentPhase}.\n`
  ctx += `Alive players: ${aliveSeats.map((s) => s.seatId).join(', ')}\n`
  if (deadSeats.length > 0) {
    ctx += `Dead players: ${deadSeats.map((s) => s.seatId).join(', ')}\n`
  }

  if (view.visibleEvents.length > 0) {
    ctx += '\nEvents you can see:\n'
    for (const e of view.visibleEvents) {
      ctx += `- [R${e.round}/${e.phase}] ${e.type}: ${JSON.stringify(e.payload)}\n`
    }
  }

  return ctx
}

/** Dispatch to the role-specific section builder, defaulting to villager. */
export function buildRoleSection(role: string, view: GameView): string {
  switch (role) {
    case 'wolf':
      return buildWolfPrompt(view)
    case 'seer':
      return buildSeerPrompt(view)
    case 'witch':
      return buildWitchPrompt(view)
    case 'guard':
      return buildGuardPrompt(view)
    case 'hunter':
      return buildHunterPrompt()
    case 'idiot':
      return buildIdiotPrompt()
    default:
      return buildVillagerPrompt()
  }
}

function buildWolfPrompt(view: GameView): string {
  const teammates = view.seats.filter((s) => s.faction === 'wolf' && s.alive).map((s) => s.seatId)

  let prompt = 'Your role: wolf (狼人). You kill a villager each night.\n'
  prompt += `Your wolf teammates: ${teammates.join(', ')}\n`
  prompt += 'During the day, blend in and avoid suspicion. Vote to exile village-aligned players.\n'
  prompt += 'At night, choose a target to kill (not a wolf teammate).'
  return prompt
}

function buildSeerPrompt(view: GameView): string {
  let prompt = 'Your role: seer (预言家). Each night you divine one player to learn their faction.\n'

  const divineResults = view.visibleEvents.filter((e) => e.type === 'divine_result')
  if (divineResults.length > 0) {
    prompt += 'Your divine results:\n'
    for (const e of divineResults) {
      prompt += `- ${e.payload.target}: ${e.payload.result}\n`
    }
  }

  prompt += 'Use your knowledge to guide the village. Be strategic about revealing information.'
  return prompt
}

function buildWitchPrompt(view: GameView): string {
  let prompt = 'Your role: witch (女巫). You have one heal potion and one poison potion.\n'

  const notifications = view.visibleEvents.filter((e) => e.type === 'witch_notification')
  if (notifications.length > 0) {
    const latest = notifications[notifications.length - 1]
    prompt += `Tonight's knife victim: ${latest?.payload?.knifedPlayer ?? 'unknown'}\n`
  }

  prompt += 'You can heal the knifed player or poison someone (but not both in one night).'
  return prompt
}

function buildGuardPrompt(view: GameView): string {
  let prompt = 'Your role: guard (守卫). Each night you protect one player from the wolf kill.\n'
  prompt += 'You cannot protect the same player two nights in a row.\n'

  const guardEvents = view.visibleEvents.filter((e) => e.type === 'guard_protect')
  if (guardEvents.length > 0) {
    const last = guardEvents[guardEvents.length - 1]
    prompt += `Last night you guarded: ${last?.payload?.target ?? 'unknown'}`
  }

  return prompt
}

function buildHunterPrompt(): string {
  return (
    'Your role: hunter (猎人). If you die from a wolf kill or exile, you can shoot one player.\n' +
    'If poisoned by the witch, you cannot shoot. Choose your shot wisely.'
  )
}

function buildIdiotPrompt(): string {
  return (
    'Your role: idiot (白痴). If voted out during the day, you survive but lose voting rights.\n' +
    'Play carefully — you can help the village by drawing votes away from key roles.'
  )
}

function buildVillagerPrompt(): string {
  return (
    'Your role: villager (村民). You have no special abilities.\n' +
    'Use discussion and voting to help the village identify and exile wolves.'
  )
}
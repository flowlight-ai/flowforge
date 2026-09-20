/**
 * Werewolf AI player adapter (S5-2a).
 *
 * Faithful port of clowder-ai `werewolf/WerewolfAIPlayer.ts`. Receives a scoped
 * `GameView`, builds a role-specific prompt via {@link buildWerewolfPrompt}, and
 * calls the injected {@link GameAIProvider} for structured actions and free-form
 * speech. LLM output is validated through {@link assertAIActionResponse} before
 * it is shaped into a domain `GameAction`.
 * @module @flowforge/cats-games/llm/ai-player
 */

import type { GameAction, GameView } from '@flowforge/cats-shared'
import { assertAIActionResponse, type AIActionResponse, type GameAIProvider } from './ai-provider.ts'
import { buildWerewolfPrompt } from './werewolf-prompt.ts'

/** Injection point: an AI player is constructed around a {@link GameAIProvider}. */
export class GameWerewolfAIPlayer {
  constructor(private readonly provider: GameAIProvider) {}

  /** Decide a night action (kill/guard/divine/heal/shoot) for a role. */
  async decideNightAction(seatId: string, role: string, view: GameView, round: number): Promise<GameAction> {
    const prompt = buildWerewolfPrompt(role, view, round)
    const actionPrompt = `${prompt}\n\nChoose your night action. Return a JSON with actionName and targetSeat.`

    const response = assertAIActionResponse(
      await this.provider.generateAction(actionPrompt, {
        type: 'object',
        properties: {
          actionName: { type: 'string' },
          targetSeat: { type: 'string' },
        },
        required: ['actionName', 'targetSeat'],
      }),
    )

    return toGameAction(seatId, response)
  }

  /** Produce a free-form discussion speech line for a seated player. */
  async decideSpeech(seatId: string, role: string, view: GameView, round: number): Promise<string> {
    const prompt = buildWerewolfPrompt(role, view, round)
    const speechPrompt = `${prompt}\n\nIt is the discussion phase. Give a brief speech (1-3 sentences) as ${seatId}.`

    return this.provider.generateSpeech(speechPrompt)
  }

  /** Decide a daytime exile vote for a seated player. */
  async decideVote(seatId: string, role: string, view: GameView, round: number): Promise<GameAction> {
    const prompt = buildWerewolfPrompt(role, view, round)
    const votePrompt = `${prompt}\n\nChoose who to vote for exile. Return a JSON with actionName "vote" and targetSeat.`

    const response = assertAIActionResponse(
      await this.provider.generateAction(votePrompt, {
        type: 'object',
        properties: {
          actionName: { type: 'string', const: 'vote' },
          targetSeat: { type: 'string' },
        },
        required: ['actionName', 'targetSeat'],
      }),
    )

    return toGameAction(seatId, response)
  }

  /** Speech + delivery kind (audio when voice mode is on), for message dispatch. */
  async decideSpeechWithFormat(
    seatId: string,
    role: string,
    view: GameView,
    round: number,
    voiceMode: boolean,
  ): Promise<{ kind: 'audio' | 'text'; text: string; seatId: string }> {
    const text = await this.decideSpeech(seatId, role, view, round)
    return { kind: voiceMode ? 'audio' : 'text', text, seatId }
  }
}

/** Shape a validated AI action response into a domain `GameAction`. */
function toGameAction(seatId: string, response: AIActionResponse): GameAction {
  const action: GameAction = {
    seatId: seatId as `P${number}`,
    actionName: response.actionName,
    submittedAt: Date.now(),
  }
  if (response.targetSeat) {
    action.targetSeat = response.targetSeat as `P${number}`
  }
  return action
}
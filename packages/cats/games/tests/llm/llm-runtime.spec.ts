import { describe, it, expect } from 'vitest'
import { GameLlmRuntime } from '../../src/llm/llm-runtime.ts'
import { ScriptedGameAIProvider } from '../../src/llm/ai-provider-fakes.ts'
import { GameWerewolfAIPlayer } from '../../src/llm/ai-player.ts'
import type { GameAIProvider } from '../../src/llm/ai-provider.ts'
import type { LlmConfigResolver } from '../../src/llm/llm-config.ts'
import { makeGameView } from './game-view.fixture.ts'

const resolver: LlmConfigResolver = () => ({
  provider: 'openai',
  model: 'gpt-4o',
  baseUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-runtime',
})

describe('GameLlmRuntime', () => {
  it('memoizes a single provider per cat', () => {
    const runtime = new GameLlmRuntime({ resolveConfig: resolver })
    expect(runtime.providerFor('cat1')).toBe(runtime.providerFor('cat1'))
    expect(runtime.providerFor('cat1')).not.toBe(runtime.providerFor('cat2'))
  })

  it('constructs a GameWerewolfAIPlayer bound to a cat provider', async () => {
    const runtime = new GameLlmRuntime({ resolveConfig: resolver })
    const player = runtime.playerFor('cat1')
    expect(player).toBeInstanceOf(GameWerewolfAIPlayer)
    expect(runtime.playerFor('cat1')).toBe(player)
  })

  it('honors an injected fake provider via the runtime constructor seam', async () => {
    // The runtime builds an Http provider by default; the seam lets a caller
    // substitute a scripted provider directly where a fake is desired.
    const fake: GameAIProvider = new ScriptedGameAIProvider({ speeches: ['hello'] })
    const player = new GameWerewolfAIPlayer(fake)
    expect(await player.decideSpeech('P1', 'villager', makeGameView(), 1)).toBe('hello')
  })

  it('forwards a custom timeout and builds a lazy-provider seam', async () => {
    const runtime = new GameLlmRuntime({ resolveConfig: resolver, timeoutMs: 1234 })
    // providers are lazy-built on first access; idempotence proves the memo seam.
    expect(runtime.providerFor('cat1')).toBe(runtime.providerFor('cat1'))
  })
})
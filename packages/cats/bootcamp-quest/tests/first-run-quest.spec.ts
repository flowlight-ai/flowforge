import { describe, expect, it } from 'vitest'
import {
  detectAvailableClients,
  getInstalledClients,
  getCliSpecsForTest,
  type ExistsOnPath,
} from '../src/client-detection.ts'
import {
  buildCollaborationPrompt,
  buildCompletionBlock,
  buildErrorEncounteredBlock,
  buildQuestTaskSelectionBlock,
  QUEST_TASKS,
} from '../src/quest-blocks.ts'
import { createInitialQuestState, QUEST_PHASES, validateQuestTransition } from '../src/quest-state.ts'

describe('client-detection', () => {
  it('registers all five CLI specs without version probes', () => {
    const specs = getCliSpecsForTest()
    expect(specs.map((s) => s.client)).toEqual(['claude', 'codex', 'opencode', 'gemini', 'kimi'])
    expect(specs).toHaveLength(5)
  })

  it('detects availability via the injected probe', async () => {
    const existsOnPath: ExistsOnPath = async (cli) => cli === 'claude' || cli === 'codex'
    const results = await detectAvailableClients({ existsOnPath })
    const installed = results.filter((r) => r.installed).map((r) => r.cli)
    expect(installed).toEqual(['claude', 'codex'])
    const claude = results.find((r) => r.cli === 'claude')
    expect(claude?.client).toBe('claude')
    expect(claude?.provider).toBe('anthropic')
  })

  it('a throwing probe never propagates (treated as not installed)', async () => {
    const existsOnPath: ExistsOnPath = async () => {
      throw new Error('probe boom')
    }
    const results = await detectAvailableClients({ existsOnPath })
    expect(results.every((r) => r.installed === false)).toBe(true)
  })

  it('getInstalledClients filters to installed only', async () => {
    const existsOnPath: ExistsOnPath = async (cli) => cli === 'gemini'
    const installed = await getInstalledClients({ existsOnPath })
    expect(installed.map((r) => r.cli)).toEqual(['gemini'])
  })
})

describe('quest-blocks', () => {
  it('builds a task selection block from QUEST_TASKS', () => {
    const block = buildQuestTaskSelectionBlock('thread-1')
    expect(block.id).toBe('quest-task-select-thread-1')
    expect(block.interactiveType).toBe('card-grid')
    expect(block.options.map((o) => o.id)).toEqual(QUEST_TASKS.map((t) => t.id))
    expect(block.allowRandom).toBe(true)
  })

  it('builds error/collaboration/completion helpers', () => {
    const err = buildErrorEncounteredBlock('Alpha')
    expect(err.options).toHaveLength(2)
    expect(buildCollaborationPrompt('Beta', 'Alpha')).toBe('@Beta 你来帮忙看看 Alpha 刚才写的代码，有没有问题？')
    const done = buildCompletionBlock()
    expect(done.kind).toBe('card')
    expect(done.actions).toHaveLength(2)
  })
})

describe('quest-state', () => {
  it('createInitialQuestState starts at welcome phase v1', () => {
    const s = createInitialQuestState()
    expect(s.v).toBe(1)
    expect(s.phase).toBe('quest-0-welcome')
    expect(typeof s.startedAt).toBe('number')
  })

  it('validateQuestTransition is forward-only', () => {
    const next = validateQuestTransition('quest-0-welcome', 'quest-1-create-first-cat')
    expect(next).toBe('quest-1-create-first-cat')
    expect(validateQuestTransition('quest-1-create-first-cat', 'quest-0-welcome')).toBeNull()
    expect(validateQuestTransition('quest-1-create-first-cat', 'quest-1-create-first-cat')).toBeNull()
    expect(validateQuestTransition('quest-9-completion', 'quest-9-completion')).toBeNull()
  })

  it('allows skipping forward to completion', () => {
    expect(validateQuestTransition('quest-1-create-first-cat', 'quest-9-completion')).toBe('quest-9-completion')
  })

  it('rejects unknown/duplicate phases', () => {
    expect(validateQuestTransition('quest-0-welcome', 'bogus' as never)).toBeNull()
    expect(QUEST_PHASES).toHaveLength(10)
  })
})
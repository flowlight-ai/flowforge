import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  evaluate,
  resetDedup,
  shouldTrigger,
  type EvaluateInput,
  type FrustrationDetectorDeps,
  type FrustrationSignal,
  type FrustrationStoreMessage,
  type IFrustrationIssueStore,
  type IMessageStore,
} from '../src/frustration-detector.ts'
import type { CreateFrustrationIssueInput, FrustrationIssue } from '../src/frustration-types.ts'
import { detectRetryBurst } from '../src/retry-burst-detector.ts'
import { detectTextFrustration } from '../src/text-frustration-keywords.ts'

describe('shouldTrigger', () => {
  it('triggers on allowlisted cli_error codes', () => {
    expect(shouldTrigger({ type: 'cli_error', diagnostics: { reasonCode: 'auth_failed' } })).toBe(true)
  })

  it('does not trigger on excluded or unknown codes / missing code', () => {
    expect(shouldTrigger({ type: 'cli_error', diagnostics: { reasonCode: 'upstream_policy_reject' } })).toBe(false)
    expect(shouldTrigger({ type: 'cli_error', diagnostics: { reasonCode: 'unknown_xyz' } })).toBe(false)
    expect(shouldTrigger({ type: 'cli_error', diagnostics: {} })).toBe(false)
  })

  it('triggers cancel_burst only at threshold within window', () => {
    const now = Date.now()
    const denials = Array.from({ length: 3 }, (_, i) => ({ action: `a${i}`, timestamp: now - 10_000 }))
    expect(shouldTrigger({ type: 'cancel_burst', recentDenials: denials })).toBe(true)
    expect(shouldTrigger({ type: 'cancel_burst', recentDenials: denials.slice(0, 2) })).toBe(false)
    const stale = { action: 'a', timestamp: now - CANCEL_WINDOW_MS - 1 }
    const mixed = [...denials.slice(0, 2), stale]
    expect(shouldTrigger({ type: 'cancel_burst', recentDenials: mixed })).toBe(false)
  })

  it('text_frustration requires threshold matches', () => {
    expect(shouldTrigger({ type: 'text_frustration', matchedKeywords: ['不对'], matchCount: 2, recentUserMessages: [] })).toBe(true)
    expect(shouldTrigger({ type: 'text_frustration', matchedKeywords: ['不对'], matchCount: 1, recentUserMessages: [] })).toBe(false)
  })

  it('a2a_timeout triggers at >= 60s, retry_burst at >= 3, user_report always', () => {
    expect(shouldTrigger({ type: 'a2a_timeout', targetCatId: 'gpt-pro', elapsedMs: 60_000 })).toBe(true)
    expect(shouldTrigger({ type: 'a2a_timeout', targetCatId: 'gpt-pro', elapsedMs: 100 })).toBe(false)
    expect(shouldTrigger({ type: 'retry_burst', matchCount: 3, repeatedPrefix: 'x' })).toBe(true)
    expect(shouldTrigger({ type: 'retry_burst', matchCount: 2, repeatedPrefix: 'x' })).toBe(false)
    expect(shouldTrigger({ type: 'user_report', toolName: 'bash' })).toBe(true)
  })
})

describe('detectRetryBurst', () => {
  it('matches full-content repeats and respects threshold', () => {
    const msg = 'pls run the test suite again'
    const recent = ['pls run the test suite again', 'pls run the test suite again', msg]
    const result = detectRetryBurst(msg, recent)
    expect(result.matched).toBe(true)
    expect(result.matchCount).toBe(3)
    expect(result.repeatedPrefix).toBe('pls run the test suite again')
  })

  it('does not match divergent A2A review messages (bugfix)', () => {
    const msg = '@codex review round 4 please'
    const recent = ['@codex review round 1 please', '@codex review round 2 please', '@codex review round 3 please']
    expect(detectRetryBurst(msg, recent).matched).toBe(false)
  })

  it('skips too-short or empty messages', () => {
    expect(detectRetryBurst('', ['a']).matched).toBe(false)
    expect(detectRetryBurst('ok', ['ok', 'ok', 'ok']).matched).toBe(false)
    expect(detectRetryBurst('hello', []).matched).toBe(false)
  })
})

describe('detectTextFrustration', () => {
  it('triggers when >= 2 messages in window contain keywords', () => {
    const result = detectTextFrustration(['这个不对', '怎么又错了', '正常'])
    expect(result.matched).toBe(true)
    expect(result.matchCount).toBe(2)
    expect(result.matchedKeywords).toContain('不对')
    expect(result.matchedKeywords).toContain('错了')
  })

  it('single-instance match is not enough (AC-B3)', () => {
    expect(detectTextFrustration(['这个不对']).matched).toBe(false)
  })

  it('honours a custom keyword override', () => {
    const result = detectTextFrustration(['foo', 'foo again'], ['foo'])
    expect(result.matched).toBe(true)
  })
})

describe('evaluate pipeline', () => {
  const makeIssueStore = (): IFrustrationIssueStore => ({
    create: async (input: CreateFrustrationIssueInput) => {
      const issue: FrustrationIssue = {
        issueId: 'fi-1',
        status: 'draft',
        threadId: input.threadId,
        userId: input.userId,
        catId: input.catId,
        signalType: input.signalType,
        signalDetail: input.signalDetail,
        context: input.context,
        createdAt: Date.now(),
      }
      return issue
    },
    setCardMessageId: async () => {},
  })

  const makeMessageStore = (): IMessageStore => ({
    getByThread: async () => [],
    append: async (input: {
      userId: string
      catId: string | null
      threadId: string
      content: string
      mentions: string[]
      timestamp: number
      source: Record<string, unknown>
      extra?: Record<string, unknown>
    }) => {
      const m: FrustrationStoreMessage = {
        id: 'msg-1',
        content: input.content,
        timestamp: input.timestamp,
      }
      return m
    },
  })

  let stores: IFrustrationIssueStore
  let msgs: IMessageStore
  let broadcast: (room: string, event: string, payload: unknown) => void

  beforeEach(() => {
    resetDedup()
    stores = makeIssueStore()
    msgs = makeMessageStore()
    broadcast = vi.fn()
  })

  const buildDeps = (): FrustrationDetectorDeps => ({
    frustrationIssueStore: stores,
    messageStore: msgs,
    socketManager: { broadcastToRoom: broadcast },
  })

  it('creates an issue when a trigger fires', async () => {
    const signal: FrustrationSignal = { type: 'cli_error', diagnostics: { reasonCode: 'auth_failed', publicSummary: 'Auth' } }
    const input: EvaluateInput = { signal, threadId: 't1', userId: 'u1', catId: 'gpt-pro' }
    const issue = await evaluate(input, buildDeps())
    expect(issue).not.toBeNull()
    expect(issue?.signalType).toBe('cli_error')
    expect(broadcast).toHaveBeenCalled()
  })

  it('dedups the same (thread, signalType) within the window', async () => {
    const deps = buildDeps()
    const signal: FrustrationSignal = { type: 'cli_error', diagnostics: { reasonCode: 'quota_exceeded' } }
    const input: EvaluateInput = { signal, threadId: 't1', userId: 'u1', catId: 'gpt-pro' }
    await evaluate(input, deps)
    const second = await evaluate(input, deps)
    expect(second).toBeNull()
  })

  it('skips user_report dedup but always triggers', async () => {
    const deps = buildDeps()
    const signal: FrustrationSignal = { type: 'user_report', toolName: 'bash' }
    const input: EvaluateInput = { signal, threadId: 't2', userId: 'u1', catId: 'gpt-pro' }
    await evaluate(input, deps)
    const second = await evaluate(input, deps)
    expect(second).not.toBeNull()
  })

  it('returns null when threshold is not met', async () => {
    const signal: FrustrationSignal = { type: 'a2a_timeout', targetCatId: 'gpt-pro', elapsedMs: 1 }
    const issue = await evaluate({ signal, threadId: 't3', userId: 'u1', catId: 'gpt-pro' }, buildDeps())
    expect(issue).toBeNull()
  })
})

const CANCEL_WINDOW_MS = 60_000
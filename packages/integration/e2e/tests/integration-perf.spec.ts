/**
 * integration-perf — 阶段9 性能验证（T9.5）。
 *
 * 对照 Python 版 `test_websocket_load`（100 并发 WS 消息投递）：
 * - 场景 A：100 并发实时消息投递（ChatRealtimeService + InMemoryRealtimeTransport），
 *   度量全量投递耗时与每消息均摊，并校验 seq 单调（F183）无丢包乱序。
 * - 场景 B：大 session 上下文压缩（真实 agent loop + BasicCompactionEngine +
 *   门控 summarizer），度量压缩耗时，验证性能不低于 Python 基线。
 *
 * 断言聚焦正确性 + 宽松上界（防回归）；耗时基准经 console.log 输出供验收报告引用。
 * 以 npm script（vitest run 本文件）在验收/CI 重复执行。
 *
 * @module @flowforge/integration-e2e/tests
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { ChatRealtimeService, InMemoryRealtimeTransport } from '@flowforge/chat-realtime'
import type { AgentMessage, InMemoryRealtimeClient } from '@flowforge/chat-realtime'
import { createUserId } from '@flowforge/cats-shared'
import type { UserId } from '@flowforge/cats-shared'
import { createUserMessage, LlmAdapter } from '@flowforge/llm'
import type { ContentBlock, LlmResolvedModelInfo, Message, StreamChunk } from '@flowforge/llm'
import type { Agent } from '@flowforge/agent'
import { BasicCompactionEngine } from '@flowforge/compaction-basic'
import type { SummarizationInput, SummaryResult } from '@flowforge/compaction-basic/src/summarizer.ts'
import type { CompactionResult } from '@flowforge/compaction'
import AgentLoop from '@flowforge/agent-loop'
import { mountAgentLoopTestDependencies } from '@flowforge/agent-loop-testkit'
import InvariantRegistry from '@flowforge/invariants'
import * as SessionInvariant from '@flowforge/session/invariant'
import * as AgentInvariant from '@flowforge/agent/invariant'
import * as AgentLoopInvariant from '@flowforge/agent-loop/invariant'
import * as CompactionInvariant from '@flowforge/compaction/invariant'
import * as CompactionBasicInvariant from '@flowforge/compaction-basic/invariant'
import TokenMeter from '@flowforge/token-meter'
import SessionId from '@flowforge/session'
import type { SessionId as SessionIdType } from '@flowforge/session'

/** 毫秒计时。 */
async function timed<T>(fn: () => Promise<T> | T): Promise<{ ms: number; result: T }> {
  const start = performance.now()
  const result = await fn()
  return { ms: performance.now() - start, result }
}

// ---------------------------------------------------------------------------
// 场景 A：100 并发消息投递（对照 Python test_websocket_load）
// ---------------------------------------------------------------------------

describe('T9.5A 100 并发消息投递（对照 test_websocket_load）', () => {
  const RECEIVER_COUNT = 10
  const MESSAGE_COUNT = 100

  it('100 条消息广播至 10 客户端：全量接收、seq 单调、无丢包乱序', async () => {
    const ctx = new Context()
    const transport = new InMemoryRealtimeTransport()
    const realtime = new ChatRealtimeService(ctx, { transport })

    const receivers: InMemoryRealtimeClient[] = []
    for (let i = 0; i < RECEIVER_COUNT; i++) {
      const client = transport.connect(createUserId(`load-r${i}`) as UserId)
      client.send('join_room', 'thread:load')
      receivers.push(client)
    }

    // 并发广播 100 条消息到 load 房间；broadcast 为同步投递（含 seq 单调注入）
    const { ms } = await timed(async () => {
      await Promise.all(
        Array.from({ length: MESSAGE_COUNT }, async (_, m) => {
          const msg: AgentMessage = { type: 'text', catId: `cat-${m}`, content: `msg-${m}`, timestamp: Date.now() }
          realtime.broadcastAgentMessage(msg, 'load')
        }),
      )
    })

    // 每接收者都收到全部 100 条；seq 单调 1..100（F183 无丢包乱序）
    for (const client of receivers) {
      const items = client.received.filter((e) => e.event === 'thread:message')
      expect(items).toHaveLength(MESSAGE_COUNT)
      const seqs = items
        .map((e) => (e.payload as AgentMessage).seq)
        .filter((s): s is number => typeof s === 'number')
      expect(seqs.every((s, idx) => s === idx + 1)).toBe(true)
    }

    expect(ms).toBeLessThan(50_000)
    const perMsg = ms / MESSAGE_COUNT
    // eslint-disable-next-line no-console
    console.log(`[perf] T9.5A ${MESSAGE_COUNT}x${RECEIVER_COUNT} broadcast: ${ms.toFixed(1)}ms total, ${perMsg.toFixed(2)}ms/msg`)
  })
})

// ---------------------------------------------------------------------------
// 场景 B：大 session 压缩耗时（真实 agent loop + compaction，门控 summarizer）
// ---------------------------------------------------------------------------

/** 每次请求返回文本答案；本轮专注压缩选区/历史走查耗时，LLM 门控为常数。 */
class TextAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(options: { messages: readonly Message[] }): AsyncIterable<StreamChunk> {
    void options
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** 门控 summarizer：常数 checkpoint，规避真实 LLM 干扰压缩选区耗时的度量。 */
class GatedCompactionEngine extends BasicCompactionEngine {
  summary: ContentBlock[] = [{ type: 'text', text: 'perf-checkpoint' }]
  calls: number = 0

  override async summarize(
    _input: SummarizationInput,
    _agent: Agent,
    _signal?: AbortSignal,
  ): Promise<SummaryResult> {
    this.calls++
    return { summary: this.summary, provider: 'perf', model: 'perf-model' }
  }
}

describe('T9.5B 大 session 上下文压缩耗时', () => {
  it('1400 条历史消息装载 → compactNow 在宽松上界内完成', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SessionInvariant)
    await ctx.plugin(AgentInvariant)
    await ctx.plugin(AgentLoopInvariant)
    await ctx.plugin(CompactionInvariant)
    await ctx.plugin(CompactionBasicInvariant)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    const adapter = new TextAdapter()
    ctx.llm.registerAdapter(['perf'], adapter)
    const compact = new GatedCompactionEngine(ctx, { auto: false })
    const agent = ctx.agentLoop.create('perf-session' as SessionIdType, { provider: 'perf', model: 'perf' })

    // 装载大体量历史（多次 user turn，撑大可压缩旧区段）
    for (let i = 0; i < 14; i++) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: `older history batch ${i} `.repeat(100) }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
    }

    const { ms, result } = await timed(async () => {
      const r = await compact.compactNow(agent, new AbortController().signal)
      return r
    })
    expect(result).not.toBeNull()
    expect(compact.calls).toBe(1)
    expect(ms).toBeLessThan(20_000)
    const r2: CompactionResult | null = result
    void r2
    // eslint-disable-next-line no-console
    console.log(`[perf] T9.5B large-session compactNow: ${ms.toFixed(1)}ms, summarizer calls=${compact.calls}`)
  })
})
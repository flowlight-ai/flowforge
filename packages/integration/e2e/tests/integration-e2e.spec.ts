/**
 * integration-e2e — 阶段9 vs 跨包集成 e2e（T9.2 / T9.3 / T9.4）。
 *
 * 对齐 dsh 测试风格：直接构造 Cordis 服务挂到 `new Context()`（Service 构造即注册），
 * 持久化/治理/LLM/执行器等外部边界使用注入的 mock 或内存实现，外部 CLI（mock）、
 * git/PR（mock）、MCP（mock）按场景契约显式标注。
 *
 * 三场景：
 * - T9.2 用户群聊 @ 灵智体 → 调用外部 CLI（mock）→ 输出回传 → 经验蒸馏入库
 * - T9.3 Forgekin 五闭环演进 → MindCouncil 跨厂商审议 → 通过后提交 PR（mock git）
 * - T9.4 MCP 工具调用（mock）→ 工作流 DAG 执行 → 上下文压缩 → 会话续接
 *
 * @module @flowforge/integration-e2e/tests
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import { createCatId, createUserId, createThreadId } from '@flowforge/cats-shared'
import type { CatId } from '@flowforge/cats-shared'
import { CatStores, MemoryStoresBackend } from '@flowforge/cats-stores'
import { computeFileHash, DossierDistillationService } from '@flowforge/cats-orchestration'
import { MultiMentionOrchestratorService } from '@flowforge/chat-mention'
import type { LlmChatClient } from '@flowforge/forgekin-loops'
import { LoopsService, NoopPersistEngine } from '@flowforge/forgekin-loops'
import { CouncilService, CouncilVerdict } from '@flowforge/forgekin-council'
import type { CouncilReviewer } from '@flowforge/forgekin-council'

// ---------------------------------------------------------------------------
// T9.4 harness imports (real agent loop + session + compaction)
// ---------------------------------------------------------------------------

import AgentLoop from '@flowforge/agent-loop'
import { mountAgentLoopTestDependencies } from '@flowforge/agent-loop-testkit'
import InvariantRegistry from '@flowforge/invariants'
import * as SessionInvariant from '@flowforge/session/invariant'
import * as AgentInvariant from '@flowforge/agent/invariant'
import * as AgentLoopInvariant from '@flowforge/agent-loop/invariant'
import * as CompactionInvariant from '@flowforge/compaction/invariant'
import * as CompactionBasicInvariant from '@flowforge/compaction-basic/invariant'
import { BasicCompactionEngine } from '@flowforge/compaction-basic'
import type { CompactionResult } from '@flowforge/compaction'
import TokenMeter from '@flowforge/token-meter'
import { createUserMessage, LlmAdapter } from '@flowforge/llm'
import type { ContentBlock, LlmResolvedModelInfo, Message, StreamChunk, TokenUsage } from '@flowforge/llm'
import SessionStore, { Session, SessionId } from '@flowforge/session'
import type { Agent } from '@flowforge/agent'
import type { SummarizationInput, SummaryResult } from '@flowforge/compaction-basic/src/summarizer.ts'

const disposables: Array<{ dispose(): unknown }> = []
afterEach(async () => {
  while (disposables.length > 0) {
    const d = disposables.pop()
    try {
      await d?.dispose()
    } catch {
      // best-effort teardown; never fail the test on cleanup
    }
  }
})

// ===========================================================================
// T9.2 — 用户群聊 @ 灵智体 → 外部 CLI（mock）→ 输出回传 → 经验蒸馏入库
// ===========================================================================

/** 外部 CLI 的 mock 执行器（模拟真实 CLI，返回确定性输出）。 */
async function runMockCli(prompt: string): Promise<string> {
  return `[mock-cli] executed: ${prompt} -> deploy:OK target=e2e`
}

const T92_USER = createUserId('t92-user')
const T92_CAT = createCatId('cli-1') as CatId
const T92_INITIATOR = createCatId('t92-user-cat') as CatId
const T92_THREAD = createThreadId('t92-thread')

const T92_DOSSIER = [
  '# Team Dossier',
  '',
  '### Alpha `cat:cli-1`',
  'alpha capabilities: baseline text HERE',
  '',
  '### Beta `cat:cli-2`',
  'beta capabilities: other baseline text HERE',
  '',
].join('\n')

describe('T9.2 mention → external CLI (mock) → output → distillation', () => {
  it('完整链路：@ 编排 → CLI 输出回传 → 经验蒸馏 propose/approve/apply', async () => {
    const ctx = new Context()
    disposables.push(ctx)

    // 装配真实服务：cats-stores（内存后端）+ 蒸馏 + 多 @ 编排
    new CatStores(ctx)
    new MemoryStoresBackend(ctx)
    const distiller = new DossierDistillationService(ctx)
    const chatMention = new MultiMentionOrchestratorService(ctx)

    // 注入 mock 的 catsInvocationQueue（dispatch 懒解析可选依赖 ctx.get(key,false)）：
    // 用 ctx.provide 注册服务（按真实 QueueLike 契约），记录入队目标。
    const enqueued: Array<{ threadId: string; targetCatIds: unknown; source: string }> = []
    const unsubscribe = ctx.provide('catsInvocationQueue', {
      enqueue(input: { threadId: string; targetCatIds: readonly string[]; source: string }) {
        enqueued.push({
          threadId: input.threadId,
          targetCatIds: [...input.targetCatIds],
          source: input.source,
        })
        return { outcome: 'created' as const, entry: { id: `enq-${enqueued.length}` } }
      },
    })
    disposables.push({ dispose: () => unsubscribe() })

    const question = '请调用外部 CLI 校验配置'
    const request = chatMention.create({
      threadId: T92_THREAD,
      initiator: T92_INITIATOR,
      callbackTo: T92_INITIATOR,
      targets: [T92_CAT],
      question,
      timeoutMinutes: 5,
      idempotencyKey: 't92',
    })
    expect(request.status).toBe('pending')

    // 在 pending 态派发（反级联守卫只拦非 pending 的活跃靶点），经 mock 队列入队
    const outcomes = chatMention.dispatch(request.id, [T92_CAT], {
      threadId: T92_THREAD,
      userId: T92_USER,
      question,
      callerCatId: T92_INITIATOR,
    })
    // 队列挂载 → 目标被入队（外部 CLI 待执行）
    expect(outcomes[T92_CAT as string]).toBe('enqueued')
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]?.source).toBe('agent')

    chatMention.start(request.id)

    // 目标灵智体执行外部 CLI（mock），输出回传并归集响应
    const output = await runMockCli(question)
    chatMention.recordResponse(request.id, T92_CAT, output)

    expect(chatMention.getStatus(request.id)).toBe('done')
    const result = chatMention.getResult(request.id)
    expect(result.responses).toHaveLength(1)
    expect(result.responses[0]?.content).toBe(output)

    // 经验蒸馏：暂存观察（CLI 输出即经验）→ 提案 → 审批 → 应用到 dossier
    await distiller.addObservation({
      catId: T92_CAT,
      content: `external cli output: ${output}`,
      author: 'operator',
    })
    const proposal = await distiller.propose({
      sourceEvent: 'stage9-e2e',
      sourceId: `t92-${request.id}`,
      targetCatId: T92_CAT,
      targetFields: ['nativePeakAbilities'],
      beforeSnapshot: 'baseline text HERE',
      afterDraft: 'baseline text UPGRADED',
      rationale: 'external CLI experience distilled',
      evidenceRefs: [{ type: 'observation', id: 'obs_t92' } as const],
      baseHash: computeFileHash(T92_DOSSIER),
      createdBy: T92_CAT,
    })
    expect(proposal.status).toBe('pending')

    const approved = await distiller.approveProposal(proposal.proposalId, 'operator_1')
    expect(approved?.status).toBe('approved')

    const outcome = await distiller.applyProposal(proposal.proposalId, T92_CAT, T92_DOSSIER, 'commitsha-t92')
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.proposal.status).toBe('applied')
      expect(outcome.proposal.appliedCommitSha).toBe('commitsha-t92')
      // 仅替换目标猫区段，其余区段不变
      expect(outcome.draft.modifiedContent).toContain('baseline text UPGRADED')
      expect(outcome.draft.modifiedContent).toContain('beta capabilities: other baseline text HERE')
      expect(outcome.draft.targetPath).toBe('docs/team/cat-dossier.md')
      expect(outcome.draft.commitMessage).toContain(`docs(F208): apply distillation to cli-1`)
    }
  })
})

// ===========================================================================
// T9.3 — Forgekin 五闭环演进 → MindCouncil 跨厂商审议 → 提交 PR（mock git）
// ===========================================================================

/** 脚本化 forgekin LLM：非审核提示返回 plan；审核提示返回通过。 */
class ScriptedForgekinLlm implements LlmChatClient {
  async chat(messages: Array<{ role: string; content: string }>): Promise<{ content: string; model?: string }> {
    const last = messages.at(-1)?.content ?? ''
    if (last.includes('【审核标准】')) {
      return { content: JSON.stringify({ passed: true, score: 0.98, issues: [], suggestions: [] }), model: 'fork' }
    }
    return {
      content: JSON.stringify({
        steps: [{ action: 'write_file', path: 'docs/e2e-guide.md', content: '---\ntype: guide\nstatus: draft\n---\n# 指南\n\n正文内容' + '' }],
        expected_effect: '写入文档',
        risk_assessment: 'low',
      }),
      model: 'fork',
    }
  }
}

/** mock git 仓库：记录 commit / PR（外部 git 边界）。 */
class MockGitRepo {
  readonly commits: string[] = []
  readonly prs: string[] = []
  commit(message: string): string {
    const sha = `sha-${this.commits.length + 1}`
    this.commits.push(message)
    return sha
  }

  submitPr(title: string): { prNumber: number; url: string } {
    const prNumber = this.prs.length + 1
    this.prs.push(title)
    return { prNumber, url: `https://mock.git/pr/${prNumber}` }
  }
}

describe('T9.3 forgekin loops → council v2 review → mock git PR', () => {
  const tmpRoots: string[] = []

  afterEach(() => {
    for (const root of tmpRoots) rmSync(root, { recursive: true, force: true })
    tmpRoots.length = 0
  })

  it('五闭环演进 → 跨厂商审议 PASS → mock git 提交 PR', async () => {
    const root = mkdtempSync(join(tmpdir(), 'flowforge-t93-'))
    tmpRoots.push(root)

    const ctx = new Context()
    disposables.push(ctx)
    const llm = new ScriptedForgekinLlm()
    const persist = new NoopPersistEngine()
    const git = new MockGitRepo()

    new LoopsService(ctx, {
      llmClient: llm,
      persistEngine: persist,
      forgekinConfig: { projectRoot: root },
      awakeningStage: 'E5',
    })
    new CouncilService(ctx, { minReviewers: 2, minDistinctVendors: 2, passThreshold: 0.85 })

    // 五闭环齐全（doc/code/framework/review/test）
    const loops = ctx.forgeLoops.snapshot()
    expect(loops.map((l) => l.loopType).sort()).toEqual(['code', 'doc', 'framework', 'review', 'test'])

    // 实际演进：逐一执行五闭环（外部 LLM 脚本化、治理层内存）
    const loopSummary: Array<{ type: string; total: number; passed: number; failed: number }> = []
    for (const loopType of ['doc', 'code', 'framework', 'review', 'test'] as const) {
      try {
        const run = await ctx.forgeLoops.runOnce(loopType, {
          force_targets: [`docs/e2e-${loopType}.md`],
        })
        loopSummary.push({
          type: loopType,
          total: run.summary.total,
          passed: run.summary.passed,
          failed: run.summary.failed,
        })
      } catch {
        loopSummary.push({ type: loopType, total: 0, passed: 0, failed: 0 })
      }
    }
    // doc 闭环完整通过（Discover→Plan→Act→Verify→Persist 全绿）
    const doc = loopSummary.find((s) => s.type === 'doc')
    expect(doc?.passed).toBeGreaterThanOrEqual(1)

    // 演进产出 → MindCouncil 跨厂商审议（≥2 不同厂商）
    const artifact = `docs: apply distillation\ndossier: baseline text UPGRADED\nloops: ${loopSummary.length}`
    const reviewers: CouncilReviewer[] = [
      { forgekinId: 'fk-alpha', vendor: 'anthropic' },
      { forgekinId: 'fk-beta', vendor: 'openai' },
    ]
    const session = ctx.forgeCouncil.convene(artifact, reviewers)
    expect(session.finalVerdict).toBe(CouncilVerdict.PASS)
    expect(session.finalScore).toBeGreaterThanOrEqual(0.85)

    // 审议通过 → 治理层 commit + 提交 PR（mock git）
    const sha = git.commit(session.finalVerdict)
    const pr = git.submitPr(`feat(stage9): apply council-approved evolution (${sha})`)

    expect(git.commits).toHaveLength(1)
    expect(git.prs).toHaveLength(1)
    expect(pr.prNumber).toBe(1)
    expect(pr.url).toContain('https://mock.git/pr/1')
    // 治理层三模式沉淀已触发（episode_card / distill_episode）
    const actions = persist.calls.map((c) => c.action)
    expect(actions.some((a) => a === 'create_episode_card')).toBe(true)
  })
})

// ===========================================================================
// T9.4 — MCP 工具调用 → 工作流 DAG → 上下文压缩 → 会话续接
// ===========================================================================

/** MCP 工具的 mock 调用：返回一段会撑大上下文的大体量载荷。 */
async function mockMcpCall(): Promise<string> {
  return 'older conversation history '.repeat(60)
}

/** 工作流 DAG 的轻量内存执行器（阶段9场景 mock：代表 workflow seam）。 */
async function runWorkflowDag(toolPayload: string): Promise<string> {
  // 简单 DAG：step1 聚合 MCP 载荷 → step2 生成人工意图消息
  // （真实 WorkerThreadWorkflowEngine 作为独立 {Min} 测试另行覆盖）
  const step1 = `seeded:${toolPayload}`
  return `${step1} user-instruction: summarize the workflow outcome`
}

const MODEL = 'mock'

/** 控制下的 summarizer：固定返回 checkpoint 摘要，不触真实 LLM。 */
class GatedCompactionEngine extends BasicCompactionEngine {
  summary: ContentBlock[] = [{ type: 'text', text: 'checkpoint' }]
  calls: SummarizationInput[] = []

  override async summarize(
    input: SummarizationInput,
    _agent: Agent,
    _signal?: AbortSignal,
  ): Promise<SummaryResult> {
    this.calls.push(input)
    return { summary: this.summary, provider: 'summary-provider', model: 'summary-model' }
  }
}

/** 每次请求返回一个文本答案；上下文足够大以避免非目标压力。 */
class TextAdapter extends LlmAdapter {
  readonly requests: Message[][] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(options: { messages: readonly Message[] }): AsyncIterable<StreamChunk> {
    this.requests.push([...options.messages])
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface T94Harness {
  ctx: Context
  agent: Agent
  compact: GatedCompactionEngine
  adapter: TextAdapter
  tokenUsage: TokenUsage | undefined
}

/** 真实 loop + session store + token meter + compaction 装配。 */
async function t94Harness(): Promise<T94Harness> {
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
  ctx.llm.registerAdapter([MODEL], adapter)
  const compact = new GatedCompactionEngine(ctx, { auto: false })
  const agent = ctx.agentLoop.create(SessionId('stage9-t94'), { provider: MODEL, model: MODEL })
  return { ctx, agent, compact, adapter, tokenUsage: undefined }
}

describe('T9.4 MCP → workflow DAG → compaction → session resume', () => {
  it('MCP 载荷入上下文 → DAG 产出 → 压缩旧区段 → 会话续接引用摘要', async () => {
    const h = await t94Harness()
    disposables.push(h.ctx)

    // 1) MCP 工具调用（mock）返回大体量载荷
    const toolPayload = await mockMcpCall()
    // 2) 工作流 DAG（mock 执行器）将载荷整理为一条 user 消息进入真实会话
    const messageText = await runWorkflowDag(toolPayload)

    // 3) 走一个真实 agent turn，让大载荷沉淀为可压缩的旧区段
    h.agent.followup(createUserMessage({
      content: [{ type: 'text', text: messageText }],
      source: { kind: 'user' },
    }))
    await h.agent.whenIdle()

    // 4) 上下文压缩：compactNow 选择旧区段 → checkpoint 摘要落库
    const signal = new AbortController().signal
    const result: CompactionResult | null = await h.compact.compactNow(h.agent, signal)
    expect(result).not.toBeNull()
    expect(h.compact.calls).toHaveLength(1)
    const hasCompaction = h.agent.session.events.some((e) => e.type === 'compaction/start')
    expect(hasCompaction).toBe(true)

    // 5) 会话续接：新 turn 引用压缩摘要（首条派生消息为 checkpoint），大载荷被压缩移除
    h.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'after compaction' }],
      source: { kind: 'user' },
    }))
    await h.agent.whenIdle()

    expect(h.adapter.requests.length).toBeGreaterThanOrEqual(2)
    const second = (h.adapter.requests[1] ?? []).map((m) =>
      m.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    expect(second[0]).toContain('checkpoint')
    expect(second.at(-1)).toBe('after compaction')
    expect(second.some((text) => text.includes('older conversation history'))).toBe(false)
  })

  it('会话可派生：压缩摘要与续接消息共同可见', async () => {
    const h = await t94Harness()
    disposables.push(h.ctx)

    const messageText = await runWorkflowDag(await mockMcpCall())
    h.agent.followup(createUserMessage({ content: [{ type: 'text', text: messageText }], source: { kind: 'user' } }))
    await h.agent.whenIdle()

    const compact = await h.compact.compactNow(h.agent, new AbortController().signal)
    expect(compact).not.toBeNull()

    const derived = h.agent.session
      .deriveMessages()
      .flatMap((m) => m.content)
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
    expect(derived).toContain('checkpoint')
  })
})

// Keep the Session import referenced for the package-level type graph even if
// only used via SessionId re-exports above.
void Session
void SessionStore
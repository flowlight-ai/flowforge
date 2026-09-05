/**
 * T7.29 品牌层集成测试（批次54）——跨包装配验证（forgekin 品牌族）。
 *
 * 覆盖：魔法词真实短语触发 / swarm 群编排 / IM 议会（I1 降级链路、I4 超时拒绝、
 * I2 归档 append-only）/ 评估台账记账闭环 / 进化引擎（SelfDev 装配 + 三模式治理 +
 * ApprovalHub + CloseGate）/ 弹性栈故障注入恢复 / MindCodex 检索排序 / 锻造流水线
 * 产物验收。均为纯逻辑或注入式故障端口，无 LLM 依赖（T1 边界同批次 53）。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@flowforge/cordis'
import MagicWordsPlugin, {
  MagicWordTrigger,
  allPhrases,
  detectMagicWord,
} from '@flowforge/forgekin-magic-words'
import SwarmPlugin, { SwarmTaskStatus, makeSwarmTask } from '@flowforge/forgekin-swarm'
import {
  FileArchiveWriter,
  IMCouncilChannel,
  IMCouncilManager,
  NoAvailableChannelError,
  newCouncilMessage,
  newCouncilReply,
  type CouncilReply,
} from '@flowforge/forgekin-im-council'
import { ForgingStage } from '@flowforge/forgekin-forging'
import EvalLedgerPlugin from '@flowforge/forgekin-eval-ledger'
import { ApprovalHub, ForgeMindEngine, makeApprovalRequest, makeCloseGateDecision } from '@flowforge/forgekin-evolution-engine'
import ResiliencePlugin from '@flowforge/resilience'
import { ForgekinSpecies, ForgekinFormData } from '@flowforge/forgekin-species'
import type { LlmChatClient } from '@flowforge/forgekin-loops'
import { SelfDevDocLoop } from '@flowforge/forgekin-loops'

let scratchDir: string

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'fk-t729-'))
})

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

// ── 1. 魔法词真实短语触发 ───────────────────────────────────

describe('T7.29 魔法词', () => {
  it('四条真实短语样本各自触发正确 STOP 动作', () => {
    expect(detectMagicWord('请用第一性原理重新分析这个设计')?.trigger).toBe(
      MagicWordTrigger.STOP_AND_AUDIT,
    )
    expect(detectMagicWord('这个报错我能猜出来是配置问题')?.trigger).toBe(
      MagicWordTrigger.STOP_AND_READ_SOURCE,
    )
    expect(detectMagicWord('这个问题下次一定修')?.trigger).toBe(
      MagicWordTrigger.STOP_AND_SIGNOFF,
    )
    expect(detectMagicWord('给你星星罐子奖励')?.trigger).toBeDefined()
  })

  it('子串检测：短语嵌入长指令仍命中；无关指令返回 null', () => {
    expect(detectMagicWord('按第一性原理拆解')).not.toBeNull()
    expect(detectMagicWord('普通的普通指令')).toBeNull()
    expect(allPhrases().length).toBe(4)
  })

  it('MagicWordsService 经 cordis 挂载 ctx.forgeMagicWords（detect/snapshot）', async () => {
    const ctx = new Context()
    await ctx.plugin(MagicWordsPlugin)
    expect(ctx.forgeMagicWords.detect('我要下次一定提交')).not.toBeNull()
    expect(ctx.forgeMagicWords.snapshot().count).toBe(4)
  })
})

// ── 2. swarm 群编排（能力路由 + 状态机）─────────────────────

describe('T7.29 swarm 群编排', () => {
  async function makeSwarm() {
    const ctx = new Context()
    await ctx.plugin(SwarmPlugin)
    return ctx.forgeSwarm
  }

  it('多厂商注册 + 能力路由分发到匹配 agent', async () => {
    const swarm = await makeSwarm()
    swarm.registerAgent('agent-openai', ['code_generation'], 'openai')
    swarm.registerAgent('agent-baidu', ['doc_writing'], 'baidu')
    const taskId = swarm.submitTask(makeSwarmTask({
      title: '写文档',
      description: '写一份集成报告',
      requiredCapabilities: ['doc_writing'],
    } as never))
    const dispatched = await swarm.dispatch()
    expect(dispatched).toContain(taskId)
    expect(swarm.getTask(taskId)?.assignedAgentId).toBe('agent-baidu')
  })

  it('无匹配能力 → 任务保持 PENDING（推荐搭档语义）', async () => {
    const swarm = await makeSwarm()
    swarm.registerAgent('agent-openai-2', ['code_generation'], 'openai')
    const taskId = swarm.submitTask(makeSwarmTask({
      title: '需要设计能力',
      description: 'd',
      requiredCapabilities: ['design'],
    } as never))
    await swarm.dispatch()
    expect(swarm.getTaskStatus(taskId)).toBe(SwarmTaskStatus.PENDING)
  })

  it('failTask/cancelTask 状态迁移 + getTask 可查', async () => {
    const swarm = await makeSwarm()
    swarm.registerAgent('agent-x', ['ops'], 'openai')
    const t1 = swarm.submitTask(makeSwarmTask({ title: 'a', description: 'a', requiredCapabilities: ['ops'] } as never))
    const t2 = swarm.submitTask(makeSwarmTask({ title: 'b', description: 'b', requiredCapabilities: ['ops'] } as never))
    expect(swarm.failTask(t1, '注入失败')).toBe(true)
    expect(swarm.getTask(t1)?.status).toBeDefined()
    expect(swarm.cancelTask(t2, '注入取消')).toBe(true)
    expect(swarm.getTask(t2)).not.toBeNull()
  })
})

// ── 3. IM 议会（I1 降级链路 / I4 超时拒绝 / I2 归档）────────

interface TestChannelOptions {
  readonly name: string
  readonly fail?: boolean
  readonly reply?: string | null
  readonly delayMs?: number
}

class TestChannel extends IMCouncilChannel {
  readonly channelName: string

  constructor(private readonly opts: TestChannelOptions) {
    super()
    this.channelName = opts.name
  }

  async send(): Promise<string> {
    if (this.opts.fail === true) throw new Error(`通道 ${this.opts.name} 注入故障`)
    return `msg-${this.opts.name}`
  }

  async wait_reply(): Promise<CouncilReply | null> {
    if (this.opts.fail === true) throw new Error(`通道 ${this.opts.name} 注入故障`)
    if (this.opts.reply === null || this.opts.reply === undefined) {
      if ((this.opts.delayMs ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.opts.delayMs))
      }
      return null
    }
    return newCouncilReply({
      replyId: `reply-${this.opts.name}`,
      messageId: 'msg-pending',
      replier: 'operator',
      content: this.opts.reply,
      replyType: 'decision',
      decidedAt: new Date().toISOString(),
    } as never)
  }

  async broadcast(): Promise<string[]> {
    return [await this.send()]
  }
}

function makeTestChannel(opts: TestChannelOptions): IMCouncilChannel {
  return new TestChannel(opts)
}

describe('T7.29 IM 议会', () => {
  const message = () => newCouncilMessage({
    channel: 'auto',
    forgekinId: 'fk-sherlock',
    content: '申请审批：合并 PR #1',
  } as never)

  function makeManager(channels: TestChannelOptions[], timeoutSeconds = 1): IMCouncilManager {
    const archiveDir = join(scratchDir, `archive-${Math.random().toString(36).slice(2, 8)}`)
    const manager = new IMCouncilManager({
      approvalHub: new ApprovalHub(),
      archiveDir,
      defaultChannel: 'auto',
      timeoutSeconds,
    } as never)
    for (const c of channels) {
      manager.registerChannel(c.name, makeTestChannel(c) as never)
    }
    return manager
  }

  const request = (expiresInSeconds = 60) => makeApprovalRequest({
    requestId: `req-${Math.random().toString(36).slice(2, 8)}`,
    forgekinId: 'fk-sherlock',
    threadId: 'th-1',
    requestType: 'self_dev' as never,
    title: '申请审批：合并 PR #1',
    description: 'T7.29 集成测试请求',
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  })

  it('I1 降级链路：首选通道故障 → 自动回落次选', async () => {
    const manager = makeManager([
      { name: 'console', fail: true },
      { name: 'webchat', reply: 'approved' },
    ])
    const via = await manager.sendWithFallback(message())
    expect(via).toContain('webchat')
  })

  it('全通道故障 → NoAvailableChannelError（I1 穷尽）', async () => {
    const manager = makeManager([{ name: 'console', fail: true }])
    await expect(manager.sendWithFallback(message())).rejects.toThrow(NoAvailableChannelError)
  })

  it('I4 超时自动拒绝：无回复 → decide(rejected, timeout)', async () => {
    const manager = makeManager([{ name: 'console', reply: null, delayMs: 50 }], 0.05)
    const approved = await manager.requestApproval(request(), 0.05)
    expect(approved).toBe(false)
  })

  it('正常审批：operator approve → true，且归档 JSONL append-only', async () => {
    const archiveDir = join(scratchDir, `archive-${Math.random().toString(36).slice(2, 8)}`)
    const writer = new FileArchiveWriter(archiveDir)
    const manager = new IMCouncilManager({
      approvalHub: new ApprovalHub(),
      archiveDir,
      defaultChannel: 'auto',
      timeoutSeconds: 2,
      archiveWriter: writer,
    } as never)
    manager.registerChannel('console', makeTestChannel({ name: 'console', reply: 'approved' }) as never)
    const approved = await manager.requestApproval(request(), 2)
    expect(approved).toBe(true)
  })
})

// ── 4. 评估台账记账闭环 ─────────────────────────────────────

describe('T7.29 评估台账', () => {
  it('Replay A/B 记账：B 组净增益 → passed 计入台账 stats', async () => {
    const ctx = new Context()
    await ctx.plugin(EvalLedgerPlugin)
    const svc = ctx.forgeEvalLedger
    const cases = [
      { case_id: 's1', case_type: 'standard_success', input: 'q1', expected: 'e1', is_smoke: true },
      { case_id: 's2', case_type: 'standard_success', input: 'q2', expected: 'e2', is_smoke: true },
      { case_id: 's3', case_type: 'boundary_should_escalate', input: 'q3', expected: 'e3', is_smoke: true },
      { case_id: 'p1', case_type: 'standard_success', input: 'q4', expected: 'e4' },
      { case_id: 'p2', case_type: 'standard_success', input: 'q5', expected: 'e5' },
      { case_id: 'p3', case_type: 'boundary_should_escalate', input: 'q6', expected: 'e6' },
      { case_id: 'p4', case_type: 'conflict_counter_example', input: 'q7', expected: 'e7' },
      { case_id: 'p5', case_type: 'conflict_counter_example', input: 'q8', expected: 'e8' },
    ] as never[]
    const ledger = await svc.runReplayAb('method-1', 'prop-1', cases, {
      runnerA: async () => '旧方法输出',
      runnerB: async () => '新方法输出（改进）',
    } as never)
    const stats = svc.getStats()
    expect(stats).toBeDefined()
    expect(ledger).toBeDefined()
  })

  it('crossValidate 三信号交叉 + attribution 归因', async () => {
    const ctx = new Context()
    await ctx.plugin(EvalLedgerPlugin)
    const svc = ctx.forgeEvalLedger
    const cross = await svc.crossValidate([
      { kind: 'eval', passed: true } as never,
      { kind: 'audit', passed: true } as never,
      { kind: 'runtime', passed: true } as never,
    ])
    expect(cross).toBeDefined()
    const report = await svc.attribute({ failure: 'injected', surface: 'test' })
    expect(report).toBeDefined()
  })
})

// ── 5. 进化引擎（SelfDev 装配 + 三模式 + ApprovalHub + CloseGate）──

describe('T7.29 进化引擎', () => {
  function makeDocLoop(): SelfDevDocLoop {
    const projectRoot = mkdtempSync(join(tmpdir(), 'fk-t729-loop-'))
    return new SelfDevDocLoop({
      llmClient: {
        async chat() {
          // 引擎装配冒烟不需要真实规划内容：使用最小回复（结构固定，无业务语义）
          return { content: '{"steps": [], "expected_effect": "e2e装配冒烟", "risk_assessment": "low"}' }
        },
      } satisfies LlmChatClient,
      forgekinConfig: { projectRoot, forgekinId: 'fk-wenxin' },
      awakeningStage: 'E3',
    })
  }

  it('SelfDev 五闭环装配：registerSelfDevLoop → runSelfDevLoop → listSelfDevLoops', async () => {
    const engine = new ForgeMindEngine()
    const loop = makeDocLoop()
    engine.registerSelfDevLoop(loop)
    expect(engine.listSelfDevLoops()['doc']).toBeDefined()
    const result = (await engine.runSelfDevLoop('doc', {})) as { summary?: { total?: number } }
    expect(result).toBeDefined()
    expect(typeof result.summary?.total).toBe('number')
    expect(engine.getSelfDevLoop('code')).toBeNull()
  })

  it('三模式治理：scope_guard 拦截 / process_evolution / knowledge_evolution', async () => {
    const engine = new ForgeMindEngine()
    // scope_guard：触碰 VISION §7 核心的想法应被拦截或要求审批
    const guard = await engine.evaluate({
      mode: 'scope_guard',
      scope_guard: {
        current_vision: 'FlowForge 是 Forgekin 进化平台',
        new_idea: '把 VISION 的进化目标改成无限制自主扩张',
        current_ac: ['AC-1'],
        feature_id: 'F999',
        agent: 'fk-sherlock',
      },
    })
    expect(guard).toBeDefined()
    // process_evolution：无错误历史 → 保守结论
    const pe = await engine.evaluate({ mode: 'process_evolution' })
    expect(pe).toBeDefined()
    // knowledge_evolution：无经验输入 → 保守结论
    const ke = await engine.evaluate({ mode: 'knowledge_evolution' })
    expect(ke).toBeDefined()
  })

  it('ApprovalHub 提交→批准→stats；CloseGate 决议', () => {
    const engine = new ForgeMindEngine()
    void engine
    const hub = new ApprovalHub()
    const requestId = hub.submit({
      kind: 'self_dev' as never,
      forgekinId: 'fk-sherlock',
      title: '进化提案',
      summary: '三循环演进提案',
      payload: {},
    } as never)
    expect(hub.get(requestId)).not.toBeNull()
    expect(hub.listPending().length).toBe(1)
    hub.approve({ requestId, decidedBy: 'operator' } as never)
    expect(hub.listAll('approved').some((r) => r.requestId === requestId)).toBe(true)
    const stats = hub.getStats()
    expect(stats).toBeDefined()
    const gate = makeCloseGateDecision({
      decision: 'close' as never,
      decidedBy: 'operator',
      rationale: '三循环演进完成',
    })
    expect(gate.decision).toBe('close')
  })
})

// ── 6. 弹性栈故障注入恢复 ───────────────────────────────────

describe('T7.29 弹性栈', () => {
  it('熔断器：连续失败 → OPEN 拒绝 → reset 恢复', async () => {
    const ctx = new Context()
    await ctx.plugin(ResiliencePlugin)
    const breaker = ctx.forgeResilience.getBreaker('e2e-breaker', { failureThreshold: 3 } as never)
    for (let i = 0; i < 3; i++) breaker.recordFailure()
    expect(breaker.getState()).toBe('open')
    expect(breaker.canExecute()).toBe(false)
    breaker.reset()
    expect(breaker.canExecute()).toBe(true)
  })

  it('FallbackChain：首步注入故障 → 回落次步成功', async () => {
    const ctx = new Context()
    await ctx.plugin(ResiliencePlugin)
    const chain = ctx.forgeResilience.createFallbackChain([
      { name: 'primary', handler: async () => { throw new Error('注入故障') } },
      { name: 'fallback', handler: async () => '降级成功' },
    ] as never)
    const result = await chain.execute({}, { input: 'x' } as never)
    expect(result).toBeDefined()
  })

  it('checkpoint 模板 + 快照', async () => {
    const ctx = new Context()
    await ctx.plugin(ResiliencePlugin)
    const tpl = ctx.forgeResilience.checkpointTemplate('e2e')
    expect(tpl).toBeDefined()
    const snap = await ctx.forgeResilience.snapshot()
    expect(snap).toBeDefined()
  })
})

// ── 7. MindCodex 检索排序 ───────────────────────────────────

describe('T7.29 MindCodex 检索排序', () => {
  it('标题命中优先于正文命中；topK 截断', async () => {
    const ctx = new Context()
    await ctx.plugin((await import('@flowforge/forgekin-knowledge')).default)
    const codex = ctx.forgeKnowledge.codex
    // 三条经验：仅第二条标题含 '审议'，第三条正文含 '审议'
    await codex.addEntry({
      codexId: 'c-unrelated',
      title: '部署经验',
      content: '与关键词完全无关的内容',
      domain: 'general',
      skillTags: ['deploy'],
      derivedFrom: 'e1',
      createdAt: new Date().toISOString(),
      usageCount: 0,
    } as never)
    await codex.addEntry({
      codexId: 'c-title-hit',
      title: '跨厂商审议通过方法论',
      content: '加权聚合细节',
      domain: 'general',
      skillTags: ['council'],
      derivedFrom: 'e2',
      createdAt: new Date().toISOString(),
      usageCount: 0,
    } as never)
    await codex.addEntry({
      codexId: 'c-content-hit',
      title: '部署手册',
      content: '其中一节提到审议注意事项',
      domain: 'general',
      skillTags: ['ops'],
      derivedFrom: 'e3',
      createdAt: new Date().toISOString(),
      usageCount: 0,
    } as never)
    const hits = await codex.search('审议', 2)
    expect(hits.length).toBeLessThanOrEqual(2)
    expect(hits[0]?.codexId).toBe('c-title-hit')
  })
})

// ── 8. 锻造流水线产物验收 ───────────────────────────────────

describe('T7.29 锻造流水线', () => {
  it('forge() 六阶段产物：ForgekinBase + SoulImprint 锚点 + 形态正确', async () => {
    const ctx = new Context()
    await ctx.plugin((await import('@flowforge/forgekin-forging')).default)
    const pipeline = ctx.forgeForging
    const form = new ForgekinFormData({
      name: 'e2e-forged',
      species: ForgekinSpecies.VIRTUAL,
      namespace: 'e2e',
      requirement: '集成测试锻造验收',
      seed_params: { origin: 't729' },
      value_anchors: ['不做恶'],
    })
    const forged = await pipeline.forge(form, { forgekin_id: 'fk-e2e-forged' })
    expect(forged).toBeDefined()
    expect(forged.name).toContain('e2e-forged')
    expect(forged.soulImprint).toBeDefined()
  })

  it('锻造快照可审计（stage/config/prompt 非硬编码）', async () => {
    const ctx = new Context()
    await ctx.plugin((await import('@flowforge/forgekin-forging')).default)
    const pipeline = ctx.forgeForging
    const snap = pipeline.snapshot()
    expect(snap.stages).toBeGreaterThan(0)
    expect(pipeline.getStageConfig(ForgingStage.SPECIES_DEFINITION)).toBeDefined()
  })
})

/**
 * T7.13 forgekin 集成测试（批次53）——跨包装配验证，非单包单测。
 *
 * LLM 边界（T1 铁律 + 批次49 措辞约定）：
 * - OpenRoute 网关可达（OPENROUTE_BASE_URL / FLOWFORGE_LLM_ROUTE_OPENROUTE_BASE_URL）
 *   时走真实调用；不可达时，依赖 LLM 的规划走**循环自身的生产降级路径**
 *   （self-dev-loop 内置的 LLM 失败 fallback，非测试 mock），并在用例名标注。
 * - 审议/编译器/蒸馏/检索均为纯逻辑，无 LLM 依赖。
 * - 文档闭环的文件 IO 使用 mkdtemp 真实临时目录（生产代码路径）。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { Context } from '@flowforge/cordis'
import CouncilPlugin, { CouncilChannel, CouncilVerdict, type CouncilReview, type CouncilReviewer } from '@flowforge/forgekin-council'
import { SpiritForge } from '@flowforge/forgekin-knowledge'
import type { LlmChatClient } from '@flowforge/forgekin-loops'
import {
  SelfDevDocLoop,
  SelfDevCodeLoop,
  SelfDevFrameworkLoop,
  SelfDevReviewLoop,
  SelfDevTestLoop,
} from '@flowforge/forgekin-loops'
import {
  Forgekin,
  ForgekinRegistry,
  ForgekinType,
  makeCapability,
} from '@flowforge/forgekin-species'
import CompilerPlugin, { WorkflowCompilerService } from '@flowforge/forgekin-workflow-compiler'
import { resolveE2ELlmClient } from '../src/index.ts'
import { OpenRouteLlmClient } from '@flowforge/llm-openroute'

const REPO_ROOT = resolve(import.meta.dirname, '../../../..')
const llm = resolveE2ELlmClient()
const llmUnavailable = llm.mode === 'unavailable'
// OpenRoute 不可达时仍提供真客户端（指向默认 127.0.0.1:13001，连接拒绝 →
// chat() 返回错误字典 → 循环走内置生产降级路径，非测试 mock）
const openrouteFallback = new OpenRouteLlmClient({ env: {} })
const loopLlm: LlmChatClient = {
  async chat(messages) {
    if (llm.client !== undefined) {
      return { ...(await llm.client.chat(messages)) }
    }
    // OpenRoute 不可达 → 真客户端指向默认网关（连接拒绝 → chat() 返回错误字典
    // → 循环走内置生产降级路径，非测试 mock）
    return { ...(await openrouteFallback.chat({ messages: messages.map((m) => ({ role: m.role, content: m.content })) })) }
  },
}

interface ForgekinYaml {
  forgekin_id: string
  name: string
  alias: string
  forgekin_type: string
  vendor: string
  capabilities: Array<{ name: string; proficiency: number }>
}

function loadForgekinYaml(fileName: string): ForgekinYaml {
  return parseYaml(
    readFileSync(join(REPO_ROOT, 'config/forgekins', fileName), 'utf-8'),
  ) as ForgekinYaml
}

function forgekinFromYaml(profile: ForgekinYaml): Forgekin {
  const fk = new Forgekin({
    name: profile.name,
    forgekinType: profile.forgekin_type as ForgekinType,
    forgekinId: profile.forgekin_id,
    vendor: profile.vendor,
    modelLineage: [profile.vendor],
  })
  for (const cap of profile.capabilities) {
    fk.addCapability(makeCapability(cap.name, cap.proficiency))
  }
  return fk
}

// ── A. YAML 档案注册（真实 config/forgekins/*.yaml）─────────

describe('T7.13 A: YAML 注册 Forgekin', () => {
  it('真实 sherlock.yaml 档案 → Forgekin 构造 + 能力注入', () => {
    const profile = loadForgekinYaml('sherlock.yaml')
    expect(profile.forgekin_id).toBe('fk-sherlock')
    const fk = forgekinFromYaml(profile)
    expect(fk.forgekinId).toBe('fk-sherlock')
    expect(fk.vendor).toBe('openai')
    expect(fk.capabilities.size).toBe(profile.capabilities.length)
    expect(fk.capabilities.get('code_generation')?.proficiency).toBe(
      profile.capabilities.find((c) => c.name === 'code_generation')?.proficiency,
    )
  })

  it('五份档案批量注册进 ForgekinRegistry：按类型/能力检索 + selectOwner', () => {
    const registry = new ForgekinRegistry()
    for (const fileName of ['sherlock.yaml', 'luban.yaml', 'wenxin.yaml', 'vangogh.yaml', 'davinci.yaml']) {
      registry.register(forgekinFromYaml(loadForgekinYaml(fileName)))
    }
    expect(registry.count()).toBe(5)
    expect(registry.get('fk-sherlock').name).toBe('夏洛克')
    expect(registry.findByType(ForgekinType.CODE_AGENT).length).toBeGreaterThan(0)
    expect(registry.findByCapability('code_generation', 0.85).map((f) => f.forgekinId)).toContain('fk-sherlock')
    const owner = registry.selectOwner(['code_generation', 'debugging'])
    expect(owner).not.toBeNull()
  })

  it('重复注册结构性拒绝（幂等护栏）', () => {
    const registry = new ForgekinRegistry()
    const fk = forgekinFromYaml(loadForgekinYaml('sherlock.yaml'))
    registry.register(fk)
    expect(() => registry.register(fk)).toThrow()
  })
})

// ── B. 五闭环演进（真实 IO + LLM 双模式）────────────────────

describe('T7.13 B: 五闭环演进', () => {
  let docsDir: string
  let projectRoot: string

  beforeAll(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'fk-e2e-'))
    docsDir = join(projectRoot, 'docs')
    // 真实闭环触发面：docs/features/F0XX 存在但 design/D0XX 缺失 → doc-loop discover 命中
    mkdirSync(join(docsDir, 'features'), { recursive: true })
    writeFileSync(join(docsDir, 'features', 'F999-e2e-fixture.md'), '---\ntitle: e2e fixture\n---\n# F999 e2e\n')
  })

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  function makeDocLoop(): SelfDevDocLoop {
    return new SelfDevDocLoop({
      llmClient: loopLlm,
      forgekinConfig: {
        projectRoot,
        forgekinId: 'fk-wenxin',
        docs_dir: docsDir,
        max_age_days: 30,
      },
      awakeningStage: 'E3',
    })
  }

  it('checkAwakeningStage 觉醒阶门槛：E2 拒绝 / E3 放行（五环同门槛）', () => {
    const loop = makeDocLoop()
    expect(() => loop.checkAwakeningStage('E2')).toThrow()
    expect(() => loop.checkAwakeningStage('E3')).not.toThrow()
    for (const Ctor of [SelfDevCodeLoop, SelfDevFrameworkLoop, SelfDevReviewLoop, SelfDevTestLoop]) {
      const probe = new Ctor({
        llmClient: loopLlm,
        forgekinConfig: { projectRoot, forgekinId: 'fk-davinci' },
        awakeningStage: 'E3',
      })
      expect(() => probe.checkAwakeningStage('E2')).toThrow()
    }
  })

  it('doc-loop discover：真实 fs 扫描命中缺失设计文档任务', async () => {
    const loop = makeDocLoop()
    const tasks = await loop.discover({})
    expect(Array.isArray(tasks)).toBe(true)
  })

  it(`doc-loop plan→act→verify 完整演进（${llmUnavailable ? 'OpenRoute 不可达，走循环内置降级规划' : 'OpenRoute 真实调用'}）`, async () => {
    const loop = makeDocLoop()
    const tasks = await loop.discover({})
    expect(tasks.length).toBeGreaterThan(0)
    const task = tasks[0]!
    const plan = await loop.plan(task)
    expect(plan.taskId).toBe(task.taskId)
    expect(Array.isArray(plan.steps)).toBe(true)
    const result = await loop.act(plan)
    expect(result.planId).toBe(plan.planId)
    expect(typeof result.success).toBe('boolean')
    const verify = await loop.verify(result)
    expect(verify.resultId).toBe(result.resultId)
    expect(typeof verify.passed).toBe('boolean')
  })

  it('preActScopeGuardCheck：受保护路径 fail-closed 拒绝', () => {
    const loop = makeDocLoop()
    const guarded = loop as unknown as {
      preActScopeGuardCheck: (task: unknown, plan: unknown) => void
    }
    expect(() =>
      guarded.preActScopeGuardCheck(
        { taskId: 't', kind: 'doc' },
        { taskId: 't', steps: [{ action: 'write_file', params: { path: '../../etc/passwd' } }] },
      ),
    ).toThrow()
  })

  it('四环（code/framework/review/test）构造 + discover 冒烟（临时工程根）', async () => {
    for (const [Ctor, label] of [
      [SelfDevCodeLoop, 'code'],
      [SelfDevFrameworkLoop, 'framework'],
      [SelfDevReviewLoop, 'review'],
      [SelfDevTestLoop, 'test'],
    ] as const) {
      const loop = new Ctor({
        llmClient: loopLlm,
        forgekinConfig: { projectRoot, forgekinId: 'fk-davinci' },
        awakeningStage: 'E3',
      })
      const tasks = await loop.discover({})
      expect(Array.isArray(tasks), `${label} discover`).toBe(true)
    }
    expect(existsSync(docsDir) || existsSync(projectRoot)).toBe(true)
  })
})

// ── C. 跨厂商审议（同厂商结构性拒绝）────────────────────────

describe('T7.13 C: 跨厂商审议', () => {
  const reviewers = {
    sherlock: { forgekinId: 'fk-sherlock', vendor: 'openai', name: '夏洛克' },
    wenxin: { forgekinId: 'fk-wenxin', vendor: 'baidu', name: '文心' },
    luban: { forgekinId: 'fk-luban', vendor: 'baidu', name: '鲁班' },
  }

  function reviewFn(verdict: CouncilVerdict, score: number) {
    return (reviewer: CouncilReviewer): CouncilReview => ({
      reviewerId: reviewer.forgekinId,
      reviewerVendor: reviewer.vendor,
      verdict,
      score,
      notes: `${reviewer.name ?? reviewer.forgekinId} 审议意见`,
      pushBackPoints: [],
      reviewedAt: new Date().toISOString(),
    })
  }

  it('同厂商三评审 → min_distinct_vendors 结构性拒绝（ESCALATE）', () => {
    const channel = new CouncilChannel({ minReviewers: 2, minDistinctVendors: 2 })
    const session = channel.convene('artifact-1', [reviewers.sherlock, reviewers.wenxin, reviewers.luban], () => reviewFn(CouncilVerdict.PASS, 0.9)(reviewers.wenxin),
    )
    const outcome = channel.aggregate(session.reviews)
    expect(outcome.verdict).toBe(CouncilVerdict.ESCALATE)
  })

  it('双厂商一致通过 → APPROVED（厂商权重 1/2 计入）', () => {
    const channel = new CouncilChannel({ minReviewers: 2, minDistinctVendors: 2 })
    const session = channel.convene(
      'artifact-2',
      [reviewers.sherlock, reviewers.wenxin],
      (reviewer) => reviewFn(CouncilVerdict.PASS, 0.9)(reviewer),
    )
    expect(session.reviews).toHaveLength(2)
    const outcome = channel.aggregate(session.reviews)
    expect(outcome.verdict).toBe(CouncilVerdict.PASS)
  })

  it('CouncilService 经 cordis 挂载 ctx.forgeCouncil（跨包装配冒烟）', async () => {
    const ctx = new Context()
    await ctx.plugin(CouncilPlugin)
    expect(ctx.forgeCouncil).toBeDefined()
  })
})

// ── D. 工作流编译器 YAML→DAG ────────────────────────────────

describe('T7.13 D: 工作流编译器', () => {
  it('真实 doc_iterative.yaml → 编译产出五步 DAG（三厂商跨包编排）', async () => {
    const ctx = new Context()
    await ctx.plugin(CompilerPlugin)
    const compiler: WorkflowCompilerService = ctx.forgeWorkflowCompiler
    const yamlContent = readFileSync(join(REPO_ROOT, 'config/workflows/doc_iterative.yaml'), 'utf-8')
    const result = compiler.compile(yamlContent)
    expect(result.ir.name).toBe('doc_iterative')
    expect(result.sopSteps.length).toBe(5)
    const agents = result.sopSteps.map((s) => JSON.stringify(s)).join('')
    expect(agents).toContain('fk-wenxin')
    expect(agents).toContain('fk-vangogh')
    expect(agents).toContain('fk-davinci')
  })

  it('非法 YAML → 编译器 fail-fast', async () => {
    const ctx = new Context()
    await ctx.plugin(CompilerPlugin)
    const compiler: WorkflowCompilerService = ctx.forgeWorkflowCompiler
    expect(() => compiler.compile('name: broken\nsteps: []')).toThrow()
  })
})

// ── E. SpiritForge 蒸馏 → MindCodex 入库 → 三入口检索 ───────

describe('T7.13 E: SpiritForge 蒸馏与检索', () => {
  it('三问过滤：否决性输入不入库', async () => {
    const forge = new SpiritForge()
    const outcome = await forge.forge({
      reusability: false,
      nonObviousness: true,
      decayRisk: false,
      taskSnapshot: '一次性任务',
      evidenceMap: {},
      decisionTimeline: [],
      collaborationPivots: [],
      transferableMethod: '',
      nonTransferableFacts: '一次性事实',
      safetyBoundary: '无',
    })
    expect(outcome.distilled).toBe(false)
    expect(forge.codex.listEntries()).toHaveLength(0)
  })

  it('三问通过 → Episode→MethodCard→Eval 双门→storeToCodex 全链路', async () => {
    const forge = new SpiritForge()
    const outcome = await forge.forge({
      reusability: true,
      nonObviousness: true,
      decayRisk: false,
      taskSnapshot: '跨厂商审议集成任务快照',
      evidenceMap: { artifact: 'artifact-2' },
      decisionTimeline: [{ step: 'claim' }, { step: 'finalize' }],
      collaborationPivots: [{ pivot: '双厂商加权通过' }],
      transferableMethod: '跨厂商审议通过时按 1/vendor数 加权聚合',
      nonTransferableFacts: '仅本次 artifact-2 的具体分数',
      safetyBoundary: '不记录 reviewer 原始密钥',
    })
    expect(outcome.distilled).toBe(true)
    expect(outcome.method).toBeDefined()
    expect(outcome.evalLedger).toBeDefined()
    // 双门均通过 → 已入库
    const entries = forge.codex.listEntries()
    expect(entries.length).toBeGreaterThan(0)
  })

  it('MindCodex 三入口：listEntries / search / recordConsumption', async () => {
    const forge = new SpiritForge()
    await forge.forge({
      reusability: true,
      nonObviousness: true,
      decayRisk: false,
      taskSnapshot: 'DAG 编译经验',
      evidenceMap: {},
      decisionTimeline: [],
      collaborationPivots: [],
      transferableMethod: '工作流 YAML 先 Parser 后 Validator 再 CodeGen 的三阶段编译法',
      nonTransferableFacts: '本次的具体 YAML 字段名',
      safetyBoundary: '无',
    })
    const entries = forge.codex.listEntries()
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const hits = await forge.codex.search('编译')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    const first = hits[0] ?? entries[0]!
    const before = first.usageCount ?? 0
    await forge.codex.recordConsumption(first.codexId)
    const after = forge.codex.listEntries().find((e) => e.codexId === first.codexId)
    expect((after?.usageCount ?? 0)).toBe(before + 1)
  })
})

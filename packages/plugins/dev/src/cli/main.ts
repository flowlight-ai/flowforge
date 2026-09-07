/**
 * @flowforge/plugin-dev — `ff_dev` CLI (EP0-3).
 *
 * Process lifecycle command: init / list / status / advance / gate / evidence /
 * resume / snapshot. Zero runtime dependencies (manual arg parsing) so any AI
 * tool — flowforge-hosted (scenario 1) or external (scenario 2) — can drive
 * the seven-phase spine from a plain shell. Exit codes are a contract for CI
 * and scripts: 0 = ok, 1 = violation/rejection, 2 = usage error.
 *
 * @module @flowforge/plugin-dev/cli
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { appendEvidence } from '../evidence.ts'
import { InstanceStore, type PersistedInstance } from '../persistence.ts'
import { validatePlan } from '../plan-validator.ts'
import {
  ForgeProcessStateMachine,
  PROCESS_PHASES,
  type ProcessPhase,
} from '../state-machine.ts'
import {
  getWorkflowProfile,
  gatesForPhase,
  type WorkflowKind,
  WORKFLOW_KINDS,
} from '../workflows.ts'

const USAGE = `ff_dev — FlowForge 软件工程化流程（@flowforge/plugin-dev）

用法：
  ff_dev init <name> [--workflow feature|greenfield|change|hotfix] [--repo <root>]
  ff_dev list [--repo <root>]
  ff_dev status [name] [--json] [--repo <root>]
  ff_dev advance <name> [--repo <root>]
  ff_dev gate <name> <design|plan|verify> [--evidence <path>] [--score <n>]
              [--approver <who>] [--fastpass] [--repo <root>]
  ff_dev evidence <name> --command "..." --exit <code> --summary "..."
                  [--duration-ms <n>] [--repo <root>]
  ff_dev resume [name] [--repo <root>]
  ff_dev snapshot <name> [--out <path>] [--repo <root>]

退出码：0 = 成功；1 = 门禁拒绝/违规；2 = 用法错误。`

/** Phase → guidance for the resume briefing (skills assets are Plane 1). */
const PHASE_GUIDANCE: Readonly<Record<ProcessPhase, { asset: string; advice: string }>> = {
  requirement: {
    asset: 'docs/process/skills/brainstorming.md',
    advice: '澄清需求并分级（Spike/Bounded/Architectural）；产出需求清单。',
  },
  design: {
    asset: 'docs/process/skills/brainstorming.md',
    advice: '产出设计文档（docs/process/specs/，含 DCP 决策记录）并取得操作者签核后：ff_dev gate <name> design --evidence <spec.md>。',
  },
  plan: {
    asset: 'docs/process/skills/writing-plans.md',
    advice: '产出实施计划（No-Placeholder）后：ff_dev gate <name> plan --evidence <plan.md>。',
  },
  implement: {
    asset: 'docs/process/skills/executing-plans.md',
    advice: '逐任务执行（TDD 红绿循环；子代理可用时走 subagent-driven-development）。',
  },
  review: {
    asset: 'docs/process/skills/requesting-code-review.md',
    advice: '两阶段审查（spec 合规 + 代码质量），记录落 docs/process/reviews/<name>.md。',
  },
  verify: {
    asset: 'docs/process/skills/verification-before-completion.md',
    advice: '跑验证并记录证据：ff_dev evidence <name> --command "..." --exit 0 --summary "..."。',
  },
  finish: {
    asset: 'docs/process/skills/finishing-a-development-branch.md',
    advice: '测试全绿 → mgr PR → 清理分支；实例已完结。',
  },
}

interface ParsedArgs {
  readonly command: string
  readonly positionals: string[]
  readonly flags: Map<string, string | boolean>
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = '', ...rest] = argv
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index] ?? ''
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = rest[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next)
        index += 1
      } else {
        flags.set(key, true)
      }
    } else {
      positionals.push(token)
    }
  }
  return { command, positionals, flags }
}

function flagString(flags: Map<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key)
  return typeof value === 'string' ? value : undefined
}

function repoRootOf(flags: Map<string, string | boolean>): string {
  return resolve(flagString(flags, 'repo') ?? process.cwd())
}

function fail(message: string, code: 1 | 2 = 1): never {
  process.stderr.write(`ff_dev: ${message}\n`)
  process.exit(code)
}

function requirePositional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positionals[index]
  if (value === undefined || value === '') fail(`${label} 缺失\n\n${USAGE}`, 2)
  return value
}

function loadInstance(store: InstanceStore, name: string): PersistedInstance {
  try {
    return store.loadOrThrow(name)
  } catch (error) {
    fail((error as Error).message, 1)
  }
}

function printInstance(instance: PersistedInstance): void {
  const { snapshot } = instance
  const gates = [
    `designApproved=${snapshot.gates.designApproved ? '✓' : '✗'}`,
    `planValidated=${snapshot.gates.planValidated ? '✓' : '✗'}`,
    `verificationEvidence=${snapshot.gates.verificationEvidence ? '✓' : '✗'}`,
  ].join(' ')
  const phaseIndex = PROCESS_PHASES.indexOf(snapshot.phase) + 1
  process.stdout.write(
    [
      `实例：${instance.name}（${instance.workflow} 工作流）`,
      `阶段：${snapshot.phase}（${phaseIndex}/${PROCESS_PHASES.length}）`,
      `门禁：${gates}`,
      `产物：design=${snapshot.artifacts.design ?? '-'} plan=${snapshot.artifacts.plan ?? '-'} review=${snapshot.artifacts.review ?? '-'} verification=${snapshot.artifacts.verification ?? '-'}`,
      `更新时间：${instance.updatedAt}`,
      '',
    ].join('\n'),
  )
}

function cmdInit(args: ParsedArgs): void {
  const name = requirePositional(args, 0, '实例名')
  const workflowRaw = flagString(args.flags, 'workflow') ?? 'feature'
  if (!WORKFLOW_KINDS.includes(workflowRaw as WorkflowKind)) {
    fail(`未知工作流 '${workflowRaw}'（可选：${WORKFLOW_KINDS.join(' | ')}）`, 2)
  }
  const workflow = workflowRaw as WorkflowKind
  const store = new InstanceStore(repoRootOf(args.flags))
  if (store.load(name) !== undefined) fail(`实例 '${name}' 已存在`, 1)
  const machine = new ForgeProcessStateMachine({ name })
  const path = store.saveMachine(name, workflow, machine)
  const profile = getWorkflowProfile(workflow)
  process.stdout.write(
    [
      `已创建实例 ${name}（${profile.label}）`,
      `状态文件：${path}`,
      `下一步：${PHASE_GUIDANCE.requirement.advice}`,
      '',
    ].join('\n'),
  )
}

function cmdList(args: ParsedArgs): void {
  const instances = new InstanceStore(repoRootOf(args.flags)).list()
  if (instances.length === 0) {
    process.stdout.write('（无流程实例——ff_dev init <name> 创建）\n')
    return
  }
  for (const instance of instances) {
    const active = instance.snapshot.phase === 'finish' ? '已完结' : '活跃'
    process.stdout.write(`${instance.name}\t${instance.workflow}\t${instance.snapshot.phase}\t${active}\n`)
  }
}

function cmdStatus(args: ParsedArgs): void {
  const store = new InstanceStore(repoRootOf(args.flags))
  const name = args.positionals[0]
  if (name === undefined) {
    cmdList(args)
    return
  }
  const instance = loadInstance(store, name)
  if (args.flags.has('json')) {
    process.stdout.write(`${JSON.stringify(instance, null, 2)}\n`)
    return
  }
  printInstance(instance)
}

function cmdAdvance(args: ParsedArgs): void {
  const name = requirePositional(args, 0, '实例名')
  const store = new InstanceStore(repoRootOf(args.flags))
  const instance = loadInstance(store, name)
  const machine = store.restoreMachine(instance)
  let snapshot
  try {
    snapshot = machine.advance()
  } catch (error) {
    fail((error as Error).message, 1)
  }
  store.saveMachine(name, instance.workflow, machine)
  const guidance = PHASE_GUIDANCE[snapshot.phase]
  process.stdout.write(
    [
      `已推进：${instance.snapshot.phase} → ${snapshot.phase}`,
      `下一步：${guidance.advice}`,
      `参考资产：${guidance.asset}`,
      '',
    ].join('\n'),
  )
}

function cmdGate(args: ParsedArgs): void {
  const name = requirePositional(args, 0, '实例名')
  const kind = requirePositional(args, 1, '门禁类型（design|plan|verify）')
  const store = new InstanceStore(repoRootOf(args.flags))
  const instance = loadInstance(store, name)
  const profile = getWorkflowProfile(instance.workflow)
  const machine = store.restoreMachine(instance)
  const evidence = flagString(args.flags, 'evidence')
  const score = flagString(args.flags, 'score')
  const approver = flagString(args.flags, 'approver') ?? 'operator'
  const fastpass = args.flags.has('fastpass')

  if (kind === 'design') {
    if (fastpass && !profile.fastpass.design) {
      fail(`工作流 ${instance.workflow} 不允许 design 门禁 fastpass（仅 hotfix）`, 1)
    }
    machine.approveDesign(evidence ?? (fastpass ? '[fastpass:hotfix]' : 'design-approval'))
    store.saveMachine(name, instance.workflow, machine)
    process.stdout.write(`design 门禁已开（${fastpass ? 'fastpass' : `证据：${evidence ?? '未登记'}`}）\n`)
    return
  }

  if (kind === 'plan') {
    if (evidence === undefined) fail('plan 门禁需要 --evidence <计划文档路径>', 2)
    if (fastpass && !profile.fastpass.plan) {
      fail(`工作流 ${instance.workflow} 不允许 plan 门禁 fastpass（仅 hotfix）`, 1)
    }
    let markdown = ''
    try {
      markdown = readFileSync(resolve(evidence), 'utf8')
    } catch (error) {
      fail(`无法读取计划文档 ${evidence}：${(error as Error).message}`, 2)
    }
    const result = validatePlan(markdown, { fastpass: fastpass || profile.fastpass.plan })
    if (!result.passed) {
      process.stderr.write(`plan 校验未通过（${result.errors.length} 处违规）：\n`)
      for (const issue of result.errors) {
        process.stderr.write(`  - [${issue.code}] 第 ${issue.line} 行：${issue.message}\n`)
      }
      process.exit(1)
    }
    machine.validatePlan(resolve(evidence))
    store.saveMachine(name, instance.workflow, machine)
    process.stdout.write(
      `plan 门禁已开：${result.taskCount} 个任务全部通过 No-Placeholder 校验（fastpass=${fastpass || profile.fastpass.plan}）\n`,
    )
    return
  }

  if (kind === 'verify') {
    if (evidence === undefined && score === undefined) {
      fail('verify 门禁需要 --evidence <验证文档路径>（可加 --score 记录 DCP 发布决策分）', 2)
    }
    machine.recordVerification(evidence ?? `score:${score ?? 'n/a'};approver:${approver}`)
    store.saveMachine(name, instance.workflow, machine)
    const gates = gatesForPhase(profile, 'verify')
    const gateNote = gates.length > 0 ? `（${gates.map(gate => gate.label).join('；')}）` : ''
    process.stdout.write(`verify 门禁已开${gateNote}\n`)
    return
  }

  fail(`未知门禁类型 '${kind}'（design|plan|verify）\n\n${USAGE}`, 2)
}

function cmdEvidence(args: ParsedArgs): void {
  const name = requirePositional(args, 0, '实例名')
  const command = flagString(args.flags, 'command')
  const exit = flagString(args.flags, 'exit')
  const summary = flagString(args.flags, 'summary')
  if (command === undefined || exit === undefined || summary === undefined) {
    fail('evidence 需要 --command "..." --exit <code> --summary "..." 三要素', 2)
  }
  const exitCode = Number.parseInt(exit, 10)
  if (!Number.isInteger(exitCode)) fail(`--exit 需为整数，收到 '${exit}'`, 2)
  if (exitCode !== 0) fail(`退出码 ${exitCode} 的验证不能作为完成证据（⑩：失败禁止宣称完成）`, 1)

  const repoRoot = repoRootOf(args.flags)
  const store = new InstanceStore(repoRoot)
  const instance = loadInstance(store, name)
  const machine = store.restoreMachine(instance)
  const durationRaw = flagString(args.flags, 'duration-ms')
  const timestamp = new Date().toISOString()
  const path = appendEvidence(repoRoot, name, {
    timestamp,
    command,
    exitCode,
    summary,
    ...(durationRaw === undefined ? {} : { durationMs: Number.parseInt(durationRaw, 10) }),
  })
  if (instance.snapshot.phase === 'verify' && !instance.snapshot.gates.verificationEvidence) {
    machine.recordVerification(path)
    store.saveMachine(name, instance.workflow, machine)
  }
  process.stdout.write(`证据已记录：${path}\n`)
  if (instance.snapshot.phase !== 'verify') {
    process.stdout.write(`提示：当前阶段为 ${instance.snapshot.phase}，证据仍会存档；verify→finish 门禁在 verify 阶段生效\n`)
  }
}

function cmdResume(args: ParsedArgs): void {
  const store = new InstanceStore(repoRootOf(args.flags))
  const name = args.positionals[0]
  let instance: PersistedInstance
  if (name === undefined) {
    const active = store.active()
    if (active.length === 0) {
      process.stdout.write(
        [
          '（无活跃流程实例）',
          '新需求：ff_dev init <name> --workflow feature|greenfield|change|hotfix',
          '流程总览：docs/process/README.md；入口资产：docs/process/skills/using-plugin-dev.md',
          '',
        ].join('\n'),
      )
      return
    }
    if (active.length > 1) {
      process.stdout.write(`多个活跃实例（${active.map(item => item.name).join(', ')}），请指定：ff_dev resume <name>\n`)
      return
    }
    instance = active[0]!
  } else {
    instance = loadInstance(store, name)
  }
  const profile = getWorkflowProfile(instance.workflow)
  const { snapshot } = instance
  const guidance = PHASE_GUIDANCE[snapshot.phase]
  const history = snapshot.history.map(record => record.phase).join(' → ')
  process.stdout.write(
    [
      '═══ FlowForge 流程接续简报（ff_dev resume）═══',
      `实例：${instance.name}（${profile.label}）`,
      `当前阶段：${snapshot.phase}（${PROCESS_PHASES.indexOf(snapshot.phase) + 1}/${PROCESS_PHASES.length}）`,
      `已走过：${history}`,
      `门禁：designApproved=${snapshot.gates.designApproved ? '✓' : '✗'} planValidated=${snapshot.gates.planValidated ? '✓' : '✗'} verificationEvidence=${snapshot.gates.verificationEvidence ? '✓' : '✗'}`,
      `本阶段产物要求：${profile.artifacts[snapshot.phase].join('；')}`,
      `下一步：${guidance.advice}`,
      `参考资产：${guidance.asset}`,
      '硬约束：验证证据（verify→finish）永不豁免；提交一律走 mgr PR。',
      '',
    ].join('\n'),
  )
}

function cmdSnapshot(args: ParsedArgs): void {
  const name = requirePositional(args, 0, '实例名')
  const store = new InstanceStore(repoRootOf(args.flags))
  const instance = loadInstance(store, name)
  const out = flagString(args.flags, 'out') ?? `${name}-snapshot.json`
  const target = resolve(out)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(instance, null, 2)}\n`, 'utf8')
  process.stdout.write(`快照已导出：${target}\n`)
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv)
  switch (args.command) {
    case 'init':
      cmdInit(args)
      return 0
    case 'list':
      cmdList(args)
      return 0
    case 'status':
      cmdStatus(args)
      return 0
    case 'advance':
      cmdAdvance(args)
      return 0
    case 'gate':
      cmdGate(args)
      return 0
    case 'evidence':
      cmdEvidence(args)
      return 0
    case 'resume':
      cmdResume(args)
      return 0
    case 'snapshot':
      cmdSnapshot(args)
      return 0
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(`${USAGE}\n`)
      return 0
    default:
      if (args.command !== '') process.stderr.write(`未知命令 '${args.command}'\n\n`)
      process.stderr.write(`${USAGE}\n`)
      return 2
  }
}

// Bin entry (bin/ff_dev.mjs imports this module and calls main).
if (process.env.FF_DEV_CLI_ENTRY === '1') {
  process.exitCode = main()
}

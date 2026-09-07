/**
 * @flowforge/plugin-dev — `ff_doctor` CLI (EP0-4).
 *
 * Compliance doctor (devforge SOP predicates, machine-checkable subset):
 * plan / state / docs / all. Runs in CI (ts-ci.yml) and locally; exit codes
 * are a contract: 0 = compliant, 1 = violation, 2 = usage error.
 *
 * @module @flowforge/plugin-dev/cli/doctor
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { validatePlan } from '../plan-validator.ts'
import { PROCESS_PHASES } from '../state-machine.ts'

const USAGE = `ff_doctor — FlowForge 流程遵从度检查（@flowforge/plugin-dev）

用法：
  ff_doctor plan <路径> [--fastpass]        No-Placeholder 计划校验
  ff_doctor state [--repo <root>] [--require-active]   实例状态一致性
  ff_doctor docs  [--repo <root>]           存量盘点（文档/包测试覆盖）
  ff_doctor all   [--repo <root>] [--require-active]   plan(活跃实例)+state 组合（CI 默认）

退出码：0 = 合规；1 = 违规；2 = 用法错误。`

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

function fail(message: string, code: 1 | 2 = 1): never {
  process.stderr.write(`ff_doctor: ${message}\n`)
  process.exit(code)
}

interface DoctorReport {
  violations: string[]
  notes: string[]
}

function doctorPlan(planPath: string, fastpass: boolean): DoctorReport {
  const violations: string[] = []
  const notes: string[] = []
  const absolute = resolve(planPath)
  if (!existsSync(absolute)) fail(`计划文档不存在：${absolute}`, 2)
  const markdown = readFileSync(absolute, 'utf8')
  const result = validatePlan(markdown, { fastpass })
  for (const issue of result.errors) {
    violations.push(`[${issue.code}] ${absolute}:${issue.line} ${issue.message}`)
  }
  notes.push(`计划 ${absolute}：${result.taskCount} 个任务，${result.errors.length} 处违规（fastpass=${fastpass}）`)
  return { violations, notes }
}

interface LoadedInstance {
  name: string
  workflow: string
  snapshot: {
    phase: string
    gates: { designApproved: boolean; planValidated: boolean; verificationEvidence: boolean }
    artifacts: Record<string, string | undefined>
  }
}

function doctorState(repoRoot: string, requireActive: boolean): DoctorReport {
  const violations: string[] = []
  const notes: string[] = []
  const instancesDir = join(repoRoot, 'docs', 'process', 'instances')
  const instances: LoadedInstance[] = []
  if (existsSync(instancesDir)) {
    for (const file of readdirSync(instancesDir).filter(item => item.endsWith('.json')).sort()) {
      try {
        instances.push(JSON.parse(readFileSync(join(instancesDir, file), 'utf8')))
      } catch (error) {
        violations.push(`实例文件 ${file} 不是合法 JSON：${(error as Error).message}`)
      }
    }
  }
  if (instances.length === 0) {
    if (requireActive) violations.push('仓库内无任何流程实例（代码变更必须挂 ff_dev 实例，见 docs/rules/13-dev-process.md）')
    else notes.push('无流程实例')
    return { violations, notes }
  }
  for (const instance of instances) {
    const { snapshot } = instance
    const phaseIndex = PROCESS_PHASES.indexOf(snapshot.phase as never)
    if (phaseIndex === -1) {
      violations.push(`实例 ${instance.name}：未知阶段 '${snapshot.phase}'`)
      continue
    }
    // Gate/phase consistency (machine invariants mirrored from state-machine.ts).
    if (phaseIndex >= PROCESS_PHASES.indexOf('plan') && !snapshot.gates.designApproved) {
      violations.push(`实例 ${instance.name}：已过 design 阶段但 designApproved=false（状态被绕过或损坏）`)
    }
    if (phaseIndex >= PROCESS_PHASES.indexOf('implement') && !snapshot.gates.planValidated) {
      violations.push(`实例 ${instance.name}：已过 plan 阶段但 planValidated=false`)
    }
    if (snapshot.phase === 'finish' && !snapshot.gates.verificationEvidence) {
      violations.push(`实例 ${instance.name}：finish 但无验证证据（verify 硬门禁被绕过）`)
    }
    // Recorded artifact paths must exist on disk.
    for (const [kind, path] of Object.entries(snapshot.artifacts)) {
      if (path === undefined || path.startsWith('[fastpass') || path.startsWith('score:')) continue
      if (!existsSync(resolve(repoRoot, path))) {
        violations.push(`实例 ${instance.name}：${kind} 产物路径不存在：${path}`)
      }
    }
    notes.push(`实例 ${instance.name}（${instance.workflow}）：${snapshot.phase}（${phaseIndex + 1}/7）`)
  }
  if (requireActive && !instances.some(instance => instance.snapshot.phase !== 'finish')) {
    violations.push('无活跃实例（--require-active：变更期间应有未完结实例或最新实例刚 finish）')
  }
  return { violations, notes }
}

function countMarkdown(dir: string): number {
  if (!existsSync(dir)) return 0
  let count = 0
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.md')) count += 1
    }
  }
  walk(dir)
  return count
}

function doctorDocs(repoRoot: string): DoctorReport {
  const notes: string[] = []
  const docsRoot = join(repoRoot, 'docs')
  notes.push('── 文档盘点（F-A-D-T 治理基线，ff_doctor docs）──')
  for (const dir of ['architecture', 'design', 'features', 'decisions', 'rules', 'prompts', 'test', 'refactor', 'process']) {
    notes.push(`docs/${dir}: ${countMarkdown(join(docsRoot, dir))} 个 .md`)
  }
  notes.push('── 包测试覆盖盘点 ──')
  const packagesRoot = join(repoRoot, 'packages')
  let withTests = 0
  const withoutTests: string[] = []
  if (existsSync(packagesRoot)) {
    for (const group of readdirSync(packagesRoot)) {
      const groupDir = join(packagesRoot, group)
      if (!statSync(groupDir).isDirectory()) continue
      for (const pkg of readdirSync(groupDir)) {
        const pkgDir = join(groupDir, pkg)
        if (!statSync(pkgDir).isDirectory()) continue
        const hasTests =
          existsSync(join(pkgDir, 'tests')) ||
          readdirSync(pkgDir).some(file => file.endsWith('.spec.ts') || file.endsWith('.test.ts'))
        if (hasTests) withTests += 1
        else withoutTests.push(`packages/${group}/${pkg}`)
      }
    }
  }
  notes.push(`有测试的包：${withTests}；无测试的包：${withoutTests.length}`)
  for (const pkg of withoutTests) notes.push(`  ⚠ 无测试：${pkg}`)
  notes.push('治理规则（EP0-7 / D2）：改动哪块、治理哪块——无测试包纳入改动批次的补测清单。')
  return { violations: [], notes }
}

export function main(argv: readonly string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv)
  const repoRoot = resolve(flagString(args.flags, 'repo') ?? process.cwd())
  const reports: DoctorReport[] = []

  switch (args.command) {
    case 'plan': {
      const planPath = args.positionals[0]
      if (planPath === undefined) fail(`plan 需要 <计划文档路径>\n\n${USAGE}`, 2)
      reports.push(doctorPlan(planPath, args.flags.has('fastpass')))
      break
    }
    case 'state':
      reports.push(doctorState(repoRoot, args.flags.has('require-active')))
      break
    case 'docs':
      reports.push(doctorDocs(repoRoot))
      break
    case 'all': {
      const state = doctorState(repoRoot, args.flags.has('require-active'))
      reports.push(state)
      // Validate plans of active instances sitting in the `plan` phase or later.
      for (const note of state.notes) {
        const match = /^实例 (.+?)（/.exec(note)
        if (match === null) continue
        const instancePath = join(repoRoot, 'docs', 'process', 'instances', `${match[1]}.json`)
        try {
          const instance = JSON.parse(readFileSync(instancePath, 'utf8')) as LoadedInstance
          const planPath = instance.snapshot.artifacts.plan
          if (
            planPath !== undefined &&
            !planPath.startsWith('[fastpass') &&
            existsSync(resolve(repoRoot, planPath))
          ) {
            reports.push(doctorPlan(resolve(repoRoot, planPath), false))
          }
        } catch {
          // state report already flags unparsable instances
        }
      }
      break
    }
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

  let violations = 0
  for (const report of reports) {
    for (const note of report.notes) process.stdout.write(`${note}\n`)
    for (const violation of report.violations) {
      process.stderr.write(`✗ ${violation}\n`)
      violations += 1
    }
  }
  if (violations > 0) {
    process.stderr.write(`ff_doctor: ${violations} 处违规\n`)
    return 1
  }
  process.stdout.write('ff_doctor: 合规 ✅\n')
  return 0
}

if (process.env.FF_DOCTOR_CLI_ENTRY === '1') {
  process.exitCode = main()
}

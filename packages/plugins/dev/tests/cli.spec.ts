/**
 * ff_dev / ff_doctor CLI contract suite (EP0-3 T0.3.6 + EP0-4 T0.4.5).
 *
 * Spawns the real bin entries (bin/ff_dev.mjs / bin/ff_doctor.mjs, tsx
 * direct-run) against a throwaway repo — the exit codes asserted here are the
 * contract CI (ts-ci.yml L4) and mgr (L3) rely on: 0 ok / 1 violation / 2 usage.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const ffDev = join(pkgRoot, 'bin', 'ff_dev.mjs')
const ffDoctor = join(pkgRoot, 'bin', 'ff_doctor.mjs')
const fixtures = join(pkgRoot, 'tests', 'fixtures')

let repo: string

function run(bin: string, args: readonly string[]): { status: number; out: string; err: string } {
  const child = spawnSync(process.execPath, [bin, ...args], {
    cwd: repo,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return { status: child.status ?? -1, out: child.stdout ?? '', err: child.stderr ?? '' }
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'ff-dev-cli-'))
  const validPlan = readFileSync(join(fixtures, 'valid-plan.md'), 'utf8')
  mkdirSync(join(repo, 'docs', 'process', 'specs'), { recursive: true })
  mkdirSync(join(repo, 'docs', 'process', 'plans'), { recursive: true })
  writeFileSync(join(repo, 'docs', 'process', 'specs', 'demo-design.md'), '# demo design\n', 'utf8')
  writeFileSync(join(repo, 'docs', 'process', 'plans', 'demo-plan.md'), validPlan, 'utf8')
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('ff_dev — 七阶段全链（feature 工作流）', () => {
  it('init creates the instance and prints next-step guidance', () => {
    const { status, out } = run(ffDev, ['init', 'demo', '--workflow', 'feature'])
    expect(status).toBe(0)
    expect(out).toContain('已创建实例 demo')
    expect(out).toContain('功能开发流程')
  })

  it('rejects unknown workflows with exit 2', () => {
    expect(run(ffDev, ['init', 'bad', '--workflow', 'spike']).status).toBe(2)
  })

  it('advances requirement → design and prints phase guidance', () => {
    const { status, out } = run(ffDev, ['advance', 'demo'])
    expect(status).toBe(0)
    expect(out).toContain('requirement → design')
  })

  it('blocks design → plan with exit 1 while the gate is closed (L2 硬门禁)', () => {
    const { status, err } = run(ffDev, ['advance', 'demo'])
    expect(status).toBe(1)
    expect(err).toContain("gate 'designApproved' closed")
  })

  it('rejects fastpass on non-hotfix workflows with exit 1', () => {
    expect(run(ffDev, ['gate', 'demo', 'design', '--fastpass']).status).toBe(1)
  })

  it('opens the design gate with evidence', () => {
    const { status, out } = run(ffDev, ['gate', 'demo', 'design', '--evidence', 'docs/process/specs/demo-design.md'])
    expect(status).toBe(0)
    expect(out).toContain('design 门禁已开')
  })

  it('rejects the plan gate without evidence (usage error)', () => {
    expect(run(ffDev, ['gate', 'demo', 'plan']).status).toBe(2)
  })

  it('opens the plan gate after No-Placeholder validation passes', () => {
    const { status, out } = run(ffDev, ['gate', 'demo', 'plan', '--evidence', 'docs/process/plans/demo-plan.md'])
    expect(status).toBe(0)
    expect(out).toContain('No-Placeholder 校验')
  })

  it('rejects a placeholder plan with exit 1 (违规列表输出)', () => {
    const placeholder = join(repo, 'docs', 'process', 'plans', 'placeholder.md')
    writeFileSync(placeholder, readFileSync(join(fixtures, 'placeholder-plan.md'), 'utf8'), 'utf8')
    const { status, err } = run(ffDev, ['gate', 'demo', 'plan', '--evidence', placeholder])
    expect(status).toBe(1)
    expect(err).toContain('PLACEHOLDER')
  })

  it('walks plan → implement → review → verify', () => {
    expect(run(ffDev, ['advance', 'demo']).status).toBe(0)
    expect(run(ffDev, ['advance', 'demo']).status).toBe(0)
    expect(run(ffDev, ['advance', 'demo']).status).toBe(0)
    expect(run(ffDev, ['advance', 'demo']).status).toBe(0)
  })

  it('blocks verify → finish with exit 1 until evidence exists (硬门禁永不豁免)', () => {
    const { status, err } = run(ffDev, ['advance', 'demo'])
    expect(status).toBe(1)
    expect(err).toContain("gate 'verificationEvidence' closed")
  })

  it('rejects failing verification as evidence (⑩ 失败禁止宣称完成)', () => {
    const { status } = run(ffDev, [
      'evidence', 'demo', '--command', 'pnpm vitest run', '--exit', '1', '--summary', '2 failed',
    ])
    expect(status).toBe(1)
  })

  it('records evidence, opens the verify gate, and finishes', () => {
    const { status, out } = run(ffDev, [
      'evidence', 'demo',
      '--command', 'pnpm vitest run',
      '--exit', '0',
      '--summary', '3 个测试通过，0 失败',
    ])
    expect(status).toBe(0)
    expect(out).toContain('证据已记录')
    expect(run(ffDev, ['advance', 'demo']).status).toBe(0)
  })

  it('status --json emits a parseable instance payload', () => {
    const { status, out } = run(ffDev, ['status', 'demo', '--json'])
    expect(status).toBe(0)
    const parsed = JSON.parse(out) as { name: string; snapshot: { phase: string } }
    expect(parsed.name).toBe('demo')
    expect(parsed.snapshot.phase).toBe('finish')
  })

  it('resume reports no active instances once finished', () => {
    const { status, out } = run(ffDev, ['resume'])
    expect(status).toBe(0)
    expect(out).toContain('无活跃流程实例')
  })
})

describe('ff_dev — hotfix fastpass 语义', () => {
  it('allows design fastpass only on the hotfix workflow', () => {
    expect(run(ffDev, ['init', 'fix1', '--workflow', 'hotfix']).status).toBe(0)
    expect(run(ffDev, ['gate', 'fix1', 'design', '--fastpass']).status).toBe(0)
  })
})

describe('ff_doctor — 遵从度四模式', () => {
  it('state reports compliance with exit 0 on the healthy repo', () => {
    const { status, out } = run(ffDoctor, ['state', '--repo', repo])
    expect(status).toBe(0)
    expect(out).toContain('demo')
  })

  it('all stays compliant (state + active-instance plan validation)', () => {
    expect(run(ffDoctor, ['all', '--repo', repo]).status).toBe(0)
  })

  it('plan flags the placeholder fixture with exit 1', () => {
    const { status, err } = run(ffDoctor, ['plan', join(fixtures, 'placeholder-plan.md')])
    expect(status).toBe(1)
    expect(err).toContain('ff_doctor: ')
  })

  it('plan exits 2 on a missing file', () => {
    expect(run(ffDoctor, ['plan', join(repo, 'no-such-plan.md')]).status).toBe(2)
  })

  it('state flags corrupted instance JSON with exit 1', () => {
    mkdirSync(join(repo, 'docs', 'process', 'instances'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'process', 'instances', 'broken.json'), '{ oops', 'utf8')
    const { status, err } = run(ffDoctor, ['state', '--repo', repo])
    expect(status).toBe(1)
    expect(err).toContain('broken.json')
  })

  it('state exits 1 with --require-active when no live instance exists', () => {
    // drop the corrupted file so this assertion isolates the require-active rule
    rmSync(join(repo, 'docs', 'process', 'instances', 'broken.json'), { force: true })
    // finish the hotfix instance first: gate plan (fastpass) → five advances to verify → evidence → finish
    run(ffDev, ['gate', 'fix1', 'plan', '--fastpass', '--evidence', join(fixtures, 'valid-plan.md')])
    for (let step = 0; step < 5; step += 1) {
      expect(run(ffDev, ['advance', 'fix1']).status).toBe(0)
    }
    expect(run(ffDev, [
      'evidence', 'fix1', '--command', 'regression', '--exit', '0', '--summary', '回归通过',
    ]).status).toBe(0)
    expect(run(ffDev, ['advance', 'fix1']).status).toBe(0)
    const { status } = run(ffDoctor, ['state', '--repo', repo, '--require-active'])
    expect(status).toBe(1)
  })

  it('usage errors exit 2', () => {
    expect(run(ffDoctor, ['bogus']).status).toBe(2)
    expect(run(ffDoctor, ['plan']).status).toBe(2)
  })
})

/**
 * No-Placeholder plan validator contract suite (EP0-2 T0.2.6):
 * a plan is only valid when every step carries the real content an
 * executor needs — placeholders, lazy references, missing headers,
 * and tasks without code/test steps are all blocked.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validatePlan } from '../src/plan-validator.ts'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const validPlan = readFileSync(join(fixturesDir, 'valid-plan.md'), 'utf8')
const placeholderPlan = readFileSync(join(fixturesDir, 'placeholder-plan.md'), 'utf8')

const VALID = [
  '**目标**：实现 X',
  '**架构**：单包实现',
  '**技术栈**：TypeScript',
  '**规格**：规格（Spec）引用 docs/x.md',
  '## 全局约束',
  '',
  '### 任务 1：实现功能',
  '',
  '- [ ] 步骤 1：写失败测试 tests/a.spec.ts',
  '- [ ] 步骤 2：实现函数（见下方代码）',
  '',
  '```ts',
  'export const one = 1',
  '```',
].join('\n')

describe('validatePlan — 合法计划', () => {
  it('passes the curated valid fixture with exactly one task', () => {
    const result = validatePlan(validPlan)
    expect(result.errors).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.taskCount).toBe(1)
  })

  it('passes a minimal well-formed plan', () => {
    const result = validatePlan(VALID)
    expect(result.errors).toEqual([])
    expect(result.passed).toBe(true)
  })
})

describe('validatePlan — 占位符拦截', () => {
  it('blocks TBD / TODO / 待补充 / 细节略 class placeholders', () => {
    for (const token of ['TBD', 'TODO', '待补充', '细节略']) {
      const plan = VALID.replace('实现函数（见下方代码）', `实现函数（${token}）`)
      const result = validatePlan(plan)
      expect(result.passed).toBe(false)
      expect(result.errors.some(issue => issue.code === 'PLACEHOLDER')).toBe(true)
    }
  })

  it('does not flag placeholders inside code fences', () => {
    const plan = `${VALID}\n\n\`\`\`ts\nconst TODO = 'inside fence is fine'\n\`\`\`\n`
    const result = validatePlan(plan)
    expect(result.errors.filter(issue => issue.code === 'PLACEHOLDER')).toEqual([])
  })
})

describe('validatePlan — 惰性引用拦截', () => {
  it('blocks 类似任务 N / 同上 style lazy references', () => {
    for (const lazy of ['类似任务 1 的方式', '与上述任务相同', '为上述代码编写测试']) {
      const plan = VALID.replace('写失败测试 tests/a.spec.ts', lazy)
      const result = validatePlan(plan)
      expect(result.passed).toBe(false)
      expect(result.errors.some(issue => issue.code === 'LAZY_REFERENCE')).toBe(true)
    }
  })
})

describe('validatePlan — 任务头五要素', () => {
  it('flags every missing required header', () => {
    const result = validatePlan('# 只有标题\n\n### 任务 1：x\n\n- [ ] 步骤 1：写测试 tests/a.spec.ts\n')
    const missing = result.errors.filter(issue => issue.code === 'MISSING_HEADER')
    expect(missing.map(issue => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('目标') as unknown as string,
        expect.stringContaining('架构') as unknown as string,
        expect.stringContaining('技术栈') as unknown as string,
        expect.stringContaining('规格') as unknown as string,
        expect.stringContaining('全局约束') as unknown as string,
      ]),
    )
  })
})

describe('validatePlan — 任务结构', () => {
  it('rejects a plan without any 任务 sections', () => {
    const result = validatePlan(
      '**目标**：x\n**架构**：x\n**技术栈**：x\n**规格**：规格（x）\n## 全局约束\n- x\n',
    )
    expect(result.errors.some(issue => issue.code === 'NO_TASKS')).toBe(true)
  })

  it('rejects tasks without checkbox steps', () => {
    const plan = `${VALID}\n\n### 任务 2：无步骤任务\n\n只有一段话，没有任何步骤。\n`
    const result = validatePlan(plan)
    expect(result.errors.some(issue => issue.code === 'TASK_NO_STEPS')).toBe(true)
  })

  it('rejects tasks without code blocks or test hints (non-fastpass)', () => {
    const plan = [
      '**目标**：x', '**架构**：x', '**技术栈**：x', '**规格**：规格（x）', '## 全局约束', '- x',
      '### 任务 1：无代码无测试',
      '- [ ] 步骤 1：直接实现功能',
    ].join('\n')
    const result = validatePlan(plan)
    expect(result.errors.some(issue => issue.code === 'TASK_NO_CODE')).toBe(true)
    expect(result.errors.some(issue => issue.code === 'TASK_NO_TEST')).toBe(true)
  })

  it('fastpass relaxes code/test step checks (hotfix 复现测试计划语义)', () => {
    const plan = [
      '**目标**：修复 bug', '**架构**：单点修复', '**技术栈**：TypeScript', '**规格**：规格（根因分析记录）',
      '## 全局约束', '- 回归证据永不豁免',
      '### 任务 1：复现并修复',
      '- [ ] 步骤 1：写复现测试（红）',
      '- [ ] 步骤 2：最小修复（绿）',
    ].join('\n')
    expect(validatePlan(plan).passed).toBe(false)
    expect(validatePlan(plan, { fastpass: true }).passed).toBe(true)
  })
})

describe('validatePlan — fixture 反例', () => {
  it('collects placeholder + lazy-reference + header + task violations', () => {
    const result = validatePlan(placeholderPlan)
    expect(result.passed).toBe(false)
    const codes = result.errors.map(issue => issue.code)
    expect(codes).toContain('PLACEHOLDER') // TBD / 细节略
    expect(codes).toContain('LAZY_REFERENCE') // 同上 / 类似任务 1
    expect(codes).toContain('MISSING_HEADER') // 无全局约束
    expect(codes).toContain('TASK_NO_CODE')
    expect(codes).toContain('TASK_NO_TEST')
  })
})

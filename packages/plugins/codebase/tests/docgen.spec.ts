/**
 * docgen contract suite (EP-CB2, T3.4).
 *
 * The document generator feeds @flowforge/plugin-dev: it consumes the graph
 * query surface and emits Markdown skeletons for the spec/plan templates.
 * Pins the No-Placeholder discipline (structural headings only) and the
 * out_path write behavior.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectNotFoundError, generateDocument } from '../src/index.ts'
import { PROJECT, useMiniRepoFixture } from './_fixture.ts'

const fixture = useMiniRepoFixture()
const store = () => fixture.store

describe('generateDocument', () => {
  let outDir: string

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'ff-codebase-docgen-'))
  })

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('emits a spec skeleton with structural headings (No-Placeholder)', () => {
    const result = generateDocument(store(), { project: PROJECT, template: 'spec', outPath: '.' })
    expect(result.template).toBe('spec')
    const headings = result.sections.map(section => section.heading)
    expect(headings[0]).toMatch(/^# 设计规格：/)
    expect(headings).toEqual(expect.arrayContaining(['## 1. 目标', '## 2. 范围', '## 6. 测试策略', '## 7. 验收标准']))
    for (const section of result.sections) expect(section.body).toBeTruthy()
  })

  it('emits a plan skeleton wired to the mgr PR / T1-T9 constraints', () => {
    const result = generateDocument(store(), { project: PROJECT, template: 'plan', outPath: '.' })
    const headings = result.sections.map(section => section.heading)
    expect(headings).toContain('## 任务清单')
    const globals = result.sections.find(section => section.heading === '## 全局约束')?.body ?? ''
    expect(globals).toContain('./mgr PR')
    expect(globals).toContain('T1-T9')
  })

  it('writes the document to the requested out_path', () => {
    const outPath = join(outDir, 'gen.md')
    const result = generateDocument(store(), { project: PROJECT, template: 'spec', outPath })
    expect(result.outPath).toBe(outPath)
    expect(existsSync(outPath)).toBe(true)
    expect(readFileSync(outPath, 'utf8')).toContain('设计规格')
  })

  it('throws ProjectNotFoundError for an unknown project', () => {
    expect(() => generateDocument(store(), { project: 'ghost', template: 'spec', outPath: '.' })).toThrow(ProjectNotFoundError)
  })
})
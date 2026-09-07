/**
 * @flowforge/plugin-codebase — document generator (EP-CB2, T3.4).
 *
 * Feeds @flowforge/plugin-dev: consumes the knowledge-graph query surface and
 * emits Markdown skeletons for the plugin-dev `specs/` (design) and `plans/`
 * (implementation) templates. The generator produces STRUCTURE only — section
 * headings and source-of-truth pointers (module list, symbol inventory, hot
 * files, dependency edges) — never fabricated prose. This honors the dev
 * plugin's No-Placeholder discipline: no "TODO"/"TBD" bodies pretending to be
 * complete content.
 *
 * @module @flowforge/plugin-codebase/docgen
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CodebaseStore } from './store.ts'
import { ProjectNotFoundError, schemaFor } from './query.ts'
import { getArchitecture } from './architecture.ts'
import type { ArchitectureResult } from './architecture.ts'

export type DocTemplate = 'spec' | 'plan'

export interface DocgenOptions {
  readonly project: string
  readonly template: DocTemplate
  readonly featureName?: string
  readonly outPath?: string
}

export interface DocgenSection {
  readonly heading: string
  readonly body: string
}

export interface DocgenResult {
  readonly outPath: string
  readonly template: DocTemplate
  readonly sections: readonly DocgenSection[]
}

const DATE = new Date().toISOString().slice(0, 10)

/** Generate a document skeleton and (when out_path given) write it to disk. */
export function generateDocument(store: CodebaseStore, options: DocgenOptions): DocgenResult {
  const project = options.project
  if (store.listProjects().find(info => info.name === project) === undefined) {
    throw new ProjectNotFoundError(project)
  }
  const arch = getArchitecture(store, { project, depth: 2 })
  const schema = schemaFor(store, project)
  const feature = options.featureName ?? featureFromProject(project)

  const sections = options.template === 'spec'
    ? specSections(project, arch, schema)
    : planSections(project, arch)

  const outPath = options.outPath ?? defaultOutPath(project, feature, options.template)
  if (outPath === '.') {
    return { outPath, template: options.template, sections }
  }
  writeFileSync(resolve(outPath), render(outPath, sections, feature), 'utf8')
  return { outPath, template: options.template, sections }
}

function specSections(project: string, arch: ArchitectureResult, schema: ReturnType<typeof schemaFor>): DocgenSection[] {
  const symbolTypes = schema.nodeLabels.filter(label => label.count > 0).map(label => label.label).join('、')
  return [
    { heading: '# 设计规格：{feature}', body: `（骨架 —— ${DATE} 由 @flowforge/plugin-codebase 依据图谱 ${project} 生成）` },
    { heading: '## 1. 目标', body: describe(arch) },
    { heading: '## 2. 范围', body: `图谱 ${project}：模块 ${arch.moduleCount} 个，符号类型 ${symbolTypes || '（无）'}。` },
    { heading: '## 3. 现状（图谱供料）', body: moduleSnippet(arch) },
    { heading: '## 4. 决策记录', body: `- 决策落点：docs/decisions/（manage_adr 对接）\n- 参考 ADR：见 docs/decisions/ 目录。` },
    { heading: '## 5. 数据契约', body: '<!-- 目标数据结构与接口签名（骨架） -->' },
    { heading: '## 6. 测试策略', body: '<!-- 测试计划（骨架） -->' },
    { heading: '## 7. 验收标准', body: '<!-- 可验证的完成标准（骨架） -->' },
  ]
}

function planSections(project: string, arch: ArchitectureResult): DocgenSection[] {
  return [
    { heading: '# 实施计划：{feature}', body: `（骨架 —— ${DATE} 由 @flowforge/plugin-codebase 依据图谱 ${project} 生成）` },
    { heading: '## 目标', body: describe(arch) },
    { heading: '## 任务清单', body: taskSnippet(arch) },
    { heading: '## 全局约束', body: `- 提交走 ./mgr PR；单文件 ≤ 1000 行。\n- T1-T9 测试铁律（禁止 Mock）.` },
    { heading: '## 验证', body: '<!-- 验收命令与证据收集（骨架） -->' },
  ]
}

function describe(arch: ArchitectureResult): string {
  const hot = arch.hotFiles[0]
  const hotLine = hot === undefined ? '（无热点文件中样本）' : `热点：${hot.filePath}${hot.complexity === undefined ? '' : `（复杂度 ${hot.complexity}）`}`
  return `依赖图谱 ${arch.project} 的模块边界生成 {feature} 的设计/实施骨架。${hotLine}`
}

function moduleSnippet(arch: ArchitectureResult): string {
  if (arch.modules.length === 0) return '（无模块边界样本）'
  const lines = arch.modules.slice(0, 30).map(module => `- ${module.name}（${module.fileCount} 文件）`)
  return lines.join('\n')
}

function taskSnippet(arch: ArchitectureResult): string {
  if (arch.modules.length === 0) return '1. 任务 1（骨架，待展开）'
  return arch.modules.slice(0, 10).map((module, index) => `${index + 1}. ${module.name} 相关任务（骨架，待展开）`).join('\n')
}

function featureFromProject(project: string): string {
  return project.replace(/[_-]/g, ' ').trim()
}

function defaultOutPath(project: string, _feature: string, template: DocTemplate): string {
  const label = `${DATE}-${project}-${template === 'spec' ? 'design' : 'plan'}`
  return `${template === 'spec' ? 'docs/process/specs' : 'docs/process/plans'}/${label}.md`
}

function render(_outPath: string, sections: readonly DocgenSection[], feature: string): string {
  return sections
    .map(section => {
      const heading = section.heading.replaceAll('{feature}', feature)
      return `${heading}\n\n${section.body.replaceAll('{feature}', feature)}`
    })
    .join('\n\n')
}
/**
 * get_architecture contract suite (EP-CB2, T3.1c).
 *
 * Derives module boundaries from the indexed file tree, aggregates cross-module
 * dependencies, and ranks hot files by complexity then degree.
 */

import { describe, expect, it } from 'vitest'
import { ProjectNotFoundError, getArchitecture } from '../src/index.ts'
import { PROJECT, useMiniRepoFixture } from './_fixture.ts'

const fixture = useMiniRepoFixture()
const store = () => fixture.store

describe('getArchitecture', () => {
  it('aggregates modules from the file tree at a given depth', () => {
    const result = getArchitecture(store(), { project: PROJECT, depth: 1 })
    expect(result.project).toBe(PROJECT)
    // depth 1 → top-level dirs: docs, src, symbols, plus root-level files ("README.md", "package.json").
    const names = result.modules.map(module => module.name)
    expect(names).toEqual(expect.arrayContaining(['src', 'symbols', 'docs']))
    expect(result.moduleCount).toBe(result.modules.length)
  })

  it('reports cross-module dependencies with edge-type aggregation', () => {
    const result = getArchitecture(store(), { project: PROJECT, depth: 1 })
    // demo.ts (symbols) calls helper.ts (src) → a cross-module dependency.
    const dep = result.dependencies.find(dependency => dependency.from === 'symbols' && dependency.to === 'src')
    expect(dep).toBeDefined()
    expect(dep?.edgeTypes).toContain('CALLS')
  })

  it('ranks hot files deterministically and caps at 10', () => {
    const result = getArchitecture(store(), { project: PROJECT, depth: 1 })
    expect(result.hotFiles.length).toBeLessThanOrEqual(10)
    if (result.hotFiles.length > 1) {
      const sorted = [...result.hotFiles].sort((a, b) =>
        (b.complexity ?? -1) - (a.complexity ?? -1) || b.degree - a.degree || a.filePath.localeCompare(b.filePath))
      expect(result.hotFiles.map(file => file.filePath)).toEqual(sorted.map(file => file.filePath))
    }
  })

  it('throws ProjectNotFoundError for an unknown project', () => {
    expect(() => getArchitecture(store(), { project: 'ghost' })).toThrow(ProjectNotFoundError)
  })
})
/**
 * manage_adr contract suite (EP-CB2, T3.3).
 *
 * ADR lifecycle over a real `docs/decisions/` directory: list (ascending id,
 * skip non-ADR files), read, and create (sequential numbering + front-matter
 * template). Pins the exit-code-1 not-found semantics via AdrNotFoundError.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdrNotFoundError, createAdr, getAdr, listAdrs, nextAdrId } from '../src/index.ts'

describe('manage_adr', () => {
  let dir: string
  let decisions: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ff-codebase-adr-'))
    decisions = join(dir, 'docs', 'decisions')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns an empty listing when the directory does not exist', () => {
    const result = listAdrs(decisions)
    expect(result.total).toBe(0)
    expect(result.adrs).toEqual([])
  })

  it('creates the first ADR as #1 and lists it', () => {
    const created = createAdr({ directory: decisions, title: 'Use TypeScript', action: 'create' })
    expect(created.id).toBe(1)
    expect(created.fileName).toMatch(/^0001-use-typescript\.md$/)
    const list = listAdrs(decisions)
    expect(list.total).toBe(1)
    expect(list.adrs[0]).toMatchObject({ id: 1, title: 'Use TypeScript' })
  })

  it('increments ADR numbering and reads back content', () => {
    createAdr({ directory: decisions, title: 'First', action: 'create' })
    expect(nextAdrId(decisions)).toBe(2)
    const second = createAdr({ directory: decisions, title: 'Decision: Second', action: 'create' })
    expect(second.id).toBe(2)
    const got = getAdr(decisions, 2)
    expect(got.title).toBe('Decision: Second')
    expect(got.content).toContain('# ADR-2: Decision: Second')
    expect(got.content).toContain('## Status')
  })

  it('ignores non-ADR markdown files when listing', () => {
    syncAdr(decisions, '0001-real.md', '# ADR-1: Real')
    syncAdr(decisions, 'README.md', '# Project Decisions')
    const list = listAdrs(decisions)
    expect(list.total).toBe(1)
    expect(list.adrs.map(entry => entry.id)).toEqual([1])
  })

  it('throws AdrNotFoundError for a missing record', () => {
    expect(() => getAdr(decisions, 99)).toThrow(AdrNotFoundError)
  })
})

function syncAdr(decisions: string, fileName: string, content: string): void {
  mkdirSync(decisions, { recursive: true })
  writeFileSync(join(decisions, fileName), content)
}
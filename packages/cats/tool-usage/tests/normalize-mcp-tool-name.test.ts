import { describe, expect, it } from 'vitest'
import { normalizeMcpToolName } from '../src/normalize-mcp-tool-name.ts'

describe('normalizeMcpToolName', () => {
  it('passes through native names', () => {
    expect(normalizeMcpToolName('Read')).toBe('Read')
    expect(normalizeMcpToolName('search_evidence')).toBe('search_evidence')
  })

  it('reduces Claude Code MCP format', () => {
    expect(normalizeMcpToolName('mcp__cat-cafe__search_evidence')).toBe('search_evidence')
  })

  it('reduces Codex MCP format', () => {
    expect(normalizeMcpToolName('mcp:cat-cafe/post_message')).toBe('post_message')
  })

  it('strips cat_cafe_ server prefix from flat names', () => {
    expect(normalizeMcpToolName('cat_cafe_search_evidence')).toBe('search_evidence')
  })

  it('returns unknown for nullish input', () => {
    expect(normalizeMcpToolName(null)).toBe('unknown')
    expect(normalizeMcpToolName(undefined)).toBe('unknown')
    expect(normalizeMcpToolName('')).toBe('unknown')
  })
})
/**
 * MCP assembly contract suite (EP-CB2, T3.5).
 *
 * Pins the tool-lsp assembly shape (`{ name, description, inputSchema }`) for
 * the model-facing surface, and that write tools (index_repository /
 * delete_project) stay out of READ_ONLY_TOOL_NAMES.
 */

import { describe, expect, it } from 'vitest'
import { codebaseToolCards, isCodebaseTool, READ_ONLY_TOOL_NAMES } from '../src/index.ts'

describe('MCP 装配（对齐 tool-lsp）', () => {
  it('exposes every read-only tool as a toc card with the contract shape', () => {
    const cards = codebaseToolCards()
    for (const card of cards) {
      expect(card.name).toBeTypeOf('string')
      expect(card.description).toBeTypeOf('string')
      expect(card.inputSchema).toBeTypeOf('object')
    }
    expect(cards.some(card => card.name === 'search_graph')).toBe(true)
  })

  it('excludes write tools from the model-facing surface', () => {
    expect(READ_ONLY_TOOL_NAMES).not.toContain('index_repository')
    expect(READ_ONLY_TOOL_NAMES).not.toContain('delete_project')
  })

  it('validates tool-name membership for dispatch', () => {
    expect(isCodebaseTool('trace_path')).toBe(true)
    expect(isCodebaseTool('index_repository')).toBe(false)
    expect(isCodebaseTool('not-a-tool')).toBe(false)
  })
})
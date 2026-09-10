import { describe, expect, it } from 'vitest'
import { classifyTool, isMcpToolName } from '../src/classify.ts'

describe('classifyTool', () => {
  it('classifies native tools', () => {
    expect(classifyTool('Read', undefined)).toEqual({ category: 'native', toolName: 'Read' })
    expect(classifyTool('Bash', undefined)).toEqual({ category: 'native', toolName: 'Bash' })
  })

  it('classifies Skill tool with real name from toolInput', () => {
    expect(classifyTool('Skill', { skill: 'memory-navigator' })).toEqual({
      category: 'skill',
      toolName: 'memory-navigator',
    })
  })

  it('falls back to unknown skill when toolInput.skill is missing', () => {
    expect(classifyTool('Skill', undefined)).toEqual({ category: 'skill', toolName: 'unknown' })
  })

  it('recognizes Claude Code MCP format (mcp__server__tool)', () => {
    expect(classifyTool('mcp__cat-cafe__post_message', undefined)).toEqual({
      category: 'mcp',
      toolName: 'mcp__cat-cafe__post_message',
      mcpServer: 'cat-cafe',
    })
  })

  it('recognizes Codex MCP format (mcp:server/tool)', () => {
    expect(classifyTool('mcp:cat-cafe/post_message', undefined)).toEqual({
      category: 'mcp',
      toolName: 'mcp:cat-cafe/post_message',
      mcpServer: 'cat-cafe',
    })
  })

  it('treats bare prefixed names as native (F150 design choice)', () => {
    expect(classifyTool('cat_cafe_search_evidence', undefined).category).toBe('native')
  })
})

describe('isMcpToolName', () => {
  it('matches wrapped and bare MCP prefixes', () => {
    expect(isMcpToolName('mcp__s__t')).toBe(true)
    expect(isMcpToolName('mcp:s/t')).toBe(true)
    expect(isMcpToolName('cat_cafe_x')).toBe(true)
    expect(isMcpToolName('signal_y')).toBe(true)
    expect(isMcpToolName('Read')).toBe(false)
    expect(isMcpToolName('search_evidence')).toBe(false)
  })
})
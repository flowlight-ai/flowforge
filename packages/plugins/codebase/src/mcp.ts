/**
 * @flowforge/plugin-codebase — MCP assembly (EP-CB2, T3.5).
 *
 * Wraps the read-only tool surface into the tool-lsp assembly contract used by
 * the flowforge mcp tooling system: `{ name, description, inputSchema, execute }`
 * registry cards. Write tools (index_repository / delete_project) stay out of
 * the model-facing surface. This module stays a plain, cordis-free library —
 * harness mounting (EP1) wires it into the actual model/daemon.
 *
 * @module @flowforge/plugin-codebase/mcp
 */

import type { ToolName } from './tools.ts'
import { TOOLS } from './tools.ts'

/** Assembly contract mirroring @flowforge/tool-lsp. */
export interface McpTocCard {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** Read-only tool names (model-facing; write tools are excluded). */
export const READ_ONLY_TOOL_NAMES: readonly string[] = TOOLS
  .filter(tool => tool.name !== 'index_repository' && tool.name !== 'delete_project')
  .map(tool => tool.name)

/** Table-of-contents cards for the model-facing tool surface. */
export function codebaseToolCards(): readonly McpTocCard[] {
  const names = new Set<string>(READ_ONLY_TOOL_NAMES)
  return TOOLS
    .filter(tool => names.has(tool.name))
    .map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))
}

/** Validate that a name resolves to a codebase tool (for tool-lsp dispatch). */
export function isCodebaseTool(name: string): name is ToolName {
  return READ_ONLY_TOOL_NAMES.includes(name as ToolName)
}
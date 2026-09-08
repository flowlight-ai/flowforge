/**
 * Self-contained MCP tool result types.
 *
 * Replaces the domain-coupled `ToolResult` / `errorResult` / `successResult`
 * imported from clowder's `tools/file-tools.ts`.
 */

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function successResult(text: string): ToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}
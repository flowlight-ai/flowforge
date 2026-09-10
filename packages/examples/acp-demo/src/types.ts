/**
 * Type model for a minimal Agent Client Protocol (ACP) turn. This example scopes
 * ACP to the pieces a demo need not delegate elsewhere: a message with content
 * blocks, the shell request that carries them, and the agent's response.
 * @module @flowforge/acp-demo/types
 */

/** One content block inside an ACP message. */
export type AcpContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'toolUse'; readonly toolName: string; readonly input: Readonly<Record<string, unknown>> }

/** A single ACP message with a role and ordered content blocks. */
export interface AcpMessage {
  readonly id?: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly content: readonly AcpContentBlock[]
}

/** The request `sessions.prompt` carries to the agent. */
export interface AcpPromptRequest {
  readonly messages: readonly AcpMessage[]
}

/** Why the agent stopped producing blocks. */
export type AcpStopReason = 'endOfTurn' | 'toolUse' | 'maxTurns'

/** The result the agent returns for a prompt request. */
export interface AcpPromptResponse {
  readonly messages: readonly AcpMessage[]
  readonly stopReason: AcpStopReason
}

/** Callback contract an agent implementation must honour. */
export type AcpResponder = (request: AcpPromptRequest) => AcpPromptResponse | Promise<AcpPromptResponse>
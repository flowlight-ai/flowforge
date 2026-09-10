/**
 * @flowforge/acp-demo — a minimal runnable example of the Agent Client
 * Protocol interaction shape. It shows:
 *  1. the *types* that describe a session.turn,
 *  2. the *assembly* that turns a responder into a client-facing prompt flow,
 *  3. *usage* of the assembled runner against a plain deterministic responder.
 *
 * No on-wire protocol or transport is implemented here; this package exists to
 * illustrate how the common types and the runner compose, so newer packages can
 * copy the pattern. To run it:
 *
 * ```ts
 * import { runPrompt, echoResponder } from '@flowforge/acp-demo'
 *
 * const result = await runPrompt(
 *   { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] },
 *   echoResponder,
 * )
 * console.log(result.stopReason)
 * ```
 * @module @flowforge/acp-demo
 */

import type {
  AcpContentBlock,
  AcpMessage,
  AcpPromptRequest,
  AcpResponder,
} from './types.ts'

export type {
  AcpContentBlock,
  AcpMessage,
  AcpPromptRequest,
  AcpPromptResponse,
  AcpResponder,
  AcpStopReason,
} from './types.ts'

/**
 * Assemble an ACP turn: normalize the request, forward it to the responder,
 * then wraps the responder's produced message into a prompt response.
 * @param request - the incoming prompt request.
 * @param responder - the agent that produces assistant content.
 * @returns a settled prompt response with a stop reason.
 */
export async function runPrompt(
  request: AcpPromptRequest,
  responder: AcpResponder,
): Promise<Awaited<ReturnType<AcpResponder>>> {
  const response = await responder(request)
  return {
    messages: response.messages,
    stopReason: response.stopReason,
  }
}

/**
 * Assemble a message from plain blocks — the small factory client UIs use to
 * hand user input to {@link runPrompt}.
 * @param role - 'user', 'assistant', or 'system'.
 * @param blocks - already-typed content blocks.
 * @returns the assembled message.
 */
export function makeMessage(role: AcpMessage['role'], blocks: readonly AcpContentBlock[]): AcpMessage {
  return { role, content: blocks }
}

/**
 * A fully wired responder for examples/tests: parrots the last user text block
 * back as an assistant message and stops the turn. This is the fixed "agent"
 * that makes the assembly runnable with zero external services.
 */
export const echoResponder: AcpResponder = async (request: AcpPromptRequest) => {
  const lastUser = [...request.messages]
    .reverse()
    .find(message => message.role === 'user')
  const lastText = lastUser?.content
    .filter((block): block is Extract<AcpContentBlock, { type: 'text' }> => block.type === 'text')
    .at(-1)?.text ?? 'no text found'
  return {
    messages: [
      makeMessage('user', lastUser?.content ?? []),
      makeMessage('assistant', [{ type: 'text', text: `echo: ${lastText}` }]),
    ],
    stopReason: 'endOfTurn',
  }
}
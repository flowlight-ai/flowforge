/**
 * Per-agent execution timeout.
 *
 * Maps flowforge Python legacy core/agent_timeout.py (F25):
 * AgentTimeoutError with message `Agent 'X' timed out after Ns` and a
 * wrapper enforcing the timeout around an execute() call.
 */

export class AgentTimeoutError extends Error {
  readonly agentName: string
  readonly timeout: number

  constructor(agentName: string, timeout: number) {
    super(`Agent '${agentName}' timed out after ${timeout}s`)
    this.name = 'AgentTimeoutError'
    this.agentName = agentName
    this.timeout = timeout
  }
}

/**
 * Race `task` against a timeout. On timeout the underlying promise is
 * left running (fire-and-forget) and AgentTimeoutError is thrown —
 * mirroring asyncio.wait_for semantics for the wrapper use case.
 */
export async function withTimeout<T>(
  task: Promise<T>,
  timeoutSeconds: number,
  agentName: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentTimeoutError(agentName, timeoutSeconds)), timeoutSeconds * 1000)
  })
  try {
    return await Promise.race([task, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * @flowforge/cats-cloud-bridge — shared domain types.
 *
 * Models the round-trip of a local cat invocation that must be dispatched to a
 * hosted (cloud) runtime: a request that names the capabilities the local cat
 * lacks, a streamed/conversation-host response, and a delta payload that is
 * bound back onto the local thread.
 */

/** Outcome of a cloud dispatch. */
export type CloudInvokeStatus = 'pending' | 'completed' | 'failed' | 'redirected'

export interface CloudInvokeContextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

export interface CloudSegment {
  seq: number
  kind: 'text' | 'tool'
  content: string
}

export interface CloudInvokeRequest {
  invocationId: string
  threadId: string
  catId: string
  userId: string
  query: string
  contextMessages: CloudInvokeContextMessage[]
  /** Capabilities the local cat declares it lacks and the cloud must provide. */
  requiredCapabilities: string[]
}

export interface CloudInvokeResponse {
  invocationId: string
  status: Exclude<CloudInvokeStatus, 'pending'>
  segments: CloudSegment[]
  summary?: string
  errorCode?: string
  errorMessage?: string
}

/** A minimal delta op for applying cloud output onto a local conversation. */
export interface DeltaOp {
  op: 'append' | 'replace' | 'remove'
  segmentSeq?: number
  kind?: 'text' | 'tool'
  content?: string
}

export type DeltaPayload = DeltaOp[]

/** Snapshot of the conversation host (the remote surface driving the cat). */
export interface HostSnapshot {
  threadId: string
  assistantSegments: CloudSegment[]
  updatedAt: number
}
/**
 * Incremental session-log retrieval bridge for official DeepSeek LLM API
 * requests. Accepted sequence watermarks live in the canonical log, so restart
 * recovery can conservatively resend uncertain tails without maintaining
 * another store. The retrieval core is a pure query over an injected
 * `SessionLogPort`; the cordis plugin contribution is optional glue.
 *
 * @module @flowforge/session-log-deepseek
 */

import type { JsonValue, SessionEvent, SessionId } from '@flowforge/session'
import { isSurfaceEvent, SessionId as sessionIdOf } from '@flowforge/session'
import type {
  DeepSeekSessionLogExtension,
  DeepSeekSessionLogWireEvent,
  DeepSeekSessionLogWireHeader,
} from './types.ts'

export type * from './types.ts'

/** Pure retrieval port: the minimal session-log reads the bridge needs. */
export interface SessionLogPort {
  /** The session's canonical header. */
  readonly header: {
    readonly version: number
    readonly id: SessionId
    readonly createdAt: number
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }
  /** Highest committed sequence so far (the log length). */
  readonly seq: number
  /** Immutable snapshot of the whole canonical log. */
  readonly events: readonly SessionEvent[]
  /** Append one typed event to the log. */
  append(type: 'session-log-deepseek/delivery-accepted', data: {
    sessionId: SessionId
    sessionFormatVersion: number
    throughSeq: number
  }): SessionEvent<'session-log-deepseek/delivery-accepted'>
}

/** Translate logical Session metadata to raw external request fields. */
export function wireHeader(session: SessionLogPort): DeepSeekSessionLogWireHeader {
  const header = session.header
  return {
    version: header.version,
    id: String(header.id),
    createdAt: header.createdAt,
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    ...header.parentSession === undefined ? {} : { parentSession: String(header.parentSession) },
    ...header.seedLength === undefined ? {} : { seedLength: header.seedLength },
    ...header.origin === undefined ? {} : { origin: header.origin },
    ...header.delegationDepth === undefined ? {} : { delegationDepth: header.delegationDepth },
    ...header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset },
  }
}

/** Translate compile-time sequence numbers to raw numeric request fields. */
export function wireEvent(event: SessionEvent): DeepSeekSessionLogWireEvent {
  const surfaceEvent = isSurfaceEvent(event) ? event : undefined
  const surfaceOp = surfaceEvent?.surfaceOp
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    data: event.data as JsonValue,
    ...event.ignorable === undefined ? {} : { ignorable: event.ignorable },
    ...surfaceEvent?.sourceEventSeqs === undefined
      ? {}
      : { sourceEventSeqs: surfaceEvent.sourceEventSeqs.map(Number) },
    ...surfaceOp === undefined
      ? {}
      : surfaceOp === 'append'
        ? { surfaceOp }
        : { surfaceOp: { op: 'replace' as const, start: surfaceOp.start, end: surfaceOp.end } },
  }
}

interface AcceptanceFold {
  readonly scannedEvents: number
  readonly throughSeq: number
}

const acceptanceFolds = new WeakMap<object, AcceptanceFold>()

/**
 * Highest confirmed sequence for this exact Session format generation.
 * @param session - canonical log whose matching acceptance events are folded.
 * @returns greatest accepted sequence, or `-1` before any accepted request.
 */
export function acceptedThrough(session: SessionLogPort): number {
  const previous = acceptanceFolds.get(session as object)
  let throughSeq = previous?.throughSeq ?? -1
  const length = session.seq
  const start = previous?.scannedEvents ?? 0
  for (let index = start; index < length; index++) {
    const event = session.events[index]
    if (event === undefined) {
      throw new Error(`session-log-deepseek: missing event ${String(index)} below captured length ${String(length)}`)
    }
    if (event.type !== 'session-log-deepseek/delivery-accepted') continue
    const acceptedFormatVersion = event.data.sessionFormatVersion ?? 0
    if (!Number.isSafeInteger(acceptedFormatVersion)
      || acceptedFormatVersion < 0
      || Object.is(acceptedFormatVersion, -0)) {
      throw new Error(`session-log-deepseek: malformed acceptance format version at seq ${event.seq}`)
    }
    if (acceptedFormatVersion !== session.header.version) continue
    const acceptedSeq = event.data.throughSeq
    if (typeof event.data.sessionId !== 'string' || event.data.sessionId.length === 0
      || !Number.isSafeInteger(acceptedSeq) || acceptedSeq < 0
      || acceptedSeq >= event.seq) {
      throw new Error(`session-log-deepseek: malformed acceptance watermark at seq ${event.seq}`)
    }
    if (event.data.sessionId !== session.header.id) continue
    if (acceptedSeq > throughSeq) throughSeq = acceptedSeq
  }
  acceptanceFolds.set(session as object, { scannedEvents: length, throughSeq })
  return throughSeq
}

/**
 * Retrieve the incremental `dsh_session_log` contribution for one request,
 * or `undefined` when the request names no session or the log has no new suffix.
 * @param port - injected session-log reads (pure query seam).
 * @param sessionId - raw request session identity, when present.
 * @returns the wire extension plus its idempotent acceptance watermark commit.
 */
export function retrieveSessionLog(
  port: SessionLogPort,
  sessionId?: string,
): { readonly value: DeepSeekSessionLogExtension; accept(): void } | undefined {
  if (sessionId === undefined) return undefined
  if (port.header.id !== sessionIdOf(sessionId)) return undefined

  const afterSeq = acceptedThrough(port)
  const events = port.events
  const throughEvent = events.at(-1)
  if (throughEvent === undefined) return undefined
  const throughSeq = throughEvent.seq
  if (throughSeq <= afterSeq) return undefined
  const suffix = events.slice(afterSeq + 1)
  const value: DeepSeekSessionLogExtension = {
    version: 1,
    sessionFormatVersion: port.header.version,
    session: wireHeader(port),
    afterSeq: afterSeq,
    throughSeq: throughSeq,
    events: suffix.map(wireEvent),
  }
  return {
    value,
    accept: () => {
      port.append('session-log-deepseek/delivery-accepted', {
        sessionId: port.header.id,
        sessionFormatVersion: port.header.version,
        throughSeq,
      })
    },
  }
}
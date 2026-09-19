/**
 * Versionless, JSON-lines wire protocol between the Node host and the CPython
 * subprocess. Frames travel on two pipes (one JSON object per line each),
 * leaving stdout/stderr free for the program's own output. The host treats
 * every inbound frame as hostile because model code can post anything through
 * the same pipe; the Python bootstrap trusts host replies.
 * @module @flowforge/code-runtime-python/src/protocol
 */

/**
 * The framed-JSON channel's file descriptor from the child's perspective. The
 * host pins it positionally when it spawns the child: the HOST WRITES
 * host->child frames (boot/run/reply) to `stdio[3]` (child fd 3, READ-only
 * there) and the child WRITES child->host frames (boot-ack/call/log/done) to
 * `stdio[4]` (child fd 4). The directions are split onto two pipes so the child
 * can read and write concurrently — a single pipe handle blocked-read and
 * -written from separate threads stalls a second write on Windows.
 */
export const PROTOCOL_FD = 3

/** One binding namespace declaration inside a {@link BootMessage}. */
export interface Namespace {
  global: string
  names: string[]
  errorClass?: ErrorClass
}

/** A namespace's program-visible exception class. */
export interface ErrorClass {
  name: string
  memberNameProperty: string
}

/** What the host sends immediately after spawn, as the first line on fd 3. */
export interface BootMessage {
  type: 'boot'
  /** Shared byte budget for the combined outer result envelope. */
  maxOutputBytes: number
  /** The namespaces to materialize inside the program. */
  namespaces: Namespace[]
}

/** Host → Python: sent after `boot-ack`; carries only the model's program body. */
export interface RunMessage {
  type: 'run'
  program: string
}

/** Python → host: acknowledges boot completed and protocol setup is in place. */
export interface BootAckMessage {
  type: 'boot-ack'
}

/** Python → host: one bridged binding call (`await tools.name(args)` inside the program). */
export interface CallMessage {
  type: 'call'
  id: number
  global: string
  name: string
  /** The JSON-safe argument the model program passed. */
  args: unknown
}

/** Python → host: captured text, streamed eagerly so output survives a mid-run termination. */
export interface LogMessage {
  type: 'log'
  text: string
}

/** The failure carried on a {@link DoneMessage}: one of three kinds plus text. */
interface DoneErrorField {
  kind: 'exception' | 'invalid-output' | 'output-limit'
  message: string
}

/** Python → host: the program settled. `value`/`error` are optional; see the class doc. */
export interface DoneMessage {
  type: 'done'
  value?: unknown
  error?: DoneErrorField
}

/** Every message the Python side sends. */
export type ChildToHost = BootAckMessage | CallMessage | LogMessage | DoneMessage

/** Host → Python: successful answer to one {@link CallMessage}. */
interface ReplyOk {
  type: 'reply'
  id: number
  ok: true
  value: unknown
}

/** Host → Python: failed answer to one {@link CallMessage}. */
interface ReplyErr {
  type: 'reply'
  id: number
  ok: false
  message: string
}

/** Host → Python: the answer to one {@link CallMessage}. */
export type ReplyMessage = ReplyOk | ReplyErr

/** Lazily yield one plain object's own enumerable property values. */
function* ownValues(record: object): Generator {
  for (const key in record) {
    if (Object.hasOwn(record, key)) yield (record as Record<string, unknown>)[key]
  }
}

/**
 * Whether a JSON.parse-produced value contains a number outside lossless JSON:
 * non-finite (`1e400` parses to `Infinity`) or negative zero (`-0.0` parses to
 * JS `-0`). The honest child rejects these before sending, so a frame carrying
 * one is forged. Traversal is iterative, so a deep frame cannot overflow the
 * host stack.
 */
export function hasNonLosslessNumber(value: unknown): boolean {
  const cursors: Iterator<unknown>[] = [[value].values()]
  while (cursors.length > 0) {
    const cursor = cursors.at(-1) as Iterator<unknown>
    const step = cursor.next()
    if (step.done === true) {
      cursors.pop()
      continue
    }
    const current = step.value
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) return true
    } else if (Array.isArray(current)) {
      cursors.push((current as unknown[]).values())
    } else if (typeof current === 'object' && current !== null) {
      cursors.push(ownValues(current))
    }
  }
  return false
}

/**
 * Whether a raw JSON line contains an integer token that would lose precision
 * as a JavaScript number. `JSON.parse` silently rounds such a token BEFORE any
 * validation can see it, so the check reads the source text; a beyond-safe
 * double whose parse round-trips exactly is lossless and passes.
 */
export function hasUnsafeIntegerToken(line: string): boolean {
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      // Skip the string literal, honoring backslash escapes.
      for (index++; index < line.length; index++) {
        if (line[index] === '\\') index++
        else if (line[index] === '"') break
      }
      continue
    }
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) {
      let end = index + 1
      while (end < line.length) {
        const c = line[end] as string
        if ((c >= '0' && c <= '9') || c === '.' || c === 'e' || c === 'E' || c === '+' || c === '-') end++
        else break
      }
      const token = line.slice(index, end)
      // Beyond the safe range an integer token is still lossless IFF the double
      // parse round-trips exactly (2**53 does; 2**53+1 rounds).
      if (/^-?\d+$/.test(token)) {
        const parsed = Number(token)
        if (!Number.isFinite(parsed)) return true
        if (!Number.isSafeInteger(parsed) && BigInt(token) !== BigInt(parsed)) return true
      }
      index = end - 1
    }
  }
  return false
}

/**
 * One scalar (null, boolean, finite number) as JSON text. A beyond-safe-range
 * integral double needs BigInt digits so the seam's lossless-JSON promise holds
 * across the wire.
 */
function scalarJson(current: unknown): string {
  if (typeof current === 'number' && Number.isInteger(current) && !Number.isSafeInteger(current)) {
    return BigInt(current).toString()
  }
  return String(current)
}

/**
 * Serialize one JSON-plain value without recursion. `JSON.stringify` recurses
 * per nesting level and throws `RangeError` a few thousand levels deep; this
 * iterative encoder carries any depth the seam allows. Output matches compact
 * `JSON.stringify` byte for byte EXCEPT on an integral double beyond the safe
 * range, where {@link scalarJson} emits the exact integer's BigInt digits.
 */
export function encodeJsonPlain(value: unknown): string {
  type Task = { text: string } | { value: unknown }
  const chunks: string[] = []
  const tasks: Task[] = [{ value }]
  for (let task = tasks.pop(); task !== undefined; task = tasks.pop()) {
    if ('text' in task) {
      chunks.push(task.text)
      continue
    }
    const current = task.value
    if (typeof current === 'string') {
      chunks.push(JSON.stringify(current))
    } else if (Array.isArray(current)) {
      chunks.push('[')
      tasks.push({ text: ']' })
      for (let index = current.length - 1; index >= 0; index--) {
        if (index < current.length - 1) tasks.push({ text: ',' })
        tasks.push({ value: current[index] })
      }
    } else if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, unknown>
      chunks.push('{')
      tasks.push({ text: '}' })
      const keys = Object.keys(record)
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index] as string
        if (index < keys.length - 1) tasks.push({ text: ',' })
        tasks.push({ value: record[key] })
        tasks.push({ text: `${JSON.stringify(key)}:` })
      }
    } else {
      chunks.push(scalarJson(current))
    }
  }
  return chunks.join('')
}

/**
 * Runtime shape gate for inbound fd-3 traffic. Model code has full access to
 * fd 3 and can post anything; every field is validated and REBUILT before the
 * host reads it. Junk returns `undefined` and is dropped so a throw in the
 * host's message handler cannot crash the host process.
 */
export function validateChildFrame(raw: unknown): ChildToHost | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const m = raw as Record<string, unknown>
  switch (m.type) {
    case 'boot-ack': return { type: 'boot-ack' }
    case 'log': {
      if (typeof m.text !== 'string') return undefined
      return { type: 'log', text: m.text }
    }
    case 'call': {
      if (typeof m.id !== 'number' || !Number.isFinite(m.id) || Object.is(m.id, -0) || typeof m.global !== 'string' || typeof m.name !== 'string') return undefined
      if (!Object.hasOwn(m, 'args')) return undefined
      if (hasNonLosslessNumber(m.args)) return undefined
      return { type: 'call', id: m.id, global: m.global, name: m.name, args: m.args }
    }
    case 'done': {
      const err = m.error
      if (err === undefined) {
        return m.value === undefined ? { type: 'done' } : { type: 'done', value: m.value }
      }
      if (typeof err !== 'object' || err === null) return undefined
      const { kind, message } = err as Record<string, unknown>
      if (typeof message !== 'string') return undefined
      if (kind !== 'exception' && kind !== 'invalid-output' && kind !== 'output-limit') return undefined
      return m.value === undefined
        ? { type: 'done', error: { kind, message } }
        : { type: 'done', value: m.value, error: { kind, message } }
    }
    default: return undefined
  }
}
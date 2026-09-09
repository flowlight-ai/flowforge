/**
 * Local lossless Assistant-stream accumulator / assembler / expander.
 *
 * Ported from dsh dsh-llm `src/assistant-stream.ts` and the assistant-relevant
 * parts of dsh-llm `src/assembler.ts`, self-contained so this package has no
 * dependency on any `@deepseek-ai/*` runtime import. The chunk vocabulary is
 * reduced to the lossless JSON shapes the durable v1/v2 Session boundaries
 * actually carry; brand and message-creation host helpers are omitted.
 * @module @flowforge/session-format-v1-to-v2/pure/assistant-stream
 */

import { deepFreeze, snapshotJsonValue } from '@flowforge/session-format'

/** One model chunk as carried by a durable assistant/chunk or embedded stream. */
export type StreamChunk = {
  readonly type: string
} & { readonly [key: string]: unknown }

/** One model chunk paired with its original Session timestamp. */
export interface TimedStreamChunk {
  readonly time: number
  readonly chunk: StreamChunk
}

/** Lossless compact records embedded in durable Assistant attempt events. */
export type AssistantStreamRecord =
  | {
    readonly type: 'text-chunks'
    readonly time0: number
    readonly index: number
    readonly dt: readonly number[]
    readonly texts: readonly string[]
  }
  | {
    readonly type: 'reasoning-chunks'
    readonly time0: number
    readonly index: number
    readonly dt: readonly number[]
    readonly texts: readonly string[]
  }
  | {
    readonly type: 'tool-call-chunks'
    readonly time0: number
    readonly index: number
    readonly dt: readonly number[]
    readonly id: string
    readonly name?: string
    readonly args: readonly string[]
  }
  | { readonly type: 'chunk'; readonly time: number; readonly chunk: StreamChunk }

type MutableRecord =
  | {
    type: 'text-chunks' | 'reasoning-chunks'
    time0: number
    index: number
    dt: number[]
    texts: string[]
    lastTime: number
  }
  | {
    type: 'tool-call-chunks'
    time0: number
    index: number
    dt: number[]
    id: string
    name?: string
    args: string[]
    lastTime: number
  }
  | { type: 'chunk'; time: number; chunk: StreamChunk }

function safeTime(value: number): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Assistant stream time must be a safe integer, got ${String(value)}`)
  return value
}

function safeIndex(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label} index must be a non-negative safe integer`)
  }
  return value
}

function snapshotChunk(chunk: StreamChunk): StreamChunk {
  const snapshot = snapshotJsonValue(chunk)
  if (snapshot === undefined) throw new TypeError('Assistant stream chunk must be losslessly JSON-serializable')
  return snapshot as StreamChunk
}

function safeGap(previous: number, next: number): number | undefined {
  const gap = next - previous
  return Number.isSafeInteger(gap) && previous + gap === next ? gap : undefined
}

/**
 * Incrementally compacts one attempt without retaining a second raw-chunk list.
 * The compact run keeps only the last record's opening boundary for gap probes.
 */
export class AssistantStreamAccumulator {
  private readonly records: MutableRecord[] = []

  /**
   * Add one timed chunk to the compact attempt stream.
   * @param value - model chunk and its original Session timestamp.
   * @returns a detached immutable copy for assembly and live publication.
   */
  push(value: TimedStreamChunk): TimedStreamChunk {
    const time = safeTime(value.time)
    const chunk = snapshotChunk(value.chunk)
    const timed = deepFreeze({ time, chunk })
    const previous = this.records.at(-1)
    switch (chunk.type) {
      case 'text-delta':
      case 'reasoning-delta': {
        safeIndex(chunk.index as number, chunk.type)
        if (typeof chunk.text !== 'string') throw new TypeError(`${chunk.type} text must be a string`)
        const type = chunk.type === 'text-delta' ? 'text-chunks' : 'reasoning-chunks'
        const gap = previous !== undefined && previous.type === type ? safeGap(previous.lastTime, time) : undefined
        if (previous !== undefined && previous.type === type && previous.index === chunk.index && gap !== undefined) {
          previous.dt.push(gap)
          previous.texts.push(chunk.text as string)
          previous.lastTime = time
        } else {
          this.records.push({ type, time0: time, index: chunk.index as number, dt: [], texts: [chunk.text as string], lastTime: time })
        }
        return timed
      }
      case 'tool-call-delta': {
        safeIndex(chunk.index as number, chunk.type)
        if (typeof chunk.id !== 'string') throw new TypeError('tool-call-delta id must be a string')
        if (Object.hasOwn(chunk, 'name') && typeof chunk.name !== 'string') {
          throw new TypeError('tool-call-delta name must be a string')
        }
        if (typeof chunk.argumentsDelta !== 'string') {
          throw new TypeError('tool-call-delta argumentsDelta must be a string')
        }
        if (chunk.id.length === 0 || chunk.name === '') {
          this.records.push({ type: 'chunk', time, chunk })
          return timed
        }
        const gap = previous?.type === 'tool-call-chunks' ? safeGap(previous.lastTime, time) : undefined
        const sameName = previous?.type === 'tool-call-chunks'
          && Object.hasOwn(previous, 'name') === Object.hasOwn(chunk, 'name')
          && previous.name === chunk.name
        if (previous?.type === 'tool-call-chunks'
          && previous.index === chunk.index
          && previous.id === chunk.id
          && sameName
          && gap !== undefined) {
          previous.dt.push(gap)
          previous.args.push(chunk.argumentsDelta as string)
          previous.lastTime = time
        } else {
          const record: MutableRecord = {
            type: 'tool-call-chunks',
            time0: time,
            index: chunk.index as number,
            dt: [],
            id: chunk.id as string,
            ...(Object.hasOwn(chunk, 'name') ? { name: chunk.name as string } : {}),
            args: [chunk.argumentsDelta as string],
            lastTime: time,
          }
          this.records.push(record)
        }
        return timed
      }
      case 'block-start':
      case 'block-end':
      case 'usage':
      case 'finish':
        this.records.push({ type: 'chunk', time, chunk })
        return timed
      default:
        return assertNever(chunk as never, 'AssistantStreamAccumulator.push')
    }
  }

  /**
   * Return the current compact attempt stream.
   * @returns a detached immutable record list suitable for a durable event.
   */
  snapshot(): readonly AssistantStreamRecord[] {
    const records = this.records.map((record): AssistantStreamRecord => {
      if (record.type === 'chunk') return { ...record }
      const { lastTime: _lastTime, ...durable } = record
      if (durable.type === 'tool-call-chunks') {
        return { ...durable, dt: [...durable.dt], args: [...durable.args] }
      }
      return { ...durable, dt: [...durable.dt], texts: [...durable.texts] }
    })
    return deepFreeze(records)
  }
}

/**
 * Expand compact records into the exact timed chunk sequence.
 * @param stream - compact records from one durable Assistant settlement.
 * @returns detached timed chunks with every original delta boundary preserved.
 * @throws {TypeError} when a record or reconstructed timestamp is invalid.
 */
export function expandAssistantStream(stream: readonly AssistantStreamRecord[]): readonly TimedStreamChunk[] {
  const chunks: TimedStreamChunk[] = []
  for (const candidate of stream) {
    const record = validateRecord(candidate)
    if (record.type === 'chunk') {
      chunks.push({ time: record.time, chunk: record.chunk })
      continue
    }
    const members = record.type === 'tool-call-chunks' ? record.args : record.texts
    let time = record.time0
    for (let index = 0; index < members.length; index += 1) {
      if (index > 0) time += record.dt[index - 1] as number
      let chunk: StreamChunk
      if (record.type === 'text-chunks') {
        chunk = { type: 'text-delta', index: record.index, text: members[index] as string }
      } else if (record.type === 'reasoning-chunks') {
        chunk = { type: 'reasoning-delta', index: record.index, text: members[index] as string }
      } else {
        chunk = {
          type: 'tool-call-delta',
          index: record.index,
          id: record.id,
          ...Object.hasOwn(record, 'name') ? { name: record.name } : {},
          argumentsDelta: members[index] as string,
        }
      }
      chunks.push({ time, chunk })
    }
  }
  return chunks
}

function validateRecord(value: unknown): AssistantStreamRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Assistant stream record must be an object')
  }
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'text-chunks':
    case 'reasoning-chunks': {
      exactKeys(record, ['type', 'time0', 'index', 'dt', 'texts'], record.type as string)
      const texts = stringArray(record.texts, `${String(record.type)} texts`)
      if (texts.length === 0) throw new TypeError(`${String(record.type)} texts must be non-empty`)
      validateRun(record, texts.length, String(record.type))
      return record as unknown as AssistantStreamRecord
    }
    case 'tool-call-chunks': {
      const keys = Object.hasOwn(record, 'name')
        ? ['type', 'time0', 'index', 'dt', 'id', 'name', 'args']
        : ['type', 'time0', 'index', 'dt', 'id', 'args']
      exactKeys(record, keys, record.type as string)
      const args = stringArray(record.args, 'tool-call-chunks args')
      if (args.length === 0) throw new TypeError('tool-call-chunks args must be non-empty')
      if (typeof record.id !== 'string' || record.id.length === 0) {
        throw new TypeError('tool-call-chunks id must be a non-empty string')
      }
      if (record.name !== undefined && (typeof record.name !== 'string' || record.name.length === 0)) {
        throw new TypeError('tool-call-chunks name must be a non-empty string')
      }
      validateRun(record, args.length, record.type as string)
      return record as unknown as AssistantStreamRecord
    }
    case 'chunk': {
      exactKeys(record, ['type', 'time', 'chunk'], 'chunk')
      const time = safeTime(record.time as number)
      if (typeof record.chunk !== 'object'
        || record.chunk === null
        || Array.isArray(record.chunk)) {
        throw new TypeError('Assistant stream raw chunk must be a lossless JSON object')
      }
      let chunk: StreamChunk
      try {
        chunk = snapshotChunk(record.chunk as StreamChunk)
      } catch (error: unknown) {
        throw new TypeError('Assistant stream raw chunk must be a lossless JSON object', { cause: error })
      }
      return deepFreeze({ type: 'chunk', time, chunk })
    }
    default:
      throw new TypeError(`Unsupported Assistant stream record ${JSON.stringify(record.type)}`)
  }
}

function validateRun(record: Record<string, unknown>, members: number, label: string): void {
  safeTime(record.time0 as number)
  safeIndex(record.index as number, label)
  if (!Array.isArray(record.dt) || record.dt.some(value => !Number.isSafeInteger(value))) {
    throw new TypeError(`${label} dt must contain safe integers`)
  }
  if (record.dt.length !== members - 1) {
    throw new TypeError(`${label} dt length must be one less than its members`)
  }
  let time = record.time0 as number
  for (const gap of record.dt as number[]) {
    time += gap
    if (!Number.isSafeInteger(time)) throw new TypeError(`${label} member times must stay safe integers`)
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(member => typeof member !== 'string')) {
    throw new TypeError(`${label} must be a string array`)
  }
  return value as string[]
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key))) {
    throw new TypeError(`${label} Assistant stream record must contain exactly ${keys.join(', ')}`)
  }
}

/**
 * Incrementally assembles raw {@link StreamChunk}s into complete content blocks.
 * Open blocks assemble from their accumulated deltas; a max-token finish drops
 * tool calls that cannot be executed safely and prunes replay metadata in step.
 */
export class BlockAssembler {
  private partials = new Map<number, PartialBlock>()
  private order: number[] = []
  private _usage: unknown = undefined
  private _finish: { readonly reason: unknown; readonly replayState?: unknown } | undefined

  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'text-delta':
      case 'reasoning-delta': {
        const partial = this.ensure(chunk.index as number, chunk.type === 'text-delta' ? 'text' : 'reasoning')
        if (partial.block) return // closed by block-end; ignore stragglers
        partial.text += chunk.text as string
        return
      }
      case 'tool-call-delta': {
        const partial = this.ensure(chunk.index as number, 'tool-call')
        if (partial.block) return // closed by block-end; ignore stragglers
        partial.toolCallId = chunk.id as string
        if (chunk.name) partial.toolCallName = chunk.name as string
        partial.toolCallArguments += chunk.argumentsDelta as string
        return
      }
      case 'block-start': {
        if (!this.partials.has(chunk.index as number)) {
          this.order.push(chunk.index as number)
          this.partials.set(chunk.index as number, {
            blockType: chunk.blockType as string,
            text: '',
            toolCallArguments: '',
          })
        }
        return
      }
      case 'block-end': {
        const partial = this.ensure(chunk.index as number, (chunk.block as Record<'type', unknown>)?.['type'] as string)
        // First close wins; ignoring re-close stragglers keeps streamed output
        // and the final assembled block in agreement.
        if (partial.block) return
        partial.block = chunk.block as Record<string, unknown>
        return
      }
      case 'usage': {
        this._usage = chunk.usage
        return
      }
      case 'finish': {
        this._finish = { reason: chunk.reason, ...Object.hasOwn(chunk, 'replayState') ? { replayState: chunk.replayState } : {} }
        return
      }
      default: return assertNever(chunk as never, 'BlockAssembler.push')
    }
  }

  private ensure(index: number, blockType: string): PartialBlock {
    let partial = this.partials.get(index)
    if (!partial) {
      partial = { blockType, text: '', toolCallArguments: '' }
      this.partials.set(index, partial)
      this.order.push(index)
    }
    return partial
  }

  private assemble(partial: PartialBlock, index: number): Record<string, unknown> {
    if (partial.block !== undefined) return partial.block
    switch (partial.blockType) {
      case 'text': return { type: 'text', text: partial.text }
      case 'reasoning': return { type: 'reasoning', text: partial.text }
      case 'tool-call': return {
        type: 'tool-call',
        id: partial.toolCallId ?? `call-${index}`,
        name: partial.toolCallName ?? '',
        arguments: partial.toolCallArguments,
      }
      default: throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`)
    }
  }

  /** Invariant accessor: every index in `order` has a partial. */
  private mustGet(index: number): PartialBlock {
    const partial = this.partials.get(index)
    if (partial === undefined) throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`)
    return partial
  }

  /**
   * The one shared keep/drop decision over all seen blocks: max-token truncation
   * drops tool calls that cannot be executed safely. Emitted blocks and replay
   * metadata both derive from this result, so they cannot disagree.
   */
  private assembled(): { blocks: Array<Record<string, unknown>>; replay: unknown } {
    const all = this.order.map(index => this.assemble(this.mustGet(index), index))
    const kept = this.finishReason() === 'max-tokens'
      ? all.map(block => block['type' as never] !== 'tool-call')
      : undefined
    const blocks = kept === undefined ? all : all.filter((_, position) => kept[position] as boolean)
    const envelope = this._finish?.replayState
    if (envelope === undefined) return { blocks, replay: undefined }
    const envelopeBlocks = (envelope as Record<string, unknown>)['blocks']
    if (!Array.isArray(envelopeBlocks)) return { blocks, replay: undefined }
    if (envelopeBlocks.length !== all.length) return { blocks, replay: undefined }
    return {
      blocks,
      replay: kept === undefined || blocks.length === all.length
        ? envelope
        : { response: (envelope as Record<string, unknown>)['response'], blocks: envelopeBlocks.filter((_, position) => kept[position] as boolean) },
    }
  }

  private finishReason(): string {
    const reason = this._finish?.reason
    return typeof reason === 'object' && reason !== null ? (reason as Record<string, unknown>)['kind'] as string : 'stop'
  }

  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks(): Array<Record<string, unknown>> {
    return this.assembled().blocks
  }

  /**
   * Assemble the prefix an interrupted stream can safely finalize: closed and
   * open text/reasoning blocks with non-whitespace content, in stream order.
   * Tool calls are omitted because interruption precedes dispatch.
   * @returns the kept blocks; empty when nothing streamed before the interruption.
   */
  interruptedBlocks(): Array<Record<string, unknown>> {
    return this.order
      .map((index) => {
        const partial = this.mustGet(index)
        const type = partial.block?.type ?? partial.blockType
        if (type !== 'text' && type !== 'reasoning') return undefined
        return this.assemble(partial, index)
      })
      .filter((block): block is Record<string, unknown> => block !== undefined
        && (block['type'] === 'text' || block['type'] === 'reasoning')
        && (block['text'] as string || '').trim() !== '')
  }

  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage(): unknown {
    return this._usage
  }

  /** Replay metadata from the terminal finish chunk, if any, pruned in step with {@link blocks}. */
  get replayState(): unknown {
    return this.assembled().replay
  }
}

interface PartialBlock {
  blockType: string
  text: string
  toolCallId?: string
  toolCallName?: string
  toolCallArguments: string
  /** Set by `block-end` — authoritative, and freezes the partial. */
  block?: Record<string, unknown>
}

function assertNever(value: never, label: string): never {
  throw new TypeError(`${label} cannot accept chunk type ${JSON.stringify((value as { type?: unknown })['type'] ?? value)}`)
}
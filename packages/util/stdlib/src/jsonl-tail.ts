/**
 * JSONL tail reader — read the last matching line of a JSON-lines file
 * without loading the whole file into memory.
 *
 * Ported from clowder-ai `api/src/utils/jsonl-tail-reader.ts`.
 * Only depends on Node built-ins (`node:fs`).
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'

const DEFAULT_CHUNK_SIZE = 8192
const DEFAULT_MAX_LINES = 10_000
const DEFAULT_MAX_BYTES = 1_048_576
const LEADING_BUFFER_CAP = 1_048_576

export interface ReadJsonlTailOptions {
  readonly maxLines?: number
  readonly maxBytes?: number
  readonly predicate: (parsed: unknown) => boolean
}

/**
 * Scan a JSONL file from the tail and return the newest line whose parsed
 * value satisfies `predicate`. Returns `undefined` when the file is missing,
 * empty, the predicate never matches, or scan limits are hit.
 */
export function readJsonlTail<T = unknown>(filePath: string, opts: ReadJsonlTailOptions): T | undefined {
  const maxLines = opts.maxLines ?? DEFAULT_MAX_LINES
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  let fd: number
  let size: number
  try {
    fd = openSync(filePath, 'r')
    size = statSync(filePath).size
  } catch {
    return undefined
  }

  try {
    if (size === 0) return undefined

    const buffer = Buffer.alloc(DEFAULT_CHUNK_SIZE)
    let position = size
    let bytesRead = 0
    let linesScanned = 0
    let leadingBuffer = Buffer.alloc(0)

    while (position > 0) {
      const chunkSize = Math.min(DEFAULT_CHUNK_SIZE, position)
      position -= chunkSize
      bytesRead += chunkSize

      const n = readSync(fd, buffer, 0, chunkSize, position)
      if (n === 0) break

      const combined = Buffer.concat([buffer.subarray(0, n), leadingBuffer])
      const parts: Buffer[] = []
      let segmentStart = 0
      for (let i = 0; i < combined.length; i += 1) {
        if (combined[i] === 0x0a) {
          parts.push(combined.subarray(segmentStart, i))
          segmentStart = i + 1
        }
      }
      parts.push(combined.subarray(segmentStart))

      let processFromIndex: number
      if (position === 0) {
        processFromIndex = 0
        leadingBuffer = Buffer.alloc(0)
      } else {
        processFromIndex = 1
        leadingBuffer = Buffer.from(parts[0]!)
        if (leadingBuffer.length > LEADING_BUFFER_CAP) return undefined
      }

      for (let i = parts.length - 1; i >= processFromIndex; i -= 1) {
        const lineBytes = parts[i]!
        if (lineBytes.length === 0) continue
        linesScanned += 1
        if (linesScanned > maxLines) return undefined

        let parsed: unknown
        try {
          parsed = JSON.parse(lineBytes.toString('utf8'))
        } catch {
          continue
        }

        if (opts.predicate(parsed)) {
          return parsed as T
        }
      }

      if (bytesRead >= maxBytes) return undefined
    }

    return undefined
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* best-effort */
    }
  }
}
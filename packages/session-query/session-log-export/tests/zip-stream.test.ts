/** `pure/zip.ts` 流式生产的反压、取消、错误与编码正确性契约测试。 */

import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import {
  streamSessionLogZipFromEntries,
  type SessionLogZipEntry,
} from '../src/pure/zip.ts'

async function collectBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

const anError = () => new Error('boom')

/** 把一个条目数组转为异步可迭代（张量脚注避免 `as` 链式类型噪声）。 */
function toIterable(entries: readonly SessionLogZipEntry[]): AsyncIterable<SessionLogZipEntry> {
  return (async function* (): AsyncGenerator<SessionLogZipEntry> {
    for (const entry of entries) yield entry
  })()
}

describe('streamSessionLogZipFromEntries', () => {
  it('把一个文本条目的 zip 正确打包并可回读文本', async () => {
    const bytes = await collectBytes(streamSessionLogZipFromEntries(
      toIterable([{ path: 'a.txt', content: 'hello world' }]),
      6,
      new AbortController().signal,
    ))
    const entries = unzipSync(bytes)
    expect(strFromU8(entries['a.txt'])).toBe('hello world')
  })

  it('二进制条目以原始字节回读', async () => {
    const data = new Uint8Array([0, 1, 2, 253, 254, 255])
    const bytes = await collectBytes(streamSessionLogZipFromEntries(
      toIterable([{ path: 'media/img.png', data }]),
      6,
      new AbortController().signal,
    ))
    const entries = unzipSync(bytes)
    expect([...entries['media/img.png']]).toEqual([...data])
  })

  it('流式文件条目整段回读', async () => {
    const chunks = [[1, 2], [3, 4, 5], [6]].map(arr => new Uint8Array(arr))
    async function* fileChunks(): AsyncGenerator<Uint8Array> {
      for (const chunk of chunks) yield chunk
    }
    const bytes = await collectBytes(streamSessionLogZipFromEntries(
      toIterable([{ path: 'files/a', chunks: fileChunks() }]),
      6,
      new AbortController().signal,
    ))
    const entries = unzipSync(bytes)
    expect([...entries['files/a']]).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('多个条目按序打包', async () => {
    const bytes = await collectBytes(streamSessionLogZipFromEntries(
      toIterable([
        { path: 'one', content: '一' },
        { path: 'two', content: '二' },
      ]),
      6,
      new AbortController().signal,
    ))
    const unzipped = unzipSync(bytes)
    expect(strFromU8(unzipped['one'])).toBe('一')
    expect(strFromU8(unzipped['two'])).toBe('二')
  })

  it('压缩级别 0 仍产生合法可回读 zip', async () => {
    const bytes = await collectBytes(streamSessionLogZipFromEntries(
      toIterable([{ path: 'x', content: 'stored' }]),
      0,
      new AbortController().signal,
    ))
    expect(strFromU8(unzipSync(bytes)['x'])).toBe('stored')
  })

  it('跨代理对分块后仍无损回读（surrogate 回退）', async () => {
    const pair = String.fromCodePoint(0x1f600)
    const content = 'a'.repeat((1 << 16) - 1) + pair + 'b'
    const bytes = await collectBytes(streamSessionLogZipFromEntries(
      toIterable([{ path: 'emoji', content }]),
      6,
      new AbortController().signal,
    ))
    expect(strFromU8(unzipSync(bytes)['emoji'])).toBe(content)
  })

  it('慢消费端（反压）仍产出完整且正确的 zip', async () => {
    const content = 'chunk'.repeat(20000)
    const entries = Array.from({ length: 8 }, (_, i) => ({ path: `f${i}`, content: `${i}:${content}` }))
    const signal = new AbortController().signal
    const stream = streamSessionLogZipFromEntries(toIterable(entries), 6, signal)
    const reader = stream.getReader()
    const parts: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      await new Promise(resolve => setTimeout(resolve, 0)) // 模拟慢消费
    }
    const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      out.set(part, offset)
      offset += part.byteLength
    }
    const unzipped = unzipSync(out)
    expect(strFromU8(unzipped['f7'])).toBe(`7:${content}`)
  })

  it('取消已消费的流不抛错', async () => {
    const content = 'x'.repeat(1 << 16)
    const stream = streamSessionLogZipFromEntries(
      (async function* (): AsyncGenerator<SessionLogZipEntry> {
        for (let i = 0; i < 100; i += 1) yield { path: `f${i}`, content }
      })(),
      6,
      new AbortController().signal,
    )
    const reader = stream.getReader()
    await reader.read()
    await expect(reader.cancel()).resolves.toBeUndefined()
  })

  it('条目迭代中途抛错使流报错而非交付截断归档', async () => {
    const stream = streamSessionLogZipFromEntries(
      (async function* (): AsyncGenerator<SessionLogZipEntry> {
        yield { path: 'ok', content: 'fine' }
        throw anError()
      })(),
      6,
      new AbortController().signal,
    )
    await expect(collectBytes(stream)).rejects.toThrow('boom')
  })

  it('请求取消使消费方报错并终止压缩', async () => {
    const controller = new AbortController()
    const stream = streamSessionLogZipFromEntries(
      (async function* (): AsyncGenerator<SessionLogZipEntry> {
        for (let i = 0; i < 100; i += 1) {
          yield { path: `f${i}`, content: 'y'.repeat(4096) }
          controller.signal.throwIfAborted()
        }
      })(),
      6,
      controller.signal,
    )
    controller.abort()
    await expect(collectBytes(stream)).rejects.toThrow()
  })
})
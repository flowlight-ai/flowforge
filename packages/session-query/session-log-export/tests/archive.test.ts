/** archive.ts 的宿主侧契约测试：序列化、读取、刷写、文件名。 */

import { describe, it, expect } from 'vitest'
import {
  SESSION_FORMAT_VERSION,
  SESSION_LOG_FILENAME,
  flushLiveSessionLog,
  readSessionLogText,
  serializeSessionLog,
  sessionLogZipFilename,
} from '../src/archive.ts'
import { MemorySessionSource } from '../src/ports/source.ts'
import { MemoryLiveSessionStore } from '../src/ports/live-session.ts'
import { makeHeader, makeEvent } from './helper.ts'

describe('serializeSessionLog', () => {
  it('写出一行规范 v2 头、每事件一行并以换行结尾', () => {
    const text = serializeSessionLog(makeHeader({ id: 'root' }), [makeEvent(0, { text: 'hi' })])
    const lines = text.split('\n')
    expect(lines[lines.length - 1]).toBe('')
    const headerLine = JSON.parse(lines[0]) as Record<string, unknown>
    expect(headerLine.type).toBe('session')
    expect(headerLine.version).toBe(2)
    expect(headerLine.id).toBe('root')
    expect(lines[1]).toBe(JSON.stringify(makeEvent(0, { text: 'hi' })))
  })

  it('头部缺省 delegationDepth 序列化为 0', () => {
    const header = makeHeader()
    const line = serializeSessionLog(header, []).trim()
    const parsed = JSON.parse(line) as { delegationDepth: number }
    expect(parsed.delegationDepth).toBe(0)
  })

  it('保留 cwd / parentSession / origin / agentPreset 可选字段', () => {
    const header = makeHeader({
      cwd: '/workspace',
      parentSession: 'parent-1',
      origin: 'subagent',
      agentPreset: 'preset-a',
    })
    const parsed = JSON.parse(serializeSessionLog(header, []).trim()) as Record<string, unknown>
    expect(parsed.cwd).toBe('/workspace')
    expect(parsed.parentSession).toBe('parent-1')
    expect(parsed.origin).toBe('subagent')
    expect(parsed.agentPreset).toBe('preset-a')
  })

  it('事件顺序与传入一致', () => {
    const events = [makeEvent(0, { a: 1 }), makeEvent(1, { b: 2 }), makeEvent(2, { c: 3 })]
    const lines = serializeSessionLog(makeHeader(), events).trim().split('\n')
    expect(lines.slice(1).map(line => JSON.parse(line))).toEqual(events.map(event => ({ ...event })))
  })
})

describe('readSessionLogText', () => {
  it('存在的会话返回其序列化日志', async () => {
    const source = new MemorySessionSource()
    source.set('s1', makeHeader({ id: 's1' }), [makeEvent(0, { ok: true })])
    const text = await readSessionLogText(source, 's1')
    expect(text).toBeDefined()
    expect(text!.split('\n')[0]).toContain('"id":"s1"')
  })

  it('不存在的会话返回 undefined', async () => {
    const source = new MemorySessionSource()
    expect(await readSessionLogText(source, 'absent')).toBeUndefined()
  })

  it('将标记为不存在的会话判为 undefined', async () => {
    const source = new MemorySessionSource()
    source.set('gone', makeHeader({ id: 'gone' }), [])
    source.markAbsent('gone')
    expect(await readSessionLogText(source, 'gone')).toBeUndefined()
  })

  it('中止信号在读取前抛错', async () => {
    const source = new MemorySessionSource()
    source.set('s', makeHeader({ id: 's' }), [])
    const controller = new AbortController()
    controller.abort()
    await expect(readSessionLogText(source, 's', controller.signal)).rejects.toThrow()
  })
})

describe('flushLiveSessionLog', () => {
  it('活跃会话被刷写；冷会话不刷写', async () => {
    const live = new MemoryLiveSessionStore()
    const warm = { id: 'warm' }
    live.register(warm)
    await flushLiveSessionLog({ live }, 'warm')
    await flushLiveSessionLog({ live }, 'cold')
    expect(live.flushed).toEqual(['warm'])
  })

  it('无活跃存储时是空操作', async () => {
    await expect(flushLiveSessionLog({ live: undefined }, 'any')).resolves.toBeUndefined()
  })

  it('中止信号绕过节流屏障并抛错', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(flushLiveSessionLog({ live: undefined }, 'x', controller.signal)).rejects.toThrow()
  })
})

describe('SESSION_LOG_FILENAME', () => {
  it('当前代次基名为 session.v2.jsonl', () => {
    expect(SESSION_LOG_FILENAME).toBe('session.v2.jsonl')
  })

  it('SESSION_FORMAT_VERSION 为 2', () => {
    expect(SESSION_FORMAT_VERSION).toBe(2)
  })
})

describe('sessionLogZipFilename', () => {
  it('按约定拼接安全文件名', () => {
    expect(sessionLogZipFilename('abc-123')).toBe('flowforge-session-abc-123.zip')
  })

  it('中和不安全路径段', () => {
    expect(sessionLogZipFilename('../evil/hack')).toBe('flowforge-session-__evil_hack.zip')
  })
})
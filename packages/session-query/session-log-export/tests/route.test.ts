/** `index.ts` 装配与 `/api/session.export` 路由的契约测试。 */

import { describe, it, expect } from 'vitest'
import { apply, sessionLogExportResponse } from '../src/index.ts'
import { MemoryHostContext, MemoryDownloadContext } from '../src/ports/context.ts'
import { MemorySessionSource, MemoryAttachmentPort, MemoryLineagePort } from '../src/ports/source.ts'
import { MemoryLiveSessionStore } from '../src/ports/live-session.ts'
import { streamSessionLogZipFromEntries, type SessionLogZipEntry } from '../src/pure/zip.ts'
import { makeHeader } from './helper.ts'
import type { SessionLogExportSource } from '../src/archive.ts'

function sourceWith(sessionId = 'root'): SessionLogExportSource {
  const source = new MemorySessionSource()
  source.set(sessionId, makeHeader({ id: sessionId }), [])
  return {
    source,
    lineages: new MemoryLineagePort(),
    attachments: new MemoryAttachmentPort(),
    live: new MemoryLiveSessionStore(),
  }
}

function hostWith(source: SessionLogExportSource | undefined): MemoryHostContext {
  return new MemoryHostContext({ compressionLevel: 6 }, source)
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  for (;;) {
    const { done } = await reader.read()
    if (done) break
  }
}

describe('apply 装配', () => {
  it('注册 /export 命令与下载路由', () => {
    const host = hostWith(sourceWith())
    apply(host)
    expect(host.command('export')).toBeDefined()
    expect(host.route('/api/session.export')).toBeDefined()
  })

  it('/export 命令空输入返回 success', async () => {
    const host = hostWith(sourceWith())
    apply(host)
    const result = await host.command('export')!.handler({ rawInput: '' })
    expect(result).toEqual({ kind: 'success', text: 'Session log download requested.' })
  })

  it('/export 命令带路径返回 error', async () => {
    const host = hostWith(sourceWith())
    apply(host)
    const result = await host.command('export')!.handler({ rawInput: 'x' })
    expect(result.kind).toBe('error')
  })
})

describe('路由校验与状态码', () => {
  it('缺 sessionId 回 400', async () => {
    const host = hostWith(sourceWith())
    const response = await sessionLogExportResponse(host, new Request('http://h/api/session.export'), 6)
    expect(response.status).toBe(400)
  })

  it('includeDescendants 取值非法回 400', async () => {
    const host = hostWith(sourceWith())
    const url = 'http://h/api/session.export?sessionId=root&includeDescendants=maybe'
    const response = await sessionLogExportResponse(host, new Request(url), 6)
    expect(response.status).toBe(400)
  })

  it('源服务缺失回 500', async () => {
    const host = hostWith(undefined)
    const url = 'http://h/api/session.export?sessionId=root'
    const response = await sessionLogExportResponse(host, new Request(url), 6)
    expect(response.status).toBe(500)
  })

  it('根会话不存在回 404', async () => {
    const host = hostWith(sourceWith('root'))
    const url = 'http://h/api/session.export?sessionId=missing'
    const response = await sessionLogExportResponse(host, new Request(url), 6)
    expect(response.status).toBe(404)
  })

  it('读取根日志失败回 500（不回声错误）', async () => {
    const host = hostWith({
      source: {
        readSessionLog: () => Promise.reject(new Error('/secret/absolute/path')),
      },
      lineages: new MemoryLineagePort(),
      attachments: new MemoryAttachmentPort(),
      live: new MemoryLiveSessionStore(),
    })
    const url = 'http://h/api/session.export?sessionId=root'
    const response = await sessionLogExportResponse(host, new Request(url), 6)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('/secret/absolute/path')
  })

  it('GET 成功返回 application/zip 与附件文件名，且可完整消费流', async () => {
    const host = hostWith(sourceWith('root'))
    const url = 'http://h/api/session.export?sessionId=root&includeDescendants=true'
    const response = await sessionLogExportResponse(host, new Request(url), 6)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="flowforge-session-root.zip"')
    await collect(response.body as ReadableStream<Uint8Array>)
  })

  it('HEAD 保留状态码并清空响应体', async () => {
    const host = hostWith(sourceWith('root'))
    apply(host)
    const route = host.route('/api/session.export')!
    const response = await route.fetch(new Request('http://h/api/session.export?sessionId=root', { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
  })
})

describe('浏览器下载上下文内存实现', () => {
  it('同源基址缺省回退到空源约定', () => {
    expect(new MemoryDownloadContext().hostBase()).toBe('http://dsh.internal')
  })

  it('streamSessionLogZipFromEntries 在该管线可打包包裹（冒烟）', async () => {
    const entries: SessionLogZipEntry[] = [{ path: 'x', content: 'data' }]
    const stream = streamSessionLogZipFromEntries(
      (async function* () { yield entries[0] })(),
      6,
      new AbortController().signal,
    )
    await collect(stream)
  })
})
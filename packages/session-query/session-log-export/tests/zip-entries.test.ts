/** `sessionLogZipEntries` 的 zip 顺序、去重与附件抽取契约测试。 */

import { describe, it, expect } from 'vitest'
import {
  SESSION_LOG_FILENAME,
  serializeSessionLog,
  sessionLogZipEntries,
  type SessionLogExportSource,
} from '../src/archive.ts'
import {
  MemoryAttachmentPort,
  MemoryLineagePort,
  MemorySessionSource,
  type SessionLineageNode,
} from '../src/ports/source.ts'
import { MemoryLiveSessionStore } from '../src/ports/live-session.ts'
import {
  contentEvent,
  fileBlock,
  imageBlock,
  makeHeader,
} from './helper.ts'

interface SourceHandles {
  source: MemorySessionSource
  attachments: MemoryAttachmentPort
  lineages: MemoryLineagePort
  live: MemoryLiveSessionStore
  exportSource: SessionLogExportSource
}

function buildSource(): SourceHandles {
  const source = new MemorySessionSource()
  const attachments = new MemoryAttachmentPort()
  const lineages = new MemoryLineagePort()
  const live = new MemoryLiveSessionStore()
  return {
    source,
    attachments,
    lineages,
    live,
    exportSource: { source, lineages, attachments, live },
  }
}

function node(headerId: string, descendants: readonly SessionLineageNode[] = []): SessionLineageNode {
  return { session: { header: makeHeader({ id: headerId }) }, descendants }
}

async function pathsOf(...entries: Parameters<typeof sessionLogZipEntries>): Promise<string[]> {
  const paths: string[] = []
  for await (const entry of sessionLogZipEntries(...entries)) paths.push(entry.path)
  return paths
}

describe('sessionLogZipEntries 顺序与装配', () => {
  it('根日志的路径是当前代次规范基名', async () => {
    const h = buildSource()
    const root = serializeSessionLog(makeHeader({ id: 'root' }), [])
    for await (const entry of sessionLogZipEntries(h.exportSource, root, 'root', false)) {
      expect(entry.path).toBe(SESSION_LOG_FILENAME)
      break
    }
  })

  it('不含后代时只有根日志（无附件引用）', async () => {
    const h = buildSource()
    const root = serializeSessionLog(makeHeader(), [])
    expect(await pathsOf(h.exportSource, root, 'root', false)).toEqual([SESSION_LOG_FILENAME])
  })

  it('宣称含后代时按深序包含子代理会话日志', async () => {
    const h = buildSource()
    h.source.set('child', makeHeader({ id: 'child' }), [])
    h.source.set('grandchild', makeHeader({ id: 'grandchild' }), [])
    h.lineages.set('root', [node('child', [node('grandchild')])])
    const root = serializeSessionLog(makeHeader(), [])
    const paths = await pathsOf(h.exportSource, root, 'root', true)
    expect(paths).toEqual([
      SESSION_LOG_FILENAME,
      `subagents/child/${SESSION_LOG_FILENAME}`,
      `subagents/grandchild/${SESSION_LOG_FILENAME}`,
    ])
  })

  it('includeDescendants=false 时跳过子代理', async () => {
    const h = buildSource()
    h.source.set('child', makeHeader({ id: 'child' }), [])
    h.lineages.set('root', [node('child')])
    const root = serializeSessionLog(makeHeader(), [])
    expect(await pathsOf(h.exportSource, root, 'root', false)).toEqual([SESSION_LOG_FILENAME])
  })

  it('血缘编号为活的子代理触发刷写屏障', async () => {
    const h = buildSource()
    h.source.set('child', makeHeader({ id: 'child' }), [])
    h.live.register({ id: 'child' })
    h.lineages.set('root', [node('child')])
    const root = serializeSessionLog(makeHeader(), [])
    await Array.fromAsync(sessionLogZipEntries(h.exportSource, root, 'root', true))
    expect(h.live.flushed).toEqual(['child'])
  })

  it('重复血缘节点只产出一次（seen 去重）', async () => {
    const h = buildSource()
    h.source.set('dup', makeHeader({ id: 'dup' }), [])
    h.lineages.set('root', [node('dup'), node('dup')])
    const root = serializeSessionLog(makeHeader(), [])
    expect(await pathsOf(h.exportSource, root, 'root', true)).toEqual([
      SESSION_LOG_FILENAME,
      `subagents/dup/${SESSION_LOG_FILENAME}`,
    ])
  })

  it('缺失日志的子代理抛错（fail-loud）', async () => {
    const h = buildSource()
    h.lineages.set('root', [node('no-log')])
    const root = serializeSessionLog(makeHeader(), [])
    await expect(
      Array.fromAsync(sessionLogZipEntries(h.exportSource, root, 'root', true)),
    ).rejects.toThrow(/no stored log/)
  })
})

describe('附件引用抽取与去重', () => {
  it('根日志里引用的图片按内容寻址路径产出', async () => {
    const h = buildSource()
    h.attachments.storeImage('img-1', new Uint8Array([1, 2, 3]))
    const root = serializeSessionLog(makeHeader(), [contentEvent(0, [imageBlock('img-1', 'image/png')])])
    const paths = await pathsOf(h.exportSource, root, 'root', false)
    expect(paths).toContain('media/img-1.png')
  })

  it('同一图片在根与子代理中共享时只产出一份', async () => {
    const h = buildSource()
    h.attachments.storeImage('img-1', new Uint8Array([9]))
    h.source.set('child', makeHeader({ id: 'child' }), [
      contentEvent(0, [imageBlock('img-1', 'image/png')]),
    ])
    h.lineages.set('root', [node('child')])
    const root = serializeSessionLog(makeHeader(), [contentEvent(0, [imageBlock('img-1', 'image/png')])])
    const paths = await pathsOf(h.exportSource, root, 'root', true)
    expect(paths.filter(path => path.startsWith('media/'))).toEqual(['media/img-1.png'])
  })

  it('不同媒体类型映射到不同扩展名', async () => {
    const h = buildSource()
    h.attachments.storeImage('a', new Uint8Array([1]))
    h.attachments.storeImage('b', new Uint8Array([2]))
    const root = serializeSessionLog(makeHeader(), [
      contentEvent(0, [imageBlock('a', 'image/jpeg')]),
      contentEvent(1, [imageBlock('b', 'image/webp')]),
    ])
    const paths = await pathsOf(h.exportSource, root, 'root', false)
    expect(paths).toContain('media/a.jpg')
    expect(paths).toContain('media/b.webp')
  })

  it('图片与文件的 zip 顺序：媒体在前、文件在后', async () => {
    const h = buildSource()
    h.attachments.storeImage('img', new Uint8Array([1]))
    h.attachments.storeFile('sha256:abc', [new Uint8Array([5])])
    const root = serializeSessionLog(makeHeader(), [
      contentEvent(0, [imageBlock('img', 'image/png'), fileBlock('sha256:abc', 'notes.txt')]),
    ])
    const paths = await pathsOf(h.exportSource, root, 'root', false)
    expect(paths.indexOf('media/img.png')).toBeLessThan(paths.indexOf('files/ab/abc/notes.txt'))
  })

  it('文件路径保留摘要目录与安全名字', async () => {
    const h = buildSource()
    h.attachments.storeFile('sha256:ABCDEF', [new Uint8Array([1])])
    const root = serializeSessionLog(makeHeader(), [contentEvent(0, [fileBlock('sha256:ABCDEF', '../up.txt')])])
    const paths = await pathsOf(h.exportSource, root, 'root', false)
    expect(paths).toContain('files/AB/ABCDEF/_.._up.txt')
  })

  it('文件按附件 id + 名字去重', async () => {
    const h = buildSource()
    h.attachments.storeFile('sha256:x', [new Uint8Array([1])])
    const root = serializeSessionLog(makeHeader(), [
      contentEvent(0, [fileBlock('sha256:x', 'a.txt')]),
      contentEvent(1, [fileBlock('sha256:x', 'a.txt')]),
    ])
    const paths = await pathsOf(h.exportSource, root, 'root', false)
    expect(paths.filter(path => path.startsWith('files/'))).toEqual(['files/x/x/a.txt'])
  })

  it('从 message / inserted / stream block-end 载体抽取附件', async () => {
    const h = buildSource()
    h.attachments.storeImage('m', new Uint8Array([1]))
    h.attachments.storeImage('i', new Uint8Array([2]))
    h.attachments.storeImage('s', new Uint8Array([3]))
    const root = serializeSessionLog(makeHeader(), [
      { type: 'message', seq: 0, time: 1, data: { message: { content: [imageBlock('m', 'image/png')] } } },
      { type: 'message', seq: 1, time: 2, data: { inserted: [{ content: [imageBlock('i', 'image/jpeg')] }] } },
      {
        type: 'message', seq: 2, time: 3,
        data: { stream: [{ type: 'chunk', chunk: { type: 'block-end', block: imageBlock('s', 'image/gif') } }] },
      },
    ])
    const paths = await pathsOf(h.exportSource, root, 'root', false)
    for (const expected of ['media/m.png', 'media/i.jpg', 'media/s.gif']) expect(paths).toContain(expected)
  })
})
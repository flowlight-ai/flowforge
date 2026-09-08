/** `SessionLogDownloadController` 下载状态机契约测试。 */

import { describe, it, expect, vi } from 'vitest'
import { SessionLogDownloadController } from '../src/controller.ts'
import { MemoryDownloadContext } from '../src/ports/context.ts'
import { MemorySnapshotStore } from '../src/ports/snapshot-store.ts'
import type { SessionLogDownloadState } from '../src/controller.ts'

function snapshot(store: MemorySnapshotStore<SessionLogDownloadState>): SessionLogDownloadState['bySession'][string] {
  return store.getSnapshot().bySession['s1']
}

describe('SessionLogDownloadController', () => {
  it('成功下载发布 downloading 后转为 success', async () => {
    const save = vi.fn()
    const context = new MemoryDownloadContext(
      async () => new Response(null, { status: 200 }),
      save,
    )
    const controller = new SessionLogDownloadController(context)
    await controller.download('s1')
    expect(snapshot(controller.store)).toEqual({ open: true, status: 'success', error: null })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('以 HEAD 请求并携带 includeDescendants 参数', async () => {
    const captured = new Array<{ url: string; init?: RequestInit }>()
    const fetcher = (input: string | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init })
      return Promise.resolve(new Response(null, { status: 200 }))
    }
    const controller = new SessionLogDownloadController(new MemoryDownloadContext(fetcher, () => {}))
    await controller.download('root')
    expect(captured[0].init?.method).toBe('HEAD')
    expect(captured[0].url).toContain('includeDescendants=true')
    expect(captured[0].url).toContain('sessionId=root')
  })

  it('保存使用安全文件名', async () => {
    const save = vi.fn()
    const context = new MemoryDownloadContext(
      () => Promise.resolve(new Response(null, { status: 200 })),
      save,
    )
    const controller = new SessionLogDownloadController(context)
    await controller.download('a/b')
    const [url, filename] = save.mock.calls[0]
    expect(filename).toBe('flowforge-session-a_b.zip')
    expect(url).toContain('/api/session.export')
  })

  it('fetch 抛错发布 error 并携带消息', async () => {
    const controller = new SessionLogDownloadController(new MemoryDownloadContext(
      () => Promise.reject(new Error('network down')),
      () => {},
    ))
    await controller.download('s1')
    expect(snapshot(controller.store)).toEqual({ open: true, status: 'error', error: 'network down' })
  })

  it('非 2xx 响应发布 error 并携带 HTTP 状态', async () => {
    const controller = new SessionLogDownloadController(new MemoryDownloadContext(
      () => Promise.resolve(new Response('not found', { status: 404 })),
      () => {},
    ))
    await controller.download('s1')
    const entry = snapshot(controller.store)
    expect(entry?.status).toBe('error')
    expect(entry?.error).toContain('404')
    expect(entry?.error).toContain('not found')
  })

  it('dismiss 关闭打开中的对话框', async () => {
    const controller = new SessionLogDownloadController(new MemoryDownloadContext(
      () => Promise.resolve(new Response(null, { status: 200 })),
      () => {},
    ))
    await controller.download('s1')
    const open = snapshot(controller.store)
    expect(open?.open).toBe(true)
    controller.dismiss('s1')
    expect(snapshot(controller.store)?.open).toBe(false)
  })

  it('同一会话的并发手势共享一次操作', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const controller = new SessionLogDownloadController(new MemoryDownloadContext(
      async () => { await gate; return new Response(null, { status: 200 }) },
      () => {},
    ))
    const first = controller.download('s1')
    const second = controller.download('s1')
    release?.()
    await Promise.all([first, second])
    expect(snapshot(controller.store)?.status).toBe('success')
  })

  it('dispose 中止在途操作并忽略迟到的下载请求', async () => {
    const controller = new SessionLogDownloadController(new MemoryDownloadContext(
      (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
      () => {},
    ))
    const pending = controller.download('s1')
    await controller.dispose()
    await pending.catch(() => {})
    await expect(controller.download('s1')).resolves.toBeUndefined()
  })

  it('支持外部注入快照存储', async () => {
    const store = new MemorySnapshotStore<SessionLogDownloadState>({ bySession: {} })
    const controller = new SessionLogDownloadController(
      new MemoryDownloadContext(() => Promise.resolve(new Response(null, { status: 200 })), () => {}),
      store,
    )
    await controller.download('s1')
    expect(store.getSnapshot().bySession['s1']?.status).toBe('success')
  })
})
/**
 * 浏览器侧会话日志下载状态机。
 *
 * 移植自 dsh `session-log-export/src/client/controller.ts` 并去 React 化：原实现用
 * `SnapshotStore` 共享模态状态、用浏览器 `document/a` 触发下载。这里把 `fetch`、
 * 磁盘保存与同源基址收敛进注入的 {@link DownloadContextPort}，把快照源收敛进注入的
 * {@link SnapshotStorePort}（默认内存实现），状态机本身不触碰任何浏览器全局。
 */

import { sessionLogZipFilename } from './archive.ts'
import { MemorySnapshotStore, type SnapshotStorePort } from './ports/snapshot-store.ts'
import type { DownloadContextPort } from './ports/context.ts'

/** 共享模态呈现的下载阶段。 */
export type SessionLogDownloadStatus = 'downloading' | 'success' | 'error'

/** 单个会话当前的下载对话框状态。 */
export interface SessionLogDownloadEntry {
  readonly open: boolean
  readonly status: SessionLogDownloadStatus
  readonly error: string | null
}

/** 以会话为键的下载状态表。 */
export interface SessionLogDownloadState {
  bySession: Record<string, SessionLogDownloadEntry | undefined>
}

/** 稳定的浏览器下载路径，跨传输迁移保持一致。 */
export const SESSION_LOG_EXPORT_PATH = '/api/session.export'

const INITIAL: SessionLogDownloadState = { bySession: {} }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 每个会话持有一个在途浏览器下载，并向内存快照发布模态状态。
 */
export class SessionLogDownloadController {
  /** 每个会话作用域模态贡献共享的快照源（uSES 安全）。 */
  readonly store: SnapshotStorePort<SessionLogDownloadState>

  private readonly active = new Map<string, { readonly abort: AbortController; readonly done: Promise<void> }>()
  private disposed = false

  /**
   * @param context - 注入的浏览器下载上下文（fetch / 保存 / 同源基址）。
   * @param store - 可选快照源；缺省使用真实内存实现。
   */
  constructor(
    private readonly context: DownloadContextPort,
    store?: SnapshotStorePort<SessionLogDownloadState>,
  ) {
    this.store = store ?? new MemorySnapshotStore<SessionLogDownloadState>(INITIAL)
  }

  /**
   * 下载一个会话树；同一会话的并发手势共享一次操作。
   * @param sessionId - 根会话，其 ZIP 含后代与附件。
   * @returns 浏览器保存开始后、错误状态发布后，或迟到的 dispose 后忽略请求时结算。
   */
  download(sessionId: string): Promise<void> {
    const existing = this.active.get(sessionId)
    if (existing !== undefined) return existing.done
    if (this.disposed) return Promise.resolve()
    const abort = new AbortController()
    const done = this.run(sessionId, abort.signal).finally(() => {
      this.active.delete(sessionId)
    })
    this.active.set(sessionId, { abort, done })
    return done
  }

  /**
   * 关闭某个会话的对话框而不取消在途浏览器下载。
   * @param sessionId - 其模态关闭的会话。
   */
  dismiss(sessionId: string): void {
    const current = this.store.getSnapshot().bySession[sessionId]
    if (current === undefined || !current.open) return
    this.publish(sessionId, { ...current, open: false })
  }

  /**
   * 中止在途 fetch 并到达静止。
   * @returns 每个在途操作结算后。
   */
  async dispose(): Promise<void> {
    this.disposed = true
    const active = [...this.active.values()]
    for (const operation of active) operation.abort.abort()
    await Promise.allSettled(active.map(operation => operation.done))
  }

  private async run(sessionId: string, signal: AbortSignal): Promise<void> {
    this.publish(sessionId, { open: true, status: 'downloading', error: null })
    try {
      const url = new URL(SESSION_LOG_EXPORT_PATH, this.context.hostBase())
      url.searchParams.set('sessionId', sessionId)
      url.searchParams.set('includeDescendants', 'true')
      const response = await this.context.fetcher(url, { method: 'HEAD', signal })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`Export failed: HTTP ${String(response.status)}${detail === '' ? '' : ` ${detail}`}`)
      }
      this.context.save(url.toString(), sessionLogZipFilename(sessionId))
      const open = this.store.getSnapshot().bySession[sessionId]?.open ?? true
      this.publish(sessionId, { open, status: 'success', error: null })
    } catch (error: unknown) {
      if (signal.aborted) return
      const open = this.store.getSnapshot().bySession[sessionId]?.open ?? true
      this.publish(sessionId, { open, status: 'error', error: messageOf(error) })
    }
  }

  private publish(sessionId: string, entry: SessionLogDownloadEntry): void {
    this.store.update((state) => {
      state.bySession = { ...state.bySession, [sessionId]: entry }
    })
  }
}

export type { SnapshotStorePort } from './ports/snapshot-store.ts'
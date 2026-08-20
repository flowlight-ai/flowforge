/**
 * ThreadExportService — 线程导出 Cordis 服务（阶段5 批次1，ctx.chatExport）。
 *
 * 移植自 clowder-ai `routes/thread-export.ts`：原版为 Puppeteer 页面截图
 * （ImageExporter，依赖 headless browser），flowforge 服务层交付 markdown
 * 文档投影；图像导出属 web 呈现层，随阶段 8 前端融合处理。所有权语义
 * （404/403，system 线程共享）与原版一致。
 *
 * @module @flowforge/chat-threads/export
 */

import { Context, Service } from '@flowforge/cordis'
import type { UserId } from '@flowforge/cats-shared'
import { ThreadErrorCode } from './invariant.ts'
import { ChatThreadsError } from './thread-service.ts'

/** Markdown export document. */
export interface ThreadExportDocument {
  readonly threadId: string
  readonly title: string
  readonly messageCount: number
  readonly markdown: string
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat thread export service — mounted by `@flowforge/chat-threads`. */
    chatExport: ThreadExportService
  }
}

/** Format a timestamp as a stable local datetime string. */
function formatTimestamp(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Cordis service exposing thread export at `ctx.chatExport`.
 */
export class ThreadExportService extends Service {
  static inject = ['catStores'] as const

  constructor(ctx: Context) {
    super(ctx, 'chatExport')
  }

  /** POST /api/threads/:threadId/export — export a thread as a markdown document. */
  async exportMarkdown(threadId: string, userId: UserId): Promise<ThreadExportDocument> {
    const thread = await Promise.resolve(this.ctx.catStores.threads().getById(threadId))
    if (!thread) {
      throw new ChatThreadsError(ThreadErrorCode.THREAD_NOT_FOUND, 'Thread not found')
    }
    // System-created threads are accessible to all users; user threads are owner-only
    if (thread.userId !== 'system' && thread.userId !== userId) {
      throw new ChatThreadsError(ThreadErrorCode.UNAUTHORIZED, 'Access denied')
    }

    // System threads are shared resources — their messages export without an
    // author-scope filter; user threads export through the owner's visibility.
    const viewer = thread.userId === 'system' ? undefined : userId
    const messages = await Promise.resolve(
      this.ctx.catStores.messages().getByThread(threadId, 10_000, viewer),
    )

    const lines: string[] = [
      `# ${thread.title || '未命名对话'}`,
      '',
      `- Thread ID: ${thread.id}`,
      `- Created: ${formatTimestamp(thread.createdAt)}`,
      `- Messages: ${messages.length}`,
      '',
      '---',
      '',
    ]
    for (const msg of messages) {
      const sender = msg.catId ? `@${msg.catId}` : (msg.userId || 'user')
      lines.push(`**${sender}** · ${formatTimestamp(msg.timestamp)}`)
      lines.push('')
      lines.push(msg.content)
      lines.push('')
    }
    return {
      threadId: thread.id,
      title: thread.title,
      messageCount: messages.length,
      markdown: lines.join('\n'),
    }
  }
}

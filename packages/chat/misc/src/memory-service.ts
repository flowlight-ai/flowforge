/**
 * ChatMemoryService — chat thread KV 记忆服务（F3-lite，T5.7.2）。
 *
 * 移植 clowder-ai `routes/memory.ts`（api/src/routes/）的路由语义为 Cordis
 * 服务（R13 一切皆插件改造）：
 * - writeMemory：POST /api/memory 语义（thread 所有权守卫 → 403/404）
 * - readMemory：GET /api/memory 语义（单 key / 全列）
 * - deleteMemory：DELETE /api/memory 语义（404 语义）
 *
 * 存储桥接 `catStores.threadMemories()`（stage-5 batch 7 提升的
 * IThreadMemoryStore；容量上限 MAX_KEYS_PER_THREAD 淘汰最旧 key）。
 *
 * @module @flowforge/chat-misc
 */

import { Context, Service } from '@flowforge/cordis'
import type { CatId, MemoryEntry, MemoryInput } from '@flowforge/cats-shared'
import type { StoredThread } from '@flowforge/cats-stores'

export const ChatMemoryErrorCode = {
  THREAD_NOT_FOUND: 'THREAD_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  IDENTITY_REQUIRED: 'IDENTITY_REQUIRED',
} as const

export class ChatMemoryError extends Error {
  readonly code: (typeof ChatMemoryErrorCode)[keyof typeof ChatMemoryErrorCode]
  readonly status: number

  constructor(code: (typeof ChatMemoryErrorCode)[keyof typeof ChatMemoryErrorCode], message: string, status: number) {
    super(message)
    this.name = 'ChatMemoryError'
    this.code = code
    this.status = status
  }
}

/** 写记忆输入（clowder memory 路由契约）。 */
export interface WriteChatMemoryInput {
  readonly threadId: string
  readonly key: string
  readonly value: string
  readonly updatedBy: CatId | 'user'
}

/** ChatMemoryService 选项。 */
export interface ChatMemoryServiceOptions {
  /** Thread 读取缝（缺省经 ctx.catStores.threads()）。 */
  getThread?: (threadId: string) => StoredThread | null | Promise<StoredThread | null>
}

declare module '@flowforge/cordis' {
  interface Context {
    /** Chat thread KV 记忆服务（F3-lite，T5.7.2）— mounted by `@flowforge/chat-misc`. */
    chatMemory: ChatMemoryService
  }
}

/**
 * Chat 记忆服务。挂载点 `ctx.chatMemory`（`@flowforge/chat-misc`）。
 */
export class ChatMemoryService extends Service {
  static inject = ['catStores']

  private readonly getThread: (threadId: string) => StoredThread | null | Promise<StoredThread | null>

  constructor(ctx: Context, options: ChatMemoryServiceOptions = {}) {
    super(ctx, 'chatMemory')
    this.getThread = options.getThread ?? ((threadId) => ctx.catStores.threads().getById(threadId))
  }

  /** Thread 所有权守卫（clowder authorizeThread：默认 thread 直接放行）。 */
  private async authorizeThread(threadId: string, userId: string): Promise<void> {
    if (threadId === 'default') return
    const thread = await this.getThread(threadId)
    if (!thread) {
      throw new ChatMemoryError(ChatMemoryErrorCode.THREAD_NOT_FOUND, 'Thread not found', 404)
    }
    if (thread.userId !== userId) {
      throw new ChatMemoryError(ChatMemoryErrorCode.FORBIDDEN, 'Access denied', 403)
    }
  }

  /** 写/覆盖记忆（POST /api/memory 语义，201）。 */
  async writeMemory(input: WriteChatMemoryInput, identity: string): Promise<MemoryEntry> {
    if (!identity) {
      throw new ChatMemoryError(ChatMemoryErrorCode.IDENTITY_REQUIRED, 'Identity required', 401)
    }
    await this.authorizeThread(input.threadId, identity)
    const entryInput: MemoryInput = {
      threadId: input.threadId,
      key: input.key,
      value: input.value,
      updatedBy: input.updatedBy,
    }
    return this.ctx.catStores.threadMemories().set(entryInput)
  }

  /** 读单 key 或全列（GET /api/memory 语义）。 */
  async readMemory(
    threadId: string,
    identity: string,
    key?: string,
  ): Promise<MemoryEntry | { entries: MemoryEntry[] }> {
    if (!identity) {
      throw new ChatMemoryError(ChatMemoryErrorCode.IDENTITY_REQUIRED, 'Identity required', 401)
    }
    await this.authorizeThread(threadId, identity)
    if (key) {
      const entry = await this.ctx.catStores.threadMemories().get(threadId, key)
      if (!entry) {
        throw new ChatMemoryError(ChatMemoryErrorCode.ENTRY_NOT_FOUND, 'Memory entry not found', 404)
      }
      return entry
    }
    const entries = await this.ctx.catStores.threadMemories().list(threadId)
    return { entries }
  }

  /** 删除单 key（DELETE /api/memory 语义，204）。 */
  async deleteMemory(threadId: string, key: string, identity: string): Promise<void> {
    if (!identity) {
      throw new ChatMemoryError(ChatMemoryErrorCode.IDENTITY_REQUIRED, 'Identity required', 401)
    }
    await this.authorizeThread(threadId, identity)
    const deleted = await this.ctx.catStores.threadMemories().delete(threadId, key)
    if (!deleted) {
      throw new ChatMemoryError(ChatMemoryErrorCode.ENTRY_NOT_FOUND, 'Memory entry not found', 404)
    }
  }
}

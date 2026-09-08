/**
 * 线程目标权威：将 host 私有线程句柄解析为线程记录。
 * 忠实移植 clowder-ai `domains/signal-intake/ThreadDestinationAuthority.ts`。
 * `MeetingThreadStore` 为本地端口（createdBy/deletedAt/preferredCats/participants），
 * 宿主在 EP4 适配到 flowforge `cats-stores` 的 `StoredThread`。
 *
 * @flowforge/cats-signal-intake
 */

import type { DestinationAuthority, HostDestinationRecord } from './DestinationAuthority.ts'

/** 私有线程记录（本地端口）：非 flowforge `StoredThread`（缺下列字段）。 */
export interface MeetingThreadRecord {
  readonly id: string
  readonly createdBy: string
  readonly deletedAt?: number
  readonly preferredCats: readonly string[]
  readonly participants: readonly string[]
}

export interface MeetingThreadStore {
  get(threadId: string): MeetingThreadRecord | null | Promise<MeetingThreadRecord | null>
}

const PREFIX = 'host:private-thread:'

export function parsePrivateThreadHandle(handle: string): string | null {
  if (!handle.startsWith(PREFIX)) return null
  const threadId = handle.slice(PREFIX.length)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(threadId)) return null
  if (handle !== `${PREFIX}${threadId}`) return null
  return threadId
}

export class MemoryMeetingThreadStore implements MeetingThreadStore {
  private readonly records = new Map<string, MeetingThreadRecord>()

  put(record: MeetingThreadRecord): void {
    this.records.set(record.id, structuredClone(record))
  }

  async get(threadId: string): Promise<MeetingThreadRecord | null> {
    const record = this.records.get(threadId)
    return record ? structuredClone(record) : null
  }
}

export class ThreadDestinationAuthority implements DestinationAuthority {
  constructor(private readonly threads: MeetingThreadStore) {}

  async resolve(handle: string, ownerId: string): Promise<HostDestinationRecord | null> {
    const threadId = parsePrivateThreadHandle(handle)
    if (!threadId) return null
    const thread = await this.threads.get(threadId)
    if (!thread || thread.deletedAt !== undefined || thread.createdBy !== ownerId) return null
    return { handle, kind: 'private-thread', targetId: threadId, ownerId }
  }
}
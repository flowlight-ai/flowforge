/**
 * @flowforge/cats-guides — InMemoryGuideThreadStore（宿主线程存储缺省 stub）。
 *
 * 实现 IThreadStore 最小接口：单实例幂等（同 userId 返回相同 threadId），
 * 不跨进程持久化。宿主接入真实 ThreadStore 时注入替换（见 index.ts options.threadStore）。
 *
 * @module @flowforge/cats-guides/thread-store
 */

import type { ConciergeThreadRecord, IThreadStore } from './ports.js';

/** 内存线程存储 stub（测试/无宿主场景；powered by Map）。 */
export class InMemoryGuideThreadStore implements IThreadStore {
  private readonly threads = new Map<string, ConciergeThreadRecord>();
  private readonly userThreads = new Map<string, string>(); // userId → threadId
  private readonly participants = new Map<string, string[]>(); // threadId → catIds
  private counter = 0;

  async get(threadId: string): Promise<ConciergeThreadRecord | null> {
    return this.threads.get(threadId) ?? null;
  }

  async create(userId: string, title?: string): Promise<ConciergeThreadRecord> {
    const existing = this.userThreads.get(userId);
    if (existing) return this.threads.get(existing)!;

    const id = `thread-${userId}-${++this.counter}`;
    const record: ConciergeThreadRecord = {
      id,
      title: title ?? null,
      createdBy: userId,
      threadKind: null,
    };
    this.threads.set(id, record);
    this.userThreads.set(userId, id);
    return record;
  }

  async updatePreferredCats(threadId: string, catIds: string[]): Promise<void> {
    this.participants.set(threadId, [...catIds]);
  }

  async updateThreadKind(threadId: string, kind: string): Promise<void> {
    const record = this.threads.get(threadId);
    if (record) {
      record.threadKind = kind;
      this.threads.set(threadId, { ...record });
    }
  }

  async softDelete(threadId: string): Promise<void> {
    const record = this.threads.get(threadId);
    if (record) {
      record.deletedAt = Date.now();
      this.threads.set(threadId, { ...record });
    }
  }

  async getParticipants(threadId: string): Promise<string[]> {
    return this.participants.get(threadId) ?? [];
  }
}

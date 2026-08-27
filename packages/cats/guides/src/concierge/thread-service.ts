/**
 * @flowforge/cats-guides — ConciergeThreadService（F229 PR-A1）。
 *
 * 懒创建/获取 per-user 专属前台猫对话载体（concierge thread）。
 *
 * 设计决策（架构归一，Design Gate §3 选项 a）：
 * - 对话载体 = 普通 thread（消息/invocation/记忆全复用现有设施）
 * - 创建者为 userId（P1 fix：每个用户的 concierge thread 在自己的 user index 下）
 * - thread.threadKind = 'concierge' — route 层通过此字段过滤
 * - 懒创建：第一次 getOrCreate 时建立，后续调用幂等返回相同 threadId
 *
 * 插件化改造（对照 clowder）：
 * - RedisClient → ConciergeKeyValueStore 注入（setNx claim / deleteIf CAS-DEL），
 *   缺省 MemoryConciergeKeyValueStore（单实例幂等，跨实例不持久）
 * - 崩溃原子性语义保留：create → SET NX claim → updateThreadKind 顺序
 *   （R18 P2），CAS-DEL 防并发双 canonical（R19 P2）
 *
 * @module @flowforge/cats-guides/concierge/thread-service
 */

import type { IThreadStore } from '../ports.js';
import { ConciergeKeys } from './keys.js';
import type { ConciergeKeyValueStore } from './kv-store.js';
import { MemoryConciergeKeyValueStore } from './kv-store.js';
import type { IConciergeConfigStore } from './config-store.js';

export interface ConciergeThreadServiceDeps {
  threadStore: IThreadStore;
  /** 持久层注入（缺省内存：单实例幂等，跨实例不持久）。 */
  kv?: ConciergeKeyValueStore;
  /**
   * F229 P1 routing fix: load ConciergeConfig to sync thread.preferredCats = [dutyCatProfileId].
   * 提供时 getOrCreate() 会 updatePreferredCats，使无 @mention 消息路由到值班猫。
   */
  conciergeConfigStore?: IConciergeConfigStore;
}

export class ConciergeThreadService {
  private readonly threadStore: IThreadStore;
  private readonly kv: ConciergeKeyValueStore;
  /** In-flight deduplication: concurrent getOrCreate for same userId share one Promise */
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly conciergeConfigStore: IConciergeConfigStore | undefined;

  constructor(deps: ConciergeThreadServiceDeps) {
    this.threadStore = deps.threadStore;
    this.kv = deps.kv ?? new MemoryConciergeKeyValueStore();
    this.conciergeConfigStore = deps.conciergeConfigStore;
  }

  /**
   * 获取或懒创建 per-user concierge thread。
   * 幂等：同 userId 多次调用（含并发）返回相同 threadId。
   */
  async getOrCreate(userId: string): Promise<string> {
    const existing = this.inFlight.get(userId);
    if (existing) return existing;

    const promise = this._doGetOrCreate(userId).finally(() => {
      this.inFlight.delete(userId);
    });
    this.inFlight.set(userId, promise);
    return promise;
  }

  private async _doGetOrCreate(userId: string): Promise<string> {
    // 1. Check stored threadId
    const stored = await this.getStoredThreadId(userId);
    let threadId: string;

    if (stored) {
      const thread = await this.threadStore.get(stored);
      if (thread && !thread.deletedAt) {
        // R19 P2 self-heal: repair missing threadKind marker (crash between
        // storeThreadId() and updateThreadKind()) so concierge prompt injection
        // and route-layer filtering activate correctly on this call.
        if (thread.threadKind !== 'concierge') {
          await this.threadStore.updateThreadKind?.(stored, 'concierge');
        }
        threadId = stored;
      } else {
        // Thread deleted — CAS-DEL the stale key first. If another instance
        // already wrote a fresh canonical id (CAS no-op → false), read it back
        // instead of creating a new concierge thread (avoids orphan threads).
        const staleKeyRemoved = await this.deleteStaleKey(userId, stored);
        if (staleKeyRemoved) {
          threadId = await this.createThread(userId);
        } else {
          // CAS no-op: another instance is recovering this key. Poll briefly
          // for the canonical id; fall back to createThread only if null
          // persists past the 500ms timeout window (winner crash).
          let canonical = await this.getStoredThreadId(userId);
          const deadline = Date.now() + 500;
          while (!canonical && Date.now() < deadline) {
            await new Promise<void>((r) => setTimeout(r, 50));
            canonical = await this.getStoredThreadId(userId);
          }
          threadId = canonical ?? (await this.createThread(userId));
        }
      }
    } else {
      threadId = await this.createThread(userId);
    }

    // F229 P1 routing fix: sync preferredCats = [dutyCatProfileId] so routing
    // targets the duty cat on messages without @mention.
    if (this.conciergeConfigStore) {
      const config = await this.conciergeConfigStore.get(userId);
      if (config.dutyCatProfileId) {
        await this.threadStore.updatePreferredCats(threadId, [config.dutyCatProfileId]);
      }
    }

    return threadId;
  }

  private async createThread(userId: string): Promise<string> {
    // createdBy = userId: thread is per-user indexed; threadKind='concierge' is
    // the route-layer signal for default filtering.
    const thread = await this.threadStore.create(userId, `前台猫·${userId}`, undefined);
    // R18 P2 (crash-atomicity): claim the canonical key BEFORE setting threadKind.
    const canonicalId = await this.storeThreadId(userId, thread.id);
    if (canonicalId !== thread.id) {
      // SET NX lost the race — soft-delete our orphan so it doesn't appear as
      // a ghost normal thread in the user's thread list.
      await this.threadStore.softDelete?.(thread.id);
      return canonicalId;
    }
    await this.threadStore.updateThreadKind?.(thread.id, 'concierge');
    return thread.id;
  }

  // ---------------------------------------------------------------------------
  // Public discovery helpers
  // ---------------------------------------------------------------------------

  /** 返回已存储的 concierge threadId（不创建）；不存在/已删除返回 null。 */
  async findThreadId(userId: string): Promise<string | null> {
    const stored = await this.getStoredThreadId(userId);
    if (!stored) return null;
    const thread = await this.threadStore.get(stored);
    return thread && !thread.deletedAt ? stored : null;
  }

  /**
   * 值班猫配置变更后立即同步路由偏好（P2 cloud fix）。
   * 线程不存在时 no-op（getOrCreate 首次调用会同步）。
   */
  async syncPreferredCats(userId: string, dutyCatProfileId: string): Promise<void> {
    const stored = await this.getStoredThreadId(userId);
    if (!stored) return;
    const thread = await this.threadStore.get(stored);
    if (!thread || thread.deletedAt) return;
    await this.threadStore.updatePreferredCats(stored, [dutyCatProfileId]);
  }

  // ---------------------------------------------------------------------------
  // Phase B: propose_thread action
  // ---------------------------------------------------------------------------

  /** 创建常规 propose_thread 线程（Phase B §2b，非 concierge 单例）。 */
  async createProposedThread(userId: string, title: string, _description?: string): Promise<string> {
    const thread = await this.threadStore.create(userId, title);
    return thread.id;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * CAS-DEL：仅当 key 仍持有我们读到的 staleId 时删除。
   * 防并发恢复路径互相删除 canonical（R19 P2）。
   */
  private async deleteStaleKey(userId: string, staleId: string): Promise<boolean> {
    return this.kv.deleteIf(ConciergeKeys.threadId(userId), staleId);
  }

  private async getStoredThreadId(userId: string): Promise<string | null> {
    return this.kv.get(ConciergeKeys.threadId(userId));
  }

  /**
   * 原子 claim canonical threadId（SET NX 语义）。
   * 竞态输者 soft-delete 自己的 orphan，返回 winner 的 canonical id。
   */
  private async storeThreadId(userId: string, threadId: string): Promise<string> {
    const claimed = await this.kv.setNx(ConciergeKeys.threadId(userId), threadId);
    if (!claimed) {
      await Promise.resolve(this.threadStore.softDelete?.(threadId)).catch(() => {});
      return (await this.kv.get(ConciergeKeys.threadId(userId))) ?? threadId;
    }
    return threadId;
  }
}

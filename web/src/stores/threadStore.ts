/**
 * Thread Store (Zustand) — 群聊会话管理
 *
 * 管理会话列表、当前会话切换，调用后端 /api/v1/threads 端点。
 * 参考 clowder-ai chatStore 的 thread-scoped 设计。
 *
 * thread-scoped 状态隔离：
 *   - threadDrafts: 每个会话的未发送输入草稿
 *   - threadReplyTo: 每个会话的回复目标消息
 *   - 切换会话时自动保存/恢复，不丢失未发送的输入
 */

import { create } from "zustand";

/** 会话数据模型（与后端 ThreadStore 一致） */
export interface Thread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
  deleted_at: string | null;
  /** 收藏标志（UI 态，后端可选支持，缺失时仅在内存中维护） */
  favorited?: boolean;
  /** 会话标签 ID 列表（UI 态，后端可选支持） */
  labels?: string[];
  /** 未读消息数（UI 态，后端可选支持，缺失时为 0） */
  unread_count?: number;
  /** 系统会话标志（引导/教程类会话，后端可选支持） */
  isSystem?: boolean;
}

export interface ThreadStoreState {
  /** 会话列表（排除已删除） */
  threads: Thread[];
  /** 回收站列表（已软删除） */
  trashThreads: Thread[];
  /** 当前会话 ID */
  currentThreadId: string | null;
  /** 加载状态 */
  isLoading: boolean;
  /** 创建中标志 */
  isCreating: boolean;
  /** 错误信息 */
  error: string | null;

  // ── thread-scoped 状态隔离 ────────────────────────────────────
  /** 每个会话的输入草稿（切换会话不丢失未发送输入） */
  threadDrafts: Record<string, string>;
  /** 每个会话的回复目标消息 ID */
  threadReplyTo: Record<string, string | null>;

  /** 加载会话列表 */
  loadThreads: () => Promise<void>;
  /** 新建会话，返回新会话 ID */
  createThread: (title?: string) => Promise<string | null>;
  /** 选择会话（保存当前草稿，恢复目标草稿） */
  selectThread: (threadId: string) => void;
  /** 重命名会话 */
  renameThread: (threadId: string, title: string) => Promise<void>;
  /** 删除会话（软删除，移入回收站） */
  deleteThread: (threadId: string) => Promise<void>;
  /** 从回收站恢复会话 */
  restoreThread: (threadId: string) => Promise<void>;
  /** 加载回收站列表 */
  loadTrash: () => Promise<void>;
  /** 切换置顶 */
  togglePin: (threadId: string, pinned: boolean) => Promise<void>;
  /** 切换收藏（后端不支持时仅更新内存） */
  toggleFavorite: (threadId: string, favorited: boolean) => Promise<void>;
  /** 更新会话标签（后端不支持时仅更新内存） */
  updateLabels: (threadId: string, labels: string[]) => Promise<void>;
  /** 标记会话已读（清零未读数） */
  markRead: (threadId: string) => void;
  /** 更新会话标题（首条消息后自动生成） */
  autoTitle: (threadId: string, firstMessage: string) => Promise<void>;

  // ── thread-scoped 草稿管理 ────────────────────────────────────
  /** 保存会话草稿 */
  setDraft: (threadId: string, text: string) => void;
  /** 读取会话草稿 */
  getDraft: (threadId: string) => string;
  /** 设置会话回复目标 */
  setReplyTo: (threadId: string, msgId: string | null) => void;
  /** 读取会话回复目标 */
  getReplyTo: (threadId: string) => string | null;
}

export const useThreadStore = create<ThreadStoreState>((set, get) => ({
  threads: [],
  trashThreads: [],
  currentThreadId: null,
  isLoading: false,
  isCreating: false,
  error: null,
  threadDrafts: {},
  threadReplyTo: {},

  loadThreads: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch("/api/v1/threads?limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ threads: data.items || [], isLoading: false });
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  createThread: async (title?: string) => {
    set({ isCreating: true, error: null });
    try {
      const res = await fetch("/api/v1/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const thread: Thread = await res.json();
      set((state) => ({
        threads: [thread, ...state.threads],
        currentThreadId: thread.id,
        isCreating: false,
      }));
      return thread.id;
    } catch (e) {
      set({
        isCreating: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  },

  selectThread: (threadId: string) => {
    // thread-scoped: 切换会话时草稿自动保存/恢复
    set({ currentThreadId: threadId });
  },

  renameThread: async (threadId: string, title: string) => {
    try {
      const res = await fetch(`/api/v1/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Thread = await res.json();
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === threadId ? updated : t
        ),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  deleteThread: async (threadId: string) => {
    try {
      const res = await fetch(`/api/v1/threads/${threadId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      set((state) => {
        const threads = state.threads.filter((t) => t.id !== threadId);
        const currentThreadId =
          state.currentThreadId === threadId
            ? threads[0]?.id ?? null
            : state.currentThreadId;
        return { threads, currentThreadId };
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  restoreThread: async (threadId: string) => {
    try {
      const res = await fetch(`/api/v1/threads/${threadId}/restore`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const restored: Thread = await res.json();
      set((state) => ({
        trashThreads: state.trashThreads.filter((t) => t.id !== threadId),
        threads: [restored, ...state.threads],
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadTrash: async () => {
    try {
      const res = await fetch("/api/v1/threads/trash");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      set({ trashThreads: data.items || [] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  togglePin: async (threadId: string, pinned: boolean) => {
    try {
      const res = await fetch(`/api/v1/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Thread = await res.json();
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === threadId ? updated : t
        ),
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  toggleFavorite: async (threadId: string, favorited: boolean) => {
    // 乐观更新：先改本地，再尝试同步到后端
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, favorited } : t
      ),
    }));
    try {
      const res = await fetch(`/api/v1/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorited }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Thread = await res.json();
      // 后端返回的可能不含 favorited 字段，这里强制保留乐观值
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === threadId ? { ...updated, favorited } : t
        ),
      }));
    } catch {
      // 后端不支持时静默失败，本地状态已更新
    }
  },

  updateLabels: async (threadId: string, labels: string[]) => {
    // 乐观更新
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, labels } : t
      ),
    }));
    try {
      const res = await fetch(`/api/v1/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Thread = await res.json();
      set((state) => ({
        threads: state.threads.map((t) =>
          t.id === threadId ? { ...updated, labels } : t
        ),
      }));
    } catch {
      // 后端不支持时静默失败
    }
  },

  markRead: (threadId: string) => {
    set((state) => ({
      threads: state.threads.map((t) =>
        t.id === threadId ? { ...t, unread_count: 0 } : t
      ),
    }));
  },

  autoTitle: async (threadId: string, firstMessage: string) => {
    // 首条消息前 30 字符作为标题
    const title = firstMessage.slice(0, 30).trim() || "未命名讨论";
    await get().renameThread(threadId, title);
  },

  // ── thread-scoped 草稿管理 ────────────────────────────────────

  setDraft: (threadId: string, text: string) => {
    set((state) => ({
      threadDrafts: { ...state.threadDrafts, [threadId]: text },
    }));
  },

  getDraft: (threadId: string) => {
    return get().threadDrafts[threadId] ?? "";
  },

  setReplyTo: (threadId: string, msgId: string | null) => {
    set((state) => ({
      threadReplyTo: { ...state.threadReplyTo, [threadId]: msgId },
    }));
  },

  getReplyTo: (threadId: string) => {
    return get().threadReplyTo[threadId] ?? null;
  },
}));

// ── 增强的会话查询方法（参考 clowder-ai ThreadSidebar Tab 分组） ──

import type { ThreadTab, ThreadStatus } from "@/lib/council-types";

/**
 * 按 Tab 分组获取会话列表。
 * pinned=仅置顶 / recent=7天内更新 / favorites=仅收藏 / system=系统会话 / trash=回收站
 */
export function getThreadsByTab(threads: Thread[], tab: ThreadTab): Thread[] {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  switch (tab) {
    case "pinned":
      return threads.filter((t) => t.pinned);
    case "recent":
      return threads.filter(
        (t) => new Date(t.updated_at).getTime() > sevenDaysAgo
      );
    case "favorites":
      return threads.filter((t) => t.favorited);
    case "system":
      // 系统会话：通过标签或 isSystem 字段识别
      return threads.filter(
        (t) => (t as Thread & { isSystem?: boolean }).isSystem ?? (t.labels?.includes("system") ?? false)
      );
    case "trash":
      // 回收站由 loadTrash 单独加载，此处返回空
      return [];
  }
}

/**
 * 搜索会话（标题/ID 模糊匹配）。
 * 参考 clowder-ai ThreadSidebar 的 searchFilter 实现。
 */
export function searchThreads(threads: Thread[], query: string): Thread[] {
  if (!query.trim()) return threads;
  const q = query.toLowerCase();
  return threads.filter(
    (t) =>
      t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
  );
}


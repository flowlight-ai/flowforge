/**
 * Thread Store (Zustand) — 群聊会话管理
 *
 * 管理会话列表、当前会话切换，调用后端 /api/v1/threads 端点。
 * 参考 clowder-ai chatStore 的 thread-scoped 设计。
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
}

interface ThreadStoreState {
  /** 会话列表（排除已删除） */
  threads: Thread[];
  /** 当前会话 ID */
  currentThreadId: string | null;
  /** 加载状态 */
  isLoading: boolean;
  /** 创建中标志 */
  isCreating: boolean;
  /** 错误信息 */
  error: string | null;

  /** 加载会话列表 */
  loadThreads: () => Promise<void>;
  /** 新建会话，返回新会话 ID */
  createThread: (title?: string) => Promise<string | null>;
  /** 选择会话 */
  selectThread: (threadId: string) => void;
  /** 重命名会话 */
  renameThread: (threadId: string, title: string) => Promise<void>;
  /** 删除会话（软删除） */
  deleteThread: (threadId: string) => Promise<void>;
  /** 切换置顶 */
  togglePin: (threadId: string, pinned: boolean) => Promise<void>;
  /** 更新会话标题（首条消息后自动生成） */
  autoTitle: (threadId: string, firstMessage: string) => Promise<void>;
}

export const useThreadStore = create<ThreadStoreState>((set, get) => ({
  threads: [],
  currentThreadId: null,
  isLoading: false,
  isCreating: false,
  error: null,

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

  autoTitle: async (threadId: string, firstMessage: string) => {
    // 首条消息前 30 字符作为标题
    const title = firstMessage.slice(0, 30).trim() || "未命名讨论";
    await get().renameThread(threadId, title);
  },
}));

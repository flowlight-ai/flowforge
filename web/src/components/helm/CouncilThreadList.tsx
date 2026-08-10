"use client";

/**
 * CouncilThreadList — 群聊会话列表侧栏
 *
 * 功能：
 *   - "+ 新对话"按钮 → 创建新会话并跳转
 *   - 会话列表（置顶优先 + 按更新时间降序）
 *   - 切换会话（点击列表项）
 *   - 重命名会话（双击标题进入编辑）
 *   - 删除会话（hover 显示删除按钮）
 *   - 置顶/取消置顶
 *
 * 参考 clowder-ai ThreadSidebar 的会话列表设计
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useThreadStore, type Thread } from "@/stores/threadStore";

interface CouncilThreadListProps {
  /** 当前选中的会话 ID */
  currentThreadId: string | null;
  /** className */
  className?: string;
}

export function CouncilThreadList({
  currentThreadId,
  className,
}: CouncilThreadListProps) {
  const router = useRouter();
  const {
    threads,
    isLoading,
    isCreating,
    loadThreads,
    createThread,
    selectThread,
    renameThread,
    deleteThread,
    togglePin,
  } = useThreadStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 搜索过滤（参考 clowder-ai ThreadSidebar 搜索）
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
    );
  }, [threads, searchQuery]);

  // 初始加载会话列表
  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // 编辑模式聚焦输入框
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  /** 新建对话 */
  const handleCreate = useCallback(async () => {
    const id = await createThread();
    if (id) {
      selectThread(id);
      router.push(`/council/${id}`);
    }
  }, [createThread, selectThread, router]);

  /** 选择会话 */
  const handleSelect = useCallback(
    (threadId: string) => {
      if (editingId) return;
      selectThread(threadId);
      router.push(`/council/${threadId}`);
    },
    [selectThread, router, editingId]
  );

  /** 进入重命名模式 */
  const handleStartRename = useCallback((thread: Thread) => {
    setEditingId(thread.id);
    setEditTitle(thread.title);
  }, []);

  /** 确认重命名 */
  const handleConfirmRename = useCallback(async () => {
    if (editingId && editTitle.trim()) {
      await renameThread(editingId, editTitle.trim());
    }
    setEditingId(null);
  }, [editingId, editTitle, renameThread]);

  /** 取消重命名 */
  const handleCancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  /** 删除会话 */
  const handleDelete = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation();
      if (!confirm("确定删除这个会话吗？删除后不可恢复。")) return;
      await deleteThread(threadId);
      // 如果删除的是当前会话，跳转到 /council
      if (threadId === currentThreadId) {
        router.push("/council");
      }
    },
    [deleteThread, currentThreadId, router]
  );

  /** 切换置顶 */
  const handleTogglePin = useCallback(
    (e: React.MouseEvent, thread: Thread) => {
      e.stopPropagation();
      togglePin(thread.id, !thread.pinned);
    },
    [togglePin]
  );

  return (
    <div
      className={`flex flex-col h-full bg-[var(--cafe-surface,#1e1f26)] border-r border-[var(--cafe-border-subtle,#2a2c3a)] ${className ?? ""}`}
      data-council-thread-list="root"
    >
      {/* 顶部：标题 + 新建按钮 */}
      <div className="flex items-center justify-between px-3 h-[52px] border-b border-[var(--cafe-border-subtle,#2a2c3a)] flex-shrink-0">
        <span className="text-sm font-bold text-[var(--cafe-text,#e5e7eb)]">
          群聊会话
        </span>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          className="px-2.5 py-1 text-xs font-semibold rounded-md bg-[var(--accent,#6366f1)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
          data-council-thread-list="new-btn"
        >
          {isCreating ? "..." : "+ 新对话"}
        </button>
      </div>

      {/* 搜索框（参考 clowder-ai ThreadSidebar 搜索） */}
      {threads.length > 0 && (
        <div className="px-2 py-1.5 border-b border-[var(--cafe-border-subtle,#2a2c3a)] flex-shrink-0">
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            aria-label="搜索会话"
            className="w-full px-2 py-1 text-xs rounded bg-[var(--bg,#16171e)] border border-[var(--cafe-border-subtle,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)] placeholder-[var(--cafe-text-muted,#6b7280)] outline-none focus:border-[var(--accent,#6366f1)]"
          />
        </div>
      )}

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto py-1 px-1.5">
        {isLoading && threads.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--cafe-text-muted,#6b7280)]">
            加载中...
          </div>
        ) : threads.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--cafe-text-muted,#6b7280)] text-center">
            暂无会话，点击"新对话"开始
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--cafe-text-muted,#6b7280)] text-center">
            未找到匹配的会话
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isActive = thread.id === currentThreadId;
            const isEditing = thread.id === editingId;
            return (
              <div
                key={thread.id}
                onClick={() => handleSelect(thread.id)}
                onDoubleClick={() => handleStartRename(thread)}
                className={`group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors mb-0.5 ${
                  isActive
                    ? "bg-[var(--console-rail-item-active,#2d2f3e)] text-[var(--cafe-text,#e5e7eb)]"
                    : "text-[var(--cafe-text-secondary,#9ca3af)] hover:bg-[var(--console-rail-item,#252633)]"
                }`}
                data-council-thread-item={thread.id}
              >
                {/* 置顶图标 */}
                <button
                  type="button"
                  onClick={(e) => handleTogglePin(e, thread)}
                  className="flex-shrink-0 text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                  title={thread.pinned ? "取消置顶" : "置顶"}
                >
                  {thread.pinned ? "📌" : "📍"}
                </button>

                {/* 标题 / 编辑框 */}
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={handleConfirmRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirmRename();
                      if (e.key === "Escape") handleCancelRename();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-[var(--bg,#16171e)] border border-[var(--accent,#6366f1)] rounded px-1.5 py-0.5 text-xs text-[var(--cafe-text,#e5e7eb)] outline-none"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate text-xs font-medium">
                    {thread.pinned && "📌 "}
                    {thread.title}
                  </span>
                )}

                {/* 删除按钮（hover 显示） */}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, thread.id)}
                    className="flex-shrink-0 text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-red-400"
                    title="删除会话"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * CouncilThreadList — 群聊会话列表侧栏
 *
 * 功能：
 *   - "+ 新对话"按钮 → 创建新会话并跳转
 *   - 会话列表（置顶优先 + 按更新时间降序）
 *   - 搜索框（按标题/ID 过滤）
 *   - Tab 分组：置顶 / 最近 / 收藏 / 系统 / 回收站
 *   - 标签筛选栏（动态从会话标签聚合）
 *   - 切换会话（点击列表项）
 *   - 重命名会话（双击标题进入编辑）
 *   - 右键上下文菜单 / hover 更多菜单（重命名/置顶/收藏/导出/删除）
 *   - 未读数显示
 *   - 相对时间显示
 *   - 回收站（查看/恢复）
 *
 * 参考 clowder-ai ThreadSidebar 的会话列表设计
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useThreadStore, getThreadsByTab, searchThreads, type Thread } from "@/stores/threadStore";
import { ThreadItemMenu } from "./ThreadItemMenu";
import { formatRelativeTime } from "./thread-time-utils";
import { exportThreadAsMarkdown } from "./thread-export-utils";
import { THREAD_TABS, type ThreadTab } from "@/lib/council-types";

/** 右键菜单定位 */
interface ContextMenuState {
  threadId: string;
  x: number;
  y: number;
}

interface CouncilThreadListProps {
  /** 当前选中的会话 ID */
  currentThreadId: string | null;
  /** className */
  className?: string;
  /** 选中会话时的回调（不传则默认 router.push 到 /council/{id}） */
  onThreadSelect?: (threadId: string) => void;
}

export function CouncilThreadList({
  currentThreadId,
  className,
  onThreadSelect,
}: CouncilThreadListProps) {
  const router = useRouter();
  const {
    threads,
    trashThreads,
    isLoading,
    isCreating,
    loadThreads,
    loadTrash,
    createThread,
    selectThread,
    renameThread,
    deleteThread,
    restoreThread,
    togglePin,
    toggleFavorite,
    markRead,
  } = useThreadStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  // 分组过滤：置顶 / 最近 / 收藏 / 系统 / 回收站（参考 clowder-ai 5 Tab 分组）
  const [filterGroup, setFilterGroup] = useState<ThreadTab>("pinned");
  // 标签筛选：null = 不筛选
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 从所有会话中聚合出可用标签列表（去重）
  const availableLabels = useMemo(() => {
    const set = new Set<string>();
    for (const t of threads) {
      if (t.labels && t.labels.length > 0) {
        for (const l of t.labels) set.add(l);
      }
    }
    return Array.from(set).sort();
  }, [threads]);

  // 搜索 + 分组 + 标签过滤（使用 store 工具函数）
  const filteredThreads = useMemo(() => {
    let result = getThreadsByTab(threads, filterGroup);
    // 标签过滤
    if (labelFilter) {
      result = result.filter(
        (t) => t.labels?.includes(labelFilter) ?? false
      );
    }
    // 搜索过滤（使用 store 工具函数）
    return searchThreads(result, searchQuery);
  }, [threads, searchQuery, filterGroup, labelFilter]);

  // 排序：置顶优先，再按更新时间降序
  const sortedThreads = useMemo(() => {
    return [...filteredThreads].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [filteredThreads]);

  // 各 Tab 计数（使用 getThreadsByTab 统一计算）
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {
      pinned: 0,
      recent: 0,
      favorites: 0,
      system: 0,
      trash: 0,
    };
    for (const tab of Object.keys(counts)) {
      counts[tab] = getThreadsByTab(threads, tab as any).length;
    }
    // 回收站计数从 trashThreads 获取
    counts.trash = trashThreads.length;
    return counts;
  }, [threads, trashThreads]);

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
      if (onThreadSelect) {
        onThreadSelect(id);
      } else {
        router.push(`/council/${id}`);
      }
    }
  }, [createThread, selectThread, router, onThreadSelect]);

  /** 选择会话（同时清零未读数） */
  const handleSelect = useCallback(
    (threadId: string) => {
      if (editingId) return;
      selectThread(threadId);
      markRead(threadId);
      if (onThreadSelect) {
        onThreadSelect(threadId);
      } else {
        router.push(`/council/${threadId}`);
      }
    },
    [selectThread, router, editingId, onThreadSelect, markRead]
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

  /** 删除会话（已在外层 ThreadItemMenu 中确认过） */
  const handleDeleteConfirmed = useCallback(
    async (threadId: string) => {
      await deleteThread(threadId);
      if (threadId === currentThreadId) {
        router.push("/council");
      }
    },
    [deleteThread, currentThreadId, router]
  );

  /** 切换置顶 */
  const handleTogglePin = useCallback(
    (thread: Thread) => {
      togglePin(thread.id, !thread.pinned);
    },
    [togglePin]
  );

  /** 切换收藏 */
  const handleToggleFavorite = useCallback(
    (thread: Thread) => {
      toggleFavorite(thread.id, !thread.favorited);
    },
    [toggleFavorite]
  );

  /** 右键菜单触发 */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, thread: Thread) => {
      // 编辑模式下不弹右键菜单
      if (editingId === thread.id) return;
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ threadId: thread.id, x: e.clientX, y: e.clientY });
    },
    [editingId]
  );

  /** 关闭右键菜单 */
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  /** 进入回收站视图 */
  const handleShowTrash = useCallback(() => {
    setShowTrash(true);
    setFilterGroup("trash");
    loadTrash();
  }, [loadTrash]);

  /** 返回正常列表 */
  const handleBackToList = useCallback(() => {
    setShowTrash(false);
    setFilterGroup("pinned");
  }, []);

  /** 恢复会话 */
  const handleRestore = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation();
      await restoreThread(threadId);
    },
    [restoreThread]
  );

  /** 格式化删除时间 */
  const formatDeletedAt = useCallback((raw: string | null) => {
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  }, []);

  /** 导出会话为 Markdown — 参考 clowder-ai ThreadItem 导出功能 */
  const handleExportThread = useCallback(async (thread: Thread) => {
    try {
      const res = await fetch(`/api/v1/threads/${thread.id}/export?format=md`);
      if (!res.ok) {
        // 后端不支持导出时，前端拼接基础信息
        const messagesRes = await fetch(`/api/v1/threads/${thread.id}/messages?limit=500`);
        const messages = messagesRes.ok ? await messagesRes.json() : [];
        const lines: string[] = [
          `# ${thread.title}`,
          "",
          `> 会话 ID: ${thread.id}`,
          `> 创建时间: ${thread.created_at}`,
          `> 更新时间: ${thread.updated_at}`,
          "",
          "---",
          "",
        ];
        for (const msg of messages.items ?? messages ?? []) {
          const ts = new Date(msg.timestamp).toLocaleString();
          const who = msg.source === "user"
            ? "用户"
            : msg.forgekin_name
              ? `${msg.forgekin_name}（${msg.forgekin_role ?? ""}）`
              : "系统";
          lines.push(`## ${who} · ${ts}`, "", msg.content ?? "", "", "---", "");
        }
        const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${thread.title.replace(/[<>:"/\\|?*]/g, "_")}.md`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${thread.title.replace(/[<>:"/\\|?*]/g, "_")}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("导出会话失败:", e);
      alert("导出会话失败，请查看控制台");
    }
  }, []);

  // 当前右键菜单指向的会话对象
  const contextMenuThread = useMemo(() => {
    if (!contextMenu) return null;
    return threads.find((t) => t.id === contextMenu.threadId) ?? null;
  }, [contextMenu, threads]);

  return (
    <div
      className={`flex flex-col h-full bg-[var(--bg-elevated)] border-r border-[var(--border)] ${className ?? ""}`}
      data-council-thread-list="root"
    >
      {/* 顶部：标题 + 新建按钮 */}
      <div className="flex items-center justify-between px-3 h-[52px] border-b border-[var(--border)] flex-shrink-0">
        <span className="text-sm font-bold text-[var(--text)]">
          群聊会话
        </span>
        <button
          type="button"
          onClick={handleCreate}
          disabled={isCreating}
          className="px-2.5 py-1 text-xs font-semibold rounded-md bg-[var(--accent)] text-[var(--accent-foreground,#fff)] hover:opacity-90 disabled:opacity-40 transition-opacity"
          data-council-thread-list="new-btn"
        >
          {isCreating ? "..." : "+ 新对话"}
        </button>
      </div>

      {/* 搜索框 + 分组过滤 + 标签过滤（参考 clowder-ai ThreadSidebar） */}
      {!showTrash && threads.length > 0 && (
        <div className="px-2 py-1.5 border-b border-[var(--border)] flex-shrink-0 space-y-1.5">
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            aria-label="搜索会话"
            className="w-full px-2 py-1 text-xs rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] outline-none focus:border-[var(--accent)]"
          />
          {/* 分组过滤标签栏 — 参考 clowder-ai LabelFilterBar */}
          <div className="flex items-center gap-1 flex-wrap">
            {THREAD_TABS.map((tab) => {
              const count = tabCounts[tab.key] ?? 0;
              const isTrashTab = tab.key === "trash";
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    if (isTrashTab) {
                      setShowTrash(true);
                      loadTrash();
                    } else {
                      setShowTrash(false);
                      setFilterGroup(tab.key);
                    }
                  }}
                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                    (filterGroup === tab.key || (isTrashTab && showTrash))
                      ? "bg-[var(--accent)] text-[var(--accent-foreground,#fff)]"
                      : "text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))] hover:text-[var(--text)]"
                  }`}
                  aria-pressed={filterGroup === tab.key}
                >
                  {tab.icon} {tab.label}
                  {count > 0 && ` (${count})`}
                </button>
              );
            })}
          </div>
          {/* 标签筛选栏 — 仅当存在标签时显示 */}
          {availableLabels.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-[var(--muted)] flex-shrink-0">标签:</span>
              <button
                type="button"
                onClick={() => setLabelFilter(null)}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  labelFilter === null
                    ? "bg-[var(--accent)] text-[var(--accent-foreground,#fff)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))] hover:text-[var(--text)]"
                }`}
              >
                全部
              </button>
              {availableLabels.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setLabelFilter(label)}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                    labelFilter === label
                      ? "bg-[var(--accent)] text-[var(--accent-foreground,#fff)]"
                      : "text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))] hover:text-[var(--text)]"
                  }`}
                  title={`按标签 ${label} 过滤`}
                >
                  #{label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 会话列表 / 回收站列表 */}
      <div className="flex-1 overflow-y-auto py-1 px-1.5">
        {showTrash ? (
          trashThreads.length === 0 ? (
            <div className="px-3 py-4 text-xs text-[var(--muted)] text-center">
              回收站为空
            </div>
          ) : (
            trashThreads.map((thread) => {
              const deletedAt = formatDeletedAt(thread.deleted_at);
              return (
                <div
                  key={thread.id}
                  className="group flex items-center gap-2 px-2.5 py-2 rounded-md mb-0.5 text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))]"
                  data-council-trash-item={thread.id}
                >
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className="truncate text-xs font-medium">
                      {thread.title}
                    </span>
                    {deletedAt && (
                      <span className="text-[10px] text-[var(--muted)] truncate">
                        删除于 {deletedAt}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleRestore(e, thread.id)}
                    className="flex-shrink-0 text-xs opacity-60 group-hover:opacity-100 hover:!opacity-100 transition-opacity text-emerald-400"
                    title="恢复会话"
                  >
                    ↩ 恢复
                  </button>
                </div>
              );
            })
          )
        ) : isLoading && threads.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--muted)]">
            加载中...
          </div>
        ) : threads.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--muted)] text-center">
            暂无会话，点击"新对话"开始
          </div>
        ) : sortedThreads.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--muted)] text-center">
            未找到匹配的会话
          </div>
        ) : (
          sortedThreads.map((thread) => {
            const isActive = thread.id === currentThreadId;
            const isEditing = thread.id === editingId;
            const unread = thread.unread_count ?? 0;
            return (
              <div
                key={thread.id}
                onClick={() => handleSelect(thread.id)}
                onDoubleClick={() => handleStartRename(thread)}
                onContextMenu={(e) => handleContextMenu(e, thread)}
                className={`group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors mb-0.5 ${
                  isActive
                    ? "bg-[var(--accent-subtle,color-mix(in_srgb,var(--accent)_12%,transparent))] text-[var(--text)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))] hover:text-[var(--text)]"
                }`}
                data-council-thread-item={thread.id}
              >
                {/* 置顶图标 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTogglePin(thread);
                  }}
                  className="flex-shrink-0 text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                  title={thread.pinned ? "取消置顶" : "置顶"}
                  aria-label={thread.pinned ? "取消置顶" : "置顶"}
                >
                  {thread.pinned ? "📌" : "📍"}
                </button>

                {/* 标题 / 编辑框 + 副信息（时间/未读） */}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
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
                      className="w-full bg-[var(--bg)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-xs text-[var(--text)] outline-none"
                    />
                  ) : (
                    <>
                      <span className="flex items-center gap-1 truncate text-xs font-medium">
                        {thread.pinned && <span aria-hidden>📌</span>}
                        {thread.favorited && (
                          <span className="text-amber-400" aria-label="已收藏">★</span>
                        )}
                        <span className="truncate">{thread.title}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                        <span>{formatRelativeTime(thread.updated_at)}</span>
                        {thread.labels && thread.labels.length > 0 && (
                          <span className="flex items-center gap-0.5 truncate">
                            {thread.labels.slice(0, 2).map((l) => (
                              <span
                                key={l}
                                className="px-1 rounded-sm bg-[var(--bg-hover,var(--bg-accent))] truncate max-w-[60px]"
                              >
                                #{l}
                              </span>
                            ))}
                            {thread.labels.length > 2 && (
                              <span>+{thread.labels.length - 2}</span>
                            )}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>

                {/* 未读数徽章 */}
                {!isEditing && unread > 0 && (
                  <span
                    className="flex-shrink-0 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] font-semibold rounded-full bg-red-500 text-white"
                    aria-label={`${unread} 条未读消息`}
                    title={`${unread} 条未读消息`}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}

                {/* 更多操作菜单触发按钮（hover 显示）— 参考 clowder-ai ThreadItem MoreVerticalIcon */}
                {!isEditing && (
                  <ThreadItemMenu
                    thread={thread}
                    onRename={() => handleStartRename(thread)}
                    onTogglePin={() => handleTogglePin(thread)}
                    onToggleFavorite={() => handleToggleFavorite(thread)}
                    onExport={() => handleExportThread(thread)}
                    onDelete={() => handleDeleteConfirmed(thread.id)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 底部：回收站 / 返回列表 */}
      <div className="flex-shrink-0 border-t border-[var(--border)] px-2 py-1.5">
        {showTrash ? (
          <button
            type="button"
            onClick={handleBackToList}
            className="w-full px-2.5 py-1.5 text-xs font-medium rounded-md text-[var(--text)] hover:bg-[var(--bg-hover,var(--bg-accent))] transition-colors"
            data-council-thread-list="back-btn"
          >
            ← 返回列表
          </button>
        ) : (
          <button
            type="button"
            onClick={handleShowTrash}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs font-medium rounded-md text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))] hover:text-[var(--text)] transition-colors"
            data-council-thread-list="trash-btn"
          >
            <span className="flex items-center gap-1.5">
              <span>🗑</span>
              <span>回收站</span>
            </span>
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-[var(--bg-hover,var(--bg-accent))] text-[var(--muted)]">
              {trashThreads.length}
            </span>
          </button>
        )}
      </div>

      {/* 右键上下文菜单 — 参考 clowder-ai ThreadItem 下拉菜单但定位为右键触发 */}
      {contextMenu && contextMenuThread && (
        <ThreadItemMenu
          thread={contextMenuThread}
          mode="context"
          open
          onClose={handleCloseContextMenu}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onRename={() => {
            handleCloseContextMenu();
            handleStartRename(contextMenuThread);
          }}
          onTogglePin={() => handleTogglePin(contextMenuThread)}
          onToggleFavorite={() => handleToggleFavorite(contextMenuThread)}
          onExport={() => handleExportThread(contextMenuThread)}
          onDelete={() => handleDeleteConfirmed(contextMenuThread.id)}
        />
      )}
    </div>
  );
}




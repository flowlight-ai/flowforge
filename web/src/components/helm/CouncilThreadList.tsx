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
  } = useThreadStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showTrash, setShowTrash] = useState(false);
  // 分组过滤：全部 / 置顶 / 最近（参考 clowder-ai LabelFilterBar + 项目分组）
  const [filterGroup, setFilterGroup] = useState<"all" | "pinned" | "recent">("all");
  const editInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 搜索 + 分组过滤（参考 clowder-ai ThreadSidebar 搜索 + LabelFilterBar）
  const filteredThreads = useMemo(() => {
    let result = threads;
    // 分组过滤
    if (filterGroup === "pinned") {
      result = result.filter((t) => t.pinned);
    } else if (filterGroup === "recent") {
      // 最近 7 天的会话
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      result = result.filter((t) => new Date(t.updated_at).getTime() > sevenDaysAgo);
    }
    // 搜索过滤
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
      );
    }
    return result;
  }, [threads, searchQuery, filterGroup]);

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

  /** 选择会话 */
  const handleSelect = useCallback(
    (threadId: string) => {
      if (editingId) return;
      selectThread(threadId);
      if (onThreadSelect) {
        onThreadSelect(threadId);
      } else {
        router.push(`/council/${threadId}`);
      }
    },
    [selectThread, router, editingId, onThreadSelect]
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
      if (!confirm("确定删除这个会话吗？删除后可在回收站恢复。")) return;
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

  /** 进入回收站视图 */
  const handleShowTrash = useCallback(() => {
    setShowTrash(true);
    loadTrash();
  }, [loadTrash]);

  /** 返回正常列表 */
  const handleBackToList = useCallback(() => {
    setShowTrash(false);
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

      {/* 搜索框 + 分组过滤（参考 clowder-ai ThreadSidebar 搜索 + LabelFilterBar） */}
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
          <div className="flex items-center gap-1">
            {([
              { key: "all", label: "全部", count: threads.length },
              { key: "pinned", label: "置顶", count: threads.filter((t) => t.pinned).length },
              { key: "recent", label: "最近", count: threads.filter((t) => new Date(t.updated_at).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000).length },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterGroup(tab.key)}
                className={`px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors ${
                  filterGroup === tab.key
                    ? "bg-[var(--accent)] text-[var(--accent-foreground,#fff)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))] hover:text-[var(--text)]"
                }`}
                aria-pressed={filterGroup === tab.key}
              >
                {tab.label}
                {tab.count > 0 && ` (${tab.count})`}
              </button>
            ))}
          </div>
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
        ) : filteredThreads.length === 0 ? (
          <div className="px-3 py-4 text-xs text-[var(--muted)] text-center">
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
                    ? "bg-[var(--accent-subtle,color-mix(in_srgb,var(--accent)_12%,transparent))] text-[var(--text)]"
                    : "text-[var(--muted)] hover:bg-[var(--bg-hover,var(--bg-accent))] hover:text-[var(--text)]"
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
                    className="flex-1 min-w-0 bg-[var(--bg)] border border-[var(--accent)] rounded px-1.5 py-0.5 text-xs text-[var(--text)] outline-none"
                  />
                ) : (
                  <span className="flex-1 min-w-0 truncate text-xs font-medium">
                    {thread.pinned && "📌 "}
                    {thread.title}
                  </span>
                )}

                {/* 更多操作菜单触发按钮（hover 显示）— 参考 clowder-ai ThreadItem MoreVerticalIcon */}
                {!isEditing && (
                  <ThreadItemMenu
                    thread={thread}
                    onRename={() => handleStartRename(thread)}
                    onTogglePin={() => togglePin(thread.id, !thread.pinned)}
                    onDelete={() => {
                      if (confirm("确定删除这个会话吗？删除后可在回收站恢复。")) {
                        deleteThread(thread.id);
                        if (thread.id === currentThreadId) router.push("/council");
                      }
                    }}
                    onExport={() => handleExportThread(thread)}
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
    </div>
  );
}

/**
 * ThreadItemMenu — 会话项更多操作下拉菜单
 *
 * 参考 clowder-ai ThreadItem.tsx:312-377 的 MoreVerticalIcon 下拉菜单。
 * 功能：重命名 / 置顶切换 / 导出 / 删除
 */
function ThreadItemMenu({
  thread,
  onRename,
  onTogglePin,
  onDelete,
  onExport,
}: {
  thread: Thread;
  onRename: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div
      ref={menuRef}
      className="relative flex-shrink-0"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-[var(--muted)] hover:text-[var(--text)] px-1"
        title="更多操作"
        aria-label="更多操作"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[140px] py-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg"
          role="menu"
        >
          <button
            type="button"
            onClick={() => { onRename(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--bg-hover,var(--bg-accent))] transition-colors"
            role="menuitem"
          >
            ✎ 重命名
          </button>
          <button
            type="button"
            onClick={() => { onTogglePin(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--bg-hover,var(--bg-accent))] transition-colors"
            role="menuitem"
          >
            {thread.pinned ? "📍 取消置顶" : "📌 置顶"}
          </button>
          <button
            type="button"
            onClick={() => { onExport(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--bg-hover,var(--bg-accent))] transition-colors"
            role="menuitem"
          >
            ⬇ 导出
          </button>
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            type="button"
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-[color-mix(in_srgb,#ef4444_10%,transparent)] transition-colors"
            role="menuitem"
          >
            🗑 删除
          </button>
        </div>
      )}
    </div>
  );
}

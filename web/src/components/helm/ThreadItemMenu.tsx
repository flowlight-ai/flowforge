"use client";

/**
 * ThreadItemMenu — 会话项操作菜单
 *
 * 参考 clowder-ai ThreadItem.tsx 的 MoreVerticalIcon 下拉菜单。
 *
 * 支持两种呈现模式：
 *   - mode="dropdown"：默认。hover 显示触发按钮，点击展开下拉菜单
 *   - mode="context"：右键上下文菜单模式，由父组件控制 open 状态和定位
 *
 * 菜单项：重命名 / 置顶切换 / 收藏切换 / 导出（markdown） / 删除（带确认对话框）
 *
 * 删除确认：内联实现轻量级确认弹窗，避免依赖全局 ConfirmProvider 上下文
 * （CouncilThreadList 可能在没有 Provider 的环境下渲染，例如动态导入）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Thread } from "@/stores/threadStore";

export interface ThreadItemMenuProps {
  /** 目标会话 */
  thread: Thread;
  /** 触发重命名 */
  onRename: () => void;
  /** 切换置顶 */
  onTogglePin: () => void;
  /** 切换收藏 */
  onToggleFavorite: () => void;
  /** 导出为 Markdown */
  onExport: () => void;
  /** 删除（已经过确认对话框） */
  onDelete: () => void;
  /** 渲染模式：dropdown=悬浮下拉，context=右键上下文菜单 */
  mode?: "dropdown" | "context";
  /** context 模式下的显式 open 状态 */
  open?: boolean;
  /** context 模式下关闭回调 */
  onClose?: () => void;
  /** context 模式下的定位坐标（相对父容器） */
  position?: { x: number; y: number };
}

export function ThreadItemMenu({
  thread,
  onRename,
  onTogglePin,
  onToggleFavorite,
  onExport,
  onDelete,
  mode = "dropdown",
  open: openProp,
  onClose,
  position,
}: ThreadItemMenuProps) {
  // dropdown 模式：内部维护 open 状态
  const [internalOpen, setInternalOpen] = useState(false);
  const open = mode === "context" ? !!openProp : internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (mode === "context") {
        if (!next) onClose?.();
      } else {
        setInternalOpen(next);
      }
    },
    [mode, onClose]
  );

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭（仅 dropdown 模式需要；context 模式由父组件管理）
  useEffect(() => {
    if (!open || mode !== "dropdown") return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setInternalOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInternalOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, mode]);

  /** 关闭菜单（dropdown 模式） */
  const closeMenu = useCallback(() => {
    setOpen(false);
  }, [setOpen]);

  const handleRename = useCallback(() => {
    closeMenu();
    onRename();
  }, [closeMenu, onRename]);

  const handleTogglePin = useCallback(() => {
    closeMenu();
    onTogglePin();
  }, [closeMenu, onTogglePin]);

  const handleToggleFavorite = useCallback(() => {
    closeMenu();
    onToggleFavorite();
  }, [closeMenu, onToggleFavorite]);

  const handleExport = useCallback(() => {
    closeMenu();
    onExport();
  }, [closeMenu, onExport]);

  const handleDeleteClick = useCallback(() => {
    // 不关闭菜单本身——在其上层覆盖确认对话框
    setConfirmingDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    setConfirmingDelete(false);
    closeMenu();
    onDelete();
  }, [closeMenu, onDelete]);

  const handleDeleteCancel = useCallback(() => {
    setConfirmingDelete(false);
  }, []);

  // ── 菜单内容（dropdown 与 context 共用） ─────────────────────────
  const menuContent = (
    <div
      role="menu"
      aria-label="会话操作"
      className="min-w-[160px] py-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg"
    >
      <MenuButton onClick={handleRename} icon="✎" label="重命名" />
      <MenuButton
        onClick={handleTogglePin}
        icon={thread.pinned ? "📍" : "📌"}
        label={thread.pinned ? "取消置顶" : "置顶"}
      />
      <MenuButton
        onClick={handleToggleFavorite}
        icon={thread.favorited ? "★" : "☆"}
        label={thread.favorited ? "取消收藏" : "收藏"}
        iconClassName={thread.favorited ? "text-amber-400" : undefined}
      />
      <MenuButton onClick={handleExport} icon="⬇" label="导出 Markdown" />
      <div className="my-1 border-t border-[var(--border)]" />
      <MenuButton
        onClick={handleDeleteClick}
        icon="🗑"
        label="删除"
        danger
      />
    </div>
  );

  // ── context 模式：直接渲染定位的浮动菜单 ─────────────────────────
  if (mode === "context") {
    if (!open) return null;
    return (
      <>
        {/* 全局遮罩：捕获外部点击以关闭 */}
        <div
          className="fixed inset-0 z-40"
          onClick={closeMenu}
          onContextMenu={(e) => {
            e.preventDefault();
            closeMenu();
          }}
          aria-hidden="true"
        />
        <div
          ref={menuRef}
          className="fixed z-50"
          style={{
            left: Math.min(position?.x ?? 0, window.innerWidth - 180),
            top: Math.min(position?.y ?? 0, window.innerHeight - 220),
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuContent}
        </div>
        {confirmingDelete && (
          <DeleteConfirmDialog
            thread={thread}
            onConfirm={handleDeleteConfirm}
            onCancel={handleDeleteCancel}
          />
        )}
      </>
    );
  }

  // ── dropdown 模式：触发按钮 + 浮动下拉 ───────────────────────────
  return (
    <div
      ref={menuRef}
      className="relative flex-shrink-0"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setInternalOpen((v) => !v);
        }}
        className="text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:!opacity-100 transition-opacity text-[var(--muted)] hover:text-[var(--text)] px-1"
        title="更多操作"
        aria-label="更多操作"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50">{menuContent}</div>
      )}
      {confirmingDelete && (
        <DeleteConfirmDialog
          thread={thread}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}

// ─── 内部子组件 ─────────────────────────────────────────────────

function MenuButton({
  onClick,
  icon,
  label,
  danger,
  iconClassName,
}: {
  onClick: () => void;
  icon: string;
  label: string;
  danger?: boolean;
  iconClassName?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
        danger
          ? "text-red-400 hover:bg-[color-mix(in_srgb,#ef4444_10%,transparent)]"
          : "text-[var(--text)] hover:bg-[var(--bg-hover,var(--bg-accent))]"
      }`}
    >
      <span className={`inline-flex w-3 justify-center ${iconClassName ?? ""}`}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

/**
 * 删除确认对话框 — 轻量级内联实现
 *
 * 参考 clowder-ai ThreadSidebar.tsx 的 DeleteConfirmDialog，
 * 简化为单一确认流程（不区分系统/普通会话）。
 */
function DeleteConfirmDialog({
  thread,
  onConfirm,
  onCancel,
}: {
  thread: Thread;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 进入时聚焦取消按钮（防误删的默认导向）
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Esc 取消
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="确认删除会话"
    >
      <div
        className="bg-[var(--bg-elevated)] text-[var(--text)] rounded-lg shadow-2xl max-w-sm w-full mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold mb-2">确认删除对话</h3>
        <p className="text-xs mb-1 text-[var(--text)]">
          即将删除「{thread.title || "未命名讨论"}」
        </p>
        <p className="text-xs mb-4 text-[var(--muted)]">
          对话将移入回收站，可在回收站中恢复。
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-hover,var(--bg-accent))] transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

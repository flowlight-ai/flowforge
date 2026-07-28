"use client";

import { useState, useCallback } from "react";

/** Git Worktree 信息 */
export interface WorktreeItem {
  id: string;
  path: string;
  branch: string;
  commit: string;
  commitMessage: string;
  isActive: boolean;
  diffStats?: {
    added: number;
    modified: number;
    deleted: number;
  };
}

interface WorktreePanelProps {
  /** Worktree 列表 */
  worktrees: WorktreeItem[];
  /** 创建 worktree */
  onCreate: (branch: string, path?: string) => void;
  /** 切换 worktree */
  onSwitch: (worktreeId: string) => void;
  /** 删除 worktree */
  onDelete: (worktreeId: string) => void;
}

/** Worktree 隔离面板 — 管理 Git Worktree 多分支并行开发 */
export default function WorktreePanel({ worktrees, onCreate, onSwitch, onDelete }: WorktreePanelProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [newPath, setNewPath] = useState("");

  const handleCreate = useCallback(() => {
    if (!newBranch.trim()) return;
    onCreate(newBranch.trim(), newPath.trim() || undefined);
    setNewBranch("");
    setNewPath("");
    setShowCreate(false);
  }, [newBranch, newPath, onCreate]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-elevated)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="text-sm font-semibold text-[var(--text)]">Worktree</span>
        <span className="text-[10px] text-[var(--muted)] ml-1">{worktrees.length} 个</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2 py-1 rounded-lg bg-[var(--cafe-accent)] hover:bg-[var(--cafe-accent-hover)] text-[var(--cafe-accent-foreground)] transition-colors"
        >
          + 新建
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-elevated)] space-y-2 flex-shrink-0">
          <div>
            <label className="text-[11px] text-[var(--muted)] block mb-1">分支名</label>
            <input
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="feature/new-feature"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--cafe-accent)]"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--muted)] block mb-1">路径（可选）</label>
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="自动生成"
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--cafe-accent)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newBranch.trim()}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-[var(--cafe-accent)] hover:bg-[var(--cafe-accent-hover)] text-[var(--cafe-accent-foreground)] transition-colors disabled:opacity-40"
            >
              创建
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewBranch(""); setNewPath(""); }}
              className="px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--text)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Worktree list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {worktrees.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)] text-xs p-4">
            暂无 Worktree
          </div>
        ) : (
          worktrees.map((wt) => (
            <div
              key={wt.id}
              className={`px-4 py-3 border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] transition-colors ${
                wt.isActive
                  ? "bg-[color-mix(in_srgb,var(--cafe-accent)_5%,transparent)] border-l-2 border-l-[var(--cafe-accent)]"
                  : "hover:bg-[var(--bg-hover)]"
              }`}
            >
              <div className="flex items-center gap-2">
                {/* Active indicator */}
                {wt.isActive ? (
                  <span className="w-2 h-2 rounded-full bg-[var(--cafe-accent)] flex-shrink-0" title="当前活跃" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-[var(--bg-muted)] flex-shrink-0" />
                )}

                {/* Branch name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-[var(--muted)] flex-shrink-0">
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                    </svg>
                    <span className="text-sm font-medium text-[var(--text)] truncate">{wt.branch}</span>
                  </div>
                  <div className="mt-1 ml-[18px] text-[11px] text-[var(--muted)] font-mono truncate">
                    {wt.commit.slice(0, 7)} {wt.commitMessage}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!wt.isActive && (
                    <button
                      onClick={() => onSwitch(wt.id)}
                      className="text-[var(--muted)] hover:text-[var(--cafe-accent)] p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
                      title="切换到此 Worktree"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  )}
                  {!wt.isActive && (
                    <button
                      onClick={() => onDelete(wt.id)}
                      className="text-[var(--muted)] hover:text-[var(--danger)] p-1 rounded hover:bg-[var(--bg-hover)] transition-colors"
                      title="删除 Worktree"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Path & diff stats */}
              <div className="mt-2 ml-[18px] flex items-center gap-3">
                <span className="text-[10px] text-[var(--muted)] font-mono truncate flex-1" title={wt.path}>
                  {wt.path}
                </span>
                {wt.diffStats && (
                  <div className="flex items-center gap-2 text-[10px] font-mono flex-shrink-0">
                    {wt.diffStats.added > 0 && (
                      <span className="text-[var(--ok)]">+{wt.diffStats.added}</span>
                    )}
                    {wt.diffStats.modified > 0 && (
                      <span className="text-[var(--semantic-warning)]">~{wt.diffStats.modified}</span>
                    )}
                    {wt.diffStats.deleted > 0 && (
                      <span className="text-[var(--danger)]">-{wt.diffStats.deleted}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

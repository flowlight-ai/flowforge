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
    <div className="flex flex-col h-full bg-[#0c0d12]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="text-sm font-semibold text-gray-200">Worktree</span>
        <span className="text-[10px] text-gray-600 ml-1">{worktrees.length} 个</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
        >
          + 新建
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-4 py-3 border-b border-gray-800 bg-[#12131a] space-y-2 flex-shrink-0">
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">分支名</label>
            <input
              type="text"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              placeholder="feature/new-feature"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">路径（可选）</label>
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="自动生成"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newBranch.trim()}
              className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40"
            >
              创建
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewBranch(""); setNewPath(""); }}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg hover:bg-white/5 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Worktree list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {worktrees.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-xs p-4">
            暂无 Worktree
          </div>
        ) : (
          worktrees.map((wt) => (
            <div
              key={wt.id}
              className={`px-4 py-3 border-b border-gray-800/50 transition-colors ${
                wt.isActive
                  ? "bg-indigo-500/5 border-l-2 border-l-indigo-500"
                  : "hover:bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center gap-2">
                {/* Active indicator */}
                {wt.isActive ? (
                  <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" title="当前活跃" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-gray-700 flex-shrink-0" />
                )}

                {/* Branch name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-500 flex-shrink-0">
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                    </svg>
                    <span className="text-sm font-medium text-gray-200 truncate">{wt.branch}</span>
                  </div>
                  <div className="mt-1 ml-[18px] text-[11px] text-gray-500 font-mono truncate">
                    {wt.commit.slice(0, 7)} {wt.commitMessage}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!wt.isActive && (
                    <button
                      onClick={() => onSwitch(wt.id)}
                      className="text-gray-500 hover:text-indigo-400 p-1 rounded hover:bg-white/10 transition-colors"
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
                      className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-white/10 transition-colors"
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
                <span className="text-[10px] text-gray-600 font-mono truncate flex-1" title={wt.path}>
                  {wt.path}
                </span>
                {wt.diffStats && (
                  <div className="flex items-center gap-2 text-[10px] font-mono flex-shrink-0">
                    {wt.diffStats.added > 0 && (
                      <span className="text-green-400">+{wt.diffStats.added}</span>
                    )}
                    {wt.diffStats.modified > 0 && (
                      <span className="text-amber-400">~{wt.diffStats.modified}</span>
                    )}
                    {wt.diffStats.deleted > 0 && (
                      <span className="text-red-400">-{wt.diffStats.deleted}</span>
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

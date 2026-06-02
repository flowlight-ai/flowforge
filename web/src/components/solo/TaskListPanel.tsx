"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChatMessage, TaskHistoryItem } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";
import { useShellConfig } from "../../lib/shell-config";
import {
  loadTaskHistory,
  saveTaskHistory,
  loadDeletedIds,
  saveDeletedIds,
} from "./solo-utils";

const STALE_TASK_MS = 10 * 60 * 1000;

function fixStalePhase(phase: SoloTaskPhase, timestamp: number): SoloTaskPhase {
  if ((phase === "running" || phase === "creating" || phase === "connecting" || phase === "waiting_review" || phase === "paused") && Date.now() - timestamp > STALE_TASK_MS) {
    return "interrupted";
  }
  return phase;
}

function serverStatusToPhase(status: string): SoloTaskPhase {
  if (status === "completed") return "completed";
  if (status === "error" || status === "failed") return "error";
  if (status === "interrupted") return "interrupted";
  if (status === "paused") return "paused";
  return "running";
}

export default function TaskListPanel({
  phase, intent, taskId, elapsed, onNewTask, onRestoreChat, onSwitchTask, refreshTrigger,
}: {
  phase: SoloTaskPhase; intent: string; taskId: string | null; elapsed: number; onNewTask: () => void;
  onRestoreChat: (messages: ChatMessage[]) => void;
  onSwitchTask: (taskId: string, intent: string, persona: string, phase: SoloTaskPhase) => void;
  refreshTrigger?: number;
}) {
  const config = useShellConfig();
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [leftTab, setLeftTab] = useState<"tasks" | "files">("tasks");
  const [workspaceFiles, setWorkspaceFiles] = useState<{name: string; path: string; size: number; modified: string}[]>([]);

  const refreshList = useCallback(() => {
    const brand = config.brandName.toLowerCase();
    const deletedIds = deletedIdsRef.current;
    fetch("/api/v1/workspace")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const serverItems: TaskHistoryItem[] = (data?.workspaces || []).map((ws: any) => {
          const rawPhase = serverStatusToPhase(ws.status || "completed");
          const ts = ws.created_at ? new Date(ws.created_at).getTime() : Date.now();
          return {
            taskId: ws.task_id,
            persona: ws.persona || "default",
            intent: ws.intent || ws.task_id,
            phase: fixStalePhase(rawPhase, ts),
            timestamp: ts,
          };
        });
        const localItems = loadTaskHistory(brand);
        const merged = new Map<string, TaskHistoryItem>();
        for (const item of [...serverItems, ...localItems]) {
          if (deletedIds.has(item.taskId)) continue;
          const fixed = { ...item, phase: fixStalePhase(item.phase, item.timestamp) };
          const existing = merged.get(item.taskId);
          if (!existing || fixed.timestamp > existing.timestamp) {
            merged.set(item.taskId, fixed);
          }
        }
        const sorted = Array.from(merged.values()).sort((a, b) => (b.lastUserMessageAt || b.timestamp) - (a.lastUserMessageAt || a.timestamp)).slice(0, 20);
        // Defensive: ensure no deletedIds leak into saved history
        const clean = sorted.filter((h) => !deletedIds.has(h.taskId));
        setHistory(clean);
        saveTaskHistory(brand, clean);
      })
      .catch(() => {
        const brand = config.brandName.toLowerCase();
        const local = loadTaskHistory(brand).filter((h) => !deletedIdsRef.current.has(h.taskId)).map(h => ({ ...h, phase: fixStalePhase(h.phase, h.timestamp) }));
        setHistory(local);
      });
  }, [config.brandName]);

  useEffect(() => {
    const brand = config.brandName.toLowerCase();
    deletedIdsRef.current = loadDeletedIds(brand);
    refreshList();
  }, [config.brandName, refreshList, refreshTrigger]);

  useEffect(() => {
    const interval = setInterval(refreshList, 60_000);
    return () => clearInterval(interval);
  }, [refreshList]);

  useEffect(() => {
    if (leftTab === "files") {
      fetch("/api/v1/workspace/files")
        .then((r) => r.json())
        .then((data) => setWorkspaceFiles(data.files || []))
        .catch(() => setWorkspaceFiles([]));
    }
  }, [leftTab, taskId, refreshTrigger]);

  useEffect(() => {
    if (taskId && phase === "running") {
      const brand = config.brandName.toLowerCase();
      // Never re-add a deleted task
      const deletedIds = loadDeletedIds(brand);
      if (deletedIds.has(taskId)) return;
      const existing = loadTaskHistory(brand);
      const found = existing.find((h) => h.taskId === taskId);
      if (!found && intent) {
        const newItem: TaskHistoryItem = { taskId, persona: "default", intent, phase, timestamp: Date.now(), lastUserMessageAt: Date.now() };
        const updated = [newItem, ...existing].slice(0, 20);
        saveTaskHistory(brand, updated);
        setHistory((prev) => {
          if (prev.find((h) => h.taskId === taskId)) return prev;
          return [newItem, ...prev].slice(0, 20);
        });
      } else if (found && found.phase !== phase) {
        // Update phase in place — do NOT change sort position
        const updated = existing.map((h) => h.taskId === taskId ? { ...h, phase } : h);
        saveTaskHistory(brand, updated);
        setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
      }
    }
    if (taskId && (phase === "completed" || phase === "error" || phase === "interrupted")) {
      const brand = config.brandName.toLowerCase();
      const existing = loadTaskHistory(brand);
      // Update phase in place — do NOT change sort position
      const updated = existing.map((h) => h.taskId === taskId ? { ...h, phase } : h);
      saveTaskHistory(brand, updated);
      setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
    }
  }, [taskId, phase, intent, config.brandName]);

  const phaseLabel: Record<SoloTaskPhase, string> = {
    idle: "就绪", creating: "创建中", connecting: "连接中", running: "执行中",
    paused: "已暂停", waiting_review: "待审核", completed: "已完成", error: "出错", rejected: "已拒绝",
    interrupted: "已中断",
  };

  const handleRename = (tid: string) => {
    if (!renameText.trim()) { setRenaming(null); return; }
    const brand = config.brandName.toLowerCase();
    const items = loadTaskHistory(brand);
    const updated = items.map((h) => h.taskId === tid ? { ...h, intent: renameText.trim() } : h);
    saveTaskHistory(brand, updated);
    setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
    setRenaming(null);
    setMenuOpen(null);
    fetch(`/api/v1/workspace/${tid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: renameText.trim() }),
    }).catch(() => {});
  };

  const handleDelete = (tid: string) => {
    const brand = config.brandName.toLowerCase();
    // 1. Remove from local history
    const items = loadTaskHistory(brand).filter((h) => h.taskId !== tid);
    saveTaskHistory(brand, items);
    // 2. Track deleted ID so refreshList won't re-introduce it
    deletedIdsRef.current.add(tid);
    saveDeletedIds(brand, deletedIdsRef.current);
    // 3. Update state immediately (filtering by deletedIds for safety)
    setHistory(items.filter((h) => !deletedIdsRef.current.has(h.taskId)));
    setMenuOpen(null);
    // 4. Delete from server workspace
    fetch(`/api/v1/workspace/${tid}`, { method: "DELETE" }).catch(() => {});
    // If deleting the active task, reset state and clear taskId
    if (tid === taskId) {
      onNewTask();
      return;
    }
  };

  const statusIcon = (p: SoloTaskPhase) => {
    if (p === "running" || p === "creating" || p === "connecting") return <span className="task-status-spinner" />;
    if (p === "completed") return <span className="task-status-check">✓</span>;
    if (p === "error" || p === "rejected") return <span className="task-status-stop">■</span>;
    if (p === "paused") return <span className="task-status-pause">❚❚</span>;
    if (p === "interrupted") return <span className="task-status-interrupted">⏻</span>;
    return <span className="task-status-dot" />;
  };

  const allTasks = useMemo(() => {
    const tasks = history.map(h => ({ ...h, phase: fixStalePhase(h.phase, h.timestamp) }));
    // Only add active task if not already in list AND not deleted
    if (taskId && !tasks.find((t) => t.taskId === taskId) && !deletedIdsRef.current.has(taskId)) {
      tasks.unshift({ taskId, persona: "default", intent: intent || "新任务", phase: fixStalePhase(phase, Date.now()), timestamp: Date.now() });
    }
    return tasks;
  }, [history, taskId, intent, phase]);

  const handleTaskClick = useCallback(async (item: TaskHistoryItem) => {
    if (renaming) return;
    if (item.taskId === taskId) return;
    const effectivePhase: SoloTaskPhase = fixStalePhase(item.phase, item.timestamp);
    onSwitchTask(item.taskId, item.intent, item.persona, effectivePhase);
    try {
      const r = await fetch(`/api/v1/workspace/${item.taskId}/messages`);
      if (r.ok) {
        const data = await r.json();
        const rawMsgs = data.messages || [];
        if (rawMsgs.length > 0) {
          const restored: ChatMessage[] = rawMsgs.map((m: any, i: number) => {
            let role: string = m.role;
            if (role === "assistant") role = "ai";
            return {
              id: `restored-${item.taskId}-${i}`,
              role: role as any,
              content: m.content || "",
              timestamp: m.timestamp || new Date().toISOString(),
              data: m.data || {},
            };
          });
          onRestoreChat(restored);
        } else {
          onRestoreChat([]);
        }
      } else {
        onRestoreChat([]);
      }
    } catch {
      onRestoreChat([]);
    }
  }, [renaming, taskId, onSwitchTask, onRestoreChat]);

  return (
    <div className="solo-task-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo" style={{ background: config.brandColor }}>{config.brandShort}</span>
        <span className="sidebar-title">{leftTab === "tasks" ? "任务列表" : "工作区文件"}</span>
      </div>
      <div className="solo-left-tabs">
        <button className={`solo-left-tab${leftTab === "tasks" ? " active" : ""}`} onClick={() => setLeftTab("tasks")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
          任务
        </button>
        <button className={`solo-left-tab${leftTab === "files" ? " active" : ""}`} onClick={() => setLeftTab("files")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
          文件
        </button>
      </div>
      {leftTab === "tasks" ? (
        <>
          <div className="task-history-list">
            {allTasks.length === 0 ? (
              <div className="task-empty-hint">暂无任务</div>
            ) : (
              allTasks.map((item) => (
                <div key={item.taskId} className={`task-history-item${item.taskId === taskId ? " active" : ""}`}
                  onClick={() => handleTaskClick(item)}
                >
                  <div className="task-history-row">
                    <div className="task-history-content">
                      {renaming === item.taskId ? (
                        <input className="task-rename-input" value={renameText}
                          onChange={(e) => setRenameText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleRename(item.taskId); if (e.key === "Escape") setRenaming(null); }}
                          onBlur={() => handleRename(item.taskId)}
                          autoFocus onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <div className="task-history-intent">{item.intent.length > 40 ? item.intent.slice(0, 40) + "..." : item.intent}</div>
                      )}
                    </div>
                    <div className="task-history-menu-trigger" onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === item.taskId ? null : item.taskId); }}>
                      ⋯
                    </div>
                  </div>
                  <div className="task-history-meta">
                    {statusIcon(item.phase)}
                    <span>{phaseLabel[item.phase]}</span>
                    <span>{new Date(item.timestamp).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  {menuOpen === item.taskId && (
                    <div className="task-context-menu" onClick={(e) => e.stopPropagation()}>
                      <button className="task-context-menu-item" onClick={() => { setRenaming(item.taskId); setRenameText(item.intent); setMenuOpen(null); }}>
                        ✏️ 重命名
                      </button>
                      <button className="task-context-menu-item task-context-menu-danger" onClick={() => handleDelete(item.taskId)}>
                        🗑️ 删除
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="sidebar-footer">
            <button className="btn btn-ghost btn-sm btn-full" onClick={onNewTask}>+ 新任务</button>
          </div>
        </>
      ) : (
        <div className="solo-file-tree">
          {workspaceFiles.length === 0 ? (
            <div className="task-empty-hint">暂无工作区文件</div>
          ) : (
            workspaceFiles.map((f) => (
              <div key={f.path} className="solo-file-tree-item" title={f.path}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-2)" strokeWidth="2" strokeLinecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
                <span className="solo-file-tree-name">{f.name}</span>
                <span className="solo-file-tree-size">{f.size > 1024 ? `${(f.size / 1024).toFixed(1)}K` : `${f.size}B`}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

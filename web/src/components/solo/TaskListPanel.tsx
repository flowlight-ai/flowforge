"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { ChatMessage, TaskHistoryItem } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";
import { useShellConfig } from "../../lib/shell-config";
import {
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

function serverStatusToPhase(status: string, timestamp?: number): SoloTaskPhase {
  if (status === "completed") return "completed";
  if (status === "error" || status === "failed") return "error";
  if (status === "interrupted") return "interrupted";
  if (status === "paused") return "paused";
  if (timestamp && Date.now() - timestamp > STALE_TASK_MS) return "interrupted";
  return "running";
}

export default function TaskListPanel({
  phase, intent, taskId, elapsed, onNewTask, onRestoreChat, onSwitchTask, refreshTrigger, workspaceName, workspaceRefreshKey,
}: {
  phase: SoloTaskPhase; intent: string; taskId: string | null; elapsed: number; onNewTask: () => void;
  onRestoreChat: (messages: ChatMessage[]) => void;
  onSwitchTask: (taskId: string, intent: string, persona: string, phase: SoloTaskPhase) => void;
  refreshTrigger?: number;
  workspaceName?: string;
  workspaceRefreshKey?: number;
}) {
  const config = useShellConfig();
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  // Use ref to always have the latest workspaceName for fetch
  const workspaceNameRef = useRef(workspaceName);
  workspaceNameRef.current = workspaceName;

  const refreshList = useCallback(() => {
    const brand = config.brandName.toLowerCase();
    const deletedIds = deletedIdsRef.current;
    // Always use the latest workspaceName from ref
    const wsName = workspaceNameRef.current || "default";
    fetch(`/api/v1/workspace/named/${wsName}/tasks`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const serverItems: TaskHistoryItem[] = (data?.tasks || []).map((t: any) => {
          const ts = t.created_at ? new Date(t.created_at).getTime() : Date.now();
          const rawPhase = serverStatusToPhase(t.status || "completed", ts);
          return {
            taskId: t.task_id,
            persona: t.persona || "default",
            intent: t.intent || t.task_id,
            phase: fixStalePhase(rawPhase, ts),
            timestamp: ts,
          };
        });
        const filtered = serverItems.filter((h) => !deletedIds.has(h.taskId));
        const sorted = filtered.sort((a, b) => (b.lastUserMessageAt || b.timestamp) - (a.lastUserMessageAt || a.timestamp)).slice(0, 20);
        const clean = sorted.map(h => ({ ...h, phase: fixStalePhase(h.phase, h.timestamp) }));
        setHistory(clean);
      })
      .catch(() => {
        setHistory([]);
      });
  }, [config.brandName]); // Removed workspaceName from deps - using ref instead

  useEffect(() => {
    const brand = config.brandName.toLowerCase();
    deletedIdsRef.current = loadDeletedIds(brand);
    refreshList();
  }, [workspaceName, refreshList, refreshTrigger, workspaceRefreshKey]);

  useEffect(() => {
    const interval = setInterval(refreshList, 60_000);
    return () => clearInterval(interval);
  }, [refreshList]);

  // Update local history state when task phase changes (without reading from localStorage)
  useEffect(() => {
    if (taskId && phase === "running") {
      // Add new running task to local history if not already there
      setHistory((prev) => {
        if (prev.find((h) => h.taskId === taskId)) return prev;
        if (deletedIdsRef.current.has(taskId)) return prev;
        const newItem: TaskHistoryItem = { taskId, persona: "default", intent, phase, timestamp: Date.now(), lastUserMessageAt: Date.now() };
        return [newItem, ...prev].slice(0, 20);
      });
    }
    if (taskId && (phase === "completed" || phase === "error" || phase === "interrupted")) {
      // Update phase in existing local history
      setHistory((prev) => prev.map((h) => h.taskId === taskId ? { ...h, phase } : h));
    }
  }, [taskId, phase, intent]);

  const phaseLabel: Record<SoloTaskPhase, string> = {
    idle: "就绪", creating: "创建中", connecting: "连接中", running: "执行中",
    paused: "已暂停", waiting_review: "待审核", completed: "已完成", error: "出错", rejected: "已拒绝",
    interrupted: "已中断",
  };

  const handleRename = (tid: string) => {
    if (!renameText.trim()) { setRenaming(null); return; }
    // Update local state only
    setHistory((prev) => prev.map((h) => h.taskId === tid ? { ...h, intent: renameText.trim() } : h));
    setRenaming(null);
    setMenuOpen(null);
    fetch(`/api/v1/workspace/${tid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: renameText.trim() }),
    }).then(() => refreshList()).catch(() => {});
  };

  const handleDelete = (tid: string) => {
    deletedIdsRef.current.add(tid);
    setHistory((prev) => prev.filter((h) => h.taskId !== tid));
    setMenuOpen(null);
    fetch(`/api/v1/workspace/${tid}`, { method: "DELETE" }).catch(() => {});
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
            else if (role === "function" || role === "tool_call") role = "tool";
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
        <span className="sidebar-title">任务列表</span>
      </div>
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
                    <>
                      <div className="task-history-ws-name">ws-{item.taskId.slice(0, 8)}</div>
                      <div className="task-history-intent">{item.intent.length > 40 ? item.intent.slice(0, 40) + "..." : item.intent}</div>
                    </>
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
    </div>
  );
}

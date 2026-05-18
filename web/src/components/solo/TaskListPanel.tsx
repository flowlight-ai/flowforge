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

  const refreshList = useCallback(() => {
    const brand = config.brandName.toLowerCase();
    const deletedIds = deletedIdsRef.current;
    fetch("/api/v1/workspace")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const serverItems: TaskHistoryItem[] = (data?.workspaces || []).map((ws: any) => ({
          taskId: ws.task_id,
          persona: ws.persona || "default",
          intent: ws.intent || ws.task_id,
          phase: (ws.status === "completed" ? "completed" : ws.status === "error" ? "error" : ws.status === "running" ? "running" : "completed") as SoloTaskPhase,
          timestamp: ws.created_at ? new Date(ws.created_at).getTime() : Date.now(),
        }));
        const localItems = loadTaskHistory(brand);
        const merged = new Map<string, TaskHistoryItem>();
        for (const item of [...serverItems, ...localItems]) {
          if (deletedIds.has(item.taskId)) continue;
          if (!merged.has(item.taskId)) merged.set(item.taskId, item);
        }
        const sorted = Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        setHistory(sorted);
        saveTaskHistory(brand, sorted);
      })
      .catch(() => {
        const brand = config.brandName.toLowerCase();
        const local = loadTaskHistory(brand).filter((h) => !deletedIdsRef.current.has(h.taskId));
        setHistory(local);
      });
  }, [config.brandName]);

  useEffect(() => {
    const brand = config.brandName.toLowerCase();
    deletedIdsRef.current = loadDeletedIds(brand);
    refreshList();
  }, [config.brandName, refreshList, refreshTrigger]);

  useEffect(() => {
    if (taskId && phase === "running") {
      const brand = config.brandName.toLowerCase();
      const existing = loadTaskHistory(brand);
      const found = existing.find((h) => h.taskId === taskId);
      if (!found && intent) {
        const newItem: TaskHistoryItem = { taskId, persona: "default", intent, phase, timestamp: Date.now() };
        const updated = [newItem, ...existing].slice(0, 20);
        saveTaskHistory(brand, updated);
        setHistory((prev) => {
          if (prev.find((h) => h.taskId === taskId)) return prev;
          return [newItem, ...prev].slice(0, 20);
        });
      } else if (found && found.phase !== phase) {
        const updated = existing.map((h) => h.taskId === taskId ? { ...h, phase } : h);
        saveTaskHistory(brand, updated);
        setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
      }
    }
    if (taskId && (phase === "completed" || phase === "error")) {
      const brand = config.brandName.toLowerCase();
      const existing = loadTaskHistory(brand);
      const updated = existing.map((h) => h.taskId === taskId ? { ...h, phase } : h);
      saveTaskHistory(brand, updated);
      setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
    }
  }, [taskId, phase, intent, config.brandName]);

  const phaseLabel: Record<SoloTaskPhase, string> = {
    idle: "就绪", creating: "创建中", connecting: "连接中", running: "执行中",
    paused: "已暂停", waiting_review: "待审核", completed: "已完成", error: "出错", rejected: "已拒绝",
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
    const items = loadTaskHistory(brand).filter((h) => h.taskId !== tid);
    saveTaskHistory(brand, items);
    deletedIdsRef.current.add(tid);
    saveDeletedIds(brand, deletedIdsRef.current);
    setHistory(items);
    setMenuOpen(null);
    fetch(`/api/v1/workspace/${tid}`, { method: "DELETE" }).catch(() => {});
  };

  const statusIcon = (p: SoloTaskPhase) => {
    if (p === "running" || p === "creating" || p === "connecting") return <span className="task-status-spinner" />;
    if (p === "completed") return <span className="task-status-check">✓</span>;
    if (p === "error" || p === "rejected") return <span className="task-status-stop">■</span>;
    if (p === "paused") return <span className="task-status-pause">❚❚</span>;
    return <span className="task-status-dot" />;
  };

  const allTasks = useMemo(() => {
    const tasks = [...history];
    if (taskId && !tasks.find((t) => t.taskId === taskId)) {
      tasks.unshift({ taskId, persona: "default", intent: intent || "新任务", phase, timestamp: Date.now() });
    }
    return tasks;
  }, [history, taskId, intent, phase]);

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
              onClick={async () => {
                if (renaming) return;
                if (item.taskId === taskId) return;
                onSwitchTask(item.taskId, item.intent, item.persona, item.phase);
                try {
                  const r = await fetch(`/api/v1/workspace/${item.taskId}/messages`);
                  if (r.ok) {
                    const data = await r.json();
                    if (data.messages?.length > 0) {
                      const restored: ChatMessage[] = data.messages.map((m: any, i: number) => ({
                        id: `restored-${item.taskId}-${i}`,
                        role: m.role === "assistant" ? "ai" : m.role,
                        content: m.content,
                        timestamp: m.timestamp || new Date().toISOString(),
                      }));
                      onRestoreChat(restored);
                    } else {
                      onRestoreChat([]);
                    }
                  }
                } catch {}
              }}
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
    </div>
  );
}

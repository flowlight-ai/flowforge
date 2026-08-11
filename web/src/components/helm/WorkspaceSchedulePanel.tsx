"use client";

/**
 * WorkspaceSchedulePanel — 调度中心
 *
 * 任务列表 + 全局控制开关 + 30秒自动刷新 + 运行历史
 * 对应 clowder-ai 的 schedule 模块
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

interface ScheduleTask {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  status: "idle" | "running" | "completed" | "error";
  description?: string;
}

interface RunHistoryEntry {
  id: string;
  taskId: string;
  taskName: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "error" | "skipped";
  durationMs?: number;
  output?: string;
}

// ── 调度任务项 ─────────────────────────────────────────────────────

function ScheduleTaskItem({
  task,
  onToggle,
  onRunNow,
}: {
  task: ScheduleTask;
  onToggle: (id: string) => void;
  onRunNow: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        fontSize: "12px",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {task.name}
        </div>
        <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
          <code style={{ fontFamily: "var(--mono)", background: "var(--bg)", padding: "1px 4px", borderRadius: "3px" }}>
            {task.cron}
          </code>
          {task.description && <span style={{ marginLeft: "8px" }}>{task.description}</span>}
        </div>
        <div style={{ display: "flex", gap: "12px", fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
          {task.lastRun && <span>上次: {new Date(task.lastRun).toLocaleString("zh-CN")}</span>}
          {task.nextRun && <span>下次: {new Date(task.nextRun).toLocaleString("zh-CN")}</span>}
        </div>
      </div>
      <div
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background:
            task.status === "running"
              ? "var(--info)"
              : task.status === "completed"
                ? "var(--ok)"
                : task.status === "error"
                  ? "var(--destructive)"
                  : "var(--muted)",
          flexShrink: 0,
        }}
      />
      <button
        type="button"
        onClick={() => onRunNow(task.id)}
        disabled={task.status === "running"}
        style={{
          padding: "3px 8px",
          borderRadius: "var(--radius-sm, 4px)",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: "10px",
          cursor: task.status === "running" ? "not-allowed" : "pointer",
          opacity: task.status === "running" ? 0.5 : 1,
          fontFamily: "inherit",
        }}
      >
        运行
      </button>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={task.enabled}
          onChange={() => onToggle(task.id)}
          style={{ accentColor: "var(--accent)" }}
        />
      </label>
    </div>
  );
}

// ── 运行历史项 ─────────────────────────────────────────────────────

function RunHistoryItem({ entry }: { entry: RunHistoryEntry }) {
  const statusColor = {
    running: "var(--info)",
    completed: "var(--ok)",
    error: "var(--destructive)",
    skipped: "var(--muted)",
  };
  const statusLabel = {
    running: "运行中",
    completed: "已完成",
    error: "出错",
    skipped: "已跳过",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 12px",
        fontSize: "11px",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: statusColor[entry.status],
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {entry.taskName}
      </span>
      <span style={{ color: statusColor[entry.status], fontSize: "10px" }}>
        {statusLabel[entry.status]}
      </span>
      <span style={{ color: "var(--muted)", fontSize: "10px" }}>
        {new Date(entry.startedAt).toLocaleTimeString("zh-CN")}
      </span>
      {entry.durationMs !== undefined && (
        <span style={{ color: "var(--muted)", fontSize: "10px", fontFamily: "var(--mono)" }}>
          {entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`}
        </span>
      )}
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface SchedulePanelProps {
  threadId?: string | null;
}

export default function WorkspaceSchedulePanel({ threadId }: SchedulePanelProps) {
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [history, setHistory] = useState<RunHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, historyRes] = await Promise.all([
        fetch("/api/v1/schedule/tasks"),
        fetch("/api/v1/schedule/history?limit=20"),
      ]);
      if (tasksRes.ok) {
        const data = await tasksRes.json();
        setTasks(data.items ?? data.tasks ?? []);
      }
      if (historyRes.ok) {
        const data = await historyRes.json();
        setHistory(data.items ?? data.history ?? []);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 30秒自动刷新
  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(fetchData, 30000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchData]);

  const handleToggle = useCallback(async (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
    try {
      await fetch(`/api/v1/schedule/tasks/${id}/toggle`, { method: "POST" });
    } catch {
      // 回滚
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)));
    }
  }, []);

  const handleRunNow = useCallback(
    async (id: string) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "running" as const } : t)));
      try {
        await fetch(`/api/v1/schedule/tasks/${id}/run`, { method: "POST" });
        setTimeout(fetchData, 2000);
      } catch {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: "error" as const } : t)));
      }
    },
    [fetchData],
  );

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载调度任务...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 全局控制 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px" }}>⏰</span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>调度中心</span>
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>({tasks.length} 任务)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* 自动刷新开关 */}
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "var(--muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={() => setAutoRefresh(!autoRefresh)}
              style={{ accentColor: "var(--accent)" }}
            />
            30s 刷新
          </label>
          {/* 全局开关 */}
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "var(--muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={globalEnabled}
              onChange={() => setGlobalEnabled(!globalEnabled)}
              style={{ accentColor: "var(--accent)" }}
            />
            全局
          </label>
          <button
            type="button"
            onClick={fetchData}
            style={{
              padding: "2px 8px",
              fontSize: "10px",
              background: "var(--accent-subtle)",
              color: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius-sm, 4px)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            刷新
          </button>
        </div>
      </div>

      {/* 任务列表 */}
      <div style={{ flex: "0 0 auto", maxHeight: "50%", overflow: "auto" }}>
        <div style={{ padding: "6px 12px", fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)" }}>
          定时任务
        </div>
        {tasks.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
            <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>⏰</div>
            <div>暂无调度任务</div>
          </div>
        ) : (
          tasks.map((task) => (
            <ScheduleTaskItem
              key={task.id}
              task={task}
              onToggle={handleToggle}
              onRunNow={handleRunNow}
            />
          ))
        )}
      </div>

      {/* 运行历史 */}
      <div style={{ flex: 1, overflow: "auto", borderTop: "1px solid var(--border)" }}>
        <div style={{ padding: "6px 12px", fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg-elevated)" }}>
          运行历史 ({history.length})
        </div>
        {history.length === 0 ? (
          <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
            暂无运行记录
          </div>
        ) : (
          history.map((entry) => <RunHistoryItem key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
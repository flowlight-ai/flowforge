"use client";

/**
 * HubRuntimeSessionsTab — 运行时会话 Tab
 *
 * 移植自 clowder-ai HubRuntimeSessionsTab，简化为 FlowForge 适配版。
 * 用于 /admin/observability?tab=runtime，展示当前运行态的会话与执行链。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/observability/runtime-sessions。
 */

import { useCallback, useEffect, useState } from "react";

interface RuntimeSession {
  id: string;
  forgekinId: string;
  forgekinName: string;
  workflowId?: string;
  taskId?: string;
  status: "running" | "waiting" | "completed" | "failed";
  step: string;
  progress: number;
  startedAt: string;
  durationMs?: number;
  traceId?: string;
}

interface RuntimeSessionsResponse {
  sessions: RuntimeSession[];
}

const STATUS_LABELS: Record<RuntimeSession["status"], { label: string; color: string }> = {
  running: { label: "运行中", color: "#3b82f6" },
  waiting: { label: "等待中", color: "#eab308" },
  completed: { label: "已完成", color: "#22c55e" },
  failed: { label: "失败", color: "#ef4444" },
};

function formatDuration(ms?: number): string {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function HubRuntimeSessionsTab() {
  const [sessions, setSessions] = useState<RuntimeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/observability/runtime-sessions");
      if (!res.ok) {
        setError("加载运行时会话失败");
        return;
      }
      const body = (await res.json()) as RuntimeSessionsResponse | { data: RuntimeSessionsResponse };
      const list = "sessions" in body ? body.sessions : (body as { data: RuntimeSessionsResponse }).data?.sessions ?? [];
      setSessions(list);
    } catch {
      setError("网络错误，无法加载运行时会话");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载运行时会话...</div>;
  }

  return (
    <div data-hub-runtime-sessions="root" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {error && (
        <div data-hub-runtime-sessions-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: "12px", color: "var(--muted,#9ca3af)" }}>
        实时运行态会话（{sessions.length}）· 5s 自动刷新
      </div>

      {sessions.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "24px 0", textAlign: "center" }}>
          暂无运行时会话，可进化智能体均处于空闲状态。
        </div>
      ) : (
        sessions.map((s) => {
          const sc = STATUS_LABELS[s.status] ?? STATUS_LABELS.running;
          return (
            <div
              key={s.id}
              data-hub-runtime-sessions-item={s.id}
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "var(--bg-elevated,#1e1f26)",
                border: "1px solid var(--border,#2a2c3a)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: sc.color, display: "inline-block" }} />
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong,#e5e7eb)" }}>
                    {s.forgekinName}
                  </span>
                  <span style={{ fontSize: "10px", color: sc.color, fontWeight: 600 }}>{sc.label}</span>
                </div>
                <span style={{ fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                  {formatDuration(s.durationMs)}
                </span>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-secondary,#9ca3af)", marginBottom: "6px" }}>
                步骤: <code style={{ color: "var(--text,#e5e7eb)" }}>{s.step}</code>
                {s.taskId && <> · 任务 <code style={{ color: "var(--accent,#ff5c5c)" }}>{s.taskId.slice(0, 8)}</code></>}
              </div>
              <div style={{ height: "4px", borderRadius: "2px", background: "var(--bg,#15151c)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, s.progress)}%`, background: sc.color }} />
              </div>
              {s.traceId && (
                <div style={{ marginTop: "6px", fontSize: "10px", color: "var(--muted,#9ca3af)" }}>
                  trace: <code style={{ color: "var(--muted-strong,#6b7280)" }}>{s.traceId}</code>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export default HubRuntimeSessionsTab;

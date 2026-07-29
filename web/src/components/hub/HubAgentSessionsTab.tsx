"use client";

/**
 * HubAgentSessionsTab — 可进化智能体会话 Tab
 *
 * 移植自 clowder-ai HubAgentSessionsTab，简化为 FlowForge 适配版。
 * 用于 /admin/agents/[id]?tab=sessions，展示 Forgekin 的历史会话与上下文。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/forgemind/{forgekinId}/sessions。
 */

import { useCallback, useEffect, useState } from "react";

interface AgentSession {
  id: string;
  forgekinId: string;
  title?: string;
  status: "active" | "idle" | "archived" | "error";
  messageCount: number;
  tokenUsed: number;
  startedAt: string;
  lastActiveAt: string;
  metadata?: Record<string, unknown>;
}

interface HubAgentSessionsTabProps {
  forgekinId: string;
  onOpenSession?: (sessionId: string) => void;
}

const STATUS_LABELS: Record<AgentSession["status"], { label: string; color: string; bg: string }> = {
  active: { label: "活跃", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  idle: { label: "空闲", color: "#9ca3af", bg: "rgba(156,163,175,0.12)" },
  archived: { label: "归档", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
  error: { label: "异常", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function HubAgentSessionsTab({ forgekinId, onOpenSession }: HubAgentSessionsTabProps) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/forgemind/${forgekinId}/sessions?limit=50`);
      if (!res.ok) {
        setError("加载会话列表失败");
        return;
      }
      const body = (await res.json()) as { sessions?: AgentSession[] } | { data: { sessions: AgentSession[] } };
      const list = ("sessions" in body ? body.sessions : (body as { data: { sessions: AgentSession[] } }).data?.sessions) ?? [];
      setSessions(list);
    } catch {
      setError("网络错误，无法加载会话列表");
    } finally {
      setLoading(false);
    }
  }, [forgekinId]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载会话列表...</div>;
  }

  return (
    <div data-hub-agent-sessions="root" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {error && (
        <div data-hub-agent-sessions-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: "12px", color: "var(--muted,#9ca3af)" }}>
        Forgekin <code style={{ color: "var(--accent,#ff5c5c)" }}>{forgekinId}</code> 共 {sessions.length} 个会话。
      </div>

      {sessions.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "24px 0", textAlign: "center" }}>
          暂无会话记录，可进化智能体尚未启动任何会话。
        </div>
      ) : (
        sessions.map((s) => {
          const sc = STATUS_LABELS[s.status] ?? STATUS_LABELS.idle;
          return (
            <div
              key={s.id}
              data-hub-agent-sessions-item={s.id}
              onClick={() => onOpenSession?.(s.id)}
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "var(--bg-elevated,#1e1f26)",
                border: "1px solid var(--border,#2a2c3a)",
                cursor: onOpenSession ? "pointer" : "default",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong,#e5e7eb)" }}>
                  {s.title || `会话 ${s.id.slice(0, 8)}`}
                </span>
                <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "10px", background: sc.bg, color: sc.color, fontWeight: 600 }}>
                  {sc.label}
                </span>
              </div>
              <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                <span>消息数: {s.messageCount}</span>
                <span>Token: {formatTokens(s.tokenUsed)}</span>
                <span>开始: {new Date(s.startedAt).toLocaleString()}</span>
                <span>最后活动: {new Date(s.lastActiveAt).toLocaleString()}</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default HubAgentSessionsTab;

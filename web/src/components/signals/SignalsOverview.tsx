"use client";

/**
 * SignalsOverview — 信号总览
 *
 * 展示信号收件箱（时间倒序）、按严重度/来源过滤、批量已读。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/signals?severity=&sourceId=
 *      POST /api/v1/signals/{id}/read
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SignalCard, type Signal, type SignalSeverity } from "./SignalCard";

interface SignalsOverviewProps {
  readonly initialReferrerThread?: string | null;
}

export function SignalsOverview({ initialReferrerThread }: SignalsOverviewProps = {}) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SignalSeverity | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (severityFilter !== "all") params.set("severity", severityFilter);
      if (sourceFilter !== "all") params.set("sourceId", sourceFilter);
      if (initialReferrerThread) params.set("referrer", initialReferrerThread);
      const res = await fetch(`/api/v1/signals?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: Signal[] = data?.items ?? data?.signals ?? [];
      setSignals(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSignals([]);
    } finally {
      setLoading(false);
    }
  }, [severityFilter, sourceFilter, initialReferrerThread]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, read: true } : s)));
    try {
      await fetch(`/api/v1/signals/${id}/read`, { method: "POST" });
    } catch (e) {
      console.error("标为已读失败", e);
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const unread = signals.filter((s) => !s.read);
    if (unread.length === 0) return;
    setSignals((prev) => prev.map((s) => ({ ...s, read: true })));
    try {
      await Promise.all(unread.map((s) => fetch(`/api/v1/signals/${s.id}/read`, { method: "POST" })));
    } catch (e) {
      console.error("批量标为已读失败", e);
    }
  }, [signals]);

  const sources = useMemo(() => {
    const map = new Map<string, string>();
    signals.forEach((s) => map.set(s.sourceId, s.sourceName));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [signals]);

  const visible = useMemo(() => {
    return signals.filter((s) => {
      if (onlyUnread && s.read) return false;
      return true;
    });
  }, [signals, onlyUnread]);

  const stats = useMemo(() => ({
    total: signals.length,
    unread: signals.filter((s) => !s.read).length,
    danger: signals.filter((s) => s.severity === "danger").length,
    warn: signals.filter((s) => s.severity === "warn").length,
  }), [signals]);

  return (
    <div className="animate-rise" data-signal="overview">
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px", flexWrap: "wrap", gap: "10px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>Signals · 信号总览</h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => void markAllRead()} disabled={stats.unread === 0} style={refreshBtnStyle}>
              全部标为已读（{stats.unread}）
            </button>
            <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
          </div>
        </div>
        <p className="page-sub" style={{ marginBottom: "12px" }}>
          共 {stats.total} 条 · 未读 {stats.unread} · 异常 {stats.danger} · 关注 {stats.warn}
        </p>

        <div
          data-signal="filters"
          style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "center" }}
        >
          {(["all", "danger", "warn", "info", "ok"] as const).map((s) => (
            <button
              key={s}
              data-signal-filter={s}
              onClick={() => setSeverityFilter(s)}
              style={{
                cursor: "pointer",
                border: "1px solid var(--border-strong)",
                background: severityFilter === s ? "var(--accent)" : "transparent",
                color: severityFilter === s ? "#fff" : "var(--muted)",
                borderRadius: "20px",
                padding: "4px 12px",
                fontSize: "12px",
                fontWeight: 500,
              }}
            >
              {s === "all" ? "全部严重度" : s}
            </button>
          ))}
          <select
            data-signal-filter="source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{
              padding: "4px 10px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-strong)",
              background: "var(--bg)",
              color: "var(--fg)",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            <option value="all">全部来源</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--muted)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlyUnread}
              onChange={(e) => setOnlyUnread(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            仅未读
          </label>
        </div>

        {error && (
          <div style={errorBoxStyle}>
            <span>加载失败：{error}</span>
            <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
          </div>
        )}

        {loading ? (
          <div style={loadingStyle}>加载中...</div>
        ) : visible.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>◈</div>
            暂无信号
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
            {visible.map((s) => (
              <li key={s.id}>
                <SignalCard signal={s} onMarkRead={markRead} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const refreshBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--accent)",
  fontSize: "13px",
  fontWeight: 600,
};

const errorBoxStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontSize: "13px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "12px",
};

const retryBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--danger)",
  fontWeight: 600,
  fontSize: "12px",
};

const loadingStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px",
  color: "var(--muted)",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px",
  color: "var(--muted)",
};

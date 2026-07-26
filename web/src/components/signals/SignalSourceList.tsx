"use client";

/**
 * SignalSourceList — 信号源管理
 *
 * 列出所有信号源、状态、最近一次抓取时间；支持启用/禁用、立即抓取。
 * 移植自 clowder-ai signals/sources，简化为表格视图。
 *
 * API：GET /api/v1/signals/sources
 *      POST /api/v1/signals/sources/{id}/toggle
 *      POST /api/v1/signals/sources/{id}/fetch
 */

import { useCallback, useEffect, useState } from "react";

interface SignalSource {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly enabled: boolean;
  readonly lastFetchedAt?: string;
  readonly lastError?: string;
  readonly itemsToday: number;
  readonly intervalSec: number;
}

export function SignalSourceList() {
  const [sources, setSources] = useState<SignalSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/signals/sources");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: SignalSource[] = data?.items ?? data?.sources ?? [];
      setSources(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSources([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async (id: string) => {
    setPendingId(id);
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
    try {
      await fetch(`/api/v1/signals/sources/${id}/toggle`, { method: "POST" });
    } catch (e) {
      console.error("切换信号源失败", e);
      void load();
    } finally {
      setPendingId(null);
    }
  }, [load]);

  const fetchNow = useCallback(async (id: string) => {
    setPendingId(id);
    try {
      await fetch(`/api/v1/signals/sources/${id}/fetch`, { method: "POST" });
      await load();
    } catch (e) {
      console.error("触发抓取失败", e);
    } finally {
      setPendingId(null);
    }
  }, [load]);

  return (
    <div className="animate-rise" data-signal="sources">
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>信号源管理</h2>
          <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
        </div>
        <p className="page-sub" style={{ marginBottom: "12px" }}>
          共 {sources.length} 个信号源 · 启用 {sources.filter((s) => s.enabled).length}
        </p>

        {error && (
          <div style={errorBoxStyle}>
            <span>加载失败：{error}</span>
            <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
          </div>
        )}

        {loading ? (
          <div style={loadingStyle}>加载中...</div>
        ) : sources.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>◈</div>
            暂无信号源
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-strong)" }}>
                {["名称", "类型", "状态", "今日抓取", "上次抓取", "间隔(s)", "操作"].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr
                  key={src.id}
                  data-signal-source={src.id}
                  style={{ borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)" }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{src.name}</td>
                  <td style={tdStyle}><span className="pill">{src.kind}</span></td>
                  <td style={tdStyle}>
                    <span
                      className="pill"
                      style={{
                        background: src.enabled ? "var(--ok-subtle)" : "var(--bg-hover)",
                        color: src.enabled ? "var(--ok)" : "var(--muted)",
                      }}
                    >
                      {src.enabled ? "启用" : "停用"}
                    </span>
                    {src.lastError && (
                      <span className="pill" style={{ marginLeft: 6, background: "var(--danger-subtle)", color: "var(--danger)" }}>
                        异常
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace" }}>{src.itemsToday}</td>
                  <td style={{ ...tdStyle, fontSize: "12px", color: "var(--muted)" }}>
                    {src.lastFetchedAt?.slice(0, 19) ?? "-"}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: "monospace" }}>{src.intervalSec}</td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        data-signal-action="toggle"
                        onClick={() => void toggle(src.id)}
                        disabled={pendingId === src.id}
                        style={{
                          ...actionBtnStyle,
                          color: src.enabled ? "var(--danger)" : "var(--ok)",
                          opacity: pendingId === src.id ? 0.6 : 1,
                          cursor: pendingId === src.id ? "not-allowed" : "pointer",
                        }}
                      >
                        {src.enabled ? "停用" : "启用"}
                      </button>
                      <button
                        data-signal-action="fetch"
                        onClick={() => void fetchNow(src.id)}
                        disabled={pendingId === src.id || !src.enabled}
                        style={{
                          ...actionBtnStyle,
                          color: "var(--accent)",
                          opacity: pendingId === src.id || !src.enabled ? 0.6 : 1,
                          cursor: pendingId === src.id || !src.enabled ? "not-allowed" : "pointer",
                        }}
                      >
                        立即抓取
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: "12px",
  color: "var(--muted)",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: "13px",
};

const actionBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: "12px",
  fontWeight: 600,
  padding: "4px 8px",
  borderRadius: "var(--radius-sm)",
};

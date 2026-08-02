"use client";

/**
 * HubLeaderboardTab — 排行榜 Tab
 *
 * 用于仪表盘子模块，展示可进化智能体的产出/质量/活跃度排行。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/leaderboard?metric={token|tasks|quality|uptime}。
 */

import { useCallback, useEffect, useState } from "react";

type Metric = "token" | "tasks" | "quality" | "uptime";

interface LeaderboardEntry {
  rank: number;
  forgekinId: string;
  forgekinName: string;
  species: string;
  metricValue: number;
  delta?: number;
}

interface LeaderboardResponse {
  metric: Metric;
  entries: LeaderboardEntry[];
}

const METRIC_OPTIONS: { id: Metric; label: string; unit: string }[] = [
  { id: "tasks", label: "完成任务", unit: "个" },
  { id: "quality", label: "平均质量", unit: "%" },
  { id: "token", label: "Token 产出", unit: "tok" },
  { id: "uptime", label: "在线时长", unit: "h" },
];

function formatValue(metric: Metric, value: number): string {
  if (metric === "token") {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return String(value);
  }
  if (metric === "quality") return `${(value * 100).toFixed(1)}`;
  if (metric === "uptime") return `${(value / 3600).toFixed(1)}`;
  return String(value);
}

export function HubLeaderboardTab() {
  const [metric, setMetric] = useState<Metric>("tasks");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/leaderboard?metric=${metric}&limit=10`);
      if (!res.ok) {
        setError("加载排行榜失败");
        return;
      }
      const body = (await res.json()) as LeaderboardResponse | { data: LeaderboardResponse };
      const data = "entries" in body ? body : (body as { data: LeaderboardResponse }).data;
      setEntries(data.entries ?? []);
    } catch {
      setError("网络错误，无法加载排行榜");
    } finally {
      setLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const currentUnit = METRIC_OPTIONS.find((m) => m.id === metric)?.unit ?? "";

  return (
    <div data-hub-leaderboard="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {error && (
        <div data-hub-leaderboard-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {METRIC_OPTIONS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMetric(m.id)}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              background: metric === m.id ? "var(--accent,#ff5c5c)" : "var(--bg-elevated,#1e1f26)",
              color: metric === m.id ? "#fff" : "var(--muted,#9ca3af)",
              border: "1px solid var(--border,#2a2c3a)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
            }}
            data-hub-leaderboard-metric={m.id}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载排行榜...</div>
      ) : entries.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "24px 0", textAlign: "center" }}>
          暂无排行数据。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {entries.map((e) => {
            const medal = e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : null;
            return (
              <div
                key={e.forgekinId}
                data-hub-leaderboard-item={e.forgekinId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: e.rank <= 3 ? "var(--bg-elevated,#1e1f26)" : "var(--bg,#15151c)",
                  border: `1px solid ${e.rank === 1 ? "#f59e0b" : "var(--border,#2a2c3a)"}`,
                }}
              >
                <div style={{ width: "32px", textAlign: "center", fontSize: e.rank <= 3 ? "18px" : "12px", fontWeight: 700, color: e.rank <= 3 ? "#f59e0b" : "var(--muted,#9ca3af)" }}>
                  {medal || `#${e.rank}`}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong,#e5e7eb)" }}>
                    {e.forgekinName}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--muted,#9ca3af)" }}>
                    <code>{e.species}</code>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--accent,#ff5c5c)" }}>
                    {formatValue(metric, e.metricValue)} <span style={{ fontSize: "10px", color: "var(--muted,#9ca3af)" }}>{currentUnit}</span>
                  </div>
                  {e.delta !== undefined && e.delta !== 0 && (
                    <div style={{ fontSize: "10px", color: e.delta > 0 ? "#22c55e" : "#ef4444" }}>
                      {e.delta > 0 ? "▲" : "▼"} {Math.abs(e.delta)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default HubLeaderboardTab;

"use client";

/**
 * /mission-control — 任务控制台（简化版）
 *
 * 提供只读的任务监控视图：状态分布、阻塞任务列表、近期更新。
 * 移植自 clowder-ai mission-control，简化为单卡片聚合版。
 *
 * API：GET /api/v1/missions?view=summary
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface MissionSummary {
  readonly total: number;
  readonly todo: number;
  readonly doing: number;
  readonly done: number;
  readonly blocked: number;
  readonly cancelled: number;
  readonly urgentActive: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly status: string;
    readonly assignee?: string;
  }>;
}

export default function MissionControlPage() {
  const [summary, setSummary] = useState<MissionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/missions?view=summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MissionSummary;
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="animate-rise" data-mission="control">
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>Mission Control · 控制台</h2>
          <div style={{ display: "flex", gap: "8px" }}>
            <Link href="/mission-hub" style={{ color: "var(--accent)", fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>
              进入 Hub →
            </Link>
            <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
          </div>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>只读监控视图 · 阻塞与紧急任务追踪</p>

        {error && (
          <div style={errorBoxStyle}>
            <span>加载失败：{error}</span>
            <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
          </div>
        )}

        {loading ? (
          <div style={loadingStyle}>加载中...</div>
        ) : !summary ? (
          <div style={emptyStyle}>无数据</div>
        ) : (
          <>
            <div
              data-mission="summary-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <Metric label="总任务" value={String(summary.total)} color="var(--accent)" />
              <Metric label="待办" value={String(summary.todo)} color="var(--muted)" />
              <Metric label="进行中" value={String(summary.doing)} color="var(--info)" />
              <Metric label="已完成" value={String(summary.done)} color="var(--ok)" />
              <Metric label="阻塞" value={String(summary.blocked)} color={summary.blocked > 0 ? "var(--danger)" : "var(--muted)"} />
              <Metric label="已取消" value={String(summary.cancelled)} color="var(--muted)" />
            </div>

            <div data-mission="urgent-list">
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                紧急 / 进行中任务（{summary.urgentActive.length}）
              </div>
              {summary.urgentActive.length === 0 ? (
                <div style={emptyStyle}>无紧急任务</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                  {summary.urgentActive.map((m) => (
                    <li
                      key={m.id}
                      style={{
                        padding: "8px 12px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "13px",
                      }}
                    >
                      <Link href={`/mission/${m.id}`} style={{ color: "var(--fg)", textDecoration: "none", fontWeight: 600 }}>
                        {m.title}
                      </Link>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "var(--muted)" }}>
                        <span className="pill">{m.status}</span>
                        {m.assignee && <span>@{m.assignee}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        padding: "12px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color }}>{value}</div>
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
  padding: "20px",
  color: "var(--muted)",
  fontSize: "13px",
};

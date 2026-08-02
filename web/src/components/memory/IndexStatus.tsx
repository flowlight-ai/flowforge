"use client";

/**
 * IndexStatus — 索引状态
 *
 * 展示语义索引服务的实时状态、队列长度、上次重建时间、降级标记。
 *
 * API：GET /api/v1/memory/index-status
 */

import { useCallback, useEffect, useState } from "react";

interface IndexStatusData {
  readonly service: "online" | "degraded" | "offline";
  readonly queueLength: number;
  readonly lastRebuiltAt?: string;
  readonly indexedToday: number;
  readonly failedToday: number;
  readonly pendingBatches: ReadonlyArray<{
    readonly id: string;
    readonly collection: string;
    readonly size: number;
    readonly startedAt: string;
  }>;
}

const SERVICE_STYLE: Record<IndexStatusData["service"], React.CSSProperties> = {
  online: { background: "var(--ok-subtle)", color: "var(--ok)" },
  degraded: { background: "var(--warn-subtle)", color: "var(--warn)" },
  offline: { background: "var(--danger-subtle)", color: "var(--danger)" },
};

const SERVICE_LABEL: Record<IndexStatusData["service"], string> = {
  online: "在线",
  degraded: "降级",
  offline: "离线",
};

export function IndexStatus() {
  const [status, setStatus] = useState<IndexStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/memory/index-status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as IndexStatusData;
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rebuild = useCallback(async () => {
    setRebuilding(true);
    try {
      await fetch("/api/v1/memory/rebuild", { method: "POST" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRebuilding(false);
    }
  }, [load]);

  if (loading) {
    return <div className="card" data-memory="status" style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>加载中...</div>;
  }

  if (error || !status) {
    return (
      <div className="card" data-memory="status" style={errorBoxStyle}>
        <span>索引状态加载失败：{error ?? "未知错误"}</span>
        <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
      </div>
    );
  }

  return (
    <div className="card" data-memory="status">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <h2 className="page-title" style={{ margin: 0 }}>索引状态</h2>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
          <button
            onClick={() => void rebuild()}
            disabled={rebuilding}
            data-memory="rebuild"
            style={{
              ...refreshBtnStyle,
              opacity: rebuilding ? 0.6 : 1,
              cursor: rebuilding ? "not-allowed" : "pointer",
            }}
          >
            {rebuilding ? "重建中..." : "触发重建"}
          </button>
        </div>
      </div>
      <p className="page-sub" style={{ marginBottom: "16px" }}>语义索引服务实时状态</p>

      <div
        data-memory="status-badge"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 14px",
          borderRadius: "20px",
          marginBottom: "16px",
          ...SERVICE_STYLE[status.service],
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor" }} />
        <span style={{ fontSize: "13px", fontWeight: 600 }}>{SERVICE_LABEL[status.service]}</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <Metric label="队列长度" value={String(status.queueLength)} tone={status.queueLength > 50 ? "warn" : "default"} />
        <Metric label="今日已索引" value={String(status.indexedToday)} tone="ok" />
        <Metric label="今日失败" value={String(status.failedToday)} tone={status.failedToday > 0 ? "danger" : "ok"} />
        <Metric label="上次重建" value={status.lastRebuiltAt ? status.lastRebuiltAt.slice(0, 19) : "-"} />
      </div>

      <div data-memory="status-queue">
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          待处理批次（{status.pendingBatches.length}）
        </div>
        {status.pendingBatches.length === 0 ? (
          <div style={emptyStyle}>队列为空</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            {status.pendingBatches.map((batch) => (
              <li
                key={batch.id}
                data-memory-batch={batch.id}
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
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span className="pill">{batch.collection}</span>
                  <span style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--muted)" }}>{batch.id.slice(0, 8)}</span>
                </div>
                <div style={{ display: "flex", gap: "12px", fontSize: "12px", color: "var(--muted)" }}>
                  <span>大小 {batch.size}</span>
                  <span>{batch.startedAt.slice(0, 19)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "warn" | "danger" }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "danger" ? "var(--danger)" : "var(--accent)";
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
      <div style={{ fontSize: "18px", fontWeight: 700, color }}>{value}</div>
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
};

const retryBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--danger)",
  fontWeight: 600,
  fontSize: "12px",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "20px",
  color: "var(--muted)",
  fontSize: "13px",
};

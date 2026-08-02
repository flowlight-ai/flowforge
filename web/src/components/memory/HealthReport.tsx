"use client";

/**
 * HealthReport — 记忆健康报告
 *
 * 展示记忆库的整体健康指标：覆盖率、新鲜度、待审数量、异常标记。
 *
 * API：GET /api/v1/memory/health
 */

import { useCallback, useEffect, useState } from "react";

interface HealthReportData {
  readonly overallScore: number;
  readonly coverageRatio: number;
  readonly freshnessHours: number;
  readonly pendingReviewCount: number;
  readonly flaggedCount: number;
  readonly totalCollections: number;
  readonly healthyCollections: number;
  readonly issues: ReadonlyArray<{
    readonly severity: "info" | "warn" | "danger";
    readonly code: string;
    readonly message: string;
  }>;
}

const SEVERITY_STYLE: Record<"info" | "warn" | "danger", React.CSSProperties> = {
  info: { background: "color-mix(in srgb, var(--info) 18%, transparent)", color: "var(--info)" },
  warn: { background: "var(--warn-subtle)", color: "var(--warn)" },
  danger: { background: "var(--danger-subtle)", color: "var(--danger)" },
};

export function HealthReport() {
  const [report, setReport] = useState<HealthReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/memory/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as HealthReportData;
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="card" data-memory="health" style={{ padding: "40px", textAlign: "center", color: "var(--muted)" }}>加载中...</div>;
  }

  if (error || !report) {
    return (
      <div className="card" data-memory="health" style={errorBoxStyle}>
        <span>健康报告加载失败：{error ?? "未知错误"}</span>
        <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
      </div>
    );
  }

  const scoreColor = report.overallScore >= 0.85 ? "var(--ok)" : report.overallScore >= 0.6 ? "var(--warn)" : "var(--danger)";

  return (
    <div className="card" data-memory="health">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <h2 className="page-title" style={{ margin: 0 }}>健康报告</h2>
        <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
      </div>
      <p className="page-sub" style={{ marginBottom: "16px" }}>记忆库整体健康指标</p>

      <div
        data-memory="health-score"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          padding: "16px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            border: `6px solid ${scoreColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "22px",
            fontWeight: 700,
            color: scoreColor,
          }}
        >
          {(report.overallScore * 100).toFixed(0)}
        </div>
        <div>
          <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "4px" }}>综合健康分</div>
          <div style={{ fontSize: "14px", fontWeight: 600 }}>
            {report.healthyCollections}/{report.totalCollections} 集合健康
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <Metric label="覆盖率" value={`${(report.coverageRatio * 100).toFixed(1)}%`} />
        <Metric label="新鲜度" value={`${report.freshnessHours.toFixed(1)}h`} />
        <Metric label="待审数量" value={String(report.pendingReviewCount)} tone={report.pendingReviewCount > 0 ? "warn" : "ok"} />
        <Metric label="异常标记" value={String(report.flaggedCount)} tone={report.flaggedCount > 0 ? "danger" : "ok"} />
      </div>

      {report.issues.length > 0 && (
        <div data-memory="health-issues">
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            异常清单（{report.issues.length}）
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            {report.issues.map((issue, idx) => (
              <li
                key={`${issue.code}-${idx}`}
                data-memory-issue={issue.code}
                style={{
                  padding: "8px 12px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "13px",
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  ...SEVERITY_STYLE[issue.severity],
                }}
              >
                <span style={{ fontFamily: "monospace", fontSize: "11px", opacity: 0.8 }}>{issue.code}</span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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

"use client";

/**
 * HubGovernanceTab — 治理状态 Tab
 *
 * 用于 /admin/governance，展示治理规则、合规审计与价值锚点。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/governance/health。
 */

import { useCallback, useEffect, useState } from "react";

interface GovernanceFinding {
  rule: string;
  severity: "info" | "warn" | "critical";
  message: string;
}

interface GovernanceHealthSummary {
  projectPath: string;
  status: "healthy" | "stale" | "missing" | "never-synced";
  packVersion: string | null;
  lastSyncedAt: string | null;
  findings: GovernanceFinding[];
}

interface GovernanceHealthResponse {
  projects: GovernanceHealthSummary[];
}

const STATUS_STYLES: Record<GovernanceHealthSummary["status"], { bg: string; color: string; label: string }> = {
  healthy: { bg: "rgba(34,197,94,0.12)", color: "#22c55e", label: "正常" },
  stale: { bg: "rgba(234,179,8,0.12)", color: "#eab308", label: "过期" },
  missing: { bg: "rgba(239,68,68,0.12)", color: "#ef4444", label: "缺失" },
  "never-synced": { bg: "rgba(107,114,128,0.12)", color: "#6b7280", label: "未同步" },
};

export function HubGovernanceTab() {
  const [projects, setProjects] = useState<GovernanceHealthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/governance/health");
      if (!res.ok) {
        setError("加载治理状态失败");
        return;
      }
      const data = (await res.json()) as GovernanceHealthResponse;
      setProjects(data.projects ?? []);
    } catch {
      setError("网络错误，无法加载治理状态");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const handleConfirm = useCallback(
    async (projectPath: string) => {
      setSyncing(projectPath);
      try {
        const res = await fetch("/api/v1/governance/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath }),
        });
        if (res.ok) {
          await fetchHealth();
        } else {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "同步失败");
        }
      } catch {
        setError("网络错误，无法同步治理规则");
      } finally {
        setSyncing(null);
      }
    },
    [fetchHealth],
  );

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载治理状态...</div>;
  }

  return (
    <div data-hub-governance="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {error && (
        <div data-hub-governance-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: "12px", color: "var(--muted,#9ca3af)" }}>
        治理状态共 {projects.length} 个项目。FlowForge 治理锚点：VISION.md 七条愿景 + 15 条编程红线。
      </div>

      {projects.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
          暂无治理数据，所有可进化智能体遵循默认治理规则。
        </div>
      ) : (
        projects.map((p) => {
          const sc = STATUS_STYLES[p.status] ?? STATUS_STYLES["never-synced"];
          return (
            <div
              key={p.projectPath}
              data-hub-governance-project={p.projectPath}
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "var(--bg-elevated,#1e1f26)",
                border: "1px solid var(--border,#2a2c3a)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", fontFamily: "monospace" }}>
                  {p.projectPath}
                </div>
                <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "10px", background: sc.bg, color: sc.color, fontWeight: 600 }}>
                  {sc.label}
                </span>
              </div>
              <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                {p.packVersion && <span>版本: <code style={{ color: "var(--text,#e5e7eb)" }}>{p.packVersion}</code></span>}
                {p.lastSyncedAt && <span>同步: {new Date(p.lastSyncedAt).toLocaleString()}</span>}
                {p.findings.length > 0 && <span>发现: {p.findings.length}</span>}
              </div>
              {p.findings.length > 0 && (
                <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  {p.findings.slice(0, 3).map((f, i) => (
                    <div key={i} style={{ fontSize: "11px", color: "var(--text-secondary,#9ca3af)", padding: "4px 8px", background: "var(--bg,#15151c)", borderRadius: "4px" }}>
                      <span style={{ fontWeight: 600, color: f.severity === "critical" ? "#ef4444" : f.severity === "warn" ? "#eab308" : "#3b82f6" }}>
                        [{f.severity}]
                      </span>{" "}
                      {f.message}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: "8px", display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => handleConfirm(p.projectPath)}
                  disabled={syncing === p.projectPath}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    background: "var(--accent,#ff5c5c)",
                    color: "#fff",
                    border: "none",
                    fontSize: "11px",
                    cursor: "pointer",
                    opacity: syncing === p.projectPath ? 0.5 : 1,
                  }}
                  data-hub-governance-action="sync"
                >
                  {syncing === p.projectPath ? "同步中..." : "同步治理规则"}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default HubGovernanceTab;

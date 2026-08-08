"use client";

/**
 * HubToolUsageTab — 工具使用统计 Tab
 *
 * 移植自 clowder-ai HubToolUsageTab，简化为 FlowForge 适配版。
 * 用于 /admin/tools，统计各工具的调用次数、成功率、平均耗时。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/tools/usage。
 */

import { useCallback, useEffect, useState } from "react";

interface ToolUsageStat {
  toolName: string;
  category: "rag" | "publish" | "search" | "exec" | "io" | "other";
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgLatencyMs: number;
  lastCalledAt?: string;
}

interface ToolUsageResponse {
  stats: ToolUsageStat[];
}

const CATEGORY_LABELS: Record<ToolUsageStat["category"], string> = {
  rag: "检索增强",
  publish: "发布",
  search: "搜索",
  exec: "执行",
  io: "I/O",
  other: "其他",
};

export function HubToolUsageTab() {
  const [stats, setStats] = useState<ToolUsageStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/tools/usage");
      if (!res.ok) {
        setError("加载工具使用统计失败");
        return;
      }
      const body = (await res.json()) as ToolUsageResponse | { data: ToolUsageResponse };
      const list = "stats" in body ? body.stats : (body as { data: ToolUsageResponse }).data?.stats ?? [];
      setStats(list);
    } catch {
      setError("网络错误，无法加载工具使用统计");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载工具使用统计...</div>;
  }

  const totalCalls = stats.reduce((sum, s) => sum + s.totalCalls, 0);
  const totalSuccess = stats.reduce((sum, s) => sum + s.successCalls, 0);
  const overallRate = totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 0;

  return (
    <div data-hub-tool-usage="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {error && (
        <div data-hub-tool-usage-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      {/* 汇总卡片 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px" }}>
        <div data-hub-tool-usage-summary="total" style={summaryCardStyle}>
          <div style={summaryLabelStyle}>总调用次数</div>
          <div style={summaryValueStyle}>{totalCalls}</div>
        </div>
        <div data-hub-tool-usage-summary="success" style={summaryCardStyle}>
          <div style={summaryLabelStyle}>成功次数</div>
          <div style={{ ...summaryValueStyle, color: "#22c55e" }}>{totalSuccess}</div>
        </div>
        <div data-hub-tool-usage-summary="rate" style={summaryCardStyle}>
          <div style={summaryLabelStyle}>成功率</div>
          <div style={{ ...summaryValueStyle, color: overallRate >= 90 ? "#22c55e" : "#eab308" }}>
            {overallRate.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* 详细统计表 */}
      <div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "8px" }}>
          工具调用明细（{stats.length}）
        </div>
        {stats.length === 0 ? (
          <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "16px 0", textAlign: "center" }}>
            暂无工具调用记录，可进化智能体尚未触发任何工具。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {stats.map((s) => {
              const rate = s.totalCalls > 0 ? (s.successCalls / s.totalCalls) * 100 : 0;
              return (
                <div
                  key={s.toolName}
                  data-hub-tool-usage-item={s.toolName}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "var(--bg-elevated,#1e1f26)",
                    border: "1px solid var(--border,#2a2c3a)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <code style={{ fontSize: "12px", color: "var(--text-strong,#e5e7eb)" }}>{s.toolName}</code>
                    <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--bg,#15151c)", color: "var(--muted,#9ca3af)" }}>
                      {CATEGORY_LABELS[s.category]}
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                    <div>
                      <div style={{ color: "var(--text,#e5e7eb)", fontWeight: 600 }}>{s.totalCalls}</div>
                      <div>调用</div>
                    </div>
                    <div>
                      <div style={{ color: "#22c55e", fontWeight: 600 }}>{s.successCalls}</div>
                      <div>成功</div>
                    </div>
                    <div>
                      <div style={{ color: rate >= 90 ? "#22c55e" : rate >= 70 ? "#eab308" : "#ef4444", fontWeight: 600 }}>
                        {rate.toFixed(1)}%
                      </div>
                      <div>成功率</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--text,#e5e7eb)", fontWeight: 600 }}>{s.avgLatencyMs}ms</div>
                      <div>平均耗时</div>
                    </div>
                  </div>
                  {s.lastCalledAt && (
                    <div style={{ marginTop: "6px", fontSize: "10px", color: "var(--muted,#9ca3af)" }}>
                      最后调用: {new Date(s.lastCalledAt).toLocaleString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const summaryCardStyle: React.CSSProperties = {
  padding: "12px",
  borderRadius: "8px",
  background: "var(--bg-elevated,#1e1f26)",
  border: "1px solid var(--border,#2a2c3a)",
};

const summaryLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--muted,#9ca3af)",
  marginBottom: "4px",
};

const summaryValueStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: "var(--text-strong,#e5e7eb)",
};

export default HubToolUsageTab;

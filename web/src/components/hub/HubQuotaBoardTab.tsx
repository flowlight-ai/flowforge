"use client";

/**
 * HubQuotaBoardTab — 配额看板 Tab
 *
 * 用于 /admin/quotas，监控 Token 配额、调用限制、用量统计。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/quotas。
 */

import { useCallback, useEffect, useState } from "react";

interface QuotaPool {
  id: string;
  provider: string;
  model: string;
  period: "day" | "week" | "month";
  limit: number;
  used: number;
  remaining: number;
  resetAt?: string;
}

interface QuotaBoardResponse {
  pools: QuotaPool[];
}

interface UsageByForgekin {
  forgekinId: string;
  forgekinName: string;
  totalTokens: number;
  totalCalls: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function HubQuotaBoardTab() {
  const [pools, setPools] = useState<QuotaPool[]>([]);
  const [usage, setUsage] = useState<UsageByForgekin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poolsRes, usageRes] = await Promise.all([
        fetch("/api/v1/quotas").catch(() => null),
        fetch("/api/v1/quotas/usage").catch(() => null),
      ]);

      let poolList: QuotaPool[] = [];
      if (poolsRes && poolsRes.ok) {
        const body = (await poolsRes.json()) as QuotaBoardResponse | { data: QuotaBoardResponse };
        poolList = "pools" in body ? body.pools : (body as { data: QuotaBoardResponse }).data?.pools ?? [];
      }
      setPools(poolList);

      if (usageRes && usageRes.ok) {
        const body = (await usageRes.json()) as { items: UsageByForgekin[] };
        setUsage(body.items ?? []);
      }
    } catch {
      setError("网络错误，无法加载配额数据");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载配额看板...</div>;
  }

  return (
    <div data-hub-quota="root" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {error && (
        <div data-hub-quota-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      {/* 配额池列表 */}
      <div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "8px" }}>
          Provider 配额池（{pools.length}）
        </div>
        {pools.length === 0 ? (
          <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "16px 0", textAlign: "center" }}>
            暂无配额池配置
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" }}>
            {pools.map((p) => {
              const pct = p.limit > 0 ? Math.min(100, (p.used / p.limit) * 100) : 0;
              const danger = pct >= 90;
              const warn = pct >= 70 && !danger;
              return (
                <div
                  key={p.id}
                  data-hub-quota-pool={p.id}
                  style={{
                    padding: "12px",
                    borderRadius: "8px",
                    background: "var(--bg-elevated,#1e1f26)",
                    border: "1px solid var(--border,#2a2c3a)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
                      {p.provider} / {p.model}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--muted,#9ca3af)" }}>{p.period}</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary,#9ca3af)", marginBottom: "6px" }}>
                    {formatNumber(p.used)} / {formatNumber(p.limit)} tokens
                  </div>
                  <div style={{ height: "6px", borderRadius: "3px", background: "var(--bg,#15151c)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: danger ? "#ef4444" : warn ? "#eab308" : "var(--accent,#ff5c5c)",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: "6px", display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted,#9ca3af)" }}>
                    <span style={{ color: danger ? "#ef4444" : warn ? "#eab308" : "#22c55e" }}>
                      {pct.toFixed(1)}% 已用
                    </span>
                    {p.resetAt && <span>重置: {new Date(p.resetAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 按 Forgekin 用量 */}
      {usage.length > 0 && (
        <div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "8px" }}>
            可进化智能体用量（{usage.length}）
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {usage.map((u) => (
              <div
                key={u.forgekinId}
                data-hub-quota-forgekin={u.forgekinId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "var(--bg-elevated,#1e1f26)",
                  border: "1px solid var(--border,#2a2c3a)",
                  fontSize: "12px",
                }}
              >
                <span style={{ color: "var(--text,#e5e7eb)" }}>{u.forgekinName}</span>
                <span style={{ color: "var(--muted,#9ca3af)" }}>
                  {formatNumber(u.totalTokens)} tokens · {u.totalCalls} calls
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default HubQuotaBoardTab;

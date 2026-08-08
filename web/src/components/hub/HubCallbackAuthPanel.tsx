"use client";

/**
 * HubCallbackAuthPanel — 回调认证面板
 *
 * 用于 /admin/observability?tab=callback，校验外部回调签名与认证状态。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/observability/callback-auth, POST /api/v1/observability/callback-auth/test。
 */

import { useCallback, useEffect, useState } from "react";

interface CallbackAuthEntry {
  connectorId: string;
  connectorLabel: string;
  authType: "hmac" | "bearer" | "basic" | "none";
  healthy: boolean;
  lastVerifiedAt?: string;
  lastError?: string;
  signatureValid?: boolean;
  latencyMs?: number;
}

interface CallbackAuthResponse {
  entries: CallbackAuthEntry[];
}

const AUTH_LABELS: Record<CallbackAuthEntry["authType"], { label: string; color: string }> = {
  hmac: { label: "HMAC 签名", color: "#22c55e" },
  bearer: { label: "Bearer Token", color: "#3b82f6" },
  basic: { label: "Basic Auth", color: "#eab308" },
  none: { label: "无认证", color: "#ef4444" },
};

export function HubCallbackAuthPanel() {
  const [entries, setEntries] = useState<CallbackAuthEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/observability/callback-auth");
      if (!res.ok) {
        setError("加载回调认证状态失败");
        return;
      }
      const body = (await res.json()) as CallbackAuthResponse | { data: CallbackAuthResponse };
      const data = "entries" in body ? body : (body as { data: CallbackAuthResponse }).data;
      setEntries(data.entries ?? []);
    } catch {
      setError("网络错误，无法加载回调认证状态");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleTest = useCallback(async (connectorId: string) => {
    setTesting(connectorId);
    try {
      const res = await fetch(`/api/v1/observability/callback-auth/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      if (!res.ok) throw new Error("测试失败");
      await fetchEntries();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(null);
    }
  }, [fetchEntries]);

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载回调认证状态...</div>;
  }

  const healthyCount = entries.filter((e) => e.healthy).length;

  return (
    <div data-hub-callback-auth="root" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {error && (
        <div data-hub-callback-auth-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: "12px", color: "var(--muted,#9ca3af)" }}>
        回调认证健康度: <span style={{ color: healthyCount === entries.length ? "#22c55e" : "#eab308", fontWeight: 700 }}>{healthyCount}/{entries.length}</span>
      </div>

      {entries.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "24px 0", textAlign: "center" }}>
          暂无回调认证记录。
        </div>
      ) : (
        entries.map((e) => {
          const am = AUTH_LABELS[e.authType] ?? AUTH_LABELS.none;
          return (
            <div
              key={e.connectorId}
              data-hub-callback-auth-item={e.connectorId}
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "var(--bg-elevated,#1e1f26)",
                border: `1px solid ${e.healthy ? "var(--border,#2a2c3a)" : "rgba(239,68,68,0.4)"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: e.healthy ? "#22c55e" : "#ef4444",
                      display: "inline-block",
                    }}
                  />
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
                    {e.connectorLabel}
                  </span>
                  <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--bg,#15151c)", color: am.color }}>
                    {am.label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleTest(e.connectorId)}
                  disabled={testing === e.connectorId}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    background: "var(--bg,#15151c)",
                    color: "var(--accent,#ff5c5c)",
                    border: "1px solid var(--border,#2a2c3a)",
                    fontSize: "11px",
                    cursor: "pointer",
                    opacity: testing === e.connectorId ? 0.5 : 1,
                  }}
                  data-hub-callback-auth-action="test"
                >
                  {testing === e.connectorId ? "测试中..." : "测试"}
                </button>
              </div>
              <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                {e.lastVerifiedAt && <span>校验: {new Date(e.lastVerifiedAt).toLocaleString()}</span>}
                {e.latencyMs !== undefined && <span>延迟: {e.latencyMs}ms</span>}
                {e.signatureValid !== undefined && (
                  <span style={{ color: e.signatureValid ? "#22c55e" : "#ef4444" }}>
                    签名: {e.signatureValid ? "有效" : "无效"}
                  </span>
                )}
              </div>
              {e.lastError && (
                <div style={{ marginTop: "6px", padding: "6px 8px", borderRadius: "4px", background: "rgba(239,68,68,0.08)", color: "#ef4444", fontSize: "11px" }}>
                  错误: {e.lastError}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export default HubCallbackAuthPanel;

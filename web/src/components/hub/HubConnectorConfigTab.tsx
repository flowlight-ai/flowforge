"use client";

/**
 * HubConnectorConfigTab — 连接器配置 Tab
 *
 * 移植自 clowder-ai HubConnectorConfigTab，简化为 FlowForge 适配版。
 * 用于 /admin/routing 子 Tab，管理外部连接器（飞书/钉钉/企微等）的接入配置。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET/POST/PUT /api/v1/routing/connectors。
 */

import { useCallback, useEffect, useState } from "react";
import type { ConnectorConfig } from "./HubStrategyTypes";

const CONNECTOR_TYPES = [
  { id: "feishu", label: "飞书" },
  { id: "wechat", label: "微信" },
  { id: "wecom-bot", label: "企业微信" },
  { id: "dingtalk", label: "钉钉" },
  { id: "telegram", label: "Telegram" },
  { id: "slack", label: "Slack" },
];

export function HubConnectorConfigTab() {
  const [connectors, setConnectors] = useState<ConnectorConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/routing/connectors");
      if (!res.ok) {
        setError("加载连接器失败");
        return;
      }
      const body = (await res.json()) as { connectors?: ConnectorConfig[] } | { data: { connectors: ConnectorConfig[] } };
      const list = ("connectors" in body ? body.connectors : (body as { data: { connectors: ConnectorConfig[] } }).data?.connectors) ?? [];
      setConnectors(list);
    } catch {
      setError("网络错误，无法加载连接器配置");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      setSavingId(id);
      try {
        const res = await fetch(`/api/v1/routing/connectors/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        if (!res.ok) throw new Error("切换失败");
        await fetchConnectors();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingId(null);
      }
    },
    [fetchConnectors],
  );

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载连接器配置...</div>;
  }

  return (
    <div data-hub-connector="root" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {error && (
        <div data-hub-connector-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: "12px", color: "var(--muted,#9ca3af)" }}>
        支持的连接器类型：{CONNECTOR_TYPES.map((c) => c.label).join("、")}
      </div>

      {connectors.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "16px 0", textAlign: "center" }}>
          暂无连接器配置。可前往 <code style={{ color: "var(--accent,#ff5c5c)" }}>/admin/settings</code> 新增账户后自动接入。
        </div>
      ) : (
        connectors.map((c) => (
          <div
            key={c.id}
            data-hub-connector-item={c.id}
            style={{
              padding: "12px 14px",
              borderRadius: "8px",
              background: "var(--bg-elevated,#1e1f26)",
              border: "1px solid var(--border,#2a2c3a)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
                  {c.label}
                </span>
                <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--bg,#15151c)", color: "var(--muted,#9ca3af)" }}>
                  {c.type}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(c.id, !c.enabled)}
                disabled={savingId === c.id}
                style={{
                  padding: "3px 10px",
                  borderRadius: "6px",
                  background: c.enabled ? "var(--accent,#ff5c5c)" : "var(--bg,#15151c)",
                  color: c.enabled ? "#fff" : "var(--muted,#9ca3af)",
                  border: "1px solid var(--border,#2a2c3a)",
                  fontSize: "11px",
                  cursor: "pointer",
                  opacity: savingId === c.id ? 0.5 : 1,
                }}
                data-hub-connector-action="toggle"
              >
                {savingId === c.id ? "..." : c.enabled ? "启用中" : "已禁用"}
              </button>
            </div>
            {c.baseUrl && (
              <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                Base URL: <code style={{ color: "var(--text,#e5e7eb)" }}>{c.baseUrl}</code>
              </div>
            )}
            {c.capabilities && c.capabilities.length > 0 && (
              <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {c.capabilities.map((cap) => (
                  <span key={cap} style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "rgba(99,102,241,0.12)", color: "#a78bfa" }}>
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default HubConnectorConfigTab;

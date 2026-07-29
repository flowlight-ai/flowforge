"use client";

/**
 * HubObservabilityTab — 可观测性 Hub Tab
 *
 * 移植自 clowder-ai HubObservabilityTab，简化为 FlowForge 适配版。
 * 用于 /admin/observability，提供子 Tab 切换（健康/运行时会话/回调认证）。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 子组件：HubRuntimeSessionsTab、HubCallbackAuthPanel。
 */

import { useCallback, useEffect, useState } from "react";
import { HubRuntimeSessionsTab } from "./HubRuntimeSessionsTab";
import { HubCallbackAuthPanel } from "./HubCallbackAuthPanel";

interface ServiceHealthItem {
  name: string;
  port: number;
  status: "healthy" | "degraded" | "down" | "unknown";
  latency_ms?: number;
  last_check?: string;
}

type ObservabilityTab = "health" | "runtime" | "callback";

interface HubObservabilityTabProps {
  initialTab?: ObservabilityTab;
}

export function HubObservabilityTab({ initialTab = "health" }: HubObservabilityTabProps) {
  const [tab, setTab] = useState<ObservabilityTab>(initialTab);
  const [services, setServices] = useState<ServiceHealthItem[]>([]);
  const [loading, setLoading] = useState(true);

  const checkServices = useCallback(async () => {
    const targets = [
      { name: "FlowForge API", port: 8000 },
      { name: "FlowForge Web", port: 5174 },
      { name: "OpenRoute", port: 6000 },
      { name: "OpenSieve", port: 8100 },
      { name: "ContentForge", port: 8001 },
      { name: "DevForge", port: 8002 },
      { name: "NovelForge", port: 8003 },
      { name: "MallForge", port: 8004 },
    ];
    const results: ServiceHealthItem[] = [];
    for (const svc of targets) {
      try {
        const start = Date.now();
        const res = await fetch(`/api/v1/system/health/${svc.port}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
        const latency = Date.now() - start;
        if (res && res.ok) {
          results.push({ ...svc, status: "healthy", latency_ms: latency, last_check: new Date().toISOString() });
        } else {
          results.push({ ...svc, status: "unknown", latency_ms: latency, last_check: new Date().toISOString() });
        }
      } catch {
        results.push({ ...svc, status: "unknown", last_check: new Date().toISOString() });
      }
    }
    setServices(results);
    setLoading(false);
  }, []);

  useEffect(() => {
    checkServices();
    const interval = setInterval(checkServices, 30000);
    return () => clearInterval(interval);
  }, [checkServices]);

  const statusColor = (s: ServiceHealthItem["status"]) => {
    const map: Record<string, string> = {
      healthy: "#22c55e",
      degraded: "#eab308",
      down: "#ef4444",
      unknown: "#6b7280",
    };
    return map[s] ?? "#6b7280";
  };

  return (
    <div data-hub-observability="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border,#2a2c3a)", paddingBottom: "8px" }}>
        {([
          { id: "health", label: "服务健康" },
          { id: "runtime", label: "运行时会话" },
          { id: "callback", label: "回调认证" },
        ] as { id: ObservabilityTab; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              background: tab === t.id ? "var(--accent,#ff5c5c)" : "transparent",
              color: tab === t.id ? "#fff" : "var(--muted,#9ca3af)",
              border: "none",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
            data-hub-observability-tab={t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "health" && (
        <div data-hub-observability-section="health">
          {loading ? (
            <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>检查服务健康中...</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
              {services.map((svc) => (
                <div
                  key={svc.name}
                  data-hub-observability-service={svc.name}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    background: "var(--bg-elevated,#1e1f26)",
                    border: "1px solid var(--border,#2a2c3a)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: statusColor(svc.status) }} />
                    <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>{svc.name}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                    <span style={{ fontFamily: "monospace" }}>:{svc.port}</span>
                    {svc.latency_ms !== undefined && <span>{svc.latency_ms}ms</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "runtime" && <HubRuntimeSessionsTab />}
      {tab === "callback" && <HubCallbackAuthPanel />}
    </div>
  );
}

export default HubObservabilityTab;

"use client";

import { useState } from "react";
import { HubRoutingPolicyTab } from "@/components/hub/HubRoutingPolicyTab";
import { HubConnectorConfigTab } from "@/components/hub/HubConnectorConfigTab";

/**
 * 路由策略页面 — 使用 HubRoutingPolicyTab + HubConnectorConfigTab
 *
 * 功能：
 *   - 模型路由策略（基于能力/负载/成本）
 *   - 连接器配置（子 Tab）
 *   - 回退链（主模型失败自动切换）
 *
 * 整合 HubRoutingPolicyTab + HubConnectorConfigTab。
 */

type RoutingTab = "policies" | "connectors";

export default function RoutingPage() {
  const [tab, setTab] = useState<RoutingTab>("policies");

  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>路由策略</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          模型路由策略、连接器配置、回退链 · HubRoutingPolicyTab + HubConnectorConfigTab
        </p>

        <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid var(--border)", marginBottom: "16px", paddingBottom: "8px" }}>
          {([
            { id: "policies", label: "路由策略" },
            { id: "connectors", label: "连接器配置" },
          ] as { id: RoutingTab; label: string }[]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 14px", borderRadius: "6px",
                background: tab === t.id ? "var(--accent)" : "var(--bg-elevated)",
                color: tab === t.id ? "#fff" : "var(--muted)",
                border: "1px solid var(--border)",
                fontSize: "12px", fontWeight: 600, cursor: "pointer",
              }}
              data-routing-tab={t.id}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "policies" && <HubRoutingPolicyTab />}
        {tab === "connectors" && <HubConnectorConfigTab />}
      </div>
    </div>
  );
}

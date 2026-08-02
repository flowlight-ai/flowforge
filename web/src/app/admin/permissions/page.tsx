"use client";

import { useState } from "react";
import { HubPermissionsTab } from "@/components/hub/HubPermissionsTab";

/**
 * 权限管理页面 — 使用 HubPermissionsTab
 *
 * 功能：
 *   - 可进化智能体权限控制
 *   - 工具白名单（tools_allowlist）
 *   - 文件/网络/数据库操作授权
 *
 * 整合 HubPermissionsTab。
 */

const CONNECTORS = [
  { id: "feishu", label: "飞书" },
  { id: "wecom-bot", label: "企业微信" },
  { id: "dingtalk", label: "钉钉" },
  { id: "wechat", label: "微信" },
];

export default function PermissionsPage() {
  const [connectorId, setConnectorId] = useState(CONNECTORS[0].id);

  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>权限管理</h2>
          <select
            value={connectorId}
            onChange={(e) => setConnectorId(e.target.value)}
            style={{
              padding: "6px 10px", borderRadius: "6px",
              border: "1px solid var(--border)", background: "var(--bg-elevated)",
              color: "var(--text)", fontSize: "12px",
            }}
            data-permissions-connector-select="true"
          >
            {CONNECTORS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          可进化智能体权限、工具白名单、操作授权 · HubPermissionsTab
        </p>
        <HubPermissionsTab connectorId={connectorId} connectorLabel={CONNECTORS.find((c) => c.id === connectorId)?.label ?? connectorId} />
      </div>
    </div>
  );
}

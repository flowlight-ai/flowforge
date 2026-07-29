"use client";

/**
 * HubPermissionsTab — 权限管理 Tab
 *
 * 用于 /admin/permissions，控制可进化智能体的工具白名单、操作授权范围。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET/PUT /api/v1/permissions/{connectorId}。
 */

import { useCallback, useEffect, useState } from "react";

interface GroupEntry {
  externalChatId: string;
  label?: string;
  addedAt: number;
}

interface PermissionConfig {
  whitelistEnabled: boolean;
  commandAdminOnly: boolean;
  adminOpenIds: string[];
  allowedGroups: GroupEntry[];
}

const EMPTY_CONFIG: PermissionConfig = {
  whitelistEnabled: false,
  commandAdminOnly: false,
  adminOpenIds: [],
  allowedGroups: [],
};

interface HubPermissionsTabProps {
  connectorId: string;
  connectorLabel?: string;
}

export function HubPermissionsTab({ connectorId }: HubPermissionsTabProps) {
  const [config, setConfig] = useState<PermissionConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"ok" | "error" | null>(null);
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newAdminId, setNewAdminId] = useState("");

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/permissions/${connectorId}`);
      if (res.ok) {
        const data = (await res.json()) as PermissionConfig;
        setConfig({ ...EMPTY_CONFIG, ...data });
      }
    } catch {
      // Permission store may not be available yet
    } finally {
      setLoading(false);
    }
  }, [connectorId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const saveConfig = useCallback(
    async (patch: Partial<PermissionConfig>) => {
      setSaving(true);
      setSaveResult(null);
      try {
        const res = await fetch(`/api/v1/permissions/${connectorId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const data = (await res.json()) as PermissionConfig;
          setConfig(data);
          setSaveResult("ok");
        } else {
          setSaveResult("error");
        }
      } catch {
        setSaveResult("error");
      } finally {
        setSaving(false);
        setTimeout(() => setSaveResult(null), 2000);
      }
    },
    [connectorId],
  );

  const addGroup = () => {
    if (!newGroupId.trim()) return;
    const updated: GroupEntry[] = [
      ...config.allowedGroups,
      { externalChatId: newGroupId.trim(), label: newGroupLabel.trim() || undefined, addedAt: Date.now() },
    ];
    saveConfig({ allowedGroups: updated });
    setNewGroupId("");
    setNewGroupLabel("");
  };

  const removeGroup = (chatId: string) => {
    const updated = config.allowedGroups.filter((g) => g.externalChatId !== chatId);
    saveConfig({ allowedGroups: updated });
  };

  const addAdmin = () => {
    if (!newAdminId.trim()) return;
    const updated = [...config.adminOpenIds, newAdminId.trim()];
    saveConfig({ adminOpenIds: updated });
    setNewAdminId("");
  };

  const removeAdmin = (openId: string) => {
    const updated = config.adminOpenIds.filter((id) => id !== openId);
    saveConfig({ adminOpenIds: updated });
  };

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载权限配置...</div>;
  }

  return (
    <div data-hub-permissions="root" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div
        style={{
          padding: "14px 16px",
          borderRadius: "10px",
          background: "var(--bg-elevated,#1e1f26)",
          border: "1px solid var(--border,#2a2c3a)",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "4px" }}>
          群聊与命令权限
        </div>
        <div style={{ fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
          控制可进化智能体在不同会话中可执行的操作范围。
        </div>
      </div>

      {/* Section 1: Group Whitelist */}
      <div data-hub-permissions-section="whitelist">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text,#e5e7eb)" }}>群白名单</span>
          <button
            type="button"
            onClick={() => saveConfig({ whitelistEnabled: !config.whitelistEnabled })}
            disabled={saving}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              background: config.whitelistEnabled ? "var(--accent,#ff5c5c)" : "var(--bg,#15151c)",
              color: config.whitelistEnabled ? "#fff" : "var(--muted,#9ca3af)",
              border: "1px solid var(--border,#2a2c3a)",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {config.whitelistEnabled ? "已开启" : "已关闭"}
          </button>
        </div>
        {config.whitelistEnabled && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {config.allowedGroups.map((g) => (
              <div
                key={g.externalChatId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 10px",
                  background: "var(--bg,#15151c)",
                  borderRadius: "6px",
                  fontSize: "11px",
                }}
                data-hub-permissions-group={g.externalChatId}
              >
                <span style={{ flex: 1, color: "var(--text,#e5e7eb)" }}>
                  {g.label || g.externalChatId}
                </span>
                <button
                  type="button"
                  onClick={() => removeGroup(g.externalChatId)}
                  style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                value={newGroupId}
                onChange={(e) => setNewGroupId(e.target.value)}
                placeholder="chat_id"
                style={inputStyle}
              />
              <input
                value={newGroupLabel}
                onChange={(e) => setNewGroupLabel(e.target.value)}
                placeholder="群名（可选）"
                style={inputStyle}
              />
              <button type="button" onClick={addGroup} disabled={!newGroupId.trim()} style={btnStyle}>
                添加
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 2: Admin List */}
      <div data-hub-permissions-section="admins">
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text,#e5e7eb)", marginBottom: "6px" }}>
          管理员
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {config.adminOpenIds.map((id, i) => (
            <div
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 10px",
                background: "var(--bg,#15151c)",
                borderRadius: "6px",
                fontSize: "11px",
              }}
              data-hub-permissions-admin={id}
            >
              <span style={{ flex: 1, color: "var(--text,#e5e7eb)" }}>{id}</span>
              {i === 0 && (
                <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                  Owner
                </span>
              )}
              <button
                type="button"
                onClick={() => removeAdmin(id)}
                style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              value={newAdminId}
              onChange={(e) => setNewAdminId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAdmin()}
              placeholder="open_id"
              style={inputStyle}
            />
            <button type="button" onClick={addAdmin} disabled={!newAdminId.trim()} style={btnStyle}>
              添加
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Command Admin Only */}
      <div data-hub-permissions-section="command-admin">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text,#e5e7eb)" }}>群聊命令仅管理员</span>
          <button
            type="button"
            onClick={() => saveConfig({ commandAdminOnly: !config.commandAdminOnly })}
            disabled={saving}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              background: config.commandAdminOnly ? "var(--accent,#ff5c5c)" : "var(--bg,#15151c)",
              color: config.commandAdminOnly ? "#fff" : "var(--muted,#9ca3af)",
              border: "1px solid var(--border,#2a2c3a)",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {config.commandAdminOnly ? "已开启" : "已关闭"}
          </button>
        </div>
      </div>

      {saving && <div style={{ fontSize: "11px", color: "var(--muted,#9ca3af)" }}>保存中...</div>}
      {saveResult === "ok" && <div style={{ fontSize: "11px", color: "#22c55e" }} data-hub-permissions-saved="ok">已保存</div>}
      {saveResult === "error" && <div style={{ fontSize: "11px", color: "#ef4444" }} data-hub-permissions-error="save">保存失败</div>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "5px 10px",
  borderRadius: "6px",
  border: "1px solid var(--border,#2a2c3a)",
  background: "var(--bg,#15151c)",
  color: "var(--text,#e5e7eb)",
  fontSize: "11px",
};

const btnStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: "6px",
  background: "var(--accent,#ff5c5c)",
  color: "#fff",
  border: "none",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
};

export default HubPermissionsTab;

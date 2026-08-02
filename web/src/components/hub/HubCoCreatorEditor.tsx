"use client";

/**
 * HubCoCreatorEditor — 共创管理编辑器
 *
 * 用于 /admin/co-creators，管理可进化智能体的共创关系与权限。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET/POST/PUT/DELETE /api/v1/co-creators。
 */

import { useCallback, useEffect, useState } from "react";

interface CoCreator {
  id: string;
  forgekinId: string;
  forgekinName: string;
  role: "owner" | "editor" | "viewer";
  permissions: string[];
  grantedAt: string;
  grantedBy: string;
}

interface CoCreatorListResponse {
  items: CoCreator[];
}

type Role = CoCreator["role"];

const ROLE_LABELS: Record<Role, { label: string; color: string; bg: string }> = {
  owner: { label: "Owner", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  editor: { label: "Editor", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  viewer: { label: "Viewer", color: "#9ca3af", bg: "rgba(156,163,175,0.12)" },
};

export function HubCoCreatorEditor() {
  const [items, setItems] = useState<CoCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ forgekinId: string; role: Role } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/co-creators");
      if (!res.ok) {
        setError("加载共创列表失败");
        return;
      }
      const body = (await res.json()) as CoCreatorListResponse | { data: CoCreatorListResponse };
      const data = "items" in body ? body : (body as { data: CoCreatorListResponse }).data;
      setItems(data.items ?? []);
    } catch {
      setError("网络错误，无法加载共创列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/co-creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "保存失败");
      }
      setEditing(null);
      await fetchList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editing, fetchList]);

  const handleRemove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/v1/co-creators/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      await fetchList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchList]);

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载共创列表...</div>;
  }

  return (
    <div data-hub-co-creator="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {error && (
        <div data-hub-co-creator-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
          共创者（{items.length}）
        </span>
        <button
          type="button"
          onClick={() => setEditing({ forgekinId: "", role: "viewer" })}
          style={primaryBtnStyle}
          data-hub-co-creator-action="create"
        >
          + 新增共创者
        </button>
      </div>

      {items.length === 0 && !editing && (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "24px 0", textAlign: "center" }}>
          暂无共创者，可进化智能体当前为独立工作模式。
        </div>
      )}

      {items.map((c) => {
        const rm = ROLE_LABELS[c.role];
        return (
          <div
            key={c.id}
            data-hub-co-creator-item={c.id}
            style={{
              padding: "12px 14px",
              borderRadius: "8px",
              background: "var(--bg-elevated,#1e1f26)",
              border: "1px solid var(--border,#2a2c3a)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong,#e5e7eb)" }}>
                {c.forgekinName}
              </span>
              <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "10px", background: rm.bg, color: rm.color, fontWeight: 600 }}>
                {rm.label}
              </span>
            </div>
            <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
              <span>授权: {new Date(c.grantedAt).toLocaleString()}</span>
              <span>由 <code style={{ color: "var(--text,#e5e7eb)" }}>{c.grantedBy}</code></span>
            </div>
            {c.permissions.length > 0 && (
              <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {c.permissions.map((p) => (
                  <span key={p} style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--bg,#15151c)", color: "var(--muted,#9ca3af)" }}>
                    {p}
                  </span>
                ))}
              </div>
            )}
            <div style={{ marginTop: "8px" }}>
              <button
                type="button"
                onClick={() => handleRemove(c.id)}
                style={{ fontSize: "11px", color: "#ef4444", background: "transparent", border: "none", cursor: "pointer" }}
              >
                移除
              </button>
            </div>
          </div>
        );
      })}

      {editing && (
        <div data-hub-co-creator-editor="root" style={{ padding: "14px", borderRadius: "8px", background: "var(--bg,#15151c)", border: "1px solid var(--accent,#ff5c5c)" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "8px" }}>新增共创者</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input
              value={editing.forgekinId}
              onChange={(e) => setEditing({ ...editing, forgekinId: e.target.value })}
              placeholder="Forgekin ID"
              style={inputStyle}
              data-hub-co-creator-input="forgekinId"
            />
            <select
              value={editing.role}
              onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}
              style={inputStyle}
              data-hub-co-creator-input="role"
            >
              <option value="viewer">Viewer (查看)</option>
              <option value="editor">Editor (编辑)</option>
              <option value="owner">Owner (所有者)</option>
            </select>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setEditing(null)} style={cancelBtnStyle}>取消</button>
              <button type="button" onClick={handleSave} disabled={saving || !editing.forgekinId.trim()} style={primaryBtnStyle} data-hub-co-creator-action="save">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "6px",
  border: "1px solid var(--border,#2a2c3a)",
  background: "var(--bg-elevated,#1e1f26)",
  color: "var(--text,#e5e7eb)",
  fontSize: "12px",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: "6px",
  background: "var(--accent,#ff5c5c)",
  color: "#fff",
  border: "none",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: "6px",
  background: "transparent",
  color: "var(--muted,#9ca3af)",
  border: "1px solid var(--border,#2a2c3a)",
  fontSize: "12px",
  cursor: "pointer",
};

export default HubCoCreatorEditor;

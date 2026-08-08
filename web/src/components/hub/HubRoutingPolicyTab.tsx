"use client";

/**
 * HubRoutingPolicyTab — 路由策略 Tab
 *
 * 用于 /admin/routing，管理模型路由策略与回退链。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET/POST/PUT/DELETE /api/v1/routing/policies。
 */

import { useCallback, useEffect, useState } from "react";
import type { RoutingPolicy, RoutingPolicyPayload, StrategyTarget } from "./HubStrategyTypes";
import { EMPTY_POLICY } from "./HubStrategyTypes";

export function HubRoutingPolicyTab() {
  const [policies, setPolicies] = useState<RoutingPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RoutingPolicyPayload | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/routing/policies");
      if (!res.ok) {
        setError("加载路由策略失败");
        return;
      }
      const body = (await res.json()) as { policies?: RoutingPolicy[] } | { data: { policies: RoutingPolicy[] } };
      const list = ("policies" in body ? body.policies : (body as { data: { policies: RoutingPolicy[] } }).data?.policies) ?? [];
      setPolicies(list);
    } catch {
      setError("网络错误，无法加载路由策略");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleSave = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const isEdit = policies.some((p) => p.name === editing.name);
      const res = await fetch("/api/v1/routing/policies", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "保存失败");
      }
      setEditing(null);
      await fetchPolicies();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [editing, policies, fetchPolicies]);

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await fetch(`/api/v1/routing/policies/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        });
        await fetchPolicies();
      } catch {
        setError("切换策略状态失败");
      }
    },
    [fetchPolicies],
  );

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载路由策略...</div>;
  }

  return (
    <div data-hub-routing="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {error && (
        <div data-hub-routing-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
          路由策略（{policies.length}）
        </span>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY_POLICY })}
          style={{
            padding: "6px 12px",
            borderRadius: "6px",
            background: "var(--accent,#ff5c5c)",
            color: "#fff",
            border: "none",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
          data-hub-routing-action="create"
        >
          + 新增策略
        </button>
      </div>

      {policies.length === 0 && !editing && (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "16px 0", textAlign: "center" }}>
          暂无路由策略，可进化智能体将使用默认路由。
        </div>
      )}

      {policies.map((p) => (
        <div
          key={p.id}
          data-hub-routing-policy={p.id}
          style={{
            padding: "12px 14px",
            borderRadius: "8px",
            background: "var(--bg-elevated,#1e1f26)",
            border: "1px solid var(--border,#2a2c3a)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>{p.name}</span>
              <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "rgba(99,102,241,0.15)", color: "#a78bfa" }}>
                优先级 {p.priority}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleToggle(p.id, !p.enabled)}
              style={{
                padding: "3px 10px",
                borderRadius: "6px",
                background: p.enabled ? "var(--accent,#ff5c5c)" : "var(--bg,#15151c)",
                color: p.enabled ? "#fff" : "var(--muted,#9ca3af)",
                border: "1px solid var(--border,#2a2c3a)",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              {p.enabled ? "启用中" : "已禁用"}
            </button>
          </div>
          {p.description && (
            <div style={{ fontSize: "11px", color: "var(--muted,#9ca3af)", marginBottom: "6px" }}>{p.description}</div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {p.targets.map((t: StrategyTarget, i) => (
              <span
                key={i}
                style={{
                  fontSize: "10px",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  background: "var(--bg,#15151c)",
                  color: "var(--text-secondary,#9ca3af)",
                  border: t.fallback ? "1px solid #eab308" : "1px solid transparent",
                }}
              >
                {t.provider}/{t.model} (w={t.weight}){t.fallback ? " · fallback" : ""}
              </span>
            ))}
          </div>
        </div>
      ))}

      {/* 编辑器 */}
      {editing && (
        <div
          data-hub-routing-editor="root"
          style={{
            padding: "14px",
            borderRadius: "8px",
            background: "var(--bg,#15151c)",
            border: "1px solid var(--accent,#ff5c5c)",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "8px" }}>
            策略编辑
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="策略名称"
              style={inputStyle}
              data-hub-routing-input="name"
            />
            <input
              type="number"
              value={editing.priority}
              onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) })}
              placeholder="优先级 (0-100)"
              style={inputStyle}
            />
            <textarea
              value={editing.description ?? ""}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="策略描述"
              style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setEditing(null)} style={cancelBtnStyle}>
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !editing.name.trim()}
                style={saveBtnStyle}
                data-hub-routing-action="save"
              >
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

const saveBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "6px",
  background: "var(--accent,#ff5c5c)",
  color: "#fff",
  border: "none",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "6px",
  background: "transparent",
  color: "var(--muted,#9ca3af)",
  border: "1px solid var(--border,#2a2c3a)",
  fontSize: "12px",
  cursor: "pointer",
};

export default HubRoutingPolicyTab;

"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * 插件管理页面 — 合并 plugins + marketplace + skills
 *
 * 管理插件状态、外部集成、安装结果、能力市场
 */

interface Plugin {
  name: string;
  display_name?: string;
  description?: string;
  version?: string;
  enabled: boolean;
  category?: string;
  status?: "active" | "inactive" | "error";
}

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const loadPlugins = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/plugins");
      const data = await res.json();
      const list = data?.data?.plugins || data?.plugins || [];
      setPlugins(Array.isArray(list) ? list : []);
    } catch {
      setPlugins([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPlugins();
  }, [loadPlugins]);

  const togglePlugin = useCallback(async (name: string, currentEnabled: boolean) => {
    try {
      await fetch(`/api/v1/plugins/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      setPlugins((prev) =>
        prev.map((p) => (p.name === name ? { ...p, enabled: !currentEnabled } : p))
      );
    } catch {}
  }, []);

  const filteredPlugins = plugins.filter((p) => {
    if (!filter) return true;
    const text = `${p.name} ${p.display_name || ""} ${p.description || ""}`.toLowerCase();
    return text.includes(filter.toLowerCase());
  });

  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>插件管理</h2>
          <button
            onClick={loadPlugins}
            style={{
              padding: "6px 14px", borderRadius: "6px",
              border: "1px solid var(--border)", background: "var(--bg-elevated)",
              color: "var(--muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600,
            }}
          >
            🔄 刷新
          </button>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          插件状态、外部集成、安装结果 · 合并 marketplace + skills
        </p>

        <div style={{ marginBottom: "12px" }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索插件..."
            style={{
              width: "100%", padding: "6px 12px", borderRadius: "6px",
              border: "1px solid var(--border)", background: "var(--bg)",
              color: "var(--text)", fontSize: "12px",
            }}
          />
        </div>

        {loading ? (
          <div className="empty">加载中...</div>
        ) : filteredPlugins.length === 0 ? (
          <div className="empty">暂无插件</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "8px" }}>
            {filteredPlugins.map((plugin) => (
              <div
                key={plugin.name}
                style={{
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "14px" }}>🧩</span>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", flex: 1 }}>
                    {plugin.display_name || plugin.name}
                  </span>
                  {plugin.version && (
                    <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "monospace" }}>
                      v{plugin.version}
                    </span>
                  )}
                </div>
                {plugin.description && (
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", lineHeight: 1.5 }}>
                    {plugin.description}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  {plugin.category && (
                    <span style={{
                      fontSize: "10px", padding: "1px 6px", borderRadius: "4px",
                      background: "var(--bg-hover)", color: "var(--muted)",
                    }}>
                      {plugin.category}
                    </span>
                  )}
                  <button
                    onClick={() => togglePlugin(plugin.name, plugin.enabled)}
                    style={{
                      padding: "4px 10px", borderRadius: "12px",
                      border: `1px solid ${plugin.enabled ? "var(--ok)" : "var(--border)"}`,
                      background: plugin.enabled ? "rgba(34,197,94,0.12)" : "var(--bg)",
                      color: plugin.enabled ? "#22c55e" : "var(--muted)",
                      cursor: "pointer", fontSize: "11px", fontWeight: 600,
                    }}
                  >
                    <span style={{
                      width: "6px", height: "6px", borderRadius: "50%",
                      background: plugin.enabled ? "#22c55e" : "var(--muted)",
                      display: "inline-block", marginRight: "4px",
                    }} />
                    {plugin.enabled ? "启用" : "禁用"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

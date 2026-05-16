"use client";

import { useState, useEffect, useCallback } from "react";

interface ModelItem {
  provider: string;
  id: string;
  display_name?: string;
  health_status: string;
  last_check?: string;
  error_count?: number;
  reason?: string;
  latency_ms?: number;
  enabled?: boolean;
}

interface ProviderInfo {
  name: string;
  base_url: string;
  api_key_env?: string;
  key_configured?: boolean;
  key_masked?: string;
  rate_limit_rpm?: number;
  model_count?: number;
  available_count?: number;
}

type Tab = "models" | "providers" | "apikeys";

export default function ModelConfigPage() {
  const [tab, setTab] = useState<Tab>("models");
  const [models, setModels] = useState<ModelItem[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProviders, setActiveProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceUpdating, setForceUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [filterProvider, setFilterProvider] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [m, p, ap] = await Promise.all([
      fetch("/api/v1/admin/models").then((r) => r.json()).then((d) => d?.data?.models || d?.models || []).catch(() => []),
      fetch("/api/v1/settings/providers").then((r) => r.json()).then((d) => d?.data?.providers || []).catch(() => []),
      fetch("/api/v1/admin/models/available").then((r) => r.json()).then((d) => d?.data?.fallback_chain || []).catch(() => []),
    ]);
    setModels(Array.isArray(m) ? m : []);
    setProviders(Array.isArray(p) ? p : []);

    const uniqueProviders = new Set<string>();
    (Array.isArray(m) ? m : []).forEach((item: ModelItem) => uniqueProviders.add(item.provider));
    setActiveProviders(Array.from(uniqueProviders));

    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const showMsg = (msg: string, isErr = false) => {
    setMessage(isErr ? `❌ ${msg}` : `✅ ${msg}`);
    setTimeout(() => setMessage(""), 3000);
  };

  const handleForceUpdate = async () => {
    setForceUpdating(true);
    try {
      const r = await fetch("/api/v1/admin/models/force-update", { method: "POST" });
      const d = await r.json();
      const data = d?.data || d;
      showMsg(`更新完成：${data.available_count || 0} 可用，${data.suspended_count || 0} 暂停，${data.checked_models || 0} 已检查`);
      loadAll();
    } catch (e: any) { showMsg(e.message, true); }
    setForceUpdating(false);
  };

  const toggleActiveProvider = async (provider: string) => {
    const newActive = activeProviders.includes(provider)
      ? activeProviders.filter((p) => p !== provider)
      : [...activeProviders, provider];
    try {
      await fetch("/api/v1/admin/models/active-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_providers: newActive }),
      });
      setActiveProviders(newActive);
      showMsg(`${provider} ${newActive.includes(provider) ? "已启用" : "已禁用"}`);
    } catch (e: any) { showMsg(e.message, true); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      available: { bg: "var(--ok)1a", color: "var(--ok)", label: "可用" },
      disabled: { bg: "var(--muted)1a", color: "var(--muted)", label: "禁用" },
      suspended: { bg: "var(--danger)1a", color: "var(--danger)", label: "暂停" },
      unknown: { bg: "var(--warn)1a", color: "var(--warn)", label: "未知" },
    };
    const s = map[status] || map.unknown;
    return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: s.bg, color: s.color }}>{s.label}</span>;
  };

  const filteredModels = models.filter((m) => {
    if (filterProvider !== "all" && m.provider !== filterProvider) return false;
    if (filterStatus !== "all" && m.health_status !== filterStatus) return false;
    return true;
  });

  const providerStats = (name: string) => {
    const pModels = models.filter((m) => m.provider === name);
    const available = pModels.filter((m) => m.health_status === "available").length;
    return { total: pModels.length, available };
  };

  const btnStyle: React.CSSProperties = { padding: "6px 14px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600 };

  if (loading) return <div className="animate-rise"><div className="card"><div className="empty">加载中...</div></div></div>;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "models", label: "模型状态", icon: "🤖" },
    { key: "providers", label: "供应商", icon: "🏢" },
    { key: "apikeys", label: "API 密钥", icon: "🔑" },
  ];

  return (
    <div className="animate-rise">
      {message && <div style={{ marginBottom: "16px", padding: "10px 16px", borderRadius: "var(--radius-sm)", background: message.startsWith("❌") ? "var(--danger-subtle)" : "var(--ok-subtle)", color: message.startsWith("❌") ? "var(--danger)" : "var(--ok)", fontSize: "13px", fontWeight: 500 }}>{message}</div>}

      <div className="card" style={{ paddingBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>模型配置</h2>
          <button onClick={handleForceUpdate} disabled={forceUpdating} style={{ ...btnStyle, background: "var(--accent)", color: "#fff", opacity: forceUpdating ? 0.6 : 1 }}>
            {forceUpdating ? "⏳ 更新中..." : "🔄 强制更新"}
          </button>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>管理 AI 模型、供应商与密钥配置</p>

        <div style={{ display: "flex", gap: "4px", borderBottom: "2px solid var(--border-strong)", marginBottom: "16px" }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "8px 16px", border: "none", borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent", background: "none", color: tab === t.key ? "var(--accent)" : "var(--muted)", cursor: "pointer", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, marginBottom: "-2px", transition: "all 0.15s" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "models" && (
          <div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
              <select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)} style={{ padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--text)", fontSize: "12px" }}>
                <option value="all">全部供应商</option>
                {[...new Set(models.map((m) => m.provider))].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--text)", fontSize: "12px" }}>
                <option value="all">全部状态</option>
                <option value="available">可用</option>
                <option value="suspended">暂停</option>
                <option value="disabled">禁用</option>
                <option value="unknown">未知</option>
              </select>
              <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "28px" }}>
                {filteredModels.length} / {models.length} 个模型
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {filteredModels.map((m) => (
                <div key={`${m.provider}/${m.id}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "6px", background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: "12px" }}>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--text-strong)", fontWeight: 600, minWidth: "60px" }}>{m.provider}</span>
                  <span style={{ fontFamily: "var(--mono)", flex: 1 }}>{m.id}</span>
                  {statusBadge(m.health_status)}
                  {m.latency_ms ? <span style={{ color: "var(--muted)", fontSize: "11px" }}>{m.latency_ms}ms</span> : null}
                  {m.reason ? <span style={{ color: "var(--danger)", fontSize: "11px", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.reason}>{m.reason}</span> : null}
                </div>
              ))}
              {filteredModels.length === 0 && <div className="empty">无匹配模型</div>}
            </div>
          </div>
        )}

        {tab === "providers" && (
          <div>
            <div style={{ marginBottom: "12px", padding: "12px 16px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>启用供应商（白名单）</div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px" }}>只有启用的供应商才会进行健康检查和进入可用模型列表</div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {[...new Set(models.map((m) => m.provider))].map((p) => {
                  const isActive = activeProviders.includes(p);
                  const stats = providerStats(p);
                  return (
                    <button key={p} onClick={() => toggleActiveProvider(p)} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "16px", border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`, background: isActive ? "var(--accent)1a" : "var(--bg)", color: isActive ? "var(--accent)" : "var(--muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600, transition: "all 0.15s" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: isActive ? "var(--accent)" : "var(--muted)", display: "inline-block" }} />
                      {p}
                      <span style={{ fontSize: "10px", opacity: 0.7 }}>{stats.available}/{stats.total}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {providers.map((p) => (
                <div key={p.name} style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", minWidth: "90px" }}>{p.name}</span>
                    <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--mono)", flex: 1 }}>{p.base_url}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600, color: p.key_configured ? "var(--ok)" : "var(--danger)" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.key_configured ? "var(--ok)" : "var(--danger)", display: "inline-block" }} />
                      {p.key_configured ? "已配置" : "未配置"}
                    </span>
                  </div>
                </div>
              ))}
              {providers.length === 0 && <div className="empty">暂无供应商配置</div>}
            </div>
          </div>
        )}

        {tab === "apikeys" && (
          <div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "12px" }}>API 密钥通过 SecretStore 管理，支持 DB → 环境变量 → .env 文件优先级</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {providers.map((p) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", minWidth: "90px" }}>{p.name}</span>
                  {p.api_key_env && <span style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "var(--muted)" }}>{p.api_key_env}</span>}
                  {p.key_masked && <span style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "var(--muted)" }}>{p.key_masked}</span>}
                  <div style={{ flex: 1 }} />
                  <button onClick={() => { setTab("apikeys"); window.location.href = "/admin/settings"; }} style={{ ...btnStyle, background: p.key_configured ? "var(--accent)1a" : "var(--accent)", color: p.key_configured ? "var(--accent)" : "#fff" }}>
                    {p.key_configured ? "更新" : "配置"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

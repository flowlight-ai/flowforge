"use client";

import { useState, useEffect } from "react";

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

interface SecretEntry { key: string; value_masked: string; category: string; description: string; configured: boolean; }

type Tab = "models" | "providers" | "apikeys";

const API_BASE = "/api/v1/settings";

function toStringArray(raw: any): string[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") return item.name || item.id || String(item);
    return String(item);
  }).filter((s: string) => s && s !== "[object Object]");
}

function toProviderArray(raw: any): ProviderInfo[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : (raw?.providers || []);
  if (!Array.isArray(arr)) return [];
  return arr.filter((item: any) => item && typeof item === "object" && item.name);
}

function toModelArray(raw: any): ModelItem[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : (raw?.models || []);
  if (!Array.isArray(arr)) return [];
  return arr.filter((item: any) => item && typeof item === "object");
}

function toSecretArray(raw: any): SecretEntry[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : (raw?.secrets || []);
  if (!Array.isArray(arr)) return [];
  return arr.filter((item: any) => item && typeof item === "object" && item.key);
}

export default function ModelConfigPage() {
  const [tab, setTab] = useState<Tab>("models");
  const [models, setModels] = useState<ModelItem[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProviders, setActiveProviders] = useState<string[]>([]);
  const [allProviders, setAllProviders] = useState<string[]>([]);
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [forceUpdating, setForceUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [filterProvider, setFilterProvider] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [formState, setFormState] = useState({ key: "", value: "", category: "api_key", description: "" });

  const loadTab = async (t: Tab) => {
    setLoading(true);
    try {
      if (t === "models") {
        const [m, avail, allP] = await Promise.all([
          fetch("/api/v1/admin/models").then((r) => r.json()).catch(() => ({})),
          fetch("/api/v1/admin/models/available").then((r) => r.json()).catch(() => ({})),
          fetch("/api/v1/admin/models/all-providers").then((r) => r.json()).catch(() => ({})),
        ]);
        const mData = m?.data || m;
        setModels(toModelArray(mData));
        const availData = avail?.data || avail;
        setActiveProviders(toStringArray(availData?.active_providers));
        const allPData = allP?.data || allP;
        const apList = toStringArray(allPData?.providers || allPData);
        setAllProviders(apList.length > 0 ? apList : toStringArray(availData?.active_providers));
      } else if (t === "providers") {
        const [p, avail, allP] = await Promise.all([
          fetch("/api/v1/settings/providers").then((r) => r.json()).catch(() => ({})),
          fetch("/api/v1/admin/models/available").then((r) => r.json()).catch(() => ({})),
          fetch("/api/v1/admin/models/all-providers").then((r) => r.json()).catch(() => ({})),
        ]);
        const pData = p?.data || p;
        setProviders(toProviderArray(pData?.providers || pData));
        const availData = avail?.data || avail;
        setActiveProviders(toStringArray(availData?.active_providers));
        const allPData = allP?.data || allP;
        const apList = toStringArray(allPData?.providers || allPData);
        setAllProviders(apList.length > 0 ? apList : toStringArray(availData?.active_providers));
      } else if (t === "apikeys") {
        const [sc, p] = await Promise.all([
          fetch(`${API_BASE}/secrets`).then((r) => r.json()).catch(() => ({})),
          fetch("/api/v1/settings/providers").then((r) => r.json()).catch(() => ({})),
        ]);
        const scData = sc?.data || sc;
        setSecrets(toSecretArray(scData?.secrets || scData));
        const pData = p?.data || p;
        setProviders(toProviderArray(pData?.providers || pData));
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadTab(tab); }, [tab]);

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
      loadTab("models");
    } catch (e: unknown) { showMsg(e instanceof Error ? e.message : "更新失败", true); }
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
    } catch (e: unknown) { showMsg(e instanceof Error ? e.message : "操作失败", true); }
  };

  const handleSave = async () => {
    if (!formState.key || (!editKey && !formState.value)) return;
    try {
      const r = await fetch(`${API_BASE}/secrets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formState) });
      if (r.ok) { showMsg(editKey ? "密钥已更新" : "密钥已添加"); setShowAddModal(false); setEditKey(null); setFormState({ key: "", value: "", category: "api_key", description: "" }); loadTab("apikeys"); }
      else { const err = await r.json().catch(() => ({ detail: "保存失败" })); showMsg(err.detail || "保存失败", true); }
    } catch (e: unknown) { showMsg(e instanceof Error ? e.message : "保存失败", true); }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`确认删除密钥 "${key}"？`)) return;
    try { const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(key)}`, { method: "DELETE" }); if (r.ok) { showMsg(`密钥 ${key} 已删除`); loadTab("apikeys"); } else showMsg("删除失败", true); }
    catch (e: unknown) { showMsg(e instanceof Error ? e.message : "删除失败", true); }
  };

  const openEdit = (secret: SecretEntry) => { setEditKey(secret.key); setFormState({ key: secret.key, value: "", category: secret.category, description: secret.description }); setShowAddModal(true); };
  const openAdd = () => { setEditKey(null); setFormState({ key: "", value: "", category: "api_key", description: "" }); setShowAddModal(true); };
  const openProviderConfig = (provider: ProviderInfo) => { setEditKey(provider.api_key_env || ""); setFormState({ key: provider.api_key_env || "", value: "", category: "api_key", description: `${provider.name} API Key` }); setShowAddModal(true); };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      available: { bg: "rgba(34,197,94,0.12)", color: "#22c55e", label: "可用" },
      disabled: { bg: "rgba(107,114,128,0.12)", color: "#6b7280", label: "禁用" },
      suspended: { bg: "rgba(239,68,68,0.12)", color: "#ef4444", label: "暂停" },
      unknown: { bg: "rgba(234,179,8,0.12)", color: "#eab308", label: "未知" },
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

  if (loading) return (
    <div className="animate-rise">
      <div className="card">
        <h2 className="page-title" style={{ margin: "0 0 4px" }}>模型配置</h2>
        <p className="page-sub" style={{ marginBottom: "16px" }}>管理 AI 模型、供应商与密钥配置</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "6px", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div style={{ width: "60px", height: "14px", borderRadius: "4px", background: "var(--bg-hover)" }} />
              <div style={{ flex: 1, height: "14px", borderRadius: "4px", background: "var(--bg-hover)" }} />
              <div style={{ width: "40px", height: "18px", borderRadius: "10px", background: "var(--bg-hover)" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "models", label: "模型状态", icon: "🤖" },
    { key: "providers", label: "供应商", icon: "🏢" },
    { key: "apikeys", label: "API 密钥", icon: "🔑" },
  ];

  return (
    <div className="animate-rise">
      {message && <div style={{ marginBottom: "16px", padding: "10px 16px", borderRadius: "8px", background: message.startsWith("❌") ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)", color: message.startsWith("❌") ? "#ef4444" : "#22c55e", fontSize: "13px", fontWeight: 500 }}>{message}</div>}

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
                {[...new Set(models.map((m) => m.provider).filter(Boolean))].map((p) => <option key={String(p)} value={String(p)}>{String(p)}</option>)}
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
              {filteredModels.map((m, idx) => (
                <div key={`${m.provider}-${m.id}-${idx}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "6px", background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: "12px" }}>
                  <span style={{ fontFamily: "var(--mono)", color: "var(--text-strong)", fontWeight: 600, minWidth: "60px" }}>{String(m.provider)}</span>
                  <span style={{ fontFamily: "var(--mono)", flex: 1 }}>{String(m.display_name || m.id)}</span>
                  {statusBadge(m.health_status)}
                  {m.latency_ms ? <span style={{ color: "var(--muted)", fontSize: "11px" }}>{m.latency_ms}ms</span> : null}
                  {m.reason ? <span style={{ color: "#ef4444", fontSize: "11px", maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.reason}>{String(m.reason)}</span> : null}
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
                {allProviders.map((p) => {
                  const pStr = String(p);
                  const isActive = activeProviders.includes(pStr);
                  const stats = providerStats(pStr);
                  return (
                    <button key={pStr} onClick={() => toggleActiveProvider(pStr)} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "16px", border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`, background: isActive ? "rgba(255,92,92,0.1)" : "var(--bg)", color: isActive ? "var(--accent)" : "var(--muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600, transition: "all 0.15s" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: isActive ? "var(--accent)" : "var(--muted)", display: "inline-block" }} />
                      {pStr}
                      <span style={{ fontSize: "10px", opacity: 0.7 }}>{stats.available}/{stats.total}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {providers.map((p) => (
                <div key={String(p.name)} style={{ padding: "12px 16px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)", minWidth: "90px" }}>{String(p.name)}</span>
                    <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--mono)", flex: 1 }}>{String(p.base_url)}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600, color: p.key_configured ? "#22c55e" : "#ef4444" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.key_configured ? "#22c55e" : "#ef4444", display: "inline-block" }} />
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>{secrets.length + providers.length} 个密钥已配置</span>
              <button onClick={openAdd} style={{ ...btnStyle, background: "var(--accent)", color: "#fff" }}>+ 添加密钥</button>
            </div>

            {providers.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "8px" }}>供应商密钥</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {providers.map((p) => (
                    <div key={String(p.name)} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", minWidth: "80px" }}>{String(p.name)}</span>
                      <span style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "var(--muted)", flex: 1 }}>{String(p.api_key_env || "—")}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600, color: p.key_configured ? "#22c55e" : "#ef4444" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.key_configured ? "#22c55e" : "#ef4444", display: "inline-block" }} />
                        {p.key_configured ? "已配置" : "未配置"}
                      </span>
                      <button onClick={() => openProviderConfig(p)} style={{ ...btnStyle, background: p.key_configured ? "rgba(255,92,92,0.1)" : "var(--accent)", color: p.key_configured ? "var(--accent)" : "#fff" }}>
                        {p.key_configured ? "更新" : "配置"}
                      </button>
                      {p.key_configured && p.api_key_env && (
                        <button onClick={() => handleDelete(p.api_key_env!)} style={{ ...btnStyle, background: "rgba(239,68,68,0.12)", color: "#ef4444", padding: "4px 8px" }}>删除</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {secrets.length > 0 && (
              <div>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "8px" }}>自定义密钥</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {secrets.map((s) => (
                    <div key={String(s.key)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 14px", borderRadius: "6px", background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: "12px" }}>
                      <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--text-strong)" }}>{String(s.key)}</span>
                      <span style={{ fontFamily: "var(--mono)", color: "var(--muted)", flex: 1 }}>{String(s.value_masked)}</span>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600, background: s.category === "api_key" ? "rgba(255,92,92,0.1)" : "rgba(107,114,128,0.12)", color: s.category === "api_key" ? "var(--accent)" : "#6b7280" }}>{String(s.category)}</span>
                      <button onClick={() => openEdit(s)} style={{ ...btnStyle, background: "rgba(255,92,92,0.1)", color: "var(--accent)", padding: "4px 8px" }}>编辑</button>
                      <button onClick={() => handleDelete(s.key)} style={{ ...btnStyle, background: "rgba(239,68,68,0.12)", color: "#ef4444", padding: "4px 8px" }}>删除</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showAddModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => { setShowAddModal(false); setEditKey(null); }}>
          <div style={{ background: "var(--bg-elevated)", borderRadius: "12px", padding: "24px", width: "460px", maxWidth: "90vw", border: "1px solid var(--border-strong)", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 16px", fontSize: "16px", fontWeight: 700, color: "var(--text-strong)" }}>{editKey ? "编辑密钥" : "添加密钥"}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>密钥名称</label><input className="input" placeholder="例如 OPENROUTER_API_KEY" value={formState.key} onChange={(e) => setFormState({ ...formState, key: e.target.value })} disabled={!!editKey} style={{ width: "100%", opacity: editKey ? 0.6 : 1 }} /></div>
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>密钥值</label><input className="input" type="password" placeholder={editKey ? "留空则不更新" : "输入密钥值"} value={formState.value} onChange={(e) => setFormState({ ...formState, value: e.target.value })} style={{ width: "100%" }} /></div>
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>分类</label><select value={formState.category} onChange={(e) => setFormState({ ...formState, category: e.target.value })} style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--text)", fontSize: "12px" }}><option value="api_key">api_key</option><option value="token">token</option><option value="secret">secret</option></select></div>
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted)", marginBottom: "4px" }}>说明</label><input className="input" placeholder="密钥用途描述" value={formState.description} onChange={(e) => setFormState({ ...formState, description: e.target.value })} style={{ width: "100%" }} /></div>
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "20px" }}>
              <button onClick={() => { setShowAddModal(false); setEditKey(null); }} style={{ ...btnStyle, background: "var(--bg)", border: "1px solid var(--border-strong)", color: "var(--muted)" }}>取消</button>
              <button onClick={handleSave} disabled={!formState.key || (!editKey && !formState.value)} style={{ ...btnStyle, background: "var(--accent)", color: "#fff", opacity: !formState.key || (!editKey && !formState.value) ? 0.5 : 1 }}>{editKey ? "更新" : "添加"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

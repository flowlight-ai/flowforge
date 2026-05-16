"use client";

import { useState, useEffect, useCallback } from "react";

interface AgentItem { name: string; description: string; enabled: boolean; mode?: string; model?: string; }
interface ToolItem { name: string; description: string; enabled: boolean; category?: string; }
interface ModeItem { name: string; description: string; enabled: boolean; }
interface MemoryItem { name: string; description: string; enabled: boolean; type?: string; }
interface SecretEntry { key: string; value_masked: string; category: string; description: string; configured: boolean; }
interface ProviderEntry { name: string; base_url: string; api_key_env: string; key_configured: boolean; key_masked: string; }

type Tab = "agents" | "modes" | "tools" | "memory" | "secrets";

const API_BASE = "/api/v1/settings";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("agents");
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [modes, setModes] = useState<ModeItem[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [formState, setFormState] = useState({ key: "", value: "", category: "api_key", description: "" });

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [ag, mo, tl, mm, sc, pr] = await Promise.all([
      fetch("/api/v1/system/agents").then((r) => r.json()).then((d) => d?.agents || d?.agent_guards || []).catch(() => []),
      fetch("/api/v1/system/modes").then((r) => r.json()).then((d) => d?.modes || []).catch(() => []),
      fetch("/api/v1/system/tools").then((r) => r.json()).then((d) => d?.tools || []).catch(() => []),
      fetch("/api/v1/system/memory").then((r) => r.json()).then((d) => d?.memory || []).catch(() => []),
      fetch(`${API_BASE}/secrets`).then((r) => r.json()).then((d) => d?.data?.secrets || []).catch(() => []),
      fetch(`${API_BASE}/providers`).then((r) => r.json()).then((d) => d?.data?.providers || []).catch(() => []),
    ]);
    setAgents(Array.isArray(ag) ? ag.map((a: any) => ({ name: a.agent_name || a.name, description: a.description || "", enabled: a.is_available !== false, mode: a.mode, model: a.model })) : []);
    setModes(Array.isArray(mo) ? mo.map((m: any) => ({ name: m.name || m, description: m.description || "", enabled: m.enabled !== false })) : []);
    setTools(Array.isArray(tl) ? tl.map((t: any) => ({ name: t.name || t, description: t.description || "", enabled: t.enabled !== false, category: t.category })) : []);
    setMemory(Array.isArray(mm) ? mm.map((m: any) => ({ name: m.name || m, description: m.description || "", enabled: m.enabled !== false, type: m.type })) : []);
    setSecrets(sc);
    setProviders(pr);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const showMsg = (msg: string, isErr = false) => { setMessage(isErr ? `❌ ${msg}` : `✅ ${msg}`); setTimeout(() => setMessage(""), 3000); };

  const handleSave = async () => {
    if (!formState.key || !formState.value) return;
    try {
      const r = await fetch(`${API_BASE}/secrets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formState) });
      if (r.ok) { showMsg(editKey ? "密钥已更新" : "密钥已添加"); setShowAddModal(false); setEditKey(null); setFormState({ key: "", value: "", category: "api_key", description: "" }); loadAll(); }
      else { const err = await r.json().catch(() => ({ detail: "保存失败" })); showMsg(err.detail || "保存失败", true); }
    } catch (e: any) { showMsg(e.message, true); }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(`确认删除密钥 "${key}"？`)) return;
    try { const r = await fetch(`${API_BASE}/secrets/${encodeURIComponent(key)}`, { method: "DELETE" }); if (r.ok) { showMsg(`密钥 ${key} 已删除`); loadAll(); } else showMsg("删除失败", true); }
    catch (e: any) { showMsg(e.message, true); }
  };

  const openEdit = (secret: SecretEntry) => { setEditKey(secret.key); setFormState({ key: secret.key, value: "", category: secret.category, description: secret.description }); setShowAddModal(true); };
  const openAdd = () => { setEditKey(null); setFormState({ key: "", value: "", category: "api_key", description: "" }); setShowAddModal(true); };
  const openProviderConfig = (provider: ProviderEntry) => { setEditKey(provider.api_key_env); setFormState({ key: provider.api_key_env, value: "", category: "api_key", description: `${provider.name} API Key` }); setShowAddModal(true); };

  const btnStyle: React.CSSProperties = { padding: "6px 14px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 600 };

  if (loading) return <div className="animate-rise"><div className="card"><div className="empty">加载中...</div></div></div>;

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "agents", label: "Agent", icon: "🤖" },
    { key: "modes", label: "执行模式", icon: "⚡" },
    { key: "tools", label: "工具", icon: "🔧" },
    { key: "memory", label: "记忆", icon: "🧠" },
    { key: "secrets", label: "密钥", icon: "🔑" },
  ];

  const PluginCard = ({ item, onToggle }: { item: { name: string; description: string; enabled: boolean; [k: string]: any }; onToggle?: (name: string) => void }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border)", transition: "all 0.15s" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)" }}>{item.name}</div>
        {item.description && <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>}
      </div>
      {onToggle && (
        <button onClick={() => onToggle(item.name)} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "12px", border: `1px solid ${item.enabled ? "var(--ok)" : "var(--border)"}`, background: item.enabled ? "var(--ok)1a" : "var(--bg)", color: item.enabled ? "var(--ok)" : "var(--muted)", cursor: "pointer", fontSize: "11px", fontWeight: 600 }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: item.enabled ? "var(--ok)" : "var(--muted)", display: "inline-block" }} />
          {item.enabled ? "启用" : "禁用"}
        </button>
      )}
    </div>
  );

  return (
    <div className="animate-rise">
      {message && <div style={{ marginBottom: "16px", padding: "10px 16px", borderRadius: "var(--radius-sm)", background: message.startsWith("❌") ? "var(--danger-subtle)" : "var(--ok-subtle)", color: message.startsWith("❌") ? "var(--danger)" : "var(--ok)", fontSize: "13px", fontWeight: 500 }}>{message}</div>}

      <div className="card" style={{ paddingBottom: "12px" }}>
        <h2 className="page-title" style={{ margin: "0 0 4px" }}>系统设置</h2>
        <p className="page-sub" style={{ marginBottom: "16px" }}>管理 Agent、执行模式、工具、记忆与密钥</p>

        <div style={{ display: "flex", gap: "4px", borderBottom: "2px solid var(--border-strong)", marginBottom: "16px" }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: "8px 14px", border: "none", borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent", background: "none", color: tab === t.key ? "var(--accent)" : "var(--muted)", cursor: "pointer", fontSize: "13px", fontWeight: tab === t.key ? 700 : 500, marginBottom: "-2px", transition: "all 0.15s" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "agents" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>{agents.length} 个 Agent 已注册</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {agents.map((a) => <PluginCard key={a.name} item={a} />)}
              {agents.length === 0 && <div className="empty">暂无 Agent</div>}
            </div>
          </div>
        )}

        {tab === "modes" && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{modes.length} 个执行模式可用</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {modes.map((m) => <PluginCard key={m.name} item={m} />)}
              {modes.length === 0 && <div className="empty">暂无执行模式</div>}
            </div>
          </div>
        )}

        {tab === "tools" && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{tools.length} 个工具已注册</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {tools.map((t) => <PluginCard key={t.name} item={t} />)}
              {tools.length === 0 && <div className="empty">暂无工具</div>}
            </div>
          </div>
        )}

        {tab === "memory" && (
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>{memory.length} 个记忆存储已注册</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {memory.map((m) => <PluginCard key={m.name} item={m} />)}
              {memory.length === 0 && <div className="empty">暂无记忆存储</div>}
            </div>
          </div>
        )}

        {tab === "secrets" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>{secrets.length} 个密钥已配置</span>
              <button onClick={openAdd} style={{ ...btnStyle, background: "var(--accent)", color: "#fff" }}>+ 添加密钥</button>
            </div>

            {providers.length > 0 && (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-strong)", marginBottom: "8px" }}>供应商密钥</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {providers.map((p) => (
                    <div key={p.name} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "8px", background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", minWidth: "80px" }}>{p.name}</span>
                      <span style={{ fontSize: "11px", fontFamily: "var(--mono)", color: "var(--muted)", flex: 1 }}>{p.api_key_env}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600, color: p.key_configured ? "var(--ok)" : "var(--danger)" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: p.key_configured ? "var(--ok)" : "var(--danger)", display: "inline-block" }} />
                        {p.key_configured ? "已配置" : "未配置"}
                      </span>
                      <button onClick={() => openProviderConfig(p)} style={{ ...btnStyle, background: p.key_configured ? "var(--accent)1a" : "var(--accent)", color: p.key_configured ? "var(--accent)" : "#fff" }}>
                        {p.key_configured ? "更新" : "配置"}
                      </button>
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
                    <div key={s.key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 14px", borderRadius: "6px", background: "var(--bg-elevated)", border: "1px solid var(--border)", fontSize: "12px" }}>
                      <span style={{ fontFamily: "var(--mono)", fontWeight: 600, color: "var(--text-strong)" }}>{s.key}</span>
                      <span style={{ fontFamily: "var(--mono)", color: "var(--muted)", flex: 1 }}>{s.value_masked}</span>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "10px", fontWeight: 600, background: s.category === "api_key" ? "var(--accent)1a" : "var(--muted)1a", color: s.category === "api_key" ? "var(--accent)" : "var(--muted-strong)" }}>{s.category}</span>
                      <button onClick={() => openEdit(s)} style={{ ...btnStyle, background: "var(--accent)1a", color: "var(--accent)", padding: "4px 8px" }}>编辑</button>
                      <button onClick={() => handleDelete(s.key)} style={{ ...btnStyle, background: "var(--danger-subtle)", color: "var(--danger)", padding: "4px 8px" }}>删除</button>
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
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted-strong)", marginBottom: "4px" }}>密钥名称</label><input className="input" placeholder="例如 OPENROUTER_API_KEY" value={formState.key} onChange={(e) => setFormState({ ...formState, key: e.target.value })} disabled={!!editKey} style={{ width: "100%", opacity: editKey ? 0.6 : 1 }} /></div>
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted-strong)", marginBottom: "4px" }}>密钥值</label><input className="input" type="password" placeholder={editKey ? "留空则不更新" : "输入密钥值"} value={formState.value} onChange={(e) => setFormState({ ...formState, value: e.target.value })} style={{ width: "100%" }} /></div>
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted-strong)", marginBottom: "4px" }}>分类</label><select value={formState.category} onChange={(e) => setFormState({ ...formState, category: e.target.value })} style={{ width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border-strong)", background: "var(--bg)", color: "var(--text)", fontSize: "12px" }}><option value="api_key">api_key</option><option value="token">token</option><option value="secret">secret</option></select></div>
              <div><label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--muted-strong)", marginBottom: "4px" }}>说明</label><input className="input" placeholder="密钥用途描述" value={formState.description} onChange={(e) => setFormState({ ...formState, description: e.target.value })} style={{ width: "100%" }} /></div>
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

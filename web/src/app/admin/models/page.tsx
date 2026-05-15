"use client";

import { useState, useEffect } from "react";

interface ProviderInfo {
  name: string;
  base_url: string;
  rate_limit_rpm: number;
  cost_per_1k_tokens?: number;
}

interface SchemaInfo {
  providers: string[];
  available_models: string[];
  [key: string]: any;
}

type Tab = "defaults" | "providers" | "pool";

export default function ModelManagerPage() {
  const [tab, setTab] = useState<Tab>("defaults");
  const [schema, setSchema] = useState<SchemaInfo>({
    providers: [],
    available_models: [],
  });
  const [defaults, setDefaults] = useState({ model: "" });
  const [defaultsDraft, setDefaultsDraft] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [probePool, setProbePool] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({
    name: "",
    base_url: "",
    rate_limit_rpm: 20,
    cost_per_1k_tokens: 0,
  });

  const [showAddModel, setShowAddModel] = useState<{
    provider: string;
  } | null>(null);
  const [newModelId, setNewModelId] = useState("");

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const [s, d, p, pp] = await Promise.all([
      fetch("/api/v1/admin/models-config/schema")
        .then((r) => r.json())
        .catch(() => ({ providers: [], available_models: [] })),
      fetch("/api/v1/admin/models-config/defaults")
        .then((r) => r.json())
        .catch(() => ({ defaults: { model: "" } })),
      fetch("/api/v1/admin/models-config/providers")
        .then((r) => r.json())
        .catch(() => ({ providers: [] })),
      fetch("/api/v1/admin/models-config/probe-pool")
        .then((r) => r.json())
        .catch(() => ({ probe_pool: {} })),
    ]);
    setSchema(s);
    const dm = (d && d.defaults && d.defaults.model) || "";
    setDefaults({ model: dm });
    setDefaultsDraft(dm);
    setProviders((p && p.providers) || []);
    setProbePool((pp && pp.probe_pool) || {});
    setLoading(false);
  };

  const showMsg = (msg: string, isErr = false) => {
    setMessage(isErr ? `❌ ${msg}` : `✅ ${msg}`);
    setTimeout(() => setMessage(""), 3000);
  };

  const saveDefaults = async () => {
    setSaving("defaults");
    try {
      const r = await fetch("/api/v1/admin/models-config/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: defaultsDraft }),
      });
      if (r.ok) {
        const d = await r.json();
        setDefaults(d.defaults);
        showMsg("全局默认模型已保存");
      } else {
        showMsg((await r.json()).detail || "保存失败", true);
      }
    } catch (e: any) {
      showMsg(e.message, true);
    }
    setSaving(null);
  };

  const addProvider = async () => {
    if (!newProvider.name || !newProvider.base_url) return;
    setSaving("add_provider");
    try {
      const body: any = {
        base_url: newProvider.base_url,
        rate_limit_rpm: newProvider.rate_limit_rpm,
      };
      if (newProvider.cost_per_1k_tokens > 0)
        body.cost_per_1k_tokens = newProvider.cost_per_1k_tokens;
      const r = await fetch(
        `/api/v1/admin/models-config/providers/${newProvider.name}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (r.ok) {
        showMsg(`供应商 ${newProvider.name} 已添加`);
        setShowAddProvider(false);
        setNewProvider({
          name: "",
          base_url: "",
          rate_limit_rpm: 20,
          cost_per_1k_tokens: 0,
        });
        loadAll();
      } else {
        showMsg((await r.json()).detail || "添加失败", true);
      }
    } catch (e: any) {
      showMsg(e.message, true);
    }
    setSaving(null);
  };

  const deleteProvider = async (name: string) => {
    if (!confirm(`确认删除供应商 "${name}"？`)) return;
    try {
      const r = await fetch(
        `/api/v1/admin/models-config/providers/${name}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        const err = await r
          .json()
          .catch(() => ({ detail: "删除失败" }));
        showMsg(err.detail || "删除失败", true);
        return;
      }
      showMsg(`供应商 ${name} 已删除`);
      loadAll();
    } catch (e: any) {
      showMsg(e.message, true);
    }
  };

  const addProbeModel = async () => {
    if (!showAddModel || !newModelId) return;
    try {
      const r = await fetch(
        `/api/v1/admin/models-config/probe-pool/${showAddModel.provider}/models/${newModelId}`,
        { method: "POST" }
      );
      if (r.ok) {
        showMsg(`模型 ${showAddModel.provider}/${newModelId} 已添加`);
        setShowAddModel(null);
        setNewModelId("");
        loadAll();
      } else {
        showMsg((await r.json()).detail || "添加失败", true);
      }
    } catch (e: any) {
      showMsg(e.message, true);
    }
  };

  const removeProbeModel = async (provider: string, modelId: string) => {
    try {
      const r = await fetch(
        `/api/v1/admin/models-config/probe-pool/${provider}/models/${modelId}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        const err = await r
          .json()
          .catch(() => ({ detail: "删除失败" }));
        showMsg(err.detail || "删除失败", true);
        return;
      }
      showMsg(`模型 ${provider}/${modelId} 已移除`);
      loadAll();
    } catch (e: any) {
      showMsg(e.message, true);
    }
  };

  const btnStyle: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 600,
  };

  if (loading)
    return (
      <div className="animate-rise">
        <div className="card">
          <div className="empty">加载中...</div>
        </div>
      </div>
    );

  const tabs: { key: Tab; label: string }[] = [
    { key: "defaults", label: "全局默认" },
    { key: "providers", label: "供应商" },
    { key: "pool", label: "模型池" },
  ];

  return (
    <div className="animate-rise">
      {message && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 16px",
            borderRadius: "var(--radius-sm)",
            background: message.startsWith("❌")
              ? "var(--danger-subtle)"
              : "var(--ok-subtle)",
            color: message.startsWith("❌")
              ? "var(--danger)"
              : "var(--ok)",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          {message}
        </div>
      )}

      <div className="card" style={{ paddingBottom: "12px" }}>
        <h2 className="page-title" style={{ margin: "0 0 4px" }}>
          模型治理
        </h2>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          管理 AI 模型供应商与模型路由
        </p>

        <div
          style={{
            display: "flex",
            gap: "4px",
            borderBottom: "2px solid var(--border-strong)",
            marginBottom: "16px",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 16px",
                border: "none",
                borderBottom:
                  tab === t.key
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                background: "none",
                color: tab === t.key ? "var(--accent)" : "var(--muted)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: tab === t.key ? 700 : 500,
                marginBottom: "-2px",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "defaults" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "16px",
              borderRadius: "8px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
            }}
          >
            <span
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--text)",
                whiteSpace: "nowrap",
              }}
            >
              🤖 默认模型
            </span>
            <div style={{ flex: 1, maxWidth: "420px" }}>
              <select
                value={defaultsDraft}
                onChange={(e) => setDefaultsDraft(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-strong)",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: "12px",
                  fontFamily: "var(--mono)",
                }}
              >
                <option value="">未设置</option>
                {(schema.available_models || []).map((m: string) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={saveDefaults}
              disabled={saving === "defaults"}
              style={{
                ...btnStyle,
                background: "var(--accent)",
                color: "#fff",
                opacity: saving === "defaults" ? 0.6 : 1,
              }}
            >
              {saving === "defaults" ? "保存中..." : "保存"}
            </button>
          </div>
        )}

        {tab === "providers" && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginBottom: "10px",
              }}
            >
              <button
                onClick={() => setShowAddProvider(true)}
                style={{
                  ...btnStyle,
                  background: "var(--accent)",
                  color: "#fff",
                }}
              >
                + 添加供应商
              </button>
            </div>

            {!providers || providers.length === 0 ? (
              <div className="empty">暂无供应商配置</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                }}
              >
                {providers.map((p) => (
                  <div
                    key={p.name}
                    style={{
                      padding: "12px 16px",
                      borderRadius: "8px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "14px",
                        fontWeight: 700,
                        color: "var(--text-strong)",
                        minWidth: "90px",
                      }}
                    >
                      {p.name}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--muted)",
                        fontFamily: "var(--mono)",
                        flex: 1,
                      }}
                    >
                      {p.base_url}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--muted-strong)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      RPM: {p.rate_limit_rpm}
                    </span>
                    <button
                      onClick={() => deleteProvider(p.name)}
                      style={{
                        ...btnStyle,
                        background: "var(--danger-subtle)",
                        color: "var(--danger)",
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showAddProvider && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "16px",
                  borderRadius: "8px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--accent)",
                }}
              >
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    marginBottom: "12px",
                  }}
                >
                  新增供应商
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "8px",
                    marginBottom: "12px",
                  }}
                >
                  <input
                    className="input"
                    placeholder="供应商名称"
                    value={newProvider.name}
                    onChange={(e) =>
                      setNewProvider({
                        ...newProvider,
                        name: e.target.value,
                      })
                    }
                  />
                  <input
                    className="input"
                    placeholder="API URL"
                    value={newProvider.base_url}
                    onChange={(e) =>
                      setNewProvider({
                        ...newProvider,
                        base_url: e.target.value,
                      })
                    }
                  />
                  <input
                    className="input"
                    type="number"
                    placeholder="RPM 限制"
                    value={newProvider.rate_limit_rpm}
                    onChange={(e) =>
                      setNewProvider({
                        ...newProvider,
                        rate_limit_rpm: +e.target.value || 20,
                      })
                    }
                  />
                  <input
                    className="input"
                    type="number"
                    placeholder="每千Token费用 ($)"
                    value={newProvider.cost_per_1k_tokens}
                    onChange={(e) =>
                      setNewProvider({
                        ...newProvider,
                        cost_per_1k_tokens: +e.target.value || 0,
                      })
                    }
                  />
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={addProvider}
                    disabled={saving === "add_provider"}
                    style={{
                      ...btnStyle,
                      background: "var(--accent)",
                      color: "#fff",
                      opacity: saving === "add_provider" ? 0.6 : 1,
                    }}
                  >
                    {saving === "add_provider" ? "添加中..." : "确认添加"}
                  </button>
                  <button
                    onClick={() => setShowAddProvider(false)}
                    style={{
                      ...btnStyle,
                      background: "var(--bg)",
                      border: "1px solid var(--border-strong)",
                      color: "var(--muted)",
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "pool" && (
          <div>
            {!probePool || Object.keys(probePool).length === 0 ? (
              <div className="empty">模型池为空</div>
            ) : (
              Object.entries(probePool).map(([provider, models]) => {
                const safeModels = Array.isArray(models) ? models : [];
                return (
                  <div
                    key={provider}
                    style={{
                      marginBottom: "10px",
                      padding: "14px 16px",
                      borderRadius: "8px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "8px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          color: "var(--text-strong)",
                        }}
                      >
                        🏷 {provider}
                      </span>
                      <button
                        onClick={() => {
                          setShowAddModel({ provider });
                          setNewModelId("");
                        }}
                        style={{
                          ...btnStyle,
                          background: "var(--accent)",
                          color: "#fff",
                        }}
                      >
                        + 添加模型
                      </button>
                    </div>

                    {showAddModel?.provider === provider && (
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          marginBottom: "8px",
                          padding: "10px",
                          borderRadius: "6px",
                          background: "var(--bg)",
                        }}
                      >
                        <input
                          className="input"
                          placeholder="模型 ID"
                          value={newModelId}
                          onChange={(e) => setNewModelId(e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <button
                          onClick={addProbeModel}
                          style={{
                            ...btnStyle,
                            background: "var(--ok)",
                            color: "#fff",
                          }}
                        >
                          确认
                        </button>
                        <button
                          onClick={() => setShowAddModel(null)}
                          style={{
                            ...btnStyle,
                            background: "var(--bg)",
                            border: "1px solid var(--border-strong)",
                            color: "var(--muted)",
                          }}
                        >
                          取消
                        </button>
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                      }}
                    >
                      {safeModels.map((m) => (
                        <span
                          key={m}
                          title="点击移除"
                          onClick={() => removeProbeModel(provider, m)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "4px 10px",
                            borderRadius: "16px",
                            background: "var(--bg)",
                            border: "1px solid var(--border)",
                            color: "var(--text)",
                            fontSize: "12px",
                            fontFamily: "var(--mono)",
                            cursor: "pointer",
                            transition: "all 0.1s",
                          }}
                        >
                          {m}
                          <span
                            style={{
                              fontSize: "10px",
                              opacity: 0.4,
                              marginLeft: "2px",
                            }}
                          >
                            ×
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

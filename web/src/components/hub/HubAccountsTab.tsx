"use client";

/**
 * HubAccountsTab — 账户管理 Tab
 *
 * 移植自 clowder-ai HubAccountsTab，简化为 FlowForge 适配版。
 * 用于 /admin/settings?s=accounts，管理 Provider 账户与认证。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/accounts, DELETE /api/v1/accounts/{id}。
 */

import { useCallback, useEffect, useState } from "react";

interface ProfileItem {
  id: string;
  displayName: string;
  provider: string;
  baseUrl?: string;
  clientId?: string;
  authType?: string;
  models?: string[];
  builtin?: boolean;
  envVars?: Record<string, string>;
}

interface AccountsResponse {
  providers: ProfileItem[];
}

export function HubAccountsTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ProfileItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/v1/accounts");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        setError((body.error as string) ?? "加载账户列表失败");
        return;
      }
      const body = (await res.json()) as AccountsResponse | { data: AccountsResponse };
      const list = "providers" in body ? body.providers : (body as { data: AccountsResponse }).data?.providers ?? [];
      setAccounts(list);
    } catch {
      setError("网络错误，无法加载账户列表");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleDelete = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        const res = await fetch(`/api/v1/accounts/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          throw new Error((body.error as string) ?? "删除失败");
        }
        await fetchAccounts();
        window.dispatchEvent(new CustomEvent("accounts-changed"));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyId(null);
      }
    },
    [fetchAccounts],
  );

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载账户中...</div>;
  }

  return (
    <div data-hub-accounts="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {error && (
        <div data-hub-accounts-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("hub-accounts-create"))}
          style={{
            padding: "6px 14px",
            borderRadius: "6px",
            background: "var(--accent,#ff5c5c)",
            color: "#fff",
            border: "none",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
          data-hub-accounts-action="create"
        >
          + 新增账户
        </button>
      </div>

      {accounts.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "24px 0", textAlign: "center" }}>
          暂无账户配置，请新增第一个 Provider 账户。
        </div>
      ) : (
        accounts.map((a) => (
          <div
            key={a.id}
            data-hub-accounts-item={a.id}
            style={{
              padding: "12px 14px",
              borderRadius: "8px",
              background: "var(--bg-elevated,#1e1f26)",
              border: "1px solid var(--border,#2a2c3a)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
                  {a.displayName}
                </span>
                {a.builtin && (
                  <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "rgba(99,102,241,0.15)", color: "#a78bfa" }}>
                    内置
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(a.id)}
                disabled={busyId === a.id || a.builtin}
                style={{
                  fontSize: "11px",
                  color: "#ef4444",
                  background: "transparent",
                  border: "none",
                  cursor: busyId === a.id || a.builtin ? "not-allowed" : "pointer",
                  opacity: busyId === a.id || a.builtin ? 0.5 : 1,
                }}
                data-hub-accounts-action="delete"
              >
                {busyId === a.id ? "删除中..." : "删除"}
              </button>
            </div>
            <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
              <span>Provider: <code style={{ color: "var(--text,#e5e7eb)" }}>{a.provider}</code></span>
              {a.authType && <span>Auth: <code style={{ color: "var(--text,#e5e7eb)" }}>{a.authType}</code></span>}
            </div>
            {a.models && a.models.length > 0 && (
              <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {a.models.slice(0, 6).map((m) => (
                  <span key={m} style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--bg,#15151c)", color: "var(--muted-strong,#6b7280)" }}>
                    {m}
                  </span>
                ))}
                {a.models.length > 6 && (
                  <span style={{ fontSize: "10px", color: "var(--muted,#9ca3af)" }}>+{a.models.length - 6}</span>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default HubAccountsTab;

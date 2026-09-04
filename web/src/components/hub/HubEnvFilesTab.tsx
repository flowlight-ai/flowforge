"use client";

/**
 * HubEnvFilesTab — 环境文件管理 Tab
 *
 * 移植自 clowder-ai HubEnvFilesTab，简化为 FlowForge 适配版。
 * 用于 /admin/env，展示与编辑 .env 配置文件、敏感变量与配置文件清单。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/env/summary, PUT /api/v1/env/{varName}。
 *
 * D28：保存前用 @flowforge/config-schema 做客户端校验（可编辑白名单 /
 * required / allowedValues / boolean 字面量 / masked 未改哨兵跳过 PUT）。
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react";

import {
  isMaskedSecretUnchanged,
  toEnvSchemaEntry,
  validateEnvSchemaValue,
} from "@flowforge/config-schema";

interface EnvVariable {
  name: string;
  value: string;
  category: "config" | "secret" | "path" | "model";
  editable: boolean;
  masked: boolean;
  description?: string;
  /** 可选扩展字段：env-registry 下发后用于更精确的客户端校验 */
  allowedValues?: string[];
  required?: boolean;
  kind?: "boolean" | "enum" | "number" | "string" | "path";
}

interface EnvFileEntry {
  path: string;
  size: number;
  modifiedAt: string;
  envCount: number;
}

interface EnvSummary {
  variables: EnvVariable[];
  files: EnvFileEntry[];
  storage?: {
    mode?: "redis" | "memory";
    persistent?: boolean;
    warning?: string | null;
  };
}

const CATEGORY_LABELS: Record<EnvVariable["category"], string> = {
  config: "配置",
  secret: "密钥",
  path: "路径",
  model: "模型",
};

const inputBaseStyle: CSSProperties = {
  flex: 1,
  padding: "5px 8px",
  borderRadius: "4px",
  border: "1px solid var(--border,#2a2c3a)",
  background: "var(--bg,#15151c)",
  color: "var(--text,#e5e7eb)",
  fontSize: "11px",
  fontFamily: "monospace",
};

export function HubEnvFilesTab() {
  const [summary, setSummary] = useState<EnvSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/env/summary");
      if (!res.ok) {
        setError("加载环境信息失败");
        return;
      }
      const body = (await res.json()) as EnvSummary | { data: EnvSummary };
      const data = "variables" in body ? body : (body as { data: EnvSummary }).data;
      setSummary(data);
      const editable = (data.variables ?? []).filter((v) => v.editable);
      setDrafts(Object.fromEntries(editable.map((v) => [v.name, v.value])));
    } catch {
      setError("网络错误，无法加载环境信息");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const lookupVariable = useCallback(
    (varName: string): EnvVariable | undefined =>
      summary?.variables?.find((v) => v.name === varName),
    [summary],
  );

  /** 单行实时校验（masked 未改 → 视为未修改，可提交但会跳过 PUT）。 */
  const liveValidation = useCallback(
    (v: EnvVariable): { ok: boolean; errors: string[]; maskedUnchanged: boolean } => {
      const raw = drafts[v.name] ?? "";
      const entry = toEnvSchemaEntry(v);
      if (!entry) return { ok: true, errors: [], maskedUnchanged: false };
      const maskedUnchanged = isMaskedSecretUnchanged(entry, raw);
      const result = validateEnvSchemaValue(entry, raw);
      return { ok: result.ok || maskedUnchanged, errors: result.errors, maskedUnchanged };
    },
    [drafts],
  );

  const handleChange = useCallback(
    (varName: string, value: string) => {
      setDrafts((prev) => ({ ...prev, [varName]: value }));
      setRowErrors((prev) => {
        if (!(varName in prev)) return prev;
        const next = { ...prev };
        delete next[varName];
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(
    async (varName: string) => {
      const value = drafts[varName];
      if (value === undefined) return;
      const variable = lookupVariable(varName);
      const entry = variable ? toEnvSchemaEntry(variable) : null;
      if (entry) {
        if (isMaskedSecretUnchanged(entry, value)) {
          // 掩码未改：不提交新值，仅刷新
          await fetchSummary();
          return;
        }
        const result = validateEnvSchemaValue(entry, value);
        if (!result.ok) {
          setRowErrors((prev) => ({ ...prev, [varName]: result.errors.join("；") }));
          return;
        }
      }
      setSaving(varName);
      setError(null);
      try {
        const res = await fetch(`/api/v1/env/${encodeURIComponent(varName)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "保存失败");
        }
        setRowErrors((prev) => {
          if (!(varName in prev)) return prev;
          const next = { ...prev };
          delete next[varName];
          return next;
        });
        await fetchSummary();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [drafts, fetchSummary, lookupVariable],
  );

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载环境信息...</div>;
  }

  return (
    <div data-hub-env="root" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {error && (
        <div data-hub-env-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      {summary?.storage?.mode === "memory" && (
        <div data-hub-env-warning="memory" style={{ color: "#eab308", fontSize: "12px", padding: "8px 12px", background: "rgba(234,179,8,0.08)", borderRadius: "6px" }}>
          ⚠️ 当前为内存存储模式，重启后数据将丢失。
        </div>
      )}

      <div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "8px" }}>
          配置文件（{summary?.files?.length ?? 0}）
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(summary?.files ?? []).map((f) => (
            <div
              key={f.path}
              data-hub-env-file={f.path}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 12px",
                borderRadius: "6px",
                background: "var(--bg-elevated,#1e1f26)",
                border: "1px solid var(--border,#2a2c3a)",
                fontSize: "12px",
              }}
            >
              <span style={{ fontFamily: "monospace", color: "var(--text,#e5e7eb)" }}>{f.path}</span>
              <span style={{ color: "var(--muted,#9ca3af)" }}>
                {f.envCount} vars · {new Date(f.modifiedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)", marginBottom: "8px" }}>
          环境变量（{summary?.variables?.length ?? 0}）
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {(summary?.variables ?? []).map((v) => {
            const validation = v.editable ? liveValidation(v) : null;
            const entry = toEnvSchemaEntry(v);
            const hasAllowedValues = Boolean(entry?.allowedValues && entry.allowedValues.length > 0);
            const rowErrorText = rowErrors[v.name];
            const saveDisabled =
              saving === v.name ||
              (validation !== null && (!validation.ok || validation.maskedUnchanged));
            return (
              <div
                key={v.name}
                data-hub-env-var={v.name}
                style={{
                  padding: "10px 12px",
                  borderRadius: "8px",
                  background: "var(--bg-elevated,#1e1f26)",
                  border: "1px solid var(--border,#2a2c3a)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <code style={{ fontSize: "12px", color: "var(--text-strong,#e5e7eb)" }}>{v.name}</code>
                  <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--bg,#15151c)", color: "var(--muted,#9ca3af)" }}>
                    {CATEGORY_LABELS[v.category]}
                  </span>
                </div>
                {v.editable ? (
                  <>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {hasAllowedValues ? (
                        <select
                          value={drafts[v.name] ?? ""}
                          onChange={(e) => handleChange(v.name, e.target.value)}
                          style={{ ...inputBaseStyle, flex: 1 }}
                          data-hub-env-input={v.name}
                        >
                          {(entry?.allowedValues ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={drafts[v.name] ?? ""}
                          onChange={(e) => handleChange(v.name, e.target.value)}
                          type={v.category === "secret" ? "password" : "text"}
                          style={inputBaseStyle}
                          data-hub-env-input={v.name}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => handleSave(v.name)}
                        disabled={saveDisabled}
                        style={{
                          padding: "5px 10px",
                          borderRadius: "4px",
                          background: "var(--accent,#ff5c5c)",
                          color: "#fff",
                          border: "none",
                          fontSize: "11px",
                          cursor: "pointer",
                          opacity: saving === v.name ? 0.5 : 1,
                        }}
                        data-hub-env-action="save"
                      >
                        {saving === v.name ? "..." : "保存"}
                      </button>
                    </div>
                    {validation?.maskedUnchanged && !rowErrorText ? (
                      <div style={{ color: "var(--muted,#9ca3af)", fontSize: "11px", marginTop: "4px" }}>
                        未修改（掩码值不提交）
                      </div>
                    ) : rowErrorText || (validation && !validation.ok && validation.errors.length > 0) ? (
                      <div
                        data-hub-env-error={v.name}
                        style={{ color: "#ef4444", fontSize: "11px", marginTop: "4px" }}
                      >
                        {rowErrorText ?? validation?.errors.join("；")}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div style={{ fontSize: "11px", color: "var(--muted,#9ca3af)", fontFamily: "monospace" }}>
                    {v.masked ? "••••••••" : v.value}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default HubEnvFilesTab;

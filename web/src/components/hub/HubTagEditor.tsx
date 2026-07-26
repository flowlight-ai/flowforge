"use client";

/**
 * HubTagEditor — 标签编辑器
 *
 * 移植自 clowder-ai HubTagEditor，简化为 FlowForge 适配版。
 * 用于 /admin/agents，编辑可进化智能体的标签集合（用于分组与过滤）。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/forgemind/{id}/tags, PUT /api/v1/forgemind/{id}/tags。
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface HubTagEditorProps {
  forgekinId: string;
  initialTags?: string[];
  onSaved?: (tags: string[]) => void;
}

const SUGGESTED_TAGS = ["内容创作", "代码生成", "工程流水线", "小说创作", "电商运营", "高可用", "低成本", "高质量"];

export function HubTagEditor({ forgekinId, initialTags, onSaved }: HubTagEditorProps) {
  const [tags, setTags] = useState<string[]>(initialTags ?? []);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFromApi, setLoadedFromApi] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 若未提供 initialTags，则从 API 加载
  const fetchTags = useCallback(async () => {
    if (initialTags !== undefined) return;
    try {
      const res = await fetch(`/api/v1/forgemind/${forgekinId}/tags`);
      if (!res.ok) return;
      const body = (await res.json()) as { tags?: string[] };
      setTags(body.tags ?? []);
    } catch {
      // 静默失败，保留空 tags
    } finally {
      setLoadedFromApi(true);
    }
  }, [forgekinId, initialTags]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleAdd = useCallback(() => {
    const value = draft.trim();
    if (!value || tags.includes(value)) {
      setDraft("");
      return;
    }
    setTags((prev) => [...prev, value]);
    setDraft("");
  }, [draft, tags]);

  const handleRemove = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAdd();
    } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/forgemind/${forgekinId}/tags`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "保存失败");
      }
      onSaved?.(tags);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [forgekinId, tags, onSaved]);

  const suggestions = SUGGESTED_TAGS.filter((t) => !tags.includes(t));

  return (
    <div data-hub-tag-editor="root" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          padding: "8px",
          borderRadius: "6px",
          background: "var(--bg-elevated,#1e1f26)",
          border: "1px solid var(--border,#2a2c3a)",
          minHeight: "36px",
        }}
        data-hub-tag-editor-list="true"
      >
        {tags.length === 0 && !loadedFromApi && (
          <span style={{ fontSize: "11px", color: "var(--muted,#9ca3af)", alignSelf: "center" }}>加载中...</span>
        )}
        {tags.length === 0 && loadedFromApi && (
          <span style={{ fontSize: "11px", color: "var(--muted,#9ca3af)", alignSelf: "center" }}>暂无标签</span>
        )}
        {tags.map((t) => (
          <span
            key={t}
            data-hub-tag-editor-tag={t}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              borderRadius: "10px",
              background: "rgba(99,102,241,0.15)",
              color: "#a78bfa",
              fontSize: "11px",
            }}
          >
            #{t}
            <button
              type="button"
              onClick={() => handleRemove(t)}
              aria-label={`移除标签 ${t}`}
              style={{ background: "transparent", border: "none", color: "#a78bfa", cursor: "pointer", fontSize: "12px", padding: 0, lineHeight: 1 }}
              data-hub-tag-editor-action="remove"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleAdd}
          placeholder="输入标签，回车或逗号确认"
          style={{
            flex: 1,
            minWidth: "120px",
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text,#e5e7eb)",
            fontSize: "11px",
          }}
          data-hub-tag-editor-input="draft"
        />
      </div>

      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          <span style={{ fontSize: "10px", color: "var(--muted,#9ca3af)", alignSelf: "center" }}>建议:</span>
          {suggestions.slice(0, 5).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                if (!tags.includes(s)) setTags((prev) => [...prev, s]);
              }}
              style={{
                padding: "2px 8px",
                borderRadius: "10px",
                background: "var(--bg,#15151c)",
                color: "var(--muted,#9ca3af)",
                border: "1px dashed var(--border,#2a2c3a)",
                fontSize: "10px",
                cursor: "pointer",
              }}
              data-hub-tag-editor-suggestion={s}
            >
              + {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div data-hub-tag-editor-error="save" style={{ color: "#ef4444", fontSize: "11px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "5px 14px",
            borderRadius: "6px",
            background: "var(--accent,#ff5c5c)",
            color: "#fff",
            border: "none",
            fontSize: "12px",
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.5 : 1,
          }}
          data-hub-tag-editor-action="save"
        >
          {saving ? "保存中..." : "保存标签"}
        </button>
      </div>
    </div>
  );
}

export default HubTagEditor;

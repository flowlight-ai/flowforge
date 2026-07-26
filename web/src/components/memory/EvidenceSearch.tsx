"use client";

/**
 * EvidenceSearch — 证据检索
 *
 * 输入查询，召回相关记忆证据（带出处锚点）。
 * 移植自 clowder-ai EvidenceSearch，简化为单栏结果列表。
 *
 * API：GET /api/v1/memory/search?q={query}&limit={limit}
 */

import { useCallback, useEffect, useState } from "react";

interface EvidenceHit {
  readonly id: string;
  readonly collection: string;
  readonly anchor: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly updatedAt?: string;
}

interface EvidenceSearchProps {
  readonly initialQuery?: string;
  readonly limit?: number;
}

export function EvidenceSearch({ initialQuery = "", limit = 20 }: EvidenceSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [hits, setHits] = useState<EvidenceHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, limit: String(limit) });
      const res = await fetch(`/api/v1/memory/search?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHits(data?.hits ?? data?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (submitted) void runSearch(submitted);
  }, [submitted, runSearch]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query);
  };

  return (
    <div className="card" data-memory="search">
      <h2 className="page-title" style={{ margin: "0 0 4px 0" }}>证据检索</h2>
      <p className="page-sub" style={{ marginBottom: "12px" }}>
        召回相关记忆证据 · 显示前 {hits.length} 条
      </p>

      <form onSubmit={onSubmit} style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <input
          type="text"
          value={query}
          data-memory="search-input"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入查询关键词（如：角色设定、第3章伏笔）"
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-strong)",
            background: "var(--bg)",
            color: "var(--fg)",
            fontSize: "13px",
            outline: "none",
          }}
        />
        <button
          type="submit"
          data-memory="search-submit"
          disabled={loading}
          style={{
            padding: "8px 16px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: "13px",
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "检索中..." : "检索"}
        </button>
      </form>

      {error && (
        <div style={errorBoxStyle}>
          <span>检索失败：{error}</span>
          <button onClick={() => void runSearch(submitted)} style={retryBtnStyle}>重试</button>
        </div>
      )}

      {!loading && !error && submitted && hits.length === 0 && (
        <div style={emptyStyle}>
          <div style={{ fontSize: "24px", marginBottom: "8px" }}>⌕</div>
          未找到匹配证据
        </div>
      )}

      {hits.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
          {hits.map((hit) => (
            <li
              key={hit.id}
              data-memory-hit={hit.id}
              style={{
                padding: "12px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px", gap: "8px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)" }}>
                  {hit.title || hit.anchor}
                </div>
                <span className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)", fontFamily: "monospace" }}>
                  {(hit.score * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <span className="pill">{hit.collection}</span>
                <span style={{ fontFamily: "monospace" }}>{hit.anchor}</span>
                {hit.updatedAt && <span>{hit.updatedAt.slice(0, 19)}</span>}
              </div>
              <div style={{ fontSize: "13px", color: "var(--fg)", lineHeight: 1.5 }}>
                {hit.snippet}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const errorBoxStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontSize: "13px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "12px",
};

const retryBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--danger)",
  fontWeight: 600,
  fontSize: "12px",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px",
  color: "var(--muted)",
};

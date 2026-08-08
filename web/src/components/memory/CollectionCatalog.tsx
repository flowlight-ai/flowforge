"use client";

/**
 * CollectionCatalog — 记忆集合目录
 *
 * 列出所有记忆集合（Collection）的清单与文档数、状态、敏感度。
 * 移植自 clowder-ai CollectionCatalog，简化为 FlowForge 内联样式版。
 *
 * API：GET /api/v1/memory/collections
 */

import { useCallback, useEffect, useState } from "react";

interface CollectionItem {
  readonly id: string;
  readonly displayName: string;
  readonly kind: string;
  readonly sensitivity: "public" | "internal" | "private" | "restricted";
  readonly status: "registered" | "indexing" | "active" | "stale" | "blocked" | "archived";
  readonly docCount: number;
  readonly pendingReviewCount?: number;
  readonly updatedAt?: string;
}

const SENSITIVITY_STYLE: Record<CollectionItem["sensitivity"], React.CSSProperties> = {
  public: { background: "var(--ok-subtle)", color: "var(--ok)" },
  internal: { background: "color-mix(in srgb, var(--info) 18%, transparent)", color: "var(--info)" },
  private: { background: "var(--warn-subtle)", color: "var(--warn)" },
  restricted: { background: "var(--danger-subtle)", color: "var(--danger)" },
};

const STATUS_STYLE: Record<CollectionItem["status"], React.CSSProperties> = {
  registered: { background: "var(--bg-hover)", color: "var(--muted)" },
  indexing: { background: "color-mix(in srgb, var(--info) 18%, transparent)", color: "var(--info)" },
  active: { background: "var(--ok-subtle)", color: "var(--ok)" },
  stale: { background: "var(--warn-subtle)", color: "var(--warn)" },
  blocked: { background: "var(--danger-subtle)", color: "var(--danger)" },
  archived: { background: "var(--bg-hover)", color: "var(--muted)" },
};

export function CollectionCatalog() {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | CollectionItem["status"]>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/memory/collections");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: CollectionItem[] = data?.items ?? data?.collections ?? [];
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = filter === "all" ? items : items.filter((i) => i.status === filter);

  return (
    <div className="card" data-memory="catalog">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <h2 className="page-title" style={{ margin: 0 }}>集合目录</h2>
        <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
      </div>
      <p className="page-sub" style={{ marginBottom: "12px" }}>
        知识集合清单 · 共 {items.length} 个集合
      </p>

      <div style={{ display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" }}>
        {(["all", "active", "indexing", "stale", "blocked", "archived"] as const).map((s) => (
          <button
            key={s}
            data-memory-filter={s}
            onClick={() => setFilter(s)}
            style={{
              cursor: "pointer",
              border: "1px solid var(--border-strong)",
              background: filter === s ? "var(--accent)" : "transparent",
              color: filter === s ? "#fff" : "var(--muted)",
              borderRadius: "20px",
              padding: "4px 12px",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            {s === "all" ? "全部" : s}
          </button>
        ))}
      </div>

      {error && (
        <div style={errorBoxStyle}>
          <span>加载失败：{error}</span>
          <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
        </div>
      )}

      {loading ? (
        <div style={loadingStyle}>加载中...</div>
      ) : visible.length === 0 ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: "24px", marginBottom: "8px" }}>▤</div>
          暂无集合
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border-strong)" }}>
              {["集合", "类型", "敏感度", "状态", "文档数", "待审", "更新时间"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id} data-memory-row={item.id} style={{ borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)" }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{item.displayName}</td>
                <td style={tdStyle}><span className="pill">{item.kind}</span></td>
                <td style={tdStyle}><span className="pill" style={SENSITIVITY_STYLE[item.sensitivity]}>{item.sensitivity}</span></td>
                <td style={tdStyle}><span className="pill" style={STATUS_STYLE[item.status]}>{item.status}</span></td>
                <td style={{ ...tdStyle, fontFamily: "monospace" }}>{item.docCount}</td>
                <td style={{ ...tdStyle, fontFamily: "monospace", color: item.pendingReviewCount ? "var(--warn)" : "var(--muted)" }}>{item.pendingReviewCount ?? 0}</td>
                <td style={{ ...tdStyle, fontSize: "12px", color: "var(--muted)" }}>{item.updatedAt?.slice(0, 19) ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const refreshBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--accent)",
  fontSize: "13px",
  fontWeight: 600,
};

const errorBoxStyle: React.CSSProperties = {
  marginTop: "12px",
  padding: "10px 16px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontSize: "13px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const retryBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--danger)",
  fontWeight: 600,
  fontSize: "12px",
};

const loadingStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px",
  color: "var(--muted)",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px",
  color: "var(--muted)",
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: "12px",
  color: "var(--muted)",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: "13px",
};

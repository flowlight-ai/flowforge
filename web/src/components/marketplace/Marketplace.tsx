"use client";

/**
 * Marketplace — 能力市场主页
 *
 * 搜索栏 + 分类标签 + 卡片网格。整合 MarketplaceSearch 与 MarketplaceCard。
 * 移植自 clowder-ai MarketplacePanel，简化为无 store 单容器版。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/marketplace/artifacts?keyword=&category=&sort=
 *      POST /api/v1/marketplace/install
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MarketplaceCard, type MarketplaceArtifact } from "./MarketplaceCard";
import { MarketplaceSearch, type MarketplaceQuery } from "./MarketplaceSearch";

const DEFAULT_CATEGORIES = ["agent", "skill", "prompt", "tool", "workflow"];

export function Marketplace() {
  const [query, setQuery] = useState<MarketplaceQuery>({ keyword: "", category: "all", sort: "popular" });
  const [items, setItems] = useState<MarketplaceArtifact[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.keyword) params.set("keyword", query.keyword);
      if (query.category !== "all") params.set("category", query.category);
      params.set("sort", query.sort);
      const res = await fetch(`/api/v1/marketplace/artifacts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: MarketplaceArtifact[] = data?.items ?? data?.artifacts ?? [];
      setItems(list);
      const cats = Array.from(new Set(list.map((i) => i.category))).sort();
      setCategories(cats.length > 0 ? cats : DEFAULT_CATEGORIES);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const install = useCallback(async (id: string) => {
    await fetch("/api/v1/marketplace/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifactId: id }),
    });
  }, []);

  const featured = useMemo(() => items.find((i) => i.featured), [items]);

  return (
    <div className="animate-rise" data-marketplace="hub">
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h2 className="page-title" style={{ margin: 0 }}>能力市场</h2>
            <p className="page-sub" style={{ margin: "4px 0 0 0" }}>
              发现并安装 Forgekin 能力包 · 共 {items.length} 个
            </p>
          </div>
          <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
        </div>

        <div style={{ marginTop: "12px", marginBottom: "12px" }}>
          <MarketplaceSearch value={query} onChange={setQuery} categories={categories} />
        </div>

        {error && (
          <div style={errorBoxStyle}>
            <span>加载失败：{error}</span>
            <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
          </div>
        )}

        {loading ? (
          <div style={loadingStyle}>加载中...</div>
        ) : items.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>◇</div>
            暂无能力包 · 调整搜索条件或稍后再试
          </div>
        ) : (
          <>
            {featured && query.sort === "popular" && !query.keyword && query.category === "all" && (
              <div data-marketplace="featured" style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  精选推荐
                </div>
                <div style={{ maxWidth: "320px" }}>
                  <MarketplaceCard artifact={featured} onInstall={install} />
                </div>
              </div>
            )}
            <div
              data-marketplace="grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "12px",
              }}
            >
              {items.map((artifact) => (
                <MarketplaceCard key={artifact.id} artifact={artifact} onInstall={install} />
              ))}
            </div>
          </>
        )}
      </div>
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

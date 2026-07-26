"use client";

/**
 * MarketplaceSearch — 能力市场搜索栏
 *
 * 提供关键词输入、分类筛选、排序选项。
 * 受控组件：value/onChange 由父组件管理。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 */

export type MarketplaceSort = "popular" | "recent" | "name";

export interface MarketplaceQuery {
  readonly keyword: string;
  readonly category: string;
  readonly sort: MarketplaceSort;
}

interface MarketplaceSearchProps {
  readonly value: MarketplaceQuery;
  readonly onChange: (next: MarketplaceQuery) => void;
  readonly categories: readonly string[];
}

const SORT_OPTIONS: ReadonlyArray<{ id: MarketplaceSort; label: string }> = [
  { id: "popular", label: "热门" },
  { id: "recent", label: "最新" },
  { id: "name", label: "名称" },
];

export function MarketplaceSearch({ value, onChange, categories }: MarketplaceSearchProps) {
  return (
    <div
      data-marketplace="search"
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        alignItems: "center",
        padding: "10px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <input
        type="text"
        data-marketplace-input="keyword"
        value={value.keyword}
        onChange={(e) => onChange({ ...value, keyword: e.target.value })}
        placeholder="搜索能力包（如：内容创作、代码审查、SEO 优化）"
        style={{
          flex: 1,
          minWidth: "200px",
          padding: "8px 12px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          background: "var(--bg)",
          color: "var(--fg)",
          fontSize: "13px",
          outline: "none",
        }}
      />
      <select
        data-marketplace-input="category"
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
        style={{
          padding: "8px 10px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          background: "var(--bg)",
          color: "var(--fg)",
          fontSize: "13px",
          cursor: "pointer",
        }}
      >
        <option value="all">全部分类</option>
        {categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <div
        data-marketplace-sort
        style={{ display: "inline-flex", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}
      >
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            data-marketplace-sort-opt={opt.id}
            onClick={() => onChange({ ...value, sort: opt.id })}
            style={{
              padding: "6px 12px",
              background: value.sort === opt.id ? "var(--accent)" : "transparent",
              color: value.sort === opt.id ? "#fff" : "var(--muted)",
              border: "none",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {(value.keyword || value.category !== "all" || value.sort !== "popular") && (
        <button
          data-marketplace-action="clear"
          onClick={() => onChange({ keyword: "", category: "all", sort: "popular" })}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--muted)",
            fontSize: "12px",
            fontWeight: 500,
            padding: "4px 8px",
          }}
        >
          清除
        </button>
      )}
    </div>
  );
}

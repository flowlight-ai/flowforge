"use client";

/**
 * HistorySearchModal — 全局搜索模态框
 *
 * 顶部 Cmd/Ctrl+K 触发的全局搜索：任务 / 可进化智能体 / 记忆证据 / 信号。
 * 移植自 clowder-ai HistorySearchModal，简化为本地搜索 + 类别切换。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/search?q=&category=&limit=
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

export type SearchCategory = "task" | "forgekin" | "memory" | "signal" | "all";

interface SearchResult {
  readonly id: string;
  readonly category: "task" | "forgekin" | "memory" | "signal";
  readonly title: string;
  readonly subtitle?: string;
  readonly href: string;
  readonly snippet?: string;
  readonly updatedAt?: string;
}

interface HistorySearchModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialCategory?: SearchCategory;
}

const CATEGORY_LABEL: Record<SearchCategory, string> = {
  all: "全部",
  task: "任务",
  forgekin: "智能体",
  memory: "记忆",
  signal: "信号",
};

export function HistorySearchModal({ open, onClose, initialCategory = "all" }: HistorySearchModalProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>(initialCategory);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 全局快捷键 Cmd/Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const search = useCallback(async (q: string, cat: SearchCategory) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, limit: "12" });
      if (cat !== "all") params.set("category", cat);
      const res = await fetch(`/api/v1/search?${params}`);
      if (!res.ok) {
        setResults([]);
        return;
      }
      const data = await res.json();
      const list: SearchResult[] = data?.items ?? data?.results ?? [];
      setResults(list);
      setActiveIndex(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query) void search(query, category);
    else setResults([]);
  }, [query, category, search]);

  // 键盘导航
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && results[activeIndex]) {
        const href = results[activeIndex].href;
        window.location.href = href;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, activeIndex, onClose]);

  const categoryOptions = useMemo(() => (["all", "task", "forgekin", "memory", "signal"] as const), []);

  if (!open) return null;

  return (
    <div
      data-search="modal"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--bg) 70%, transparent)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-search="panel"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-md)",
          width: "100%",
          maxWidth: "600px",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.2))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <span aria-hidden style={{ color: "var(--muted)", fontSize: "14px" }}>⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            data-search-input="query"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索任务 / 可进化智能体 / 记忆 / 信号..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--fg)",
              fontSize: "14px",
            }}
          />
          <kbd
            style={{
              fontSize: "10px",
              color: "var(--muted)",
              padding: "2px 6px",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg)",
            }}
          >
            ESC
          </kbd>
        </div>

        <div style={{ display: "flex", gap: "4px", padding: "8px 12px", borderBottom: "1px solid var(--border)", overflowX: "auto" }}>
          {categoryOptions.map((c) => (
            <button
              key={c}
              data-search-filter={c}
              onClick={() => setCategory(c)}
              style={{
                cursor: "pointer",
                border: "1px solid var(--border-strong)",
                background: category === c ? "var(--accent)" : "transparent",
                color: category === c ? "#fff" : "var(--muted)",
                borderRadius: "20px",
                padding: "3px 10px",
                fontSize: "11px",
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }} data-search="results">
          {loading ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>搜索中...</div>
          ) : !query ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
              输入关键词开始搜索
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
              未找到匹配结果
            </div>
          ) : (
            results.map((r, idx) => (
              <Link
                key={`${r.category}-${r.id}`}
                href={r.href}
                data-search-result={r.category}
                data-search-active={idx === activeIndex}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={onClose}
                style={{
                  display: "block",
                  padding: "8px 12px",
                  background: idx === activeIndex ? "var(--bg-hover)" : "transparent",
                  textDecoration: "none",
                  color: "var(--fg)",
                  borderLeft: idx === activeIndex ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.title}
                  </div>
                  <span className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)", fontSize: "10px" }}>
                    {CATEGORY_LABEL[r.category]}
                  </span>
                </div>
                {r.subtitle && (
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>{r.subtitle}</div>
                )}
                {r.snippet && (
                  <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", lineHeight: 1.4 }}>
                    {r.snippet.length > 80 ? r.snippet.slice(0, 79) + "…" : r.snippet}
                  </div>
                )}
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

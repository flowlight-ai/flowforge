"use client";

/**
 * MemoryHub — 记忆中心主容器
 *
 * 左侧导航 + 右侧内容布局；导航项与路由一一对应。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 路由：/memory（默认 feed） /catalog /graph /health /search /status
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

export type MemoryTab =
  | "feed"
  | "catalog"
  | "graph"
  | "health"
  | "search"
  | "status";

interface NavItem {
  readonly id: MemoryTab;
  readonly label: string;
  readonly href: string;
  readonly icon: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "feed", label: "动态", href: "/memory", icon: "◉" },
  { id: "catalog", label: "集合目录", href: "/memory/catalog", icon: "▤" },
  { id: "graph", label: "记忆图谱", href: "/memory/graph", icon: "⬡" },
  { id: "search", label: "证据检索", href: "/memory/search", icon: "⌕" },
  { id: "health", label: "健康报告", href: "/memory/health", icon: "♥" },
  { id: "status", label: "索引状态", href: "/memory/status", icon: "⚙" },
];

interface MemoryHubProps {
  readonly activeTab?: MemoryTab;
  readonly children?: ReactNode;
}

export function MemoryHub({ activeTab, children }: MemoryHubProps) {
  const pathname = usePathname();
  const current = activeTab ?? deriveTabFromPath(pathname);

  return (
    <div
      className="animate-rise"
      data-memory="hub"
      data-memory-active={current}
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gap: "16px",
        minHeight: "calc(100vh - 120px)",
      }}
    >
      <aside
        data-memory="nav"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: "12px 8px",
          position: "sticky",
          top: "12px",
          height: "fit-content",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            color: "var(--muted)",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            padding: "4px 10px 8px",
          }}
        >
          记忆中心
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === current;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  data-memory-nav={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 10px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "13px",
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "var(--accent)" : "var(--muted)",
                    background: isActive ? "var(--bg-hover)" : "transparent",
                    textDecoration: "none",
                    border: isActive ? "1px solid color-mix(in srgb, var(--accent) 35%, transparent)" : "1px solid transparent",
                  }}
                >
                  <span aria-hidden style={{ width: "16px", textAlign: "center" }}>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </aside>

      <section data-memory="content" style={{ minWidth: 0 }}>
        {children}
      </section>
    </div>
  );
}

function deriveTabFromPath(pathname: string | null): MemoryTab {
  if (!pathname) return "feed";
  if (pathname === "/memory") return "feed";
  if (pathname.startsWith("/memory/catalog")) return "catalog";
  if (pathname.startsWith("/memory/graph")) return "graph";
  if (pathname.startsWith("/memory/health")) return "health";
  if (pathname.startsWith("/memory/search")) return "search";
  if (pathname.startsWith("/memory/status")) return "status";
  return "feed";
}

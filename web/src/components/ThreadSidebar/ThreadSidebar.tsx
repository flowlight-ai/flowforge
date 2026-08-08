"use client";

/**
 * ThreadSidebar — 左侧线程栏
 *
 * 来源：clowder-ai/packages/web/src/components/ThreadSidebar/ThreadSidebar.tsx（简化版）
 *
 * Phase 2 简化策略：
 *   - 基于现有 flowforge Sidebar 改造，保留导航分组结构
 *   - 添加 onClose prop（移动端关闭）
 *   - 添加 data-thread-sidebar 标记（T8 测试用）
 *   - 后续 Phase 4 补全 Forgekin 选择器、线程列表、标签过滤等
 *
 * 命名规范：使用 P0 命名（"智能体" 而非 "灵智体"）
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellConfig } from "@/lib/shell-config";

interface ThreadSidebarProps {
  onClose?: () => void;
  className?: string;
}

export function ThreadSidebar({ onClose, className }: ThreadSidebarProps) {
  const pathname = usePathname();
  const config = useShellConfig();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <div
      className={`flex flex-col h-full bg-[var(--cafe-surface,#1e1f26)] border-r border-[var(--cafe-border-subtle,#2a2c3a)] ${className ?? ""}`}
      data-thread-sidebar="root"
    >
      <div
        className="flex items-center gap-2.5 px-4 h-[52px] border-b border-[var(--cafe-border-subtle,#2a2c3a)] flex-shrink-0"
        data-thread-sidebar="header"
      >
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold text-white flex-shrink-0"
          style={{ background: config.brandColor }}
        >
          {config.brandShort}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-[var(--cafe-text,#e5e7eb)] truncate">
            {config.brandName}
          </span>
          <span className="text-xs text-[var(--cafe-text-muted,#6b7280)] truncate">
            {config.brandSubtitle} {config.version}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭侧边栏"
            className="ml-auto p-1.5 rounded-md text-[var(--cafe-text-secondary,#9ca3af)] hover:bg-[var(--console-rail-item,#252633)] hover:text-[var(--cafe-text,#e5e7eb)] transition-colors lg:hidden"
            data-thread-sidebar-close="true"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <nav
        className="flex-1 overflow-y-auto py-3 px-2"
        aria-label="主侧边栏导航"
        data-thread-sidebar="nav"
      >
        {config.navSections.map((section) => (
          <div key={section.label} className="mb-4" data-thread-sidebar-section={section.label}>
            <div className="px-2 mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--cafe-text-muted,#6b7280)]">
              {section.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                    isActive(item.href)
                      ? "bg-[var(--console-rail-active,#2a2c3a)] text-[var(--cafe-text,#e5e7eb)] font-medium"
                      : "text-[var(--cafe-text-secondary,#9ca3af)] hover:bg-[var(--console-rail-item,#252633)] hover:text-[var(--cafe-text,#e5e7eb)]"
                  }`}
                  data-thread-sidebar-item={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 text-base leading-none">
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge != null && item.badge > 0 && (
                    <span
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-xs font-bold"
                      style={{
                        background: "var(--semantic-warning,#f59e0b)",
                        color: "var(--cafe-accent-foreground,#fff)",
                      }}
                    >
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div
        className="px-3 py-2.5 border-t border-[var(--cafe-border-subtle,#2a2c3a)] flex items-center justify-between text-xs text-[var(--cafe-text-muted,#6b7280)] flex-shrink-0"
        data-thread-sidebar="footer"
      >
        <span>版本</span>
        <span className="font-mono">{config.version}</span>
      </div>
    </div>
  );
}

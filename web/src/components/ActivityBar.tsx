"use client";

/**
 * ActivityBar — 全局活动栏（52px）
 *
 * 来源：clowder-ai/packages/web/src/components/ActivityBar.tsx（简化版）
 *
 * 重构说明（v2）：
 *   - 将原"对话"小图标拆为两个独立入口：对话（/solo）+ 群聊（/council）
 *   - 原因：Helm 是单人对话、Council 是群聊，二者 UI 框架完全不同（Helm 三栏 vs Council 全屏），
 *     放在同一小图标下会让用户混淆。拆为两个独立入口更直观。
 *   - 底部保留审批铃铛 + 设置 + 主题切换
 *
 * 命名规范（依据 naming-contract.md）：
 *   - 使用 P0 命名 "智能体" / "记忆中心" 等
 *   - 路径与 clowder-ai 对齐（/solo /council /memory /mission-hub /signals /admin/settings）
 */

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { useApprovalHubStore } from "@/stores/approvalHubStore";
import { useThreadDrawerStore } from "@/stores/threadDrawerStore";
import { useTheme } from "./ThemeProvider";

interface NavItemDef {
  id: string;
  path: string;
  label: string;
  match: (p: string) => boolean;
  icon: (props: { className?: string }) => JSX.Element;
}

function ChatIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>对话</title>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MemoryIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>记忆</title>
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MissionIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>Mission Hub</title>
      <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 3v4a1 1 0 0 0 1 1h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 13h6M9 17h3" strokeLinecap="round" />
    </svg>
  );
}

function SignalIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>信号</title>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="4" y1="22" x2="4" y2="15" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>审批中心</title>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>设置</title>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>亮色主题</title>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>暗色主题</title>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SystemIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>跟随系统</title>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8" y1="21" x2="16" y2="21" strokeLinecap="round" />
      <line x1="12" y1="17" x2="12" y2="21" strokeLinecap="round" />
    </svg>
  );
}

function CouncilIcon({ className = "h-5 w-5" }: { className?: string }) {
  // 群聊图标：三个圆形头像叠加，表示多智能体协作
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>群聊</title>
      <circle cx="9" cy="9" r="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="11" r="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 19c0-3 3-5 6-5s6 2 6 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 19c0-2 2-3.5 4-3.5s2 1.5 2 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashboardIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>仪表盘</title>
      <rect x="3" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="3" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="14" width="7" height="7" rx="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ITEMS: NavItemDef[] = [
  // 仪表盘（首页）— ThreadSidebar 移除后，仪表盘入口移至 ActivityBar
  { id: "dashboard", path: "/", label: "仪表盘", match: (p) => p === "/", icon: DashboardIcon },
  // 两种对话模式拆为独立入口：对话（单人 Helm）+ 群聊（Council 多智能体）
  // 命名规范（v3）：toast 提示用 P0 用户术语"对话"/"群聊"，路由保持技术路径 /solo /council
  { id: "solo", path: "/solo", label: "对话", match: (p) => p.startsWith("/solo"), icon: ChatIcon },
  { id: "council", path: "/council", label: "群聊", match: (p) => p.startsWith("/council"), icon: CouncilIcon },
  { id: "memory", path: "/memory", label: "记忆中心", match: (p) => p.startsWith("/memory"), icon: MemoryIcon },
  { id: "mission", path: "/mission-hub", label: "Mission Hub", match: (p) => p.startsWith("/mission"), icon: MissionIcon },
  { id: "signals", path: "/signals", label: "信号", match: (p) => p.startsWith("/signals"), icon: SignalIcon },
];

interface ActivityBarProps {
  className?: string;
}

export function ActivityBar({ className }: ActivityBarProps) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const approvalCount = useApprovalHubStore((s) => s.count);
  const toggleApproval = useApprovalHubStore((s) => s.toggle);
  const fetchPending = useApprovalHubStore((s) => s.fetchPending);
  const { theme, resolvedTheme, toggleTheme } = useTheme();

  // 三态主题切换：light → dark → system → light
  // 图标和标题根据当前 theme 显示（system 模式下显示 SystemIcon + "跟随系统"）
  const themeTitle =
    theme === "light" ? "亮色主题（点击切换到暗色）" :
    theme === "dark" ? "暗色主题（点击切换到跟随系统）" :
    `跟随系统（当前: ${resolvedTheme === "dark" ? "暗色" : "亮色"}，点击切换到亮色）`;
  const themeIcon =
    theme === "light" ? <SunIcon className="h-5 w-5" /> :
    theme === "dark" ? <MoonIcon className="h-5 w-5" /> :
    <SystemIcon className="h-5 w-5" />;

  const handleNav = useCallback(
    (path: string) => {
      router.push(path);
    },
    [router],
  );

  const handleApprovalClick = useCallback(() => {
    toggleApproval();
    fetchPending();
  }, [toggleApproval, fetchPending]);

  const toggleThreadDrawer = useThreadDrawerStore((s) => s.toggle);
  const isThreadDrawerOpen = useThreadDrawerStore((s) => s.isOpen);

  const isSettingsRoute = pathname.startsWith("/admin/settings");

  return (
    <nav
      className={`flex w-[52px] flex-shrink-0 flex-col items-center gap-1.5 py-2.5 px-[6px] bg-[var(--console-rail-bg,#1e1f26)] ${className ?? ""}`}
      aria-label="主导航"
      data-activity-bar="root"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleNav(item.path)}
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
              active
                ? "bg-[var(--console-rail-active,#2a2c3a)] shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
                : "hover:bg-[var(--console-rail-item,#252633)] hover:shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
            }`}
            title={item.label}
            aria-current={active ? "page" : undefined}
            data-guide-id={`nav.${item.id}`}
            data-activity-bar-item={item.id}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-1.5">
        {/* 全局会话列表抽屉 — 在任意路由下可切换群聊会话 */}
        <button
          type="button"
          onClick={toggleThreadDrawer}
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
            isThreadDrawerOpen
              ? "bg-[var(--console-rail-active,#2a2c3a)] shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
              : "hover:bg-[var(--console-rail-item,#252633)] hover:shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
          }`}
          title="会话列表"
          aria-label="切换会话列表"
          aria-pressed={isThreadDrawerOpen}
          data-activity-bar-item="thread-drawer"
        >
          <CouncilIcon className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={handleApprovalClick}
          className="relative flex h-10 w-10 items-center justify-center rounded-lg transition-all hover:bg-[var(--console-rail-item,#252633)] hover:shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
          title={approvalCount > 0 ? `${approvalCount} 项待审批` : "审批中心"}
          data-testid="approval-hub-button"
          data-activity-bar-item="approval"
        >
          <BellIcon className="h-5 w-5" />
          {approvalCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-micro font-bold flex items-center justify-center"
              style={{
                backgroundColor: "var(--semantic-warning,#f59e0b)",
                color: "var(--cafe-accent-foreground,#fff)",
                maxWidth: "22px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              data-testid="approval-hub-badge"
            >
              {approvalCount > 99 ? "99+" : String(approvalCount)}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="flex h-10 w-10 items-center justify-center rounded-lg transition-all hover:bg-[var(--console-rail-item,#252633)] hover:shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
          title={themeTitle}
          data-activity-bar-item="theme"
          data-theme-current={theme}
        >
          {themeIcon}
        </button>

        <button
          type="button"
          onClick={() => handleNav("/admin/settings")}
          className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-all ${
            isSettingsRoute
              ? "bg-[var(--console-rail-active,#2a2c3a)] shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
              : "hover:bg-[var(--console-rail-item,#252633)] hover:shadow-[var(--console-rail-shadow,0_1px_2px_rgba(0,0,0,0.3))]"
          }`}
          title="设置"
          aria-current={isSettingsRoute ? "page" : undefined}
          data-guide-id="hub.trigger"
          data-testid="settings-button"
          data-activity-bar-item="settings"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </div>
    </nav>
  );
}

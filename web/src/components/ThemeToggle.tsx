/**
 * ThemeToggle — 主题快速切换按钮
 *
 * 来源：clowder-ai/packages/web/src/components/ThemeToggle.tsx（适配 flowforge）
 * 职责：单击在 light/dark/system 之间循环切换
 *
 * 设计原则：
 *   - 单按钮，图标反映当前 resolvedTheme
 *   - 使用 flowforge 的 useTheme hook（非 clowder-ai 的 useCafeTheme）
 *   - 颜色全部走 CSS 变量，跟随主题切换
 */

"use client";

import { useTheme } from "./ThemeProvider";

/** Sun icon (shown in light mode → click to go dark) */
function SunIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

/** Moon icon (shown in dark mode → click to go light) */
function MoonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/** Monitor icon (shown in system mode) */
function MonitorIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

export function ThemeToggle() {
  const { theme, resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const isSystem = theme === "system";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={
        isSystem
          ? "跟随系统，点击切换主题"
          : isDark
            ? "暗色模式，点击切换主题"
            : "亮色模式，点击切换主题"
      }
      title={
        isSystem
          ? "跟随系统"
          : isDark
            ? "暗色模式"
            : "亮色模式"
      }
      className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
    >
      {isSystem ? <MonitorIcon /> : isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

export default ThemeToggle;

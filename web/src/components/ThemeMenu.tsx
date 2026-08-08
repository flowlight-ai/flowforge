/**
 * ThemeMenu — 主题下拉菜单
 *
 * 来源：clowder-ai/packages/web/src/components/ThemeMenu.tsx（简化适配 flowforge）
 * 职责：下拉菜单选择 light/dark/system 三种主题模式
 *
 * 与 clowder-ai 版本的差异：
 *   - clowder-ai 依赖 useThemeStore（Zustand）管理多主题，flowforge 只有三态
 *   - flowforge 版本直接使用 useTheme hook，不依赖额外 store
 *   - 去除了自定义主题创建/删除功能（flowforge 暂不支持多自定义主题）
 *   - 保留了 clowder-ai 的 UI 设计（调色板图标 + 下拉菜单 + 预览色块）
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme, type Theme } from "./ThemeProvider";

export function PaletteIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <title>主题</title>
      <path
        d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.12-.29-.29-.44-.66-.44-1.13 0-.92.75-1.67 1.67-1.67H17c3.04 0 5.5-2.5 5.5-5.56C22.5 6.01 17.96 2 12 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface ThemeOption {
  id: Theme;
  name: string;
  description: string;
  bg: string;
  fg: string;
  accent: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "light",
    name: "亮色",
    description: "暖米色底，适合白天",
    bg: "oklch(0.88 0.01 80)",
    fg: "oklch(0.2 0.01 80)",
    accent: "oklch(0.65 0.14 50)",
  },
  {
    id: "dark",
    name: "暗色",
    description: "深灰底，适合夜间",
    bg: "oklch(0.28 0.01 80)",
    fg: "oklch(0.92 0.01 80)",
    accent: "oklch(0.65 0.14 50)",
  },
  {
    id: "system",
    name: "跟随系统",
    description: "自动跟随操作系统偏好",
    bg: "linear-gradient(135deg, oklch(0.88 0.01 80) 50%, oklch(0.28 0.01 80) 50%)",
    fg: "oklch(0.5 0.01 80)",
    accent: "oklch(0.65 0.14 50)",
  },
];

interface Props {
  /** 可选：编辑主题回调（flowforge 暂未实现 OklchTuner 集成时不会显示） */
  onEditTheme?: () => void;
}

const BTN = "flex h-10 w-10 items-center justify-center rounded-lg transition-all";
const ACTIVE = "bg-[var(--bg-hover)] shadow-[var(--shadow-md)]";
const HOVER = "hover:bg-[var(--bg-hover)] hover:shadow-[var(--shadow-md)]";

export function ThemeMenu({ onEditTheme }: Props) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${BTN} ${open ? ACTIVE : HOVER} text-[var(--muted)] hover:text-[var(--text)]`}
        title="主题"
      >
        <PaletteIcon />
      </button>
      {open && (
        <div className="absolute left-12 bottom-0 w-56 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] shadow-xl p-1.5 z-50 text-xs space-y-1">
          <div className="px-2.5 py-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
            主题模式
          </div>
          {THEME_OPTIONS.map((t) => {
            const isActive = t.id === theme;
            return (
              <div
                key={t.id}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
                style={t.id !== "system" ? { background: t.bg, color: t.fg } : undefined}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
              >
                <button
                  type="button"
                  className="flex-1 flex items-center gap-1.5 text-left hover:opacity-80"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTheme(t.id);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{t.name}</span>
                  {isActive && (
                    <svg
                      className="w-3.5 h-3.5 ml-auto"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke={t.accent}
                      strokeWidth="2"
                    >
                      <path d="M3 8l4 4 6-7" />
                    </svg>
                  )}
                </button>
                {t.id === "system" && (
                  <div
                    className="w-4 h-4 rounded border border-[var(--border)] shrink-0"
                    style={{ background: t.bg }}
                  />
                )}
              </div>
            );
          })}
          <div className="border-t border-[var(--border)] pt-1 px-2.5 py-1 text-[10px] text-[var(--muted)]">
            {THEME_OPTIONS.find((t) => t.id === theme)?.description}
          </div>
          {onEditTheme && (
            <div className="border-t border-[var(--border)] pt-1">
              <button
                type="button"
                onClick={() => {
                  onEditTheme();
                  setOpen(false);
                }}
                className="w-full text-left px-2.5 py-1.5 text-[var(--muted)] hover:text-[var(--text)] rounded-md hover:bg-[var(--bg-hover)]"
              >
                高级调色器…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ThemeMenu;

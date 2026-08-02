/**
 * ThemeProvider — 主题 Provider
 *
 * 职责：管理 light/dark/system 三态主题切换，提供主题上下文给子组件
 *
 * 设计原则：
 *   - 通过 React Context 暴露当前主题和切换方法
 *   - 持久化到 localStorage
 *   - 通过 data-theme 属性挂到 <html> 触发 CSS 切换
 *   - "system" 模式下跟随系统（prefers-color-scheme），且会动态响应系统主题变化
 *   - "light"/"dark" 为显式选择，优先级高于系统
 *
 * 三态设计（参考用户反馈）：
 *   - light：亮色主题
 *   - dark：暗色主题
 *   - system：跟随系统（默认）
 */

"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  /** 用户选择的主题（可能是 system） */
  theme: Theme;
  /** 实际应用的主题（永远是 light 或 dark，system 已解析） */
  resolvedTheme: ResolvedTheme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "flowforge-theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark"; // SSR 默认 dark
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system"; // SSR 默认 system
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  // 默认跟随系统
  return "system";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return getSystemTheme();
  return theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getInitialTheme()));

  // 同步主题到 <html data-theme> 和 localStorage
  // 注意：data-theme 必须是 light 或 dark（CSS 选择器需要具体值）
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", resolved);
      // 同时设置 data-theme-pref，保留用户偏好（system/light/dark）
      document.documentElement.setAttribute("data-theme-pref", theme);
      // 调试日志：追踪主题状态传递
      console.log(
        "%c[ThemeProvider] theme changed",
        "color: #ff5c5c; font-weight: bold",
        {
          theme,
          resolvedTheme: resolved,
          dataThemeAttr: document.documentElement.getAttribute("data-theme"),
          dataThemePrefAttr: document.documentElement.getAttribute("data-theme-pref"),
          timestamp: new Date().toISOString(),
        }
      );
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  }, [theme]);

  // 监听系统主题变化
  // 当用户选择 "system" 时，动态响应系统主题切换
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      // 只有当用户偏好为 system 时才跟随
      if (theme === "system") {
        const newResolved: ResolvedTheme = e.matches ? "dark" : "light";
        setResolvedTheme(newResolved);
        if (typeof document !== "undefined") {
          document.documentElement.setAttribute("data-theme", newResolved);
        }
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    // 三态循环：light → dark → system → light
    setThemeState((prev) => {
      if (prev === "light") return "dark";
      if (prev === "dark") return "system";
      return "light";
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

export default ThemeProvider;

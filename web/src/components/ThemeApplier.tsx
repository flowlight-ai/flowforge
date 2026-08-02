/**
 * ThemeApplier — 主题应用器
 *
 * 职责：在主题切换时应用主题相关的副作用（如更新 meta theme-color、触发过渡动画）
 *
 * 必须放在 ThemeProvider 内部使用
 */

"use client";

import { useEffect } from "react";
import { useTheme } from "./ThemeProvider";

const META_THEME_COLORS: Record<"light" | "dark", string> = {
  light: "#fdf8f3",
  dark: "#0e1015",
};

export function ThemeApplier() {
  // 使用 resolvedTheme（永远是 light 或 dark），避免 theme="system" 时索引失败
  // 当 theme="system" 时，resolvedTheme 会根据系统偏好自动解析为 light 或 dark
  const { resolvedTheme, theme } = useTheme();

  useEffect(() => {
    if (typeof document === "undefined") return;

    // 更新 meta theme-color（移动端浏览器顶栏颜色）
    // 使用 resolvedTheme 确保永远是 "light" 或 "dark"，避免 "system" 索引失败
    const color = META_THEME_COLORS[resolvedTheme];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", color);
    } else {
      const newMeta = document.createElement("meta");
      newMeta.name = "theme-color";
      newMeta.content = color;
      document.head.appendChild(newMeta);
    }

    // 给 body 加过渡动画 class（避免首屏闪烁）
    document.body.classList.add("theme-transition");
    const timer = window.setTimeout(() => {
      document.body.classList.remove("theme-transition");
    }, 300);

    return () => window.clearTimeout(timer);
  }, [resolvedTheme, theme]);

  return null;
}

export default ThemeApplier;

/**
 * ThemeApplier — 主题应用器
 *
 * 来源：clowder-ai/packages/web/src/components/ThemeApplier.tsx（简化版）
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
  const { theme } = useTheme();

  useEffect(() => {
    if (typeof document === "undefined") return;

    // 更新 meta theme-color（移动端浏览器顶栏颜色）
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", META_THEME_COLORS[theme]);
    } else {
      const newMeta = document.createElement("meta");
      newMeta.name = "theme-color";
      newMeta.content = META_THEME_COLORS[theme];
      document.head.appendChild(newMeta);
    }

    // 给 body 加过渡动画 class（避免首屏闪烁）
    document.body.classList.add("theme-transition");
    const timer = window.setTimeout(() => {
      document.body.classList.remove("theme-transition");
    }, 300);

    return () => window.clearTimeout(timer);
  }, [theme]);

  return null;
}

export default ThemeApplier;

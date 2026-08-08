/**
 * ForgekinHueInjector — Forgekin 色相注入器
 *
 * 命名变更：Cat → Forgekin（依据 naming-contract.md §3.1）
 *
 * 职责：根据当前选中的 Forgekin（可进化智能体），向 <html> 标签注入对应的色相变量
 * 用于在不同 Forgekin 切换时改变整体 UI 色调（如猫头鹰暖橙、夏洛克深蓝）
 *
 * 设计原则：
 *   - 不渲染任何 UI
 *   - 通过 CSS 变量 --forgekin-hue 注入色相值
 *   - 由 ThemeProvider 协调
 */

"use client";

import { useEffect } from "react";

/** Forgekin ID → 色相映射（依据 forgekin-persona-tokens.css） */
const FORGEKIN_HUE_MAP: Record<string, number> = {
  wenxin: 50,      // 猫头鹰·文心 — warm gold
  sherlock: 220,   // 猎犬·夏洛克 — deep blue
  luban: 30,       // 海狸·鲁班 — amber brown
  vangogh: 280,    // 孔雀·梵高 — purple
  davinci: 180,    // 老鹰·达芬奇 — teal
};

const DEFAULT_HUE = 50;

export function ForgekinHueInjector() {
  useEffect(() => {
    // 从 localStorage 读取上次选中的 Forgekin
    const stored = typeof window !== "undefined"
      ? window.localStorage.getItem("flowforge-current-forgekin")
      : null;
    const forgekinId = stored || "wenxin";
    const hue = FORGEKIN_HUE_MAP[forgekinId] ?? DEFAULT_HUE;

    // 注入 CSS 变量到 :root
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--forgekin-hue", String(hue));
      document.documentElement.setAttribute("data-forgekin", forgekinId);
    }

    // 监听 Forgekin 切换事件
    const handleForgekinChange = (event: Event) => {
      try {
        const detail = (event as CustomEvent).detail;
        if (detail?.forgekinId) {
          const newHue = FORGEKIN_HUE_MAP[detail.forgekinId] ?? DEFAULT_HUE;
          document.documentElement.style.setProperty("--forgekin-hue", String(newHue));
          document.documentElement.setAttribute("data-forgekin", detail.forgekinId);
          window.localStorage.setItem("flowforge-current-forgekin", detail.forgekinId);
        }
      } catch (err) {
        console.warn("[ForgekinHueInjector] forgekin change handler failed:", err);
      }
    };

    window.addEventListener("flowforge:forgekin-change", handleForgekinChange as EventListener);
    return () => {
      window.removeEventListener("flowforge:forgekin-change", handleForgekinChange as EventListener);
    };
  }, []);

  return null;
}

export default ForgekinHueInjector;

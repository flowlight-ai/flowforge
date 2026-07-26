import type { Config } from "tailwindcss";

/**
 * Tailwind CSS 配置
 *
 * 注意：禁用 preflight 以避免与 FlowForge 现有 globals.css 冲突。
 * 仅启用 Tailwind 的工具类（flex/grid/spacing/colors 等）。
 */
const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  corePlugins: {
    // 禁用 preflight — FlowForge 已有完整的 globals.css 重置
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // 映射 FlowForge CSS 变量到 Tailwind 颜色（可选使用）
        cafe: {
          accent: "var(--accent)",
          surface: "var(--bg-elevated)",
          border: "var(--border)",
          text: "var(--text)",
          "text-muted": "var(--muted)",
          "text-secondary": "var(--text-strong)",
        },
      },
    },
  },
  plugins: [],
};

export default config;

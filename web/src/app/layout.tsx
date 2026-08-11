import type { Metadata } from "next";
import dynamic from "next/dynamic";
// 性能优化（参考 clowder-ai）：globals.css 通过 import 加载（Tailwind 需要 Next 处理），
// 其他 vendor CSS 通过 <link> 静态加载，绕过 Next dev 的 flight CSS loader
// （该 loader 会阻塞类选择器和非根 CSS，是 dev 模式页面慢的核心原因）
import "./globals.css";

// 静态 vendor CSS（已在 predev 阶段由 sync-vendor-assets 复制到 public/vendor/app/）
const VENDOR_CSS_HREFS = [
  "/vendor/app/theme-tokens.css",
  "/vendor/app/forgekin-persona-tokens.css",
  "/vendor/app/forgekin-persona-derived.css",
  "/vendor/app/console-tokens.css",
  "/vendor/app/console-shell.css",
  "/vendor/app/console-controls.css",
  "/vendor/app/connector-tokens.css",
  "/vendor/app/theme-extras.css",
];

import { ShellConfigProvider } from "@/lib/shell-config";
import ShellWrapper from "@/components/ShellWrapper";
import { ShellConfig } from "@/lib/types";
import { SessionBootstrap } from "@/components/SessionBootstrap";
import { ForgekinHueInjector } from "@/components/ForgekinHueInjector";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeApplier } from "@/components/ThemeApplier";
import { ConfirmProvider } from "@/components/useConfirm";

// 性能优化：非关键全局组件用 dynamic import 延迟加载
// 这些组件（模态框/引导层/Toast）不在首屏关键渲染路径上，
// 延迟加载可显著减少首屏 JS 体积，参考 clowder-ai 的按需加载策略
const BrakeModal = dynamic(
  () => import("@/components/BrakeModal").then((m) => m.BrakeModal),
  { ssr: false, loading: () => null }
);
const GuideOverlay = dynamic(
  () => import("@/components/GuideOverlay").then((m) => m.GuideOverlay),
  { ssr: false, loading: () => null }
);
const ToastContainer = dynamic(
  () => import("@/components/ToastContainer").then((m) => m.ToastContainer),
  { ssr: false, loading: () => null }
);

const shellConfig: ShellConfig = {
  brandName: "FlowForge",
  brandShort: "FF",
  brandColor: "#ff5c5c",
  brandSubtitle: "AI Agent OS",
  version: "v0.1.0",
  // Phase 2：所有路由都受 ShellWrapper 保护
  // 注：原 chromelessPaths ["/showcase", "/story", "/story-export"] 已移除
  //（对应 page.tsx 未创建，配置会导致 404）
  navSections: [
    {
      label: "主页",
      items: [{ href: "/", label: "仪表盘", icon: "◫" }],
    },
    // 注：原"工作"分组（对话 / 群聊）已移到 ActivityBar 作为独立小图标入口
    // 原因：Helm 和 Council 是两种不同的对话模式，拆为独立入口更直观
    {
      label: "记忆与任务",
      items: [
        { href: "/memory", label: "记忆中心", icon: "◉" },
        { href: "/mission-hub", label: "Mission Hub", icon: "◎" },
        { href: "/signals", label: "信号", icon: "◈" },
        { href: "/tasks", label: "任务列表", icon: "☰" },
        { href: "/review", label: "审核中心", icon: "✓" },
      ],
    },
    {
      label: "管理",
      items: [
        { href: "/admin", label: "管理中心", icon: "▦" },
        { href: "/admin/agents", label: "智能体", icon: "◆" },
        { href: "/admin/settings", label: "设置中心", icon: "🔧" },
        { href: "/admin/observability", label: "可观测性", icon: "📊" },
      ],
    },
  ],
};

export const metadata: Metadata = {
  title: "FlowForge - AI Agent OS",
  description: "AI Agent Operating System",
  // PWA：manifest 链接（Next.js 自动渲染 <link rel="manifest">）
  manifest: "/manifest.json",
  // PWA：iOS Safari 全屏独立应用支持（等同 apple-mobile-web-app-capable）
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FlowForge",
  },
};

// PWA：theme-color 移至 viewport 导出（Next.js 14 规范）
export const viewport: Viewport = {
  themeColor: "#ff5c5c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning style={{ height: "100%" }}>
      <head>
        {/* 性能优化：vendor CSS 静态加载，绕过 Next dev flight CSS loader */}
        {VENDOR_CSS_HREFS.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body style={{ height: "100%", margin: 0 }} className="min-h-screen">
        <SessionBootstrap />
        <ForgekinHueInjector />
        <ThemeProvider>
          <ThemeApplier />
          <ConfirmProvider>
            <ShellConfigProvider config={shellConfig}>
              <ShellWrapper>{children}</ShellWrapper>
            </ShellConfigProvider>
          </ConfirmProvider>
          <BrakeModal />
          <GuideOverlay />
          <ToastContainer />
        </ThemeProvider>
      </body>
    </html>
  );
}

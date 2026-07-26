import type { Metadata } from "next";
import "./globals.css";
// 8 个 vendor CSS（Phase 1 已迁移到 public/vendor/app）
// 注：TerminalPanel 使用自定义卡片式 UI，不依赖 xterm.js，故不需要 xterm.css
import "./theme-tokens.css";
import "./forgekin-persona-tokens.css";
import "./forgekin-persona-derived.css";
import "./console-tokens.css";
import "./console-shell.css";
import "./console-controls.css";
import "./connector-tokens.css";
import "./theme-extras.css";

import { ShellConfigProvider } from "@/lib/shell-config";
import ShellWrapper from "@/components/ShellWrapper";
import { ShellConfig } from "@/lib/types";
import { SessionBootstrap } from "@/components/SessionBootstrap";
import { ForgekinHueInjector } from "@/components/ForgekinHueInjector";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeApplier } from "@/components/ThemeApplier";
import { ConfirmProvider } from "@/components/useConfirm";
import { BrakeModal } from "@/components/BrakeModal";
import { GuideOverlay } from "@/components/GuideOverlay";
import { ToastContainer } from "@/components/ToastContainer";

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
    // 注：原"工作"分组（Helm Studio / 群聊工作室）已移到 ActivityBar 作为独立小图标入口
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning style={{ height: "100%" }}>
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

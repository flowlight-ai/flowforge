import type { Metadata } from "next";
import "./globals.css";
import { ShellConfigProvider } from "@/lib/shell-config";
import ShellWrapper from "@/components/ShellWrapper";
import { ShellConfig } from "@/lib/types";

const shellConfig: ShellConfig = {
  brandName: "FlowForge",
  brandShort: "FF",
  brandColor: "#ff5c5c",
  brandSubtitle: "AI Agent OS",
  version: "v0.1.0",
  helmPaths: ["/helm"],
  navSections: [
    {
      label: "主页",
      items: [{ href: "/", label: "仪表盘", icon: "◫" }],
    },
    {
      label: "任务",
      items: [
        { href: "/tasks", label: "任务列表", icon: "☰" },
        { href: "/review", label: "审核中心", icon: "✓" },
      ],
    },
    {
      label: "Helm",
      items: [{ href: "/helm", label: "Helm Studio", icon: "⚡" }],
    },
    {
      label: "管理",
      items: [
        { href: "/admin/models", label: "模型配置", icon: "⚙" },
        { href: "/admin/settings", label: "系统设置", icon: "🔧" },
        { href: "/logs", label: "日志", icon: "ⓘ" },
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
    <html lang="zh-CN" style={{ height: "100%" }}>
      <body style={{ height: "100%", margin: 0 }}>
        <ShellConfigProvider config={shellConfig}>
          <ShellWrapper>{children}</ShellWrapper>
        </ShellConfigProvider>
      </body>
    </html>
  );
}

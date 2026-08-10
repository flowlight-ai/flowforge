"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useShellConfig } from "../lib/shell-config";
import { ActivityBar } from "./ActivityBar";
import { TopBar } from "./TopBar";
import { ConciergeHost } from "./concierge/ConciergeHost";
import { FloatingPresentationSurfaceHost } from "./workspace/FloatingPresentationSurfaceHost";
import { ApprovalHubDrawer } from "./ApprovalHubDrawer";
import GlobalThreadDrawer from "./GlobalThreadDrawer";

// 与 clowder-ai 一致：展示页无 Shell
const CHROMELESS_ROUTES: string[] = [];

interface ShellWrapperProps {
  children: React.ReactNode;
}

export default function ShellWrapper({ children }: ShellWrapperProps) {
  const pathname = usePathname();
  const config = useShellConfig();

  const isChromeless = (config.chromelessPaths ?? CHROMELESS_ROUTES).some((p) =>
    pathname.startsWith(p),
  );

  if (isChromeless) {
    return <>{children}</>;
  }

  // ThreadSidebar 已移除：导航功能由 ActivityBar（52px 图标栏）承担，
  // 管理类页面（仪表盘/管理中心/智能体/可观测性）入口统一放在 ActivityBar + /admin 管理中心。
  // 不再有独立的左侧导航栏，避免与系统设置重复并在对话/群聊时误展示。
  return (
    <div
      className="console-shell flex h-screen h-dvh overflow-hidden"
      data-shell="wrapper"
    >
      <Suspense
        fallback={<div className="w-[52px] flex-shrink-0" aria-hidden="true" />}
      >
        <ActivityBar />
      </Suspense>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main
          className="flex-1 overflow-y-auto overflow-x-hidden"
          data-shell="main"
        >
          {children}
        </main>
      </div>

      <FloatingPresentationSurfaceHost />
      <ConciergeHost />
      <ApprovalHubDrawer />
      <GlobalThreadDrawer />
    </div>
  );
}

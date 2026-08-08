"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useSidebarStore } from "@/stores/sidebarStore";
import { useShellConfig } from "../lib/shell-config";
import { ActivityBar } from "./ActivityBar";
import { ThreadSidebar } from "./ThreadSidebar";
import { TopBar } from "./TopBar";
import { ConciergeHost } from "./concierge/ConciergeHost";
import { FloatingPresentationSurfaceHost } from "./workspace/FloatingPresentationSurfaceHost";
import { ApprovalHubDrawer } from "./ApprovalHubDrawer";
import { ResizeHandle } from "./workspace/ResizeHandle";

// 与 clowder-ai 一致：展示页无 Shell
const CHROMELESS_ROUTES: string[] = [];

// 与 clowder-ai 一致：这些路由隐藏 ThreadSidebar（因为有自带侧边栏）
const SIDEBAR_HIDDEN_ROUTES = [
  "/admin/settings",
  "/admin/marketplace",
  "/signals",
  "/memory",
  "/mission",
];

interface ShellWrapperProps {
  children: React.ReactNode;
  /** 可选：自定义侧边栏内容（不传则使用默认 ThreadSidebar） */
  sidebar?: React.ReactNode;
}

export default function ShellWrapper({ children, sidebar }: ShellWrapperProps) {
  const pathname = usePathname();
  const config = useShellConfig();
  const isOpen = useSidebarStore((s) => s.isOpen);
  const width = useSidebarStore((s) => s.width);
  const close = useSidebarStore((s) => s.close);
  const handleResize = useSidebarStore((s) => s.handleResize);
  const resetWidth = useSidebarStore((s) => s.resetWidth);
  const isDesktop = useIsDesktop();

  const isChromeless = (config.chromelessPaths ?? CHROMELESS_ROUTES).some((p) =>
    pathname.startsWith(p),
  );

  if (isChromeless) {
    return <>{children}</>;
  }

  const showSidebar =
    isOpen &&
    isDesktop &&
    !SIDEBAR_HIDDEN_ROUTES.some((r) => pathname.startsWith(r));

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

      {showSidebar && (
        <div className="flex items-stretch flex-shrink-0">
          <div style={{ width }} className="flex-shrink-0">
            {sidebar ?? <ThreadSidebar onClose={close} className="w-full" />}
          </div>
          <ResizeHandle
            direction="horizontal"
            label="左侧对话栏"
            onResize={handleResize}
            onCollapse={close}
            onDoubleClick={resetWidth}
            showLine={false}
          />
        </div>
      )}

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
    </div>
  );
}

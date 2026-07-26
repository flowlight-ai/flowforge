"use client";

/**
 * TopBar — 全局顶栏（52px）
 *
 * 来源：新建（依据 WEB-FUSION-DESIGN.md §4.2）
 *
 * 职责：
 *   - 左侧：品牌名 + 当前路径面包屑
 *   - 右侧：版本号 + 系统状态指示器
 *
 * 命名规范：使用 P0 命名 "FlowForge" / "AI Agent OS"
 */

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useShellConfig } from "@/lib/shell-config";

interface TopBarProps {
  className?: string;
}

interface Crumb {
  label: string;
  href?: string;
}

const ROUTE_LABELS: Record<string, string> = {
  "": "仪表盘",
  solo: "Helm Studio",
  council: "群聊",
  tasks: "任务列表",
  review: "审核中心",
  memory: "记忆中心",
  "mission-hub": "Mission Hub",
  signals: "信号",
  admin: "管理中心",
  agents: "智能体",
  models: "Provider",
  settings: "设置中心",
  observability: "可观测性",
};

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: "FlowForge", href: "/" }];
  if (segments.length === 0) {
    crumbs.push({ label: "仪表盘" });
    return crumbs;
  }
  let acc = "";
  for (const seg of segments) {
    acc += `/${seg}`;
    const label = ROUTE_LABELS[seg] ?? seg;
    crumbs.push({ label, href: acc });
  }
  return crumbs;
}

export function TopBar({ className }: TopBarProps) {
  const pathname = usePathname() ?? "/";
  const config = useShellConfig();
  const crumbs = buildCrumbs(pathname);
  const [backendStatus, setBackendStatus] = useState<"online" | "offline" | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    const checkHealth = async () => {
      try {
        const r = await fetch("/api/v1/health", { cache: "no-store" });
        if (cancelled) return;
        setBackendStatus(r.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setBackendStatus("offline");
      }
    };
    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const statusColor =
    backendStatus === "online"
      ? "var(--semantic-success,#22c55e)"
      : backendStatus === "offline"
        ? "var(--semantic-critical,#ef4444)"
        : "var(--semantic-warning,#f59e0b)";

  const statusLabel =
    backendStatus === "online" ? "在线" : backendStatus === "offline" ? "离线" : "检查中";

  return (
    <header
      className={`flex items-center gap-3 h-[52px] px-4 border-b border-[var(--cafe-border-subtle,#2a2c3a)] bg-[var(--cafe-surface,#1e1f26)] ${className ?? ""}`}
      data-top-bar="root"
    >
      <div
        className="flex items-center gap-2 text-sm font-bold"
        style={{ color: config.brandColor, letterSpacing: "1px" }}
      >
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold text-white"
          style={{ background: config.brandColor }}
        >
          {config.brandShort}
        </span>
        <span>{config.brandName}</span>
      </div>

      <nav className="flex items-center gap-1.5 text-xs" aria-label="面包屑">
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[var(--cafe-text-muted,#6b7280)]">/</span>}
            <span
              className={
                i === crumbs.length - 1
                  ? "text-[var(--cafe-text,#e5e7eb)] font-medium"
                  : "text-[var(--cafe-text-secondary,#9ca3af)]"
              }
            >
              {c.label}
            </span>
          </span>
        ))}
      </nav>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
          style={{
            background: `color-mix(in srgb, ${statusColor} 15%, transparent)`,
            color: statusColor,
          }}
          data-topbar-status={backendStatus}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: statusColor }}
          />
          {statusLabel}
        </span>
        <span
          className="px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{
            background: `color-mix(in srgb, ${config.brandColor} 15%, transparent)`,
            color: config.brandColor,
          }}
        >
          {config.brandSubtitle}
        </span>
        <span className="text-xs text-[var(--cafe-text-muted,#6b7280)]">{config.version}</span>
      </div>
    </header>
  );
}

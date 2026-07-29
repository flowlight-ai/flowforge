"use client";

/**
 * HubConfigIcons — 配置图标与平台视觉工具集
 *
 * 移植自 clowder-ai HubConfigIcons，适配 FlowForge 暗色主题。
 * 提供：
 *   - 平台图标构建（buildPlatformVisual）：基于 manifest 的 icon + themeColor
 *   - 通用 SVG 图标组件（ChevronRight/ChevronDown/TrashIcon 等）
 *   - 平台状态类型（PlatformStatus）与状态徽章（connStatePill）
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 var(--cafe-xxx) 与 var(--conn-xxx) CSS 变量。
 */

import { type ReactNode, useState } from "react";

/* ------------------------------------------------------------------ */
/* 平台视觉                                                            */
/* ------------------------------------------------------------------ */

export interface PlatformVisual {
  iconBg: string;
  iconColor: string;
  icon: ReactNode;
}

const SVG_PROPS = {
  fill: "none" as const,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Name-initial text avatar — first character as fallback icon. */
function NameInitial({ name }: { name: string }) {
  return <span className="text-sm font-bold leading-none">{name.charAt(0)}</span>;
}

/**
 * Connector icon with 404 fallback.
 * Uses native <img> instead of next/image — SVG files render correctly
 * and external plugin icons don't need next.config image domain allowlist.
 * On load error, swaps to name-initial text avatar.
 */
function ConnectorIcon({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <NameInitial name={name} />;
  /* eslint-disable-next-line @next/next/no-img-element */
  return (
    <img
      src={src}
      alt=""
      width={18}
      height={18}
      className="object-contain"
      onError={() => setFailed(true)}
    />
  );
}

/** Build visual from manifest icon + themeColor — no per-platform hardcoded map. */
export function buildPlatformVisual(platform: PlatformStatus): PlatformVisual {
  const icon = platform.icon;
  const themeColor = platform.themeColor;

  let iconElement: ReactNode;
  if (icon?.src) {
    iconElement = <ConnectorIcon src={icon.src} name={platform.name} />;
  } else {
    iconElement = <NameInitial name={platform.name} />;
  }

  if (!themeColor) {
    return {
      iconBg: "var(--conn-gray-bg, rgba(107,114,128,0.12))",
      iconColor: "var(--conn-icon-default, #9ca3af)",
      icon: iconElement,
    };
  }
  return {
    iconBg: `color-mix(in srgb, ${themeColor} 12%, transparent)`,
    iconColor: themeColor,
    icon: iconElement,
  };
}

/* ------------------------------------------------------------------ */
/* 通用 SVG 图标                                                       */
/* ------------------------------------------------------------------ */

export function StepBadge({ num }: { num: number }) {
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold flex-shrink-0"
      style={{
        background: "var(--conn-blue-text, #3b82f6)",
        color: "var(--cafe-surface, #1e1f26)",
      }}
    >
      {num}
    </span>
  );
}

export function ChevronRight() {
  return (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" stroke="currentColor" {...SVG_PROPS}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronDown() {
  return (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" stroke="currentColor" {...SVG_PROPS}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" stroke="currentColor" {...SVG_PROPS}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
    </svg>
  );
}

export function ExternalLinkIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" stroke="currentColor" {...SVG_PROPS}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function WifiIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      style={{ color: "var(--cafe-text-secondary, #9ca3af)" }}
      viewBox="0 0 24 24"
      stroke="currentColor"
      {...SVG_PROPS}
    >
      <path d="M5 13a10 10 0 0 1 14 0" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M2 8.82a15 15 0 0 1 20 0" />
      <line x1="12" x2="12.01" y1="20" y2="20" />
    </svg>
  );
}

export function TriangleAlertIcon() {
  return (
    <svg
      className="w-4 h-4 flex-shrink-0"
      style={{ color: "var(--conn-amber-text, #f59e0b)" }}
      viewBox="0 0 24 24"
      stroke="currentColor"
      {...SVG_PROPS}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Solid green circle — "configured / connected" status indicator */
export function StatusDotConnected() {
  return (
    <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="5" fill="var(--semantic-success, #22c55e)" />
    </svg>
  );
}

/** Hollow gray circle — "not configured" status indicator */
export function StatusDotIdle() {
  return (
    <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 10 10">
      <circle
        cx="5"
        cy="5"
        r="4"
        fill="none"
        stroke="var(--neutral-400, #9ca3af)"
        strokeWidth="2"
      />
    </svg>
  );
}

/** QR code icon for the "generate QR" button */
export function QrCodeIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" stroke="currentColor" {...SVG_PROPS}>
      <rect width="6" height="6" x="3" y="3" rx="1" />
      <rect width="6" height="6" x="15" y="3" rx="1" />
      <rect width="6" height="6" x="3" y="15" rx="1" />
      <path d="M15 15h2v2" />
      <path d="M21 15h-2v6h6v-2" />
      <path d="M15 21v-2" />
    </svg>
  );
}

/** Spinning loader indicator */
export function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Checkmark circle icon for success states */
export function CheckCircleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" stroke="currentColor" {...SVG_PROPS}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" stroke="currentColor" {...SVG_PROPS}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Connector 配置类型与辅助函数                                         */
/* ------------------------------------------------------------------ */

export interface PlatformFieldStatus {
  envName: string;
  label: string;
  sensitive: boolean;
  /** Field type from manifest. Frontend renders generically based on this. */
  type?: "input" | "select" | "toggle" | "list";
  /** Select options (only for type: select). */
  options?: Array<{ value: string; label: string }>;
  currentValue: string | null;
}

export interface PlatformStepStatus {
  text: string;
  mode?: string;
}

/** Action definition from YAML manifest. */
export interface PlatformActionDef {
  id: string;
  label: string;
  render: string;
  resultRender?: string;
  next?: string;
  rollback?: string;
  timeout?: number;
}

/** Operation definition + runtime state. */
export interface PlatformOperationStatus {
  name: string;
  label: string;
  actions: PlatformActionDef[];
  currentAction?: string;
  lastResult?: { render: string; data: unknown; label?: string };
  updatedAt?: number;
}

export interface PlatformStatus {
  id: string;
  name: string;
  nameEn: string;
  /** 'external' for user-installed connectors. Absent = builtin. */
  source?: "builtin" | "external";
  configured: boolean;
  connectionState?: "connected" | "disconnected" | "reconnecting" | "unknown";
  lastHeartbeat?: number | null;
  fields: PlatformFieldStatus[];
  docsUrl: string;
  steps: PlatformStepStatus[];
  /** Manifest icon. */
  icon?: { type: string; src?: string; iconId?: string };
  /** Theme color from manifest. */
  themeColor?: string;
  /** Operation definitions + state for ActionRenderer. */
  operations?: PlatformOperationStatus[];
  /** Manifest-driven permission label — renders HubPermissionsTab when present. */
  permissionLabel?: string;
  /** YAML-declared health-check — controls test button visibility. */
  testable?: boolean;
}

/** 平台连接状态徽章 */
export function connStatePill(p: PlatformStatus): { label: string; className: string } {
  if (p.connectionState === "connected") {
    return {
      label: "已连接",
      className: "bg-[var(--conn-emerald-bg,rgba(16,185,129,0.15))] text-[var(--conn-emerald-text,#10b981)]",
    };
  }
  if (p.connectionState === "reconnecting") {
    return {
      label: "重连中",
      className: "bg-[var(--conn-amber-bg,rgba(245,158,11,0.15))] text-[var(--conn-amber-text,#f59e0b)]",
    };
  }
  if (p.connectionState === "disconnected" && p.configured) {
    return {
      label: "已配置",
      className: "bg-[var(--conn-amber-bg,rgba(245,158,11,0.15))] text-[var(--conn-amber-text,#f59e0b)]",
    };
  }
  if (p.configured) {
    return {
      label: "已配置",
      className: "bg-[var(--conn-amber-bg,rgba(245,158,11,0.15))] text-[var(--conn-amber-text,#f59e0b)]",
    };
  }
  return {
    label: "未配置",
    className:
      "bg-[var(--cafe-surface-sunken,#0f1015)] text-[var(--cafe-text-muted,#6b7280)]",
  };
}

/** 格式化心跳时间戳为相对时间 */
export function formatHeartbeat(ts: number): string {
  const ago = Math.floor((Date.now() - ts) / 1000);
  if (ago < 60) return `${ago}s ago`;
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
  return `${Math.floor(ago / 3600)}h ago`;
}

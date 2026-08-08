"use client";

/**
 * SystemNoticeBar — 系统通知栏
 *
 * 在 TopBar 内显示系统级公告/维护通知；用户可关闭单条通知。
 * 移植自 clowder-ai SystemNoticeBar，简化为受控组件。
 *
 * API：GET /api/v1/system/notices
 */

import { useCallback, useEffect, useState } from "react";

export interface SystemNotice {
  readonly id: string;
  readonly level: "info" | "warn" | "danger";
  readonly message: string;
  readonly actionUrl?: string;
  readonly actionLabel?: string;
}

interface SystemNoticeBarProps {
  readonly notices?: SystemNotice[];
  readonly onDismiss?: (id: string) => void;
}

const LEVEL_STYLE: Record<SystemNotice["level"], React.CSSProperties> = {
  info: { background: "color-mix(in srgb, var(--info) 14%, var(--bg-elevated))", color: "var(--info)", border: "1px solid color-mix(in srgb, var(--info) 40%, transparent)" },
  warn: { background: "var(--warn-subtle)", color: "var(--warn)", border: "1px solid color-mix(in srgb, var(--warn) 40%, transparent)" },
  danger: { background: "var(--danger-subtle)", color: "var(--danger)", border: "1px solid color-mix(in srgb, var(--danger) 40%, transparent)" },
};

export function SystemNoticeBar({ notices: propNotices, onDismiss }: SystemNoticeBarProps) {
  const [notices, setNotices] = useState<SystemNotice[]>(propNotices ?? []);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (propNotices) return;
    try {
      const res = await fetch("/api/v1/system/notices");
      if (!res.ok) return;
      const data = await res.json();
      const list: SystemNotice[] = data?.items ?? data?.notices ?? [];
      setNotices(list);
    } catch {
      // 静默忽略：通知加载失败不应阻塞用户
    }
  }, [propNotices]);

  useEffect(() => {
    if (propNotices) {
      setNotices(propNotices);
      return;
    }
    void load();
  }, [propNotices, load]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    onDismiss?.(id);
  }, [onDismiss]);

  const visible = notices.filter((n) => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  return (
    <div data-notice="bar" style={{ display: "flex", flexDirection: "column", gap: "4px", width: "100%" }}>
      {visible.map((notice) => (
        <div
          key={notice.id}
          data-notice="item"
          data-notice-id={notice.id}
          data-notice-level={notice.level}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 12px",
            borderRadius: "var(--radius-sm)",
            fontSize: "12px",
            ...LEVEL_STYLE[notice.level],
          }}
        >
          <span aria-hidden style={{ fontWeight: 700 }}>
            {notice.level === "danger" ? "✕" : notice.level === "warn" ? "!" : "i"}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>{notice.message}</span>
          {notice.actionUrl && notice.actionLabel && (
            <a
              href={notice.actionUrl}
              data-notice-action="link"
              style={{
                color: "inherit",
                fontSize: "12px",
                fontWeight: 700,
                textDecoration: "underline",
                whiteSpace: "nowrap",
              }}
            >
              {notice.actionLabel}
            </a>
          )}
          <button
            onClick={() => dismiss(notice.id)}
            data-notice-action="dismiss"
            aria-label="关闭通知"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontSize: "14px",
              padding: "0 4px",
              opacity: 0.7,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

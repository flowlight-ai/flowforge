"use client";

/**
 * ConnectionStatusBar — 连接状态栏
 *
 * 显示前后端 / LLM / 工具链的连接状态（在线/降级/离线）。
 * 移植自 clowder-ai ConnectionStatusBar，简化为紧凑状态条。
 *
 * API：GET /api/v1/system/connections
 */

import { useCallback, useEffect, useState } from "react";

export type ConnState = "online" | "degraded" | "offline";

interface ConnectionEntry {
  readonly id: string;
  readonly label: string;
  readonly state: ConnState;
  readonly latencyMs?: number;
  readonly lastCheckedAt?: string;
}

const STATE_STYLE: Record<ConnState, React.CSSProperties> = {
  online: { color: "var(--ok)" },
  degraded: { color: "var(--warn)" },
  offline: { color: "var(--danger)" },
};

const STATE_DOT: Record<ConnState, string> = {
  online: "var(--ok)",
  degraded: "var(--warn)",
  offline: "var(--danger)",
};

const STATE_LABEL: Record<ConnState, string> = {
  online: "在线",
  degraded: "降级",
  offline: "离线",
};

interface ConnectionStatusBarProps {
  readonly entries?: ConnectionEntry[];
  readonly compact?: boolean;
  readonly pollIntervalMs?: number;
}

export function ConnectionStatusBar({ entries: propEntries, compact = false, pollIntervalMs = 30_000 }: ConnectionStatusBarProps) {
  const [entries, setEntries] = useState<ConnectionEntry[]>(propEntries ?? []);
  const [loading, setLoading] = useState(!propEntries);

  const load = useCallback(async () => {
    if (propEntries) {
      setEntries(propEntries);
      return;
    }
    try {
      const res = await fetch("/api/v1/system/connections");
      if (!res.ok) return;
      const data = await res.json();
      const list: ConnectionEntry[] = data?.items ?? data?.connections ?? [];
      setEntries(list);
    } catch {
      // 静默忽略
    } finally {
      setLoading(false);
    }
  }, [propEntries]);

  useEffect(() => {
    void load();
    if (propEntries) return;
    const timer = setInterval(() => void load(), pollIntervalMs);
    return () => clearInterval(timer);
  }, [load, propEntries, pollIntervalMs]);

  if (loading && !propEntries) {
    return (
      <div data-conn="bar" data-conn-loading style={{ fontSize: "11px", color: "var(--muted)" }}>
        检查连接中...
      </div>
    );
  }

  if (entries.length === 0) return null;

  return (
    <div
      data-conn="bar"
      style={{
        display: "flex",
        gap: compact ? "8px" : "12px",
        alignItems: "center",
        fontSize: "11px",
        flexWrap: "wrap",
      }}
    >
      {entries.map((e) => (
        <div
          key={e.id}
          data-conn="item"
          data-conn-id={e.id}
          data-conn-state={e.state}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            color: "var(--muted)",
          }}
          title={e.lastCheckedAt ? `上次检查：${e.lastCheckedAt}` : undefined}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: STATE_DOT[e.state],
              boxShadow: e.state === "online" ? `0 0 6px ${STATE_DOT[e.state]}` : "none",
            }}
          />
          <span style={STATE_STYLE[e.state]}>
            {compact ? e.label.slice(0, 4) : e.label}
            {!compact && e.latencyMs !== undefined && ` · ${e.latencyMs}ms`}
          </span>
          {compact && (
            <span style={STATE_STYLE[e.state]}>{STATE_LABEL[e.state]}</span>
          )}
        </div>
      ))}
    </div>
  );
}

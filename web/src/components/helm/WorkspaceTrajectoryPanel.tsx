"use client";

/**
 * WorkspaceTrajectoryPanel — 轨迹面板
 *
 * 三源收敛时间轴 + 13 种 kind 视觉样式
 * 对应 clowder-ai 的 trajectory 模块
 */

import { useState, useEffect } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

type TrajectoryKind =
  | "tool_call"
  | "tool_result"
  | "llm_call"
  | "llm_stream"
  | "reasoning"
  | "task_create"
  | "task_complete"
  | "task_error"
  | "stage_enter"
  | "draft_update"
  | "gate_verdict"
  | "approval"
  | "system";

type TrajectorySource = "agent" | "user" | "system";

interface TrajectoryEvent {
  id: string;
  kind: TrajectoryKind;
  source: TrajectorySource;
  summary: string;
  detail?: string;
  timestamp: string;
  durationMs?: number;
  agent?: string;
  metadata?: Record<string, unknown>;
}

// ── 13 种 kind 视觉样式 ───────────────────────────────────────────

const KIND_STYLES: Record<TrajectoryKind, { icon: string; color: string; label: string }> = {
  tool_call: { icon: "🔧", color: "var(--chart-1)", label: "工具调用" },
  tool_result: { icon: "✓", color: "var(--chart-2)", label: "工具结果" },
  llm_call: { icon: "🧠", color: "var(--chart-3)", label: "LLM 调用" },
  llm_stream: { icon: "💬", color: "var(--chart-4)", label: "LLM 流" },
  reasoning: { icon: "💭", color: "var(--chart-5)", label: "推理" },
  task_create: { icon: "➕", color: "var(--chart-6)", label: "任务创建" },
  task_complete: { icon: "✅", color: "var(--ok)", label: "任务完成" },
  task_error: { icon: "❌", color: "var(--destructive)", label: "任务错误" },
  stage_enter: { icon: "▶", color: "var(--info)", label: "阶段进入" },
  draft_update: { icon: "📝", color: "var(--warn)", label: "草稿更新" },
  gate_verdict: { icon: "⚖️", color: "var(--accent)", label: "门控裁决" },
  approval: { icon: "🔐", color: "var(--chart-8)", label: "审批" },
  system: { icon: "⚙", color: "var(--muted)", label: "系统" },
};

// ── 轨迹事件项 ─────────────────────────────────────────────────────

function TrajectoryEventItem({ event }: { event: TrajectoryEvent }) {
  const style = KIND_STYLES[event.kind] || KIND_STYLES.system;
  const time = new Date(event.timestamp).toLocaleTimeString("zh-CN");

  return (
    <div
      style={{
        display: "flex",
        gap: "10px",
        padding: "6px 12px",
        borderLeft: `2px solid ${style.color}20`,
        marginLeft: "12px",
        position: "relative",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* 时间轴圆点 */}
      <div
        style={{
          position: "absolute",
          left: "-7px",
          top: "8px",
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          background: style.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "6px",
          color: "#fff",
          border: "2px solid var(--bg-elevated)",
        }}
      />

      {/* 图标 */}
      <div
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "var(--radius-sm, 4px)",
          background: `${style.color}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "12px",
          flexShrink: 0,
          marginTop: "2px",
        }}
      >
        {style.icon}
      </div>

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)" }}>
            {event.summary}
          </span>
          <span
            style={{
              padding: "1px 5px",
              borderRadius: "3px",
              fontSize: "9px",
              fontWeight: 600,
              background: `${style.color}20`,
              color: style.color,
            }}
          >
            {style.label}
          </span>
          {event.agent && (
            <span style={{ fontSize: "10px", color: "var(--accent)" }}>
              @{event.agent}
            </span>
          )}
        </div>

        {event.detail && (
          <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", lineHeight: 1.4 }}>
            {event.detail}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
          <span>{time}</span>
          {event.durationMs !== undefined && (
            <span style={{ fontFamily: "var(--mono)" }}>
              耗时: {event.durationMs < 1000 ? `${event.durationMs}ms` : `${(event.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
          <span style={{ color: event.source === "agent" ? "var(--accent)" : event.source === "user" ? "var(--info)" : "var(--muted)" }}>
            {event.source === "agent" ? "智能体" : event.source === "user" ? "用户" : "系统"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface TrajectoryPanelProps {
  threadId?: string | null;
}

export default function WorkspaceTrajectoryPanel({ threadId }: TrajectoryPanelProps) {
  const [events, setEvents] = useState<TrajectoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<TrajectoryKind | "all">("all");

  useEffect(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (threadId) params.set("threadId", threadId);

    fetch(`/api/v1/trajectory/events?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.items) setEvents(data.items);
        else if (Array.isArray(data)) setEvents(data);
        else setEvents([]);
      })
      .catch(() => setError("无法加载轨迹数据"))
      .finally(() => setLoading(false));
  }, [threadId]);

  const filtered = filterKind === "all" ? events : events.filter((e) => e.kind === filterKind);

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载轨迹数据...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--destructive)", fontSize: "12px" }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px" }}>⟿</span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>执行轨迹</span>
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>({events.length})</span>
        </div>
      </div>

      {/* Kind 筛选 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "3px",
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
        }}
      >
        <button
          type="button"
          onClick={() => setFilterKind("all")}
          style={{
            padding: "2px 6px",
            borderRadius: "var(--radius-sm, 4px)",
            fontSize: "9px",
            border: filterKind === "all" ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: filterKind === "all" ? "var(--accent-subtle)" : "transparent",
            color: filterKind === "all" ? "var(--accent)" : "var(--muted)",
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          全部
        </button>
        {(Object.entries(KIND_STYLES) as [TrajectoryKind, typeof KIND_STYLES[TrajectoryKind]][]).map(([kind, style]) => (
          <button
            key={kind}
            type="button"
            onClick={() => setFilterKind(kind)}
            style={{
              padding: "2px 6px",
              borderRadius: "var(--radius-sm, 4px)",
              fontSize: "9px",
              border: filterKind === kind ? `1px solid ${style.color}` : "1px solid var(--border)",
              background: filterKind === kind ? `${style.color}20` : "transparent",
              color: filterKind === kind ? style.color : "var(--muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {style.icon} {style.label}
          </button>
        ))}
      </div>

      {/* 时间轴 */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "24px",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: "12px",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>⟿</div>
            <div>暂无轨迹事件</div>
          </div>
        ) : (
          <div>
            {filtered.map((event) => (
              <TrajectoryEventItem key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
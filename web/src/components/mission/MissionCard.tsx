"use client";

/**
 * MissionCard — 任务卡片
 *
 * 展示单条任务的标题、状态、优先级、负责人、进度。
 * 用于 MissionHub 列表视图与 MissionKanban 列单元格。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 */

import Link from "next/link";

export type MissionStatus = "todo" | "doing" | "done" | "blocked" | "cancelled";
export type MissionPriority = "low" | "medium" | "high" | "urgent";

export interface Mission {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status: MissionStatus;
  readonly priority: MissionPriority;
  readonly assignee?: string;
  readonly forgekinId?: string;
  readonly tags?: readonly string[];
  readonly progress: number;
  readonly dueAt?: string;
  readonly updatedAt?: string;
}

const STATUS_STYLE: Record<MissionStatus, React.CSSProperties> = {
  todo: { background: "var(--bg-hover)", color: "var(--muted)" },
  doing: { background: "color-mix(in srgb, var(--info) 18%, transparent)", color: "var(--info)" },
  done: { background: "var(--ok-subtle)", color: "var(--ok)" },
  blocked: { background: "var(--danger-subtle)", color: "var(--danger)" },
  cancelled: { background: "var(--bg-hover)", color: "var(--muted)" },
};

const STATUS_LABEL: Record<MissionStatus, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
  blocked: "阻塞",
  cancelled: "已取消",
};

const PRIORITY_STYLE: Record<MissionPriority, React.CSSProperties> = {
  low: { background: "var(--bg-hover)", color: "var(--muted)" },
  medium: { background: "color-mix(in srgb, var(--info) 18%, transparent)", color: "var(--info)" },
  high: { background: "var(--warn-subtle)", color: "var(--warn)" },
  urgent: { background: "var(--danger-subtle)", color: "var(--danger)" },
};

const PRIORITY_LABEL: Record<MissionPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

interface MissionCardProps {
  readonly mission: Mission;
  readonly onClick?: (id: string) => void;
  readonly draggable?: boolean;
  readonly onDragStart?: (id: string) => void;
}

export function MissionCard({ mission, onClick, draggable = false, onDragStart }: MissionCardProps) {
  const progressColor = mission.progress >= 100 ? "var(--ok)" : mission.progress > 0 ? "var(--accent)" : "var(--muted)";

  const inner = (
    <div
      data-mission="card"
      data-mission-id={mission.id}
      data-mission-status={mission.status}
      draggable={draggable}
      onDragStart={draggable && onDragStart ? () => onDragStart(mission.id) : undefined}
      onClick={onClick ? () => onClick(mission.id) : undefined}
      style={{
        padding: "12px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        cursor: onClick || draggable ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)", flex: 1, minWidth: 0 }}>
          {mission.title}
        </div>
        <span className="pill" style={STATUS_STYLE[mission.status]}>
          {STATUS_LABEL[mission.status]}
        </span>
      </div>

      {mission.description && (
        <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.4 }}>
          {mission.description.length > 80 ? mission.description.slice(0, 79) + "…" : mission.description}
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        <span className="pill" style={PRIORITY_STYLE[mission.priority]}>
          {PRIORITY_LABEL[mission.priority]}
        </span>
        {mission.tags?.map((tag) => (
          <span key={tag} className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)" }}>
            #{tag}
          </span>
        ))}
      </div>

      <div
        data-mission="progress"
        style={{
          height: "4px",
          background: "var(--bg-hover)",
          borderRadius: "2px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, mission.progress))}%`,
            height: "100%",
            background: progressColor,
            transition: "width 0.2s ease",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--muted)" }}>
        <span>
          {mission.assignee ? `@${mission.assignee}` : "未指派"}
          {mission.forgekinId ? ` · ◆${mission.forgekinId.slice(0, 6)}` : ""}
        </span>
        <span>{mission.progress.toFixed(0)}%</span>
      </div>

      {mission.dueAt && (
        <div style={{ fontSize: "11px", color: "var(--warn)" }}>
          截止：{mission.dueAt.slice(0, 19)}
        </div>
      )}
    </div>
  );

  if (onClick) return inner;
  return <Link href={`/mission/${mission.id}`} style={{ textDecoration: "none", color: "inherit" }}>{inner}</Link>;
}

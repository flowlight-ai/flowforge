"use client";

/**
 * HubMemberOverviewCard — 成员概览卡片
 *
 * 用于 /admin/agents，展示可进化智能体的精简状态卡片，常用于列表网格。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 */

interface ForgekinMember {
  id: string;
  name: string;
  nickname?: string;
  species: string;
  role: string;
  model: string;
  status: "active" | "idle" | "archived" | "error";
  awakeningTier: "E1" | "E2" | "E3" | "E4" | "E5";
  taskCount: number;
  qualityScore?: number;
  tags: string[];
  themeColor?: string;
}

interface HubMemberOverviewCardProps {
  member: ForgekinMember;
  onEdit?: (id: string) => void;
  onViewSessions?: (id: string) => void;
}

const STATUS_DOT: Record<ForgekinMember["status"], string> = {
  active: "#22c55e",
  idle: "#9ca3af",
  archived: "#6b7280",
  error: "#ef4444",
};

const TIER_LABELS: Record<ForgekinMember["awakeningTier"], string> = {
  E1: "E1·萌生",
  E2: "E2·觉醒",
  E3: "E3·自主",
  E4: "E4·协同",
  E5: "E5·共创",
};

export function HubMemberOverviewCard({ member, onEdit, onViewSessions }: HubMemberOverviewCardProps) {
  const quality = member.qualityScore !== undefined ? member.qualityScore * 100 : null;
  const passed = quality !== null && quality >= 85;

  return (
    <div
      data-hub-member="root"
      data-hub-member-id={member.id}
      style={{
        padding: "14px",
        borderRadius: "10px",
        background: "var(--bg-elevated,#1e1f26)",
        border: "1px solid var(--border,#2a2c3a)",
        borderLeft: `3px solid ${member.themeColor ?? "var(--accent,#ff5c5c)"}`,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{ width: "8px", height: "8px", borderRadius: "50%", background: STATUS_DOT[member.status], display: "inline-block" }}
              data-hub-member-status={member.status}
            />
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
              {member.name}
            </span>
            {member.nickname && (
              <span style={{ fontSize: "11px", color: "var(--muted,#9ca3af)" }}>({member.nickname})</span>
            )}
          </div>
          <div style={{ fontSize: "11px", color: "var(--muted,#9ca3af)", marginTop: "2px" }}>
            <code style={{ color: "var(--text-secondary,#9ca3af)" }}>{member.species}</code> · {member.role}
          </div>
        </div>
        <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "rgba(99,102,241,0.15)", color: "#a78bfa", fontWeight: 600 }}>
          {TIER_LABELS[member.awakeningTier]}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "11px" }}>
        <div>
          <div style={{ color: "var(--muted,#9ca3af)" }}>模型</div>
          <div style={{ color: "var(--text,#e5e7eb)", fontFamily: "monospace", fontSize: "10px" }}>{member.model}</div>
        </div>
        <div>
          <div style={{ color: "var(--muted,#9ca3af)" }}>任务数</div>
          <div style={{ color: "var(--text,#e5e7eb)", fontWeight: 600 }}>{member.taskCount}</div>
        </div>
        {quality !== null && (
          <div>
            <div style={{ color: "var(--muted,#9ca3af)" }}>质量分</div>
            <div style={{ color: passed ? "#22c55e" : "#eab308", fontWeight: 600 }}>
              {quality.toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      {member.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
          {member.tags.slice(0, 5).map((t) => (
            <span
              key={t}
              data-hub-member-tag={t}
              style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--bg,#15151c)", color: "var(--muted,#9ca3af)" }}
            >
              #{t}
            </span>
          ))}
          {member.tags.length > 5 && (
            <span style={{ fontSize: "10px", color: "var(--muted,#9ca3af)" }}>+{member.tags.length - 5}</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
        {onViewSessions && (
          <button
            type="button"
            onClick={() => onViewSessions(member.id)}
            style={ghostBtn}
            data-hub-member-action="sessions"
          >
            会话
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(member.id)}
            style={primaryBtn}
            data-hub-member-action="edit"
          >
            编辑
          </button>
        )}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  background: "var(--accent,#ff5c5c)",
  color: "#fff",
  border: "none",
  fontSize: "11px",
  fontWeight: 600,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  background: "transparent",
  color: "var(--muted,#9ca3af)",
  border: "1px solid var(--border,#2a2c3a)",
  fontSize: "11px",
  cursor: "pointer",
};

export default HubMemberOverviewCard;
export type { ForgekinMember };

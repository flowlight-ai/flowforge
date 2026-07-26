"use client";

/**
 * SignalCard — 单条信号卡片
 *
 * 展示信号来源、强度、摘要、时间戳、关联锚点。
 * 移植自 clowder-ai SignalCard，简化为只读卡片。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 */

export type SignalSeverity = "info" | "warn" | "danger" | "ok";

export interface Signal {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly title: string;
  readonly summary: string;
  readonly severity: SignalSeverity;
  readonly strength: number;
  readonly observedAt: string;
  readonly anchor?: string;
  readonly tags?: readonly string[];
  readonly read?: boolean;
}

const SEVERITY_STYLE: Record<SignalSeverity, React.CSSProperties> = {
  info: { background: "color-mix(in srgb, var(--info) 18%, transparent)", color: "var(--info)" },
  warn: { background: "var(--warn-subtle)", color: "var(--warn)" },
  danger: { background: "var(--danger-subtle)", color: "var(--danger)" },
  ok: { background: "var(--ok-subtle)", color: "var(--ok)" },
};

const SEVERITY_LABEL: Record<SignalSeverity, string> = {
  info: "信息",
  warn: "关注",
  danger: "异常",
  ok: "正常",
};

interface SignalCardProps {
  readonly signal: Signal;
  readonly onSelect?: (id: string) => void;
  readonly onMarkRead?: (id: string) => void;
}

export function SignalCard({ signal, onSelect, onMarkRead }: SignalCardProps) {
  return (
    <div
      data-signal="card"
      data-signal-id={signal.id}
      data-signal-severity={signal.severity}
      onClick={onSelect ? () => onSelect(signal.id) : undefined}
      style={{
        padding: "12px",
        background: "var(--bg-elevated)",
        border: `1px solid ${signal.read ? "var(--border)" : "color-mix(in srgb, var(--accent) 30%, var(--border))"}`,
        borderLeft: `3px solid ${signal.severity === "info" ? "var(--info)" : signal.severity === "warn" ? "var(--warn)" : signal.severity === "danger" ? "var(--danger)" : "var(--ok)"}`,
        borderRadius: "var(--radius-md)",
        cursor: onSelect ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        opacity: signal.read ? 0.7 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)", flex: 1, minWidth: 0 }}>
          {!signal.read && (
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent)",
                marginRight: 6,
                verticalAlign: "middle",
              }}
            />
          )}
          {signal.title}
        </div>
        <span className="pill" style={SEVERITY_STYLE[signal.severity]}>
          {SEVERITY_LABEL[signal.severity]}
        </span>
      </div>

      <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
        {signal.summary}
      </div>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
        <span className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)" }}>
          {signal.sourceName}
        </span>
        {signal.tags?.map((t) => (
          <span key={t} className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)" }}>
            #{t}
          </span>
        ))}
        <span className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)", fontFamily: "monospace" }}>
          强度 {(signal.strength * 100).toFixed(0)}%
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--muted)" }}>
        <span>
          {signal.observedAt.slice(0, 19)}
          {signal.anchor && <span style={{ fontFamily: "monospace", marginLeft: "8px" }}>{signal.anchor}</span>}
        </span>
        {onMarkRead && !signal.read && (
          <button
            data-signal-action="mark-read"
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(signal.id);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--accent)",
              fontSize: "11px",
              fontWeight: 600,
            }}
          >
            标为已读
          </button>
        )}
      </div>
    </div>
  );
}

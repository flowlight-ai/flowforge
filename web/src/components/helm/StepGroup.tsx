"use client";

import { useState, useEffect, useMemo } from "react";
import { ChatMessage, StepGroupData } from "./helm-types";
import {
  formatDurationMs,
  getToolIcon,
  getToolSummary,
  truncateParams,
  truncateResult,
} from "./helm-utils";
import { ApprovalCard } from "./ChatPrimitives";
import LLMCallCard from "./LLMCallCard";

// ─── Compact tool card ───
function ToolCardCompact({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = msg.content || msg.data?.tool_name || "工具";
  const durationMs = msg.data?.duration_ms || null;
  const params = msg.data?.params || msg.data?.input || msg.data?.arguments || null;
  const result = msg.data?.result || msg.data?.output || null;
  const error = msg.data?.error || null;

  return (
    <div className="helm-tool-compact" onClick={() => setExpanded(!expanded)}>
      <span className="helm-tool-compact-icon">{getToolIcon(toolName)}</span>
      <span className="helm-tool-compact-name">{toolName}</span>
      <span className="helm-tool-compact-detail">{getToolSummary(msg.data || {})}</span>
      {durationMs != null && <span className="helm-step-duration">{formatDurationMs(durationMs)}</span>}
      {expanded && (
        <div className="helm-tool-card-detail" style={{ position: "absolute", left: 0, marginTop: 8 }}>
          {params && (
            <div className="helm-tool-detail-section">
              <div className="helm-tool-detail-label">参数</div>
              <pre className="helm-tool-detail-pre">{truncateParams(params, 300)}</pre>
            </div>
          )}
          {result && !error && (
            <div className="helm-tool-detail-section">
              <div className="helm-tool-detail-label">输出</div>
              <pre className="helm-tool-detail-pre">{truncateResult(result, 500)}</pre>
            </div>
          )}
          {error && (
            <div className="helm-tool-detail-section">
              <div className="helm-tool-detail-label" style={{ color: "var(--danger)" }}>错误</div>
              <pre className="helm-tool-detail-pre" style={{ color: "var(--danger-muted)" }}>{error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step header status icon ───
function StatusIcon({ status }: { status: string }) {
  const style: React.CSSProperties = { fontSize: 12, flexShrink: 0 };
  if (status === "running") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}>
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (status === "completed") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

// ─── StepGroup ───
export default function StepGroup({
  group, isLastActive, onApprovalAction,
}: {
  group: StepGroupData;
  isLastActive: boolean;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (isLastActive && group.status === "running") setCollapsed(false);
  }, [isLastActive, group.status]);

  const statusClass = group.status === "completed" ? "completed" : group.status === "error" ? "error" : "running";

  // Categorize entries
  const aiMessages = useMemo(
    () => group.entries.filter((m) => m.role === "ai"),
    [group.entries]
  );
  const nonAiEntries = useMemo(
    () => group.entries.filter((m) => m.role !== "ai"),
    [group.entries]
  );

  // Status border color
  const borderColor =
    statusClass === "completed" ? "var(--ok)"
    : statusClass === "error" ? "var(--destructive)"
    : "var(--accent)";

  return (
    <div style={{ marginBottom: 1, marginLeft: 8, marginRight: 8, borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      {/* Minimal step header — Dify style */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 12px", cursor: "pointer", userSelect: "none",
          borderLeft: `3px solid ${borderColor}`,
          background: "var(--bg)",
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        {/* Chevron toggle */}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.2s var(--ease-out)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>

        {/* Status icon */}
        <StatusIcon status={statusClass} />

        {/* Step label */}
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-strong)", flex: 1 }}>
          {group.stepLabel}
        </span>

        {/* Duration */}
        {group.durationMs != null && group.durationMs > 0 && (
          <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            {formatDurationMs(group.durationMs)}
          </span>
        )}
      </div>

      {/* Entry body */}
      {!collapsed && (
        <div style={{ paddingLeft: 28, paddingRight: 12, paddingBottom: 12, paddingTop: 4 }}>
          {/* AI messages */}
          {aiMessages.map((msg) => (
            <div key={msg.id} className="helm-step-entry">
              <LLMCallCard
                msg={msg}
                thinkingContent={msg.data?._thinking_content || ""}
              />
            </div>
          ))}

          {/* Non-AI entries */}
          {nonAiEntries.map((msg) => {
            if (msg.role === "tool") {
              return (
                <div key={msg.id} className="helm-step-entry">
                  <ToolCardCompact msg={msg} />
                </div>
              );
            }
            if (msg.role === "system") {
              const isSuccess = msg.content?.startsWith("✓");
              return (
                <div key={msg.id} className="helm-step-entry">
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    fontSize: 12, fontWeight: 600, padding: "4px 0",
                    color: isSuccess ? "var(--ok)" : "var(--destructive)",
                  }}>
                    {msg.content}
                  </div>
                </div>
              );
            }
            if (msg.role === "gate") {
              const passed = msg.data?.is_passed;
              return (
                <div key={msg.id} className="helm-step-entry">
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 10px", borderRadius: "var(--radius-full)",
                    fontSize: 11, fontWeight: 600,
                    color: passed ? "var(--ok)" : "var(--destructive)",
                    background: passed
                      ? "color-mix(in srgb, var(--ok) 12%, transparent)"
                      : "color-mix(in srgb, var(--destructive) 12%, transparent)",
                  }}>
                    {passed ? "✓" : "✗"} {msg.data?.gate_id || "Gate"}
                    {msg.data?.score != null && (
                      <span style={{ fontSize: 10, opacity: 0.6, fontFamily: "var(--mono)", marginLeft: 4 }}>
                        {msg.data.score}
                      </span>
                    )}
                  </span>
                </div>
              );
            }
            if (msg.role === "review") {
              return (
                <div key={msg.id} className="helm-step-entry">
                  <div style={{
                    borderRadius: "var(--radius-lg)", border: "1px solid var(--warn)",
                    background: "color-mix(in srgb, var(--warn) 8%, var(--bg-elevated))",
                    padding: "8px 12px", color: "var(--warn)",
                    fontSize: 12, fontWeight: 600,
                  }}>
                    ⏸ 审核节点: {msg.content}
                  </div>
                </div>
              );
            }
            if (msg.role === "approval") {
              return (
                <div key={msg.id} className="helm-step-entry">
                  <ApprovalCard messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />
                </div>
              );
            }
            // fallback
            return (
              <div key={msg.id} className="helm-step-entry">
                <div style={{
                  background: "var(--bg-elevated)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)", padding: "8px 12px",
                  animation: "fadeIn 0.2s var(--ease-out)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase",
                      letterSpacing: "0.05em", padding: "2px 6px", borderRadius: "var(--radius-full)",
                      background: "var(--bg-hover)",
                    }}>
                      {msg.role}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
                    </span>
                  </div>
                  {msg.content && (
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text)" }}>{msg.content}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
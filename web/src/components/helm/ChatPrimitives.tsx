"use client";

import { useState, useCallback, useRef } from "react";
import { ChatMessage } from "./helm-types";
import {
  AGENT_COLORS,
  MODE_STYLES,
  hashString,
  getAgentColor,
  getAgentInitials,
  getModeStyle,
} from "./helm-utils";
import { Command, COMMAND_GROUPS } from "./commands";

export function AgentAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const color = getAgentColor(name);
  const initials = getAgentInitials(name);

  return (
    <div
      className="helm-agent-avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${color}, ${color}dd)`,
        fontSize: size < 24 ? "9px" : "11px",
      }}
    >
      {initials}
    </div>
  );
}

export function ModeBadge({ mode }: { mode?: string }) {
  const style = getModeStyle(mode);
  return (
    <span
      className="helm-mode-badge"
      style={{ color: style.color, background: style.bg }}
    >
      {style.label}
    </span>
  );
}

export function ResizeHandle({ onResize }: { onResize: (deltaX: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      onResize(ev.clientX - lastX.current);
      lastX.current = ev.clientX;
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [onResize]);
  return <div className="resize-handle" onMouseDown={onMouseDown} />;
}

export function CommandDropdown({ commands, onSelect, activeIndex }: { commands: Command[]; onSelect: (cmd: string) => void; activeIndex: number; }) {
  if (commands.length === 0) return null;
  // Group commands by group field, preserving order of first appearance
  const groupOrder: string[] = [];
  const grouped: Record<string, Command[]> = {};
  for (const cmd of commands) {
    if (!grouped[cmd.group]) {
      grouped[cmd.group] = [];
      groupOrder.push(cmd.group);
    }
    grouped[cmd.group].push(cmd);
  }
  // Build a flat index map so activeIndex works across groups
  let flatIndex = 0;
  return (
    <div className="cmd-dropdown">
      {groupOrder.map((g) => (
        <div key={g}>
          <div className="cmd-group-label">{COMMAND_GROUPS[g] || g}</div>
          {grouped[g].map((c) => {
            const idx = flatIndex++;
            return (
              <div
                key={c.id}
                className={`cmd-option${idx === activeIndex ? " cmd-option-active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); onSelect(c.id); }}
              >
                <span className="cmd-option-icon">{c.icon || ""}</span>
                <span className="cmd-option-cmd">{c.label}</span>
                <span className="cmd-option-desc">{c.description}</span>
                {c.shortcut && <span className="cmd-option-shortcut">{c.shortcut}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ApprovalCard({ messageId, data, onAction }: { messageId: string; data: Record<string, any>; onAction: (messageId: string, approved: boolean, feedback: string) => void; }) {
  const [feedback, setFeedback] = useState("");
  const [resolved, setResolved] = useState<{ approved: boolean; feedback: string } | null>(null);
  const handleApprove = useCallback(() => { setResolved({ approved: true, feedback }); onAction(messageId, true, feedback); }, [messageId, feedback, onAction]);
  const handleReject = useCallback(() => { setResolved({ approved: false, feedback }); onAction(messageId, false, feedback); }, [messageId, feedback, onAction]);
  const isPermission = data.type === "permission";
  const icon = isPermission ? "🔒" : "⚠";
  const title = isPermission ? "权限申请" : "审批请求";
  const description = data.description || data.reason || data.message || "AI 请求您的确认";
  if (resolved) {
    return <div className="chat-approval-card"><div className={`chat-approval-result ${resolved.approved ? "approved" : "rejected"}`}>{resolved.approved ? "✓ 已批准" : "✗ 已拒绝"}{resolved.feedback && <span className="chat-approval-feedback">: {resolved.feedback}</span>}</div></div>;
  }
  return (
    <div className="chat-approval-card">
      <div className="chat-approval-title">{icon} {title}</div>
      <div className="chat-approval-desc">{description}</div>
      <textarea className="chat-approval-feedback" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="输入反馈（可选）..." />
      <div className="chat-approval-actions">
        <button className="btn btn-success btn-sm" onClick={handleApprove}>✓ 批准</button>
        <button className="btn btn-danger btn-sm" onClick={handleReject}>✗ 拒绝</button>
      </div>
    </div>
  );
}

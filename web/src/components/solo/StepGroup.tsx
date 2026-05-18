"use client";

import { useState, useEffect, useMemo } from "react";
import { ChatMessage, StepGroupData } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";
import { AgentAvatar, ModeBadge, ApprovalCard } from "./ChatPrimitives";
import {
  formatTs,
  formatDurationMs,
  renderMarkdown,
  getToolIcon,
  getToolSummary,
  truncateParams,
  truncateResult,
} from "./solo-utils";
import LLMCallCard from "./LLMCallCard";

function ToolCallCard({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = msg.content || msg.data?.tool_name || "工具";
  const durationMs = msg.data?.duration_ms || null;
  const params = msg.data?.params || msg.data?.input || msg.data?.arguments || null;
  const result = msg.data?.result || msg.data?.output || null;
  const error = msg.data?.error || null;
  const hasError = !!error;

  return (
    <div className={`solo-tool-card ${hasError ? "has-error" : ""}`}>
      <div className="solo-tool-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="solo-tool-icon-wrap">
          <span className="solo-tool-emoji">{getToolIcon(toolName)}</span>
        </span>
        <span className="solo-tool-name">{toolName}</span>
        <span className="solo-tool-summary-inline">{getToolSummary(msg.data || {})}</span>
        {durationMs != null && (
          <span className="solo-tool-duration">{formatDurationMs(durationMs)}</span>
        )}
        <span className="solo-tool-expand-toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="solo-tool-card-detail">
          {params && (
            <div className="solo-tool-detail-section">
              <div className="solo-tool-detail-label">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginRight: 4 }}>
                  <path d="M3 2h6v3H3zM3 7h6v3H3z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                输入
              </div>
              <pre className="solo-tool-detail-pre">{truncateParams(params, 300)}</pre>
            </div>
          )}
          {result && !hasError && (
            <div className="solo-tool-detail-section">
              <div className="solo-tool-detail-label">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginRight: 4 }}>
                  <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                输出
              </div>
              <pre className="solo-tool-detail-pre">{truncateResult(result, 500)}</pre>
            </div>
          )}
          {hasError && (
            <div className="solo-tool-detail-section solo-tool-error-section">
              <div className="solo-tool-detail-label error-label">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginRight: 4 }}>
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M6 4v2M6 7.5v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                错误
              </div>
              <pre className="solo-tool-detail-pre error-pre">{error}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const agentName = msg.data?.agent_name || "AI";
  const content = msg.content || "";

  return (
    <div className="solo-thinking-block">
      <div className="solo-thinking-header" onClick={() => setExpanded(!expanded)}>
        <div className="solo-thinking-icon-wrap">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1a4.5 4.5 0 014.5 4.5c0 1.6-.8 3-2.1 3.8L9 9.8V11H5V9.8l-.4-.5A4.5 4.5 0 017 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M5.5 12.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
        <span className="solo-thinking-label">思考</span>
        <AgentAvatar name={agentName} size={18} />
        <span className="solo-thinking-agent-name">{agentName}</span>
        {!expanded && content && (
          <span className="solo-thinking-preview">{content.slice(0, 80)}{content.length > 80 ? "…" : ""}</span>
        )}
        <span className="solo-thinking-toggle">{expanded ? "收起" : "展开"}</span>
      </div>
      {expanded && content && (
        <div className="solo-thinking-body">
          <div
            className="solo-markdown-bubble thinking-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      )}
    </div>
  );
}

export default function StepGroup({
  group, isLastActive, onApprovalAction,
}: {
  group: StepGroupData;
  isLastActive: boolean;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(!isLastActive);

  useEffect(() => {
    if (isLastActive && group.status === "running") setCollapsed(false);
  }, [isLastActive, group.status]);

  const primaryAgent = useMemo(() => {
    for (const e of group.entries) {
      const name = e.data?._agent_name || e.data?.agent_name;
      if (name) return name;
    }
    return "";
  }, [group.entries]);

  const executionMode = useMemo(() => {
    for (const e of group.entries) {
      const mode = e.data?.mode || e.data?.execution_mode;
      if (mode) return mode;
    }
    return "";
  }, [group.entries]);

  const statusClass = group.status === "completed" ? "completed" : group.status === "error" ? "error" : "running";

  const toolCount = group.entries.filter((e) => e.role === "tool").length;
  const llmCount = group.entries.filter((e) => e.role === "ai" && e.data?._streaming).length;
  const thinkingCount = group.entries.filter((e) => e.role === "ai" && e.data?._thinking).length;

  return (
    <div className={`solo-step ${statusClass}`}>
      <div className="solo-step-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="solo-step-left">
          <span className={`solo-step-toggle ${collapsed ? "collapsed" : ""}`}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="solo-step-status-indicator">
            {statusClass === "completed" && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="rgba(34,197,94,0.15)" stroke="var(--ok)" strokeWidth="1.5" />
                <path d="M5 8l2 2 4-4" stroke="var(--ok)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {statusClass === "running" && <span className="solo-step-spinner" />}
            {statusClass === "error" && (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" fill="rgba(239,68,68,0.15)" stroke="var(--danger)" strokeWidth="1.5" />
                <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </div>
          {primaryAgent && <AgentAvatar name={primaryAgent} size={22} />}
          <span className="solo-step-name">{group.stepLabel}</span>
          {executionMode && <ModeBadge mode={executionMode} />}
        </div>
        <div className="solo-step-right">
          <span className="solo-step-sub-count" title={`${toolCount} 工具 · ${llmCount} LLM · ${thinkingCount} 思考`}>
            {toolCount > 0 && <span className="solo-step-count-chip tool">🔧 {toolCount}</span>}
            {llmCount > 0 && <span className="solo-step-count-chip llm">🤖 {llmCount}</span>}
            {thinkingCount > 0 && <span className="solo-step-count-chip think">💭 {thinkingCount}</span>}
          </span>
          {group.durationMs != null && group.durationMs > 0 && (
            <span className="solo-step-duration">{formatDurationMs(group.durationMs)}</span>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="solo-step-body">
          <div className="solo-step-timeline-line" />
          {group.entries.map((msg, idx) => {
            if (msg.role === "tool") {
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className="solo-step-entry-connector tool-connector" />
                  <ToolCallCard msg={msg} />
                </div>
              );
            }
            if (msg.role === "ai" && msg.data?._thinking) {
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className="solo-step-entry-connector think-connector" />
                  <ThinkingBlock msg={msg} />
                </div>
              );
            }
            if (msg.role === "ai" && msg.data?._streaming) {
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className="solo-step-entry-connector llm-connector" />
                  <LLMCallCard msg={msg} />
                </div>
              );
            }
            if (msg.role === "ai" && msg.data?._draft) {
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className="solo-step-entry-connector ok-connector" />
                  <div className="solo-draft-output">
                    <div className="solo-draft-header">
                      <span className="solo-draft-icon">📝</span>
                      <span className="solo-draft-label">输出</span>
                      {msg.data?._agent_name && <span className="solo-draft-agent">{msg.data._agent_name}</span>}
                    </div>
                    <div className="solo-draft-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                  </div>
                </div>
              );
            }
            if (msg.role === "ai") {
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className="solo-step-entry-connector llm-connector" />
                  <LLMCallCard msg={msg} />
                </div>
              );
            }
            if (msg.role === "system") {
              const isSuccess = msg.content.startsWith("✓");
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className={`solo-step-entry-connector ${isSuccess ? "ok-connector" : "error-connector"}`} />
                  <div className={`solo-system-msg ${isSuccess ? "success" : "error"}`}>
                    <span className="solo-system-icon">{isSuccess ? "✓" : "✗"}</span>
                    {msg.content.replace(/^[✓✗]\s*/, "")}
                    <span className="solo-msg-time">{formatTs(msg.timestamp)}</span>
                  </div>
                </div>
              );
            }
            if (msg.role === "gate") {
              const passed = msg.data?.is_passed;
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className={`solo-step-entry-connector ${passed ? "ok-connector" : "error-connector"}`} />
                  <div className={`solo-gate ${passed ? "passed" : "failed"}`}>
                    {passed ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 6 }}>
                        <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginRight: 6 }}>
                        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    )}
                    <span className="solo-gate-id">{msg.data?.gate_id || "Gate"}</span>
                    {msg.data?.score != null && <span className="solo-gate-score">{msg.data.score}</span>}
                  </div>
                </div>
              );
            }
            if (msg.role === "approval") {
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className="solo-step-entry-connector warn-connector" />
                  <ApprovalCard messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />
                </div>
              );
            }
            if (msg.role === "review") {
              return (
                <div key={msg.id} className="solo-step-entry">
                  <div className="solo-step-entry-connector warn-connector" />
                  <div className="solo-review-card">
                    <div className="solo-review-header">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 8 }}>
                        <path d="M8 2v4M8 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                      审核节点
                    </div>
                    <p className="solo-review-summary">{msg.content}</p>
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

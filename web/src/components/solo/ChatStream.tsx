"use client";

import { useEffect, useRef, useState, useCallback, Fragment } from "react";
import ReactMarkdown from "react-markdown";
import { ChatMessage } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";
import { useShellConfig } from "../../lib/shell-config";
import { formatTs, getToolIcon, getToolSummary, truncateParams, truncateResult, formatDurationMs } from "./solo-utils";
import { ApprovalCard } from "./ChatPrimitives";

// ─── helpers ───
const LONG_CONTENT_THRESHOLD = 500;

function ts2str(ts: number | string): string {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

// ═══════════════════════════════════════════
// Stage Divider — subtle progress indicator
// ═══════════════════════════════════════════
function StageDivider({ label, isRunning, completed }: { label: string; isRunning: boolean; completed: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "5px 16px",
      animation: "fadeIn 0.2s var(--ease-out)",
    }}>
      {/* running spinner or completed check */}
      {isRunning ? (
        <div style={{
          width: 14, height: 14, borderRadius: "50%",
          border: "2px solid var(--border)", borderTopColor: "var(--accent)",
          animation: "spin 0.7s linear infinite", flexShrink: 0,
        }} />
      ) : completed ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--border)", flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 12.5, fontWeight: 600, color: isRunning ? "var(--accent)" : "var(--text)" }}>{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════
// User Bubble — right aligned
// ═══════════════════════════════════════════
function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div style={{
      display: "flex", gap: 10, padding: "6px 16px", justifyContent: "flex-end",
      animation: "fadeIn 0.2s var(--ease-out)",
    }}>
      <div style={{
        maxWidth: "75%", borderRadius: 16, borderBottomRightRadius: 4,
        padding: "10px 16px", background: "var(--accent)",
        color: "#fff", fontSize: 14, lineHeight: 1.55,
      }}>
        {msg.content}
      </div>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", background: "var(--accent)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// AI Bubble — left aligned, with expand for long content
// ═══════════════════════════════════════════
function AIBubble({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const content = msg.content || "";
  const fullContent = (msg.data?._content_full as string) || content;
  const savedToFile = msg.data?._saved_to_file || msg.data?._is_file;
  const isLong = content.length > LONG_CONTENT_THRESHOLD || fullContent.length > LONG_CONTENT_THRESHOLD;
  const displayContent = isLong && !expanded ? content.slice(0, LONG_CONTENT_THRESHOLD) + "..." : (expanded ? fullContent : content);
  const thinking = (msg.data?._thinking_content as string) || "";
  const filePath = (msg.data?.file_path as string) || (msg.data?._file_path as string) || "";
  const fileName = (msg.data?.filename as string) || (msg.data?._file_name as string) || "";

  return (
    <div style={{
      display: "flex", gap: 10, padding: "6px 16px", justifyContent: "flex-start",
      animation: "fadeIn 0.2s var(--ease-out)",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%", background: "var(--accent-subtle)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
        </svg>
      </div>
      <div style={{ maxWidth: "75%", minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginBottom: 4 }}>
          {msg.data?._agent_name || "AI"}
          <span style={{ marginLeft: 8, fontSize: 10, fontFamily: "var(--mono)", opacity: 0.6 }}>
            {formatTs(msg.timestamp)}
          </span>
        </div>

        {/* Thinking section */}
        {thinking && (
          <div style={{
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)", padding: "8px 12px", marginBottom: 6,
            fontSize: 12, color: "var(--muted)", lineHeight: 1.5, whiteSpace: "pre-wrap",
          }}>
            {thinking}
          </div>
        )}

        {/* Content */}
        {displayContent && (
          <div style={{
            borderRadius: 12, borderBottomLeftRadius: 4,
            padding: "10px 16px", background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            fontSize: 14, lineHeight: 1.6, wordBreak: "break-word",
          }}>
            <ReactMarkdown>{displayContent}</ReactMarkdown>
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  marginTop: 6, padding: "3px 10px", border: "none",
                  borderRadius: "var(--radius-full)", cursor: "pointer",
                  background: "var(--accent-subtle)", color: "var(--accent)",
                  fontSize: 12, fontWeight: 500,
                }}
              >
                {expanded ? "收起" : `展开全部 (${content.length} 字)`}
              </button>
            )}
          </div>
        )}

        {/* File reference */}
        {(filePath || savedToFile) && (
          <div style={{
            marginTop: 8, padding: "8px 14px",
            background: "var(--bg)", borderRadius: "var(--radius-md)",
            border: "1px dashed var(--border)", display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
                {fileName || "生成内容文件"}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {filePath || "已保存至工作区"}
              </div>
            </div>
            <button
              onClick={() => {
                // Copy file path or navigate
                if (filePath) window.open(filePath, "_blank");
              }}
              style={{
                padding: "3px 10px", border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", cursor: "pointer",
                background: "var(--bg-elevated)", color: "var(--accent)",
                fontSize: 11, fontWeight: 500,
              }}
            >
              查看
            </button>
          </div>
        )}
        {savedToFile && !filePath && !fileName && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--accent)", cursor: "pointer" }}>
            📄 内容已保存至工作区文件
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// System Banner — subtle status
// ═══════════════════════════════════════════
function SystemBanner({ msg }: { msg: ChatMessage }) {
  const isOk = msg.content.startsWith("✓");
  const color = isOk ? "var(--ok)" : "var(--destructive)";
  return (
    <div style={{
      display: "flex", justifyContent: "center", padding: "2px 16px",
      animation: "fadeIn 0.15s var(--ease-out)",
    }}>
      <span style={{
        fontSize: 11, fontWeight: 600, color,
        padding: "2px 10px", borderRadius: "var(--radius-full)",
        background: isOk
          ? "color-mix(in srgb, var(--ok) 8%, transparent)"
          : "color-mix(in srgb, var(--destructive) 8%, transparent)",
      }}>
        {msg.content}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════
// Tool Card — compact, click-to-expand
// ═══════════════════════════════════════════
function ToolCard({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = msg.content || msg.data?.tool_name || "工具";
  const duration = msg.data?.duration_ms || null;
  const params = msg.data?.params || msg.data?.input || msg.data?.arguments || null;
  const result = msg.data?.result || msg.data?.output || null;
  const error = msg.data?.error || null;

  return (
    <div style={{ padding: "2px 16px", animation: "fadeIn 0.15s var(--ease-out)" }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 12px", borderRadius: "var(--radius-full)",
          background: "color-mix(in srgb, var(--accent) 8%, transparent)",
          border: "1px solid var(--border)", cursor: "pointer",
          fontSize: 12, color: "var(--text)", userSelect: "none",
        }}
      >
        <span>{getToolIcon(toolName)}</span>
        <span style={{ fontWeight: 500 }}>{toolName}</span>
        <span style={{ color: "var(--muted)", fontSize: 11 }}>{getToolSummary(msg.data || {})}</span>
        {duration != null && <span style={{ color: "var(--muted)", fontSize: 10, fontFamily: "var(--mono)" }}>{formatDurationMs(duration)}</span>}
      </div>
      {expanded && (
        <div style={{ marginTop: 6, marginLeft: 4, fontSize: 12 }}>
          {params && <pre style={{ margin: 0, padding: "6px 10px", background: "var(--bg)", borderRadius: "var(--radius-sm)", color: "var(--muted)", overflow: "auto", maxHeight: 120 }}>{truncateParams(params, 300)}</pre>}
          {result && !error && <pre style={{ margin: "4px 0 0", padding: "6px 10px", background: "var(--bg)", borderRadius: "var(--radius-sm)", color: "var(--text)", overflow: "auto", maxHeight: 200 }}>{truncateResult(result, 500)}</pre>}
          {error && <pre style={{ margin: "4px 0 0", padding: "6px 10px", background: "color-mix(in srgb, var(--destructive) 6%, transparent)", borderRadius: "var(--radius-sm)", color: "var(--destructive)", overflow: "auto", maxHeight: 120 }}>{error}</pre>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// Gate Badge
// ═══════════════════════════════════════════
function GateBadge({ msg }: { msg: ChatMessage }) {
  const passed = msg.data?.is_passed;
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2px 16px" }}>
      <span style={{
        fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: "var(--radius-full)",
        color: passed ? "var(--ok)" : "var(--destructive)",
        background: passed
          ? "color-mix(in srgb, var(--ok) 10%, transparent)"
          : "color-mix(in srgb, var(--destructive) 10%, transparent)",
      }}>
        {passed ? "✓" : "✗"} {msg.data?.gate_id || "Gate"}
        {msg.data?.score != null && <span style={{ marginLeft: 6, opacity: 0.6 }}>{msg.data.score}</span>}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════
// Review Banner
// ═══════════════════════════════════════════
function ReviewBanner({ msg }: { msg: ChatMessage }) {
  return (
    <div style={{ padding: "4px 16px" }}>
      <div style={{
        borderRadius: "var(--radius-md)", border: "1.5px solid var(--warn)",
        background: "color-mix(in srgb, var(--warn) 8%, var(--bg-elevated))",
        padding: "8px 14px", color: "var(--warn)", fontSize: 12.5, fontWeight: 600,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>⏸</span>
        <span>审核节点: {msg.content}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// ChatStream — main component (flat timeline)
// ═══════════════════════════════════════════
export default function ChatStream({
  messages, phase, onApprovalAction, interactionMode,
}: {
  messages: ChatMessage[];
  phase: SoloTaskPhase;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
  stageProgress?: { current: number; total: number };
  interactionMode?: "normal" | "solo" | "auto";
  dynNodes?: any; dynEdges?: any; currentStep?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const config = useShellConfig();
  const isActive = phase === "running" || phase === "connecting";

  // Track seen stage labels to show completion on next occurrence
  const stageLabelsRef = useRef<Map<string, { idx: number; completed: boolean }>>(new Map());

  // Auto-scroll
  useEffect(() => {
    if (!userScrolled.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
  }, []);

  // Stage tracking
  stageLabelsRef.current.clear();
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "stage") {
      stageLabelsRef.current.set(m.content, { idx: i, completed: false });
    } else if (m.role === "system" && m.content.startsWith("✓ ")) {
      const label = m.content.slice(2).replace(" 完成", "");
      const entry = stageLabelsRef.current.get(label);
      if (entry) entry.completed = true;
    }
  }

  const isTerminal = phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";

  // Map messages to components
  const renderMessage = useCallback((msg: ChatMessage) => {
    switch (msg.role) {
      case "stage":
        // Skip — stage labels are rendered as dividers below
        return null;
      case "user":
        return <UserBubble key={msg.id} msg={msg} />;
      case "ai":
        return <AIBubble key={msg.id} msg={msg} />;
      case "system": {
        // Skip stage completion messages (rendered as part of divider)
        if (msg.content.startsWith("✓ ") && msg.content.endsWith(" 完成")) return null;
        return <SystemBanner key={msg.id} msg={msg} />;
      }
      case "tool":
        return <ToolCard key={msg.id} msg={msg} />;
      case "gate":
        return <GateBadge key={msg.id} msg={msg} />;
      case "review":
        return <ReviewBanner key={msg.id} msg={msg} />;
      case "approval":
        return <ApprovalCard key={msg.id} messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />;
      default:
        return null;
    }
  }, [onApprovalAction]);

  // Build flat timeline with stage dividers interspersed
  const timeline: React.ReactNode[] = [];
  let lastStage: string | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Detect stage transitions
    if (msg.role === "stage" && msg.content !== lastStage) {
      // Check if this stage is completed
      const info = stageLabelsRef.current.get(msg.content);
      const isRunning = info ? !info.completed && !isTerminal : false;
      const completed = info ? info.completed : false;
      timeline.push(
        <StageDivider key={`stage-${msg.id}`} label={msg.content} isRunning={isRunning} completed={completed} />
      );
      lastStage = msg.content;
    }

    // Render non-stage messages
    const rendered = renderMessage(msg);
    if (rendered) timeline.push(rendered);
  }

  return (
    <div className="chat-stream" ref={containerRef} onScroll={handleScroll} style={{ overflowY: "auto" }}>
      {/* Welcome / empty state */}
      {messages.length === 0 && phase === "idle" && (
        <div className="chat-welcome">
          <div className="chat-welcome-icon">✦</div>
          <h2 className="chat-welcome-title">
            {config.brandName} {interactionMode === "normal" ? "普通" : interactionMode === "auto" ? "全自动" : "Solo"}
          </h2>
          <p className="chat-welcome-desc">
            {interactionMode === "normal"
              ? "描述你的需求，由你主导每一步。AI 严格按指示执行，每步等待你的确认。"
              : interactionMode === "auto"
              ? "描述你的需求，AI 将自主规划并执行全部步骤，无需人工干预。"
              : "描述你的需求，AI 将自主执行任务。你可以随时干预、审核或调整方向。"}
          </p>
          <div className="chat-welcome-cmd-hint">输入 <code>/</code> 查看可用命令</div>
        </div>
      )}

      {/* Loading state */}
      {messages.length === 0 && (phase === "creating" || phase === "connecting") && (
        <div className="chat-welcome">
          <div className="spinner" />
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            {phase === "creating" ? "正在创建任务..." : "正在连接..."}
          </p>
        </div>
      )}

      {/* Timeline */}
      {timeline}

      {/* Active indicator */}
      {isActive && messages.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", color: "var(--muted)" }}>
          <div style={{
            width: 14, height: 14, borderRadius: "50%",
            border: "2px solid var(--muted)", borderTopColor: "transparent",
            animation: "spin 0.8s linear infinite",
          }} />
          <span style={{ fontSize: 12 }}>AI 正在思考...</span>
        </div>
      )}

      {/* Terminal state */}
      {isTerminal && messages.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 16px" }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "4px 12px",
            borderRadius: "var(--radius-full)", background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            color: (() => {
              if (phase === "error" || phase === "interrupted") return "var(--destructive)";
              const hasContent = messages.some((m) => m.role === "ai" && m.content && m.content.length > 10);
              return hasContent ? "var(--ok)" : "var(--destructive)";
            })(),
          }}>
            {(() => {
              if (phase === "error") return "✗ 任务出错";
              if (phase === "interrupted") return "⏻ 任务已中断";
              if (phase === "rejected") return "✗ 任务已拒绝";
              const hasContent = messages.some((m) => m.role === "ai" && m.content && m.content.length > 10);
              return hasContent ? "✓ 任务完成" : "✗ 生成失败：模型返回空内容";
            })()}
          </span>
        </div>
      )}

      {/* Waiting review */}
      {phase === "waiting_review" && (
        <ApprovalCard messageId="review-inline" data={{ type: "review", description: "AI 已完成当前阶段，等待您的审核确认后继续" }} onAction={onApprovalAction} />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
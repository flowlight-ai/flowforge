"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { ChatMessage, StepGroupData } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";
import { useShellConfig } from "../../lib/shell-config";
import {
  formatTs,
  getToolIcon,
  getToolSummary,
  truncateParams,
  truncateResult,
  formatDurationMs,
  renderMarkdown,
  detectFilePaths,
  groupMessagesIntoSteps,
} from "./solo-utils";
import { ApprovalCard } from "./ChatPrimitives";

const LONG_CONTENT_THRESHOLD = 500;

function StepProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min((current / total) * 100, 100) : 0;
  return (
    <div className="trae-progress-bar-wrap">
      <div className="trae-progress-bar-track">
        <div className="trae-progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="trae-progress-bar-label">Step {current}/{total}</span>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running") {
    return (
      <svg className="trae-spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (status === "completed") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="trae-chevron"
      style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function UserBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className="trae-msg-row trae-msg-user">
      <div className="trae-user-bubble">{msg.content}</div>
      <div className="trae-avatar trae-avatar-user">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
    </div>
  );
}

function AIBubble({ msg, onFileOpen }: { msg: ChatMessage; onFileOpen?: (filePath: string, fileName: string) => void }) {
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
    <div className="trae-msg-row trae-msg-ai">
      <div className="trae-avatar trae-avatar-ai">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
        </svg>
      </div>
      <div className="trae-ai-body">
        <div className="trae-ai-meta">
          <span className="trae-ai-name">{msg.data?._agent_name || "AI"}</span>
          <span className="trae-ai-time">{formatTs(msg.timestamp)}</span>
        </div>
        {thinking && (
          <div className="trae-thinking-block">
            {thinking}
          </div>
        )}
        {displayContent && (
          <div className="trae-ai-content">
            <ReactMarkdown>{displayContent}</ReactMarkdown>
            {isLong && (
              <button className="trae-expand-btn" onClick={() => setExpanded(!expanded)}>
                {expanded ? "收起" : `展开全部 (${content.length} 字)`}
              </button>
            )}
          </div>
        )}
        {(filePath || savedToFile) && (
          <div className="trae-file-ref">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <div className="trae-file-info">
              <div className="trae-file-name">{fileName || "生成内容文件"}</div>
              <div className="trae-file-path">{filePath || "已保存至工作区"}</div>
            </div>
            {filePath && (
              <button className="trae-file-view-btn" onClick={() => onFileOpen?.(filePath, fileName || "生成内容文件")}>查看</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemBanner({ msg }: { msg: ChatMessage }) {
  const isOk = msg.content.startsWith("✓");
  return (
    <div className="trae-system-banner">
      <span className={`trae-system-pill ${isOk ? "ok" : "err"}`}>{msg.content}</span>
    </div>
  );
}

function LLMCallInline({ msg }: { msg: ChatMessage }) {
  const model = msg.data?._llm_model || msg.content || "";
  const tokens = msg.data?._llm_tokens || 0;
  const durationMs = msg.data?._llm_duration_ms || null;
  const agent = msg.data?._llm_agent || "";
  const isEnd = msg.data?._llm_is_end || false;
  const inputTokens = msg.data?._llm_input_tokens || msg.data?.prompt_tokens || 0;
  const outputTokens = msg.data?._llm_output_tokens || msg.data?.completion_tokens || 0;

  return (
    <div className={`trae-llm-inline ${isEnd ? "completed" : "running"}`}>
      <span className="trae-llm-inline-icon">🤖</span>
      <span className="trae-llm-inline-model">{model}</span>
      {agent && <span className="trae-llm-inline-agent">{agent}</span>}
      {tokens > 0 && <span className="trae-llm-inline-tokens">{tokens} tokens</span>}
      {inputTokens > 0 && outputTokens > 0 && (
        <span className="trae-llm-inline-token-detail">↑{inputTokens} ↓{outputTokens}</span>
      )}
      {durationMs != null && <span className="trae-llm-inline-duration">{formatDurationMs(durationMs)}</span>}
      {!isEnd && <span className="trae-llm-inline-spinner" />}
    </div>
  );
}

function ToolInline({ msg, onFileOpen }: { msg: ChatMessage; onFileOpen?: (filePath: string, fileName: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = msg.content || msg.data?.tool_name || "工具";
  const duration = msg.data?.duration_ms || null;
  const params = msg.data?.params || msg.data?.input || msg.data?.arguments || null;
  const result = msg.data?.result || msg.data?.output || null;
  const error = msg.data?.error || null;
  const hasError = !!error;
  const resultFilePaths = result ? detectFilePaths(typeof result === "string" ? result : JSON.stringify(result)) : [];

  return (
    <div className="trae-tool-inline">
      <div className="trae-tool-inline-header" onClick={() => setExpanded(!expanded)}>
        <span className="trae-tool-inline-icon">{getToolIcon(toolName)}</span>
        <span className="trae-tool-inline-name">{toolName}</span>
        <span className="trae-tool-inline-summary">{getToolSummary(msg.data || {})}</span>
        {duration != null && <span className="trae-tool-inline-duration">{formatDurationMs(duration)}</span>}
        {hasError && <span className="trae-tool-inline-error-badge">✗</span>}
        <ChevronIcon open={expanded} />
      </div>
      {expanded && (
        <div className="trae-tool-inline-detail">
          {params && <div className="trae-tool-detail-section"><div className="trae-tool-detail-label">参数</div><pre className="trae-detail-pre">{truncateParams(params, 300)}</pre></div>}
          {result && !error && <div className="trae-tool-detail-section"><div className="trae-tool-detail-label">输出</div><pre className="trae-detail-pre trae-detail-result">{truncateResult(result, 500)}</pre></div>}
          {error && <div className="trae-tool-detail-section"><div className="trae-tool-detail-label trae-detail-error-label">错误</div><pre className="trae-detail-pre trae-detail-error">{error}</pre></div>}
          {resultFilePaths.length > 0 && (
            <div className="trae-tool-file-refs">
              {resultFilePaths.map((fp, i) => {
                const filename = fp.path.split(/[/\\]/).pop() || fp.path;
                return (
                  <button key={i} className="trae-tool-file-ref-btn" onClick={(e) => { e.stopPropagation(); onFileOpen?.(fp.path, filename); }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
                    <span>{filename}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GateBadge({ msg }: { msg: ChatMessage }) {
  const passed = msg.data?.is_passed;
  return (
    <div className="trae-system-banner">
      <span className={`trae-system-pill ${passed ? "ok" : "err"}`}>
        {passed ? "✓" : "✗"} {msg.data?.gate_id || "Gate"}
        {msg.data?.score != null && <span style={{ marginLeft: 6, opacity: 0.6 }}>{msg.data.score}</span>}
      </span>
    </div>
  );
}

function ReviewBanner({ msg }: { msg: ChatMessage }) {
  return (
    <div className="trae-review-banner">
      <span>⏸</span>
      <span>审核节点: {msg.content}</span>
    </div>
  );
}

function FileLinkInline({ path, onFileOpen }: { path: string; onFileOpen?: (filePath: string, fileName: string) => void }) {
  const filename = path.split(/[/\\]/).pop() || path;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    py: "🐍", ts: "🔷", tsx: "🔷", js: "🟡", jsx: "🟡", json: "📋",
    md: "📝", yaml: "⚙️", yml: "⚙️", css: "🎨", html: "🌐", sh: "⌨️",
    sql: "🗃️", go: "🔵", rs: "🦀", java: "☕", svg: "🖼️", png: "🖼️",
    jpg: "🖼️", gif: "🖼️",
  };
  const icon = iconMap[ext] || "📄";

  return (
    <button className="trae-file-link-inline" onClick={() => onFileOpen?.(path, filename)} title={path}>
      <span className="trae-file-link-icon">{icon}</span>
      <span className="trae-file-link-name">{filename}</span>
      <span className="trae-file-link-path">{path.length > 40 ? "..." + path.slice(-37) : path}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="trae-file-link-arrow"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
    </button>
  );
}

function StepAccordion({
  group,
  isLastActive,
  onApprovalAction,
  phase,
  onFileOpen,
}: {
  group: StepGroupData;
  isLastActive: boolean;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
  phase: SoloTaskPhase;
  onFileOpen?: (filePath: string, fileName: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const isTerminal = phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";
  const effectiveStatus = isTerminal && group.status === "running"
    ? (phase === "completed" ? "completed" : "error")
    : group.status;

  useEffect(() => {
    if (isLastActive && effectiveStatus === "running") setCollapsed(false);
    if (effectiveStatus === "completed" && !isLastActive) setCollapsed(true);
  }, [isLastActive, effectiveStatus]);

  const borderColor =
    effectiveStatus === "completed" ? "var(--ok)"
    : effectiveStatus === "error" ? "var(--destructive)"
    : "var(--accent)";

  const aiMessages = useMemo(() => group.entries.filter((m) => m.role === "ai"), [group.entries]);
  const nonAiEntries = useMemo(() => group.entries.filter((m) => m.role !== "ai"), [group.entries]);

  return (
    <div className="trae-step-node" style={{ borderLeftColor: borderColor }}>
      <div className="trae-step-header" onClick={() => setCollapsed(!collapsed)}>
        <ChevronIcon open={!collapsed} />
        <StatusIcon status={effectiveStatus} />
        <span className="trae-step-label">{group.stepLabel}</span>
        {group.durationMs != null && group.durationMs > 0 && (
          <span className="trae-step-duration">{formatDurationMs(group.durationMs)}</span>
        )}
      </div>
      {!collapsed && (
        <div className="trae-step-body">
          {aiMessages.map((msg) => (
            <div key={msg.id} className="trae-step-entry">
              <LLMCallInline msg={msg} />
            </div>
          ))}
          {nonAiEntries.map((msg) => {
            if (msg.role === "llm-call") {
              return (
                <div key={msg.id} className="trae-step-entry">
                  <LLMCallInline msg={msg} />
                </div>
              );
            }
            if (msg.role === "tool") {
              return (
                <div key={msg.id} className="trae-step-entry">
                  <ToolInline msg={msg} onFileOpen={onFileOpen} />
                </div>
              );
            }
            if (msg.role === "system") {
              const isSuccess = msg.content?.startsWith("✓");
              return (
                <div key={msg.id} className="trae-step-entry">
                  <div className={`trae-step-system ${isSuccess ? "ok" : "err"}`}>{msg.content}</div>
                </div>
              );
            }
            if (msg.role === "gate") {
              const passed = msg.data?.is_passed;
              return (
                <div key={msg.id} className="trae-step-entry">
                  <span className={`trae-gate-pill ${passed ? "ok" : "err"}`}>
                    {passed ? "✓" : "✗"} {msg.data?.gate_id || "Gate"}
                    {msg.data?.score != null && <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>{msg.data.score}</span>}
                  </span>
                </div>
              );
            }
            if (msg.role === "review") {
              return (
                <div key={msg.id} className="trae-step-entry">
                  <div className="trae-review-banner">⏸ 审核节点: {msg.content}</div>
                </div>
              );
            }
            if (msg.role === "approval") {
              return (
                <div key={msg.id} className="trae-step-entry">
                  <ApprovalCard messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />
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

export default function ChatStream({
  messages, phase, onApprovalAction, stageProgress, interactionMode, onFileOpen,
}: {
  messages: ChatMessage[];
  phase: SoloTaskPhase;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
  stageProgress?: { current: number; total: number };
  interactionMode?: "normal" | "solo" | "auto";
  dynNodes?: any; dynEdges?: any; currentStep?: string;
  onFileOpen?: (filePath: string, fileName: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const config = useShellConfig();
  const isActive = phase === "running" || phase === "connecting";
  const isTerminal = phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";

  useEffect(() => {
    if (!userScrolled.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
  }, []);

  const stepGroups = useMemo(() => {
    return groupMessagesIntoSteps(messages, phase);
  }, [messages, phase]);

  const standaloneMessages = useMemo(() => {
    return stepGroups.filter((item): item is ChatMessage => "role" in item);
  }, [stepGroups]);

  const groupedSteps = useMemo(() => {
    return stepGroups.filter((item): item is StepGroupData => !("role" in item));
  }, [stepGroups]);

  const effectiveProgress = useMemo(() => {
    if (groupedSteps.length > 0) {
      const runningIdx = groupedSteps.findIndex((g) => g.status === "running");
      const current = runningIdx >= 0 ? runningIdx + 1 : groupedSteps.length;
      const total = Math.max(stageProgress?.total || 0, groupedSteps.length);
      return { current, total };
    }
    return stageProgress;
  }, [groupedSteps, stageProgress]);

  const lastActiveStepIdx = useMemo(() => {
    for (let i = groupedSteps.length - 1; i >= 0; i--) {
      if (groupedSteps[i].status === "running") return i;
    }
    return -1;
  }, [groupedSteps]);

  const renderStandaloneMessage = useCallback((msg: ChatMessage) => {
    switch (msg.role) {
      case "user": return <UserBubble key={msg.id} msg={msg} />;
      case "ai": return <AIBubble key={msg.id} msg={msg} onFileOpen={onFileOpen} />;
      case "system": {
        if (msg.content.startsWith("✓ ") && msg.content.endsWith(" 完成")) return null;
        return <SystemBanner key={msg.id} msg={msg} />;
      }
      case "tool": return <ToolInline key={msg.id} msg={msg} onFileOpen={onFileOpen} />;
      case "gate": return <GateBadge key={msg.id} msg={msg} />;
      case "review": return <ReviewBanner key={msg.id} msg={msg} />;
      case "llm-call": return <LLMCallInline key={msg.id} msg={msg} />;
      case "approval": return <ApprovalCard key={msg.id} messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />;
      default: return null;
    }
  }, [onApprovalAction, onFileOpen]);

  const timeline: React.ReactNode[] = [];

  let msgIdx = 0;
  let stepIdx = 0;

  for (const item of stepGroups) {
    if ("role" in item) {
      const rendered = renderStandaloneMessage(item as ChatMessage);
      if (rendered) timeline.push(rendered);
      msgIdx++;
    } else {
      const group = item as StepGroupData;
      timeline.push(
        <StepAccordion
          key={group.id}
          group={group}
          isLastActive={stepIdx === lastActiveStepIdx}
          onApprovalAction={onApprovalAction}
          phase={phase}
          onFileOpen={onFileOpen}
        />
      );
      stepIdx++;
    }
  }

  return (
    <div className="chat-stream" ref={containerRef} onScroll={handleScroll} style={{ overflowY: "auto" }}>
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

      {messages.length === 0 && (phase === "creating" || phase === "connecting") && (
        <div className="chat-welcome">
          <div className="spinner" />
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            {phase === "creating" ? "正在创建任务..." : "正在连接..."}
          </p>
        </div>
      )}

      {effectiveProgress && effectiveProgress.total > 0 && (phase === "running" || phase === "connecting" || phase === "waiting_review" || phase === "paused") && (
        <StepProgressBar current={effectiveProgress.current} total={effectiveProgress.total} />
      )}

      {timeline}

      {isActive && messages.length > 0 && (
        <div className="trae-thinking-indicator">
          <div className="trae-thinking-spinner" />
          <span>AI 正在思考...</span>
        </div>
      )}

      {isTerminal && messages.length > 0 && (
        <div className="trae-terminal-banner">
          <span className={`trae-terminal-pill ${phase === "error" || phase === "interrupted" ? "err" : phase === "rejected" ? "err" : "ok"}`}>
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

      {phase === "waiting_review" && (
        <ApprovalCard messageId="review-inline" data={{ type: "review", description: "AI 已完成当前阶段，等待您的审核确认后继续" }} onAction={onApprovalAction} />
      )}

      <div ref={bottomRef} />
    </div>
  );
}

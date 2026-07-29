"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { ChatMessage, StepGroupData } from "./helm-types";
import { HelmTaskPhase } from "../../lib/helm-types";
import { useShellConfig } from "../../lib/shell-config";
import {
  formatTs,
  truncateParams,
  truncateResult,
  formatDurationMs,
  detectFilePaths,
  groupMessagesIntoSteps,
} from "./helm-utils";
import { ApprovalCard } from "./ChatPrimitives";
import PlanPanel, { Plan } from "./PlanPanel";

const StepSummary = dynamic(() => import("./StepSummary"), { ssr: false });
const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false, loading: () => <span className="text-xs opacity-50">…</span> });

const LONG_CONTENT_THRESHOLD = 500;

function IconClipboard({ color = "#3B82F6" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" /></svg>;
}

function IconRobot({ color = "#8B5CF6" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>;
}

function IconLightning({ color = "#F59E0B" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill={color} stroke={color} strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>;
}

function IconWrench({ color = "#10B981" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>;
}

function IconFile({ color = "#06B6D4" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>;
}

function IconSearch({ color = "#EC4899" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}

function IconCheck({ color = "#22C55E" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
}

function IconXCircle({ color = "#EF4444" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>;
}

function IconEdit({ color = "#F59E0B" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}

function IconShield({ color = "#8B5CF6" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>;
}

function IconPublish({ color = "#3B82F6" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>;
}

function IconCode({ color = "#06B6D4" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>;
}

function IconConfig({ color = "#6366F1" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
}

function IconWorkflow({ color = "#3B82F6" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><circle cx="12" cy="18" r="3" /><line x1="8.5" y1="7.5" x2="10" y2="15.5" /><line x1="15.5" y1="7.5" x2="14" y2="15.5" /></svg>;
}

function IconAgent({ color = "#8B5CF6" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" /><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="12" cy="8" r="1" fill={color} /></svg>;
}

function IconGate({ color = "#F59E0B" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="8" rx="2" /><line x1="12" y1="2" x2="12" y2="8" /><line x1="12" y1="16" x2="12" y2="22" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;
}

function IconReview({ color = "#F59E0B" }: { color?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
}

function getStepIcon(label: string) {
  const lower = label.toLowerCase();
  if (lower.includes("workflow") || lower.includes("工作流") || lower.includes("流程")) return <IconWorkflow />;
  if (lower.includes("agent") || lower.includes("智能体") || lower.includes("代理")) return <IconAgent />;
  if (lower.includes("研究") || lower.includes("选题") || lower.includes("搜索") || lower.includes("素材") || lower.includes("检索")) return <IconSearch />;
  if (lower.includes("撰写") || lower.includes("写作") || lower.includes("文章") || lower.includes("创作") || lower.includes("起草")) return <IconEdit />;
  if (lower.includes("评估") || lower.includes("评审") || lower.includes("评价")) return <IconCheck />;
  if (lower.includes("审核") || lower.includes("合规") || lower.includes("review")) return <IconShield />;
  if (lower.includes("gate") || lower.includes("关卡") || lower.includes("检查点") || lower.includes("质检")) return <IconGate />;
  if (lower.includes("发布") || lower.includes("推送") || lower.includes("publish")) return <IconPublish />;
  if (lower.includes("执行") || lower.includes("运行") || lower.includes("处理")) return <IconLightning />;
  if (lower.includes("规划") || lower.includes("计划") || lower.includes("策划")) return <IconClipboard />;
  if (lower.includes("文件") || lower.includes("file")) return <IconFile />;
  return <IconClipboard />;
}

function getStepTypeBadge(label: string): { text: string; color: string } {
  const lower = label.toLowerCase();
  if (lower.includes("workflow") || lower.includes("工作流") || lower.includes("流程")) return { text: "Workflow", color: "#3B82F6" };
  if (lower.includes("agent") || lower.includes("智能体") || lower.includes("代理")) return { text: "Agent", color: "#8B5CF6" };
  if (lower.includes("研究") || lower.includes("选题") || lower.includes("搜索") || lower.includes("素材") || lower.includes("检索")) return { text: "Research", color: "#EC4899" };
  if (lower.includes("撰写") || lower.includes("写作") || lower.includes("文章") || lower.includes("创作") || lower.includes("起草")) return { text: "Writing", color: "#F59E0B" };
  if (lower.includes("评估") || lower.includes("评审") || lower.includes("评价")) return { text: "Review", color: "#22C55E" };
  if (lower.includes("审核") || lower.includes("合规")) return { text: "Compliance", color: "#8B5CF6" };
  if (lower.includes("gate") || lower.includes("关卡") || lower.includes("检查点") || lower.includes("质检")) return { text: "Gate", color: "#F59E0B" };
  if (lower.includes("发布") || lower.includes("推送") || lower.includes("publish")) return { text: "Publish", color: "#3B82F6" };
  if (lower.includes("执行") || lower.includes("运行") || lower.includes("处理")) return { text: "Exec", color: "#F59E0B" };
  if (lower.includes("规划") || lower.includes("计划") || lower.includes("策划")) return { text: "Plan", color: "#3B82F6" };
  if (lower.includes("文件") || lower.includes("file")) return { text: "File", color: "#06B6D4" };
  return { text: "Step", color: "#6366F1" };
}

function getToolIconSvg(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower.includes("search") || lower.includes("helixrag") || lower.includes("opensieve")) return <IconSearch />;
  if (lower.includes("file") || lower.includes("write") || lower.includes("read")) return <IconFile />;
  if (lower.includes("publish")) return <IconPublish />;
  return <IconWrench />;
}

function getFileIconSvg(ext: string) {
  if (ext === "md") return <IconEdit color="#F59E0B" />;
  if (["py", "js", "ts", "tsx", "jsx"].includes(ext)) return <IconCode />;
  if (["json", "yaml", "yml", "toml", "ini", "cfg"].includes(ext)) return <IconConfig />;
  return <IconFile />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

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

function StatusIcon({ status, phase }: { status: string; phase?: HelmTaskPhase }) {
  const isTerminal = phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";
  const isNotActive = isTerminal || phase === "waiting_review" || phase === "paused";
  const resolvedStatus = isNotActive && status === "running"
    ? (phase === "error" || phase === "rejected" || phase === "interrupted" ? "error" : "completed")
    : status;

  if (resolvedStatus === "running") {
    return (
      <svg className="trae-spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    );
  }
  if (resolvedStatus === "completed") {
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

function AIBubble({ msg, onFileOpen, taskId }: { msg: ChatMessage; onFileOpen?: (filePath: string, fileName: string) => void; taskId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"like" | "dislike" | null>(null);
  const content = msg.content || "";
  const fullContent = (msg.data?._content_full as string) || content;
  const savedToFile = msg.data?._saved_to_file || msg.data?._is_file;
  const isLong = content.length > LONG_CONTENT_THRESHOLD || fullContent.length > LONG_CONTENT_THRESHOLD;
  const displayContent = isLong && !expanded ? content.slice(0, LONG_CONTENT_THRESHOLD) + "..." : (expanded ? fullContent : content);
  const thinking = (msg.data?._thinking_content as string) || "";
  const filePath = (msg.data?.file_path as string) || (msg.data?._file_path as string) || "";
  const fileName = (msg.data?.filename as string) || (msg.data?._file_name as string) || "";

  const handleCopy = () => {
    navigator.clipboard?.writeText(fullContent || content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFeedback = (type: "like" | "dislike") => {
    const newFeedback = feedback === type ? null : type;
    setFeedback(newFeedback);
    if (newFeedback && taskId) {
      fetch(`/api/v1/tasks/${taskId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: msg.id, feedback: newFeedback }),
      }).catch(() => {});
    }
  };

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
        <div className="trae-ai-actions">
          <button className="trae-action-btn" onClick={handleCopy} title={copied ? "已复制" : "复制"}>
            {copied ? "✓" : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            )}
          </button>
          <button className={`trae-action-btn${feedback === "like" ? " active" : ""}`} onClick={() => handleFeedback("like")} title="采纳">
            <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback === "like" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
          </button>
          <button className={`trae-action-btn${feedback === "dislike" ? " active" : ""}`} onClick={() => handleFeedback("dislike")} title="不采纳">
            <svg width="14" height="14" viewBox="0 0 24 24" fill={feedback === "dislike" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
          </button>
        </div>
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

function LLMCallInline({ msg, forceCompleted }: { msg: ChatMessage; forceCompleted?: boolean }) {
  const [contentExpanded, setContentExpanded] = useState(false);
  const model = msg.data?._llm_model || msg.content || "";
  const tokens = msg.data?._llm_tokens || 0;
  const durationMs = msg.data?._llm_duration_ms || null;
  const agent = msg.data?._llm_agent || "";
  const llmError = msg.data?.error || msg.data?._llm_error || null;
  const hasError = !!llmError;
  const isEnd = forceCompleted || msg.data?._llm_is_end || false;
  const inputTokens = msg.data?._llm_input_tokens || msg.data?.prompt_tokens || 0;
  const outputTokens = msg.data?._llm_output_tokens || msg.data?.completion_tokens || 0;
  const thinking = (msg.data?._thinking_content as string) || (msg.data?.thinking as string) || "";
  const thinkingSummary = thinking.length > 80 ? thinking.slice(0, 80) + "..." : thinking;

  const responseContent = useMemo(() => {
    const full = msg.data?.full_response || msg.data?.content || null;
    if (!full) return null;
    if (typeof full === "string") return full;
    if (typeof full === "object" && full.content) return typeof full.content === "string" ? full.content : JSON.stringify(full.content);
    return JSON.stringify(full);
  }, [msg.data]);

  const contentPreview = useMemo(() => {
    if (!responseContent) return null;
    if (responseContent.length <= 200) return responseContent;
    return contentExpanded ? responseContent : responseContent.slice(0, 200) + "...";
  }, [responseContent, contentExpanded]);

  const hasTokenDetail = inputTokens > 0 || outputTokens > 0;

  return (
    <div className={`trae-llm-card ${hasError ? "error" : isEnd ? "completed" : "running"}`}>
      <div className="trae-llm-card-header-row">
        <span className="trae-llm-icon"><IconLightning /></span>
        <span className="trae-llm-type-badge">LLM</span>
        <span className="trae-llm-model-name">{model}</span>
        {agent && <span className="trae-llm-agent-badge">{agent}</span>}
        <span className="trae-llm-meta-spacer" />
        {hasTokenDetail && (
          <span className="trae-llm-token-row">
            <span className="trae-llm-token-in">↑{inputTokens}</span>
            <span className="trae-llm-token-out">↓{outputTokens}</span>
          </span>
        )}
        {!hasTokenDetail && tokens > 0 && <span className="trae-llm-tokens-badge">{tokens} tok</span>}
        {durationMs != null && <span className="trae-llm-dur">{formatDurationMs(durationMs)}</span>}
        {hasError ? (
          <span className="trae-llm-status-done"><IconXCircle color="#EF4444" /></span>
        ) : isEnd ? (
          <span className="trae-llm-status-done"><IconCheck color="#22C55E" /></span>
        ) : (
          <span className="trae-llm-inline-spinner" />
        )}
      </div>
      {thinkingSummary && isEnd && (
        <div className="trae-llm-thinking-row">
          <span className="trae-llm-thinking-icon">💭</span>
          <span className="trae-llm-thinking-text">{thinkingSummary}</span>
        </div>
      )}
      {llmError && isEnd && (
        <div className="trae-llm-error-row">
          <span className="trae-llm-error-icon">⚠</span>
          <span className="trae-llm-error-text">{typeof llmError === 'string' ? llmError : JSON.stringify(llmError)}</span>
        </div>
      )}
      {contentPreview && isEnd && !hasError && (
        <div className="trae-llm-content-preview">
          <ReactMarkdown>{contentPreview}</ReactMarkdown>
          {responseContent && responseContent.length > 200 && (
            <button className="trae-expand-btn" onClick={() => setContentExpanded(!contentExpanded)}>
              {contentExpanded ? "收起" : `展开全部 (${responseContent.length} 字)`}
            </button>
          )}
          <button className="trae-copy-btn" onClick={() => navigator.clipboard?.writeText(responseContent || "")} title="复制">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      )}
      {isEnd && !hasError && (
        <div className="trae-llm-feedback">
          <button className="trae-feedback-btn like" onClick={() => msg.data?._onFeedback?.("like")} title="采纳">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
          </button>
          <button className="trae-feedback-btn dislike" onClick={() => msg.data?._onFeedback?.("dislike")} title="不采纳">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
          </button>
        </div>
      )}
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

  const inputSummary = useMemo(() => {
    if (!params) return "";
    const str = typeof params === "string" ? params : JSON.stringify(params, null, 0);
    const query = params?.query || params?.search_query || params?.keyword || params?.keywords || params?.q || null;
    if (query) return String(query).slice(0, 50);
    return str.length > 50 ? str.slice(0, 50) + "..." : str;
  }, [params]);

  const resultSummary = useMemo(() => {
    if (hasError) return "失败";
    if (!result) {
      const isToolEnd = msg.data?._tool_success !== undefined;
      return isToolEnd ? "" : "执行中...";
    }
    if (typeof result === "string") {
      if (result.includes("成功") || result.includes("success")) return "成功";
      return result.length > 50 ? `成功 (${result.length}字)` : result.slice(0, 50);
    }
    const r = result as Record<string, any>;
    if (r.data?.results?.length) return `成功 (${r.data.results.length}条)`;
    if (r.results?.length) return `成功 (${r.results.length}条)`;
    if (r.data?.items?.length) return `成功 (${r.data.items.length}条)`;
    return "成功";
  }, [result, hasError, msg.data]);

  const isRunning = resultSummary === "执行中...";

  return (
    <div className={`trae-tool-card ${hasError ? "has-error" : ""}`}>
      <div className="trae-tool-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="trae-tool-icon-wrap">{getToolIconSvg(toolName)}</span>
        <span className="trae-tool-name">{toolName}</span>
        {inputSummary && <span className="trae-tool-input-pill">{inputSummary}</span>}
        <span className="trae-tool-meta-spacer" />
        {resultSummary && (
          <span className={`trae-tool-result-pill ${hasError ? "err" : isRunning ? "running" : "ok"}`}>
            {resultSummary}
          </span>
        )}
        {duration != null && <span className="trae-tool-dur">{formatDurationMs(duration)}</span>}
        {hasError && <span className="trae-tool-error-icon"><IconXCircle color="#EF4444" /></span>}
        <ChevronIcon open={expanded} />
      </div>
      {expanded && (
        <div className="trae-tool-card-detail">
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
  const gateId = msg.data?.gate_id || "Gate";
  const score = msg.data?.score;
  return (
    <div className={`trae-gate-card ${passed ? "passed" : "failed"}`}>
      <span className="trae-gate-icon"><IconGate color={passed ? "#22C55E" : "#EF4444"} /></span>
      <span className="trae-gate-name">{gateId}</span>
      <span className={`trae-gate-status ${passed ? "ok" : "err"}`}>{passed ? "PASSED" : "FAILED"}</span>
      {score != null && <span className="trae-gate-score">{score}</span>}
    </div>
  );
}

function ReviewBanner({ msg }: { msg: ChatMessage }) {
  const status = msg.data?.status || "waiting";
  const statusLabel = status === "approved" ? "APPROVED" : status === "rejected" ? "REJECTED" : "WAITING";
  const statusClass = status === "approved" ? "ok" : status === "rejected" ? "err" : "waiting";
  return (
    <div className="trae-review-card">
      <span className="trae-review-icon"><IconReview color="#F59E0B" /></span>
      <span className="trae-review-desc">{msg.content}</span>
      <span className={`trae-review-status ${statusClass}`}>{statusLabel}</span>
    </div>
  );
}

function FileLinkInline({ path, onFileOpen, fileSize }: { path: string; onFileOpen?: (filePath: string, fileName: string) => void; fileSize?: number }) {
  const filename = path.split(/[/\\]/).pop() || path;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const sizeStr = fileSize ? formatFileSize(fileSize) : "";

  return (
    <button className="trae-file-link-inline" onClick={() => onFileOpen?.(path, filename)} title={path}>
      <span className="trae-file-link-icon">{getFileIconSvg(ext)}</span>
      <span className="trae-file-link-name">{filename}</span>
      {sizeStr && <span className="trae-file-link-size">{sizeStr}</span>}
      <span className="trae-file-link-path">{path.length > 40 ? "..." + path.slice(-37) : path}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="trae-file-link-arrow"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
    </button>
  );
}

const StepAccordion = memo(function StepAccordion({
  group,
  isLastActive,
  onApprovalAction,
  phase,
  onFileOpen,
}: {
  group: StepGroupData;
  isLastActive: boolean;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
  phase: HelmTaskPhase;
  onFileOpen?: (filePath: string, fileName: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const isTerminal = phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";
  const isNotActive = isTerminal || phase === "waiting_review" || phase === "paused";
  const hasEntryError = group.entries.some(m =>
    m.data?.error || m.data?._llm_error ||
    (m.role === "system" && m.content?.startsWith("✗"))
  );
  const effectiveStatus = hasEntryError ? "error" :
    isNotActive && group.status === "running"
    ? (phase === "error" || phase === "rejected" || phase === "interrupted" ? "error" : "completed")
    : group.status;

  useEffect(() => {
    if (isLastActive && effectiveStatus === "running") setCollapsed(false);
    if (effectiveStatus === "completed" && !isLastActive) setCollapsed(true);
  }, [isLastActive, effectiveStatus]);

  const borderColor =
    effectiveStatus === "completed" ? "var(--ok)"
    : effectiveStatus === "error" ? "var(--destructive)"
    : "var(--accent)";

  const typeBadge = useMemo(() => getStepTypeBadge(group.stepLabel), [group.stepLabel]);

  const aiMessages = useMemo(() => group.entries.filter((m) => m.role === "ai"), [group.entries]);
  const nonAiEntries = useMemo(() => group.entries.filter((m) => m.role !== "ai"), [group.entries]);
  const stepCompleted = effectiveStatus === "completed" || effectiveStatus === "error";

  return (
    <div className="trae-step-node" style={{ borderLeftColor: borderColor }}>
      <div className="trae-step-header" onClick={() => setCollapsed(!collapsed)}>
        <ChevronIcon open={!collapsed} />
        <span className="trae-step-type-icon">{getStepIcon(group.stepLabel)}</span>
        <span className="trae-step-type-badge" style={{ color: typeBadge.color, background: `${typeBadge.color}14`, borderColor: `${typeBadge.color}30` }}>{typeBadge.text}</span>
        <StatusIcon status={effectiveStatus} phase={phase} />
        <span className="trae-step-label">{group.stepLabel}</span>
        {group.durationMs != null && group.durationMs > 0 && (
          <span className="trae-step-duration">{formatDurationMs(group.durationMs)}</span>
        )}
      </div>
      {!collapsed && (
        <div className="trae-step-body">
          {aiMessages.map((msg) => (
            <div key={msg.id} className="trae-step-entry">
              <LLMCallInline msg={msg} forceCompleted={stepCompleted} />
            </div>
          ))}
          {nonAiEntries.map((msg) => {
            if (msg.role === "llm-call") {
              return (
                <div key={msg.id} className="trae-step-entry">
                  <LLMCallInline msg={msg} forceCompleted={stepCompleted} />
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
                  <div className={`trae-gate-card ${passed ? "passed" : "failed"}`}>
                    <span className="trae-gate-icon"><IconGate color={passed ? "#22C55E" : "#EF4444"} /></span>
                    <span className="trae-gate-name">{msg.data?.gate_id || "Gate"}</span>
                    <span className={`trae-gate-status ${passed ? "ok" : "err"}`}>{passed ? "PASSED" : "FAILED"}</span>
                    {msg.data?.score != null && <span className="trae-gate-score">{msg.data.score}</span>}
                  </div>
                </div>
              );
            }
            if (msg.role === "review") {
              const rStatus = msg.data?.status || "waiting";
              const rStatusLabel = rStatus === "approved" ? "APPROVED" : rStatus === "rejected" ? "REJECTED" : "WAITING";
              const rStatusClass = rStatus === "approved" ? "ok" : rStatus === "rejected" ? "err" : "waiting";
              return (
                <div key={msg.id} className="trae-step-entry">
                  <div className="trae-review-card">
                    <span className="trae-review-icon"><IconReview color="#F59E0B" /></span>
                    <span className="trae-review-desc">{msg.content}</span>
                    <span className={`trae-review-status ${rStatusClass}`}>{rStatusLabel}</span>
                  </div>
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
});

export default function ChatStream({
  messages, phase, onApprovalAction, stageProgress, interactionMode, onFileOpen, onRetry,
  onRefresh, onClear, taskId,
  currentPlan, planLoading, onPlanConfirm, onPlanReject, onPlanRegenerate, onPlanStepEdit, onPlanStepDelete, onPlanStepAdd,
  newlyAddedSteps,
}: {
  messages: ChatMessage[];
  phase: HelmTaskPhase;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
  stageProgress?: { current: number; total: number };
  interactionMode?: "normal" | "helm" | "auto";
  dynNodes?: any; dynEdges?: any; currentStep?: string;
  onFileOpen?: (filePath: string, fileName: string) => void;
  onRetry?: () => void;
  onRefresh?: () => void;
  onClear?: () => void;
  taskId?: string;
  currentPlan?: Plan | null;
  planLoading?: boolean;
  onPlanConfirm?: (planId: string, editedSteps?: Plan["steps"]) => void;
  onPlanReject?: (planId: string) => void;
  onPlanRegenerate?: () => void;
  onPlanStepEdit?: (stepIndex: number, step: Partial<import("./PlanPanel").PlanStep>) => void;
  onPlanStepDelete?: (stepIndex: number) => void;
  onPlanStepAdd?: (step: import("./PlanPanel").PlanStep) => void;
  newlyAddedSteps?: Set<number>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const config = useShellConfig();
  const isActive = phase === "running" || phase === "connecting";
  const isTerminal = phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";
  const isNotActive = isTerminal || phase === "waiting_review" || phase === "paused";

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

  /* ── StepSummary data derived from groupedSteps ── */
  const stepSummaryItems = useMemo(() => {
    return groupedSteps
      .filter((g) => g.status === "completed")
      .map((g) => ({
        id: g.id,
        stepName: g.stepLabel,
        status: g.status as "running" | "completed" | "error",
        durationMs: g.durationMs ?? null,
        keyOutput: g.entries.find((e) => e.role === "system")?.content?.slice(0, 120) || undefined,
      }));
  }, [groupedSteps]);

  const renderStandaloneMessage = useCallback((msg: ChatMessage) => {
    switch (msg.role) {
      case "user": return <UserBubble key={msg.id} msg={msg} />;
      case "ai": return <AIBubble key={msg.id} msg={msg} onFileOpen={onFileOpen} taskId={taskId} />;
      case "system": {
        if (msg.content.startsWith("✓ ") && msg.content.endsWith(" 完成")) return null;
        return <SystemBanner key={msg.id} msg={msg} />;
      }
      case "tool": return <ToolInline key={msg.id} msg={msg} onFileOpen={onFileOpen} />;
      case "gate": return <GateBadge key={msg.id} msg={msg} />;
      case "review": return <ReviewBanner key={msg.id} msg={msg} />;
      case "llm-call": return <LLMCallInline key={msg.id} msg={msg} forceCompleted={isNotActive} />;
      case "approval": return <ApprovalCard key={msg.id} messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />;
      case "plan": return (
        <div key={msg.id} className="trae-msg-row trae-msg-ai">
          <div className="trae-avatar trae-avatar-ai">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
            </svg>
          </div>
          <div className="trae-ai-body" style={{ maxWidth: "100%" }}>
            <PlanPanel
              plan={currentPlan || (msg.data?._plan as Plan) || null}
              isLoading={planLoading}
              onConfirm={onPlanConfirm}
              onReject={onPlanReject}
              onRegenerate={onPlanRegenerate}
              onStepEdit={onPlanStepEdit}
              onStepDelete={onPlanStepDelete}
              onStepAdd={onPlanStepAdd}
              newlyAddedSteps={newlyAddedSteps}
            />
          </div>
        </div>
      );
      default: return null;
    }
  }, [onApprovalAction, onFileOpen, isNotActive, currentPlan, planLoading, onPlanConfirm, onPlanReject, onPlanRegenerate, onPlanStepEdit, onPlanStepDelete, onPlanStepAdd, newlyAddedSteps]);

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
    <div className="chat-stream-wrapper">
      {messages.length > 0 && (
        <div className="chat-stream-toolbar">
          <button className="chat-toolbar-btn" onClick={onRefresh} title="刷新">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button className="chat-toolbar-btn" onClick={onClear} title="清空聊天">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      )}
      <div className="chat-stream" ref={containerRef} onScroll={handleScroll} style={{ overflowY: "auto" }}>
      {messages.length === 0 && phase === "idle" && (
        <div className="chat-welcome">
          <div className="chat-welcome-icon">✦</div>
          <h2 className="chat-welcome-title">
            {config.brandName} {interactionMode === "normal" ? "普通" : interactionMode === "auto" ? "全自动" : "Helm"}
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

      {stepSummaryItems.length > 0 && (
        <StepSummary steps={stepSummaryItems} onExpand={() => {}} />
      )}

      {timeline}

      {phase === "error" && onRetry && (
        <div className="trae-error-actions">
          <button className="trae-retry-btn" onClick={onRetry} title="重试">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            重试
          </button>
        </div>
      )}

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
    </div>
  );
}

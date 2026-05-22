"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { ChatMessage, StepGroupData, DynNode, DynEdge } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";
import { useShellConfig } from "../../lib/shell-config";
import { formatTs, groupMessagesIntoSteps, renderMarkdown } from "./solo-utils";
import { ApprovalCard } from "./ChatPrimitives";
import StepProgressTimeline from "./StepProgressTimeline";
import StepGroupComp from "./StepGroup";
import DynamicGraph from "./DynamicGraph";

function AIAvatar() {
  return (
    <div className="chat-avatar chat-avatar-ai">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a4 4 0 014 4v1a1 1 0 001 1h1a4 4 0 010 8h-1a1 1 0 00-1 1v1a4 4 0 01-8 0v-1a1 1 0 00-1-1H6a4 4 0 010-8h1a1 1 0 001-1V6a4 4 0 014-4z" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="chat-avatar chat-avatar-user">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    </div>
  );
}

export default function ChatStream({
  messages, phase, onApprovalAction, stageProgress, interactionMode, dynNodes, dynEdges, currentStep,
}: {
  messages: ChatMessage[]; phase: SoloTaskPhase; onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
  stageProgress: { current: number; total: number };
  interactionMode: "normal" | "solo" | "auto";
  dynNodes?: DynNode[];
  dynEdges?: DynEdge[];
  currentStep?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const config = useShellConfig();

  const stepGroups = useMemo(() => groupMessagesIntoSteps(messages, phase), [messages, phase]);
  const lastStepGroupIdx = useMemo(() => {
    for (let i = stepGroups.length - 1; i >= 0; i--) { if ("stepNumber" in stepGroups[i]) return i; }
    return -1;
  }, [stepGroups]);

  const stepGroupList = useMemo(() => stepGroups.filter((s): s is StepGroupData => "stepNumber" in s), [stepGroups]);

  useEffect(() => {
    if (!userScrolled.current && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (el) userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight > 60;
  };

  const isTerminalPhase = phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted" || phase === "idle";
  const isActive = !isTerminalPhase && (phase === "running" || phase === "connecting" || phase === "creating");

  return (
    <div className="chat-stream" ref={containerRef} onScroll={handleScroll}>
      {messages.length === 0 && phase === "idle" && (
        <div className="chat-welcome">
          <div className="chat-welcome-icon">✦</div>
          <h2 className="chat-welcome-title">{config.brandName} {interactionMode === "normal" ? "普通" : interactionMode === "auto" ? "全自动" : "Solo"}</h2>
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
        <div className="chat-welcome"><div className="spinner" /><p style={{ color: "var(--muted)", fontSize: "13px" }}>{phase === "creating" ? "正在创建任务..." : "正在连接..."}</p></div>
      )}
      {stepGroupList.length > 0 && (
        <StepProgressTimeline stepGroups={stepGroupList} currentPhase={phase} />
      )}
      {stepGroups.map((item, idx) => {
        if ("stepNumber" in item) {
          const isLastActive = idx === lastStepGroupIdx && (phase === "running" || phase === "waiting_review" || phase === "paused");
          return <StepGroupComp key={item.id} group={item} isLastActive={isLastActive} onApprovalAction={onApprovalAction} />;
        }
        const msg = item as ChatMessage;
        if (msg.role === "user") {
          return (
            <div key={msg.id} className="chat-msg-row chat-msg-row-user animate-rise">
              <div className="chat-msg-body chat-msg-body-user">
                <div className="chat-msg-sender">用户</div>
                <div className="chat-user-bubble">{msg.content}</div>
                <span className="chat-msg-time">{formatTs(msg.timestamp)}</span>
              </div>
              <UserAvatar />
            </div>
          );
        }
        if (msg.role === "approval") return <ApprovalCard key={msg.id} messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />;
        if (msg.role === "gate") return <div key={msg.id} className={`solo-gate${msg.data?.is_passed ? " passed" : " failed"} animate-rise`}>{msg.content}</div>;
        if (msg.role === "review") return <div key={msg.id} className="solo-review-card animate-rise"><div className="solo-review-header">⏸ 审核节点</div><p className="solo-review-summary">{msg.content}</p></div>;
        if (msg.role === "system") return <div key={msg.id} className={`solo-system-msg${msg.content.startsWith("✓") ? " success" : " error"} animate-rise`}>{msg.content}<span className="solo-msg-time">{formatTs(msg.timestamp)}</span></div>;
        if (msg.role === "ai") {
          const isDraft = msg.data?._draft;
          const agentName = msg.data?._agent_name || "FlowForge Agent";
          return (
            <div key={msg.id} className={`chat-msg-row chat-msg-row-ai animate-rise${isDraft ? " chat-msg-row-draft" : ""}`}>
              <AIAvatar />
              <div className="chat-msg-body chat-msg-body-ai">
                <div className="chat-msg-sender">{agentName}</div>
                <div className="chat-ai-bubble">
                  <div className="chat-ai-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                </div>
                <span className="chat-msg-time">{formatTs(msg.timestamp)}</span>
              </div>
            </div>
          );
        }
        return null;
      })}
      {phase === "waiting_review" && <ApprovalCard messageId="review-inline" data={{ type: "review", description: "AI 已完成当前阶段，等待您的审核确认后继续" }} onAction={onApprovalAction} />}
      {isActive && messages.length > 0 && (
        <div className="chat-processing">
          <AIAvatar />
          <div className="chat-processing-body">
            <div className="chat-msg-sender">FlowForge Agent</div>
            <div className="chat-processing-text"><div className="spinner" style={{ width: "12px", height: "12px", margin: "0" }} /><span>思考中...</span></div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

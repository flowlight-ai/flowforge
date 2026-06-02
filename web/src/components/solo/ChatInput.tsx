"use client";

import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from "react";
import { SoloTaskPhase } from "../../lib/solo-types";
import { useShellConfig } from "../../lib/shell-config";
import { COMMANDS } from "./solo-utils";
import { CommandDropdown } from "./ChatPrimitives";
import WorkflowSelector from "./WorkflowSelector";

export default function ChatInput({
  phase, onSubmit, onReview, onCommand, onStop,
  interactionMode, onInteractionModeChange, selectedWorkflow, onWorkflowChange,
}: {
  phase: SoloTaskPhase;
  onSubmit: (text: string, persona?: string, model?: string) => void;
  onReview: (verdict: "pass" | "reject", feedback: string) => void;
  onCommand: (cmd: string) => void;
  onStop: () => void;
  interactionMode: "normal" | "solo" | "auto";
  onInteractionModeChange: (mode: "normal" | "solo" | "auto") => void;
  selectedWorkflow: string | null;
  onWorkflowChange: (wf: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [activeCmdIndex, setActiveCmdIndex] = useState(0);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [updatingModels, setUpdatingModels] = useState(false);
  const modelsFetchedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const config = useShellConfig();

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(Math.max(textarea.scrollHeight, 40), 140) + "px";
  }, []);

  useEffect(() => {
    resizeTextarea();
    if (!text && textareaRef.current) textareaRef.current.style.height = "";
  }, [text, resizeTextarea]);

  const fetchAvailableModels = useCallback(() => {
    if (modelsFetchedRef.current) return;
    modelsFetchedRef.current = true;
    fetch("/api/v1/admin/models/available")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list = data?.data?.models || data?.models || [];
        setModels(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchAvailableModels(); }, [fetchAvailableModels]);

  const handleForceUpdate = useCallback(async () => {
    setUpdatingModels(true);
    modelsFetchedRef.current = false;
    try {
      await fetch("/api/v1/admin/models/force-update", { method: "POST" });
      modelsFetchedRef.current = false;
      fetchAvailableModels();
    } catch {}
    setUpdatingModels(false);
  }, [fetchAvailableModels]);

  const isIdle = phase === "idle" || phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";
  const isWaitingReview = phase === "waiting_review";
  const isRunning = phase === "running" || phase === "paused";
  const isDisabled = phase === "creating" || phase === "connecting";
  const isSending = isRunning || phase === "creating" || phase === "connecting";

  const filteredCommands = useMemo(() => COMMANDS.filter((c) => c.cmd.startsWith(commandFilter.toLowerCase())), [commandFilter]);
  useEffect(() => { setActiveCmdIndex(0); }, [filteredCommands.length]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/")) { onCommand(trimmed.split(" ")[0]); setText(""); setShowCommands(false); setCommandFilter(""); return; }
    const modelToSend = selectedModel === "auto" ? undefined : selectedModel;
    if (isIdle) { onSubmit(trimmed, undefined, modelToSend); }
    else if (isRunning) { onSubmit(trimmed); }
    setText("");
  }, [text, isIdle, isRunning, selectedModel, onSubmit, onCommand]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showCommands) {
        if (e.key === "ArrowDown") { e.preventDefault(); setActiveCmdIndex((prev) => prev < filteredCommands.length - 1 ? prev + 1 : 0); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setActiveCmdIndex((prev) => prev > 0 ? prev - 1 : filteredCommands.length - 1); return; }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (filteredCommands[activeCmdIndex]) { onCommand(filteredCommands[activeCmdIndex].cmd); setText(""); setShowCommands(false); setCommandFilter(""); } return; }
        if (e.key === "Escape") { setShowCommands(false); return; }
      }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    },
    [showCommands, filteredCommands, activeCmdIndex, handleSend, onCommand]
  );

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (val.startsWith("/") && val.indexOf(" ") === -1) { setShowCommands(true); setCommandFilter(val); }
    else { setShowCommands(false); setCommandFilter(""); }
  }, []);

  useEffect(() => { if (isIdle && textareaRef.current) textareaRef.current.focus(); }, [isIdle]);

  return (
    <div className="chat-input-area">
      {isWaitingReview && (
        <div className="chat-review-actions">
          <div className="review-actions-header">审核操作</div>
          <textarea className="review-feedback-input" rows={2} value={reviewFeedback} onChange={(e) => setReviewFeedback(e.target.value)} placeholder="输入审核反馈（可选）..." />
          <div className="review-actions-buttons">
            <button className="btn btn-success btn-sm" onClick={() => { onReview("pass", reviewFeedback); setReviewFeedback(""); }}>✓ 通过</button>
            <button className="btn btn-danger btn-sm" onClick={() => { onReview("reject", reviewFeedback); setReviewFeedback(""); }}>✗ 驳回</button>
          </div>
        </div>
      )}
      <div className="chat-input-mode-indicator">
        <span className={`chat-input-mode-dot ${interactionMode}`} />
        <span className="chat-input-mode-label">
          {interactionMode === "normal" ? "普通模式" : interactionMode === "auto" ? "全自动模式" : "Solo 模式"}
        </span>
        {isRunning && <span className="chat-input-running-badge">执行中</span>}
      </div>
      <div className="chat-input-top">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef} className="chat-input-textarea" rows={1}
            value={text} onChange={handleTextChange} onInput={resizeTextarea} onKeyDown={handleKeyDown}
            placeholder={isDisabled ? "请稍候..." : isWaitingReview ? "等待审核..." : isIdle ? "与 Solo 对话，Shift+Enter 换行，输入 '/' 获取更多能力" : "输入补充指令..."}
            disabled={isDisabled || isWaitingReview}
          />
          {showCommands && <CommandDropdown filter={commandFilter} onSelect={(cmd) => { onCommand(cmd); setText(""); setShowCommands(false); setCommandFilter(""); textareaRef.current?.focus(); }} activeIndex={activeCmdIndex} />}
        </div>
      </div>
      <div className="chat-input-bottom">
        <div className="chat-input-quick-actions">
          <button className="chat-quick-btn" onClick={() => setText("")} disabled={!text} title="清空输入">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14" /></svg>
          </button>
          <button className="chat-quick-btn" onClick={() => { const v = text.trim(); if (v.startsWith("/")) { onCommand(v.split(" ")[0]); setText(""); } }} disabled={!text.trim().startsWith("/")} title="执行命令">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
          </button>
        </div>
        <div className="chat-mode-switch">
          <button className={`chat-mode-btn${interactionMode === "normal" ? " active" : ""}`} onClick={() => onInteractionModeChange("normal")} title="普通模式：选择工作流执行">普通</button>
          <button className={`chat-mode-btn${interactionMode === "solo" ? " active" : ""}`} onClick={() => onInteractionModeChange("solo")} title="Solo 模式：AI 规划，用户审批">Solo</button>
          <button className={`chat-mode-btn${interactionMode === "auto" ? " active" : ""}`} onClick={() => onInteractionModeChange("auto")} title="全自动模式：AI 自主规划与执行">全自动</button>
        </div>
        {interactionMode === "normal" && (
          <WorkflowSelector selected={selectedWorkflow} onChange={onWorkflowChange} />
        )}
        <div className="chat-model-select">
          <button className="chat-model-btn" onClick={() => setShowModelDropdown(!showModelDropdown)}>
            🤖 {selectedModel === "auto" ? "自动" : selectedModel}
          </button>
          {showModelDropdown && (
            <div className="chat-model-dropdown">
              <button className={`chat-model-option${selectedModel === "auto" ? " active" : ""}`}
                onClick={() => { setSelectedModel("auto"); setShowModelDropdown(false); }}>
                <span className="chat-model-option-name">⚡ 自动选择</span>
                <span className="chat-model-option-desc">自动使用最优模型</span>
              </button>
              <div className="chat-model-group-label">指定模型</div>
              {(() => {
                const groups: Record<string, any[]> = {};
                for (const m of models) {
                  if (m.health_status && m.health_status !== "available" && m.health_status !== "unknown") continue;
                  const provider = m.provider || "other";
                  if (!groups[provider]) groups[provider] = [];
                  groups[provider].push(m);
                }
                if (Object.keys(groups).length === 0) return <div className="chat-model-option" style={{ color: "var(--muted)" }}>暂无可用模型</div>;
                return Object.entries(groups).map(([provider, providerModels]) => (
                  <Fragment key={provider}>
                    <div className="chat-model-group-label">{provider}</div>
                    {providerModels.map((m) => (
                      <button key={m.model_id || m.id || m.name} className={`chat-model-option${selectedModel === (m.model_id || m.id || m.name) ? " active" : ""}`}
                        onClick={() => { setSelectedModel(m.model_id || m.id || m.name); setShowModelDropdown(false); }}>
                        <span className="chat-model-option-name">{m.display_name || m.name || m.model_id}</span>
                        <span className="chat-model-option-status" />
                      </button>
                    ))}
                  </Fragment>
                ));
              })()}
            </div>
          )}
        </div>
        <div className="chat-input-actions">
          <button className="chat-update-models-btn" onClick={handleForceUpdate} disabled={updatingModels} title="强制更新模型状态和 fallback 链">
            {updatingModels ? "⏳" : "🔄"}
          </button>
          {isSending ? (
            <button className="chat-stop-btn" onClick={onStop} title="停止执行">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="12" height="12" rx="2" /></svg>
            </button>
          ) : (
            <button className="chat-send-btn" onClick={handleSend} disabled={isDisabled || isWaitingReview || !text.trim()} style={{ background: config.brandColor }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8L14 2L8 14L7 9L2 8Z" fill="currentColor" stroke="currentColor" strokeWidth="1" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

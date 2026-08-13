"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from "react";
import { HelmTaskPhase } from "../../lib/helm-types";
import { useShellConfig } from "../../lib/shell-config";
import { BUILTIN_COMMANDS, COMMAND_GROUPS, filterAndSortCommands, Command } from "./commands";
import { CommandDropdown } from "./ChatPrimitives";
import WorkflowSelector from "./WorkflowSelector";
import AttachmentPreview, { Attachment } from "./AttachmentPreview";

const VoiceInput = dynamic(() => import("./VoiceInput"), { ssr: false });

/** 后端 /api/v1/admin/models/available 返回的模型条目（仅声明用到的字段） */
interface AvailableModel {
  model_id?: string;
  id?: string;
  name?: string;
  display_name?: string;
  provider?: string;
  health_status?: string;
}

export default function ChatInput({
  phase, onSubmit, onReview, onCommand, onStop,
  interactionMode, onInteractionModeChange, selectedModel, onModelChange,
  selectedWorkflow, onWorkflowChange,
  attachments, onRemoveAttachment, taskId,
}: {
  phase: HelmTaskPhase;
  onSubmit: (text: string, persona?: string, model?: string) => void;
  onReview: (verdict: "pass" | "reject", feedback: string) => void;
  onCommand: (cmd: string) => void;
  onStop: () => void;
  interactionMode: "normal" | "helm" | "auto";
  onInteractionModeChange: (mode: "normal" | "helm" | "auto") => void;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  selectedWorkflow: string | null;
  onWorkflowChange: (wf: string | null) => void;
  attachments?: Attachment[];
  onRemoveAttachment?: (id: string) => void;
  taskId?: string;
}) {
  const [text, setText] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [activeCmdIndex, setActiveCmdIndex] = useState(0);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const modelsFetchedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const config = useShellConfig();

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(Math.max(textarea.scrollHeight, 76), 180) + "px";
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

  const isIdle = phase === "idle" || phase === "completed" || phase === "error" || phase === "rejected" || phase === "interrupted";
  const isWaitingReview = phase === "waiting_review";
  const isRunning = phase === "running" || phase === "paused";
  const isDisabled = phase === "creating" || phase === "connecting";
  const isSending = isRunning || phase === "creating" || phase === "connecting";

  const filteredCommands = useMemo(() => filterAndSortCommands(BUILTIN_COMMANDS, commandFilter), [commandFilter]);
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
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (filteredCommands[activeCmdIndex]) { onCommand(filteredCommands[activeCmdIndex].id); setText(""); setShowCommands(false); setCommandFilter(""); } return; }
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

  const handleFileUpload = useCallback(async (files: FileList) => {
    if (!taskId || files.length === 0) return;
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }
    try {
      const res = await fetch(`/api/v1/upload/${taskId}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) console.error("Upload failed:", res.status);
    } catch (err) {
      console.error("Upload error:", err);
    }
  }, [taskId]);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files);
      e.target.value = "";
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  }, [handleFileUpload]);

  useEffect(() => { if (isIdle && textareaRef.current) textareaRef.current.focus(); }, [isIdle]);

  return (
    <div
      className="chat-input-area"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: "relative" }}
    >
      {isDragOver && (
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(30, 30, 46, 0.9)",
          border: "2px dashed var(--brand, #6366f1)",
          borderRadius: 12,
          pointerEvents: "none",
        }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            color: "var(--fg, #e2e8f0)",
          }}>
            <span style={{ fontSize: 32 }}>📎</span>
            <span style={{ fontSize: 14 }}>拖放文件到此处上传</span>
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleFileInputChange}
      />
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
      {attachments && attachments.length > 0 && onRemoveAttachment && (
        <AttachmentPreview attachments={attachments} onRemove={onRemoveAttachment} taskId={taskId} />
      )}
      <div className="chat-input-top">
        <span className="chat-input-brand">{config.brandName} Agent</span>
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef} className="chat-input-textarea" rows={3}
            value={text} onChange={handleTextChange} onInput={resizeTextarea} onKeyDown={handleKeyDown}
            placeholder={isDisabled ? "请稍候..." : isWaitingReview ? "等待审核..." : isIdle ? "与 Helm 对话，Shift+Enter 换行，输入 '/' 获取更多能力" : "输入补充指令..."}
            disabled={isDisabled || isWaitingReview}
          />
          {showCommands && <CommandDropdown commands={filteredCommands} onSelect={(cmd) => { onCommand(cmd); setText(""); setShowCommands(false); setCommandFilter(""); textareaRef.current?.focus(); }} activeIndex={activeCmdIndex} />}
        </div>
      </div>
      <div className="chat-input-bottom">
        <div className="chat-mode-switch">
          <button className={`chat-mode-btn${interactionMode === "normal" ? " active" : ""}`} onClick={() => onInteractionModeChange("normal")} title="普通模式：选择工作流执行">普通</button>
          <button className={`chat-mode-btn${interactionMode === "helm" ? " active" : ""}`} onClick={() => onInteractionModeChange("helm")} title="Helm 模式：AI 规划，用户审批">Helm</button>
          <button className={`chat-mode-btn${interactionMode === "auto" ? " active" : ""}`} onClick={() => onInteractionModeChange("auto")} title="全自动模式：AI 自主规划与执行">全自动</button>
        </div>
        {interactionMode === "normal" && (
          <WorkflowSelector selected={selectedWorkflow} onChange={onWorkflowChange} />
        )}
        <button
          className="chat-model-btn"
          onClick={handleFileSelect}
          title="上传附件"
          style={{ flexShrink: 0 }}
        >
          📎
        </button>
        <div className="chat-model-select">
          <button className="chat-model-btn" onClick={() => setShowModelDropdown(!showModelDropdown)} title={selectedModel === "auto" ? "自动选择模型" : selectedModel || "选择模型"}>
            🤖 {selectedModel === "auto" ? "自动" : selectedModel && selectedModel.length > 18 ? selectedModel.slice(0, 18) + "…" : selectedModel}
          </button>
          {showModelDropdown && (
            <div className="chat-model-dropdown">
              <button className={`chat-model-option${selectedModel === "auto" ? " active" : ""}`}
                onClick={() => { onModelChange?.("auto"); setShowModelDropdown(false); }}>
                <span className="chat-model-option-name">⚡ 自动选择</span>
                <span className="chat-model-option-desc">自动使用最优模型</span>
              </button>
              <div className="chat-model-group-label">指定模型</div>
              {(() => {
                const groups: Record<string, AvailableModel[]> = {};
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
                    {providerModels.map((m) => {
                      const modelId = m.model_id || m.id || m.name;
                      if (!modelId) return null;
                      return (
                        <button key={modelId} className={`chat-model-option${selectedModel === modelId ? " active" : ""}`}
                          onClick={() => { onModelChange?.(modelId); setShowModelDropdown(false); }}>
                          <span className="chat-model-option-name">{m.display_name || m.name || m.model_id}</span>
                          <span className="chat-model-option-status" />
                        </button>
                      );
                    })}
                  </Fragment>
                ));
              })()}
            </div>
          )}
        </div>
        <div className="chat-input-actions">
          <button
            className={`chat-model-btn${voiceActive ? " active" : ""}`}
            onClick={() => setVoiceActive(!voiceActive)}
            title={voiceActive ? "关闭语音输入" : "语音输入"}
            style={{ flexShrink: 0, color: voiceActive ? "var(--accent)" : undefined }}
          >
            🎤
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
        {voiceActive && (
          <div className="px-3 pb-2">
            <VoiceInput
              onTranscript={(transcript) => {
                setText((prev) => prev + transcript);
              }}
              isEnabled={voiceActive}
              language="zh-CN"
            />
          </div>
        )}
      </div>
    </div>
  );
}

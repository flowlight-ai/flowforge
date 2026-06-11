"use client";

import { useState } from "react";
import { ChatMessage } from "./helm-types";
import { renderMarkdown, formatDurationMs, detectFilePaths } from "./helm-utils";

interface LLMCallCardProps {
  msg: ChatMessage;
  thinkingContent?: string;
}

export default function LLMCallCard({ msg, thinkingContent }: LLMCallCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [showThinking, setShowThinking] = useState(false);

  const model = msg.data?.model || msg.data?.model_name || "";
  const tokenCount = msg.data?.total_tokens || msg.data?.token_count || 0;
  const durationMs = msg.data?.duration_ms || msg.data?.latency_ms || null;
  const content = msg.content || "";
  const hasThinking = !!(thinkingContent && thinkingContent.trim().length > 0);
  const filePaths = detectFilePaths(content);

  return (
    <div className="helm-llm-card">
      <div className="helm-llm-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="helm-llm-card-info">
          {model && <span className="helm-llm-model">{model}</span>}
        </div>
        <div className="helm-llm-card-meta">
          {tokenCount > 0 && (
            <span className="helm-llm-tokens" title={`Token 用量`}>
              {tokenCount}
            </span>
          )}
          {durationMs != null && (
            <span className="helm-llm-duration">{formatDurationMs(durationMs)}</span>
          )}
        </div>
        <span className="helm-llm-expand-toggle">{expanded ? "▾" : "▸"}</span>
      </div>

      {/* Inline thinking toggle */}
      {hasThinking && (
        <div className="helm-llm-thinking-bar" onClick={(e) => { e.stopPropagation(); setShowThinking(!showThinking); }}>
          <span className={`helm-llm-thinking-chevron ${showThinking ? "open" : ""}`}>{showThinking ? "▾" : "▸"}</span>
          <span className="helm-llm-thinking-label">思考过程</span>
        </div>
      )}
      {hasThinking && showThinking && (
        <div className="helm-llm-thinking-body">
          <div
            className="helm-markdown-bubble thinking-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(thinkingContent!) }}
          />
        </div>
      )}

      {/* Content body */}
      {content && (
        <div className={`helm-llm-card-body ${expanded ? "expanded" : "collapsed"}`}>
          <div
            className="helm-markdown-bubble"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
          {filePaths.length > 0 && (
            <div className="helm-file-change-row">
              {filePaths.map((fp, i) => {
                const filename = fp.path.split(/[/\\]/).pop() || fp.path;
                return (
                  <span key={i} className="helm-file-badge" title={fp.path + fp.line}>
                    <span className="helm-file-icon">📄</span>
                    <span className="helm-file-path">{filename}</span>
                    {fp.line && <span className="helm-file-diff add">{fp.line.replace(":+", "+")}</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
"use client";

import { useState } from "react";
import { ChatMessage } from "./solo-types";
import { AgentAvatar } from "./ChatPrimitives";
import { renderMarkdown, formatDurationMs } from "./solo-utils";

export default function LLMCallCard({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const agentName = msg.data?._agent_name || msg.data?.agent_name || "AI";
  const model = msg.data?.model || msg.data?.model_name || "";
  const tokenCount = msg.data?.total_tokens || msg.data?.token_count || 0;
  const promptTokens = msg.data?.prompt_tokens || 0;
  const completionTokens = msg.data?.completion_tokens || 0;
  const durationMs = msg.data?.duration_ms || msg.data?.latency_ms || null;
  const content = msg.content || "";

  return (
    <div className="solo-llm-card">
      <div className="solo-llm-card-header" onClick={() => setExpanded(!expanded)}>
        <AgentAvatar name={agentName} size={24} />
        <div className="solo-llm-card-info">
          <span className="solo-llm-agent-name">{agentName}</span>
          {model && <span className="solo-llm-model">{model}</span>}
        </div>
        <div className="solo-llm-card-meta">
          {tokenCount > 0 && (
            <span className="solo-llm-tokens" title={`Prompt: ${promptTokens} | Completion: ${completionTokens}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginRight: 3 }}>
                <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {tokenCount}
            </span>
          )}
          {durationMs != null && (
            <span className="solo-llm-duration">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginRight: 3 }}>
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M6 4v2.5L7.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {formatDurationMs(durationMs)}
            </span>
          )}
        </div>
        <span className="solo-llm-expand-toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {content && (
        <div className={`solo-llm-card-body ${expanded ? "expanded" : ""}`}>
          <div
            className="solo-markdown-bubble"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </div>
      )}
    </div>
  );
}

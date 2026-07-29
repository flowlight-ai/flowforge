"use client";

import { useRef, useEffect } from "react";
import { StreamEntry, HelmTaskPhase } from "../../lib/helm-types";
import { StageTransition } from "./StageTransition";
import { ToolCallCard } from "./ToolCallCard";
import { ThinkingBlock } from "./ThinkingBlock";
import { IntermediateBlock } from "./IntermediateBlock";
import { useShellConfig } from "../../lib/shell-config";

interface Props {
  entries: StreamEntry[];
  phase: HelmTaskPhase;
  onEntryClick: (entry: StreamEntry) => void;
  selectedId: string | null;
  startTime: number | null;
}

function formatTs(ts: string | number) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ExecutionStream({
  entries,
  phase,
  onEntryClick,
  selectedId,
  startTime,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const config = useShellConfig();

  useEffect(() => {
    if (!userScrolled.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [entries.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (el) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      userScrolled.current = !atBottom;
    }
  };

  const isActive =
    phase === "running" || phase === "connecting" || phase === "creating";

  return (
    <div
      className="execution-stream"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {entries.length === 0 && phase === "creating" && (
        <div className="stream-placeholder">
          <div className="spinner" />
          <p>正在创建任务...</p>
        </div>
      )}
      {entries.length === 0 && phase === "connecting" && (
        <div className="stream-placeholder">
          <div className="spinner" />
          <p>正在连接 AI Agent...</p>
        </div>
      )}
      {entries.length === 0 && phase === "idle" && (
        <div className="stream-placeholder">
          <div
            style={{
              fontSize: "40px",
              marginBottom: "12px",
              opacity: 0.6,
            }}
          >
            🤖
          </div>
          <p
            style={{
              color: "var(--text-strong)",
              fontSize: "15px",
              fontWeight: 600,
              marginBottom: "4px",
            }}
          >
            欢迎使用 {config.brandName} Helm
          </p>
          <p style={{ color: "var(--muted)", fontSize: "13px" }}>
            选择任务开始 AI 全自动执行
            <br />
            执行过程将在此实时展示
          </p>
        </div>
      )}

      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`stream-item${selectedId === entry.id ? " selected" : ""}`}
        >
          {entry.type === "stage" && (
            <StageTransition
              data={entry.data}
              timestamp={entry.timestamp}
            />
          )}
          {entry.type === "tool-call" && (
            <ToolCallCard
              data={entry.data}
              onClick={() => onEntryClick(entry)}
              timestamp={entry.timestamp}
            />
          )}
          {entry.type === "thinking" && (
            <ThinkingBlock
              data={entry.data}
              onClick={() => onEntryClick(entry)}
              timestamp={entry.timestamp}
            />
          )}
          {entry.type === "intermediate" && (
            <IntermediateBlock
              data={entry.data}
              timestamp={entry.timestamp}
            />
          )}
          {entry.type === "llm-stream" && (
            <div className="llm-stream-entry">
              <span className="llm-stream-agent">
                {entry.data?.agent_name || "LLM"}
              </span>
              <span className="llm-stream-delta">
                {entry.data?.delta_text || ""}
              </span>
            </div>
          )}
          {entry.type === "review" && entry.data?.draft_summary && (
            <div className="helm-review-block">
              <div className="review-stage-header">⏸ 审核节点</div>
              <p className="review-hint">{entry.data.draft_summary}</p>
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--muted)",
                  textAlign: "right",
                }}
              >
                {formatTs(entry.timestamp)}
              </div>
            </div>
          )}
          {entry.type === "gate" && entry.data?.gate_id && (
            <div
              style={{
                background: entry.data.is_passed
                  ? "var(--ok-subtle)"
                  : "var(--danger-subtle)",
                border: `1px solid ${entry.data.is_passed ? "var(--ok)" : "var(--danger)"}`,
                borderRadius: "var(--radius-sm)",
                padding: "10px 14px",
                margin: "4px 0",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: entry.data.is_passed
                    ? "var(--ok)"
                    : "var(--danger)",
                }}
              >
                {entry.data.is_passed ? "✓" : "✗"} 门禁:{" "}
                {entry.data.gate_id}
              </div>
              {entry.data.overall_score != null && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--muted)",
                    marginTop: "4px",
                  }}
                >
                  得分: {entry.data.overall_score}/{entry.data.pass_threshold}
                </div>
              )}
            </div>
          )}
          {entry.type === "system" && entry.data?.published_urls && (
            <div className="system-msg success">
              <span>✓ 任务完成</span>
              <span
                style={{
                  fontSize: "10px",
                  opacity: 0.6,
                  marginLeft: "8px",
                }}
              >
                {formatTs(entry.timestamp)}
              </span>
            </div>
          )}
          {entry.type === "system" && entry.data?.error_message && (
            <div className="system-msg error">
              <span>✗ {entry.data.error_message}</span>
              <span
                style={{
                  fontSize: "10px",
                  opacity: 0.6,
                  marginLeft: "8px",
                }}
              >
                {formatTs(entry.timestamp)}
              </span>
            </div>
          )}
        </div>
      ))}

      {isActive && entries.length > 0 && (
        <div
          style={{
            padding: "4px 0",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <div
            className="spinner"
            style={{ width: "12px", height: "12px", margin: "0" }}
          />
          <span style={{ fontSize: "11px", color: "var(--muted)" }}>
            处理中...
          </span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}

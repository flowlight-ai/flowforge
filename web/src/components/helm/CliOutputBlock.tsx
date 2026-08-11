"use client";

/**
 * CliOutputBlock — CLI 执行内容展示区
 *
 * 参考 clowder-ai packages/web/src/components/cli-output/CliOutputBlock.tsx
 *
 * 在群聊消息流中展示智能体执行的工具调用（tool_use）和命令行输出（stdout），
 * 折叠式设计，流式时自动展开，完成时自动收起。
 *
 * 数据来源：message.meta 中的 toolEvents / cliStdout / toolCalls 字段
 *
 * UI 结构：
 *   ┌─ Header（可点击折叠）─────────────────────────┐
 *   │ ▼ CLI Output · done · 3 tools · 1m23s          │
 *   ├─────────────────────────────────────────────────┤
 *   │ 🔧 tool_name(args)              ✓ done          │
 *   │    └─ result detail（可展开）                   │
 *   │ ─── stdout ───                                  │
 *   │ $ command output...                             │
 *   └─────────────────────────────────────────────────┘
 */

import { useState, useEffect, useRef, useMemo } from "react";

// ── 类型定义 ────────────────────────────────────────────────────

/** CLI 事件类型（参考 clowder-ai CliEvent） */
export type CliEventType = "tool_use" | "tool_result" | "text";

/** 单个 CLI 事件 */
export interface CliEvent {
  type: CliEventType;
  /** 工具名称（tool_use/tool_result）或空（text） */
  name?: string;
  /** 工具输入参数（tool_use） */
  input?: string;
  /** 工具结果（tool_result）或文本内容（text） */
  content?: string;
  /** 状态：streaming / done / failed / interrupted */
  status?: "streaming" | "done" | "failed" | "interrupted";
  /** 时间戳（ms） */
  timestamp?: number;
}

/** 消息 meta 中的工具调用数据（兼容多种字段名） */
export interface ToolMeta {
  /** 工具调用事件列表 */
  toolEvents?: CliEvent[];
  /** CLI stdout 输出 */
  cliStdout?: string;
  /** 兼容字段：工具调用列表（另一种格式） */
  toolCalls?: Array<{
    name: string;
    args?: Record<string, unknown> | string;
    result?: string;
    status?: "streaming" | "done" | "failed";
  }>;
  /** 兼容字段：模型 usage */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  /** 模型名称 */
  model?: string;
  /** 执行时长（ms） */
  duration_ms?: number;
}

// ── 工具函数 ────────────────────────────────────────────────────

/**
 * 从 message.meta 提取并转换为 CliEvent 列表
 * 参考 clowder-ai toCliEvents.ts
 */
export function toCliEvents(meta: ToolMeta | undefined | null): CliEvent[] {
  if (!meta) return [];

  const events: CliEvent[] = [];

  // 1. 优先使用 toolEvents（标准格式）
  if (Array.isArray(meta.toolEvents) && meta.toolEvents.length > 0) {
    events.push(...meta.toolEvents);
  }

  // 2. 兼容 toolCalls 格式
  if (Array.isArray(meta.toolCalls) && meta.toolCalls.length > 0 && events.length === 0) {
    for (const tc of meta.toolCalls) {
      events.push({
        type: "tool_use",
        name: tc.name,
        input: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args ?? {}),
        status: tc.status ?? "done",
      });
      if (tc.result) {
        events.push({
          type: "tool_result",
          name: tc.name,
          content: tc.result,
          status: "done",
        });
      }
    }
  }

  // 3. cliStdout 作为 text 事件
  if (meta.cliStdout) {
    events.push({
      type: "text",
      content: meta.cliStdout,
      status: "done",
    });
  }

  return events;
}

/** 构建摘要文本（参考 clowder-ai buildSummary） */
function buildSummary(events: CliEvent[], isStreaming: boolean, durationMs?: number): string {
  const toolEvents = events.filter((e) => e.type === "tool_use");
  const textEvents = events.filter((e) => e.type === "text");
  const toolCount = toolEvents.length;

  const parts: string[] = ["CLI Output"];

  if (isStreaming) {
    const lastTool = toolEvents[toolEvents.length - 1];
    parts.push("·", "streaming");
    if (lastTool?.name) {
      parts.push("·", `${lastTool.name}...`);
    }
  } else {
    parts.push("·", "done");
    if (toolCount > 0) {
      parts.push("·", `${toolCount} tool${toolCount > 1 ? "s" : ""}`);
    } else if (textEvents.length > 0) {
      const lines = textEvents[0].content?.split("\n").length ?? 0;
      parts.push("·", `${lines} lines`);
    }
    if (durationMs) {
      const secs = Math.floor(durationMs / 1000);
      const mins = Math.floor(secs / 60);
      const remSecs = secs % 60;
      const dur = mins > 0 ? `${mins}m${remSecs}s` : `${secs}s`;
      parts.push("·", dur);
    }
    // stdout 预览
    if (textEvents.length > 0) {
      const preview = textEvents[0].content?.trim().split("\n")[0]?.slice(0, 40);
      if (preview) {
        parts.push("·", `stdout: ${preview}...`);
      }
    }
  }

  return parts.join(" ");
}

// ── 主组件 ──────────────────────────────────────────────────────

export interface CliOutputBlockProps {
  /** 消息 meta（含工具调用数据） */
  meta: ToolMeta | undefined | null;
  /** 是否流式中（外部传入，决定自动展开） */
  isStreaming?: boolean;
  /** 默认展开 */
  defaultExpanded?: boolean;
  /** 智能体配色（CSS 变量或颜色值） */
  accentColor?: string;
  /** 折叠状态持久化 key（参考 clowder-ai disclosureKey） */
  disclosureKey?: string;
}

export default function CliOutputBlock({
  meta,
  isStreaming = false,
  defaultExpanded,
  accentColor = "var(--accent)",
  disclosureKey,
}: CliOutputBlockProps) {
  const events = useMemo(() => toCliEvents(meta), [meta]);

  // 无事件时不渲染
  if (events.length === 0) return null;

  const summary = useMemo(
    () => buildSummary(events, isStreaming, meta?.duration_ms),
    [events, isStreaming, meta?.duration_ms]
  );

  // 折叠状态（支持 localStorage 持久化）
  const storageKey = disclosureKey ? `flowforge:cli-block:${disclosureKey}` : null;
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (defaultExpanded !== undefined) return defaultExpanded;
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) return stored === "1";
      } catch { /* ignore */ }
    }
    // 流式时默认展开
    return isStreaming;
  });

  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [expandedToolIdx, setExpandedToolIdx] = useState<number | null>(null);
  const userInteracted = useRef(false);

  // 流式状态变化时自动展开/收起（除非用户已交互）
  useEffect(() => {
    if (userInteracted.current) return;
    setExpanded(isStreaming);
  }, [isStreaming]);

  // 持久化折叠状态
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, expanded ? "1" : "0");
      } catch { /* ignore */ }
    }
  }, [expanded, storageKey]);

  const toggleExpanded = () => {
    userInteracted.current = true;
    setExpanded((v) => !v);
  };

  const toolEvents = events.filter((e) => e.type === "tool_use");
  const resultEvents = events.filter((e) => e.type === "tool_result");
  const textEvents = events.filter((e) => e.type === "text");

  return (
    <div
      data-cli-block="root"
      style={{
        marginTop: "8px",
        borderRadius: "var(--radius-md, 8px)",
        border: "1px solid var(--border)",
        background: "var(--bg)",
        overflow: "hidden",
        fontSize: "12px",
      }}
    >
      {/* Header（可点击折叠） */}
      <button
        type="button"
        onClick={toggleExpanded}
        data-cli-block="header"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 10px",
          background: "transparent",
          border: "none",
          color: "var(--muted)",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        {/* Chevron */}
        <span
          data-cli-block="chevron"
          style={{
            display: "inline-block",
            transition: "transform 0.15s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            color: accentColor,
            fontSize: "10px",
          }}
        >
          ▶
        </span>
        {/* 摘要 */}
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {summary}
        </span>
        {/* 流式旋转指示器 */}
        {isStreaming && (
          <span
            data-cli-block="spinner"
            style={{
              width: "12px",
              height: "12px",
              border: "2px solid var(--border)",
              borderTopColor: accentColor,
              borderRadius: "50%",
              animation: "flowforge-cli-spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
        )}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div data-cli-block="body" style={{ borderTop: "1px solid var(--border)" }}>
          {/* 工具调用区 */}
          {toolEvents.length > 0 && (
            <div data-cli-block="tools" style={{ padding: "6px 10px" }}>
              {/* 工具列表折叠按钮 */}
              <button
                type="button"
                onClick={() => setToolsCollapsed((v) => !v)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  fontSize: "11px",
                  padding: "2px 0",
                  fontFamily: "inherit",
                }}
              >
                {toolsCollapsed
                  ? `▶ ${toolEvents.length} tools (collapsed)`
                  : `▼ ${toolEvents.length} tool${toolEvents.length > 1 ? "s" : ""}`}
              </button>

              {/* 工具行列表 */}
              {!toolsCollapsed && (
                <div style={{ marginTop: "4px" }}>
                  {toolEvents.map((tool, idx) => {
                    const result = resultEvents[idx];
                    const isExpanded = expandedToolIdx === idx;
                    const status = tool.status ?? (isStreaming ? "streaming" : "done");
                    return (
                      <div
                        key={idx}
                        data-cli-block="tool-row"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          padding: "4px 6px",
                          marginBottom: "2px",
                          borderRadius: "var(--radius-sm, 4px)",
                          background: status === "streaming"
                            ? "color-mix(in srgb, var(--accent) 6%, transparent)"
                            : "transparent",
                          borderLeft: status === "streaming"
                            ? `2px solid ${accentColor}`
                            : "2px solid transparent",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedToolIdx(isExpanded ? null : idx)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            background: "none",
                            border: "none",
                            color: "var(--text)",
                            cursor: "pointer",
                            fontSize: "11px",
                            textAlign: "left",
                            fontFamily: "inherit",
                            width: "100%",
                          }}
                        >
                          {/* 状态图标 */}
                          <span style={{ fontSize: "11px" }}>
                            {status === "streaming" ? "◌" : status === "failed" ? "✕" : "✓"}
                          </span>
                          <span style={{ color: "var(--muted)" }}>🔧</span>
                          {/* 工具名 + 参数预览 */}
                          <span
                            style={{
                              fontFamily: "var(--font-mono, monospace)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                            }}
                          >
                            <span style={{ color: accentColor, fontWeight: 600 }}>
                              {tool.name || "unknown"}
                            </span>
                            {tool.input && (
                              <span style={{ color: "var(--muted)" }}>
                                ({tool.input.slice(0, 60)}{tool.input.length > 60 ? "..." : ""})
                              </span>
                            )}
                          </span>
                          {/* 行级展开箭头 */}
                          {result?.content && (
                            <span style={{ color: "var(--muted)", fontSize: "10px" }}>
                              {isExpanded ? "▼" : "▶"}
                            </span>
                          )}
                        </button>
                        {/* 工具结果详情（展开时） */}
                        {isExpanded && result?.content && (
                          <pre
                            data-cli-block="tool-result"
                            style={{
                              margin: "4px 0 0 20px",
                              padding: "6px 8px",
                              background: "var(--bg-elevated)",
                              borderRadius: "var(--radius-sm, 4px)",
                              color: "var(--text)",
                              fontSize: "11px",
                              fontFamily: "var(--font-mono, monospace)",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: "300px",
                              overflow: "auto",
                            }}
                          >
                            {result.content}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* stdout 文本区 */}
          {textEvents.length > 0 && (
            <div data-cli-block="stdout" style={{ padding: "6px 10px", borderTop: toolEvents.length > 0 ? "1px solid var(--border)" : "none" }}>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: "10px",
                  marginBottom: "4px",
                  letterSpacing: "1px",
                }}
              >
                ─── stdout ───
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 0,
                  color: "var(--text)",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono, monospace)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "400px",
                  overflow: "auto",
                }}
              >
                {textEvents.map((e) => e.content).join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 旋转动画 keyframes */}
      <style>{`
        @keyframes flowforge-cli-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

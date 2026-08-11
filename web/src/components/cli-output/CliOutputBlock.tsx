"use client";

/**
 * CliOutputBlock — CLI 执行内容展示区（增强版）
 *
 * 参考 clowder-ai CliOutputBlock 设计，将原始 CLI 输出转换为结构化展示：
 *   - 折叠/展开 header（流式时自动展开，完成时自动收起）
 *   - 状态图标（loader/check/error）
 *   - tool call 列表（可展开结果详情）
 *   - stdout 文本区
 *   - CliDiagnosticsPanel（4 级严重度诊断面板）
 *
 * 数据来源：message.meta 中的 toolEvents / cliStdout / toolCalls 字段
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
  /** 标签（工具调用标签，如 tool_use 的标识） */
  label?: string;
  /** 详情（tool_result 的详细输出） */
  detail?: string;
  /** 时间戳（ms） */
  timestamp?: number;
}

/** 消息 meta 中的工具调用数据（兼容多种字段名） */
export interface ToolMeta {
  toolEvents?: CliEvent[];
  cliStdout?: string;
  toolCalls?: Array<{
    name: string;
    args?: Record<string, unknown> | string;
    result?: string;
    status?: "streaming" | "done" | "failed";
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  duration_ms?: number;
}

// ── 诊断类型定义（参考 clowder-ai CliDiagnostics） ─────────────

/** 错误原因代码（4 级严重度） */
export type CliErrorReasonCode =
  // Tier 1 — 用户必须修复
  | "auth_failed"
  | "invalid_config"
  | "model_not_found"
  // Tier 2 — 临时性，可重试
  | "quota_exceeded"
  | "network_error"
  | "server_overloaded"
  | "cli_response_timeout"
  | "cli_stall_timeout"
  // Tier 3 — 系统/环境
  | "spawn_failed"
  | "missing_rollout"
  | "session_not_found"
  // Tier 4 — 认知/上下文限制
  | "context_window_exceeded"
  | "invalid_thinking_signature"
  | "tool_call_parse_failed"
  | "silent_completion"
  | "upstream_policy_reject";

/** 诊断信息 */
export interface CliDiagnostics {
  reasonCode: CliErrorReasonCode;
  publicSummary: string;
  publicHint?: string;
  safeExcerpt?: string;
  excerptSource?: string;
  debugRef: {
    command: string;
    exitCode?: number | null;
    signal?: string | null;
    invocationId?: string;
    homeMode?: string;
    spawnCwdMode?: string;
    spawnCwdKey?: string;
    profileId?: string;
  };
}

// ── 内联 SVG 图标 ───────────────────────────────────────────────

function ChevronIcon({ expanded, color }: { expanded: boolean; color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
      style={{ transition: "transform 0.15s", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#22c55e"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function LoaderIcon({ color }: { color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function WrenchIcon({ color }: { color?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ef4444"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

// ── 工具函数 ────────────────────────────────────────────────────

/**
 * 从 message.meta 提取并转换为 CliEvent 列表
 * 参考 clowder-ai toCliEvents
 */
export function toCliEvents(meta: ToolMeta | undefined | null): CliEvent[] {
  if (!meta) return [];

  const events: CliEvent[] = [];

  // 1. 优先使用 toolEvents（标准格式）
  if (Array.isArray(meta.toolEvents) && meta.toolEvents.length > 0) {
    events.push(...meta.toolEvents);
  }

  // 2. 兼容 toolCalls 格式（当 toolEvents 为空时）
  if (Array.isArray(meta.toolCalls) && meta.toolCalls.length > 0 && events.length === 0) {
    for (const tc of meta.toolCalls) {
      events.push({
        type: "tool_use",
        name: tc.name,
        input: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args ?? {}),
        status: tc.status ?? "done",
        label: tc.name,
      });
      if (tc.result) {
        events.push({
          type: "tool_result",
          name: tc.name,
          content: tc.result,
          detail: tc.result,
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

/** 格式化时长（ms → 可读字符串） */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

/** 构建摘要文本 */
function buildSummary(events: CliEvent[], isStreaming: boolean, durationMs?: number): string {
  const toolEvents = events.filter((e) => e.type === "tool_use");
  const textEvents = events.filter((e) => e.type === "text");
  const toolCount = toolEvents.length;

  if (isStreaming) {
    const lastTool = toolEvents[toolEvents.length - 1];
    let summary = "CLI Output · streaming";
    if (lastTool?.label) {
      summary += ` · ${lastTool.label}...`;
    } else if (lastTool?.name) {
      summary += ` · ${lastTool.name}...`;
    }
    return summary;
  }

  const parts: string[] = ["CLI Output · done"];

  if (toolCount > 0) {
    parts.push(`· ${toolCount} tool${toolCount > 1 ? "s" : ""}`);
  }

  if (durationMs) {
    parts.push(`· ${formatDuration(durationMs)}`);
  }

  // stdout 预览（取第一行前 40 字符）
  if (textEvents.length > 0) {
    const preview = textEvents[0].content?.trim().split("\n")[0]?.slice(0, 40);
    if (preview) {
      parts.push(`· stdout: ${preview}${preview.length >= 40 ? "…" : ""}`);
    }
  }

  return parts.join(" ");
}

// ── 工具行子组件 ────────────────────────────────────────────────

/**
 * ToolRow — 单行工具调用展示
 * 设计：[状态图标] [wrench] [工具名] [展开详情箭头]
 */
function ToolRow({
  event,
  result,
  isActive,
  accentColor,
}: {
  event: CliEvent;
  result?: CliEvent;
  isActive: boolean;
  accentColor: string;
}) {
  const [rowExpanded, setRowExpanded] = useState(false);
  const hasResult = !!result?.detail || !!result?.content;

  return (
    <div
      data-cli-block="tool-row"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "4px 6px",
        marginBottom: "2px",
        borderRadius: "var(--radius-sm, 4px)",
        background: isActive
          ? "color-mix(in srgb, var(--accent) 8%, transparent)"
          : "transparent",
        borderLeft: isActive ? `2px solid ${accentColor}` : "2px solid transparent",
      }}
    >
      <button
        type="button"
        onClick={() => setRowExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "none",
          border: "none",
          color: "var(--text)",
          cursor: "pointer",
          fontSize: "11px",
          fontFamily: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        {/* 状态图标 */}
        {isActive ? (
          <LoaderIcon color={accentColor} />
        ) : event.status === "failed" ? (
          <ErrorIcon />
        ) : (
          <CheckIcon />
        )}
        {/* 工具图标 */}
        <WrenchIcon color={isActive ? accentColor : "var(--muted)"} />
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
          <span style={{ color: isActive ? accentColor : "var(--text)", fontWeight: 600 }}>
            {event.name || event.label || "unknown"}
          </span>
          {event.input && (
            <span style={{ color: "var(--muted)" }}>
              ({event.input.slice(0, 60)}{event.input.length > 60 ? "…" : ""})
            </span>
          )}
        </span>
        {/* 展开箭头 */}
        {hasResult && (
          <span style={{ color: "var(--muted)", fontSize: "10px", flexShrink: 0 }}>
            {rowExpanded ? "▼" : "▶"}
          </span>
        )}
      </button>

      {/* 展开的结果详情 */}
      {rowExpanded && hasResult && (
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
          {result?.detail || result?.content || ""}
        </pre>
      )}
    </div>
  );
}

// ── 工具折叠区 ──────────────────────────────────────────────────

/**
 * ToolsSection — 可折叠的工具调用列表
 */
function ToolsSection({
  toolUses,
  toolResults,
  lastToolId,
  status,
  accentColor,
}: {
  toolUses: CliEvent[];
  toolResults: CliEvent[];
  lastToolId: string | undefined;
  status: string;
  accentColor: string;
}) {
  const isStreaming = status === "streaming";
  const [toolsCollapsed, setToolsCollapsed] = useState(isStreaming);

  // 流式时自动展开
  useEffect(() => {
    if (isStreaming) setToolsCollapsed(false);
  }, [isStreaming]);

  // 没有工具时隐藏
  if (toolUses.length === 0) return null;

  return (
    <div data-cli-block="tools" style={{ padding: "6px 10px" }}>
      {/* 折叠按钮 */}
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
        <ChevronIcon expanded={!toolsCollapsed} color="var(--muted)" />
        <span style={{ marginLeft: "4px" }}>
          {toolsCollapsed
            ? `${toolUses.length} tool${toolUses.length > 1 ? "s" : ""} (collapsed)`
            : `${toolUses.length} tool${toolUses.length > 1 ? "s" : ""}`}
        </span>
      </button>

      {/* 工具行列表 */}
      {!toolsCollapsed && (
        <div style={{ marginTop: "4px" }}>
          {toolUses.map((tool, idx) => {
            const result = toolResults[idx];
            // 使用 id 或 name+idx 作为唯一标识
            const toolId = `${tool.name || tool.label || "tool"}-${idx}`;
            return (
              <ToolRow
                key={toolId}
                event={tool}
                result={result}
                isActive={toolId === lastToolId}
                accentColor={accentColor}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CliDiagnosticsPanel（4 级严重度诊断面板） ───────────────────

/** 4 级严重度调色板 */
const SEVERITY_PALETTES = {
  /** Tier 1 — 用户必须修复（红色） */
  USER_FIX: {
    bg: "color-mix(in srgb, #ef4444 8%, transparent)",
    border: "color-mix(in srgb, #ef4444 30%, transparent)",
    accent: "#ef4444",
    text: "var(--text)",
  },
  /** Tier 2 — 临时性可重试（橙色） */
  TRANSIENT: {
    bg: "color-mix(in srgb, #f59e0b 8%, transparent)",
    border: "color-mix(in srgb, #f59e0b 30%, transparent)",
    accent: "#f59e0b",
    text: "var(--text)",
  },
  /** Tier 3 — 系统/环境（蓝色） */
  SYSTEM: {
    bg: "color-mix(in srgb, #3b82f6 8%, transparent)",
    border: "color-mix(in srgb, #3b82f6 30%, transparent)",
    accent: "#3b82f6",
    text: "var(--text)",
  },
  /** Tier 4 — 认知/上下文限制（紫色） */
  COGNITIVE: {
    bg: "color-mix(in srgb, #8b5cf6 8%, transparent)",
    border: "color-mix(in srgb, #8b5cf6 30%, transparent)",
    accent: "#8b5cf6",
    text: "var(--text)",
  },
};

/** 原因代码 → 严重度映射 */
const REASON_SEVERITY: Record<CliErrorReasonCode, keyof typeof SEVERITY_PALETTES> = {
  auth_failed: "USER_FIX",
  invalid_config: "USER_FIX",
  model_not_found: "USER_FIX",
  quota_exceeded: "TRANSIENT",
  network_error: "TRANSIENT",
  server_overloaded: "TRANSIENT",
  cli_response_timeout: "TRANSIENT",
  cli_stall_timeout: "TRANSIENT",
  spawn_failed: "SYSTEM",
  missing_rollout: "SYSTEM",
  session_not_found: "SYSTEM",
  context_window_exceeded: "COGNITIVE",
  invalid_thinking_signature: "COGNITIVE",
  tool_call_parse_failed: "COGNITIVE",
  silent_completion: "SYSTEM",
  upstream_policy_reject: "COGNITIVE",
};

/** 诊断原因图标映射 */
const REASON_ICONS: Record<CliErrorReasonCode, string> = {
  auth_failed: "🔑",
  invalid_config: "⚙️",
  model_not_found: "📦",
  quota_exceeded: "📊",
  network_error: "☁️",
  server_overloaded: "⏳",
  cli_response_timeout: "⏰",
  cli_stall_timeout: "⏰",
  spawn_failed: "💻",
  missing_rollout: "📄",
  session_not_found: "📄",
  context_window_exceeded: "💬",
  invalid_thinking_signature: "🧠",
  tool_call_parse_failed: "🔧",
  silent_completion: "❓",
  upstream_policy_reject: "🛡️",
};

/** 路径泄露清理（防止渲染用户路径） */
function sanitizePathLeaks(s: string): string {
  return s
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/\/home\/[^/\s]+/g, "~")
    .replace(/\/var\/root(?=[/\s]|$)/g, "~")
    .replace(/\/root(?=[/\s]|$)/g, "~")
    .replace(/C:\\Users\\[^\\\s]+/g, "~");
}

/** 截断中间文本 */
function truncateMiddle(s: string, max = 32): string {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/**
 * CliDiagnosticsPanel — CLI 错误诊断折叠面板
 *
 * 4 级严重度：
 *   - USER_FIX（红色）：用户必须修复配置/凭据
 *   - TRANSIENT（橙色）：临时性，可重试
 *   - SYSTEM（蓝色）：系统/环境问题
 *   - COGNITIVE（紫色）：认知/上下文限制
 */
export function CliDiagnosticsPanel({
  diagnostics,
  errorMessage,
}: {
  diagnostics: CliDiagnostics;
  errorMessage?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const severity = REASON_SEVERITY[diagnostics.reasonCode] || "SYSTEM";
  const palette = SEVERITY_PALETTES[severity];
  const icon = REASON_ICONS[diagnostics.reasonCode] || "❓";
  const summary = diagnostics.publicSummary || errorMessage || "CLI 执行错误";

  return (
    <div data-testid="cli-diagnostics" style={{ marginTop: "8px" }}>
      {/* 错误横幅 */}
      <div
        data-testid="cli-diagnostics-banner"
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
          borderRadius: "var(--radius-md, 8px)",
          backgroundColor: palette.bg,
          border: `1px solid ${palette.border}`,
          padding: "10px 14px",
        }}
      >
        <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>{icon}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: palette.text,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <span>{summary}</span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 400,
                padding: "1px 6px",
                borderRadius: "4px",
                backgroundColor: palette.accent,
                color: "#fff",
              }}
            >
              {severity}
            </span>
          </span>
          {diagnostics.publicHint && (
            <span
              style={{
                fontSize: "12px",
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              {diagnostics.publicHint}
            </span>
          )}
        </div>
      </div>

      {/* 详细错误折叠区 */}
      {diagnostics.safeExcerpt && (
        <>
          <button
            type="button"
            data-testid="cli-diagnostics-toggle"
            onClick={() => setExpanded(!expanded)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "6px 0",
              marginTop: "4px",
              color: "var(--muted)",
              fontSize: "12px",
              fontFamily: "inherit",
            }}
          >
            <ChevronIcon expanded={expanded} color="var(--muted)" />
            <span>查看详细错误</span>
          </button>
          {expanded && (
            <pre
              data-testid="cli-diagnostics-excerpt"
              style={{
                borderRadius: "var(--radius-md, 8px)",
                overflowX: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "11px",
                fontFamily: "var(--font-mono, monospace)",
                margin: 0,
                backgroundColor: "var(--bg-elevated)",
                color: "var(--text)",
                padding: "12px 14px",
                lineHeight: 1.5,
              }}
            >
              {diagnostics.safeExcerpt}
            </pre>
          )}
        </>
      )}

      {/* debugRef 信息条 */}
      <div
        data-testid="cli-diagnostics-debug-ref"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 12px",
          fontSize: "11px",
          color: "var(--muted)",
          marginTop: "6px",
        }}
      >
        <span>
          <span style={{ fontWeight: 500 }}>command:</span>{" "}
          {truncateMiddle(sanitizePathLeaks(diagnostics.debugRef.command), 40)}
        </span>
        {diagnostics.debugRef.exitCode != null && (
          <span>
            <span style={{ fontWeight: 500 }}>exit:</span> {diagnostics.debugRef.exitCode}
          </span>
        )}
        {diagnostics.debugRef.signal != null && (
          <span>
            <span style={{ fontWeight: 500 }}>signal:</span> {String(diagnostics.debugRef.signal)}
          </span>
        )}
        {diagnostics.debugRef.invocationId && (
          <span>
            <span style={{ fontWeight: 500 }}>invocationId:</span>{" "}
            {truncateMiddle(diagnostics.debugRef.invocationId, 24)}
          </span>
        )}
      </div>
    </div>
  );
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
  /** 折叠状态持久化 key */
  disclosureKey?: string;
  /** 诊断信息（可选，当 CLI 执行出错时传入） */
  diagnostics?: CliDiagnostics | null;
  /** 错误消息（当 diagnostics 没有 publicSummary 时的回退） */
  errorMessage?: string;
}

export default function CliOutputBlock({
  meta,
  isStreaming = false,
  defaultExpanded,
  accentColor = "var(--accent)",
  disclosureKey,
  diagnostics,
  errorMessage,
}: CliOutputBlockProps) {
  const events = useMemo(() => toCliEvents(meta), [meta]);

  const summary = useMemo(
    () => buildSummary(events, isStreaming, meta?.duration_ms),
    [events, isStreaming, meta?.duration_ms],
  );

  // 折叠状态（支持 localStorage 持久化）
  const storageKey = disclosureKey ? `flowforge:cli-block:${disclosureKey}` : null;
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (defaultExpanded !== undefined) return defaultExpanded;
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored !== null) return stored === "1";
      } catch {
        /* ignore */
      }
    }
    return isStreaming;
  });

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
      } catch {
        /* ignore */
      }
    }
  }, [expanded, storageKey]);

  // 无事件且无诊断时不渲染
  if (events.length === 0 && !diagnostics) return null;

  const toggleExpanded = () => {
    userInteracted.current = true;
    setExpanded((v) => !v);
  };

  const toolUses = events.filter((e) => e.type === "tool_use");
  const toolResults = events.filter((e) => e.type === "tool_result");
  const textEvents = events.filter((e) => e.type === "text");
  // 最后一个正在流式的工具 ID（用于高亮）
  const lastToolId = isStreaming
    ? toolUses.length > 0
      ? `${toolUses[toolUses.length - 1].name || "tool"}-${toolUses.length - 1}`
      : undefined
    : undefined;

  return (
    <div
      data-cli-block="root"
      style={{
        marginTop: "8px",
        marginBottom: "4px",
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
        <span style={{ color: accentColor }}>
          <ChevronIcon expanded={expanded} />
        </span>
        {/* 摘要 */}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
        {/* 流式旋转指示器 */}
        {isStreaming && (
          <span className="flowforge-cli-spinner" style={{ flexShrink: 0 }} />
        )}
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div data-cli-block="body" style={{ borderTop: "1px solid var(--border)" }}>
          {/* 工具调用区 */}
          {toolUses.length > 0 && (
            <ToolsSection
              toolUses={toolUses}
              toolResults={toolResults}
              lastToolId={lastToolId}
              status={isStreaming ? "streaming" : "done"}
              accentColor={accentColor}
            />
          )}

          {/* stdout 文本区 */}
          {textEvents.length > 0 && (
            <div
              data-cli-block="stdout"
              style={{
                padding: "6px 10px",
                borderTop: toolUses.length > 0 ? "1px solid var(--border)" : "none",
              }}
            >
              {toolUses.length > 0 && (
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
              )}
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

          {/* 诊断面板（当 CLI 执行出错时显示） */}
          {diagnostics && (
            <div
              style={{
                padding: "6px 10px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <CliDiagnosticsPanel diagnostics={diagnostics} errorMessage={errorMessage} />
            </div>
          )}
        </div>
      )}

      {/* 旋转动画 */}
      <style>{`
        .flowforge-cli-spinner {
          width: 12px;
          height: 12px;
          border: 2px solid var(--border);
          border-top-color: ${accentColor};
          border-radius: 50%;
          animation: flowforge-cli-spin 0.8s linear infinite;
          display: inline-block;
        }
        @keyframes flowforge-cli-spin {
          to { transform: rotate(360deg); }
        }
        .animate-spin {
          animation: flowforge-cli-spin 0.8s linear infinite;
        }
      `}</style>
    </div>
  );
}
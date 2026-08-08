"use client";

/**
 * HubClaudeRescueSection — Claude 会话救援中心
 *
 * 用于 /admin/observability 或 /admin/settings?s=tools，扫描本机
 * ~/.claude/projects/**/*.jsonl 中的坏 thinking signature session
 * 并提供一键修复（删除纯 thinking-only assistant turn，执行前自动备份）。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 var(--cafe-xxx) CSS 变量保持与 FlowForge 暗色主题一致。
 * 独立性：内联 Toast 原语，不依赖上游
 *
 * API 端点（FlowForge 风格）：
 *   - GET  /api/v1/claude-rescue/sessions   扫描需要救援的 session
 *   - POST /api/v1/claude-rescue/rescue     执行救援
 *
 * 当 API 不可用时（如后端未启动或端点未实现），graceful degradation：
 * 显示错误提示，不阻塞页面其他部分。
 */

import { useCallback, useEffect, useMemo, useState } from "react";

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

interface ClaudeRescueSessionItem {
  sessionId: string;
  transcriptPath: string;
  removableThinkingTurns: number;
  detectedBy: "api_error_entry" | "short_signature";
}

interface ClaudeRescueResultItem {
  sessionId: string;
  status: "repaired" | "clean" | "missing";
  removedTurns: number;
  backupPath: string | null;
  reason?: string;
}

interface ClaudeRescueRunResult {
  status: "ok" | "partial" | "noop";
  rescuedCount: number;
  skippedCount: number;
  results: ClaudeRescueResultItem[];
}

interface ToastMsg {
  id: number;
  type: "success" | "error" | "info";
  title: string;
  message?: string;
  duration?: number;
}

/* ------------------------------------------------------------------ */
/* 内联 Toast 原语                                                     */
/* ------------------------------------------------------------------ */

let toastIdSeq = 0;

function useInlineToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((t: Omit<ToastMsg, "id">) => {
    const id = ++toastIdSeq;
    const toast: ToastMsg = { id, ...t };
    setToasts((prev) => [...prev, toast]);
    if (t.duration && t.duration > 0) {
      window.setTimeout(() => remove(id), t.duration);
    }
    return id;
  }, [remove]);

  return { toasts, addToast, remove };
}

/* ------------------------------------------------------------------ */
/* 辅助函数                                                            */
/* ------------------------------------------------------------------ */

function describeDetection(session: ClaudeRescueSessionItem): string {
  if (session.detectedBy === "api_error_entry") {
    return "已命中 Invalid signature API error";
  }
  return "已命中救援规则";
}

/* ------------------------------------------------------------------ */
/* HubClaudeRescueSection 主组件                                       */
/* ------------------------------------------------------------------ */

export function HubClaudeRescueSection() {
  const { toasts, addToast, remove } = useInlineToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rescuing, setRescuing] = useState(false);
  const [sessions, setSessions] = useState<ClaudeRescueSessionItem[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [lastRun, setLastRun] = useState<ClaudeRescueRunResult | null>(null);

  const scanSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/claude-rescue/sessions");
      const body = (await res.json().catch(() => ({}))) as {
        sessions?: ClaudeRescueSessionItem[];
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `扫描失败 (${res.status})`);
        return;
      }
      const nextSessions = [...(body.sessions ?? [])].sort((a, b) =>
        a.sessionId.localeCompare(b.sessionId),
      );
      setSessions(nextSessions);
      setSelectedSessionIds(nextSessions.map((s) => s.sessionId));
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void scanSessions();
  }, [scanSessions]);

  const selectedTargets = useMemo(
    () => sessions.filter((s) => selectedSessionIds.includes(s.sessionId)),
    [selectedSessionIds, sessions],
  );

  const toggleSession = useCallback((sessionId: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(sessionId)
        ? prev.filter((id) => id !== sessionId)
        : [...prev, sessionId].sort(),
    );
  }, []);

  const rescueSelected = useCallback(async () => {
    if (selectedTargets.length === 0 || rescuing) return;

    setRescuing(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/claude-rescue/rescue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIds: selectedTargets.map((t) => t.sessionId),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ClaudeRescueRunResult & {
        error?: string;
      };
      if (!res.ok) {
        const message = body.error ?? `救援失败 (${res.status})`;
        setError(message);
        addToast({
          type: "error",
          title: "救援失败",
          message,
          duration: 5000,
        });
        return;
      }

      setLastRun(body);
      addToast({
        type: body.rescuedCount > 0 ? "success" : "info",
        title: body.rescuedCount > 0 ? "救援成功" : "无需救援",
        message:
          body.rescuedCount > 0
            ? `救活 ${body.rescuedCount} 个 session，跳过 ${body.skippedCount} 个。`
            : "没有需要动刀的坏 session。",
        duration: 3500,
      });
      await scanSessions();
    } catch {
      setError("网络错误");
      addToast({
        type: "error",
        title: "救援失败",
        message: "网络错误",
        duration: 5000,
      });
    } finally {
      setRescuing(false);
    }
  }, [addToast, rescuing, scanSessions, selectedTargets]);

  return (
    <section
      className="rounded-lg p-3 space-y-3"
      style={{
        border: "1px solid var(--conn-amber-ring,rgba(245,158,11,0.35))",
        background: "var(--conn-amber-bg,rgba(245,158,11,0.10))",
      }}
      data-hub-claude-rescue="root"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h4
            className="text-xs font-semibold"
            style={{ color: "var(--conn-amber-text,#f59e0b)" }}
          >
            Claude 会话救援中心
          </h4>
          <button
            type="button"
            onClick={() => {
              void scanSessions();
            }}
            disabled={loading || rescuing}
            className="px-2.5 py-1 rounded border text-xs transition-colors disabled:opacity-50"
            style={{
              borderColor: "var(--conn-amber-ring,rgba(245,158,11,0.35))",
              background: "var(--cafe-surface,#1e1f26)",
              color: "var(--conn-amber-text,#f59e0b)",
            }}
            data-hub-claude-rescue-action="rescan"
          >
            {loading ? "扫描中..." : "重新扫描"}
          </button>
        </div>
        <p
          className="text-xs"
          style={{ color: "var(--conn-amber-text,#f59e0b)" }}
        >
          专治 Claude session 的坏 thinking signature。执行前会自动备份
          transcript，只会移除纯 thinking-only assistant turn。
        </p>
        <p
          className="text-xs"
          style={{ color: "var(--conn-amber-text,#f59e0b)" }}
        >
          扫描范围：当前机器上的{" "}
          <code className="font-mono">~/.claude/projects/**/*.jsonl</code>
        </p>
      </div>

      {error && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            border: "1px solid var(--conn-red-ring,rgba(239,68,68,0.35))",
            background: "var(--conn-red-bg,rgba(239,68,68,0.10))",
            color: "var(--conn-red-text,#ef4444)",
          }}
          data-hub-claude-rescue-error="scan"
        >
          {error}
        </div>
      )}

      {lastRun && (
        <div
          className="rounded-lg px-3 py-2 text-xs space-y-1"
          style={{
            border: "1px solid var(--semantic-success,rgba(16,185,129,0.35))",
            background: "var(--semantic-success-surface,rgba(16,185,129,0.10))",
            color: "var(--conn-emerald-text,#10b981)",
          }}
          data-hub-claude-rescue-result="last-run"
        >
          <p className="font-medium">刚刚修复 {lastRun.rescuedCount} 个 session</p>
          <p>
            跳过 {lastRun.skippedCount} 个，处理 {lastRun.results.length} 个 session。
          </p>
        </div>
      )}

      {loading ? (
        <p
          className="text-xs"
          style={{ color: "var(--conn-amber-text,#f59e0b)" }}
        >
          扫描中...
        </p>
      ) : sessions.length === 0 ? (
        <p
          className="text-xs"
          style={{ color: "var(--conn-amber-text,#f59e0b)" }}
        >
          暂未发现坏掉的 Claude session
        </p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <p
              className="text-xs font-medium"
              style={{ color: "var(--conn-amber-text,#f59e0b)" }}
            >
              检测到 {sessions.length} 个 Claude session 需要救援
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--conn-amber-text,#f59e0b)" }}
            >
              先勾选要动刀的 session，再执行一键修复。
            </p>
          </div>
          <div className="space-y-2">
            {sessions.map((session) => {
              const checked = selectedSessionIds.includes(session.sessionId);
              return (
                <label
                  key={session.sessionId}
                  className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                  style={{
                    border: "1px solid var(--conn-amber-ring,rgba(245,158,11,0.35))",
                    background: "var(--cafe-surface,#1e1f26)",
                    color: "var(--cafe-text-secondary,#9ca3af)",
                  }}
                  data-hub-claude-rescue-session={session.sessionId}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSession(session.sessionId)}
                    className="mt-0.5"
                    data-hub-claude-rescue-input="select"
                  />
                  <span className="space-y-0.5">
                    <span
                      className="block font-medium"
                      style={{ color: "var(--cafe-text,#e5e7eb)" }}
                    >
                      {session.sessionId}
                    </span>
                    <span
                      className="block"
                      style={{ color: "var(--conn-amber-text,#f59e0b)" }}
                    >
                      纯 thinking turn：{session.removableThinkingTurns} 条
                    </span>
                    <span
                      className="block break-all"
                      style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
                    >
                      {session.transcriptPath}
                    </span>
                    <span
                      className="block"
                      style={{ color: "var(--cafe-text-secondary,#9ca3af)" }}
                    >
                      {describeDetection(session)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              void rescueSelected();
            }}
            disabled={rescuing || selectedTargets.length === 0}
            className="px-3 py-1.5 rounded text-xs disabled:opacity-50"
            style={{
              background: "var(--semantic-warning,#f59e0b)",
              color: "var(--cafe-surface,#1e1f26)",
              border: "none",
              fontWeight: 600,
            }}
            data-hub-claude-rescue-action="rescue"
          >
            {rescuing
              ? "救援中..."
              : `一键修复 ${selectedTargets.length} 个 session`}
          </button>
        </div>
      )}

      {/* Toast 容器 */}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-4 right-4 space-y-2 z-50"
          data-hub-claude-rescue-toasts="container"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className="rounded-lg px-3 py-2 text-xs shadow-lg max-w-xs"
              style={{
                background:
                  t.type === "error"
                    ? "var(--conn-red-bg,rgba(239,68,68,0.20))"
                    : t.type === "success"
                      ? "var(--conn-emerald-bg,rgba(16,185,129,0.20))"
                      : "var(--cafe-surface-elevated,#15151c)",
                color:
                  t.type === "error"
                    ? "var(--conn-red-text,#ef4444)"
                    : t.type === "success"
                      ? "var(--conn-emerald-text,#10b981)"
                      : "var(--cafe-text,#e5e7eb)",
                border: "1px solid var(--cafe-border,#2a2c3a)",
              }}
              data-hub-claude-rescue-toast={t.id}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="font-semibold">{t.title}</div>
                  {t.message && <div>{t.message}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="text-base leading-none px-1 opacity-60 hover:opacity-100"
                  aria-label="关闭提示"
                  data-hub-claude-rescue-toast-action="close"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default HubClaudeRescueSection;

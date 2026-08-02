"use client";

/**
 * ExternalAgentList — 外部接入智能体列表
 *
 *   Claude Code / Codex / OpenCode / Trae / Gemini（通过 ExternalAgentAdapter）
 *
 * 数据来源：/api/v1/external-agents
 */

import { useEffect, useState } from "react";

interface ExternalAgentDef {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const EXTERNAL_AGENTS: ExternalAgentDef[] = [
  { id: "claude_code", name: "Claude Code", icon: "🤖", description: "Anthropic Claude CLI 编码助手" },
  { id: "codex", name: "Codex", icon: "📦", description: "OpenAI Codex CLI 编码助手" },
  { id: "opencode", name: "OpenCode", icon: "🔓", description: "开源编码助手" },
  { id: "trae", name: "Trae", icon: "🎯", description: "Trae IDE 集成（仅 IDE 内可用）" },
  { id: "gemini", name: "Gemini", icon: "♊", description: "Google Gemini CLI 编码助手" },
];

interface ExternalAgentStatus {
  id: string;
  status: "pass" | "skip" | "fail";
  reason?: string;
}

export function ExternalAgentList() {
  const [statuses, setStatuses] = useState<Record<string, ExternalAgentStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/external-agents")
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, ExternalAgentStatus> = {};
        for (const item of data.agents || data || []) {
          map[item.id] = {
            id: item.id,
            status: item.status === "pass" ? "pass" : item.status === "skip" ? "skip" : "fail",
            reason: item.reason || item.message,
          };
        }
        setStatuses(map);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-3" data-external-agent-list="root">
      <div className="text-xs text-[var(--cafe-text-muted,#6b7280)] uppercase tracking-wider mb-2">
        外部接入智能体（{EXTERNAL_AGENTS.length} 种）
      </div>
      {EXTERNAL_AGENTS.map((agent) => {
        const status = statuses[agent.id];
        const statusInfo = loading
          ? { label: "检查中...", color: "var(--semantic-warning,#f59e0b)", bg: "var(--semantic-warning-surface,rgba(245,158,11,0.15))" }
          : status?.status === "pass"
            ? { label: "PASS", color: "var(--semantic-success,#22c55e)", bg: "var(--semantic-success-surface,rgba(34,197,94,0.15))" }
            : status?.status === "skip"
              ? { label: "SKIP", color: "var(--semantic-warning,#f59e0b)", bg: "var(--semantic-warning-surface,rgba(245,158,11,0.15))" }
              : { label: "FAIL", color: "var(--semantic-critical,#ef4444)", bg: "var(--semantic-critical-surface,rgba(239,68,68,0.15))" };

        return (
          <div
            key={agent.id}
            className="flex items-start gap-3 p-3 rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)]"
            data-external-agent={agent.id}
            data-external-agent-status={status?.status || "unknown"}
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xl bg-[var(--console-rail-item,#252633)]">
              {agent.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-sm font-semibold text-[var(--cafe-text,#e5e7eb)]">
                  {agent.name}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-medium"
                  style={{ background: statusInfo.bg, color: statusInfo.color }}
                >
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-xs text-[var(--cafe-text-secondary,#9ca3af)] leading-relaxed">
                {agent.description}
              </p>
              {status?.reason && (
                <p className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] mt-1">
                  {status.reason}
                </p>
              )}
            </div>
            <button
              type="button"
              className="flex-shrink-0 text-xs px-3 py-1.5 rounded bg-[var(--console-rail-item,#252633)] text-[var(--cafe-text-secondary,#9ca3af)] hover:text-[var(--cafe-text,#e5e7eb)] transition-colors"
              data-external-agent-action="configure"
            >
              配置
            </button>
          </div>
        );
      })}
    </div>
  );
}

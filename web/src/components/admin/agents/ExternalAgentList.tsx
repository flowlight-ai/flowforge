"use client";

/**
 * ExternalAgentList — 外部接入智能体列表
 *
 * 依据 WEB-FUSION-DESIGN.md §6.3：
 *   Claude Code / Codex / OpenCode / Trae / Gemini / CodeBuddy / Qoder / iFlow / Kimi
 *
 * 数据来源：/api/v1/external-agents
 *   每个智能体项含连通性状态 + bound_forgekins 绑定关系。
 *
 * 命名规范：使用 P0 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

import { useEffect, useState } from "react";
import Link from "next/link";

/** 绑定的灵智体信息（来自后端 bound_forgekins 字段） */
interface BoundForgekin {
  id: string;
  name: string;
  model: string;
  mode: string;
}

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
  { id: "gemini", name: "Gemini", icon: "♊", description: "Google Gemini CLI 编码助手" },
  { id: "codebuddy", name: "CodeBuddy", icon: "🐛", description: "腾讯 CodeBuddy 编码助手" },
  { id: "qodercli", name: "Qoder CLI", icon: "☁️", description: "Qoder 云编码助手（需 Qoder 账号登录）" },
  { id: "iflow", name: "iFlow CLI", icon: "🌊", description: "iFlow CLI（OpenAI-Compatible API）" },
  { id: "kimi", name: "Kimi CLI", icon: "🌙", description: "月之暗面 Kimi CLI 编码助手" },
  { id: "trae", name: "Trae", icon: "🎯", description: "Trae IDE 集成（仅 IDE 内可用）" },
  { id: "trae_cn_ide", name: "Trae CN IDE", icon: "🛠️", description: "Trae CN IDE 集成（仅 IDE 内可用）" },
];

interface ExternalAgentStatus {
  id: string;
  status: "pass" | "skip" | "fail";
  reason?: string;
  bound_forgekins?: BoundForgekin[];
  bound_count?: number;
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
            bound_forgekins: item.bound_forgekins || [],
            bound_count: item.bound_count || 0,
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

        const boundForgekins = status?.bound_forgekins || [];
        const isBound = boundForgekins.length > 0;

        return (
          <div
            key={agent.id}
            className="flex items-start gap-3 p-3 rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)]"
            data-external-agent={agent.id}
            data-external-agent-status={status?.status || "unknown"}
            data-external-agent-bound={isBound ? "true" : "false"}
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
                {/* 绑定状态徽章 */}
                {isBound ? (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      background: "var(--semantic-info-surface,rgba(59,130,246,0.15))",
                      color: "var(--semantic-info,#3b82f6)",
                    }}
                    data-external-agent-bound-count={boundForgekins.length}
                  >
                    绑定 {boundForgekins.length} 个灵智体
                  </span>
                ) : (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{
                      background: "var(--cafe-surface-sunken,#0f1015)",
                      color: "var(--cafe-text-muted,#6b7280)",
                    }}
                  >
                    未绑定
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--cafe-text-secondary,#9ca3af)] leading-relaxed">
                {agent.description}
              </p>
              {status?.reason && (
                <p className="text-[10px] text-[var(--cafe-text-muted,#6b7280)] mt-1">
                  {status.reason}
                </p>
              )}
              {/* 绑定的灵智体列表 */}
              {isBound && (
                <div className="mt-2 space-y-1" data-external-agent-bound-list="true">
                  {boundForgekins.map((fk) => (
                    <Link
                      key={fk.id}
                      href={`/admin/agents/${fk.id}?action=edit`}
                      className="flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors hover:bg-[var(--console-rail-item,#252633)] group"
                      data-external-agent-bound-forgekin={fk.id}
                    >
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full"
                        style={{ background: "var(--semantic-info,#3b82f6)" }}
                      />
                      <span className="font-medium text-[var(--cafe-text,#e5e7eb)] group-hover:text-[var(--cafe-accent,#ff5c5c)] transition-colors">
                        {fk.name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--cafe-text-muted,#6b7280)]">
                        {fk.id}
                      </span>
                      {fk.model && (
                        <span className="font-mono text-[10px] text-[var(--cafe-text-secondary,#9ca3af)]">
                          · {fk.model}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-[var(--cafe-text-muted,#6b7280)] group-hover:text-[var(--cafe-accent,#ff5c5c)] transition-colors">
                        编辑 →
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

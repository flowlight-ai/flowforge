"use client";

/**
 * AgentStatusTable — Agent 熔断器状态表（老版保留）
 *
 * 来源：老版 flowforge /admin/agents page.tsx 的 Agent 状态模块
 *
 * 位置：Tab 2（静态智能体）底部，展示所有 Agent 的运行状态与熔断器监控。
 *
 * 命名规范：使用 P0 "智能体"（非 "灵智体"）
 */

import { useEffect, useState } from "react";
import { AgentGuardStatus } from "@/lib/types";

export function AgentStatusTable() {
  const [agents, setAgents] = useState<AgentGuardStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/system/agents")
      .then((r) => r.json())
      .then((data) => setAgents(data.agents || data.agent_guards || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stateStyle = (s: string): React.CSSProperties => {
    if (s === "closed")
      return { background: "var(--semantic-success-surface,rgba(34,197,94,0.15))", color: "var(--semantic-success,#22c55e)" };
    if (s === "open")
      return { background: "var(--semantic-critical-surface,rgba(239,68,68,0.15))", color: "var(--semantic-critical,#ef4444)" };
    return { background: "var(--semantic-warning-surface,rgba(245,158,11,0.15))", color: "var(--semantic-warning,#f59e0b)" };
  };

  const stateLabel = (s: string) => {
    if (s === "closed") return "正常";
    if (s === "open") return "熔断";
    return "半开";
  };

  return (
    <div
      className="mt-6 rounded-lg border border-[var(--cafe-border,#2a2c3a)] bg-[var(--cafe-surface-elevated,#15151c)] p-4"
      data-agent-status-table="root"
    >
      <h3 className="text-sm font-semibold text-[var(--cafe-text,#e5e7eb)] mb-1">
        智能体熔断器状态
      </h3>
      <p className="text-xs text-[var(--cafe-text-muted,#6b7280)] mb-3">
        所有智能体运行状态与熔断器监控
      </p>

      {loading ? (
        <div className="text-sm text-[var(--cafe-text-muted,#6b7280)] py-4 text-center">
          加载中...
        </div>
      ) : agents.length === 0 ? (
        <div className="text-sm text-[var(--cafe-text-muted,#6b7280)] py-4 text-center">
          暂无智能体状态数据
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cafe-border-subtle,#2a2c3a)] text-left text-xs text-[var(--cafe-text-muted,#6b7280)] uppercase">
                <th className="py-2 pr-4">智能体</th>
                <th className="py-2 pr-4">熔断状态</th>
                <th className="py-2 pr-4">可用</th>
                <th className="py-2 pr-4">失败次数</th>
                <th className="py-2 pr-4">超时(秒)</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr
                  key={a.agent_name}
                  className="border-b border-[var(--cafe-border-subtle,#2a2c3a)] last:border-0"
                  data-agent-status-row={a.agent_name}
                >
                  <td className="py-2 pr-4 font-mono text-xs text-[var(--cafe-text,#e5e7eb)]">
                    {a.agent_name}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className="inline-block text-xs px-2 py-0.5 rounded font-medium"
                      style={stateStyle(a.circuit_state)}
                    >
                      {stateLabel(a.circuit_state)}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className="font-bold"
                      style={{
                        color: a.is_available
                          ? "var(--semantic-success,#22c55e)"
                          : "var(--semantic-critical,#ef4444)",
                      }}
                    >
                      {a.is_available ? "✓" : "✗"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-[var(--cafe-text-secondary,#9ca3af)]">
                    {a.failure_count}
                  </td>
                  <td className="py-2 pr-4 text-[var(--cafe-text-secondary,#9ca3af)]">
                    {a.timeout_seconds}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

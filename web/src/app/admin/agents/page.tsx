"use client";

import { useState, useEffect } from "react";
import { AgentGuardStatus } from "@/lib/types";

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentGuardStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/system/agents")
      .then((r) => r.json())
      .then((data) =>
        setAgents(data.agents || data.agent_guards || [])
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stateStyle = (s: string): React.CSSProperties => {
    if (s === "closed")
      return { background: "var(--ok-subtle)", color: "var(--ok)" };
    if (s === "open")
      return { background: "var(--danger-subtle)", color: "var(--danger)" };
    return { background: "var(--warn-subtle)", color: "var(--warn)" };
  };

  const stateLabel = (s: string) => {
    if (s === "closed") return "正常";
    if (s === "open") return "熔断";
    return "半开";
  };

  return (
    <div className="animate-rise">
      <div className="card">
        <h2 className="page-title" style={{ margin: "0 0 4px" }}>
          Agent 状态
        </h2>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          Agent 运行状态与熔断器监控
        </p>

        {loading ? (
          <div className="empty">
            <div className="spinner" />
            加载中...
          </div>
        ) : agents.length === 0 ? (
          <div className="empty">暂无 Agent 状态数据</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>熔断状态</th>
                <th>可用</th>
                <th>失败次数</th>
                <th>超时(秒)</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.agent_name}>
                  <td
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: "12px",
                    }}
                  >
                    {a.agent_name}
                  </td>
                  <td>
                    <span className="pill" style={stateStyle(a.circuit_state)}>
                      {stateLabel(a.circuit_state)}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        color: a.is_available
                          ? "var(--ok)"
                          : "var(--danger)",
                        fontWeight: 600,
                      }}
                    >
                      {a.is_available ? "✓" : "✗"}
                    </span>
                  </td>
                  <td>{a.failure_count}</td>
                  <td>{a.timeout_seconds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

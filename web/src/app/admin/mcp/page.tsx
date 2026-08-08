"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * MCP 管理页面 — 合并 MCPConfigPanel + clowder-ai mcp section
 *
 * 管理 MCP（Model Context Protocol）服务器和工具目录
 * 详见 MERGE-SPEC.md §3.3 F6 MCP 配置合并
 */

interface McpServer {
  name: string;
  url?: string;
  command?: string;
  status: "running" | "stopped" | "error" | "unknown";
  tools_count?: number;
  description?: string;
}

export default function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);

  const loadServers = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/system/mcp-servers");
      const data = await res.json();
      const list = data?.data?.servers || data?.servers || [];
      setServers(Array.isArray(list) ? list : []);
    } catch {
      setServers([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const statusBadge = (status: McpServer["status"]) => {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      running: { bg: "rgba(34,197,94,0.12)", color: "#22c55e", label: "运行中" },
      stopped: { bg: "rgba(107,114,128,0.12)", color: "#6b7280", label: "已停止" },
      error: { bg: "rgba(239,68,68,0.12)", color: "#ef4444", label: "错误" },
      unknown: { bg: "rgba(234,179,8,0.12)", color: "#eab308", label: "未知" },
    };
    const s = map[status] || map.unknown;
    return (
      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "10px", fontSize: "11px", fontWeight: 600, background: s.bg, color: s.color }}>
        {s.label}
      </span>
    );
  };

  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>MCP 管理</h2>
          <button
            onClick={loadServers}
            style={{
              padding: "6px 14px", borderRadius: "6px",
              border: "1px solid var(--border)", background: "var(--bg-elevated)",
              color: "var(--muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600,
            }}
          >
            🔄 刷新
          </button>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          MCP 服务器、工具目录、浏览器自动化依赖 · 合并 MCPConfigPanel
        </p>

        {loading ? (
          <div className="empty">加载中...</div>
        ) : servers.length === 0 ? (
          <div className="empty">
            <div style={{ marginBottom: "8px" }}>暂无 MCP 服务器配置</div>
            <div style={{ fontSize: "11px", color: "var(--muted)" }}>
              MCP 服务器配置在 flowforge/mcp/ 目录下管理
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {servers.map((srv) => (
              <div
                key={srv.name}
                style={{
                  padding: "12px 16px",
                  borderRadius: "8px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>
                    📦 {srv.name}
                  </span>
                  {statusBadge(srv.status)}
                  {srv.tools_count !== undefined && (
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                      {srv.tools_count} 个工具
                    </span>
                  )}
                </div>
                {srv.url && (
                  <div style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "monospace" }}>
                    URL: {srv.url}
                  </div>
                )}
                {srv.command && (
                  <div style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "monospace" }}>
                    CMD: {srv.command}
                  </div>
                )}
                {srv.description && (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                    {srv.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{
          marginTop: "16px", padding: "12px 16px",
          background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: "8px", fontSize: "12px", color: "var(--text-secondary)",
        }}>
          <strong style={{ color: "#a78bfa" }}>💡 MCP 说明</strong>
          <div style={{ marginTop: "4px", lineHeight: 1.5 }}>
            Model Context Protocol (MCP) 是 Anthropic 推出的开放协议，用于标准化 AI 模型与外部工具的交互。
            FlowForge 通过 MCP 网关接入浏览器自动化、文件系统、代码执行等能力。
          </div>
        </div>
      </div>
    </div>
  );
}

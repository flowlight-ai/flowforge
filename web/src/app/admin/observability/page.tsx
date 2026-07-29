"use client";

import { useState, useEffect, useCallback } from "react";
import { HubObservabilityTab } from "@/components/hub/HubObservabilityTab";

/**
 * 可观测性页面 — 使用 HubObservabilityTab + 保留日志查看器
 *
 * 整合 HubObservabilityTab（服务健康/运行时会话/回调认证）
 * 与 FlowForge 原有日志查看器，形成完整的可观测性中心。
 *
 * 日志查看器为 FlowForge 原有功能，作为补充保留。
 */

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  service: string;
  message: string;
}

export default function ObservabilityPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logFilter, setLogFilter] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState<string>("all");

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/logs?limit=100");
      const data = await res.json();
      const logList = data?.data?.logs || data?.logs || [];
      setLogs(Array.isArray(logList) ? logList : []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 30000);
    return () => clearInterval(interval);
  }, [loadLogs]);

  const filteredLogs = logs.filter((log) => {
    if (logLevelFilter !== "all" && log.level !== logLevelFilter) return false;
    if (logFilter) {
      const text = `${log.timestamp} ${log.level} ${log.service} ${log.message}`.toLowerCase();
      if (!text.includes(logFilter.toLowerCase())) return false;
    }
    return true;
  });

  const levelColor = (level: LogEntry["level"]) => {
    const map: Record<string, string> = {
      ERROR: "#ef4444",
      WARN: "#eab308",
      INFO: "#3b82f6",
      DEBUG: "#6b7280",
    };
    return map[level] || "#6b7280";
  };

  return (
    <div className="animate-rise">
      <div className="card" style={{ paddingBottom: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>可观测性</h2>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          服务健康、运行时会话、回调认证、实时日志 · HubObservabilityTab
        </p>

        {/* Hub 可观测性核心：服务健康/运行时会话/回调认证 */}
        <div style={{ marginBottom: "24px" }}>
          <HubObservabilityTab />
        </div>

        {/* 日志查看器（FlowForge 原有功能保留） */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", margin: 0 }}>
              实时日志 ({filteredLogs.length})
            </h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <select
                value={logLevelFilter}
                onChange={(e) => setLogLevelFilter(e.target.value)}
                style={{
                  padding: "4px 8px", borderRadius: "6px",
                  border: "1px solid var(--border)", background: "var(--bg)",
                  color: "var(--text)", fontSize: "11px",
                }}
              >
                <option value="all">全部级别</option>
                <option value="ERROR">ERROR</option>
                <option value="WARN">WARN</option>
                <option value="INFO">INFO</option>
                <option value="DEBUG">DEBUG</option>
              </select>
              <input
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                placeholder="搜索日志..."
                style={{
                  padding: "4px 10px", borderRadius: "6px",
                  border: "1px solid var(--border)", background: "var(--bg)",
                  color: "var(--text)", fontSize: "11px", width: "200px",
                }}
              />
            </div>
          </div>
          <div style={{
            background: "#1e1e2e", borderRadius: "8px", padding: "12px",
            fontFamily: "monospace", fontSize: "11px",
            maxHeight: "400px", overflowY: "auto",
          }}>
            {logsLoading ? (
              <div style={{ color: "#585b70", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                加载日志中...
              </div>
            ) : filteredLogs.length === 0 ? (
              <div style={{ color: "#585b70", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                暂无日志
              </div>
            ) : (
              filteredLogs.map((log, idx) => (
                <div key={idx} style={{ marginBottom: "4px", display: "flex", gap: "8px" }}>
                  <span style={{ color: "#585b70", flexShrink: 0 }}>{log.timestamp}</span>
                  <span style={{ color: levelColor(log.level), fontWeight: 600, minWidth: "50px" }}>{log.level}</span>
                  {log.service && (
                    <span style={{ color: "#89b4fa", minWidth: "80px" }}>[{log.service}]</span>
                  )}
                  <span style={{ color: "#cdd6f4", flex: 1 }}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

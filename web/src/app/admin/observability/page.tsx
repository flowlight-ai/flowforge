"use client";

import { useState, useEffect, useCallback } from "react";
import { HubObservabilityTab } from "@/components/hub/HubObservabilityTab";

/**
 * 可观测性页面 - HubObservabilityTab + 自进化运行状态 + 保留日志查看器
 * 自进化状态区块调用 /api/v1/forgemind/autonomous/* 接口展示自我进化与自我工作记录
 */

interface LogEntry {
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "DEBUG";
  service: string;
  message: string;
}

interface AutonomousActivity {
  timestamp: string;
  event_type: string;
  title: string;
  task_id?: string;
  agent_id?: string;
  model?: string;
  content_length?: number;
  content_preview?: string;
  reason?: string;
  scan_round?: number;
  required_capabilities?: string[];
}

interface AutonomousStatus {
  running: boolean;
  available?: boolean;
  message?: string;
  scan_interval_seconds?: number;
  scan_count?: number;
  total_tasks?: number;
  pending?: number;
  assigned?: number;
  running_tasks?: number;
  completed?: number;
  failed?: number;
  activity_log_count?: number;
  registered_forgekins?: string[];
  recent_activities?: AutonomousActivity[];
}
const AUTONOMOUS_EVENT_LABEL: Record<string, string> = {
  daemon_started: "守护启动",
  scan_started: "扫描开始",
  scan_completed: "扫描完成",
  task_submitted: "任务提交",
  task_assigned: "任务分配",
  task_completed: "任务完成",
  task_failed: "任务失败",
  task_invalid_output: "无效产出",
  daemon_stopped: "守护停止",
};

const AUTONOMOUS_EVENT_COLOR: Record<string, string> = {
  daemon_started: "#22c55e",
  scan_started: "#3b82f6",
  scan_completed: "#22c55e",
  task_submitted: "#3b82f6",
  task_assigned: "#a855f7",
  task_completed: "#22c55e",
  task_failed: "#ef4444",
  task_invalid_output: "#eab308",
  daemon_stopped: "#6b7280",
};

export default function ObservabilityPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logFilter, setLogFilter] = useState("");
  const [logLevelFilter, setLogLevelFilter] = useState<string>("all");

  const [autoStatus, setAutoStatus] = useState<AutonomousStatus | null>(null);
  const [autoActivities, setAutoActivities] = useState<AutonomousActivity[]>([]);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoError, setAutoError] = useState<string>("");

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

  const loadAutonomous = useCallback(async () => {
    try {
      setAutoError("");
      const [statusRes, actRes] = await Promise.all([
        fetch("/api/v1/forgemind/autonomous/status").then((r) => r.json()),
        fetch("/api/v1/forgemind/autonomous/activities?limit=30").then((r) => r.json()),
      ]);
      setAutoStatus(statusRes || null);
      const list = actRes?.activities || actRes?.data?.activities || [];
      setAutoActivities(Array.isArray(list) ? list : []);
    } catch (err) {
      setAutoError(err instanceof Error ? err.message : "加载失败");
      setAutoStatus(null);
      setAutoActivities([]);
    } finally {
      setAutoLoading(false);
    }
  }, []);

  const triggerScan = useCallback(async () => {
    try {
      await fetch("/api/v1/forgemind/autonomous/trigger-scan", { method: "POST" });
      setTimeout(() => loadAutonomous(), 2000);
    } catch {
      // 静默忽略
    }
  }, [loadAutonomous]);

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 30000);
    return () => clearInterval(interval);
  }, [loadLogs]);

  useEffect(() => {
    loadAutonomous();
    const interval = setInterval(loadAutonomous, 15000);
    return () => clearInterval(interval);
  }, [loadAutonomous]);

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
          服务健康、自进化运行、运行时会话、回调认证、实时日志
        </p>

        <div style={{ marginBottom: "24px" }}>
          <HubObservabilityTab />
        </div>

        {/* 自进化运行状态 */}
        <div data-autonomous-section="root" style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 data-autonomous-section="title" style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", margin: 0 }}>
              自进化运行状态
            </h3>
            <button
              type="button"
              onClick={triggerScan}
              data-autonomous-trigger="scan"
              style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "11px", cursor: "pointer" }}
            >
              立即扫描
            </button>
          </div>

          {autoLoading ? (
            <div data-autonomous-section="loading" style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>
              加载自进化状态中...
            </div>
          ) : autoError ? (
            <div data-autonomous-section="error" style={{ color: "#ef4444", fontSize: "13px", padding: "12px" }}>
              加载失败: {autoError}
            </div>
          ) : !autoStatus?.available ? (
            <div data-autonomous-section="unavailable" style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "12px" }}>
              {autoStatus?.message || "AutonomousDaemon 未启动"}
            </div>
          ) : (
            <>
              <div data-autonomous-section="status" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "8px", marginBottom: "12px" }}>
                <div data-autonomous-card="running" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>运行状态</div>
                  <div style={{ ...statusCardValueStyle, color: autoStatus.running ? "#22c55e" : "#ef4444" }}>
                    {autoStatus.running ? "运行中" : "已停止"}
                  </div>
                </div>
                <div data-autonomous-card="interval" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>扫描间隔</div>
                  <div style={statusCardValueStyle}>
                    {autoStatus.scan_interval_seconds ? `${autoStatus.scan_interval_seconds / 60} 分钟` : "-"}
                  </div>
                </div>
                <div data-autonomous-card="scan-count" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>已扫描轮数</div>
                  <div style={statusCardValueStyle}>{autoStatus.scan_count ?? 0}</div>
                </div>
                <div data-autonomous-card="total" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>总任务</div>
                  <div style={statusCardValueStyle}>{autoStatus.total_tasks ?? 0}</div>
                </div>
                <div data-autonomous-card="completed" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>已完成</div>
                  <div style={{ ...statusCardValueStyle, color: "#22c55e" }}>{autoStatus.completed ?? 0}</div>
                </div>
                <div data-autonomous-card="failed" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>已失败</div>
                  <div style={{ ...statusCardValueStyle, color: "#ef4444" }}>{autoStatus.failed ?? 0}</div>
                </div>
                <div data-autonomous-card="assigned" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>已分配</div>
                  <div style={{ ...statusCardValueStyle, color: "#3b82f6" }}>{autoStatus.assigned ?? 0}</div>
                </div>
                <div data-autonomous-card="activity-log" style={statusCardStyle}>
                  <div style={statusCardLabelStyle}>活动记录</div>
                  <div style={statusCardValueStyle}>{autoStatus.activity_log_count ?? 0}</div>
                </div>
              </div>

              {autoStatus.registered_forgekins && autoStatus.registered_forgekins.length > 0 && (
                <div data-autonomous-section="forgekins" style={{ marginBottom: "12px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                  <span>已注册灵智体: </span>
                  {autoStatus.registered_forgekins.map((k) => (
                    <span key={k} style={{ display: "inline-block", padding: "2px 6px", margin: "2px 4px 2px 0", borderRadius: "4px", background: "var(--bg-elevated,#1e1f26)", color: "var(--text,#e5e7eb)", fontFamily: "monospace" }}>
                      {k}
                    </span>
                  ))}
                </div>
              )}

              <div data-autonomous-section="activities">
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-strong)", marginBottom: "8px" }}>
                  最近活动 ({autoActivities.length})
                </div>
                <div style={{ background: "#1e1e2e", borderRadius: "8px", padding: "10px", fontFamily: "monospace", fontSize: "11px", maxHeight: "320px", overflowY: "auto" }}>
                  {autoActivities.length === 0 ? (
                    <div style={{ color: "#585b70", fontStyle: "italic", textAlign: "center", padding: "16px" }}>
                      暂无活动记录
                    </div>
                  ) : (
                    autoActivities.map((a, idx) => {
                      const label = AUTONOMOUS_EVENT_LABEL[a.event_type] || a.event_type;
                      const color = AUTONOMOUS_EVENT_COLOR[a.event_type] || "#9ca3af";
                      const ts = a.timestamp ? a.timestamp.slice(11, 19) : "--:--:--";
                      return (
                        <div key={idx} data-autonomous-activity={a.event_type} style={{ marginBottom: "6px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <span style={{ color: "#585b70", flexShrink: 0 }}>{ts}</span>
                          <span style={{ color, fontWeight: 600, minWidth: "70px" }}>{label}</span>
                          <span style={{ color: "#cdd6f4", flex: 1, wordBreak: "break-word" }}>
                            {a.title}
                            {a.agent_id && <span style={{ color: "#89b4fa" }}> [{a.agent_id}]</span>}
                            {a.model && <span style={{ color: "#fab387" }}> {a.model}</span>}
                            {a.content_length !== undefined && a.content_length < 100 && (
                              <span style={{ color: "#eab308" }}> (产出过短: {a.content_length}字)</span>
                            )}
                            {a.reason && <span style={{ color: "#eab308" }}> — {a.reason}</span>}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 日志查看器 */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong)", margin: 0 }}>
              实时日志 ({filteredLogs.length})
            </h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <select
                value={logLevelFilter}
                onChange={(e) => setLogLevelFilter(e.target.value)}
                style={{ padding: "4px 8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "11px" }}
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
                style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: "11px", width: "200px" }}
              />
            </div>
          </div>
          <div style={{ background: "#1e1e2e", borderRadius: "8px", padding: "12px", fontFamily: "monospace", fontSize: "11px", maxHeight: "400px", overflowY: "auto" }}>
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

const statusCardStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--bg-elevated,#1e1f26)",
  border: "1px solid var(--border,#2a2c3a)",
};

const statusCardLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  color: "var(--muted,#9ca3af)",
  marginBottom: "4px",
};

const statusCardValueStyle: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 700,
  color: "var(--text-strong,#e5e7eb)",
  fontFamily: "monospace",
};

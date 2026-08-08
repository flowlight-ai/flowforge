"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * 自主运行页面 — AutonomousDaemon 状态、活动记录与任务产出
 *
 * 数据接口：
 *   - GET /api/v1/forgemind/autonomous/status
 *   - GET /api/v1/forgemind/autonomous/activities?limit=30
 *   - GET /api/v1/forgemind/autonomous/outputs
 *
 * 每 10 秒自动刷新。
 */

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

interface AutonomousOutput {
  timestamp: string;
  task_id: string;
  title: string;
  agent_id?: string;
  model?: string;
  content?: string;
  content_preview?: string;
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

const statusCardStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: "8px",
  background: "var(--bg-elevated,#1e1f26)",
  border: "1px solid var(--border,#2a2c3a)",
};

const statusCardLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--muted,#9ca3af)",
  marginBottom: "6px",
};

const statusCardValueStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 700,
  color: "var(--text-strong,#e5e7eb)",
  fontFamily: "monospace",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--text-strong,#e5e7eb)",
  margin: 0,
};

const panelStyle: React.CSSProperties = {
  background: "#1e1e2e",
  borderRadius: "8px",
  padding: "12px",
  fontFamily: "monospace",
  fontSize: "12px",
  maxHeight: "420px",
  overflowY: "auto",
};

const btnStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  border: "1px solid var(--border,#2a2c3a)",
  background: "var(--bg,#1e1f26)",
  color: "var(--text,#e5e7eb)",
  fontSize: "11px",
  cursor: "pointer",
};
export default function AutonomousPage() {
  const [status, setStatus] = useState<AutonomousStatus | null>(null);
  const [activities, setActivities] = useState<AutonomousActivity[]>([]);
  const [outputs, setOutputs] = useState<AutonomousOutput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [expandedOutput, setExpandedOutput] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError("");
      const [statusRes, actRes, outRes] = await Promise.all([
        fetch("/api/v1/forgemind/autonomous/status").then((r) => r.json()),
        fetch("/api/v1/forgemind/autonomous/activities?limit=30").then((r) => r.json()),
        fetch("/api/v1/forgemind/autonomous/outputs").then((r) => r.json()),
      ]);
      setStatus(statusRes || null);
      const actList = actRes?.activities || actRes?.data?.activities || [];
      setActivities(Array.isArray(actList) ? actList : []);
      const outList = outRes?.outputs || outRes?.data?.outputs || [];
      setOutputs(Array.isArray(outList) ? outList : []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      setStatus(null);
      setActivities([]);
      setOutputs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const triggerScan = useCallback(async () => {
    try {
      await fetch("/api/v1/forgemind/autonomous/trigger-scan", { method: "POST" });
      setTimeout(() => loadData(), 2000);
    } catch {
      // 静默忽略
    }
  }, [loadData]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  return (
    <div className="animate-rise" data-page="autonomous">
      <div className="card" style={{ paddingBottom: "16px" }}>
        {/* 页面标题 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px", flexWrap: "wrap", gap: "8px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>自主运行</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            {lastUpdated && (
              <span style={{ fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                更新于 {lastUpdated.toLocaleTimeString("zh-CN")}
              </span>
            )}
            <button type="button" onClick={handleRefresh} data-autonomous-action="refresh" style={btnStyle} disabled={refreshing}>
              {refreshing ? "刷新中..." : "刷新"}
            </button>
            <button type="button" onClick={triggerScan} data-autonomous-action="trigger-scan" style={btnStyle}>
              立即扫描
            </button>
          </div>
        </div>
        <p className="page-sub" style={{ marginBottom: "16px" }}>
          AutonomousDaemon 守护进程状态、扫描记录、任务产出 · 每 10 秒自动刷新
        </p>

        {loading ? (
          <div data-autonomous-section="loading" style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "24px", textAlign: "center" }}>
            加载自主运行状态中...
          </div>
        ) : error ? (
          <div data-autonomous-section="error" style={{ color: "#ef4444", fontSize: "13px", padding: "16px" }}>
            加载失败: {error}
          </div>
        ) : !status?.available ? (
          <div data-autonomous-section="unavailable" style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>
            {status?.message || "AutonomousDaemon 未启动"}
          </div>
        ) : (
          <>            {/* 状态卡片 */}
            <div data-autonomous-section="status" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px", marginBottom: "20px" }}>
              <div data-autonomous-card="running" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>运行状态</div>
                <div style={{ ...statusCardValueStyle, color: status.running ? "#22c55e" : "#ef4444" }}>
                  {status.running ? "运行中" : "已停止"}
                </div>
              </div>
              <div data-autonomous-card="scan-count" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>扫描次数</div>
                <div style={statusCardValueStyle}>{status.scan_count ?? 0}</div>
              </div>
              <div data-autonomous-card="interval" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>扫描间隔</div>
                <div style={statusCardValueStyle}>
                  {status.scan_interval_seconds ? `${status.scan_interval_seconds / 60} 分钟` : "-"}
                </div>
              </div>
              <div data-autonomous-card="total" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>任务总数</div>
                <div style={statusCardValueStyle}>{status.total_tasks ?? 0}</div>
              </div>
              <div data-autonomous-card="running-tasks" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>运行中</div>
                <div style={{ ...statusCardValueStyle, color: "#3b82f6" }}>{status.running_tasks ?? 0}</div>
              </div>
              <div data-autonomous-card="assigned" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>已分配</div>
                <div style={{ ...statusCardValueStyle, color: "#a855f7" }}>{status.assigned ?? 0}</div>
              </div>
              <div data-autonomous-card="completed" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>已完成</div>
                <div style={{ ...statusCardValueStyle, color: "#22c55e" }}>{status.completed ?? 0}</div>
              </div>
              <div data-autonomous-card="failed" style={statusCardStyle}>
                <div style={statusCardLabelStyle}>已失败</div>
                <div style={{ ...statusCardValueStyle, color: "#ef4444" }}>{status.failed ?? 0}</div>
              </div>
            </div>
            {/* 灵智体列表 */}
            {status.registered_forgekins && status.registered_forgekins.length > 0 && (
              <div data-autonomous-section="forgekins" style={{ marginBottom: "20px" }}>
                <h3 style={{ ...sectionTitleStyle, marginBottom: "8px" }}>
                  已注册灵智体 ({status.registered_forgekins.length})
                </h3>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {status.registered_forgekins.map((k) => (
                    <span key={k} style={{ padding: "4px 10px", borderRadius: "6px", background: "var(--bg-elevated,#1e1f26)", color: "var(--text,#e5e7eb)", fontFamily: "monospace", fontSize: "12px", border: "1px solid var(--border,#2a2c3a)" }}>
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 活动记录 */}
            <div data-autonomous-section="activities" style={{ marginBottom: "20px" }}>
              <h3 style={{ ...sectionTitleStyle, marginBottom: "8px" }}>
                最近活动 ({activities.length})
              </h3>
              <div style={panelStyle}>
                {activities.length === 0 ? (
                  <div style={{ color: "#585b70", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                    暂无活动记录
                  </div>
                ) : (
                  <div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", paddingBottom: "8px", marginBottom: "6px", borderBottom: "1px solid #2a2c3a", color: "#585b70", fontSize: "10px", fontWeight: 600 }}>
                      <span style={{ flexShrink: 0, width: "70px" }}>时间</span>
                      <span style={{ flexShrink: 0, width: "70px" }}>事件</span>
                      <span style={{ flex: 1 }}>标题 / 灵智体 / 模型</span>
                    </div>
                    {activities.map((a, idx) => {
                      const label = AUTONOMOUS_EVENT_LABEL[a.event_type] || a.event_type;
                      const color = AUTONOMOUS_EVENT_COLOR[a.event_type] || "#9ca3af";
                      const ts = a.timestamp ? a.timestamp.slice(11, 19) : "--:--:--";
                      return (
                        <div key={idx} data-autonomous-activity={a.event_type} style={{ marginBottom: "6px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <span style={{ color: "#585b70", flexShrink: 0, width: "70px" }}>{ts}</span>
                          <span style={{ color, fontWeight: 600, flexShrink: 0, width: "70px" }}>{label}</span>
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
                    })}
                  </div>
                )}
              </div>
            </div>
            {/* 产出列表 */}
            <div data-autonomous-section="outputs">
              <h3 style={{ ...sectionTitleStyle, marginBottom: "8px" }}>
                任务产出 ({outputs.length})
              </h3>
              <div style={panelStyle}>
                {outputs.length === 0 ? (
                  <div style={{ color: "#585b70", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                    暂无任务产出
                  </div>
                ) : (
                  outputs.map((o, idx) => {
                    const key = o.task_id || `${idx}-${o.timestamp}`;
                    const expanded = expandedOutput === key;
                    const ts = o.timestamp ? o.timestamp.slice(0, 19).replace("T", " ") : "--";
                    const preview = o.content_preview || o.content || "";
                    const long = preview.length > 200;
                    return (
                      <div key={key} data-autonomous-output={o.task_id} style={{ marginBottom: "10px", padding: "8px", background: "#181825", borderRadius: "6px", border: "1px solid #2a2c3a" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", gap: "8px" }}>
                          <span style={{ color: "#cdd6f4", fontWeight: 600, fontSize: "12px", flex: 1, wordBreak: "break-word" }}>{o.title}</span>
                          <span style={{ color: "#585b70", fontSize: "10px", flexShrink: 0 }}>{ts}</span>
                        </div>
                        <div style={{ display: "flex", gap: "8px", fontSize: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
                          {o.agent_id && <span style={{ color: "#89b4fa" }}>灵智体: {o.agent_id}</span>}
                          {o.model && <span style={{ color: "#fab387" }}>模型: {o.model}</span>}
                        </div>
                        <div style={{ color: "#a6adc8", fontSize: "11px", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: expanded ? "none" : "60px", overflow: "hidden" }}>
                          {preview}
                        </div>
                        {long && (
                          <button type="button" onClick={() => setExpandedOutput(expanded ? null : key)} style={{ marginTop: "4px", padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--border,#2a2c3a)", background: "transparent", color: "#89b4fa", fontSize: "10px", cursor: "pointer" }}>
                            {expanded ? "收起" : "展开全文"}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
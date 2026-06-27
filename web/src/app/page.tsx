"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useShellConfig } from "@/lib/shell-config";
import { TaskItem, SystemStatus } from "@/lib/types";
import { useFetchWithCache } from "@/hooks/useFetchWithCache";

function StatusCards({ systemStatus, statusLoading, version }: { systemStatus: SystemStatus | null; statusLoading: boolean; version: string }) {
  const stats = [
    { label: "活跃任务", value: systemStatus?.active_tasks ?? "-", color: "var(--ok)" },
    { label: "总任务数", value: systemStatus?.total_tasks ?? "-", color: "var(--accent)" },
    { label: "版本", value: systemStatus?.version || version, color: "var(--muted)" },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "12px",
        marginTop: "20px",
      }}
    >
      {statusLoading
        ? Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              style={{
                padding: "16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, marginBottom: "4px" }}>
                &nbsp;
              </div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  color: "var(--muted)",
                  background: "var(--bg-hover)",
                  borderRadius: "4px",
                  width: "40px",
                  height: "24px",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              >
                &nbsp;
              </div>
            </div>
          ))
        : stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                padding: "16px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: "11px",
                  color: "var(--muted)",
                  fontWeight: 600,
                  marginBottom: "4px",
                }}
              >
                {stat.label}
              </div>
              <div
                style={{
                  fontSize: "20px",
                  fontWeight: 700,
                  color: stat.color,
                }}
              >
                {stat.value}
              </div>
            </div>
          ))}
    </div>
  );
}

export default function Dashboard() {
  const config = useShellConfig();
  const [statusFilter, setStatusFilter] = useState("");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(true);

  const {
    data: statusData,
    loading: statusLoading,
    error: statusError,
    refetch: refetchStatus,
  } = useFetchWithCache<any>("/api/v1/dashboard/status", { ttl: 30_000 });

  const systemStatus: SystemStatus | null = statusData
    ? {
        status: "running",
        uptime: 0,
        active_tasks: statusData.running_count ?? 0,
        total_tasks: (statusData.running_count ?? 0) + (statusData.error_count ?? 0),
        version: "",
        ...statusData,
      }
    : null;

  const loadTasks = useCallback(async (status?: string) => {
    setTasksLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (status) params.set("status", status);
      const r = await fetch(`/api/v1/tasks?${params}`);
      const data = await r.json();
      setTasks(data?.data?.items ?? data.items ?? data.tasks ?? []);
      setTotal(data?.data?.total ?? data.total ?? 0);
    } catch (e) {
      console.error(e);
    }
    setTasksLoading(false);
  }, []);

  useEffect(() => {
    loadTasks(statusFilter);
  }, [statusFilter, loadTasks]);

  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      waiting_review: "待审核",
      running: "运行中",
      completed: "已完成",
      failed: "失败",
      pending: "等待中",
      paused_at_gate: "门禁暂停",
      cancelled: "已取消",
    };
    return map[s] || s;
  };

  return (
    <div className="animate-rise">
      <div className="card">
        <h2 className="page-title">{config.brandName} 运行概览</h2>
        <p className="page-sub">{config.brandSubtitle}</p>

        {statusError && (
          <div style={{ marginTop: "12px", padding: "10px 16px", borderRadius: "var(--radius-sm)", background: "var(--danger-subtle)", color: "var(--danger)", fontSize: "13px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>状态加载失败：{statusError}</span>
            <button onClick={refetchStatus} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontWeight: 600, fontSize: "12px" }}>重试</button>
          </div>
        )}

        <StatusCards systemStatus={systemStatus} statusLoading={statusLoading} version={config.version} />
      </div>

      <div className="card" style={{ marginTop: "20px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <h2 className="page-title" style={{ margin: 0 }}>
            最近任务 ({total})
          </h2>
          <div
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {["", "pending", "waiting_review", "running", "completed", "failed"].map(
              (s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  style={{
                    cursor: "pointer",
                    border: "1px solid var(--border-strong)",
                    background:
                      statusFilter === s ? "var(--accent)" : "transparent",
                    color: statusFilter === s ? "#fff" : "var(--muted)",
                    borderRadius: "20px",
                    padding: "4px 12px",
                    fontSize: "12px",
                    fontWeight: 500,
                  }}
                >
                  {s ? statusLabel(s) : "全部"}
                </button>
              )
            )}
            <button
              onClick={() => loadTasks(statusFilter)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--accent)",
                fontSize: "13px",
                fontWeight: 600,
              }}
            >
              刷新
            </button>
          </div>
        </div>

        {tasksLoading ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "var(--muted)",
            }}
          >
            加载中...
          </div>
        ) : tasks.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "var(--muted)",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>📝</div>
            暂无任务
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: "2px solid var(--border-strong)",
                }}
              >
                {["任务ID", "标题", "类型", "状态", "创建时间", "操作"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: "10px 12px",
                        textAlign: "left",
                        fontSize: "12px",
                        color: "var(--muted)",
                        fontWeight: 600,
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr
                  key={t.id}
                  style={{
                    borderBottom:
                      "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
                  }}
                >
                  <td
                    style={{
                      padding: "10px 12px",
                      fontFamily: "monospace",
                      fontSize: "11px",
                      color: "var(--muted)",
                    }}
                  >
                    {t.id?.slice(0, 8)}...
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "13px",
                      fontWeight: 500,
                    }}
                  >
                    {t.title || t.description?.slice(0, 40) || "-"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className="pill" style={sp("type", t.workflow_type || t.persona || "-")}>
                      {t.workflow_type || t.persona || "-"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className="pill" style={sp("status", t.status)}>
                      {statusLabel(t.status)}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: "12px",
                      color: "var(--muted)",
                    }}
                  >
                    {t.created_at?.slice(0, 19)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Link
                      href={`/review/${t.id}`}
                      style={{
                        fontWeight: 600,
                        fontSize: "13px",
                        color: "var(--accent)",
                      }}
                    >
                      查看 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function sp(kind: string, s: string): React.CSSProperties {
  if (kind === "status") {
    const map: Record<string, React.CSSProperties> = {
      waiting_review: { background: "var(--warn-subtle)", color: "var(--warn)" },
      running: { background: "color-mix(in srgb, var(--info) 20%, transparent)", color: "var(--info)" },
      completed: { background: "var(--ok-subtle)", color: "var(--ok)" },
      failed: { background: "var(--danger-subtle)", color: "var(--danger)" },
      pending: { background: "var(--bg-hover)", color: "var(--muted)" },
    };
    return map[s] || map.pending;
  }
  return { background: "var(--bg-hover)", color: "var(--muted)" };
}

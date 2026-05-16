"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useShellConfig } from "@/lib/shell-config";
import { TaskItem, SystemStatus } from "@/lib/types";

interface WorkflowStep {
  id: string;
  display_name: string;
  agent: string;
  human_review: boolean;
}

interface Workflow {
  name: string;
  display_name: string;
  description: string;
  icon: string;
  category: string;
  version: string;
  file: string;
  steps: number;
  step_details: WorkflowStep[];
}

export default function Dashboard() {
  const config = useShellConfig();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  useEffect(() => {
    fetch("/api/v1/system/status")
      .then((r) => r.json())
      .then((data) => setSystemStatus(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/v1/workflows")
      .then((r) => r.json())
      .then((data) => {
        const wfList = data?.data?.workflows || [];
        setWorkflows(wfList);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadTasks(statusFilter);
  }, [statusFilter]);

  const loadTasks = async (status?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (status) params.set("status", status);
      const r = await fetch(`/api/v1/tasks?${params}`);
      const data = await r.json();
      setTasks(data.items || data.tasks || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

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

  const categoryLabel = (c: string) => {
    const map: Record<string, string> = {
      generic: "通用",
      content: "内容",
    };
    return map[c] || c;
  };

  const categories = ["all", ...Array.from(new Set(workflows.map((w) => w.category)))];
  const filteredWorkflows =
    selectedCategory === "all"
      ? workflows
      : workflows.filter((w) => w.category === selectedCategory);

  return (
    <div className="animate-rise">
      <div className="card">
        <h2 className="page-title">{config.brandName} 运行概览</h2>
        <p className="page-sub">{config.brandSubtitle}</p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "12px",
            marginTop: "20px",
          }}
        >
          {[
            {
              label: "活跃任务",
              value: systemStatus?.active_tasks ?? "-",
              color: "var(--ok)",
            },
            {
              label: "总任务数",
              value: systemStatus?.total_tasks ?? total,
              color: "var(--accent)",
            },
            {
              label: "工作流",
              value: workflows.length,
              color: "var(--info)",
            },
            {
              label: "版本",
              value: systemStatus?.version || config.version,
              color: "var(--muted)",
            },
          ].map((stat) => (
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
      </div>

      <div className="card" style={{ marginTop: "20px" }}>
        <h2 className="page-title">可用工作流</h2>
        <p className="page-sub">选择一个工作流模板来创建新任务</p>

        <div
          style={{
            display: "flex",
            gap: "6px",
            marginTop: "16px",
            marginBottom: "16px",
            flexWrap: "wrap",
          }}
        >
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedCategory(c)}
              style={{
                cursor: "pointer",
                border: "1px solid var(--border-strong)",
                background: selectedCategory === c ? "var(--accent)" : "transparent",
                color: selectedCategory === c ? "#fff" : "var(--muted)",
                borderRadius: "20px",
                padding: "4px 12px",
                fontSize: "12px",
                fontWeight: 500,
              }}
            >
              {c === "all" ? "全部" : categoryLabel(c)}
            </button>
          ))}
        </div>

        {filteredWorkflows.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: "var(--muted)",
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>📋</div>
            暂无工作流
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "12px",
            }}
          >
            {filteredWorkflows.map((wf) => (
              <div
                key={wf.name}
                style={{
                  padding: "16px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.boxShadow = "0 0 0 1px var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "none";
                }}
                onClick={() => {
                  window.location.href = `/solo?workflow=${encodeURIComponent(wf.name)}`;
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "8px",
                  }}
                >
                  <span style={{ fontSize: "24px" }}>{wf.icon || "📋"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {wf.display_name}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--muted)",
                      }}
                    >
                      {wf.steps} 步 · {categoryLabel(wf.category)}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--muted)",
                    lineHeight: 1.5,
                    marginBottom: "10px",
                  }}
                >
                  {wf.description}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "4px",
                    flexWrap: "wrap",
                  }}
                >
                  {wf.step_details?.slice(0, 4).map((step) => (
                    <span
                      key={step.id}
                      style={{
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: step.human_review
                          ? "var(--warn-subtle)"
                          : "var(--bg-hover)",
                        color: step.human_review
                          ? "var(--warn)"
                          : "var(--muted)",
                        fontWeight: 500,
                      }}
                    >
                      {step.human_review && "👤 "}
                      {step.display_name}
                    </span>
                  ))}
                  {wf.step_details?.length > 4 && (
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: "var(--bg-hover)",
                        color: "var(--muted)",
                      }}
                    >
                      +{wf.step_details.length - 4}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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

        {loading ? (
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

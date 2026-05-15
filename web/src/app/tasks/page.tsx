"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TaskItem } from "@/lib/types";

export default function TaskListPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(0);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: "20",
        offset: String(page * 20),
      });
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("workflow_type", typeFilter);
      const r = await fetch(`/api/v1/tasks?${params}`);
      const data = await r.json();
      setTasks(data.items || data.tasks || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [statusFilter, typeFilter, page]);

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

  const pages = Math.ceil(total / 20);

  return (
    <div className="animate-rise">
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <h2 className="page-title" style={{ margin: 0 }}>
            任务列表 ({total})
          </h2>
          <div className="filter-bar">
            <select
              className="select"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="">全部类型</option>
              <option value="greenfield">全新项目</option>
              <option value="feature">功能开发</option>
              <option value="change">变更</option>
              <option value="hotfix">热修复</option>
            </select>
            {["", "waiting_review", "running", "completed", "failed"].map(
              (s) => (
                <button
                  key={s}
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(0);
                  }}
                  className="pill"
                  style={{
                    cursor: "pointer",
                    border: "1px solid var(--border-strong)",
                    background:
                      statusFilter === s ? "var(--accent)" : "transparent",
                    color: statusFilter === s ? "#fff" : "var(--muted)",
                  }}
                >
                  {s ? statusLabel(s) : "全部"}
                </button>
              )
            )}
          </div>
        </div>

        {loading ? (
          <div className="empty">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="empty">暂无匹配的任务</div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  {["任务ID", "标题", "类型", "状态", "当前步骤", "创建时间", "操作"].map(
                    (h) => (
                      <th key={h}>{h}</th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: "12px",
                        color: "var(--muted)",
                      }}
                    >
                      {t.id?.slice(0, 10)}...
                    </td>
                    <td>{t.title || t.description?.slice(0, 40) || "-"}</td>
                    <td>
                      <span className="pill" style={sp("type", t.workflow_type || t.persona || "")}>
                        {t.workflow_type || t.persona || "-"}
                      </span>
                    </td>
                    <td>
                      <span className="pill" style={sp("status", t.status)}>
                        {statusLabel(t.status)}
                      </span>
                    </td>
                    <td style={{ fontSize: "12px" }}>
                      {t.current_step || "-"}
                    </td>
                    <td
                      style={{
                        fontSize: "12px",
                        color: "var(--muted-strong)",
                      }}
                    >
                      {t.created_at?.slice(0, 19)}
                    </td>
                    <td>
                      <Link href={`/review/${t.id}`} style={{ fontWeight: 600 }}>
                        查看 →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  gap: "8px",
                  marginTop: "20px",
                }}
              >
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  上一页
                </button>
                <span
                  style={{
                    padding: "6px 10px",
                    color: "var(--muted)",
                    fontSize: "13px",
                  }}
                >
                  第 {page + 1} / {pages} 页
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage(Math.min(pages - 1, page + 1))}
                  disabled={page >= pages - 1}
                >
                  下一页
                </button>
              </div>
            )}
          </>
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

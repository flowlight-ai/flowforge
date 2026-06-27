"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TaskItem } from "@/lib/types";

export default function ReviewCenterPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: "waiting_review",
        limit: "50",
      });
      if (typeFilter) params.set("workflow_type", typeFilter);
      const r = await fetch(`/api/v1/tasks?${params}`);
      const data = await r.json();
      setTasks(data?.data?.items ?? data.items ?? data.tasks ?? []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [typeFilter]);

  const handleQuickApprove = async (taskId: string) => {
    try {
      await fetch(`/api/v1/tasks/${taskId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "approve", feedback: "快速批准" }),
      });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (e) {
      console.error(e);
    }
  };

  const handleQuickReject = async (taskId: string) => {
    try {
      await fetch(`/api/v1/tasks/${taskId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "reject", feedback: "快速驳回" }),
      });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (e) {
      console.error(e);
    }
  };

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
          <div>
            <h2 className="page-title" style={{ margin: 0 }}>
              审核中心 ({tasks.length})
            </h2>
            <p className="page-sub">审核待处理的任务</p>
          </div>
          <select
            className="select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">全部类型</option>
            <option value="greenfield">全新项目</option>
            <option value="feature">功能开发</option>
            <option value="change">变更</option>
            <option value="hotfix">热修复</option>
          </select>
        </div>

        {loading ? (
          <div className="empty">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="empty">
            <p style={{ fontSize: "15px" }}>暂无待审核任务</p>
            <Link
              href="/"
              style={{ marginTop: "8px", display: "inline-block" }}
            >
              去创建新任务 →
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            {tasks.map((t) => (
              <div
                key={t.id}
                className="card"
                style={{ padding: "18px 22px", marginBottom: 0 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "12px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: "200px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        className="pill"
                        style={{
                          background: "var(--warn-subtle)",
                          color: "var(--warn)",
                        }}
                      >
                        待审核
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: "13px" }}>
                        {t.workflow_type || t.persona || ""}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--muted-strong)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      {t.id?.slice(0, 12)}... · {t.created_at?.slice(0, 19)}
                    </div>
                    {t.title && (
                      <div
                        style={{
                          marginTop: "8px",
                          fontSize: "14px",
                          fontWeight: 600,
                          color: "var(--text-strong)",
                        }}
                      >
                        {t.title}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Link
                      href={`/review/${t.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      审阅
                    </Link>
                    <button
                      onClick={() => handleQuickApprove(t.id)}
                      className="btn btn-success btn-sm"
                    >
                      批准
                    </button>
                    <button
                      onClick={() => handleQuickReject(t.id)}
                      className="btn btn-danger btn-sm"
                    >
                      驳回
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

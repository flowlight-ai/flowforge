"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

interface TaskDetail {
  id: string;
  title: string;
  description: string;
  status: string;
  draft_content?: string;
  steps: any[];
  created_at: string;
  [key: string]: any;
}

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.taskId as string;
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  useEffect(() => {
    fetchTask();
  }, [taskId]);

  const fetchTask = async () => {
    try {
      const r = await fetch(`/api/v1/tasks/${taskId}`);
      if (!r.ok) throw new Error(await r.text());
      setTask(await r.json());
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  const handleReview = async (verdict: "approve" | "reject") => {
    setActionMsg(
      `正在提交 ${verdict === "approve" ? "批准" : "驳回"}...`
    );
    try {
      const r = await fetch(
        `/api/v1/tasks/${taskId}/review?verdict=${verdict}&feedback=${verdict === "approve" ? "审核通过" : "需要修改"}`,
        { method: "POST" }
      );
      const data = await r.json();
      if (r.ok) {
        setActionMsg(
          `${verdict === "approve" ? "已批准！" : "已驳回！"} 状态: ${data.status}`
        );
        setTimeout(() => fetchTask(), 2000);
      } else {
        setActionMsg(`错误: ${data.detail || JSON.stringify(data)}`);
      }
    } catch (e: any) {
      setActionMsg(`请求失败: ${e.message}`);
    }
  };

  if (loading) return <div className="empty">加载中...</div>;
  if (error)
    return (
      <div className="empty" style={{ color: "var(--danger)" }}>
        加载失败: {error}
      </div>
    );
  if (!task) return <div className="empty">任务不存在</div>;

  return (
    <div className="animate-rise">
      <div style={{ marginBottom: "16px" }}>
        <Link href="/review" style={{ fontSize: "13px" }}>
          ← 返回审核中心
        </Link>
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <div>
            <h2 className="page-title">任务审核</h2>
            <p className="page-sub">
              任务ID: {task.id?.slice(0, 12)}... ·{" "}
              <span
                className="pill"
                style={{
                  background:
                    task.status === "waiting_review"
                      ? "var(--warn-subtle)"
                      : "var(--ok-subtle)",
                  color:
                    task.status === "waiting_review"
                      ? "var(--warn)"
                      : "var(--ok)",
                }}
              >
                {task.status}
              </span>
            </p>
          </div>

          {task.status === "waiting_review" && (
            <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
              <button
                onClick={() => handleReview("reject")}
                className="btn btn-danger"
              >
                驳回
              </button>
              <button
                onClick={() => handleReview("approve")}
                className="btn btn-success"
              >
                批准
              </button>
            </div>
          )}
        </div>

        {actionMsg && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: "var(--radius-sm)",
              background: "var(--accent-subtle)",
              color: "var(--accent)",
              fontSize: "13px",
              marginBottom: "16px",
            }}
          >
            {actionMsg}
          </div>
        )}
      </div>

      {task.draft_content && (
        <div className="card">
          <h3
            style={{
              margin: "0 0 16px",
              fontSize: "16px",
              fontWeight: 650,
              color: "var(--text-strong)",
            }}
          >
            内容
          </h3>
          <div
            style={{
              background: "var(--bg-elevated)",
              padding: "24px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)",
              lineHeight: 1.8,
              fontSize: "14px",
              whiteSpace: "pre-wrap",
              maxHeight: "70vh",
              overflow: "auto",
            }}
          >
            {task.draft_content}
          </div>
        </div>
      )}

      {task.steps && task.steps.length > 0 && (
        <div className="card">
          <h3
            style={{
              margin: "0 0 16px",
              fontSize: "16px",
              fontWeight: 650,
              color: "var(--text-strong)",
            }}
          >
            处理步骤
          </h3>
          {task.steps.map((step: any, i: number) => (
            <div
              key={i}
              style={{
                padding: "10px 0",
                borderBottom:
                  "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
                fontSize: "13px",
                display: "flex",
                gap: "10px",
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  color: "var(--text-strong)",
                  minWidth: "120px",
                }}
              >
                {step.node || step.title || `步骤 ${i + 1}`}
              </span>
              <span style={{ color: "var(--muted)" }}>
                {step.status || step.detail || "-"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * HubEvalTab — 评估中心 Tab
 *
 * 移植自 clowder-ai HubEvalTab，简化为 FlowForge 适配版。
 * 用于 /review，展示可进化智能体产出物的评估任务、摩擦分析与判决。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/eval/tasks, POST /api/v1/eval/{taskId}/verdict。
 */

import { useCallback, useEffect, useState } from "react";
import { HubEvalVerdictCard, type EvalVerdict } from "./HubEvalVerdictCard";

interface EvalTask {
  id: string;
  title: string;
  forgekinId: string;
  forgekinName: string;
  type: "content" | "code" | "novel" | "mall" | "dev";
  status: "pending" | "in_progress" | "completed" | "error";
  qualityScore?: number;
  frictionScore?: number;
  createdAt: string;
}

interface EvalTaskListResponse {
  items: EvalTask[];
  total: number;
}

const TYPE_LABELS: Record<EvalTask["type"], string> = {
  content: "内容创作",
  code: "代码开发",
  novel: "小说创作",
  mall: "电商运营",
  dev: "工程流水线",
};

const STATUS_LABELS: Record<EvalTask["status"], { label: string; color: string; bg: string }> = {
  pending: { label: "待评估", color: "#eab308", bg: "rgba(234,179,8,0.12)" },
  in_progress: { label: "评估中", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  completed: { label: "已完成", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  error: { label: "失败", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
};

export function HubEvalTab() {
  const [tasks, setTasks] = useState<EvalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<EvalTask | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/eval/tasks?limit=50");
      if (!res.ok) {
        setError("加载评估任务失败");
        return;
      }
      const body = (await res.json()) as EvalTaskListResponse | { data: EvalTaskListResponse };
      const list = "items" in body ? body.items : (body as { data: EvalTaskListResponse }).data?.items ?? [];
      setTasks(list);
    } catch {
      setError("网络错误，无法加载评估任务");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleVerdict = useCallback(
    async (taskId: string, verdict: EvalVerdict, feedback: string) => {
      try {
        const res = await fetch(`/api/v1/eval/${taskId}/verdict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verdict, feedback }),
        });
        if (!res.ok) throw new Error("提交判决失败");
        setSelectedTask(null);
        await fetchTasks();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [fetchTasks],
  );

  if (loading) {
    return <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "16px" }}>加载评估任务...</div>;
  }

  if (selectedTask) {
    return (
      <HubEvalVerdictCard
        task={selectedTask}
        onBack={() => setSelectedTask(null)}
        onVerdict={handleVerdict}
        error={error}
      />
    );
  }

  return (
    <div data-hub-eval="root" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {error && (
        <div data-hub-eval-error="load" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
          评估任务（{tasks.length}）
        </span>
        <button
          type="button"
          onClick={fetchTasks}
          style={btnGhostStyle}
        >
          🔄 刷新
        </button>
      </div>

      {tasks.length === 0 ? (
        <div style={{ color: "var(--muted,#9ca3af)", fontSize: "12px", padding: "24px 0", textAlign: "center" }}>
          暂无待评估任务，所有可进化智能体产出物已通过验证。
        </div>
      ) : (
        tasks.map((t) => {
          const sc = STATUS_LABELS[t.status];
          return (
            <div
              key={t.id}
              data-hub-eval-task={t.id}
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: "var(--bg-elevated,#1e1f26)",
                border: "1px solid var(--border,#2a2c3a)",
                cursor: "pointer",
              }}
              onClick={() => setSelectedTask(t)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-strong,#e5e7eb)" }}>{t.title}</span>
                <span style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "10px", background: sc.bg, color: sc.color, fontWeight: 600 }}>
                  {sc.label}
                </span>
              </div>
              <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--muted,#9ca3af)" }}>
                <span>类型: {TYPE_LABELS[t.type] ?? t.type}</span>
                <span>Forgekin: {t.forgekinName}</span>
                {t.qualityScore !== undefined && (
                  <span style={{ color: t.qualityScore >= 0.85 ? "#22c55e" : "#eab308" }}>
                    质量: {(t.qualityScore * 100).toFixed(1)}%
                  </span>
                )}
                {t.frictionScore !== undefined && (
                  <span>摩擦: {(t.frictionScore * 100).toFixed(1)}%</span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

const btnGhostStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: "6px",
  background: "var(--bg-elevated,#1e1f26)",
  color: "var(--muted,#9ca3af)",
  border: "1px solid var(--border,#2a2c3a)",
  fontSize: "11px",
  cursor: "pointer",
};

export default HubEvalTab;

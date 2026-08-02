"use client";

/**
 * HubEvalVerdictCard — 评估判决卡片
 *
 * 用于 /review 评估任务的判决提交（通过/驳回/重做）。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 由 HubEvalTab 在选中任务后渲染。
 */

import { useState } from "react";

export type EvalVerdict = "approve" | "reject" | "redo";

interface EvalTaskSummary {
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

interface HubEvalVerdictCardProps {
  task: EvalTaskSummary;
  onBack: () => void;
  onVerdict: (taskId: string, verdict: EvalVerdict, feedback: string) => Promise<void>;
  error?: string | null;
}

const VERDICT_META: Record<EvalVerdict, { label: string; color: string; bg: string }> = {
  approve: { label: "通过", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  reject: { label: "驳回", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  redo: { label: "重做", color: "#eab308", bg: "rgba(234,179,8,0.12)" },
};

export function HubEvalVerdictCard({ task, onBack, onVerdict, error }: HubEvalVerdictCardProps) {
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState<EvalVerdict | null>(null);

  const handleSubmit = async (verdict: EvalVerdict) => {
    setPending(verdict);
    await onVerdict(task.id, verdict, feedback.trim() || `${VERDICT_META[verdict].label}（无附加反馈）`);
    setPending(null);
  };

  const passed = (task.qualityScore ?? 0) >= 0.85;

  return (
    <div data-hub-eval-verdict="root" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "4px 10px",
            borderRadius: "6px",
            background: "var(--bg-elevated,#1e1f26)",
            color: "var(--muted,#9ca3af)",
            border: "1px solid var(--border,#2a2c3a)",
            fontSize: "11px",
            cursor: "pointer",
          }}
          data-hub-eval-verdict-action="back"
        >
          ← 返回
        </button>
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
          评估判决：{task.title}
        </h3>
      </div>

      <div
        data-hub-eval-verdict-summary="true"
        style={{
          padding: "12px 14px",
          borderRadius: "8px",
          background: "var(--bg-elevated,#1e1f26)",
          border: "1px solid var(--border,#2a2c3a)",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
          <div>
            <div style={{ color: "var(--muted,#9ca3af)", marginBottom: "2px" }}>可进化智能体</div>
            <div style={{ color: "var(--text,#e5e7eb)" }}>{task.forgekinName}</div>
          </div>
          <div>
            <div style={{ color: "var(--muted,#9ca3af)", marginBottom: "2px" }}>任务类型</div>
            <div style={{ color: "var(--text,#e5e7eb)" }}>{task.type}</div>
          </div>
          {task.qualityScore !== undefined && (
            <div>
              <div style={{ color: "var(--muted,#9ca3af)", marginBottom: "2px" }}>质量分</div>
              <div style={{ color: passed ? "#22c55e" : "#eab308", fontWeight: 700 }}>
                {(task.qualityScore * 100).toFixed(1)}% {passed ? "(达标)" : "(低于阈值 0.85)"}
              </div>
            </div>
          )}
          {task.frictionScore !== undefined && (
            <div>
              <div style={{ color: "var(--muted,#9ca3af)", marginBottom: "2px" }}>摩擦分</div>
              <div style={{ color: "var(--text,#e5e7eb)" }}>{(task.frictionScore * 100).toFixed(1)}%</div>
            </div>
          )}
        </div>
      </div>

      <div>
        <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--text,#e5e7eb)", display: "block", marginBottom: "6px" }}>
          判决反馈（可选）
        </label>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="可补充质量意见、改进建议或驳回理由..."
          style={{
            width: "100%",
            minHeight: "100px",
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid var(--border,#2a2c3a)",
            background: "var(--bg,#15151c)",
            color: "var(--text,#e5e7eb)",
            fontSize: "12px",
            resize: "vertical",
            boxSizing: "border-box",
          }}
          data-hub-eval-verdict-input="feedback"
        />
      </div>

      {error && (
        <div data-hub-eval-verdict-error="save" style={{ color: "#ef4444", fontSize: "12px", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: "6px" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        {(["approve", "reject", "redo"] as EvalVerdict[]).map((v) => {
          const m = VERDICT_META[v];
          return (
            <button
              key={v}
              type="button"
              onClick={() => handleSubmit(v)}
              disabled={pending !== null}
              style={{
                padding: "8px 18px",
                borderRadius: "6px",
                background: m.bg,
                color: m.color,
                border: `1px solid ${m.color}`,
                fontSize: "12px",
                fontWeight: 600,
                cursor: pending !== null ? "not-allowed" : "pointer",
                opacity: pending !== null && pending !== v ? 0.5 : 1,
              }}
              data-hub-eval-verdict-action={v}
            >
              {pending === v ? "提交中..." : m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default HubEvalVerdictCard;

"use client";

import { useState, useCallback } from "react";
import { getAgentColor, getModeStyle } from "./helm-utils";

// ─── Types ───

export interface PlanStep {
  name: string;
  task: string;
  agent: string;
  tool?: string;
  mode?: string;
  editable: boolean;
}

export interface Plan {
  id: string;
  task_id: string;
  title: string;
  description: string;
  steps: PlanStep[];
  status: "pending" | "confirmed" | "executing" | "completed" | "rejected" | "cancelled";
  current_step: number;
  total_steps: number;
  edited_steps: string[];
  results: Record<string, any>;
  steps_status?: Record<string, string>;  // {step_index: "pending"|"running"|"completed"|"failed"|"skipped"}
  step_results?: Record<string, string>;  // {step_index: result_summary}
  plan_version?: number;
  update_reasoning?: string;
  last_updated_at?: string;
}

interface PlanPanelProps {
  plan: Plan | null;
  isLoading?: boolean;
  onConfirm?: (planId: string, editedSteps?: PlanStep[]) => void;
  onReject?: (planId: string) => void;
  onRegenerate?: () => void;
  onStepEdit?: (stepIndex: number, step: Partial<PlanStep>) => void;
  onStepDelete?: (stepIndex: number) => void;
  onStepAdd?: (step: PlanStep) => void;
  newlyAddedSteps?: Set<number>;
}

// ─── Keyframes injected once ───

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes plan-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    @keyframes plan-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes plan-fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes plan-highlight {
      0% { background: rgba(249,226,175,0.25); }
      100% { background: transparent; }
    }
  `;
  document.head.appendChild(style);
}

// ─── Step status indicator ───

type StepStatus = "pending" | "running" | "completed" | "error" | "skipped";

function getStepStatus(plan: Plan, stepIndex: number): StepStatus {
  // Use steps_status if available (new dynamic plan)
  if (plan.steps_status) {
    const status = plan.steps_status[String(stepIndex)];
    if (status && ['pending', 'running', 'completed', 'failed', 'skipped'].includes(status)) {
      return status as StepStatus;
    }
  }
  // Fallback to current_step-based logic
  if (plan.status === "completed") return "completed";
  if (plan.status === "cancelled") return "skipped";
  if (stepIndex < plan.current_step) return "completed";
  if (stepIndex === plan.current_step && plan.status === "executing") return "running";
  return "pending";
}

function StepStatusIcon({ status }: { status: StepStatus }) {
  const size = 16;
  switch (status) {
    case "completed":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#a6e3a1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case "running":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--accent, #89b4fa)" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "plan-pulse 1.2s ease-in-out infinite" }}>
          <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="0">
            <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
          </circle>
        </svg>
      );
    case "error":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f38ba8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    case "skipped":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#6c7086" strokeWidth="2.5" strokeLinecap="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    default:
      return (
        <div style={{
          width: size, height: size, borderRadius: "50%",
          border: "2px solid #6c7086", flexShrink: 0,
        }} />
      );
  }
}

// ─── Badge components ───

function AgentBadge({ agent }: { agent: string }) {
  const color = getAgentColor(agent);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      color: color, background: `${color}1a`,
      whiteSpace: "nowrap",
    }}>
      {agent}
    </span>
  );
}

function ToolBadge({ tool }: { tool: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 500,
      color: "#94e2d5", background: "rgba(148,226,213,0.12)",
      whiteSpace: "nowrap",
    }}>
      🔧 {tool}
    </span>
  );
}

function ModeBadge({ mode }: { mode: string }) {
  const style = getModeStyle(mode);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 500,
      color: style.color, background: style.bg,
      whiteSpace: "nowrap",
    }}>
      {style.label}
    </span>
  );
}

// ─── Editable step card ───

function EditableStepCard({
  step,
  stepIndex,
  onSave,
  onCancel,
}: {
  step: PlanStep;
  stepIndex: number;
  onSave: (updated: PlanStep) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlanStep>({ ...step });

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #45475a",
    background: "#11111b",
    color: "var(--fg, #cdd6f4)",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
  };

  return (
    <div style={{
      padding: 12,
      borderRadius: 8,
      border: "1px solid var(--accent, #89b4fa)",
      background: "var(--bg-secondary, #1e1e2e)",
      animation: "plan-fadeIn 0.15s ease-out",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--muted, #6c7086)", marginBottom: 2, display: "block" }}>步骤名称</label>
          <input
            style={inputStyle}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="步骤名称"
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--muted, #6c7086)", marginBottom: 2, display: "block" }}>任务描述</label>
          <input
            style={inputStyle}
            value={draft.task}
            onChange={(e) => setDraft({ ...draft, task: e.target.value })}
            placeholder="任务描述"
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--muted, #6c7086)", marginBottom: 2, display: "block" }}>Agent</label>
            <input
              style={inputStyle}
              value={draft.agent}
              onChange={(e) => setDraft({ ...draft, agent: e.target.value })}
              placeholder="Agent 名称"
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "var(--muted, #6c7086)", marginBottom: 2, display: "block" }}>工具</label>
            <input
              style={inputStyle}
              value={draft.tool || ""}
              onChange={(e) => setDraft({ ...draft, tool: e.target.value || undefined })}
              placeholder="工具（可选）"
            />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "5px 14px", borderRadius: 6,
              border: "1px solid #45475a", background: "transparent",
              color: "var(--muted, #6c7086)", fontSize: 12, cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            onClick={() => onSave(draft)}
            style={{
              padding: "5px 14px", borderRadius: 6,
              border: "none", background: "var(--accent, #89b4fa)",
              color: "#1e1e2e", fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step card ───

function StepCard({
  step,
  stepIndex,
  status,
  isEditable,
  onEdit,
  onDelete,
  stepResult,
  isNewlyAdded,
}: {
  step: PlanStep;
  stepIndex: number;
  status: StepStatus;
  isEditable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  stepResult?: string;
  isNewlyAdded?: boolean;
}) {
  const isRunning = status === "running";

  return (
    <div style={{
      padding: "10px 12px",
      borderRadius: 8,
      border: `1px solid ${isRunning ? "var(--accent, #89b4fa)" : status === "completed" ? "#a6e3a133" : "#45475a"}`,
      background: "var(--bg-secondary, #1e1e2e)",
      animation: isNewlyAdded ? "plan-highlight 2s ease-out" : "plan-fadeIn 0.2s ease-out",
      opacity: status === "skipped" ? 0.5 : 1,
      transition: "border-color 0.2s, opacity 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Step number */}
        <div style={{
          width: 24, height: 24, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 700, flexShrink: 0,
          color: status === "completed" ? "#1e1e2e" : "var(--fg, #cdd6f4)",
          background: status === "completed" ? "#a6e3a1" : status === "running" ? "var(--accent, #89b4fa)" : "#313244",
        }}>
          {stepIndex + 1}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: "var(--fg, #cdd6f4)",
              textDecoration: status === "skipped" ? "line-through" : "none",
            }}>
              {step.name}
            </span>
            <StepStatusIcon status={status} />
          </div>
          <div style={{
            fontSize: 12, color: "var(--muted, #6c7086)",
            lineHeight: 1.5, marginBottom: 6,
          }}>
            {step.task}
          </div>
          {stepResult && (
            <div style={{
              fontSize: 11, color: "#a6e3a1",
              lineHeight: 1.4, marginBottom: 4,
              padding: "3px 8px", borderRadius: 4,
              background: "rgba(166,227,161,0.08)",
            }}>
              ✓ {stepResult}
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <AgentBadge agent={step.agent} />
            {step.tool && <ToolBadge tool={step.tool} />}
            {step.mode && <ModeBadge mode={step.mode} />}
          </div>
        </div>

        {/* Action buttons */}
        {isEditable && (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              onClick={onEdit}
              title="编辑步骤"
              style={{
                width: 26, height: 26, borderRadius: 6,
                border: "1px solid #45475a", background: "transparent",
                color: "var(--muted, #6c7086)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12,
              }}
            >
              ✏
            </button>
            <button
              onClick={onDelete}
              title="删除步骤"
              style={{
                width: 26, height: 26, borderRadius: 6,
                border: "1px solid #45475a", background: "transparent",
                color: "#f38ba8", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12,
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Connecting line between steps ───

function ConnectingLine({ completed }: { completed: boolean }) {
  return (
    <div style={{
      width: 2, height: 16, marginLeft: 21,
      background: completed ? "#a6e3a1" : "#45475a",
      borderRadius: 1,
      transition: "background 0.3s",
    }} />
  );
}

// ─── Progress bar ───

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 11, color: "var(--muted, #6c7086)" }}>
          执行进度
        </span>
        <span style={{ fontSize: 11, color: "var(--accent, #89b4fa)", fontFamily: "var(--mono, monospace)" }}>
          {current}/{total} ({pct}%)
        </span>
      </div>
      <div style={{
        width: "100%", height: 4, borderRadius: 2,
        background: "#313244", overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%", borderRadius: 2,
          background: "linear-gradient(90deg, var(--accent, #89b4fa), #a6e3a1)",
          transition: "width 0.4s ease",
        }} />
      </div>
    </div>
  );
}

// ─── Loading spinner ───

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: "plan-spin 1s linear infinite" }}>
      <circle cx="12" cy="12" r="10" stroke="var(--accent, #89b4fa)" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
    </svg>
  );
}

// ─── Main PlanPanel ───

export default function PlanPanel({
  plan,
  isLoading = false,
  onConfirm,
  onReject,
  onRegenerate,
  onStepEdit,
  onStepDelete,
  onStepAdd,
  newlyAddedSteps,
}: PlanPanelProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStep, setNewStep] = useState<PlanStep>({
    name: "", task: "", agent: "default", editable: true,
  });

  // Inject keyframes on first render
  if (typeof window !== "undefined") injectStyles();

  console.log("[PlanPanel] render", {
    planStatus: plan?.status ?? null,
    stepCount: plan?.steps?.length ?? 0,
    current_step: plan?.current_step ?? null,
  });

  const handleStepSave = useCallback(
    (stepIndex: number, updated: PlanStep) => {
      console.log("[PlanPanel] onStepEdit", { stepIndex, partialStep: updated });
      onStepEdit?.(stepIndex, updated);
      setEditingIndex(null);
    },
    [onStepEdit]
  );

  const handleAddStep = useCallback(() => {
    if (newStep.name.trim() && newStep.task.trim()) {
      console.log("[PlanPanel] onStepAdd", { newStep: { ...newStep } });
      onStepAdd?.({ ...newStep });
      setNewStep({ name: "", task: "", agent: "default", editable: true });
      setShowAddForm(false);
    }
  }, [newStep, onStepAdd]);

  // ─── Empty / loading state ───

  if (isLoading || !plan) {
    return (
      <div style={{
        padding: 24, borderRadius: 12,
        border: "1px solid #45475a",
        background: "var(--bg-secondary, #1e1e2e)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 12, minHeight: 120,
      }}>
        {isLoading ? (
          <>
            <Spinner size={24} />
            <span style={{ fontSize: 13, color: "var(--muted, #6c7086)" }}>
              AI 正在生成执行计划...
            </span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 13, color: "var(--muted, #6c7086)" }}>
              暂无执行计划
            </span>
            {onRegenerate && (
              <button
                onClick={() => {
                  console.log("[PlanPanel] onRegenerate", "regeneration triggered");
                  onRegenerate();
                }}
                style={{
                  padding: "6px 16px", borderRadius: 6,
                  border: "1px solid #45475a", background: "transparent",
                  color: "var(--muted, #6c7086)", fontSize: 12,
                  cursor: "pointer",
                }}
              >
                重新生成
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const isPending = plan.status === "pending";
  const isExecuting = plan.status === "executing";
  const isRejected = plan.status === "rejected";

  // ─── Plan content ───

  return (
    <div style={{
      borderRadius: 12,
      border: "1px solid #45475a",
      background: "var(--bg-secondary, #1e1e2e)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid #45475a",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: isPending ? "#f9e2af" : isExecuting ? "var(--accent, #89b4fa)" : plan.status === "completed" ? "#a6e3a1" : "#f38ba8",
          ...(isExecuting ? { animation: "plan-pulse 1.2s ease-in-out infinite" } : {}),
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700,
            color: "var(--fg, #cdd6f4)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {plan.title}
          </div>
          {plan.description && (
            <div style={{
              fontSize: 12, color: "var(--muted, #6c7086)",
              marginTop: 2, lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>
              {plan.description}
            </div>
          )}
        </div>
        <span style={{
          padding: "2px 10px", borderRadius: 999,
          fontSize: 11, fontWeight: 600,
          color: isPending ? "#f9e2af" : isExecuting ? "var(--accent, #89b4fa)" : plan.status === "completed" ? "#a6e3a1" : "#f38ba8",
          background: isPending ? "rgba(249,226,175,0.12)" : isExecuting ? "rgba(137,180,250,0.12)" : plan.status === "completed" ? "rgba(166,227,161,0.12)" : "rgba(243,139,168,0.12)",
          textTransform: "capitalize",
        }}>
          {plan.status === "pending" ? "待确认" : plan.status === "executing" ? "执行中" : plan.status === "completed" ? "已完成" : plan.status === "rejected" ? "已驳回" : plan.status === "cancelled" ? "已取消" : plan.status === "confirmed" ? "已确认" : plan.status}
        </span>
      </div>

      {/* Update notification banner */}
      {plan.update_reasoning && (
        <div style={{
          padding: "8px 16px",
          background: "rgba(249,226,175,0.1)",
          borderBottom: "1px solid rgba(249,226,175,0.2)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 13 }}>🔄</span>
          <span style={{ fontSize: 12, color: "#f9e2af", lineHeight: 1.4 }}>
            计划已更新: {plan.update_reasoning}
          </span>
          {plan.plan_version != null && (
            <span style={{
              fontSize: 10, color: "var(--muted, #6c7086)",
              marginLeft: "auto", whiteSpace: "nowrap",
            }}>
              v{plan.plan_version}
            </span>
          )}
        </div>
      )}

      {/* Progress bar (executing) */}
      {isExecuting && (
        <div style={{ padding: "12px 16px 0" }}>
          <ProgressBar current={plan.current_step} total={plan.total_steps} />
        </div>
      )}

      {/* Steps */}
      <div style={{ padding: "12px 16px" }}>
        {plan.steps.map((step, idx) => {
          const stepStatus = getStepStatus(plan, idx);
          const isEditing = editingIndex === idx;

          console.log("[PlanPanel] stepStatus", { stepIndex: idx, status: stepStatus });

          return (
            <div key={idx}>
              {idx > 0 && (
                <ConnectingLine completed={stepStatus === "completed"} />
              )}
              {isEditing ? (
                <EditableStepCard
                  step={step}
                  stepIndex={idx}
                  onSave={(updated) => handleStepSave(idx, updated)}
                  onCancel={() => {
                    console.log("[PlanPanel] editModeExit", { stepIndex: idx });
                    setEditingIndex(null);
                  }}
                />
              ) : (
                <StepCard
                  step={step}
                  stepIndex={idx}
                  status={stepStatus}
                  isEditable={isPending && step.editable}
                  onEdit={() => {
                    console.log("[PlanPanel] editModeEnter", { stepIndex: idx });
                    setEditingIndex(idx);
                  }}
                  onDelete={() => {
                    console.log("[PlanPanel] onStepDelete", { stepIndex: idx });
                    onStepDelete?.(idx);
                  }}
                  stepResult={plan.step_results?.[String(idx)]}
                  isNewlyAdded={newlyAddedSteps?.has(idx)}
                />
              )}
            </div>
          );
        })}

        {/* Add step form */}
        {showAddForm && isPending && (
          <div style={{ marginTop: 8 }}>
            <ConnectingLine completed={false} />
            <EditableStepCard
              step={newStep}
              stepIndex={plan.steps.length}
              onSave={(updated) => {
                console.log("[PlanPanel] onStepAdd (from form)", { newStep: { ...updated, editable: true } });
                onStepAdd?.({ ...updated, editable: true });
                setNewStep({ name: "", task: "", agent: "default", editable: true });
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{
        padding: "10px 16px 14px",
        borderTop: "1px solid #45475a",
        display: "flex", gap: 8, flexWrap: "wrap",
      }}>
        {isPending && onConfirm && (
          <button
            onClick={() => {
              const editedSteps = editingIndex !== null ? undefined : undefined;
              console.log("[PlanPanel] onConfirm", { planId: plan.id, editedSteps });
              onConfirm(plan.id, editedSteps);
            }}
            style={{
              padding: "7px 18px", borderRadius: 8,
              border: "none", background: "#a6e3a1",
              color: "#1e1e2e", fontSize: 13, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            确认执行
          </button>
        )}
        {isPending && onReject && (
          <button
            onClick={() => {
              console.log("[PlanPanel] onReject", { planId: plan.id });
              onReject(plan.id);
            }}
            style={{
              padding: "7px 18px", borderRadius: 8,
              border: "none", background: "#f38ba8",
              color: "#1e1e2e", fontSize: 13, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            驳回
          </button>
        )}
        {(isPending || isRejected) && onRegenerate && (
          <button
            onClick={() => {
              console.log("[PlanPanel] onRegenerate", "regeneration triggered");
              onRegenerate();
            }}
            style={{
              padding: "7px 18px", borderRadius: 8,
              border: "1px solid #45475a", background: "transparent",
              color: "var(--muted, #6c7086)", fontSize: 13, fontWeight: 500,
              cursor: "pointer",
            }}
          >
            重新生成
          </button>
        )}
        {isPending && onStepAdd && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            style={{
              padding: "7px 18px", borderRadius: 8,
              border: "1px solid #45475a", background: "transparent",
              color: "var(--muted, #6c7086)", fontSize: 13, fontWeight: 500,
              cursor: "pointer",
            }}
          >
            + 添加步骤
          </button>
        )}
      </div>
    </div>
  );
}

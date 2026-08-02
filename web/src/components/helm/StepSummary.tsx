"use client";

import { useState, useMemo } from "react";

/** 对话步骤数据 */
export interface StepSummaryItem {
  id: string;
  stepName: string;
  status: "running" | "completed" | "error";
  durationMs: number | null;
  /** 关键输出摘要 */
  keyOutput?: string;
  /** 完整结果数据（展开时使用） */
  fullResult?: Record<string, any>;
}

interface StepSummaryProps {
  /** 步骤列表 */
  steps: StepSummaryItem[];
  /** 展开步骤查看详情 */
  onExpand: (stepId: string) => void;
}

function formatDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function autoGenerateSummary(step: StepSummaryItem): string {
  if (step.keyOutput) return step.keyOutput;
  if (step.status === "error") return "执行失败";
  if (step.status === "running") return "执行中...";
  if (!step.fullResult) return "已完成";

  const result = step.fullResult as Record<string, any>;
  if (typeof result === "string") return (result as string).slice(0, 120);
  if (result.summary) return String(result.summary).slice(0, 120);
  if (result.content) return String(result.content).slice(0, 120);
  if (result.output) return String(result.output).slice(0, 120);
  const keys = Object.keys(result);
  if (keys.length > 0) return `${keys.length} 个字段`;
  return "已完成";
}

/** 对话流折叠摘要 — 展示已完成步骤的紧凑摘要 */
export default function StepSummary({ steps, onExpand }: StepSummaryProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const completedSteps = useMemo(
    () => steps.filter((s) => s.status === "completed" || s.status === "error"),
    [steps]
  );

  const runningSteps = useMemo(
    () => steps.filter((s) => s.status === "running"),
    [steps]
  );

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (steps.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {/* Running steps — always visible */}
      {runningSteps.map((step) => (
        <div
          key={step.id}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/5 border border-indigo-500/10"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#89b4fa" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0" style={{ animation: "spin 1s linear infinite" }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span className="text-xs font-medium text-indigo-300">{step.stepName}</span>
          <span className="text-[10px] text-gray-500 ml-auto">执行中...</span>
        </div>
      ))}

      {/* Completed/error steps — collapsible */}
      {completedSteps.map((step) => {
        const isCollapsed = collapsedIds.has(step.id);
        const borderColor = step.status === "error" ? "#f38ba8" : "#a6e3a1";

        return (
          <div key={step.id} className="group">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/[0.02] cursor-pointer transition-colors"
              onClick={() => toggleCollapse(step.id)}
              style={{ borderLeft: `2px solid ${borderColor}` }}
            >
              {/* Chevron */}
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                className="text-gray-600 flex-shrink-0 transition-transform duration-150"
                style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>

              {/* Status icon */}
              {step.status === "completed" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={borderColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={borderColor} strokeWidth="2" strokeLinecap="round" className="flex-shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}

              {/* Step name */}
              <span className="text-xs font-medium text-gray-300 truncate">{step.stepName}</span>

              {/* Duration */}
              {step.durationMs != null && (
                <span className="text-[10px] text-gray-600 font-mono flex-shrink-0">
                  {formatDuration(step.durationMs)}
                </span>
              )}

              {/* Expand action */}
              <button
                onClick={(e) => { e.stopPropagation(); onExpand(step.id); }}
                className="text-gray-600 hover:text-gray-300 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                title="查看详情"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M15 3h6v6" /><path d="M10 14L21 3" />
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                </svg>
              </button>
            </div>

            {/* Collapsed summary */}
            {isCollapsed && (
              <div className="ml-[30px] mr-3 py-1">
                <span className="text-[11px] text-gray-500 leading-relaxed">
                  {autoGenerateSummary(step)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

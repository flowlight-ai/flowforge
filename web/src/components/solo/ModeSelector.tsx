"use client";

import { useState, useEffect } from "react";

interface ModeSelectorProps {
  mode: "normal" | "solo" | "auto";
  onModeChange: (mode: "normal" | "solo" | "auto") => void;
  selectedWorkflow: string | null;
  onWorkflowChange: (wf: string | null) => void;
}

interface WorkflowItem {
  name: string;
  display_name: string;
  description: string;
}

const MODE_CONFIG = {
  normal: { label: "普通", color: "bg-blue-600", desc: "选择工作流执行" },
  solo: { label: "Solo", color: "bg-purple-600", desc: "AI自主规划执行" },
  auto: { label: "全自动", color: "bg-rose-600", desc: "全自动执行" },
};

export default function ModeSelector({ mode, onModeChange, selectedWorkflow, onWorkflowChange }: ModeSelectorProps) {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);

  useEffect(() => {
    fetch("/api/v1/graph/workflows")
      .then((r) => r.json())
      .then((data) => setWorkflows(data))
      .catch(() => {});
  }, []);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-800 bg-gray-900/80">
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
        {(Object.keys(MODE_CONFIG) as Array<"normal" | "solo" | "auto">).map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
              mode === m
                ? `${MODE_CONFIG[m].color} text-white shadow-sm`
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            }`}
            title={MODE_CONFIG[m].desc}
          >
            {MODE_CONFIG[m].label}
          </button>
        ))}
      </div>

      {mode === "normal" && (
        <select
          value={selectedWorkflow || ""}
          onChange={(e) => onWorkflowChange(e.target.value || null)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="">选择工作流...</option>
          {workflows.map((wf) => (
            <option key={wf.name} value={wf.name}>
              {wf.display_name || wf.name}
            </option>
          ))}
        </select>
      )}

      <span className="text-xs text-gray-500 ml-auto">
        {mode === "normal" && (selectedWorkflow ? `工作流: ${selectedWorkflow}` : "请选择工作流或切换到Solo模式")}
        {mode === "solo" && "AI将自主规划并执行任务，中间可审核"}
        {mode === "auto" && "AI将全自动执行所有任务"}
      </span>
    </div>
  );
}

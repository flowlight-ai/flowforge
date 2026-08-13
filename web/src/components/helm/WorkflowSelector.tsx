"use client";

import { useState, useEffect } from "react";

export default function WorkflowSelector({ selected, onChange }: { selected: string | null; onChange: (wf: string | null) => void }) {
  const [workflows, setWorkflows] = useState<{name: string; display_name: string}[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/graph/workflows")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setWorkflows(Array.isArray(data) ? data : []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <select
      value={selected || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="chat-workflow-select"
      style={{
        background: "var(--bg-tertiary, #1e293b)",
        border: "1px solid var(--border, #334155)",
        borderRadius: "6px",
        padding: "4px 8px",
        fontSize: "12px",
        color: "var(--text-secondary, #94a3b8)",
        outline: "none",
        cursor: "pointer",
      }}
    >
      <option value="">选择工作流...</option>
      {workflows.map((wf) => (
        <option key={wf.name} value={wf.name}>
          {wf.display_name || wf.name}
        </option>
      ))}
      {error && (
        <option value="" disabled>
          工作流加载失败（{error}）
        </option>
      )}
    </select>
  );
}

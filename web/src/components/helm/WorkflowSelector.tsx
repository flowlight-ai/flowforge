"use client";

import { useState, useEffect } from "react";

export default function WorkflowSelector({ selected, onChange }: { selected: string | null; onChange: (wf: string | null) => void }) {
  const [workflows, setWorkflows] = useState<{name: string; display_name: string}[]>([]);

  useEffect(() => {
    fetch("/api/v1/graph/workflows")
      .then((r) => r.json())
      .then((data) => setWorkflows(data || []))
      .catch(() => {});
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
    </select>
  );
}

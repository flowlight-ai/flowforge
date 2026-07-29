"use client";

/**
 * MissionFilters — 任务过滤器
 *
 * 提供状态、优先级、负责人三个维度的过滤。
 * 受控组件：value/onChange 由父组件管理。
 */

import { type MissionPriority, type MissionStatus } from "./MissionCard";

export interface MissionFilterValue {
  readonly status: MissionStatus | "all";
  readonly priority: MissionPriority | "all";
  readonly assignee: string;
}

interface MissionFiltersProps {
  readonly value: MissionFilterValue;
  readonly onChange: (next: MissionFilterValue) => void;
  readonly assignees?: readonly string[];
}

const STATUS_OPTIONS: ReadonlyArray<{ id: MissionStatus | "all"; label: string }> = [
  { id: "all", label: "全部状态" },
  { id: "todo", label: "待办" },
  { id: "doing", label: "进行中" },
  { id: "done", label: "已完成" },
  { id: "blocked", label: "阻塞" },
  { id: "cancelled", label: "已取消" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ id: MissionPriority | "all"; label: string }> = [
  { id: "all", label: "全部优先级" },
  { id: "urgent", label: "紧急" },
  { id: "high", label: "高" },
  { id: "medium", label: "中" },
  { id: "low", label: "低" },
];

export function MissionFilters({ value, onChange, assignees = [] }: MissionFiltersProps) {
  return (
    <div
      data-mission="filters"
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <FilterSelect
        data-mission-filter="status"
        value={value.status}
        options={STATUS_OPTIONS}
        onChange={(status) => onChange({ ...value, status: status as MissionStatus | "all" })}
      />
      <FilterSelect
        data-mission-filter="priority"
        value={value.priority}
        options={PRIORITY_OPTIONS}
        onChange={(priority) => onChange({ ...value, priority: priority as MissionPriority | "all" })}
      />
      <input
        type="text"
        data-mission-filter="assignee"
        list="mission-assignees"
        value={value.assignee}
        onChange={(e) => onChange({ ...value, assignee: e.target.value })}
        placeholder="按负责人筛选"
        style={{
          padding: "6px 10px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          background: "var(--bg)",
          color: "var(--fg)",
          fontSize: "12px",
          outline: "none",
          minWidth: "120px",
        }}
      />
      <datalist id="mission-assignees">
        {assignees.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      {(value.status !== "all" || value.priority !== "all" || value.assignee) && (
        <button
          data-mission-filter="clear"
          onClick={() => onChange({ status: "all", priority: "all", assignee: "" })}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--muted)",
            fontSize: "12px",
            fontWeight: 500,
            padding: "4px 8px",
          }}
        >
          清除筛选
        </button>
      )}
    </div>
  );
}

interface FilterSelectProps {
  readonly value: string;
  readonly options: ReadonlyArray<{ id: string; label: string }>;
  readonly onChange: (next: string) => void;
  readonly "data-mission-filter"?: string;
}

function FilterSelect({ value, options, onChange, ...rest }: FilterSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 10px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-strong)",
        background: "var(--bg)",
        color: "var(--fg)",
        fontSize: "12px",
        outline: "none",
        cursor: "pointer",
      }}
      {...rest}
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

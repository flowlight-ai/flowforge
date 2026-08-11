"use client";

/**
 * WorkspaceTasksPanel — 任务看板
 *
 * 四段看板（进行中 / 阻塞中 / 待办 / 已完成）+ 创建任务 + 折叠状态持久化
 * 对应 clowder-ai 的 tasks 模块
 */

import { useState, useEffect, useCallback } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: "in_progress" | "blocked" | "todo" | "completed";
  priority: "low" | "medium" | "high" | "critical";
  assignee?: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

// ── 列配置 ─────────────────────────────────────────────────────────

const COLUMNS: Array<{
  id: TaskItem["status"];
  label: string;
  icon: string;
  accent: string;
}> = [
  { id: "in_progress", label: "进行中", icon: "▶", accent: "var(--info)" },
  { id: "blocked", label: "阻塞中", icon: "⛔", accent: "var(--destructive)" },
  { id: "todo", label: "待办", icon: "◻", accent: "var(--warn)" },
  { id: "completed", label: "已完成", icon: "✓", accent: "var(--ok)" },
];

// ── 优先级徽章 ─────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: TaskItem["priority"] }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    critical: { bg: "var(--danger-subtle)", fg: "var(--danger)" },
    high: { bg: "var(--warn-subtle)", fg: "var(--warn)" },
    medium: { bg: "var(--info-subtle)", fg: "var(--info)" },
    low: { bg: "var(--bg-elevated)", fg: "var(--muted)" },
  };
  const c = colors[priority];
  return (
    <span
      style={{
        padding: "1px 5px",
        borderRadius: "3px",
        fontSize: "9px",
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
        textTransform: "uppercase",
      }}
    >
      {priority}
    </span>
  );
}

// ── 任务卡片 ───────────────────────────────────────────────────────

function TaskCard({
  task,
  onMove,
}: {
  task: TaskItem;
  onMove: (id: string, newStatus: TaskItem["status"]) => void;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: "var(--radius-sm, 4px)",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        fontSize: "12px",
        cursor: "pointer",
        transition: "box-shadow 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "4px", marginBottom: "4px" }}>
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: "12px", flex: 1, lineHeight: 1.4 }}>
          {task.title}
        </span>
        <PriorityBadge priority={task.priority} />
      </div>
      {task.description && (
        <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {task.description}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
        {task.assignee && (
          <span style={{ fontSize: "10px", color: "var(--accent)" }}>
            @{task.assignee}
          </span>
        )}
        <div style={{ display: "flex", gap: "2px" }}>
          {/* 快速移动按钮 */}
          {COLUMNS.filter((c) => c.id !== task.status).map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMove(task.id, col.id);
              }}
              title={`移动到 ${col.label}`}
              style={{
                padding: "1px 4px",
                fontSize: "9px",
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "3px",
                color: col.accent,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {col.icon}
            </button>
          ))}
        </div>
      </div>
      {task.tags && task.tags.length > 0 && (
        <div style={{ display: "flex", gap: "3px", flexWrap: "wrap", marginTop: "4px" }}>
          {task.tags.map((tag) => (
            <span
              key={tag}
              style={{
                padding: "1px 5px",
                borderRadius: "3px",
                fontSize: "9px",
                background: "var(--accent-subtle)",
                color: "var(--accent)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 创建任务表单 ───────────────────────────────────────────────────

function CreateTaskForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, description: string, priority: TaskItem["priority"]) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskItem["priority"]>("medium");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), description.trim(), priority);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: "12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="任务标题..."
        autoFocus
        style={{
          width: "100%",
          padding: "6px 8px",
          borderRadius: "var(--radius-sm, 4px)",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: "12px",
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="描述（可选）"
        rows={2}
        style={{
          width: "100%",
          padding: "6px 8px",
          borderRadius: "var(--radius-sm, 4px)",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: "12px",
          fontFamily: "inherit",
          resize: "none",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskItem["priority"])}
          style={{
            padding: "4px 8px",
            borderRadius: "var(--radius-sm, 4px)",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: "11px",
            fontFamily: "inherit",
          }}
        >
          <option value="low">低优先级</option>
          <option value="medium">中优先级</option>
          <option value="high">高优先级</option>
          <option value="critical">紧急</option>
        </select>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "4px 12px",
              borderRadius: "var(--radius-sm, 4px)",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--muted)",
              fontSize: "11px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            取消
          </button>
          <button
            type="submit"
            style={{
              padding: "4px 12px",
              borderRadius: "var(--radius-sm, 4px)",
              border: "none",
              background: "var(--accent)",
              color: "var(--accent-foreground, #fff)",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            创建
          </button>
        </div>
      </div>
    </form>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface TasksPanelProps {
  threadId?: string | null;
}

export default function WorkspaceTasksPanel({ threadId }: TasksPanelProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(() => {
    // 从 localStorage 恢复折叠状态
    if (typeof window === "undefined") return new Set();
    try {
      const stored = localStorage.getItem("flowforge:taskboard:collapsed");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // 持久化折叠状态
  useEffect(() => {
    try {
      localStorage.setItem("flowforge:taskboard:collapsed", JSON.stringify([...collapsedCols]));
    } catch { /* ignore */ }
  }, [collapsedCols]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/tasks?limit=100");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.items ?? data.tasks ?? []);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleMove = useCallback(
    async (id: string, newStatus: TaskItem["status"]) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
      try {
        await fetch(`/api/v1/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch {
        fetchTasks(); // 回滚
      }
    },
    [fetchTasks],
  );

  const handleCreate = useCallback(
    async (title: string, description: string, priority: TaskItem["priority"]) => {
      const tempId = `temp-${Date.now()}`;
      const newTask: TaskItem = {
        id: tempId,
        title,
        description,
        priority,
        status: "todo",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setTasks((prev) => [...prev, newTask]);
      setShowCreate(false);
      try {
        const res = await fetch("/api/v1/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, description, priority }),
        });
        if (res.ok) {
          fetchTasks();
        }
      } catch {
        fetchTasks();
      }
    },
    [fetchTasks],
  );

  const toggleCollapse = (colId: string) => {
    setCollapsedCols((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载任务看板...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 头部 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px" }}>☰</span>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>任务看板</span>
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>({tasks.length})</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: "4px 10px",
            borderRadius: "var(--radius-sm, 4px)",
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-foreground, #fff)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          + 创建任务
        </button>
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <CreateTaskForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* 四段看板 */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {COLUMNS.map((col) => {
            const items = tasks.filter((t) => t.status === col.id);
            const isCollapsed = collapsedCols.has(col.id);

            return (
              <div
                key={col.id}
                style={{
                  borderRadius: "var(--radius-md, 8px)",
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  overflow: "hidden",
                }}
              >
                {/* 列头 */}
                <button
                  type="button"
                  onClick={() => toggleCollapse(col.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    width: "100%",
                    padding: "8px 10px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    borderBottom: isCollapsed ? "none" : "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: col.accent,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)", flex: 1, textAlign: "left" }}>
                    {col.label}
                  </span>
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: "10px",
                      fontSize: "10px",
                      fontWeight: 600,
                      background: col.accent,
                      color: "#fff",
                    }}
                  >
                    {items.length}
                  </span>
                  <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                </button>

                {/* 卡片列表 */}
                {!isCollapsed && (
                  <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {items.length === 0 ? (
                      <div
                        style={{
                          padding: "16px",
                          textAlign: "center",
                          color: "var(--muted)",
                          fontSize: "11px",
                          border: "1px dashed var(--border)",
                          borderRadius: "var(--radius-sm, 4px)",
                        }}
                      >
                        暂无任务
                      </div>
                    ) : (
                      items.map((task) => (
                        <TaskCard key={task.id} task={task} onMove={handleMove} />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
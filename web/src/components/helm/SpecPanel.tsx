"use client";

import { useState, useCallback, useEffect } from "react";

/** Spec 文档数据 */
export interface SpecData {
  spec: string;
  tasks: TaskItem[];
  checklist: ChecklistItem[];
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: "high" | "medium" | "low";
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

interface SpecPanelProps {
  /** Spec 文档内容 */
  spec: string;
  /** 任务列表 */
  tasks: TaskItem[];
  /** 检查清单 */
  checklist: ChecklistItem[];
  /** 更新回调 */
  onUpdate: (data: Partial<SpecData>) => void;
}

type TabKey = "spec" | "tasks" | "checklist";

/** Spec 模式 — 三 Tab 布局管理 spec.md / tasks.md / checklist.md */
export default function SpecPanel({ spec, tasks, checklist, onUpdate }: SpecPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("spec");
  const [specContent, setSpecContent] = useState(spec);
  const [localTasks, setLocalTasks] = useState(tasks);
  const [localChecklist, setLocalChecklist] = useState(checklist);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => { setSpecContent(spec); }, [spec]);
  useEffect(() => { setLocalTasks(tasks); }, [tasks]);
  useEffect(() => { setLocalChecklist(checklist); }, [checklist]);

  const handleSpecChange = useCallback((value: string) => {
    setSpecContent(value);
    onUpdate({ spec: value });
  }, [onUpdate]);

  const toggleTask = useCallback((taskId: string) => {
    setLocalTasks((prev) => {
      const updated = prev.map((t) =>
        t.id === taskId ? { ...t, completed: !t.completed } : t
      );
      onUpdate({ tasks: updated });
      return updated;
    });
  }, [onUpdate]);

  const toggleChecklist = useCallback((itemId: string) => {
    setLocalChecklist((prev) => {
      const updated = prev.map((c) =>
        c.id === itemId ? { ...c, checked: !c.checked } : c
      );
      onUpdate({ checklist: updated });
      return updated;
    });
  }, [onUpdate]);

  const addChecklistItem = useCallback(() => {
    const newItem: ChecklistItem = {
      id: `cl-${Date.now()}`,
      text: "",
      checked: false,
    };
    setLocalChecklist((prev) => {
      const updated = [...prev, newItem];
      onUpdate({ checklist: updated });
      return updated;
    });
  }, [onUpdate]);

  const updateChecklistText = useCallback((itemId: string, text: string) => {
    setLocalChecklist((prev) => {
      const updated = prev.map((c) =>
        c.id === itemId ? { ...c, text } : c
      );
      onUpdate({ checklist: updated });
      return updated;
    });
  }, [onUpdate]);

  const removeChecklistItem = useCallback((itemId: string) => {
    setLocalChecklist((prev) => {
      const updated = prev.filter((c) => c.id !== itemId);
      onUpdate({ checklist: updated });
      return updated;
    });
  }, [onUpdate]);

  const addTask = useCallback(() => {
    const newTask: TaskItem = {
      id: `task-${Date.now()}`,
      title: "",
      description: "",
      completed: false,
      priority: "medium",
    };
    setLocalTasks((prev) => {
      const updated = [...prev, newTask];
      onUpdate({ tasks: updated });
      return updated;
    });
  }, [onUpdate]);

  const updateTask = useCallback((taskId: string, updates: Partial<TaskItem>) => {
    setLocalTasks((prev) => {
      const updated = prev.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      );
      onUpdate({ tasks: updated });
      return updated;
    });
  }, [onUpdate]);

  const removeTask = useCallback((taskId: string) => {
    setLocalTasks((prev) => {
      const updated = prev.filter((t) => t.id !== taskId);
      onUpdate({ tasks: updated });
      return updated;
    });
  }, [onUpdate]);

  const generateSpecFromDescription = useCallback(() => {
    setIsGenerating(true);
    // In a real implementation, this would call an LLM to generate spec
    // For now, we create a template from existing content
    setTimeout(() => {
      const generated = `# 项目规格\n\n## 概述\n${specContent || "请描述项目需求..."}\n\n## 功能需求\n\n### 核心功能\n- [待补充]\n\n### 扩展功能\n- [待补充]\n\n## 技术约束\n- [待补充]\n\n## 验收标准\n- [待补充]\n`;
      setSpecContent(generated);
      onUpdate({ spec: generated });
      setIsGenerating(false);
    }, 500);
  }, [specContent, onUpdate]);

  const completedTasks = localTasks.filter((t) => t.completed).length;
  const totalTasks = localTasks.length;
  const completedChecklist = localChecklist.filter((c) => c.checked).length;
  const totalChecklist = localChecklist.length;

  const priorityColors: Record<string, string> = {
    high: "#f38ba8",
    medium: "#f9e2af",
    low: "#a6e3a1",
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-elevated)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 flex-shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span className="text-sm font-semibold text-[var(--text)]">Spec 模式</span>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[var(--border)] flex-shrink-0">
        {([
          { key: "spec" as TabKey, label: "spec.md", badge: null },
          { key: "tasks" as TabKey, label: "tasks.md", badge: totalTasks > 0 ? `${completedTasks}/${totalTasks}` : null },
          { key: "checklist" as TabKey, label: "checklist.md", badge: totalChecklist > 0 ? `${completedChecklist}/${totalChecklist}` : null },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors border-b-2 flex items-center justify-center gap-1.5 ${
              activeTab === tab.key
                ? "text-[var(--cafe-accent)] border-[var(--cafe-accent)]"
                : "text-[var(--muted)] border-transparent hover:text-[var(--text)]"
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--muted)]">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Spec tab */}
        {activeTab === "spec" && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[var(--muted)]">Markdown 格式</span>
              <button
                onClick={generateSpecFromDescription}
                disabled={isGenerating}
                className="text-xs px-2 py-1 rounded-lg bg-[var(--cafe-accent)] hover:bg-[var(--cafe-accent-hover)] text-[var(--cafe-accent-foreground)] transition-colors disabled:opacity-50 flex items-center gap-1"
              >
                {isGenerating ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                )}
                自动生成
              </button>
            </div>
            <textarea
              value={specContent}
              onChange={(e) => handleSpecChange(e.target.value)}
              className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] font-mono focus:outline-none focus:border-[var(--cafe-accent)] resize-none min-h-[400px]"
              placeholder="# 项目规格&#10;&#10;## 概述&#10;描述项目需求..."
            />
          </div>
        )}

        {/* Tasks tab */}
        {activeTab === "tasks" && (
          <div className="p-4 space-y-2">
            {localTasks.map((task) => (
              <div
                key={task.id}
                className={`rounded-lg border p-3 transition-colors ${
                  task.completed
                    ? "border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_30%,transparent)] opacity-60"
                    : "border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_60%,transparent)]"
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => toggleTask(task.id)}
                    className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      task.completed
                        ? "bg-[var(--cafe-accent)] border-[var(--cafe-accent)]"
                        : "border-[var(--border-strong)] hover:border-[var(--cafe-accent)]"
                    }`}
                  >
                    {task.completed && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <input
                      type="text"
                      value={task.title}
                      onChange={(e) => updateTask(task.id, { title: e.target.value })}
                      placeholder="任务标题"
                      className={`w-full bg-transparent text-sm font-medium focus:outline-none ${
                        task.completed ? "text-[var(--muted)] line-through" : "text-[var(--text)]"
                      }`}
                    />
                    {task.description && (
                      <p className="text-[11px] text-[var(--muted)] mt-0.5">{task.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: priorityColors[task.priority] }}
                      title={task.priority}
                    />
                    <button
                      onClick={() => removeTask(task.id)}
                      className="text-[var(--muted)] hover:text-[var(--danger)] p-0.5 rounded transition-colors"
                      title="删除"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button
              onClick={addTask}
              className="w-full py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] border border-dashed border-[var(--border)] rounded-lg hover:border-[var(--border-strong)] transition-colors"
            >
              + 添加任务
            </button>
          </div>
        )}

        {/* Checklist tab */}
        {activeTab === "checklist" && (
          <div className="p-4 space-y-1.5">
            {localChecklist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => toggleChecklist(item.id)}
                  className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                    item.checked
                      ? "bg-[var(--cafe-accent)] border-[var(--cafe-accent)]"
                      : "border-[var(--border-strong)] hover:border-[var(--cafe-accent)]"
                  }`}
                >
                  {item.checked && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                <input
                  type="text"
                  value={item.text}
                  onChange={(e) => updateChecklistText(item.id, e.target.value)}
                  placeholder="检查项..."
                  className={`flex-1 bg-transparent text-sm focus:outline-none ${
                    item.checked ? "text-[var(--muted)] line-through" : "text-[var(--text)]"
                  }`}
                />
                <button
                  onClick={() => removeChecklistItem(item.id)}
                  className="text-[var(--muted)] hover:text-[var(--danger)] p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  title="删除"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              onClick={addChecklistItem}
              className="w-full py-2 text-xs text-[var(--muted)] hover:text-[var(--text)] border border-dashed border-[var(--border)] rounded-lg hover:border-[var(--border-strong)] transition-colors mt-2"
            >
              + 添加检查项
            </button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {activeTab === "tasks" && totalTasks > 0 && (
        <div className="px-4 py-2 border-t border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--cafe-accent)] rounded-full transition-all duration-300"
                style={{ width: `${(completedTasks / totalTasks) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-[var(--muted)] font-mono">{completedTasks}/{totalTasks}</span>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  Fragment,
} from "react";
import Link from "next/link";
import { useSoloWebSocket } from "../../hooks/useSoloWebSocket";
import { useShellConfig } from "../../lib/shell-config";
import {
  StreamEntry,
  SoloTaskPhase,
  StreamEntryType,
} from "../../lib/solo-types";

const COMMANDS = [
  { cmd: "/plan", desc: "切换到规划模式" },
  { cmd: "/spec", desc: "切换到规格模式" },
  { cmd: "/review", desc: "强制审核检查点" },
  { cmd: "/pause", desc: "暂停执行" },
  { cmd: "/resume", desc: "恢复执行" },
  { cmd: "/skip", desc: "跳过当前步骤" },
  { cmd: "/reset", desc: "重置并开始新任务" },
  { cmd: "/help", desc: "显示可用命令" },
];

interface TaskHistoryItem {
  taskId: string;
  persona: string;
  intent: string;
  phase: SoloTaskPhase;
  timestamp: number;
}

interface ChatMessage {
  id: string;
  role: "ai" | "system" | "tool" | "stage" | "gate" | "review" | "user" | "approval";
  content: string;
  timestamp: string;
  data?: Record<string, any>;
  collapsed?: boolean;
}

interface StepGroupData {
  id: string;
  stepNumber: number;
  stepLabel: string;
  stageKey: string;
  status: "running" | "completed" | "error";
  durationMs: number | null;
  entries: ChatMessage[];
  startTime: string;
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ""; }
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function renderSimpleMarkdown(md: string): string {
  let html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}

function getToolIcon(toolName?: string): string {
  const icons: Record<string, string> = {
    helixrag: "🔍", helixrag_search: "🔍", web_search: "🌐",
    scraper: "📄", llm: "🤖", llm_client: "🤖",
    shell_executor: "⌨", git_operations: "🔀",
    code_quality: "📐", security_scanner: "🔒",
    test_runner: "🧪", cicd_trigger: "🚀", monitoring: "📊",
  };
  return icons[toolName || ""] || "🔧";
}

function getToolSummary(data: Record<string, any>): string {
  const toolName: string = data.tool_name || "";
  const nameLower = toolName.toLowerCase();
  if (nameLower.includes("search") || nameLower.includes("helixrag")) {
    return `搜索完成，找到 ${data.result?.data?.results?.length || data.result?.results?.length || 0} 条结果`;
  }
  if (nameLower.includes("llm") || nameLower.includes("generate")) {
    return "内容生成完成";
  }
  if (data.error) return `执行失败: ${data.error}`;
  return "执行完成";
}

function entryToChatMessages(entry: StreamEntry): ChatMessage[] {
  const base = { id: entry.id, timestamp: entry.timestamp, data: entry.data };
  switch (entry.type) {
    case "stage":
      return [{ ...base, role: "stage", content: entry.data.label || entry.data.stage || entry.data.step || "" }];
    case "tool-call":
      return [{ ...base, role: "tool", content: entry.data.tool_name || "工具调用" }];
    case "thinking":
      return [{ ...base, role: "ai", content: entry.data.delta_text || "", data: { ...entry.data, _thinking: true } }];
    case "llm-stream":
      return [{ ...base, role: "ai", content: entry.data.delta_text || "", data: { ...entry.data, _streaming: true, _agent_name: entry.data.agent_name } }];
    case "intermediate":
      return [{ ...base, role: "system", content: entry.data.step_name || "中间结果" }];
    case "review":
      return [{ ...base, role: "review", content: entry.data.draft_summary || "审核节点" }];
    case "gate":
      return [{ ...base, role: "gate", content: `${entry.data.is_passed ? "✓" : "✗"} ${entry.data.gate_id}` }];
    case "system":
      if (entry.data?.error_message) return [{ ...base, role: "system", content: `✗ ${entry.data.error_message}` }];
      if (entry.data?.published_urls) return [{ ...base, role: "system", content: "✓ 任务完成" }];
      if (entry.data?.result) return [{ ...base, role: "system", content: "✓ 任务完成" }];
      return [{ ...base, role: "system", content: "✓ 任务完成" }];
    default:
      return [];
  }
}

function mergeStreamingMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let currentStream: ChatMessage | null = null;

  for (const msg of messages) {
    if (msg.role === "ai" && msg.data?._streaming) {
      if (currentStream && currentStream.data?._agent_name === msg.data?._agent_name) {
        currentStream.content += msg.content;
      } else {
        if (currentStream) result.push(currentStream);
        currentStream = { ...msg, id: `stream-${msg.id}`, data: { ...msg.data, _streaming: true } };
      }
    } else {
      if (currentStream) { result.push(currentStream); currentStream = null; }
      result.push(msg);
    }
  }
  if (currentStream) result.push(currentStream);
  return result;
}

function groupMessagesIntoSteps(
  messages: ChatMessage[],
  phase: SoloTaskPhase
): (ChatMessage | StepGroupData)[] {
  const result: (ChatMessage | StepGroupData)[] = [];
  let currentGroup: StepGroupData | null = null;
  let stepCounter = 0;
  const isTerminal = (p: SoloTaskPhase): boolean => p === "completed" || p === "error" || p === "rejected";

  for (const msg of messages) {
    if (msg.role === "stage") {
      if (currentGroup) {
        currentGroup.status = isTerminal(phase) ? "completed" : "running";
        result.push(currentGroup);
      }
      stepCounter++;
      currentGroup = {
        id: `step-${stepCounter}`, stepNumber: stepCounter,
        stepLabel: msg.content, stageKey: msg.data?.stage || msg.content,
        status: "running", durationMs: null, entries: [], startTime: msg.timestamp,
      };
    } else if (currentGroup) {
      currentGroup.entries.push(msg);
      if (msg.role === "tool" && msg.data?.duration_ms) {
        currentGroup.durationMs = (currentGroup.durationMs || 0) + msg.data.duration_ms;
      }
      if (msg.role === "gate" && !msg.data?.is_passed) currentGroup.status = "error";
    } else {
      result.push(msg);
    }
  }
  if (currentGroup) result.push(currentGroup);
  return result;
}

function loadTaskHistory(brand: string): TaskHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${brand}_solo_history`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveTaskHistory(brand: string, items: TaskHistoryItem[]): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`${brand}_solo_history`, JSON.stringify(items.slice(0, 20))); } catch {}
}

function appendTaskHistory(brand: string, item: TaskHistoryItem): TaskHistoryItem[] {
  const existing = loadTaskHistory(brand);
  const filtered = existing.filter((h) => h.taskId !== item.taskId);
  const updated = [item, ...filtered].slice(0, 20);
  saveTaskHistory(brand, updated);
  return updated;
}

function StepGroup({
  group, isLastActive, onApprovalAction,
}: {
  group: StepGroupData;
  isLastActive: boolean;
  onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(!isLastActive);
  const [detailCollapsed, setDetailCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isLastActive && group.status === "running") setCollapsed(false);
  }, [isLastActive, group.status]);

  const toggleDetail = useCallback((id: string) => {
    setDetailCollapsed((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const statusIcon = group.status === "completed" ? "✓" : group.status === "error" ? "✗" : "●";
  const subCount = group.entries.length;

  return (
    <div className="chat-step-group">
      <div className="chat-step-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="chat-step-toggle">{collapsed ? "▸" : "▾"}</span>
        <span className="chat-step-number">{group.stepNumber}</span>
        <span className="chat-step-name">{group.stepLabel}</span>
        <span className={`chat-step-status ${group.status}`}>{statusIcon}</span>
        {group.durationMs != null && group.durationMs > 0 && (
          <span className="chat-step-duration">{formatDurationMs(group.durationMs)}</span>
        )}
        <span className="chat-step-count">{subCount} 项</span>
      </div>
      {!collapsed && (
        <div className="chat-step-body">
          {group.entries.map((msg) => {
            const isDetailCollapsed = detailCollapsed.has(msg.id);
            if (msg.role === "tool") {
              return (
                <div key={msg.id} className={`chat-tool-card${isDetailCollapsed ? " collapsed" : ""}`}>
                  <div className="chat-tool-header" onClick={() => toggleDetail(msg.id)}>
                    <span className="chat-tool-icon">{getToolIcon(msg.data?.tool_name)}</span>
                    <span className="chat-tool-name">{msg.content}</span>
                    {msg.data?.duration_ms && <span className="chat-tool-duration">{formatDurationMs(msg.data.duration_ms)}</span>}
                    <span className="chat-tool-toggle">{isDetailCollapsed ? "▸" : "▾"}</span>
                  </div>
                  <div className="chat-tool-summary">{getToolSummary(msg.data || {})}</div>
                  {!isDetailCollapsed && msg.data?.error && <div className="chat-tool-error-msg">{msg.data.error}</div>}
                </div>
              );
            }
            if (msg.role === "ai" && msg.data?._thinking) {
              return (
                <div key={msg.id} className={`chat-thinking${isDetailCollapsed ? " collapsed" : ""}`} onClick={() => toggleDetail(msg.id)}>
                  <div className="chat-thinking-header">
                    <span>🧠 思考</span>
                    {msg.data?.agent_name && <span className="chat-thinking-agent">({msg.data.agent_name})</span>}
                    <span className="chat-msg-time">{formatTs(msg.timestamp)}</span>
                  </div>
                  {!isDetailCollapsed && <div className="chat-thinking-body">{msg.content.slice(0, 200)}{msg.content.length > 200 ? "..." : ""}</div>}
                </div>
              );
            }
            if (msg.role === "ai" && msg.data?._streaming) {
              return (
                <div key={msg.id} className="chat-ai-msg">
                  <div className="chat-ai-label">{msg.data?.agent_name || "AI"}</div>
                  <div className="chat-ai-content">{msg.content}</div>
                </div>
              );
            }
            if (msg.role === "system") {
              const isSuccess = msg.content.startsWith("✓");
              return <div key={msg.id} className={`chat-system-msg${isSuccess ? " success" : " error"} animate-rise`}>{msg.content}<span className="chat-msg-time">{formatTs(msg.timestamp)}</span></div>;
            }
            if (msg.role === "gate") {
              const passed = msg.data?.is_passed;
              return <div key={msg.id} className={`chat-gate${passed ? " passed" : " failed"} animate-rise`}>{msg.content}</div>;
            }
            if (msg.role === "approval") {
              return <ApprovalCard key={msg.id} messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />;
            }
            if (msg.role === "review") {
              return <div key={msg.id} className="chat-review-card animate-rise"><div className="chat-review-header">⏸ 审核节点</div><p className="chat-review-summary">{msg.content}</p></div>;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ messageId, data, onAction }: { messageId: string; data: Record<string, any>; onAction: (messageId: string, approved: boolean, feedback: string) => void; }) {
  const [feedback, setFeedback] = useState("");
  const [resolved, setResolved] = useState<{ approved: boolean; feedback: string } | null>(null);
  const handleApprove = useCallback(() => { setResolved({ approved: true, feedback }); onAction(messageId, true, feedback); }, [messageId, feedback, onAction]);
  const handleReject = useCallback(() => { setResolved({ approved: false, feedback }); onAction(messageId, false, feedback); }, [messageId, feedback, onAction]);
  const isPermission = data.type === "permission";
  const icon = isPermission ? "🔒" : "⚠";
  const title = isPermission ? "权限申请" : "审批请求";
  const description = data.description || data.reason || data.message || "AI 请求您的确认";
  if (resolved) {
    return <div className="chat-approval-card"><div className={`chat-approval-result ${resolved.approved ? "approved" : "rejected"}`}>{resolved.approved ? "✓ 已批准" : "✗ 已拒绝"}{resolved.feedback && <span className="chat-approval-feedback">: {resolved.feedback}</span>}</div></div>;
  }
  return (
    <div className="chat-approval-card">
      <div className="chat-approval-title">{icon} {title}</div>
      <div className="chat-approval-desc">{description}</div>
      <textarea className="chat-approval-textarea" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="输入反馈（可选）..." />
      <div className="chat-approval-actions">
        <button className="btn btn-success btn-sm" onClick={handleApprove}>✓ 批准</button>
        <button className="btn btn-danger btn-sm" onClick={handleReject}>✗ 拒绝</button>
      </div>
    </div>
  );
}

function CommandDropdown({ filter, onSelect, activeIndex }: { filter: string; onSelect: (cmd: string) => void; activeIndex: number; }) {
  const filtered = COMMANDS.filter((c) => c.cmd.startsWith(filter.toLowerCase()));
  if (filtered.length === 0) return null;
  return (
    <div className="cmd-dropdown">
      {filtered.map((c, i) => (
        <div key={c.cmd} className={`cmd-option${i === activeIndex ? " cmd-option-active" : ""}`} onMouseDown={(e) => { e.preventDefault(); onSelect(c.cmd); }}>
          <span className="cmd-option-cmd">{c.cmd}</span>
          <span className="cmd-option-desc">{c.desc}</span>
        </div>
      ))}
    </div>
  );
}

function ResizeHandle({ onResize }: { onResize: (deltaX: number) => void }) {
  const dragging = useRef(false);
  const lastX = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      onResize(ev.clientX - lastX.current);
      lastX.current = ev.clientX;
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [onResize]);
  return <div className="resize-handle" onMouseDown={onMouseDown} />;
}

function loadDeletedIds(brand: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(`${brand}_solo_deleted`);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveDeletedIds(brand: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`${brand}_solo_deleted`, JSON.stringify([...ids])); } catch {}
}

function TaskListPanel({
  phase, intent, taskId, elapsed, onNewTask, onRestoreChat, onSwitchTask, refreshTrigger,
}: {
  phase: SoloTaskPhase; intent: string; taskId: string | null; elapsed: number; onNewTask: () => void;
  onRestoreChat: (messages: ChatMessage[]) => void;
  onSwitchTask: (taskId: string, intent: string, persona: string, phase: SoloTaskPhase) => void;
  refreshTrigger?: number;
}) {
  const config = useShellConfig();
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const refreshList = useCallback(() => {
    const brand = config.brandName.toLowerCase();
    const deletedIds = deletedIdsRef.current;
    fetch("/api/v1/workspace")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const serverItems: TaskHistoryItem[] = (data?.workspaces || []).map((ws: any) => ({
          taskId: ws.task_id,
          persona: ws.persona || "default",
          intent: ws.intent || ws.task_id,
          phase: (ws.status === "completed" ? "completed" : ws.status === "error" ? "error" : ws.status === "running" ? "running" : "completed") as SoloTaskPhase,
          timestamp: ws.created_at ? new Date(ws.created_at).getTime() : Date.now(),
        }));
        const localItems = loadTaskHistory(brand);
        const merged = new Map<string, TaskHistoryItem>();
        for (const item of [...serverItems, ...localItems]) {
          if (deletedIds.has(item.taskId)) continue;
          if (!merged.has(item.taskId)) merged.set(item.taskId, item);
        }
        const sorted = Array.from(merged.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
        setHistory(sorted);
        saveTaskHistory(brand, sorted);
      })
      .catch(() => {
        const brand = config.brandName.toLowerCase();
        const local = loadTaskHistory(brand).filter((h) => !deletedIdsRef.current.has(h.taskId));
        setHistory(local);
      });
  }, [config.brandName]);

  useEffect(() => {
    const brand = config.brandName.toLowerCase();
    deletedIdsRef.current = loadDeletedIds(brand);
    refreshList();
  }, [config.brandName, refreshList, refreshTrigger]);

  useEffect(() => {
    if (taskId && phase === "running") {
      const brand = config.brandName.toLowerCase();
      const existing = loadTaskHistory(brand);
      const found = existing.find((h) => h.taskId === taskId);
      if (!found && intent) {
        const newItem: TaskHistoryItem = { taskId, persona: "default", intent, phase, timestamp: Date.now() };
        const updated = [newItem, ...existing].slice(0, 20);
        saveTaskHistory(brand, updated);
        setHistory((prev) => {
          if (prev.find((h) => h.taskId === taskId)) return prev;
          return [newItem, ...prev].slice(0, 20);
        });
      } else if (found && found.phase !== phase) {
        const updated = existing.map((h) => h.taskId === taskId ? { ...h, phase } : h);
        saveTaskHistory(brand, updated);
        setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
      }
    }
    if (taskId && (phase === "completed" || phase === "error")) {
      const brand = config.brandName.toLowerCase();
      const existing = loadTaskHistory(brand);
      const updated = existing.map((h) => h.taskId === taskId ? { ...h, phase } : h);
      saveTaskHistory(brand, updated);
      setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
    }
  }, [taskId, phase, intent, config.brandName]);

  const phaseLabel: Record<SoloTaskPhase, string> = {
    idle: "就绪", creating: "创建中", connecting: "连接中", running: "执行中",
    paused: "已暂停", waiting_review: "待审核", completed: "已完成", error: "出错", rejected: "已拒绝",
  };

  const handleRename = (tid: string) => {
    if (!renameText.trim()) { setRenaming(null); return; }
    const brand = config.brandName.toLowerCase();
    const items = loadTaskHistory(brand);
    const updated = items.map((h) => h.taskId === tid ? { ...h, intent: renameText.trim() } : h);
    saveTaskHistory(brand, updated);
    setHistory(updated.filter((h) => !deletedIdsRef.current.has(h.taskId)));
    setRenaming(null);
    setMenuOpen(null);
    fetch(`/api/v1/workspace/${tid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: renameText.trim() }),
    }).catch(() => {});
  };

  const handleDelete = (tid: string) => {
    const brand = config.brandName.toLowerCase();
    const items = loadTaskHistory(brand).filter((h) => h.taskId !== tid);
    saveTaskHistory(brand, items);
    deletedIdsRef.current.add(tid);
    saveDeletedIds(brand, deletedIdsRef.current);
    setHistory(items);
    setMenuOpen(null);
    fetch(`/api/v1/workspace/${tid}`, { method: "DELETE" }).catch(() => {});
  };

  const statusIcon = (p: SoloTaskPhase) => {
    if (p === "running" || p === "creating" || p === "connecting") return <span className="task-status-spinner" />;
    if (p === "completed") return <span className="task-status-check">✓</span>;
    if (p === "error" || p === "rejected") return <span className="task-status-stop">■</span>;
    if (p === "paused") return <span className="task-status-pause">❚❚</span>;
    return <span className="task-status-dot" />;
  };

  const allTasks = useMemo(() => {
    const tasks = [...history];
    if (taskId && !tasks.find((t) => t.taskId === taskId)) {
      tasks.unshift({ taskId, persona: "default", intent: intent || "新任务", phase, timestamp: Date.now() });
    }
    return tasks;
  }, [history, taskId, intent, phase]);

  return (
    <div className="solo-task-sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo" style={{ background: config.brandColor }}>{config.brandShort}</span>
        <span className="sidebar-title">任务列表</span>
      </div>
      <div className="task-history-list">
        {allTasks.length === 0 ? (
          <div className="task-empty-hint">暂无任务</div>
        ) : (
          allTasks.map((item) => (
            <div key={item.taskId} className={`task-history-item${item.taskId === taskId ? " active" : ""}`}
              onClick={async () => {
                if (renaming) return;
                if (item.taskId === taskId) return;
                onSwitchTask(item.taskId, item.intent, item.persona, item.phase);
                try {
                  const r = await fetch(`/api/v1/workspace/${item.taskId}/messages`);
                  if (r.ok) {
                    const data = await r.json();
                    if (data.messages?.length > 0) {
                      const restored: ChatMessage[] = data.messages.map((m: any, i: number) => ({
                        id: `restored-${item.taskId}-${i}`,
                        role: m.role === "assistant" ? "ai" : m.role,
                        content: m.content,
                        timestamp: m.timestamp || new Date().toISOString(),
                      }));
                      onRestoreChat(restored);
                    } else {
                      onRestoreChat([]);
                    }
                  }
                } catch {}
              }}
            >
              <div className="task-history-row">
                <div className="task-history-content">
                  {renaming === item.taskId ? (
                    <input className="task-rename-input" value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRename(item.taskId); if (e.key === "Escape") setRenaming(null); }}
                      onBlur={() => handleRename(item.taskId)}
                      autoFocus onClick={(e) => e.stopPropagation()} />
                  ) : (
                    <div className="task-history-intent">{item.intent.length > 40 ? item.intent.slice(0, 40) + "..." : item.intent}</div>
                  )}
                </div>
                <div className="task-history-menu-trigger" onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === item.taskId ? null : item.taskId); }}>
                  ⋯
                </div>
              </div>
              <div className="task-history-meta">
                {statusIcon(item.phase)}
                <span>{phaseLabel[item.phase]}</span>
                <span>{new Date(item.timestamp).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {menuOpen === item.taskId && (
                <div className="task-context-menu" onClick={(e) => e.stopPropagation()}>
                  <button className="task-context-menu-item" onClick={() => { setRenaming(item.taskId); setRenameText(item.intent); setMenuOpen(null); }}>
                    ✏️ 重命名
                  </button>
                  <button className="task-context-menu-item task-context-menu-danger" onClick={() => handleDelete(item.taskId)}>
                    🗑️ 删除
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-sm btn-full" onClick={onNewTask}>+ 新任务</button>
      </div>
    </div>
  );
}

function ChatStream({
  messages, phase, onApprovalAction,
}: {
  messages: ChatMessage[]; phase: SoloTaskPhase; onApprovalAction: (messageId: string, approved: boolean, feedback: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const config = useShellConfig();

  const stepGroups = useMemo(() => groupMessagesIntoSteps(messages, phase), [messages, phase]);
  const lastStepGroupIdx = useMemo(() => {
    for (let i = stepGroups.length - 1; i >= 0; i--) { if ("stepNumber" in stepGroups[i]) return i; }
    return -1;
  }, [stepGroups]);

  useEffect(() => {
    if (!userScrolled.current && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (el) userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight > 60;
  };

  const isActive = phase === "running" || phase === "connecting" || phase === "creating";

  return (
    <div className="chat-stream" ref={containerRef} onScroll={handleScroll}>
      {messages.length === 0 && phase === "idle" && (
        <div className="chat-welcome">
          <div className="chat-welcome-icon">✦</div>
          <h2 className="chat-welcome-title">{config.brandName} Solo</h2>
          <p className="chat-welcome-desc">描述你的需求，AI 将自主执行任务。<br />你可以随时干预、审核或调整方向。</p>
          <div className="chat-welcome-cmd-hint">输入 <code>/</code> 查看可用命令</div>
        </div>
      )}
      {messages.length === 0 && (phase === "creating" || phase === "connecting") && (
        <div className="chat-welcome"><div className="spinner" /><p style={{ color: "var(--muted)", fontSize: "13px" }}>{phase === "creating" ? "正在创建任务..." : "正在连接..."}</p></div>
      )}
      {stepGroups.map((item, idx) => {
        if ("stepNumber" in item) {
          const isLastActive = idx === lastStepGroupIdx && (phase === "running" || phase === "waiting_review" || phase === "paused");
          return <StepGroup key={item.id} group={item} isLastActive={isLastActive} onApprovalAction={onApprovalAction} />;
        }
        const msg = item as ChatMessage;
        if (msg.role === "user") return <div key={msg.id} className="chat-user-msg animate-rise"><div className="chat-user-bubble"><div className="chat-user-content">{msg.content}</div><span className="chat-msg-time">{formatTs(msg.timestamp)}</span></div></div>;
        if (msg.role === "approval") return <ApprovalCard key={msg.id} messageId={msg.id} data={msg.data || {}} onAction={onApprovalAction} />;
        if (msg.role === "gate") return <div key={msg.id} className={`chat-gate${msg.data?.is_passed ? " passed" : " failed"} animate-rise`}>{msg.content}</div>;
        if (msg.role === "review") return <div key={msg.id} className="chat-review-card animate-rise"><div className="chat-review-header">⏸ 审核节点</div><p className="chat-review-summary">{msg.content}</p></div>;
        if (msg.role === "system") return <div key={msg.id} className={`chat-system-msg${msg.content.startsWith("✓") ? " success" : " error"} animate-rise`}>{msg.content}<span className="chat-msg-time">{formatTs(msg.timestamp)}</span></div>;
        return null;
      })}
      {phase === "waiting_review" && <ApprovalCard messageId="review-inline" data={{ type: "review", description: "AI 已完成当前阶段，等待您的审核确认后继续" }} onAction={onApprovalAction} />}
      {isActive && messages.length > 0 && <div className="chat-processing"><div className="spinner" style={{ width: "12px", height: "12px", margin: "0" }} /><span>处理中...</span></div>}
      <div ref={bottomRef} />
    </div>
  );
}

function MarkdownPanel({
  content, onChange, phase,
}: {
  content: string; onChange: (content: string) => void; phase: SoloTaskPhase;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState(content);
  useEffect(() => { setEditBuffer(content); }, [content]);

  const handleExport = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "output.md"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveEdit = () => { onChange(editBuffer); setEditMode(false); };
  const handleCancelEdit = () => { setEditBuffer(content); setEditMode(false); };

  return (
    <div className="solo-artifact-panel">
      <div className="artifact-tabs">
        <div className="artifact-tab-group">
          <button className={`artifact-tab${!editMode ? " active" : ""}`} onClick={() => setEditMode(false)}>预览</button>
          <button className={`artifact-tab${editMode ? " active" : ""}`} onClick={() => setEditMode(true)}>编辑</button>
        </div>
        <div className="artifact-tab-spacer" />
        <div className="artifact-tab-actions">
          {editMode ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={handleSaveEdit}>保存</button>
              <button className="btn btn-ghost btn-sm" onClick={handleCancelEdit}>取消</button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(content)}>复制</button>
              <button className="btn btn-ghost btn-sm" onClick={handleExport}>导出</button>
            </>
          )}
        </div>
      </div>
      <div className="artifact-body">
        {editMode ? (
          <textarea className="artifact-edit-area" value={editBuffer} onChange={(e) => setEditBuffer(e.target.value)} />
        ) : content ? (
          <div className="artifact-draft-preview" dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(content) }} />
        ) : (
          <div className="artifact-draft-empty">任务输出内容将在此展示</div>
        )}
        <div className="artifact-footer-info">{content.length} 字</div>
      </div>
    </div>
  );
}

function ChatInput({
  phase, onSubmit, onReview, onCommand, onStop,
}: {
  phase: SoloTaskPhase;
  onSubmit: (text: string, persona?: string, model?: string) => void;
  onReview: (verdict: "pass" | "reject", feedback: string) => void;
  onCommand: (cmd: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [activeCmdIndex, setActiveCmdIndex] = useState(0);
  const [models, setModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [updatingModels, setUpdatingModels] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const config = useShellConfig();

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(Math.max(textarea.scrollHeight, 40), 140) + "px";
  }, []);

  useEffect(() => {
    resizeTextarea();
    if (!text && textareaRef.current) textareaRef.current.style.height = "";
  }, [text, resizeTextarea]);

  const fetchAvailableModels = useCallback(() => {
    fetch("/api/v1/admin/models/available")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list = data?.data?.models || data?.models || [];
        setModels(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchAvailableModels(); }, [fetchAvailableModels]);

  const handleForceUpdate = useCallback(async () => {
    setUpdatingModels(true);
    try {
      await fetch("/api/v1/admin/models/force-update", { method: "POST" });
      fetchAvailableModels();
    } catch {}
    setUpdatingModels(false);
  }, [fetchAvailableModels]);

  const isIdle = phase === "idle" || phase === "completed" || phase === "error";
  const isWaitingReview = phase === "waiting_review";
  const isRunning = phase === "running" || phase === "paused";
  const isDisabled = phase === "creating" || phase === "connecting";
  const isSending = isRunning || phase === "creating" || phase === "connecting";

  const filteredCommands = useMemo(() => COMMANDS.filter((c) => c.cmd.startsWith(commandFilter.toLowerCase())), [commandFilter]);
  useEffect(() => { setActiveCmdIndex(0); }, [filteredCommands.length]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("/")) { onCommand(trimmed.split(" ")[0]); setText(""); setShowCommands(false); setCommandFilter(""); return; }
    const modelToSend = selectedModel === "auto" ? undefined : selectedModel;
    if (isIdle) { onSubmit(trimmed, undefined, modelToSend); }
    else if (isRunning) { onSubmit(trimmed); }
    setText("");
  }, [text, isIdle, isRunning, selectedModel, onSubmit, onCommand]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showCommands) {
        if (e.key === "ArrowDown") { e.preventDefault(); setActiveCmdIndex((prev) => prev < filteredCommands.length - 1 ? prev + 1 : 0); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); setActiveCmdIndex((prev) => prev > 0 ? prev - 1 : filteredCommands.length - 1); return; }
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (filteredCommands[activeCmdIndex]) { onCommand(filteredCommands[activeCmdIndex].cmd); setText(""); setShowCommands(false); setCommandFilter(""); } return; }
        if (e.key === "Escape") { setShowCommands(false); return; }
      }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    },
    [showCommands, filteredCommands, activeCmdIndex, handleSend, onCommand]
  );

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    if (val.startsWith("/") && val.indexOf(" ") === -1) { setShowCommands(true); setCommandFilter(val); }
    else { setShowCommands(false); setCommandFilter(""); }
  }, []);

  useEffect(() => { if (isIdle && textareaRef.current) textareaRef.current.focus(); }, [isIdle]);

  return (
    <div className="chat-input-area">
      {isWaitingReview && (
        <div className="chat-review-actions">
          <div className="review-actions-header">审核操作</div>
          <textarea className="review-feedback-input" rows={2} value={reviewFeedback} onChange={(e) => setReviewFeedback(e.target.value)} placeholder="输入审核反馈（可选）..." />
          <div className="review-actions-buttons">
            <button className="btn btn-success btn-sm" onClick={() => { onReview("pass", reviewFeedback); setReviewFeedback(""); }}>✓ 通过</button>
            <button className="btn btn-danger btn-sm" onClick={() => { onReview("reject", reviewFeedback); setReviewFeedback(""); }}>✗ 驳回</button>
          </div>
        </div>
      )}
      <div className="chat-input-top">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef} className="chat-input-textarea" rows={1}
            value={text} onChange={handleTextChange} onInput={resizeTextarea} onKeyDown={handleKeyDown}
            placeholder={isDisabled ? "请稍候..." : isWaitingReview ? "等待审核..." : isIdle ? "与 Solo 对话，输入 '/' 获取更多能力" : "输入补充指令..."}
            disabled={isDisabled || isWaitingReview}
          />
          {showCommands && <CommandDropdown filter={commandFilter} onSelect={(cmd) => { onCommand(cmd); setText(""); setShowCommands(false); setCommandFilter(""); textareaRef.current?.focus(); }} activeIndex={activeCmdIndex} />}
        </div>
      </div>
      <div className="chat-input-bottom">
        <div className="chat-model-select">
          <button className="chat-model-btn" onClick={() => setShowModelDropdown(!showModelDropdown)}>
            🤖 {selectedModel === "auto" ? "自动" : selectedModel}
          </button>
          {showModelDropdown && (
            <div className="chat-model-dropdown">
              <button className={`chat-model-option${selectedModel === "auto" ? " active" : ""}`}
                onClick={() => { setSelectedModel("auto"); setShowModelDropdown(false); }}>
                <span className="chat-model-option-name">⚡ 自动选择</span>
                <span className="chat-model-option-desc">自动使用最优模型</span>
              </button>
              <div className="chat-model-group-label">指定模型</div>
              {(() => {
                const groups: Record<string, any[]> = {};
                for (const m of models) {
                  if (m.health_status && m.health_status !== "available" && m.health_status !== "unknown") continue;
                  const provider = m.provider || "other";
                  if (!groups[provider]) groups[provider] = [];
                  groups[provider].push(m);
                }
                if (Object.keys(groups).length === 0) return <div className="chat-model-option" style={{ color: "var(--muted)" }}>暂无可用模型</div>;
                return Object.entries(groups).map(([provider, providerModels]) => (
                  <Fragment key={provider}>
                    <div className="chat-model-group-label">{provider}</div>
                    {providerModels.map((m) => (
                      <button key={m.model_id || m.id || m.name} className={`chat-model-option${selectedModel === (m.model_id || m.id || m.name) ? " active" : ""}`}
                        onClick={() => { setSelectedModel(m.model_id || m.id || m.name); setShowModelDropdown(false); }}>
                        <span className="chat-model-option-name">{m.display_name || m.name || m.model_id}</span>
                        <span className="chat-model-option-status" />
                      </button>
                    ))}
                  </Fragment>
                ));
              })()}
            </div>
          )}
        </div>
        <div className="chat-input-actions">
          <button className="chat-update-models-btn" onClick={handleForceUpdate} disabled={updatingModels}
            title="强制更新模型状态和 fallback 链">
            {updatingModels ? "⏳" : "🔄"}
          </button>
          {isSending ? (
            <button className="chat-stop-btn" onClick={onStop} title="停止执行">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="12" height="12" rx="2" /></svg>
            </button>
          ) : (
            <button className="chat-send-btn" onClick={handleSend} disabled={isDisabled || isWaitingReview || !text.trim()} style={{ background: config.brandColor }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8L14 2L8 14L7 9L2 8Z" fill="currentColor" stroke="currentColor" strokeWidth="1" /></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SoloLayout() {
  const [userMessages, setUserMessages] = useState<ChatMessage[]>([]);
  const [webproxyStatus, setWebproxyStatus] = useState<{ running: boolean; healthy: boolean; models: number } | null>(null);
  const config = useShellConfig();

  const [leftWidth, setLeftWidth] = useState(220);
  const [centerWidth, setCenterWidth] = useState(420);

  useEffect(() => {
    const checkWebproxy = () => {
      fetch("http://127.0.0.1:8000/api/v1/webproxy/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setWebproxyStatus({ running: d.running, healthy: d.healthy, models: (d.models || []).length });
          else setWebproxyStatus(null);
        })
        .catch(() => setWebproxyStatus(null));
    };
    checkWebproxy();
    const interval = setInterval(checkWebproxy, 30000);
    return () => clearInterval(interval);
  }, []);

  const solo = useSoloWebSocket({
    onDraftUpdate: (content, isPartial) => {
      if (!isPartial) solo.updateEditor(content);
    },
  });

  const elapsed = useMemo(() => {
    if (!solo.startTime) return 0;
    return Math.floor((Date.now() - solo.startTime) / 1000);
  }, [solo.startTime, solo.phase]);

  useEffect(() => {
    if (solo.taskId && solo.phase !== "idle" && solo.phase !== "creating" && solo.phase !== "connecting") {
      const brand = config.brandName.toLowerCase();
      appendTaskHistory(brand, { taskId: solo.taskId, persona: solo.persona, intent: solo.intent, phase: solo.phase, timestamp: Date.now() });
    }
  }, [solo.taskId, solo.phase, config.brandName]);

  useEffect(() => {
    if (solo.taskId && solo.phase === "completed" && solo.entries.length > 0) {
      const lastEntry = solo.entries[solo.entries.length - 1];
      if (lastEntry?.data?.content) {
        fetch(`/api/v1/workspace/${solo.taskId}/messages`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "assistant", content: lastEntry.data.content.slice(0, 2000) }),
        }).catch(() => {});
      }
      fetch(`/api/v1/workspace/${solo.taskId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }).catch(() => {});
    }
  }, [solo.taskId, solo.phase, solo.entries]);

  const chatMessages = useMemo(() => {
    const msgs: ChatMessage[] = [];
    for (const entry of solo.entries) msgs.push(...entryToChatMessages(entry));
    for (const um of userMessages) msgs.push(um);
    msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return mergeStreamingMessages(msgs);
  }, [solo.entries, userMessages]);

  const handleChatSubmit = useCallback(
    (text: string, persona?: string, model?: string) => {
      const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text, timestamp: new Date().toISOString() };
      setUserMessages((prev) => [...prev, userMsg]);

      if (solo.phase === "idle" || solo.phase === "completed" || solo.phase === "error") {
        solo.createTask(text, { persona: persona || "default", ...(model ? { model } : {}) });
      } else if (solo.taskId) {
        fetch(`/api/v1/workspace/${solo.taskId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: text, model }),
        }).catch(() => {});
      }
    },
    [solo]
  );

  const handleReview = useCallback((verdict: "pass" | "reject", feedback: string) => { solo.submitReview(verdict, feedback); }, [solo]);
  const handleApprovalAction = useCallback((messageId: string, approved: boolean, feedback: string) => {
    if (messageId === "review-inline") solo.submitReview(approved ? "pass" : "reject", feedback);
  }, [solo]);

  const handleCommand = useCallback((cmd: string) => {
    switch (cmd) {
      case "/pause": solo.pause(); break;
      case "/resume": solo.resume(); break;
      case "/skip": solo.skipCurrent(); break;
      case "/reset": solo.resetState(); setUserMessages([]); break;
      case "/review": if (solo.taskId) solo.submitReview("pass", "通过 /review 命令强制审核"); break;
      case "/help": {
        const helpMsg: ChatMessage = { id: `system-help-${Date.now()}`, role: "system", content: `可用命令: ${COMMANDS.map((c) => c.cmd).join(", ")}`, timestamp: new Date().toISOString() };
        setUserMessages((prev) => [...prev, helpMsg]);
        break;
      }
      default: {
        const userMsg: ChatMessage = { id: `user-cmd-${Date.now()}`, role: "user", content: `${cmd} 切换模式`, timestamp: new Date().toISOString() };
        setUserMessages((prev) => [...prev, userMsg]);
      }
    }
  }, [solo]);

  return (
    <div className="solo-shell-v2">
      <div className="solo-left-panel" style={{ width: leftWidth, minWidth: 160, maxWidth: 400 }}>
        <TaskListPanel
          phase={solo.phase} intent={solo.intent} taskId={solo.taskId} elapsed={elapsed}
          onNewTask={() => { solo.resetState(); setUserMessages([]); }}
          onRestoreChat={(msgs) => { setUserMessages(msgs); }}
          onSwitchTask={(tid, taskIntent, taskPersona, taskPhase) => {
            setUserMessages([]);
            solo.restoreTask(tid, taskIntent, taskPersona, taskPhase);
          }}
          refreshTrigger={solo.phase === "idle" ? 0 : Date.now()}
        />
      </div>
      <ResizeHandle onResize={(dx) => setLeftWidth((w) => Math.max(160, Math.min(400, w + dx)))} />
      <div className="solo-center-panel" style={{ width: centerWidth, minWidth: 320, maxWidth: 800 }}>
        <div className="solo-center-topbar">
          <span className="solo-brand">{config.brandName}<span className="topbar-sep">/</span>Solo</span>
          <div className="solo-topbar-spacer" />
          {webproxyStatus && (
            <span className={`solo-webproxy-status${webproxyStatus.healthy ? " healthy" : webproxyStatus.running ? " degraded" : " stopped"}`}
              title={webproxyStatus.healthy ? `网页代理运行中 (${webproxyStatus.models} 个模型)` : "网页代理未运行"}>
              {webproxyStatus.healthy ? "🌐" : "⚠"} {webproxyStatus.models}
            </span>
          )}
          <span className="solo-tokens">Token: {solo.tokenStats.total} · ¥{solo.tokenStats.cost.toFixed(2)}</span>
        </div>
        <ChatStream messages={chatMessages} phase={solo.phase} onApprovalAction={handleApprovalAction} />
        <ChatInput phase={solo.phase} onSubmit={handleChatSubmit} onReview={handleReview} onCommand={handleCommand} onStop={solo.resetState} />
      </div>
      <ResizeHandle onResize={(dx) => setCenterWidth((w) => Math.max(320, Math.min(800, w + dx)))} />
      <div className="solo-right-panel" style={{ flex: 1, minWidth: 280 }}>
        <MarkdownPanel content={solo.editorContent} onChange={solo.updateEditor} phase={solo.phase} />
      </div>
    </div>
  );
}

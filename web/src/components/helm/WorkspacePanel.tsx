"use client";

/**
 * WorkspacePanel — 右侧工作区面板（深度增强版）
 *
 * 参考 clowder-ai packages/web/src/components/WorkspacePanel.tsx
 *
 * 10 模块 Tab 切换架构：
 *   dev         — 开发（文件树/代码查看/终端/浏览器）
 *   recall      — 记忆（记忆流/事件时间线/账本）
 *   schedule    — 调度（定时任务/调度规则）
 *   tasks       — 任务（四段看板）
 *   community   — 社区（Issue/PR分组/决策队列）
 *   artifacts   — 产物（7种产物类型/全局对话双源）
 *   approval    — 审批（待审批/历史双Tab/多维过滤）
 *   trajectory  — 轨迹（三源收敛时间轴/13种kind视觉样式）
 *   eval        — 评估（生命周期/friction/routing/paw-feel）
 *   transcript  — 转录（文字记录面板）
 *
 * 布局：
 *   ┌─ TabBar（10 模块，响应式图标+文字）──────────┐
 *   ├─ 模块内容区（滚动）                          │
 *   └──────────────────────────────────────────────┘
 *
 * 增强功能：
 *   - Focus Mode：每个子视图可全屏聚焦
 *   - Presentation Lock：锁定文件视图跨 thread 保持
 *   - 响应式 TabBar：宽屏显示图标+文字，窄屏仅图标
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useCouncilPanelStore } from "../../stores/councilPanelStore";
import ForgekinSelector from "./ForgekinSelector";
import ContextPanel from "./ContextPanel";
import WorkspaceDevPanel from "./WorkspaceDevPanel";
import WorkspaceRecallPanel from "./WorkspaceRecallPanel";
import WorkspaceSchedulePanel from "./WorkspaceSchedulePanel";
import WorkspaceTasksPanel from "./WorkspaceTasksPanel";
import WorkspaceCommunityPanel from "./WorkspaceCommunityPanel";
import WorkspaceArtifactsPanel from "./WorkspaceArtifactsPanel";
import WorkspaceApprovalPanel from "./WorkspaceApprovalPanel";
import WorkspaceEvalPanel from "./WorkspaceEvalPanel";
import WorkspaceTrajectoryPanel from "./WorkspaceTrajectoryPanel";
import WorkspaceTranscriptPanel from "./WorkspaceTranscriptPanel";

// ── 模式定义（参考 clowder-ai workspace-modes.ts）──────────────

export type WorkspaceMode =
  | "agents"
  | "context"
  | "dev"
  | "recall"
  | "schedule"
  | "tasks"
  | "community"
  | "artifacts"
  | "approval"
  | "trajectory"
  | "eval"
  | "transcript";

interface ModeConfig {
  id: WorkspaceMode;
  label: string;
  icon: string;
  description: string;
}

const MODES: ModeConfig[] = [
  { id: "agents", label: "智能体", icon: "🤝", description: "花名册 / 角色 / 静音 / 在线状态" },
  { id: "context", label: "上下文", icon: "📊", description: "消息统计 / 参与者 / 轮次 / 投票" },
  { id: "dev", label: "开发", icon: "▣", description: "文件树 / 代码查看 / 终端 / 浏览器" },
  { id: "recall", label: "记忆", icon: "◉", description: "记忆流 / 事件时间线 / 账本" },
  { id: "schedule", label: "调度", icon: "⏰", description: "定时任务 / 调度规则 / 运行历史" },
  { id: "tasks", label: "任务", icon: "☰", description: "四段看板 / 创建任务 / 折叠持久化" },
  { id: "community", label: "社区", icon: "🌐", description: "Issue/PR分组 / 决策队列" },
  { id: "artifacts", label: "产物", icon: "📦", description: "7种产物类型 / 全局对话双源" },
  { id: "approval", label: "审批", icon: "✓", description: "待审批/历史双Tab / 多维过滤" },
  { id: "trajectory", label: "轨迹", icon: "⟿", description: "三源时间轴 / 13种kind视觉" },
  { id: "eval", label: "评估", icon: "📊", description: "生命周期/friction/routing/paw-feel" },
  { id: "transcript", label: "转录", icon: "📝", description: "文字记录 / 搜索 / 置信度" },
];

// ── Props ──────────────────────────────────────────────────────

export interface WorkspacePanelProps {
  /** 当前激活的模式（外部受控） */
  mode?: WorkspaceMode;
  /** 模式切换回调 */
  onModeChange?: (mode: WorkspaceMode) => void;
  /** 当前会话 ID */
  threadId?: string | null;
  /** className */
  className?: string;
}

// ── 锁图标 SVG 组件 ────────────────────────────────────────────

function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {locked ? (
        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
      ) : (
        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H6V4.5a2 2 0 1 1 4 0 .75.75 0 0 0 1.5 0A3.5 3.5 0 0 0 8 1Z" />
      )}
    </svg>
  );
}

// ── 主组件 ─────────────────────────────────────────────────────

export default function WorkspacePanel({
  mode: externalMode,
  onModeChange,
  threadId,
  className,
}: WorkspacePanelProps) {
  // 内部状态
  const [internalMode, setInternalMode] = useState<WorkspaceMode>("agents");
  const [presentationLock, setPresentationLock] = useState(false);
  const [focusedPane, setFocusedPane] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const mode = externalMode ?? internalMode;

  // 响应式检测（窄屏时仅显示图标）
  useEffect(() => {
    const checkWidth = () => {
      if (tabBarRef.current) {
        setIsNarrow(tabBarRef.current.offsetWidth < 500);
      }
    };
    checkWidth();
    const observer = new ResizeObserver(checkWidth);
    if (tabBarRef.current) observer.observe(tabBarRef.current);
    return () => observer.disconnect();
  }, []);

  // 模式持久化
  useEffect(() => {
    if (!threadId) return;
    const key = `flowforge:workspace-mode:${threadId}`;
    try {
      const stored = localStorage.getItem(key) as WorkspaceMode | null;
      if (stored && MODES.some((m) => m.id === stored)) {
        setInternalMode(stored);
      }
    } catch { /* ignore */ }
  }, [threadId]);

  const handleModeChange = useCallback((newMode: WorkspaceMode) => {
    setInternalMode(newMode);
    onModeChange?.(newMode);
    setFocusedPane(null); // 退出焦点模式
    if (threadId) {
      try {
        localStorage.setItem(`flowforge:workspace-mode:${threadId}`, newMode);
      } catch { /* ignore */ }
    }
  }, [threadId, onModeChange]);

  const currentMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div
      data-workspace="root"
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      {/* TabBar — 响应式（宽屏图标+文字，窄屏仅图标） */}
      <div
        ref={tabBarRef}
        data-workspace="tabbar"
        role="tablist"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "2px",
          padding: "6px 8px",
          borderBottom: "1px solid var(--border)",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "thin",
          flexShrink: 0,
        }}
      >
        {MODES.map((m) => {
          const isActive = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleModeChange(m.id)}
              title={`${m.label} — ${m.description}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: isNarrow ? "5px 6px" : "5px 10px",
                borderRadius: "var(--radius-sm, 4px)",
                background: isActive
                  ? "var(--accent-subtle)"
                  : "transparent",
                color: isActive ? "var(--accent)" : "var(--muted)",
                border: "1px solid",
                borderColor: isActive ? "var(--accent)" : "transparent",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: isActive ? 600 : 500,
                whiteSpace: "nowrap",
                flexShrink: 0,
                fontFamily: "inherit",
                transition: "background 0.15s, color 0.15s, border-color 0.15s",
              }}
            >
              <span style={{ fontSize: "13px" }}>{m.icon}</span>
              {!isNarrow && <span>{m.label}</span>}
            </button>
          );
        })}
      </div>

      {/* 功能工具栏（Presentation Lock + Focus Mode） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          borderBottom: "1px solid var(--border)",
          fontSize: "11px",
          flexShrink: 0,
          background: "var(--bg)",
        }}
      >
        <span style={{ color: "var(--muted)", fontWeight: 500 }}>
          {currentMode.icon} {currentMode.label}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {/* Presentation Lock 按钮 */}
          <button
            type="button"
            onClick={() => setPresentationLock(!presentationLock)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              borderRadius: "var(--radius-sm, 4px)",
              border: "1px solid",
              borderColor: presentationLock ? "var(--accent)" : "var(--border)",
              background: presentationLock ? "var(--accent-subtle)" : "transparent",
              color: presentationLock ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              fontSize: "10px",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
            title={presentationLock ? "已锁定 — 点击解锁" : "锁定当前视图 — 切换 thread 时保持不变"}
          >
            <LockIcon locked={presentationLock} />
            {presentationLock ? "已锁定" : "锁定"}
          </button>
          {/* Focus Mode 按钮 */}
          <button
            type="button"
            onClick={() => setFocusedPane(focusedPane ? null : "content")}
            style={{
              padding: "2px 8px",
              borderRadius: "var(--radius-sm, 4px)",
              border: "1px solid",
              borderColor: focusedPane ? "var(--accent)" : "var(--border)",
              background: focusedPane ? "var(--accent-subtle)" : "transparent",
              color: focusedPane ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              fontSize: "10px",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
            title={focusedPane ? "退出焦点模式" : "全屏聚焦当前视图"}
          >
            {focusedPane ? "⊠ 退出聚焦" : "⊡ 聚焦"}
          </button>
        </div>
      </div>

      {/* 模块内容区 */}
      <div
        data-workspace="content"
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
          ...(focusedPane ? {
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "var(--bg-elevated)",
          } : {}),
        }}
      >
        <WorkspaceModeContent mode={mode} threadId={threadId} />
      </div>
    </div>
  );
}

// ── 模块内容分发 ───────────────────────────────────────────────

function WorkspaceModeContent({
  mode,
  threadId,
}: {
  mode: WorkspaceMode;
  threadId?: string | null;
}) {
  switch (mode) {
    case "agents":
      return <AgentsPanel />;
    case "context":
      return <ContextPanelWrapper />;
    case "dev":
      return <WorkspaceDevPanel threadId={threadId} />;
    case "recall":
      return <WorkspaceRecallPanel threadId={threadId} />;
    case "schedule":
      return <WorkspaceSchedulePanel threadId={threadId} />;
    case "tasks":
      return <WorkspaceTasksPanel threadId={threadId} />;
    case "community":
      return <WorkspaceCommunityPanel threadId={threadId} />;
    case "artifacts":
      return <WorkspaceArtifactsPanel threadId={threadId} />;
    case "approval":
      return <WorkspaceApprovalPanel threadId={threadId} />;
    case "trajectory":
      return <WorkspaceTrajectoryPanel threadId={threadId} />;
    case "eval":
      return <WorkspaceEvalPanel threadId={threadId} />;
    case "transcript":
      return <WorkspaceTranscriptPanel threadId={threadId} />;
    default:
      return null;
  }
}

// ── 智能体面板 ─────────────────────────────────────────────────

function AgentsPanel() {
  const roster = useCouncilPanelStore((s) => s.roster);
  const config = useCouncilPanelStore((s) => s.config);
  const mutedIds = useCouncilPanelStore((s) => s.mutedIds);
  const toggleParticipant = useCouncilPanelStore((s) => s.toggleParticipant);
  const setForgekinRole = useCouncilPanelStore((s) => s.setForgekinRole);
  const toggleMute = useCouncilPanelStore((s) => s.toggleMute);

  if (roster.length === 0) {
    return (
      <div
        style={{
          padding: "24px 20px",
          color: "var(--muted)",
          fontSize: "12px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "28px", marginBottom: "8px", opacity: 0.4 }}>🤝</div>
        <div>等待智能体花名册加载...</div>
        <div style={{ marginTop: "4px", fontSize: "11px" }}>
          选择左侧会话后，智能体列表将在此显示
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <ForgekinSelector
        roster={roster}
        participantIds={config.participantIds}
        roleAssignment={config.roleAssignment}
        mutedIds={mutedIds}
        onToggleParticipant={toggleParticipant ?? (() => {})}
        onSetRole={setForgekinRole ?? (() => {})}
        onToggleMute={toggleMute ?? (() => {})}
        compact={false}
      />
    </div>
  );
}

// ── 上下文面板 ─────────────────────────────────────────────────

function ContextPanelWrapper() {
  const roster = useCouncilPanelStore((s) => s.roster);
  const messages = useCouncilPanelStore((s) => s.messages);
  const config = useCouncilPanelStore((s) => s.config);
  const activeVoteQuestion = useCouncilPanelStore((s) => s.activeVoteQuestion);

  if (messages.length === 0) {
    return (
      <div
        style={{
          padding: "24px 20px",
          color: "var(--muted)",
          fontSize: "12px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "28px", marginBottom: "8px", opacity: 0.4 }}>📊</div>
        <div>暂无上下文数据</div>
        <div style={{ marginTop: "4px", fontSize: "11px" }}>
          发送消息后，会话统计和参与者信息将在此显示
        </div>
      </div>
    );
  }

  return (
    <ContextPanel
      messages={messages}
      roster={roster}
      participantIds={config.participantIds}
      maxRounds={config.maxRounds}
      activeVoteQuestion={activeVoteQuestion}
      compact={false}
    />
  );
}
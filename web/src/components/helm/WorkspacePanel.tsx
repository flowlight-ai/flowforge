"use client";

/**
 * WorkspacePanel — 右侧工作区面板
 *
 * 参考 clowder-ai packages/web/src/components/WorkspacePanel.tsx
 *
 * 9 模块 Tab 切换架构（参考 clowder-ai workspace-modes.ts）：
 *   dev         — 开发（文件树 / 代码查看 / 终端 / 浏览器）
 *   recall      — 记忆（记忆流 / 事件时间线 / 账本）
 *   schedule    — 调度（定时任务 / 调度规则）
 *   tasks       — 任务（Mission Hub / 任务列表）
 *   community   — 社区（动态 / 分享）
 *   artifacts   — 产物（产物列表 / 版本）
 *   approval    — 审批（审批列表 / 流程）
 *   trajectory  — 轨迹（执行轨迹 / 调用链）
 *   eval        — 评估（模型评估 / 指标）
 *
 * 布局：
 *   ┌─ TabBar（9 图标 + 文字，横向滚动）──┐
 *   ├─ 模块内容区（滚动）                  │
 *   └──────────────────────────────────────┘
 */

import { useState, useEffect, useCallback } from "react";

// ── 模式定义（参考 clowder-ai workspace-modes.ts）──────────────

export type WorkspaceMode =
  | "dev"
  | "recall"
  | "schedule"
  | "tasks"
  | "community"
  | "artifacts"
  | "approval"
  | "trajectory"
  | "eval";

interface ModeConfig {
  id: WorkspaceMode;
  label: string;
  icon: string;
  description: string;
}

const MODES: ModeConfig[] = [
  { id: "dev", label: "开发", icon: "▣", description: "文件树 / 代码查看 / 终端 / 浏览器" },
  { id: "recall", label: "记忆", icon: "◉", description: "记忆流 / 事件时间线 / 账本" },
  { id: "schedule", label: "调度", icon: "⏰", description: "定时任务 / 调度规则" },
  { id: "tasks", label: "任务", icon: "☰", description: "Mission Hub / 任务列表" },
  { id: "community", label: "社区", icon: "🌐", description: "社区动态 / 分享" },
  { id: "artifacts", label: "产物", icon: "📦", description: "产物列表 / 版本管理" },
  { id: "approval", label: "审批", icon: "✓", description: "审批列表 / 流程" },
  { id: "trajectory", label: "轨迹", icon: "⟿", description: "执行轨迹 / 调用链" },
  { id: "eval", label: "评估", icon: "📊", description: "模型评估 / 指标" },
];

// ── Props ──────────────────────────────────────────────────────

export interface WorkspacePanelProps {
  /** 当前激活的模式（外部受控，参考 clowder-ai thread.preferredWorkspaceMode） */
  mode?: WorkspaceMode;
  /** 模式切换回调 */
  onModeChange?: (mode: WorkspaceMode) => void;
  /** 当前会话 ID（用于按会话隔离状态） */
  threadId?: string | null;
  /** className */
  className?: string;
}

// ── 主组件 ─────────────────────────────────────────────────────

export default function WorkspacePanel({
  mode: externalMode,
  onModeChange,
  threadId,
  className,
}: WorkspacePanelProps) {
  // 内部状态（非受控模式）
  const [internalMode, setInternalMode] = useState<WorkspaceMode>("dev");
  const mode = externalMode ?? internalMode;

  // 模式持久化（按 threadId 隔离）
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
      {/* TabBar — 9 模式横向滚动（参考 clowder-ai WorkspaceTabBar） */}
      <div
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
                padding: "5px 10px",
                borderRadius: "var(--radius-sm, 4px)",
                background: isActive
                  ? "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))"
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
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* 模块内容区 */}
      <div
        data-workspace="content"
        style={{
          flex: 1,
          overflow: "auto",
          minHeight: 0,
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
    case "dev":
      return <DevPanel threadId={threadId} />;
    case "recall":
      return <RecallPanel threadId={threadId} />;
    case "schedule":
      return <SchedulePanel threadId={threadId} />;
    case "tasks":
      return <TasksPanel threadId={threadId} />;
    case "community":
      return <CommunityPanel threadId={threadId} />;
    case "artifacts":
      return <ArtifactsPanel threadId={threadId} />;
    case "approval":
      return <ApprovalPanel threadId={threadId} />;
    case "trajectory":
      return <TrajectoryPanel threadId={threadId} />;
    case "eval":
      return <EvalPanel threadId={threadId} />;
    default:
      return null;
  }
}

// ── 占位面板基础组件 ───────────────────────────────────────────

function PanelPlaceholder({
  icon,
  title,
  description,
  features,
}: {
  icon: string;
  title: string;
  description: string;
  features: string[];
}) {
  return (
    <div
      style={{
        padding: "24px 20px",
        color: "var(--text)",
        height: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ fontSize: "20px" }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>{title}</h3>
      </div>
      <p style={{ margin: "0 0 16px 0", fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
        {description}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {features.map((f, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 10px",
              borderRadius: "var(--radius-sm, 4px)",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              fontSize: "12px",
              color: "var(--text)",
            }}
          >
            <span style={{ color: "var(--accent)", fontSize: "11px" }}>◆</span>
            <span>{f}</span>
            <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--muted)" }}>
              待实现
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 各模块面板 ─────────────────────────────────────────────────

function DevPanel({ threadId }: { threadId?: string | null }) {
  return (
    <PanelPlaceholder
      icon="▣"
      title="开发工作区"
      description="文件树、代码查看、终端、浏览器预览。参考 clowder-ai WorkspaceTree + WorkspaceFileViewer + TerminalTab + BrowserPanel。"
      features={[
        "文件树（WorkspaceTree）— 创建/删除/重命名/上传",
        "代码查看器（CodeMirror）— Markdown/HTML/JSX 预览",
        "终端（TerminalTab）— worktree-scoped 终端",
        "浏览器预览（BrowserPanel）— HMR 端口发现",
        "Changes 面板 — 代码 diff",
        "Git 面板 — Git 操作",
      ]}
    />
  );
}

function RecallPanel({ threadId }: { threadId?: string | null }) {
  return (
    <PanelPlaceholder
      icon="◉"
      title="记忆中心"
      description="记忆召回事件流、事件时间线、记忆账本。参考 clowder-ai RecallFeed + EventTimeline + RecallLedger。"
      features={[
        "记忆流（RecallFeed）— 召回事件流，含 push/pull 来源",
        "事件时间线（EventTimeline）— 拉闸记录",
        "账本（RecallLedger）— 7/14/30 天对比 + 漏斗图",
        "记忆检索 — 按关键词/时间/类型搜索",
        "记忆分类 — 自动分类 + 手动标注",
      ]}
    />
  );
}

function SchedulePanel({ threadId }: { threadId?: string | null }) {
  return (
    <PanelPlaceholder
      icon="⏰"
      title="调度中心"
      description="定时任务管理、调度规则配置、执行历史。"
      features={[
        "定时任务列表 — 查看/创建/编辑/删除",
        "调度规则 — cron 表达式 + 触发条件",
        "执行历史 — 每次调度的执行记录",
        "下次执行时间 — 预告即将触发的任务",
      ]}
    />
  );
}

function TasksPanel({ threadId }: { threadId?: string | null }) {
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; status: string }>>([]);

  useEffect(() => {
    // 尝试加载任务列表
    fetch("/api/v1/tasks")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.items) setTasks(data.items.slice(0, 10));
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ padding: "16px 20px", color: "var(--text)", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <span style={{ fontSize: "18px" }}>☰</span>
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Mission Hub</h3>
      </div>
      {tasks.length === 0 ? (
        <PanelPlaceholder
          icon="☰"
          title="Mission Hub"
          description="任务列表、任务详情、子任务管理。参考 clowder-ai Mission Hub。"
          features={[
            "任务列表 — 按状态/优先级过滤",
            "任务详情 — 描述/子任务/评论",
            "任务创建 — 快速创建任务",
            "任务分配 — 分配给智能体",
          ]}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {tasks.map((t) => (
            <div
              key={t.id}
              style={{
                padding: "8px 10px",
                borderRadius: "var(--radius-sm, 4px)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: "12px",
              }}
            >
              <div style={{ fontWeight: 500 }}>{t.title}</div>
              <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                {t.status}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CommunityPanel({ threadId }: { threadId?: string | null }) {
  return (
    <PanelPlaceholder
      icon="🌐"
      title="社区"
      description="社区动态、分享、评论。"
      features={[
        "社区动态 — 最新分享流",
        "发布分享 — 分享会话/产物",
        "评论互动 — 点赞/评论",
        "关注 — 关注其他用户/智能体",
      ]}
    />
  );
}

function ArtifactsPanel({ threadId }: { threadId?: string | null }) {
  return (
    <PanelPlaceholder
      icon="📦"
      title="产物中心"
      description="智能体生成的产物列表、版本管理、预览。"
      features={[
        "产物列表 — 按类型/时间过滤",
        "产物预览 — Markdown/图片/代码",
        "版本历史 — 产物的修改历史",
        "产物导出 — 下载/分享",
      ]}
    />
  );
}

function ApprovalPanel({ threadId }: { threadId?: string | null }) {
  const [pending, setPending] = useState<number>(0);

  useEffect(() => {
    // 尝试加载待审批数量
    fetch("/api/v1/admin/review?status=pending&limit=1")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.total !== undefined) setPending(data.total);
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ padding: "16px 20px", color: "var(--text)", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <span style={{ fontSize: "18px" }}>✓</span>
        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>审批中心</h3>
        {pending > 0 && (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "10px",
              background: "var(--accent)",
              color: "var(--accent-foreground, #fff)",
              fontSize: "10px",
              fontWeight: 600,
            }}
          >
            {pending} 待审
          </span>
        )}
      </div>
      <PanelPlaceholder
        icon="✓"
        title="审批中心"
        description="审批列表、审批详情、审批流程。参考 clowder-ai ApprovalHub。"
        features={[
          "待审批列表 — 需要处理的审批",
          "审批详情 — 申请内容/理由/影响",
          "审批操作 — 批准/拒绝/退回",
          "审批历史 — 已处理的审批记录",
        ]}
      />
    </div>
  );
}

function TrajectoryPanel({ threadId }: { threadId?: string | null }) {
  return (
    <PanelPlaceholder
      icon="⟿"
      title="执行轨迹"
      description="智能体执行轨迹、调用链、时间线。"
      features={[
        "执行轨迹 — 按会话查看调用链",
        "调用链 — 工具调用/LLM调用/子任务",
        "时间线 — 每步执行的时间和耗时",
        "性能分析 — 识别瓶颈步骤",
      ]}
    />
  );
}

function EvalPanel({ threadId }: { threadId?: string | null }) {
  return (
    <PanelPlaceholder
      icon="📊"
      title="评估中心"
      description="模型评估、指标监控、质量分析。"
      features={[
        "模型评估 — 各模型的输出质量",
        "指标监控 — token 用量/延迟/成功率",
        "质量分析 — 输出质量趋势",
        "A/B 测试 — 模型对比",
      ]}
    />
  );
}

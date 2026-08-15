"use client";

/**
 * CouncilContent — 群聊页面内容（/council 和 /council/[threadId] 共用）
 *
 * 从 council/page.tsx 拆出：Next.js page 文件只允许约定导出
 * （default/metadata/viewport 等），额外命名导出会破坏类型契约。
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { useShellConfig } from "@/lib/shell-config";
import type { BootcampState } from "@/lib/bootcamp-types";
import type { ForgekinRosterItem } from "@/lib/council-types";
import { useCouncilPanelStore } from "@/stores/councilPanelStore";

// 性能优化：CouncilThreadList 动态导入（减少首屏 JS 体积）
const CouncilThreadList = dynamic(
  () => import("@/components/helm/CouncilThreadList").then((m) => m.CouncilThreadList),
  { ssr: false, loading: () => <div style={{ width: "240px", flexShrink: 0 }} /> }
);

// CouncilChatPanel 已就绪，动态导入避免 SSR 问题（内部使用 fetch/浏览器 API）
const CouncilChatPanel = dynamic(
  () => import("@/components/helm/CouncilChatPanel"),
  { ssr: false, loading: () => <CouncilLoading /> }
);

// 灵智训练营向导 — 动态导入（仅用户点击时加载）
const BootcampWizard = dynamic(
  () => import("@/components/helm/BootcampWizard"),
  { ssr: false }
);

// 训练营进度条 — 动态导入
const BootcampProgressBar = dynamic(
  () => import("@/components/helm/BootcampProgressBar").then((m) => m.BootcampProgressBar),
  { ssr: false }
);

// 右栏 Workspace 工作区 — 动态导入（参考 clowder-ai WorkspacePanel 9 模块）
const WorkspacePanel = dynamic(
  () => import("@/components/helm/WorkspacePanel"),
  { ssr: false }
);

// 群聊配置跳转按钮样式 — 参考 clowder-ai ChatContainerHeader 的快捷链接
const configLinkStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  color: "var(--muted)",
  border: "1px solid var(--border)",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  transition: "background 0.15s, color 0.15s",
};

export function CouncilContent({ threadId }: { threadId: string | null }) {
  const config = useShellConfig();
  const router = useRouter();
  // 右栏 Workspace 默认显示（参考 clowder-ai 三栏布局）
  const [showWorkspace, setShowWorkspace] = useState(true);
  const [taskTitle, setTaskTitle] = useState<string>("");
  const [showBootcampWizard, setShowBootcampWizard] = useState(false);
  const [bootcampState, setBootcampState] = useState<BootcampState | null>(null);

  const handleTitleChange = useCallback((t: string) => setTaskTitle(t), []);

  // 路由级预加载：空闲时预取 /solo 代码与数据，
  // 使 council → solo 跳转秒开（参考 clowder-ai 精确订阅 + 预加载策略）
  useEffect(() => {
    const idle =
      (typeof window !== "undefined" && "requestIdleCallback" in window)
        ? (window as any).requestIdleCallback
        : (cb: () => void) => setTimeout(cb, 1500);
    const handle = idle(() => router.prefetch("/solo"));
    return () => {
      if (typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(handle);
      }
    };
  }, [router]);

  // 当 threadId 变化时，获取会话详情检查是否有 bootcamp_state
  useEffect(() => {
    if (!threadId) {
      setBootcampState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/threads/${threadId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.bootcamp_state) {
          setBootcampState(data.bootcamp_state as BootcampState);
        } else {
          setBootcampState(null);
        }
      } catch {
        if (!cancelled) setBootcampState(null);
      }
    })();
    return () => { cancelled = true; };
  }, [threadId]);

  // 页面级加载灵智体花名册并同步到共享 store —
  // 对齐 clowder-ai"打开即显示成员"：WorkspacePanel 的智能体面板
  // 无需等选中会话即可展示成员列表（原逻辑依赖 CouncilChatPanel 挂载才加载）
  const syncPanelStore = useCouncilPanelStore((s) => s.syncState);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/forgemind/roster");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const items: ForgekinRosterItem[] = data.builtin || [];
        syncPanelStore({ roster: items.filter((r) => r.available && !r.error) });
      } catch {
        // 静默失败：CouncilChatPanel 挂载后仍会尝试加载
      }
    })();
    return () => { cancelled = true; };
  }, [syncPanelStore]);

  return (
    <div
      className="council-shell"
      data-council="layout"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      {/* 顶部 Header — 参考 clowder-ai ChatContainerHeader */}
      <header
        className="council-header"
        data-council="header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "0 20px",
          height: "var(--shell-topbar-height, 52px)",
          borderBottom: "1px solid color-mix(in srgb, var(--border) 74%, transparent)",
          background: "color-mix(in srgb, var(--bg) 82%, transparent)",
          backdropFilter: "blur(12px) saturate(1.6)",
          WebkitBackdropFilter: "blur(12px) saturate(1.6)",
          flexShrink: 0,
        }}
      >
        <div
          className="council-brand"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "14px",
            fontWeight: 700,
            color: "var(--accent)",
            letterSpacing: "1px",
          }}
        >
          <span aria-hidden>◎</span>
          <span>{config.brandName} 群聊</span>
        </div>

        <span
          aria-hidden
          style={{ color: "var(--border-strong)", opacity: 0.5 }}
        >
          |
        </span>

        <input
          type="text"
          value={taskTitle}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="未命名讨论（输入标题）"
          aria-label="讨论标题"
          data-council="title-input"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text)",
            fontSize: "13px",
            fontWeight: 500,
            minWidth: 0,
          }}
        />

        <div
          className="council-actions"
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          {/* 群聊配置跳转按钮组 — 参考 clowder-ai ChatContainerHeader */}
          <nav
            aria-label="群聊配置"
            data-council="config-nav"
            style={{ display: "flex", alignItems: "center", gap: "4px" }}
          >
            <a
              href="/admin/agents"
              aria-label="管理可进化智能体"
              title="管理可进化智能体（Forgekin 花名册、能力配置）"
              data-council-action="config-forgekins"
              style={configLinkStyle}
            >
              ◆ 智能体
            </a>
            <a
              href="/admin/settings?section=routing"
              aria-label="路由策略配置"
              title="路由策略配置（模型选择、轮次规则）"
              data-council-action="config-routing"
              style={configLinkStyle}
            >
              ⚙ 路由
            </a>
            <a
              href="/tasks"
              aria-label="历史会话"
              title="历史群聊会话列表"
              data-council-action="config-history"
              style={configLinkStyle}
            >
              ☰ 历史
            </a>
            <a
              href="/review"
              aria-label="评审中心"
              title="群聊决议评审中心"
              data-council-action="config-review"
              style={configLinkStyle}
            >
              ✓ 评审
            </a>
            <a
              href="/memory"
              aria-label="共享记忆"
              title="群聊共享记忆与上下文"
              data-council-action="config-memory"
              style={configLinkStyle}
            >
              ◉ 记忆
            </a>
            {/* 灵智训练营入口 — 参考 clowder-ai 猫猫训练营 */}
            <button
              type="button"
              onClick={() => setShowBootcampWizard(true)}
              aria-label="灵智训练营"
              title="灵智训练营 — 引导配置环境、使用 FlowForge、训练智能体成长"
              data-council-action="open-bootcamp"
              style={{
                ...configLinkStyle,
                background: "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))",
                color: "var(--accent)",
                borderColor: "var(--accent)",
              }}
            >
              🎓 训练营
            </button>
          </nav>

          <span
            aria-hidden
            style={{ color: "var(--border-strong)", opacity: 0.5 }}
          >
            |
          </span>

          <button
            type="button"
            onClick={() => setShowWorkspace((v) => !v)}
            aria-pressed={showWorkspace}
            aria-label="切换工作区"
            title="切换工作区（开发/记忆/调度/任务/社区/产物/审批/轨迹/评估）"
            data-council-action="toggle-workspace"
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              background: showWorkspace ? "var(--accent-subtle, color-mix(in srgb, var(--accent) 12%, transparent))" : "transparent",
              color: showWorkspace ? "var(--accent)" : "var(--muted)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            ▣ 工作区
          </button>
          <Link
            href="/solo"
            prefetch
            aria-label="返回对话"
            title="返回对话"
            data-council-action="back-to-solo"
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              background: "transparent",
              color: "var(--muted)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            ← 对话
          </Link>
        </div>
      </header>

      {/* 主体内容 — 会话列表 + 全屏聊天布局 */}
      <div
        className="council-body"
        data-council="body"
        style={{
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minHeight: 0,
        }}
      >
        {/* 左侧：会话列表侧栏 */}
        <aside
          data-council="thread-list"
          style={{
            width: "240px",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          <CouncilThreadList currentThreadId={threadId} className="h-full" />
        </aside>

        {/* 中央聊天区 — CouncilChatPanel 已内置 ForgekinSelector 侧栏 */}
        <main
          className="council-main"
          data-council="main"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {threadId ? (
            <>
              {/* 训练营进度条 — 当会话有 bootcamp_state 时显示 */}
              {bootcampState && (
                <BootcampProgressBar
                  threadId={threadId}
                  phase={bootcampState.phase}
                  showAdvance={true}
                  onPhaseAdvanced={(newPhase) => {
                    setBootcampState({
                      ...bootcampState,
                      phase: newPhase,
                    });
                  }}
                />
              )}
              <CouncilChatPanel threadId={threadId} showSidebar={false} compact={false} />
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                fontSize: "14px",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <span style={{ fontSize: "32px", opacity: 0.4 }}>◎</span>
              <span>选择左侧会话或点击"新对话"开始群聊</span>
            </div>
          )}
        </main>

        {/* 右侧 Workspace 工作区（可折叠，默认显示）— 9 模块 Tab */}
        {showWorkspace && (
          <aside
            className="council-workspace"
            data-council="workspace-panel"
            style={{
              width: "360px",
              flexShrink: 0,
              borderLeft: "1px solid var(--border)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <WorkspacePanel threadId={threadId} />
          </aside>
        )}
      </div>

      {/* 灵智训练营向导 — 点击"🎓 训练营"按钮时显示 */}
      {showBootcampWizard && (
        <BootcampWizard
          onClose={() => setShowBootcampWizard(false)}
          onCreated={(newThreadId) => {
            setShowBootcampWizard(false);
            // 跳转到新创建的训练营会话
            window.location.href = `/council/${newThreadId}`;
          }}
        />
      )}
    </div>
  );
}

/**
 * CouncilLoading — 动态导入加载占位
 */
function CouncilLoading() {
  return (
    <div
      data-council="loading"
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
        fontSize: "13px",
        gap: "8px",
      }}
    >
      <div
        style={{
          width: "16px",
          height: "16px",
          border: "2px solid var(--accent)",
          borderTopColor: "transparent",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      正在加载群聊...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

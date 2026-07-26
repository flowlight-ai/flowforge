"use client";

/**
 * /council — 群聊工作室独立路由
 *
 * 重构说明（v2）：
 *   - 原 /council 重定向到 /solo?mode=council（在 Helm 框架内嵌套群聊）
 *   - 现重构为独立路由，使用 clowder-ai 启发的全屏聊天布局
 *   - 原因：Helm 三栏布局（左面板/聊天/编辑器）不适合群聊场景
 *   - 群聊需要：消息流为主、智能体头像侧栏、@mention 增强、轮次控制
 *
 * UI 框架（参考 clowder-ai ChatContainer）：
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ CouncilHeader（品牌/任务ID/轮次/设置）                    │
 *   ├──────────┬──────────────────────────────────┬───────────┤
 *   │ Forgekin │  MessageStream（消息流）          │ Context   │
 *   │ Roster   │  - 用户消息                       │ Panel     │
 *   │ 侧栏     │  - 智能体响应（带头像/角色/时间）  │ （可折叠）│
 *   │          │  - 系统消息                       │           │
 *   │          ├──────────────────────────────────┤           │
 *   │          │  ChatInput（@mention 输入框）     │           │
 *   └──────────┴──────────────────────────────────┴───────────┘
 *
 * 复用：
 *   - useCouncilChat Hook（已就绪，调用 /api/v1/forgemind/*）
 *   - CouncilChatPanel 组件（已就绪，含 @mention/消息流/Forgekin 选择器）
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）
 */

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import { useShellConfig } from "@/lib/shell-config";

// CouncilChatPanel 已就绪，动态导入避免 SSR 问题（内部使用 fetch/浏览器 API）
const CouncilChatPanel = dynamic(
  () => import("@/components/helm/CouncilChatPanel"),
  { ssr: false, loading: () => <CouncilLoading /> }
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

export default function CouncilPage() {
  const config = useShellConfig();
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [taskTitle, setTaskTitle] = useState<string>("");

  const handleTitleChange = useCallback((t: string) => setTaskTitle(t), []);

  return (
    <div
      className="council-shell"
      data-council="layout"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
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
          <span>{config.brandName} 群聊工作室</span>
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
          {/* 群聊需要大量配置：Forgekin 选择、路由策略、历史会话、评审等 */}
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
          </nav>

          <span
            aria-hidden
            style={{ color: "var(--border-strong)", opacity: 0.5 }}
          >
            |
          </span>

          <button
            type="button"
            onClick={() => setShowContextPanel((v) => !v)}
            aria-pressed={showContextPanel}
            aria-label="切换上下文面板"
            title="切换上下文面板"
            data-council-action="toggle-context"
            style={{
              padding: "6px 10px",
              borderRadius: "var(--radius-sm)",
              background: showContextPanel ? "var(--accent-subtle)" : "transparent",
              color: showContextPanel ? "var(--accent)" : "var(--muted)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            ◧ 上下文
          </button>
          <a
            href="/solo"
            aria-label="返回 Helm Studio"
            title="返回 Helm Studio"
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
            ← Helm Studio
          </a>
        </div>
      </header>

      {/* 主体内容 — 全屏聊天布局（非 Helm 三栏） */}
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
          <CouncilChatPanel showSidebar={true} compact={false} />
        </main>

        {/* 右侧上下文面板（可折叠） */}
        {showContextPanel && (
          <aside
            className="council-context"
            data-council="context-panel"
            style={{
              width: "320px",
              flexShrink: 0,
              borderLeft: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
              background: "var(--bg-elevated)",
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <CouncilContextPanel />
          </aside>
        )}
      </div>
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
      正在加载群聊工作室...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/**
 * CouncilContextPanel — 上下文面板（占位实现）
 *
 * 后续可扩展：
 *   - 当前任务的相关文档
 *   - 智能体能力画像
 *   - 历史讨论摘要
 *   - 投票/决议面板
 */
function CouncilContextPanel() {
  return (
    <div
      data-council="context-content"
      style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}
    >
      <h3
        style={{
          fontSize: "11px",
          fontWeight: 700,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          margin: 0,
        }}
      >
        上下文
      </h3>
      <div
        style={{
          padding: "12px",
          borderRadius: "var(--radius-md)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          fontSize: "12px",
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: "8px", fontWeight: 600, color: "var(--text)" }}>
          讨论摘要
        </div>
        开始群聊后，此处将显示：
        <ul style={{ margin: "8px 0 0", paddingLeft: "16px" }}>
          <li>当前讨论主题</li>
          <li>参与的可进化智能体</li>
          <li>已达成的共识</li>
          <li>待解决的问题</li>
        </ul>
      </div>

      <div
        style={{
          padding: "12px",
          borderRadius: "var(--radius-md)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          fontSize: "12px",
          color: "var(--muted)",
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: "8px", fontWeight: 600, color: "var(--text)" }}>
          使用提示
        </div>
        <ul style={{ margin: 0, paddingLeft: "16px" }}>
          <li>使用 @mention 指定智能体发言</li>
          <li>不指定则所有参与的智能体依次发言</li>
          <li>可配置讨论轮数（默认 3 轮）</li>
          <li>支持中途停止和继续</li>
        </ul>
      </div>
    </div>
  );
}

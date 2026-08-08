"use client";

/**
 * /council — 群聊独立路由
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
import { useState, useCallback, useEffect } from "react";
import { useShellConfig } from "@/lib/shell-config";
import { useCouncilChat } from "@/hooks/useCouncilChat";
import {
  FORGEKIN_COLORS,
  FORGEKIN_EMOJI,
  ROLE_CONFIG,
  type ForgekinRosterItem,
} from "@/lib/council-types";

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
      正在加载群聊...
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/**
 * CouncilContextPanel — 上下文面板（增强版）
 *
 * 显示：
 *   1. 当前会话配置（可用智能体数、轮数、投票状态）
 *   2. 智能体花名册（实时获取，显示头像/名称/物种）
 *   3. 使用提示
 *   4. 快捷操作入口
 *
 * 数据来源：独立 fetch /api/v1/forgemind/roster（只读，不与主聊天面板共享状态）
 * 主题：CSS 变量驱动
 */
function CouncilContextPanel() {
  const [roster, setRoster] = useState<ForgekinRosterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 独立获取花名册（只读展示，不与主聊天面板共享状态）
  useEffect(() => {
    let cancelled = false;
    const loadRoster = async () => {
      try {
        const res = await fetch("/api/v1/forgemind/roster");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const items: ForgekinRosterItem[] = data.builtin || [];
        setRoster(items.filter((r) => r.available && !r.error));
      } catch (e) {
        if (!cancelled) {
          setError(`加载花名册失败: ${e instanceof Error ? e.message : String(e)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadRoster();
    return () => {
      cancelled = true;
    };
  }, []);

  const sectionStyle: React.CSSProperties = {
    padding: "12px",
    borderRadius: "var(--radius-md)",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    fontSize: "12px",
    color: "var(--muted)",
    lineHeight: 1.6,
  };

  const sectionTitleStyle: React.CSSProperties = {
    marginBottom: "8px",
    fontWeight: 600,
    color: "var(--text)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  };

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

      {/* 当前会话配置 */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>
          <span>当前会话</span>
          <span style={{ color: "var(--accent)", fontSize: "10px" }}>● 在线</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <div>
            <span style={{ color: "var(--muted)" }}>可用智能体：</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              {loading ? "加载中..." : `${roster.length} 个`}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--muted)" }}>默认轮数：</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>1 轮</span>
          </div>
          <div>
            <span style={{ color: "var(--muted)" }}>投票状态：</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>无活跃投票</span>
          </div>
        </div>
      </div>

      {/* 智能体花名册 */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>
          <span>智能体花名册</span>
          <span style={{ color: "var(--muted)", fontSize: "10px" }}>
            {roster.length} 个
          </span>
        </div>
        {error && (
          <div style={{ color: "var(--semantic-critical, #ef4444)", fontSize: "11px" }}>
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: "11px" }}>加载中...</div>
        ) : roster.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: "11px" }}>
            暂无可用智能体，请检查后端服务
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {roster.map((item) => {
              const colors = FORGEKIN_COLORS[item.id] || { primary: "#888", secondary: "#333" };
              const emoji = FORGEKIN_EMOJI[item.id] || "🤖";
              return (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px",
                    borderRadius: "var(--radius-sm)",
                    background: `linear-gradient(135deg, ${colors.primary}11, transparent)`,
                    border: `1px solid ${colors.primary}44`,
                  }}
                >
                  <span
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "14px",
                      background: `linear-gradient(135deg, ${colors.primary}33, ${colors.secondary}33)`,
                      border: `1px solid ${colors.primary}66`,
                      flexShrink: 0,
                    }}
                  >
                    {emoji}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        color: "var(--text)",
                        fontWeight: 600,
                        fontSize: "12px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name}
                    </div>
                    <div
                      style={{
                        color: "var(--muted)",
                        fontSize: "10px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.role?.primary}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "9px",
                      padding: "1px 4px",
                      borderRadius: "4px",
                      background: colors.primary,
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    {item.species}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 使用提示 */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>
          <span>使用提示</span>
        </div>
        <ul style={{ margin: 0, paddingLeft: "16px" }}>
          <li>使用 @mention 指定智能体发言</li>
          <li>输入 @all 提及所有参与的智能体</li>
          <li>不指定则所有参与的智能体依次发言</li>
          <li>可配置讨论轮数（1-3 轮）</li>
          <li>点击 ◎ 投票 发起群聊决议投票</li>
          <li>消息支持 emoji 表情回复和引用</li>
        </ul>
      </div>

      {/* 快捷操作 */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>
          <span>快捷操作</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <a
            href="/admin/agents"
            style={{
              color: "var(--accent)",
              fontSize: "11px",
              textDecoration: "none",
              padding: "4px 0",
            }}
          >
            → 管理智能体花名册
          </a>
          <a
            href="/admin/settings?section=routing"
            style={{
              color: "var(--accent)",
              fontSize: "11px",
              textDecoration: "none",
              padding: "4px 0",
            }}
          >
            → 配置路由策略
          </a>
          <a
            href="/review"
            style={{
              color: "var(--accent)",
              fontSize: "11px",
              textDecoration: "none",
              padding: "4px 0",
            }}
          >
            → 查看评审中心
          </a>
        </div>
      </div>
    </div>
  );
}

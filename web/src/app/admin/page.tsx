"use client";

import Link from "next/link";

/**
 * 管理中心首页 — 统一入口
 *
 * 整合 FlowForge 管理页面：
 *   - 灵智体管理（合并 agents + members + profiles）
 *   - Provider 配置（合并 models + accounts）
 *   - 系统设置（合并 settings + system + rules）
 *   - MCP 管理、插件管理、可观测性等
 *
 */

interface AdminCard {
  href: string;
  title: string;
  description: string;
  icon: string;
  category: "core" | "extension" | "advanced";
  badge?: string;
}

const ADMIN_CARDS: AdminCard[] = [
  // 核心管理
  {
    href: "/admin/agents",
    title: "灵智体管理",
    description: "灵智体花名册、状态监控、熔断器、能力画像",
    icon: "🤖",
    category: "core",
    badge: "5 灵智体",
  },
  {
    href: "/admin/models",
    title: "Provider 配置",
    description: "AI 模型、供应商白名单、API 密钥、健康检查",
    icon: "⚙",
    category: "core",
  },
  {
    href: "/admin/settings",
    title: "系统设置",
    description: "工作流、Agent、执行模式、工具、记忆、提示词、终端",
    icon: "🔧",
    category: "core",
  },
  // 扩展管理
  {
    href: "/admin/mcp",
    title: "MCP 管理",
    description: "MCP 服务器、工具目录、浏览器自动化依赖",
    icon: "📦",
    category: "extension",
  },
  {
    href: "/admin/plugins",
    title: "插件管理",
    description: "插件状态、外部集成、安装结果、能力市场",
    icon: "🧩",
    category: "extension",
  },
  {
    href: "/admin/observability",
    title: "可观测性",
    description: "服务健康、运维监控、日志查看、运行态观测",
    icon: "📊",
    category: "extension",
  },
  // 高级管理
  {
    href: "/admin/routing",
    title: "路由策略",
    description: "模型路由策略、连接器配置、回退链",
    icon: "🔀",
    category: "advanced",
  },
  {
    href: "/admin/permissions",
    title: "权限管理",
    description: "灵智体权限、工具白名单、操作授权",
    icon: "🔐",
    category: "advanced",
  },
  {
    href: "/admin/governance",
    title: "治理中心",
    description: "治理规则、合规审计、价值锚点",
    icon: "⚖",
    category: "advanced",
  },
  {
    href: "/admin/quotas",
    title: "配额看板",
    description: "Token 配额、调用限制、用量统计",
    icon: "📈",
    category: "advanced",
  },
  {
    href: "/admin/im",
    title: "IM 对接",
    description: "飞书、钉钉、企微和外部消息入口",
    icon: "💬",
    category: "advanced",
  },
  {
    href: "/admin/notify",
    title: "通知设置",
    description: "推送订阅、提醒策略、设备联动",
    icon: "🔔",
    category: "advanced",
  },
];

const CATEGORY_LABELS: Record<AdminCard["category"], { label: string; color: string }> = {
  core: { label: "核心管理", color: "var(--accent)" },
  extension: { label: "扩展管理", color: "#a78bfa" },
  advanced: { label: "高级管理", color: "#f59e0b" },
};

export default function AdminHomePage() {
  const coreCards = ADMIN_CARDS.filter((c) => c.category === "core");
  const extensionCards = ADMIN_CARDS.filter((c) => c.category === "extension");
  const advancedCards = ADMIN_CARDS.filter((c) => c.category === "advanced");

  const renderCard = (card: AdminCard) => (
    <Link
      key={card.href}
      href={card.href}
      style={{
        display: "block",
        padding: "16px",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        textDecoration: "none",
        transition: "all 0.15s",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
        <span style={{ fontSize: "28px" }}>{card.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-strong)" }}>
            {card.title}
          </div>
          {card.badge && (
            <span
              style={{
                display: "inline-block",
                marginTop: "2px",
                padding: "1px 6px",
                borderRadius: "8px",
                fontSize: "10px",
                fontWeight: 600,
                background: "rgba(16,185,129,0.15)",
                color: "#10b981",
              }}
            >
              {card.badge}
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
        {card.description}
      </div>
    </Link>
  );

  const renderSection = (cards: AdminCard[]) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "12px",
      }}
    >
      {cards.map(renderCard)}
    </div>
  );

  return (
    <div className="animate-rise">
      <div className="card">
        <h2 className="page-title" style={{ margin: "0 0 4px" }}>
          管理中心
        </h2>
        <p className="page-sub" style={{ marginBottom: "20px" }}>
          FlowForge 全部管理功能统一入口 · 整合灵智体、Provider、插件、可观测性等
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {(["core", "extension", "advanced"] as const).map((cat) => (
            <div key={cat}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "12px",
                  paddingBottom: "8px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    width: "4px",
                    height: "16px",
                    borderRadius: "2px",
                    background: CATEGORY_LABELS[cat].color,
                    display: "inline-block",
                  }}
                />
                <h3
                  style={{
                    margin: 0,
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "var(--text-strong)",
                  }}
                >
                  {CATEGORY_LABELS[cat].label}
                </h3>
                <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                  ({cat === "core" ? coreCards.length : cat === "extension" ? extensionCards.length : advancedCards.length})
                </span>
              </div>
              {renderSection(
                cat === "core" ? coreCards : cat === "extension" ? extensionCards : advancedCards
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

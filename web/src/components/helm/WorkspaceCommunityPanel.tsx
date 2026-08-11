"use client";

/**
 * WorkspaceCommunityPanel — 社区面板
 *
 * Issue 六段分组 + PR 五段分组 + 决策队列
 * 对应 clowder-ai 的 community 模块
 */

import { useState, useEffect, useCallback } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

interface IssueItem {
  id: string;
  title: string;
  status: "open" | "in_progress" | "in_review" | "resolved" | "closed" | "reopened";
  priority: "low" | "medium" | "high" | "critical";
  author: string;
  createdAt: string;
  labels?: string[];
  commentCount?: number;
}

interface PRItem {
  id: string;
  title: string;
  status: "draft" | "open" | "in_review" | "approved" | "merged" | "closed";
  author: string;
  createdAt: string;
  sourceBranch: string;
  targetBranch: string;
  commentCount?: number;
}

interface DecisionItem {
  id: string;
  title: string;
  status: "pending" | "approved" | "rejected" | "deferred";
  proposer: string;
  createdAt: string;
  reason?: string;
}

// ── Issue 分组配置 ─────────────────────────────────────────────────

const ISSUE_GROUPS: Array<{ id: IssueItem["status"]; label: string; icon: string; color: string }> = [
  { id: "open", label: "待处理", icon: "○", color: "var(--info)" },
  { id: "in_progress", label: "进行中", icon: "▶", color: "var(--warn)" },
  { id: "in_review", label: "审查中", icon: "◉", color: "var(--accent)" },
  { id: "resolved", label: "已解决", icon: "✓", color: "var(--ok)" },
  { id: "closed", label: "已关闭", icon: "✕", color: "var(--muted)" },
  { id: "reopened", label: "重新打开", icon: "↻", color: "var(--destructive)" },
];

// ── PR 分组配置 ────────────────────────────────────────────────────

const PR_GROUPS: Array<{ id: PRItem["status"]; label: string; icon: string; color: string }> = [
  { id: "draft", label: "草稿", icon: "✎", color: "var(--muted)" },
  { id: "open", label: "开放", icon: "○", color: "var(--info)" },
  { id: "in_review", label: "审查中", icon: "◉", color: "var(--accent)" },
  { id: "approved", label: "已批准", icon: "✓", color: "var(--ok)" },
  { id: "merged", label: "已合并", icon: "◆", color: "var(--ok)" },
  { id: "closed", label: "已关闭", icon: "✕", color: "var(--muted)" },
];

// ── 分组渲染组件 ───────────────────────────────────────────────────

function GroupSection<T extends { id: string }>({
  title,
  icon,
  groups,
  items,
  renderItem,
  emptyText,
}: {
  title: string;
  icon: string;
  groups: Array<{ id: string; label: string; icon: string; color: string }>;
  items: T[];
  getGroupId: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  emptyText: string;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "6px 12px",
          fontSize: "12px",
          fontWeight: 600,
          color: "var(--text)",
          borderBottom: "1px solid var(--border)",
          position: "sticky",
          top: 0,
          background: "var(--bg-elevated)",
          zIndex: 1,
        }}
      >
        <span style={{ fontSize: "14px" }}>{icon}</span>
        <span>{title}</span>
      </div>
      {groups.map((group) => {
        const groupItems = items.filter((item) => (item as any).status === group.id);
        if (groupItems.length === 0) return null;
        return (
          <div key={group.id}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 12px",
                fontSize: "11px",
                fontWeight: 600,
                color: group.color,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg)",
              }}
            >
              <span>{group.icon}</span>
              <span>{group.label}</span>
              <span
                style={{
                  marginLeft: "auto",
                  padding: "0 6px",
                  borderRadius: "8px",
                  fontSize: "10px",
                  background: group.color,
                  color: "#fff",
                }}
              >
                {groupItems.length}
              </span>
            </div>
            {groupItems.map(renderItem)}
          </div>
        );
      })}
    </div>
  );
}

// ── Issue 项 ───────────────────────────────────────────────────────

function IssueItemView({ issue }: { issue: IssueItem }) {
  return (
    <div
      style={{
        padding: "6px 12px 6px 24px",
        borderBottom: "1px solid var(--border)",
        fontSize: "12px",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {issue.title}
        </span>
        {issue.commentCount !== undefined && issue.commentCount > 0 && (
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>
            💬 {issue.commentCount}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
        <span>@{issue.author}</span>
        <span>{new Date(issue.createdAt).toLocaleDateString("zh-CN")}</span>
        {issue.labels?.map((l) => (
          <span key={l} style={{ padding: "0 4px", borderRadius: "3px", background: "var(--accent-subtle)", color: "var(--accent)", fontSize: "9px" }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── PR 项 ─────────────────────────────────────────────────────────

function PRItemView({ pr }: { pr: PRItem }) {
  return (
    <div
      style={{
        padding: "6px 12px 6px 24px",
        borderBottom: "1px solid var(--border)",
        fontSize: "12px",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pr.title}
        </span>
        {pr.commentCount !== undefined && pr.commentCount > 0 && (
          <span style={{ fontSize: "10px", color: "var(--muted)" }}>
            💬 {pr.commentCount}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
        <span>@{pr.author}</span>
        <code style={{ fontSize: "9px", fontFamily: "var(--mono)", background: "var(--bg)", padding: "0 4px", borderRadius: "2px" }}>
          {pr.sourceBranch} → {pr.targetBranch}
        </code>
        <span>{new Date(pr.createdAt).toLocaleDateString("zh-CN")}</span>
      </div>
    </div>
  );
}

// ── 决策项 ─────────────────────────────────────────────────────────

function DecisionItemView({ decision }: { decision: DecisionItem }) {
  const statusColors: Record<string, string> = {
    pending: "var(--warn)",
    approved: "var(--ok)",
    rejected: "var(--destructive)",
    deferred: "var(--muted)",
  };
  const statusLabels: Record<string, string> = {
    pending: "待定",
    approved: "已批准",
    rejected: "已拒绝",
    deferred: "推迟",
  };

  return (
    <div
      style={{
        padding: "6px 12px 6px 24px",
        borderBottom: "1px solid var(--border)",
        fontSize: "12px",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {decision.title}
        </span>
        <span
          style={{
            padding: "1px 6px",
            borderRadius: "8px",
            fontSize: "9px",
            fontWeight: 600,
            background: `${statusColors[decision.status]}20`,
            color: statusColors[decision.status],
          }}
        >
          {statusLabels[decision.status]}
        </span>
      </div>
      <div style={{ display: "flex", gap: "8px", fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
        <span>提议: @{decision.proposer}</span>
        <span>{new Date(decision.createdAt).toLocaleDateString("zh-CN")}</span>
      </div>
      {decision.reason && (
        <div style={{ fontSize: "10px", color: "var(--muted-strong)", marginTop: "2px", fontStyle: "italic" }}>
          {decision.reason}
        </div>
      )}
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface CommunityPanelProps {
  threadId?: string | null;
}

export default function WorkspaceCommunityPanel({ threadId }: CommunityPanelProps) {
  const [issues, setIssues] = useState<IssueItem[]>([]);
  const [prs, setPrs] = useState<PRItem[]>([]);
  const [decisions, setDecisions] = useState<DecisionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"issues" | "prs" | "decisions">("issues");

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/community/issues?limit=50").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/v1/community/prs?limit=50").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/v1/community/decisions?limit=20").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([issuesData, prsData, decisionsData]) => {
        setIssues(issuesData?.items ?? issuesData ?? []);
        setPrs(prsData?.items ?? prsData ?? []);
        setDecisions(decisionsData?.items ?? decisionsData ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载社区数据...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 分区 Tab */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {[
          { id: "issues" as const, label: `Issue (${issues.length})`, icon: "🐛" },
          { id: "prs" as const, label: `PR (${prs.length})`, icon: "🔀" },
          { id: "decisions" as const, label: `决策 (${decisions.length})`, icon: "📋" },
        ].map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveSection(section.id)}
            style={{
              flex: 1,
              padding: "8px 4px",
              fontSize: "11px",
              fontWeight: activeSection === section.id ? 600 : 500,
              color: activeSection === section.id ? "var(--accent)" : "var(--muted)",
              background: "none",
              border: "none",
              borderBottom: activeSection === section.id ? "2px solid var(--accent)" : "2px solid transparent",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {section.icon} {section.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {activeSection === "issues" && (
          <GroupSection
            title="Issues"
            icon="🐛"
            groups={ISSUE_GROUPS}
            items={issues}
            getGroupId={(i) => i.status}
            renderItem={(item) => <IssueItemView key={item.id} issue={item} />}
            emptyText="暂无 Issue"
          />
        )}
        {activeSection === "prs" && (
          <GroupSection
            title="Pull Requests"
            icon="🔀"
            groups={PR_GROUPS}
            items={prs}
            getGroupId={(p) => p.status}
            renderItem={(item) => <PRItemView key={item.id} pr={item} />}
            emptyText="暂无 PR"
          />
        )}
        {activeSection === "decisions" && (
          <div style={{ marginBottom: "16px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text)",
                borderBottom: "1px solid var(--border)",
                position: "sticky",
                top: 0,
                background: "var(--bg-elevated)",
                zIndex: 1,
              }}
            >
              <span style={{ fontSize: "14px" }}>📋</span>
              <span>决策队列</span>
            </div>
            {decisions.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
                暂无决策
              </div>
            ) : (
              decisions.map((d) => <DecisionItemView key={d.id} decision={d} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
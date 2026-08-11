"use client";

/**
 * WorkspaceApprovalPanel — 审批中心
 *
 * 待审批 / 历史双 Tab + Feature / 状态 / 对话多维过滤
 * 对应 clowder-ai 的 approval 模块
 */

import { useState, useEffect, useCallback } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

interface ApprovalItem {
  id: string;
  title: string;
  description?: string;
  proposer: string;
  status: "pending" | "approved" | "rejected" | "expired";
  kind: string;
  risk_level: "low" | "medium" | "high";
  proposed_at: string;
  reviewed_at?: string;
  reviewer?: string;
  reason?: string;
  threadId?: string;
}

// ── 风险等级徽章 ──────────────────────────────────────────────────

function RiskBadge({ level }: { level: ApprovalItem["risk_level"] }) {
  const colors: Record<string, { bg: string; fg: string; label: string }> = {
    low: { bg: "var(--ok-subtle)", fg: "var(--ok)", label: "低" },
    medium: { bg: "var(--warn-subtle)", fg: "var(--warn)", label: "中" },
    high: { bg: "var(--danger-subtle)", fg: "var(--danger)", label: "高" },
  };
  const c = colors[level];
  return (
    <span
      style={{
        padding: "1px 5px",
        borderRadius: "3px",
        fontSize: "9px",
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
      }}
    >
      {c.label}风险
    </span>
  );
}

// ── 审批项卡片 ─────────────────────────────────────────────────────

function ApprovalCard({
  item,
  onApprove,
  onReject,
}: {
  item: ApprovalItem;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}) {
  const statusColors: Record<string, string> = {
    pending: "var(--warn)",
    approved: "var(--ok)",
    rejected: "var(--destructive)",
    expired: "var(--muted)",
  };
  const statusLabels: Record<string, string> = {
    pending: "待审批",
    approved: "已批准",
    rejected: "已拒绝",
    expired: "已过期",
  };

  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: "var(--radius-sm, 4px)",
        background: "var(--bg)",
        border: `1px solid ${
          item.status === "pending" ? "var(--warn)" : "var(--border)"
        }`,
        fontSize: "12px",
        borderLeft: `3px solid ${statusColors[item.status]}`,
        transition: "box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "4px", marginBottom: "4px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.title}
          </div>
          <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
            {item.kind} — 提议: @{item.proposer}
          </div>
        </div>
        <RiskBadge level={item.risk_level} />
      </div>

      {item.description && (
        <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px", lineHeight: 1.4 }}>
          {item.description}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
        <div style={{ display: "flex", gap: "6px", fontSize: "10px", color: "var(--muted)" }}>
          <span>{new Date(item.proposed_at).toLocaleString("zh-CN")}</span>
          {item.reviewer && <span>审查: @{item.reviewer}</span>}
        </div>
        <div style={{ display: "flex", gap: "4px" }}>
          <span
            style={{
              padding: "1px 6px",
              borderRadius: "8px",
              fontSize: "9px",
              fontWeight: 600,
              background: `${statusColors[item.status]}20`,
              color: statusColors[item.status],
            }}
          >
            {statusLabels[item.status]}
          </span>
        </div>
      </div>

      {item.reason && (
        <div style={{ fontSize: "10px", color: "var(--muted-strong)", marginTop: "4px", padding: "4px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm, 4px)", fontStyle: "italic" }}>
          {item.reason}
        </div>
      )}

      {/* 待审批操作按钮 */}
      {item.status === "pending" && onApprove && onReject && (
        <div style={{ display: "flex", gap: "4px", marginTop: "6px", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => onReject(item.id)}
            style={{
              padding: "3px 10px",
              borderRadius: "var(--radius-sm, 4px)",
              border: "1px solid var(--destructive)",
              background: "transparent",
              color: "var(--destructive)",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => onApprove(item.id)}
            style={{
              padding: "3px 10px",
              borderRadius: "var(--radius-sm, 4px)",
              border: "none",
              background: "var(--ok)",
              color: "#fff",
              fontSize: "10px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            批准
          </button>
        </div>
      )}
    </div>
  );
}

// ── 筛选栏 ─────────────────────────────────────────────────────────

function FilterBar({
  kinds,
  selectedKind,
  selectedRisk,
  onKindChange,
  onRiskChange,
}: {
  kinds: string[];
  selectedKind: string;
  selectedRisk: string;
  onKindChange: (k: string) => void;
  onRiskChange: (r: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "6px",
        padding: "8px 12px",
        borderBottom: "1px solid var(--border)",
        flexWrap: "wrap",
      }}
    >
      <select
        value={selectedKind}
        onChange={(e) => onKindChange(e.target.value)}
        style={{
          padding: "3px 6px",
          borderRadius: "var(--radius-sm, 4px)",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: "10px",
          fontFamily: "inherit",
        }}
      >
        <option value="all">全部类型</option>
        {kinds.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <select
        value={selectedRisk}
        onChange={(e) => onRiskChange(e.target.value)}
        style={{
          padding: "3px 6px",
          borderRadius: "var(--radius-sm, 4px)",
          border: "1px solid var(--border)",
          background: "var(--bg)",
          color: "var(--text)",
          fontSize: "10px",
          fontFamily: "inherit",
        }}
      >
        <option value="all">全部风险</option>
        <option value="low">低风险</option>
        <option value="medium">中风险</option>
        <option value="high">高风险</option>
      </select>
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

interface ApprovalPanelProps {
  threadId?: string | null;
}

export default function WorkspaceApprovalPanel({ threadId }: ApprovalPanelProps) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [selectedKind, setSelectedKind] = useState("all");
  const [selectedRisk, setSelectedRisk] = useState("all");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/approvals?limit=100");
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? data.data ?? []);
      }
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApprove = useCallback(async (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "approved" as const } : i)));
    try {
      await fetch(`/api/v1/approvals/${id}/approve`, { method: "POST" });
    } catch {
      fetchData();
    }
  }, [fetchData]);

  const handleReject = useCallback(async (id: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status: "rejected" as const } : i)));
    try {
      await fetch(`/api/v1/approvals/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "已拒绝" }),
      });
    } catch {
      fetchData();
    }
  }, [fetchData]);

  // 提取所有 kind 值用于筛选
  const allKinds = Array.from(new Set(items.map((i) => i.kind).filter(Boolean)));

  // 筛选
  const filtered = items.filter((i) => {
    if (activeTab === "pending" && i.status !== "pending") return false;
    if (activeTab === "history" && i.status === "pending") return false;
    if (selectedKind !== "all" && i.kind !== selectedKind) return false;
    if (selectedRisk !== "all" && i.risk_level !== selectedRisk) return false;
    return true;
  });

  if (loading) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        加载审批数据...
      </div>
    );
  }

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 双 Tab */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("pending")}
          style={{
            flex: 1,
            padding: "8px 4px",
            fontSize: "11px",
            fontWeight: activeTab === "pending" ? 600 : 500,
            color: activeTab === "pending" ? "var(--accent)" : "var(--muted)",
            background: "none",
            border: "none",
            borderBottom: activeTab === "pending" ? "2px solid var(--accent)" : "2px solid transparent",
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
          }}
        >
          待审批
          {pendingCount > 0 && (
            <span
              style={{
                padding: "1px 6px",
                borderRadius: "8px",
                fontSize: "9px",
                fontWeight: 600,
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          style={{
            flex: 1,
            padding: "8px 4px",
            fontSize: "11px",
            fontWeight: activeTab === "history" ? 600 : 500,
            color: activeTab === "history" ? "var(--accent)" : "var(--muted)",
            background: "none",
            border: "none",
            borderBottom: activeTab === "history" ? "2px solid var(--accent)" : "2px solid transparent",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          历史记录 ({items.filter((i) => i.status !== "pending").length})
        </button>
      </div>

      {/* 筛选栏 */}
      <FilterBar
        kinds={allKinds}
        selectedKind={selectedKind}
        selectedRisk={selectedRisk}
        onKindChange={setSelectedKind}
        onRiskChange={setSelectedRisk}
      />

      {/* 列表 */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: "12px",
              }}
            >
              <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>✓</div>
              <div>{activeTab === "pending" ? "暂无待审批项" : "暂无审批历史"}</div>
            </div>
          ) : (
            filtered.map((item) => (
              <ApprovalCard
                key={item.id}
                item={item}
                onApprove={item.status === "pending" ? handleApprove : undefined}
                onReject={item.status === "pending" ? handleReject : undefined}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
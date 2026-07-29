"use client";

/**
 * ApprovalHubDrawer — 审批中心抽屉
 * Phase 2 阶段：占位实现，仅消费 approvalHubStore 的 open 状态，渲染一个空抽屉壳。
 * 后续 Phase 6 会按需补全审批项列表、批量操作、过滤等能力。
 */

import { useApprovalHubStore } from "@/stores/approvalHubStore";

export function ApprovalHubDrawer() {
  const isOpen = useApprovalHubStore((s) => s.isOpen);
  const close = useApprovalHubStore((s) => s.close);

  if (!isOpen) return null;

  return (
    <div
      data-approval-hub-drawer="true"
      role="dialog"
      aria-label="审批中心"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(420px, 90vw)",
        background: "var(--cafe-surface, #fff)",
        borderLeft: "1px solid var(--cafe-border, #e5e7eb)",
        boxShadow: "var(--shadow-elevation-2, 0 4px 10px rgba(0,0,0,0.1))",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--cafe-border-subtle, #f3f4f6)",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cafe-text, #111)" }}>
          审批中心
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="关闭审批中心"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 18,
            color: "var(--cafe-text-secondary, #6b7280)",
            padding: "4px 8px",
            borderRadius: 6,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          flex: 1,
          padding: 16,
          overflowY: "auto",
          color: "var(--cafe-text-muted, #9ca3af)",
          fontSize: 13,
        }}
      >
        暂无待审批项
      </div>
    </div>
  );
}

"use client";

/**
 * HubListModal — Hub 全局入口模态框（占位实现）
 *
 * 由 ActivityBar 全局入口触发，承载 IM Hub 线程、连接器、权限多 Tab。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * 主题：使用 FlowForge CSS 变量 var(--accent) / var(--bg-elevated)。
 */

import { useCallback, useEffect, useState } from "react";

interface HubThreadSummary {
  id: string;
  title?: string;
  connectorId?: string;
  externalChatId?: string;
  createdAt?: number;
  lastCommandAt?: number;
}

interface HubListModalProps {
  open: boolean;
  onClose: () => void;
  currentThreadId?: string;
}

type HubTab = "threads" | "config";

const CONNECTOR_LABELS: Record<string, string> = {
  feishu: "飞书",
  telegram: "Telegram",
  wechat: "微信",
  slack: "Slack",
  discord: "Discord",
  dingtalk: "钉钉",
};

export function HubListModal({ open, onClose }: HubListModalProps) {
  const [threads, setThreads] = useState<HubThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HubTab>("threads");

  const fetchThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/im/hub-threads");
      if (!res.ok) {
        setError("加载 IM Hub 线程失败");
        return;
      }
      const data = await res.json();
      setThreads(data?.threads ?? data?.data?.items ?? []);
    } catch {
      setError("网络错误，无法加载 Hub 线程");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchThreads();
      setActiveTab("threads");
    }
  }, [open, fetchThreads]);

  if (!open) return null;

  const grouped = new Map<string, HubThreadSummary[]>();
  for (const t of threads) {
    const key = t.connectorId ?? "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-hub-list-modal="root"
    >
      <div
        style={{
          background: "var(--bg-elevated,#1e1f26)",
          borderRadius: "16px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          width: "560px",
          maxWidth: "92vw",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid var(--border,#2a2c3a)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border,#2a2c3a)",
          }}
          data-hub-list-modal-header="true"
        >
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--text-strong,#e5e7eb)" }}>
            Hub 线程总览
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted,#9ca3af)",
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
            }}
            data-hub-list-modal-action="close"
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: "4px", padding: "8px 20px", borderBottom: "1px solid var(--border,#2a2c3a)" }}>
          {(["threads", "config"] as HubTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                background: activeTab === tab ? "var(--accent,#ff5c5c)" : "transparent",
                color: activeTab === tab ? "#fff" : "var(--muted,#9ca3af)",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
              data-hub-list-modal-tab={tab}
            >
              {tab === "threads" ? "线程列表" : "连接器配置"}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }} data-hub-list-modal-body="true">
          {loading && <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px" }}>加载中...</div>}
          {error && (
            <div style={{ color: "#ef4444", fontSize: "13px" }} data-hub-list-modal-error="load">
              {error}
            </div>
          )}
          {!loading && !error && activeTab === "threads" && (
            Array.from(grouped.entries()).map(([connectorId, items]) => (
              <div key={connectorId} style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted,#9ca3af)", textTransform: "uppercase", marginBottom: "6px" }}>
                  {CONNECTOR_LABELS[connectorId] ?? connectorId}（{items.length}）
                </div>
                {items.map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: "var(--bg,#15151c)",
                      border: "1px solid var(--border,#2a2c3a)",
                      marginBottom: "4px",
                      fontSize: "12px",
                      color: "var(--text,#e5e7eb)",
                    }}
                    data-hub-list-modal-thread={t.id}
                  >
                    {t.title || t.id}
                  </div>
                ))}
              </div>
            ))
          )}
          {!loading && !error && activeTab === "config" && (
            <div style={{ color: "var(--muted,#9ca3af)", fontSize: "13px", padding: "20px 0", textAlign: "center" }}>
              连接器配置请前往 <code style={{ color: "var(--accent,#ff5c5c)" }}>/admin/routing</code> 页面
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HubListModal;

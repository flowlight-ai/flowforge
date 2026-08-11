"use client";

/**
 * WorkspaceRecallPanel — 记忆中心
 *
 * 记忆召回事件流 + 事件时间轴 + 记忆账本
 * 对应 clowder-ai 的 recall 模块 (RecallFeed + EventTimeline + RecallLedger)
 */

import { useState, useEffect, useCallback } from "react";

// ── 类型定义 ───────────────────────────────────────────────────────

interface RecallEvent {
  id: string;
  type: "memory_push" | "memory_pull" | "memory_merge" | "memory_delete" | "memory_classify";
  summary: string;
  source: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface TimelineEntry {
  id: string;
  event: string;
  category: string;
  timestamp: string;
  detail?: string;
}

interface LedgerStats {
  totalMemories: number;
  pushCount: number;
  pullCount: number;
  mergeCount: number;
  deleteCount: number;
  byDay: Array<{ date: string; count: number }>;
}

// ── 子组件：记忆流 ────────────────────────────────────────────────

function RecallFeedView() {
  const [events, setEvents] = useState<RecallEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/memory/events?limit=50")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.items) setEvents(data.items);
        else if (Array.isArray(data)) setEvents(data);
        else setEvents([]);
      })
      .catch(() => setError("无法加载记忆事件"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: "16px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>加载记忆流...</div>;
  }

  if (error) {
    return <div style={{ padding: "16px", fontSize: "12px", color: "var(--destructive)", textAlign: "center" }}>{error}</div>;
  }

  const typeIcon: Record<string, string> = {
    memory_push: "📤",
    memory_pull: "📥",
    memory_merge: "🔀",
    memory_delete: "🗑️",
    memory_classify: "🏷️",
  };

  return (
    <div>
      <div style={{ padding: "8px 12px", fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)" }}>
        记忆事件流 ({events.length})
      </div>
      {events.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
          <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>◉</div>
          <div>暂无记忆事件</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {events.map((evt) => (
            <div
              key={evt.id}
              style={{
                display: "flex",
                gap: "8px",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                fontSize: "12px",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ fontSize: "14px", flexShrink: 0 }}>
                {typeIcon[evt.type] || "📌"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {evt.summary}
                </div>
                <div style={{ display: "flex", gap: "8px", fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                  <span>来源: {evt.source}</span>
                  <span>|</span>
                  <span>{new Date(evt.timestamp).toLocaleString("zh-CN")}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 子组件：事件时间轴 ────────────────────────────────────────────

function EventTimelineView() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/memory/timeline?limit=50")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.items) setEntries(data.items);
        else if (Array.isArray(data)) setEntries(data);
        else setEntries([]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: "16px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>加载时间轴...</div>;
  }

  if (entries.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>
        <div style={{ fontSize: "24px", marginBottom: "8px", opacity: 0.4 }}>📅</div>
        <div>暂无时间轴记录</div>
      </div>
    );
  }

  // 按日期分组
  const grouped: Record<string, TimelineEntry[]> = {};
  entries.forEach((e) => {
    const date = new Date(e.timestamp).toLocaleDateString("zh-CN");
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(e);
  });

  return (
    <div>
      <div style={{ padding: "8px 12px", fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)" }}>
        事件时间轴
      </div>
      <div style={{ padding: "8px 12px" }}>
        {Object.entries(grouped).map(([date, items]) => (
          <div key={date} style={{ marginBottom: "12px" }}>
            <div style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 600, marginBottom: "6px" }}>
              {date}
            </div>
            <div style={{ position: "relative", paddingLeft: "16px", borderLeft: "2px solid var(--border)" }}>
              {items.map((item) => (
                <div key={item.id} style={{ marginBottom: "8px", position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: "-21px",
                      top: "4px",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "var(--accent)",
                      border: "2px solid var(--bg-elevated)",
                    }}
                  />
                  <div style={{ fontSize: "12px", color: "var(--text)", fontWeight: 500 }}>{item.event}</div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                    {item.category} — {new Date(item.timestamp).toLocaleTimeString("zh-CN")}
                  </div>
                  {item.detail && (
                    <div style={{ fontSize: "11px", color: "var(--muted-strong)", marginTop: "2px" }}>
                      {item.detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 子组件：记忆账本 ──────────────────────────────────────────────

function RecallLedgerView() {
  const [stats, setStats] = useState<LedgerStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/memory/ledger")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setStats(data);
        else
          setStats({
            totalMemories: 0,
            pushCount: 0,
            pullCount: 0,
            mergeCount: 0,
            deleteCount: 0,
            byDay: [],
          });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: "16px", fontSize: "12px", color: "var(--muted)", textAlign: "center" }}>加载账本...</div>;
  }

  if (!stats) {
    return <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "12px" }}>暂无账本数据</div>;
  }

  const metrics = [
    { label: "总记忆数", value: stats.totalMemories, color: "var(--accent)" },
    { label: "推送", value: stats.pushCount, color: "var(--ok)" },
    { label: "拉取", value: stats.pullCount, color: "var(--info)" },
    { label: "合并", value: stats.mergeCount, color: "var(--warn)" },
    { label: "删除", value: stats.deleteCount, color: "var(--destructive)" },
  ];

  return (
    <div>
      <div style={{ padding: "8px 12px", fontSize: "11px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1px solid var(--border)" }}>
        记忆账本
      </div>
      <div style={{ padding: "12px" }}>
        {/* 指标卡片 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", marginBottom: "16px" }}>
          {metrics.map((m) => (
            <div
              key={m.label}
              style={{
                padding: "10px",
                borderRadius: "var(--radius-sm, 4px)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "20px", fontWeight: 700, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* 每日趋势 */}
        {stats.byDay.length > 0 && (
          <div>
            <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 600, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              每日趋势
            </div>
            <div style={{ display: "flex", gap: "4px", alignItems: "flex-end", height: "60px" }}>
              {stats.byDay.slice(-14).map((day) => {
                const maxCount = Math.max(...stats.byDay.map((d) => d.count), 1);
                const height = (day.count / maxCount) * 100;
                return (
                  <div
                    key={day.date}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "2px",
                    }}
                    title={`${day.date}: ${day.count} 条`}
                  >
                    <div
                      style={{
                        width: "100%",
                        background: "var(--accent)",
                        borderRadius: "2px 2px 0 0",
                        height: `${Math.max(height, 4)}%`,
                        opacity: 0.7 + (day.count / maxCount) * 0.3,
                        transition: "height 0.3s",
                      }}
                    />
                    <div style={{ fontSize: "8px", color: "var(--muted)", transform: "rotate(-45deg)", marginTop: "4px" }}>
                      {day.date.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主面板 ────────────────────────────────────────────────────────

type RecallTab = "feed" | "events" | "ledger";

interface RecallPanelProps {
  threadId?: string | null;
}

export default function WorkspaceRecallPanel({ threadId }: RecallPanelProps) {
  const [tab, setTab] = useState<RecallTab>("feed");

  const tabs: { id: RecallTab; label: string }[] = [
    { id: "feed", label: "记忆流" },
    { id: "events", label: "时间轴" },
    { id: "ledger", label: "账本" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* 子 Tab 切换 */}
      <div style={{ display: "flex", gap: "4px", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "4px 12px",
              borderRadius: "var(--radius-full, 9999px)",
              fontSize: "11px",
              fontWeight: 600,
              border: tab === t.id ? "1px solid var(--accent)" : "1px solid transparent",
              background: tab === t.id ? "var(--accent-subtle)" : "transparent",
              color: tab === t.id ? "var(--accent)" : "var(--muted)",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "all 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "feed" && <RecallFeedView />}
        {tab === "events" && <EventTimelineView />}
        {tab === "ledger" && <RecallLedgerView />}
      </div>
    </div>
  );
}
"use client";

/**
 * MissionHub — 任务中心主页
 *
 * 列表视图 + 看板视图切换；支持过滤、刷新、新建任务。
 * 移植自 clowder-ai mission-hub，简化为单容器版。
 *
 * 命名规范：使用 "可进化智能体 / Forgekin"（非 "灵智体"）。
 * API：GET /api/v1/missions?status=&priority=&assignee=
 *      POST /api/v1/missions/{id}/move
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MissionCard, type Mission, type MissionStatus } from "./MissionCard";
import { MissionFilters, type MissionFilterValue } from "./MissionFilters";
import { MissionKanban } from "./MissionKanban";

type ViewMode = "list" | "kanban";

export function MissionHub() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("list");
  const [filter, setFilter] = useState<MissionFilterValue>({ status: "all", priority: "all", assignee: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.status !== "all") params.set("status", filter.status);
      if (filter.priority !== "all") params.set("priority", filter.priority);
      if (filter.assignee) params.set("assignee", filter.assignee);
      const res = await fetch(`/api/v1/missions?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: Mission[] = data?.items ?? data?.missions ?? [];
      setMissions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMissions([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleMove = useCallback(async (id: string, next: MissionStatus) => {
    setMissions((prev) => prev.map((m) => (m.id === id ? { ...m, status: next } : m)));
    try {
      await fetch(`/api/v1/missions/${id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch (e) {
      console.error("移动任务失败", e);
      void load();
    }
  }, [load]);

  const assignees = useMemo(() => {
    const set = new Set<string>();
    missions.forEach((m) => { if (m.assignee) set.add(m.assignee); });
    return Array.from(set).sort();
  }, [missions]);

  const counts = useMemo(() => ({
    total: missions.length,
    todo: missions.filter((m) => m.status === "todo").length,
    doing: missions.filter((m) => m.status === "doing").length,
    done: missions.filter((m) => m.status === "done").length,
  }), [missions]);

  return (
    <div className="animate-rise" data-mission="hub">
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px", flexWrap: "wrap", gap: "10px" }}>
          <h2 className="page-title" style={{ margin: 0 }}>Mission Hub · 任务中心</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <ViewToggle view={view} onChange={setView} />
            <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
          </div>
        </div>
        <p className="page-sub" style={{ marginBottom: "12px" }}>
          共 {counts.total} · 待办 {counts.todo} · 进行中 {counts.doing} · 已完成 {counts.done}
        </p>

        <div style={{ marginBottom: "12px" }}>
          <MissionFilters value={filter} onChange={setFilter} assignees={assignees} />
        </div>

        {error && (
          <div style={errorBoxStyle}>
            <span>加载失败：{error}</span>
            <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
          </div>
        )}

        {loading ? (
          <div style={loadingStyle}>加载中...</div>
        ) : missions.length === 0 ? (
          <div style={emptyStyle}>
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>◎</div>
            暂无任务 · 调整筛选或新建任务
          </div>
        ) : view === "kanban" ? (
          <MissionKanban missions={missions} onMove={handleMove} />
        ) : (
          <div
            data-mission="list"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "10px",
            }}
          >
            {missions.map((m) => (
              <MissionCard key={m.id} mission={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div
      data-mission="view-toggle"
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
      }}
    >
      {(["list", "kanban"] as const).map((v) => (
        <button
          key={v}
          data-mission-view={v}
          onClick={() => onChange(v)}
          style={{
            padding: "6px 14px",
            background: view === v ? "var(--accent)" : "transparent",
            color: view === v ? "#fff" : "var(--muted)",
            border: "none",
            cursor: "pointer",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          {v === "list" ? "列表" : "看板"}
        </button>
      ))}
    </div>
  );
}

const refreshBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--accent)",
  fontSize: "13px",
  fontWeight: 600,
};

const errorBoxStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontSize: "13px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "12px",
};

const retryBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--danger)",
  fontWeight: 600,
  fontSize: "12px",
};

const loadingStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px",
  color: "var(--muted)",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px",
  color: "var(--muted)",
};

"use client";

/**
 * MissionKanban — 任务看板视图
 *
 * 三列布局（todo / doing / done），支持拖拽（简化版通过点击移动）。
 * 列头显示列名与计数；卡片复用 MissionCard。
 */

import { useCallback, useState } from "react";
import { MissionCard, type Mission, type MissionStatus } from "./MissionCard";

interface MissionKanbanProps {
  readonly missions: readonly Mission[];
  readonly onMove?: (id: string, next: MissionStatus) => void;
  readonly onSelect?: (id: string) => void;
}

interface Column {
  readonly id: MissionStatus;
  readonly label: string;
  readonly accent: string;
}

const COLUMNS: readonly Column[] = [
  { id: "todo", label: "待办", accent: "var(--muted)" },
  { id: "doing", label: "进行中", accent: "var(--info)" },
  { id: "done", label: "已完成", accent: "var(--ok)" },
];

export function MissionKanban({ missions, onMove, onSelect }: MissionKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleDrop = useCallback((target: MissionStatus) => {
    if (!draggingId || !onMove) {
      setDraggingId(null);
      return;
    }
    onMove(draggingId, target);
    setDraggingId(null);
  }, [draggingId, onMove]);

  return (
    <div
      data-mission="kanban"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "12px",
        alignItems: "start",
      }}
    >
      {COLUMNS.map((col) => {
        const items = missions.filter((m) => m.status === col.id);
        return (
          <div
            key={col.id}
            data-mission-column={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(col.id)}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "10px",
              minHeight: "300px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.accent }} />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg)" }}>{col.label}</span>
              </div>
              <span className="pill" style={{ background: "var(--bg-hover)", color: "var(--muted)" }}>
                {items.length}
              </span>
            </div>

            {items.length === 0 ? (
              <div
                data-mission-empty={col.id}
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: "12px",
                  border: "1px dashed var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                拖拽卡片到此列
              </div>
            ) : (
              items.map((m) => (
                <MissionCard
                  key={m.id}
                  mission={m}
                  draggable
                  onDragStart={setDraggingId}
                  onClick={onSelect}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

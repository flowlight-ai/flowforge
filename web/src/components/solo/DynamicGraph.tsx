"use client";

import { useMemo } from "react";
import { DynNode, DynEdge } from "./solo-types";
import { getAgentColor, getAgentInitials, getModeStyle, formatDurationMs } from "./solo-utils";

interface DynamicGraphProps {
  nodes: DynNode[];
  edges: DynEdge[];
  currentStep?: string;
}

const STATUS_CONFIG: Record<string, { bg: string; border: string; icon: string; glow: string }> = {
  pending: { bg: "rgba(55,65,81,0.4)", border: "#4b5563", icon: "⏳", glow: "" },
  running: { bg: "rgba(30,64,175,0.2)", border: "#3b82f6", icon: "⚡", glow: "0 0 12px rgba(59,130,246,0.5)" },
  completed: { bg: "rgba(22,101,52,0.2)", border: "#22c55e", icon: "✓", glow: "" },
  error: { bg: "rgba(127,29,29,0.2)", border: "#ef4444", icon: "✗", glow: "0 0 8px rgba(239,68,68,0.4)" },
};

const TYPE_COLORS: Record<string, string> = {
  workflow: "#f59e0b",
  agent: "#6366f1",
  mode_step: "#8b5cf6",
  tool: "#06b6d4",
  llm: "#a855f7",
  review: "#f97316",
};

const MODE_STEP_ICONS: Record<string, string> = {
  thought: "💭",
  action: "🎯",
  observation: "👁",
  planner: "📋",
  executor: "⚙",
  critic: "🔍",
  reflect: "🔄",
  decide: "⚖",
};

function getModeStepIcon(label: string): string {
  const lower = label.toLowerCase();
  for (const [key, icon] of Object.entries(MODE_STEP_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "→";
}

function NodeAvatar({ node }: { node: DynNode }) {
  if (node.type === "workflow") {
    return (
      <div className="dyn-node-avatar" style={{ background: `linear-gradient(135deg, ${TYPE_COLORS.workflow}, #d97706)`, width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
        ✦
      </div>
    );
  }
  if (node.type === "agent" && node.agent) {
    const color = getAgentColor(node.agent);
    const initials = getAgentInitials(node.agent);
    return (
      <div className="dyn-node-avatar" style={{ background: `linear-gradient(135deg, ${color}, ${color}dd)`, width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
        {initials}
      </div>
    );
  }
  if (node.type === "review") {
    return (
      <div className="dyn-node-avatar" style={{ background: "linear-gradient(135deg, #f97316, #ea580c)", width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>
        ⚖
      </div>
    );
  }
  if (node.type === "mode_step") {
    return (
      <div className="dyn-node-avatar" style={{ width: 20, height: 20, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>
        {getModeStepIcon(node.label)}
      </div>
    );
  }
  if (node.type === "tool") {
    return (
      <div className="dyn-node-avatar" style={{ width: 20, height: 20, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>
        🔧
      </div>
    );
  }
  return null;
}

function ModeBadgeMini({ mode }: { mode?: string }) {
  if (!mode) return null;
  const style = getModeStyle(mode);
  return (
    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, color: style.color, background: style.bg, fontWeight: 600, lineHeight: "14px", whiteSpace: "nowrap" }}>
      {style.label}
    </span>
  );
}

function DynNodeCard({ node, isCurrent }: { node: DynNode; isCurrent: boolean }) {
  const cfg = STATUS_CONFIG[node.status] || STATUS_CONFIG.pending;
  const typeColor = TYPE_COLORS[node.type] || "#6b7280";
  const isTopLevel = node.type === "workflow" || node.type === "agent" || node.type === "review";
  const isSubNode = node.type === "mode_step" || node.type === "tool" || node.type === "llm";

  return (
    <div
      className={node.status === "running" ? "dyn-node-card dyn-node-running" : "dyn-node-card"}
      style={{
        background: cfg.bg,
        border: `1.5px solid ${isCurrent ? "#3b82f6" : cfg.border}`,
        borderRadius: isTopLevel ? 10 : 8,
        padding: isTopLevel ? "8px 12px" : "5px 10px",
        boxShadow: isCurrent ? cfg.glow : node.status === "running" ? cfg.glow : "none",
        marginLeft: isSubNode ? 28 : 0,
        marginBottom: 4,
        display: "flex",
        alignItems: "center",
        gap: 8,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {node.status === "running" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${typeColor}, transparent)`,
            animation: "dyn-shimmer 1.5s ease-in-out infinite",
          }}
        />
      )}
      <NodeAvatar node={node} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: isTopLevel ? 12 : 11, fontWeight: isCurrent ? 700 : 500, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {node.label}
          </span>
          {node.agent && node.type === "agent" && (
            <span style={{ fontSize: 9, color: getAgentColor(node.agent), opacity: 0.8 }}>
              {node.agent}
            </span>
          )}
          <ModeBadgeMini mode={node.mode} />
          {node.iteration != null && (
            <span style={{ fontSize: 9, color: "#94a3b8", background: "rgba(148,163,184,0.1)", padding: "0 4px", borderRadius: 3 }}>
              #{node.iteration}
            </span>
          )}
        </div>
        {node.summary && (
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 }}>
            {node.summary}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {node.durationMs != null && node.status === "completed" && (
          <span style={{ fontSize: 9, color: "#64748b" }}>{formatDurationMs(node.durationMs)}</span>
        )}
        <span style={{ fontSize: isTopLevel ? 13 : 11, opacity: node.status === "running" ? 1 : 0.7 }}>
          {cfg.icon}
        </span>
      </div>
    </div>
  );
}

export default function DynamicGraph({ nodes, edges, currentStep }: DynamicGraphProps) {
  const hierarchy = useMemo(() => {
    const topLevel: DynNode[] = [];
    const children: Record<string, DynNode[]> = {};

    for (const node of nodes) {
      if (node.parentId) {
        if (!children[node.parentId]) children[node.parentId] = [];
        children[node.parentId].push(node);
      } else {
        topLevel.push(node);
      }
    }

    return { topLevel, children };
  }, [nodes]);

  if (!nodes.length) return null;

  const completedCount = nodes.filter((n) => n.status === "completed").length;

  return (
    <div className="my-3 rounded-lg border border-gray-700 bg-gray-900/60 p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-400 font-medium">执行图谱</span>
        <span className="text-xs text-gray-500">
          {completedCount}/{nodes.length} 完成
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 8, fontSize: 9, color: "#64748b" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS.agent }} /> Agent
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS.mode_step }} /> Mode
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS.tool }} /> Tool
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: TYPE_COLORS.review }} /> Review
          </span>
        </div>
      </div>
      <div className="dyn-graph-container">
        {hierarchy.topLevel.map((node) => {
          const childNodes = hierarchy.children[node.id] || [];
          return (
            <div key={node.id} style={{ marginBottom: 6 }}>
              <DynNodeCard node={node} isCurrent={node.id === currentStep} />
              {childNodes.length > 0 && (
                <div style={{ marginTop: 2 }}>
                  {childNodes.map((child) => (
                    <DynNodeCard key={child.id} node={child} isCurrent={child.id === currentStep} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes dyn-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .dyn-node-running {
          animation: dyn-pulse-border 2s ease-in-out infinite;
        }
        @keyframes dyn-pulse-border {
          0%, 100% { border-color: #3b82f6; }
          50% { border-color: #60a5fa; }
        }
      `}</style>
    </div>
  );
}

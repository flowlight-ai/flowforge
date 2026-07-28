"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

interface GraphNode {
  id: string;
  type: string;
  label: string;
  parent?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

interface GraphData {
  name: string;
  display_name?: string;
  description?: string;
  default_mode?: string;
  mode_display_name?: string;
  mode_description?: string;
  capabilities?: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface StaticGraphModalProps {
  type: "workflow" | "agent" | "mode";
  name: string;
  onClose: () => void;
}

const NODE_COLORS: Record<string, string> = {
  agent: "#6366f1",
  llm: "#8b5cf6",
  tool: "#06b6d4",
  result: "#22c55e",
  review: "#f59e0b",
  mode: "#ec4899",
  orchestrator: "#ec4899",
};

const NODE_ICONS: Record<string, string> = {
  agent: "🤖",
  llm: "🧠",
  tool: "🔧",
  result: "📊",
  review: "👁️",
  mode: "⚡",
  orchestrator: "⚡",
};

const NODE_SIZES: Record<string, { w: number; h: number }> = {
  agent: { w: 160, h: 50 },
  llm: { w: 140, h: 36 },
  tool: { w: 140, h: 36 },
  result: { w: 140, h: 36 },
  review: { w: 160, h: 50 },
  mode: { w: 150, h: 40 },
  orchestrator: { w: 160, h: 50 },
};

export default function StaticGraphModal({ type, name, onClose }: StaticGraphModalProps) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    fetch(`/api/v1/graph/${type}s/${name}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        setGraph(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [type, name]);

  const hierarchy = useMemo(() => {
    if (!graph) return { roots: [], children: {} };
    const children: Record<string, GraphNode[]> = {};
    const roots: GraphNode[] = [];
    for (const node of graph.nodes) {
      if (node.parent) {
        if (!children[node.parent]) children[node.parent] = [];
        children[node.parent].push(node);
      } else {
        roots.push(node);
      }
    }
    return { roots, children };
  }, [graph]);

  const layout = useMemo(() => {
    const { roots, children } = hierarchy;
    if (!roots.length) return { positions: {} as Record<string, { x: number; y: number }>, svgW: 600, svgH: 400 };

    const positions: Record<string, { x: number; y: number }> = {};
    const GROUP_H_GAP = 40;
    const GROUP_V_GAP = 80;
    const CHILD_V_GAP = 48;
    const CHILD_OFFSET_X = 30;

    let currentY = 60;
    const canvasCenterX = 300;

    for (const root of roots) {
      const rootSize = NODE_SIZES[root.type] || NODE_SIZES.agent;
      const rootKids = children[root.id] || [];

      let groupHeight = rootSize.h;

      if (rootKids.length > 0) {
        const modeKid = rootKids.find((k) => k.type === "mode");
        const toolKids = rootKids.filter((k) => k.type === "tool");
        const modeInnerKids = modeKid ? (children[modeKid.id] || []) : [];

        let childRows = 0;
        if (modeKid) {
          childRows += 1 + modeInnerKids.length;
        }
        childRows += toolKids.length;

        const childBlockHeight = childRows * CHILD_V_GAP;
        groupHeight = Math.max(groupHeight, rootSize.h + 10 + childBlockHeight);
      }

      positions[root.id] = { x: canvasCenterX, y: currentY + rootSize.h / 2 };

      if (rootKids.length > 0) {
        const childStartY = currentY + rootSize.h + 10;
        let childY = childStartY;
        const childX = canvasCenterX + CHILD_OFFSET_X;

        const modeKid = rootKids.find((k) => k.type === "mode");
        const toolKids = rootKids.filter((k) => k.type === "tool");

        if (modeKid) {
          positions[modeKid.id] = { x: childX, y: childY + 20 };
          childY += CHILD_V_GAP;

          const modeInnerKids = children[modeKid.id] || [];
          for (const inner of modeInnerKids) {
            positions[inner.id] = { x: childX + 20, y: childY + 18 };
            childY += CHILD_V_GAP;
          }
        }

        for (const tk of toolKids) {
          positions[tk.id] = { x: childX, y: childY + 18 };
          childY += CHILD_V_GAP;
        }
      }

      currentY += groupHeight + GROUP_V_GAP;
    }

    const svgH = Math.max(400, currentY + 40);
    return { positions, svgW: 600, svgH };
  }, [hierarchy]);

  const renderGraph = useCallback(() => {
    if (!graph || !graph.nodes.length) {
      return <div className="text-center text-[var(--muted)] py-8">暂无流程图数据</div>;
    }

    const { positions, svgW, svgH } = layout;
    const { roots, children } = hierarchy;

    return (
      <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} className="bg-[color-mix(in_srgb,var(--bg-elevated)_50%,transparent)] rounded-lg">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
          <marker id="arrowhead-loop" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
          </marker>
        </defs>

        {roots.map((root) => {
          const rootKids = children[root.id] || [];
          if (rootKids.length === 0) return null;

          const rootPos = positions[root.id];
          const rootSize = NODE_SIZES[root.type] || NODE_SIZES.agent;
          const kidPositions = rootKids
            .map((k) => positions[k.id])
            .filter(Boolean);
          const allInnerPositions: { x: number; y: number }[] = [];
          for (const k of rootKids) {
            const kp = positions[k.id];
            if (kp) allInnerPositions.push(kp);
            const innerKids = children[k.id] || [];
            for (const ik of innerKids) {
              const ikp = positions[ik.id];
              if (ikp) allInnerPositions.push(ikp);
            }
          }

          if (allInnerPositions.length === 0) return null;

          const minX = Math.min(...allInnerPositions.map((p) => p.x)) - 90;
          const maxX = Math.max(...allInnerPositions.map((p) => p.x)) + 90;
          const minY = Math.min(...allInnerPositions.map((p) => p.y)) - 30;
          const maxY = Math.max(...allInnerPositions.map((p) => p.y)) + 30;

          return (
            <rect
              key={`group-${root.id}`}
              x={minX}
              y={rootPos.y + rootSize.h / 2 + 4}
              width={maxX - minX}
              height={maxY - minY + 10}
              rx={8}
              fill="#1e293b"
              stroke="#475569"
              strokeWidth="1"
              strokeDasharray="4,2"
              opacity={0.6}
            />
          );
        })}

        {graph.edges.map((edge, i) => {
          const fromPos = positions[edge.from];
          const toPos = positions[edge.to];
          if (!fromPos || !toPos) return null;

          const isLoop = edge.label === "循环" || edge.label === "迭代";

          if (isLoop) {
            const loopX = Math.max(fromPos.x, toPos.x) + 100;
            const path = `M ${fromPos.x + 60} ${fromPos.y} C ${loopX + 40} ${fromPos.y}, ${loopX + 40} ${toPos.y}, ${toPos.x + 60} ${toPos.y}`;
            return (
              <g key={i}>
                <path d={path} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4,2" markerEnd="url(#arrowhead-loop)" />
                {edge.label && (
                  <text x={loopX + 30} y={(fromPos.y + toPos.y) / 2} fill="#f59e0b" fontSize="10" textAnchor="middle">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          }

          const fromNode = graph.nodes.find((n) => n.id === edge.from);
          const toNode = graph.nodes.find((n) => n.id === edge.to);
          const fromSize = fromNode ? (NODE_SIZES[fromNode.type] || NODE_SIZES.agent) : NODE_SIZES.agent;
          const toSize = toNode ? (NODE_SIZES[toNode.type] || NODE_SIZES.agent) : NODE_SIZES.agent;

          const isChildEdge = fromNode?.parent || toNode?.parent;

          return (
            <g key={i}>
              <line
                x1={fromPos.x}
                y1={fromPos.y + fromSize.h / 2}
                x2={toPos.x}
                y2={toPos.y - toSize.h / 2}
                stroke={isChildEdge ? "#64748b" : "#94a3b8"}
                strokeWidth={isChildEdge ? 1.5 : 2}
                markerEnd="url(#arrowhead)"
              />
              {edge.label && !isLoop && (
                <text
                  x={(fromPos.x + toPos.x) / 2 + 10}
                  y={(fromPos.y + toPos.y) / 2}
                  fill="#94a3b8"
                  fontSize="10"
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {graph.nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;

          const color = NODE_COLORS[node.type] || "#6b7280";
          const icon = NODE_ICONS[node.type] || "📦";
          const size = NODE_SIZES[node.type] || NODE_SIZES.agent;
          const isChild = !!node.parent;

          return (
            <g key={node.id}>
              <rect
                x={pos.x - size.w / 2}
                y={pos.y - size.h / 2}
                width={size.w}
                height={size.h}
                rx={isChild ? 6 : 10}
                fill={color + (node.type === "llm" ? "35" : "20")}
                stroke={color}
                strokeWidth={node.type === "llm" ? 2.5 : isChild ? 1.5 : 2}
              />
              <text
                x={pos.x}
                y={pos.y + (isChild ? 5 : 5)}
                fill="white"
                fontSize={isChild ? 11 : 14}
                fontWeight={isChild ? 500 : 600}
                textAnchor="middle"
              >
                {icon} {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }, [graph, layout, hierarchy]);

  const typeLabel = type === "workflow" ? "工作流" : type === "agent" ? "Agent" : "执行模式";

  return (
    <div className="fixed inset-0 bg-[var(--scrim-heavy)] flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[var(--bg-hover)] rounded-xl shadow-2xl w-[780px] max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-lg font-semibold text-white">
            {typeLabel}流程图 — {graph?.display_name || graph?.name || name}
          </h3>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-white text-xl">✕</button>
        </div>

        <div className="p-6">
          {loading && <div className="text-center text-[var(--muted)] py-8">加载中...</div>}
          {error && <div className="text-center text-[var(--danger)] py-8">加载失败: {error}</div>}
          {!loading && !error && graph && (
            <>
              {graph.description && (
                <p className="text-[var(--muted)] text-sm mb-3">{graph.description}</p>
              )}
              {graph.default_mode && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[var(--muted)] text-sm">默认模式:</span>
                  <span className="px-2 py-0.5 bg-[color-mix(in_srgb,var(--cafe-accent)_20%,transparent)] text-[var(--cafe-accent)] rounded text-xs font-medium">
                    {graph.mode_display_name || graph.default_mode}
                  </span>
                  {graph.mode_description && (
                    <span className="text-[var(--muted)] text-xs">— {graph.mode_description}</span>
                  )}
                </div>
              )}
              {graph.capabilities && graph.capabilities.length > 0 && (
                <div className="flex gap-2 mb-4">
                  {graph.capabilities.map((c) => (
                    <span key={c} className="px-2 py-1 bg-[color-mix(in_srgb,var(--cafe-accent)_20%,transparent)] text-[var(--cafe-accent)] rounded text-xs">{c}</span>
                  ))}
                </div>
              )}
              {renderGraph()}
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                <span>🤖 Agent</span>
                <span>🧠 LLM</span>
                <span>🔧 Tool</span>
                <span>📊 Result</span>
                <span>👁️ Review</span>
                <span>⚡ Mode</span>
                <span className="text-[var(--semantic-warning)]">- - → 循环/迭代</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

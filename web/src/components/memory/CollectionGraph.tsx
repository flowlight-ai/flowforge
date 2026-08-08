"use client";

/**
 * CollectionGraph — 记忆图谱可视化
 *
 * 以简化 SVG 展示集合间的关联（节点=集合，边=共享锚点）。
 * 移植自 clowder-ai CollectionGraph，去掉 d3 依赖，使用内联 SVG。
 *
 * API：GET /api/v1/memory/graph
 */

import { useCallback, useEffect, useMemo, useState } from "react";

interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly kind: string;
}

interface GraphEdge {
  readonly source: string;
  readonly target: string;
  readonly strength: number;
}

interface GraphData {
  readonly nodes: GraphNode[];
  readonly edges: GraphEdge[];
}

const KIND_COLOR: Record<string, string> = {
  knowledge: "var(--accent)",
  skill: "var(--ok)",
  persona: "var(--info)",
  memory: "var(--warn)",
  default: "var(--muted)",
};

export function CollectionGraph() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/memory/graph");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as GraphData;
      setData({ nodes: json.nodes ?? [], edges: json.edges ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const layout = useMemo(() => computeLayout(data.nodes, data.edges), [data]);

  const selectedNode = selected ? data.nodes.find((n) => n.id === selected) : null;
  const relatedEdges = selected
    ? data.edges.filter((e) => e.source === selected || e.target === selected)
    : [];

  return (
    <div className="card" data-memory="graph">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <h2 className="page-title" style={{ margin: 0 }}>记忆图谱</h2>
        <button onClick={() => void load()} style={refreshBtnStyle}>刷新</button>
      </div>
      <p className="page-sub" style={{ marginBottom: "12px" }}>
        集合关联可视化 · {data.nodes.length} 节点 · {data.edges.length} 边
      </p>

      {error && (
        <div style={errorBoxStyle}>
          <span>加载失败：{error}</span>
          <button onClick={() => void load()} style={retryBtnStyle}>重试</button>
        </div>
      )}

      {loading ? (
        <div style={loadingStyle}>加载中...</div>
      ) : data.nodes.length === 0 ? (
        <div style={emptyStyle}>
          <div style={{ fontSize: "24px", marginBottom: "8px" }}>⬡</div>
          暂无图谱数据
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "16px" }}>
          <div
            data-memory="graph-canvas"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "12px",
              minHeight: "420px",
            }}
          >
            <svg viewBox="0 0 600 420" style={{ width: "100%", height: "100%" }}>
              {data.edges.map((edge, idx) => {
                const s = layout.positions.get(edge.source);
                const t = layout.positions.get(edge.target);
                if (!s || !t) return null;
                return (
                  <line
                    key={`edge-${idx}`}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke="var(--border-strong)"
                    strokeWidth={Math.max(0.5, Math.min(3, edge.strength))}
                    opacity={selected && (edge.source === selected || edge.target === selected) ? 0.9 : 0.3}
                  />
                );
              })}
              {data.nodes.map((node) => {
                const pos = layout.positions.get(node.id);
                if (!pos) return null;
                const color = KIND_COLOR[node.kind] ?? KIND_COLOR.default;
                const isSelected = selected === node.id;
                const r = 8 + Math.min(20, node.weight);
                return (
                  <g
                    key={node.id}
                    data-memory-node={node.id}
                    onClick={() => setSelected(isSelected ? null : node.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={r}
                      fill={color}
                      opacity={isSelected ? 1 : 0.75}
                      stroke={isSelected ? "var(--accent)" : "transparent"}
                      strokeWidth={isSelected ? 3 : 0}
                    />
                    <text
                      x={pos.x}
                      y={pos.y + r + 12}
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--muted)"
                    >
                      {node.label.length > 12 ? node.label.slice(0, 11) + "…" : node.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <aside
            data-memory="graph-detail"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "12px",
              fontSize: "12px",
            }}
          >
            {selectedNode ? (
              <>
                <div style={{ color: "var(--muted)", fontWeight: 700, marginBottom: "4px" }}>选中节点</div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--accent)", marginBottom: "8px" }}>
                  {selectedNode.label}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", color: "var(--muted)" }}>
                  <span>类型：<span className="pill">{selectedNode.kind}</span></span>
                  <span>权重：{selectedNode.weight}</span>
                  <span>关联边：{relatedEdges.length}</span>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  style={{ ...refreshBtnStyle, marginTop: "10px", fontSize: "12px" }}
                >
                  清除选择
                </button>
              </>
            ) : (
              <div style={{ color: "var(--muted)" }}>
                点击节点查看详情
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

interface NodePosition { x: number; y: number; }

function computeLayout(nodes: GraphNode[], _edges: GraphEdge[]): { positions: Map<string, NodePosition> } {
  const positions = new Map<string, NodePosition>();
  const cx = 300;
  const cy = 210;
  const radius = Math.min(160, 40 + nodes.length * 8);
  nodes.forEach((node, idx) => {
    if (nodes.length === 1) {
      positions.set(node.id, { x: cx, y: cy });
      return;
    }
    const angle = (idx / nodes.length) * Math.PI * 2;
    positions.set(node.id, {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  });
  return { positions };
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
  marginTop: "12px",
  padding: "10px 16px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger-subtle)",
  color: "var(--danger)",
  fontSize: "13px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
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

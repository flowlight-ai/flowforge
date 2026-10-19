"use client";

/**
 * GraphPanel — 代码知识图谱 3D 可视化面板（前端接入 glue）[T6.4 后置]
 *
 * 以「装配好的端口」注入：宿主先把 @flowforge/graph-ui 的 createGraphUi（CodebaseGraphInjector
 * + MemoryGraphDataPort 数据 seam）与真实 createThreeRenderer（three 绑定渲染 seam）装配成一个
 * GraphUiPort，再交给本组件做 DOM 生命周期胶水（ref 挂载 / 卸载 dispose / 错误与状态呈现）。
 *
 * 本组件不 import three，也不 import @flowforge/graph-ui 运行时——保持依赖零侵入、可测
 * （注入桩 port 即可）。真正的 three + graph-ui + 路由接线留待 web 构建链路验证后的接入批次。
 *
 * 默认关闭：仅当 enabled && port 提供时才挂载，避免默认加载 heavy GPU 页面。
 *
 * 中文对照：图谱面板 / 装配端口 / DOM 胶水
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** 归一化 RendererPort 结构（与 graph-ui render/ports 对齐，避免运行时依赖）。 */
export interface PanelRendererPort {
  readonly renderGraph: (data: unknown, layout: unknown) => void;
  readonly onNodeSelect?: (cb: (node: unknown) => void) => void;
  readonly dispose: () => void;
}

/** 宿主装配好的图谱端口：挂载时回调返回渲染 seam，卸载时清理。 */
export interface GraphUiPort {
  /** 取数 + 布局 + 渲染，返回实际用到的渲染 seam（供卸载时 dispose）。 */
  readonly load: () => Promise<{ nodeCount: number; renderer: PanelRendererPort | null }>;
}

export interface GraphPanelProps {
  /** 默认关闭：路由显式启用（?project=<id>）且宿主给到 port 时才挂载。 */
  readonly enabled: boolean;
  readonly project: string;
  readonly port?: GraphUiPort;
}

export function GraphPanel({ enabled, project, port }: GraphPanelProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<PanelRendererPort | null>(null);
  const [ready, setReady] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const active = enabled && !!port;

  const load = useCallback(async () => {
    if (!port) return;
    setReady(false);
    setError(null);
    try {
      const { nodeCount: count, renderer } = await port.load();
      rendererRef.current = renderer;
      setNodeCount(count);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [port]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  // 卸载清理：dispose 渲染 seam，防 three scene/监听泄漏。
  useEffect(() => {
    return () => rendererRef.current?.dispose();
  }, []);

  if (!active) {
    return (
      <div
        data-graph-panel="disabled"
        style={{
          minHeight: 320,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
        }}
      >
        图谱面板默认关闭，请携带 ?project=&lt;id&gt; 并启用图可视化。
      </div>
    );
  }

  return (
    <div data-graph-panel="active" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }} className="page-title">
          代码知识图谱 · {project}
        </h2>
        <span className="pill" style={{ color: "var(--muted)" }}>
          {ready ? `${nodeCount} 节点` : "渲染中…"}
        </span>
      </div>
      {error && (
        <div
          style={{
            padding: "12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--danger-subtle)",
            color: "var(--danger)",
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          加载失败：{error}
        </div>
      )}
      <div
        ref={hostRef}
        data-graph-panel="canvas"
        style={{
          position: "relative",
          width: "100%",
          minHeight: "60vh",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      />
    </div>
  );
}
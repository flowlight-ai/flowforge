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

import { displayText, labelToCn, lineRangeText } from "./label-cn";

/** 归一化 RendererPort 结构（与 graph-ui render/ports 对齐，避免运行时依赖）。 */
export interface PanelRendererPort {
  readonly renderGraph: (data: unknown, layout: unknown) => void;
  readonly onNodeSelect?: (cb: (node: unknown) => void) => void;
  readonly dispose: () => void;
}

/**
 * 选中节点详情（web 消费端结构类型，零 graph-ui 运行时依赖）。
 * 字段与 graph-ui GraphNode 对齐（id/label/name/shortName/filePath/startLine/endLine），
 * 用 unknown 宽泛承接，展示所需信息全部来自命中节点自身，无需额外取数。
 */
export interface NodeDetail {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly name?: unknown;
  readonly shortName?: unknown;
  readonly filePath?: unknown;
  readonly startLine?: unknown;
  readonly endLine?: unknown;
}

/** 详情信息项定义：key 为展示文案，取 NodeDetail 中对应字段。 */
const DETAIL_FIELDS: ReadonlyArray<{ label: string; pick: (n: NodeDetail) => unknown }> = [
  { label: "名称", pick: (n) => n.name },
  { label: "类型", pick: (n) => labelToCn(n.label) },
  { label: "简单名", pick: (n) => n.shortName },
  { label: "文件路径", pick: (n) => n.filePath },
  { label: "行范围", pick: (n) => lineRangeText(n.startLine, n.endLine) ?? "—" },
];

/** 详情侧栏：展示选中节点结构化信息，支持关闭清空选中。 */
function DetailPanel({ node, onClose }: { node: NodeDetail; onClose: () => void }) {
  return (
    <div
      data-graph-detail="panel"
      style={{
        flex: "none",
        width: 280,
        marginLeft: 8,
        padding: "12px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
        background: "var(--bg)",
        overflowY: "auto",
        maxHeight: "60vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>选中节点</h3>
        <button
          data-graph-detail="close"
          onClick={onClose}
          aria-label="关闭详情"
          style={{
            border: "none",
            background: "transparent",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {DETAIL_FIELDS.map(({ label, pick }) => {
          const value = displayText(pick(node));
          return (
            <div key={label} style={{ fontSize: 13 }}>
              <dt style={{ color: "var(--muted)", margin: 0, fontSize: 12 }}>{label}</dt>
              <dd
                style={{
                  margin: 0,
                  wordBreak: "break-all",
                  color: "var(--text)",
                  fontFamily: value === "—" ? undefined : "var(--font-mono, monospace)",
                }}
              >
                {value}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** 宿主装配好的图谱端口：挂载时回调返回渲染 seam，卸载时清理。 */
export interface GraphUiPort {
  /** 取数 + 布局 + 渲染，返回实际用到的渲染 seam（供卸载时 dispose）。 */
  readonly load: (host: HTMLDivElement) => Promise<{ nodeCount: number; renderer: PanelRendererPort | null }>;
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
  const [selected, setSelected] = useState<NodeDetail | null>(null);

  const active = enabled && !!port;

  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    if (!port) return;
    const seq = ++loadSeqRef.current;
    setReady(false);
    setError(null);
    setSelected(null);
    const host = hostRef.current;
    if (!host) return;
    // 每次装载使用独立容器：过期装载可整块移除，不污染新画布。
    while (host.firstChild) host.removeChild(host.firstChild);
    const slot = document.createElement("div");
    slot.style.cssText = "width:100%;height:100%";
    host.appendChild(slot);
    try {
      const { nodeCount: count, renderer } = await port.load(slot);
      if (seq !== loadSeqRef.current) {
        renderer?.dispose();
        slot.remove();
        return;
      }
      rendererRef.current = renderer;
      // renderer 就绪后订阅节点命中回调，命中 realNode 置为选中态驱动详情侧栏（EP-CB9）。
      renderer?.onNodeSelect?.((node) => setSelected(node as NodeDetail));
      setNodeCount(count);
      setReady(true);
    } catch (e) {
      if (seq !== loadSeqRef.current) {
        slot.remove();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [port]);

  useEffect(() => {
    if (!active) return;
    // 端口/工程切换：load 内先释放旧渲染（dispose）并清空旧容器。
    rendererRef.current?.dispose();
    rendererRef.current = null;
    void load();
    // 卸载/重载时使在途装载过期，避免 StrictMode 双挂载叠加 canvas。
    return () => {
      loadSeqRef.current += 1;
    };
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
      <div style={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}>
        <div
          ref={hostRef}
          data-graph-panel="canvas"
          style={{
            position: "relative",
            flex: "1 1 auto",
            minWidth: 0,
            minHeight: "60vh",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
          }}
        />
        {selected && <DetailPanel node={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
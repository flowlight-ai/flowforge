"use client";

/**
 * CodebaseGraphView — 宿主装配组件（web 端三渲染闭环，EP-CB6 Web 渲染）。
 *
 * 职责：把三端 seam 装配成一个 GraphPanel 可消费的 GraphUiPort——
 *   1. 懒加载真实 three 命名空间 → 组装 ThreeBinding；
 *   2. CodebaseGraphInjector(seedCodebaseRead) → createGraphUi 得数据 seam；
 *   3. 结构层 layoutStructureTree + 符号层 layoutSymbolForce；
 *   4. createThreeRenderer(canvas, binding) 渲染合并图谱。
 * 渲染画布挂在 GraphPanel 传入的宿主 div 内；卸载时由 GraphPanel dispose 渲染 seam。
 *
 * three 走动态 import（本文件内，非模块顶层），配合路由页 ssr:false，保证 three
 * 不在服务端求值。本组件零外部运行时耦合，仅依赖已发布 seam 包。
 *
 * 中文对照：宿主装配视图 / 三端接线
 * @module @flowforge/web-frontend/components/codebase/CodebaseGraphView
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { GraphData, GraphEdge, GraphNode, LayoutResult, ThreeBinding } from "@flowforge/graph-ui";
import {
  CodebaseGraphInjector,
  createGraphUi,
  createThreeRenderer,
  layoutStructureTree,
  layoutSymbolForce,
} from "@flowforge/graph-ui";

import { GraphPanel } from "@/components/graph/GraphPanel";
import type { GraphUiPort, PanelRendererPort } from "@/components/graph/GraphPanel";

import type { CodebaseGraphRead } from "@flowforge/graph-ui";
import { seedCodebaseRead, SEED_PROJECT } from "./codebase-seed";
import { listHttpProjects, loadHttpCodebaseRead, type HttpProjectInfo } from "./http-codebase-read";

/** 合并两个数据层为一幅图谱（节点/边去重）。 */
function mergeGraphData(struct: GraphData, symbol: GraphData): GraphData {
  const byId = new Map<string, GraphNode>(struct.nodes.map((n) => [n.id, n]));
  const nodes: GraphNode[] = [...struct.nodes];
  for (const n of symbol.nodes) {
    if (byId.has(n.id)) continue;
    byId.set(n.id, n);
    nodes.push(n);
  }
  const edgeKeys = new Set(struct.edges.map((e) => `${e.source}|${e.type}|${e.target}`));
  const edges: GraphEdge[] = [...struct.edges];
  for (const e of symbol.edges) {
    const k = `${e.source}|${e.type}|${e.target}`;
    if (edgeKeys.has(k)) continue;
    edgeKeys.add(k);
    edges.push(e);
  }
  return {
    nodes,
    edges,
    meta: { totalNodes: nodes.length, totalEdges: edges.length, projectId: struct.meta.projectId },
  };
}

/** 合并结构/符号两层布局坐标与包围盒。 */
function mergeLayout(struct: LayoutResult, symbol: LayoutResult): LayoutResult {
  return {
    positions: [...struct.positions, ...symbol.positions],
    bounds: {
      minX: Math.min(struct.bounds.minX, symbol.bounds.minX),
      minY: Math.min(struct.bounds.minY, symbol.bounds.minY),
      maxX: Math.max(struct.bounds.maxX, symbol.bounds.maxX),
      maxY: Math.max(struct.bounds.maxY, symbol.bounds.maxY),
      depth: Math.max(struct.bounds.depth ?? 0, symbol.bounds.depth ?? 0),
    },
  };
}

/**
 * 组装 GraphUiPort：挂载后被 GraphPanel 回调，负责把节点/边画进宿主画布。
 * 数据源优先真实 codebase.db（http 端口），失败回落内置 seed（优雅降级）。
 */
function buildPort(project: string): GraphUiPort {
  return {
    async load(host) {
      // 0 位：解析数据端口——真实库优先，缺库/失败回落确定性 seed（回落时工程键取 SEED_PROJECT）。
      const httpRead: CodebaseGraphRead | null = await loadHttpCodebaseRead(project);
      const read: CodebaseGraphRead = httpRead ?? seedCodebaseRead;
      const graphProject = httpRead ? project : SEED_PROJECT;

      // 1+4 位：懒加载 three，创建画布并塞入宿主，装配渲染 seam。
      const ins = document.createElement("canvas");
      ins.style.cssText = "width:100%;height:100%;display:block;";
      host.appendChild(ins);

      const ns = await import("three");
      // 真实 three 构造签名为泛型，与 graph-ui 极窄 ThreeBinding 面（宽松签名）非严格可赋值，
      // 在此 cast 收敛（web 消费端适配，不改 graph-ui 契约）。
      const binding: ThreeBinding = {
        Scene: ns.Scene,
        PerspectiveCamera: ns.PerspectiveCamera,
        WebGLRenderer: ns.WebGLRenderer,
        Color: ns.Color,
        Group: ns.Group,
        Mesh: ns.Mesh,
        SphereGeometry: ns.SphereGeometry,
        MeshBasicMaterial: ns.MeshBasicMaterial,
        Line: ns.Line,
        BufferGeometry: ns.BufferGeometry,
        BufferAttribute: ns.BufferAttribute,
        LineBasicMaterial: ns.LineBasicMaterial,
        Vector2: ns.Vector2,
        Raycaster: ns.Raycaster,
      } as unknown as ThreeBinding;
      // 保留严格 RendererPort（供本组件 renderGraph/onNodeSelect 正常调用）；
      // GraphPanel 仅做 DOM 胶水（dispose），返回时 cast 到宽松 PanelRendererPort 即可。
      const renderer = createThreeRenderer(ins, binding);

      // 2 位：注入数据端口 → createGraphUi。
      const injector = new CodebaseGraphInjector(read);
      const ui = createGraphUi({ injector });

      // 3 位：结构层树布局 + 符号层力导向布局，再合并为单一图谱/布局渲染。
      const struct = await ui.data.loadStructureTree(graphProject);
      const structLayout = layoutStructureTree(struct);
      const symbol = await ui.data.loadSymbolGraph(graphProject);
      const symbolLayout = layoutSymbolForce(symbol, {
        width: 900,
        height: 700,
        depth: 500,
        center: [450, 350, 250],
      });

      const merged = mergeGraphData(struct, symbol);
      renderer.renderGraph(merged, mergeLayout(structLayout, symbolLayout));
      // 节点命中回调（EP-CB8 raycast 拾取）交由 GraphPanel 订阅（EP-CB9 详情侧栏），
      // 本组件不再自行消费占位日志，避免双责任；renderer 装配时保留 onNodeSelect seam，
      // 命中 realNode 由 GraphPanel 宿主统一呈现详情（真实库或 seed 降级）。

      return { nodeCount: merged.nodes.length, renderer: renderer as unknown as PanelRendererPort };
    },
  };
}

/**
 * 默认关闭：?enabled=1 才挂载 heavy GPU 页面；?project=<id> 指定初始工程。
 * 挂载后拉取已索引工程列表渲染下拉；切换工程重建 port → GraphPanel 自动重装配。
 */
export default function CodebaseGraphView() {
  const params = useSearchParams();
  const enabled = params.get("enabled") === "1";
  const initialProject = params.get("project") || SEED_PROJECT;

  const [project, setProject] = useState<string>(initialProject);
  const [projects, setProjects] = useState<readonly HttpProjectInfo[]>([]);

  // 一次性拉取工程列表（供下拉；失败留空，仅保留当前工程选项）。
  useEffect(() => {
    void listHttpProjects().then((list) => {
      if (list) setProjects(list);
    });
  }, []);

  // 下拉选项：http 工程 ∪ 当前工程（当前工程不在列表时仍可选中，如 seed 回退键）。
  const options = useMemo(() => {
    const names = new Set(projects.map((p) => p.name));
    if (!names.has(project)) {
      return [{ name: project, createdAt: "", filesIndexed: undefined, lastIndexedAt: undefined }, ...projects];
    }
    return [...projects];
  }, [projects, project]);

  const port = useMemo(() => buildPort(project), [project]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label
        style={{
          display: enabled ? "flex" : "none",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--muted)",
        }}
      >
        <span>工程</span>
        <select
          data-project-select
          value={project}
          onChange={(e) => setProject(e.target.value)}
          disabled={options.length <= 1}
          style={{
            padding: "4px 8px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
          }}
        >
          {options.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
              {p.filesIndexed != null ? `（${p.filesIndexed} 文件）` : ""}
            </option>
          ))}
        </select>
      </label>
      <GraphPanel enabled={enabled} project={project} port={port} />
    </div>
  );
}
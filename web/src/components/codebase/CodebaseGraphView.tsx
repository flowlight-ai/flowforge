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

import { useMemo } from "react";
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
import type { GraphUiPort } from "@/components/graph/GraphPanel";

import { seedCodebaseRead, SEED_PROJECT } from "./codebase-seed";

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
      depth: Math.max(struct.bounds.depth, symbol.bounds.depth),
    },
  };
}

/**
 * 组装 GraphUiPort：挂载后被 GraphPanel 回调，负责把节点/边画进宿主画布。
 */
function buildPort(): GraphUiPort {
  return {
    async load(host) {
      // 1+4 位：懒加载 three，创建画布并塞入宿主，装配渲染 seam。
      const ins = document.createElement("canvas");
      ins.style.cssText = "width:100%;height:100%;display:block;";
      host.appendChild(ins);

      const ns = await import("three");
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
      };
      const renderer = createThreeRenderer(ins, binding);

      // 2 位：注入 seed 数据 → createGraphUi。
      const injector = new CodebaseGraphInjector(seedCodebaseRead);
      const ui = createGraphUi({ injector });

      // 3 位：结构层树布局 + 符号层力导向布局，再合并为单一图谱/布局渲染。
      const struct = await ui.data.loadStructureTree(SEED_PROJECT);
      const structLayout = layoutStructureTree(struct);
      const symbol = await ui.data.loadSymbolGraph(SEED_PROJECT);
      const symbolLayout = layoutSymbolForce(symbol, {
        width: 900,
        height: 700,
        depth: 500,
        center: [450, 350, 250],
      });

      const merged = mergeGraphData(struct, symbol);
      renderer.renderGraph(merged, mergeLayout(structLayout, symbolLayout));
      renderer.onNodeSelect((n) => {
        // 选中回调先接占位日志；面板展示选中详情留待后续交互批次。
        console.debug("[graph] node selected", n.id, n.name);
      });

      return { nodeCount: merged.nodes.length, renderer };
    },
  };
}

/** 默认关闭：?enabled=1 才挂载 heavy GPU 页面；?project=<id> 指定工程。 */
export default function CodebaseGraphView() {
  const params = useSearchParams();
  const enabled = params.get("enabled") === "1";
  const project = params.get("project") || SEED_PROJECT;
  const port = useMemo(() => buildPort(), []);
  return <GraphPanel enabled={enabled} project={project} port={port} />;
}
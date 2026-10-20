"use client";

/**
 * codebase-seed — 内置 seed GraphData 端口（web 端三渲染接入一阶段，EP-CB6 Web 渲染闭环）。
 *
 * 目的：在「真实 codebase.db → web」数据时序立项前，先用一棵确定性小图验证
 * three + @flowforge/graph-ui 的「数据端口 + 布局 + 渲染」完整闭环。数据纯内存常量，
 * 走 CodebaseGraphRead 结构式只读端口（nodesOf/edgesOf/anchorOf），由 CodebaseGraphInjector
 * 归一化后喂给 MemoryGraphDataPort。本模块不 import codebase / three，无副作用。
 *
 * 图结构（结构层 Project→Folder→File + 符号层 Function/Class）：
 *   proj:demo ─CONTAINS_FOLDER→ folder:src ─CONTAINS_FILE→ file:src/store.ts / file:src/main.ts
 *   fn:main.bootstrap ─CALLS→ fn:store.upsert ─USAGE→ cls:store.CodebaseStore
 *
 * 中文对照：内置种子图谱数据端口
 * @module @flowforge/web-frontend/components/codebase/codebase-seed
 */

import type { CodebaseEdgeRow, CodebaseGraphRead, CodebaseNodeRow } from "@flowforge/graph-ui";
import type { GraphAnchor } from "@flowforge/graph-ui";

/** 种子工程名（路由 ?project= 缺省值）。 */
export const SEED_PROJECT = "demo" as const;

/** 结构层 + 符号层节点（CodebaseNodeRow 形状）。 */
export const SEED_NODES: readonly CodebaseNodeRow[] = [
  { id: "proj:demo", label: "Project", name: "demo" },
  { id: "folder:src", label: "Folder", name: "src" },
  { id: "file:store", label: "File", name: "store.ts", filePath: "src/store.ts" },
  { id: "file:main", label: "File", name: "main.ts", filePath: "src/main.ts" },
  { id: "fn:store.upsert", label: "Function", name: "upsert", filePath: "src/store.ts", lines: 10 },
  { id: "cls:store.CodebaseStore", label: "Class", name: "CodebaseStore", filePath: "src/store.ts", lines: 50 },
  { id: "fn:main.bootstrap", label: "Function", name: "main", filePath: "src/main.ts", lines: 5 },
];

/** 结构层（容器 CONTAINS_*）+ 符号层（CALLS/USAGE）边（CodebaseEdgeRow 形状）。 */
export const SEED_EDGES: readonly CodebaseEdgeRow[] = [
  { source: "proj:demo", target: "folder:src", type: "CONTAINS_FOLDER" },
  { source: "folder:src", target: "file:store", type: "CONTAINS_FILE" },
  { source: "folder:src", target: "file:main", type: "CONTAINS_FILE" },
  { source: "fn:main.bootstrap", target: "fn:store.upsert", type: "CALLS" },
  { source: "fn:store.upsert", target: "cls:store.CodebaseStore", type: "USAGE" },
];

/** 节点定义锚点（web 层按 id O(1) 索引，等价真实 codebase 的节点路径索引）。 */
const SEED_ANCHORS: ReadonlyMap<string, GraphAnchor> = new Map(
  SEED_NODES.map((n) => [
    n.id,
    {
      nodeId: n.id,
      ...(n.filePath === undefined ? {} : { filePath: n.filePath }),
      ...(n.lines === undefined ? {} : { startLine: n.lines }),
      ...(n.lines === undefined ? {} : { endLine: n.lines }),
    },
  ]),
);

/**
 * codebase 只读端口实现：nodesOf/edgesOf 返回种子常量，anchorOf 走 Map O(1) 查询。
 */
export const seedCodebaseRead: CodebaseGraphRead = {
  nodesOf(project: string): readonly CodebaseNodeRow[] {
    return project === SEED_PROJECT ? SEED_NODES : [];
  },
  edgesOf(project: string): readonly CodebaseEdgeRow[] {
    return project === SEED_PROJECT ? SEED_EDGES : [];
  },
  anchorOf(nodeId: string): GraphAnchor | null {
    return SEED_ANCHORS.get(nodeId) ?? null;
  },
};
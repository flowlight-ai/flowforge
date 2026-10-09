/**
 * @flowforge/graph-ui — CodebaseGraphInjector（真实 codebase 只读注入器, EP-CB6 T6.2）。
 *
 * 把 @flowforge/plugin-codebase 的只读查询面喂给 graph-ui 的 GraphDataInjector 注入凸面。
 * 通过极窄的结构式端口 CodebaseGraphRead 解耦：本模块不 import codebase（graph-ui 保持
 * 零依赖），web 层只需把真实 CodebaseStore 的 allNodes/allEdges 原语按形状传入即可接通。
 *
 * 职责（纯变换，无副作用、无 DB 写）：
 * - loadStructureNodes / loadSymbolNodes：按结构/符号标签词表切分节点。
 * - loadEdges       ：按边类型归类（结构边/符号边）。
 * - resolveAnchor   ：从节点定义字段生成定义锚点。
 * - projectLabel    ：把一条边投影为 structure/symbol 归属（决定树/图布局角色）。
 *
 * 中文对照：codebase 只读注入器 / 结构式读端口
 * @module @flowforge/graph-ui/data/codebase-injector
 */

import {
  GRAPH_SYMBOL_LABELS,
  GRAPH_STRUCTURAL_LABELS,
  classifyEdgeKind,
  isGraphEdgeType,
  isGraphNodeLabel,
} from '../contacts/graph-data.ts'
import type {
  EdgeKind,
  GraphAnchor,
  GraphEdge,
  GraphNode,
  GraphNodeLabel,
} from '../contacts/graph-data.ts'
import type { GraphDataInjector } from './ports.ts'

/** plugin-codebase 只读节点形状（结构式，避免反向 import）。 */
export interface CodebaseNodeRow {
  readonly id: string
  readonly label: string
  readonly name: string
  readonly filePath?: string
  readonly lines?: number
}

/** plugin-codebase 只读边形状（结构式）。 */
export interface CodebaseEdgeRow {
  readonly source: string
  readonly target: string
  readonly type: string
}

/**
 * codebase 只读查询端口：web 层据真实 CodebaseStore 的 allNodes/edgesOf 原语实现。
 * 仅暴露纯读取，graph-ui 不写 DB、不重写索引。
 */
export interface CodebaseGraphRead {
  /** 某工程全部节点（含结构/符号两层）。 */
  readonly nodesOf: (project: string) => readonly CodebaseNodeRow[]
  /** 某工程全部边。 */
  readonly edgesOf: (project: string) => readonly CodebaseEdgeRow[]
  /** 按节点 id 解析定义锚点（web 层用 codebase 的节点路径索引实现 O(1) 查询）。 */
  readonly anchorOf: (nodeId: string) => GraphAnchor | null
}

/** 归一化读取端口 → GraphDataInjector 注入凸面的实现。 */
export class CodebaseGraphInjector implements GraphDataInjector {
  constructor(private readonly source: CodebaseGraphRead) {}

  private projectNodes(project: string, wanted: readonly GraphNodeLabel[]): readonly GraphNode[] {
    const wantedSet = new Set<string>(wanted)
    return this.source
      .nodesOf(project)
      .filter((row) => isGraphNodeLabel(row.label) && wantedSet.has(row.label))
      .map((row) => this.toGraphNode(row))
  }

  loadStructureNodes(project: string): readonly GraphNode[] {
    return this.projectNodes(project, GRAPH_STRUCTURAL_LABELS)
  }

  loadSymbolNodes(project: string): readonly GraphNode[] {
    return this.projectNodes(project, GRAPH_SYMBOL_LABELS)
  }

  loadEdges(project: string): readonly GraphEdge[] {
    return this.source
      .edgesOf(project)
      .filter((row) => isGraphEdgeType(row.type))
      .map((row) => ({ source: row.source, target: row.target, type: row.type } as GraphEdge))
  }

  resolveAnchor(nodeId: string): GraphAnchor | null {
    return this.source.anchorOf(nodeId)
  }

  projectLabel(_nodeId: string, edge: GraphEdge): EdgeKind | undefined {
    if (!isGraphEdgeType(edge.type)) return undefined
    return classifyEdgeKind(edge.type)
  }

  private toGraphNode(row: CodebaseNodeRow): GraphNode {
    return {
      id: row.id,
      label: row.label as GraphNodeLabel,
      name: row.name,
      ...(row.filePath === undefined ? {} : { filePath: row.filePath }),
      ...(row.lines === undefined ? {} : { startLine: row.lines }),
      ...(row.lines === undefined ? {} : { endLine: row.lines }),
    }
  }
}
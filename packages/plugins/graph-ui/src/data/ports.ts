/**
 * @flowforge/graph-ui — 只读数据 seam（data seam, EP-CB6 T6.2）。
 *
 * GraphDataPort 是可视化消费端读取归一化图谱数据的只读触点：
 * - loadStructureTree  结构层树（Project→Folder→File→Module）
 * - loadSymbolGraph    符号层图（Function/Method/Class/... + 符号边）
 * - loadAnchors        定义锚点（从节点定位源码定义）
 *
 * GraphDataInjector 是注入凸面：真实 @flowforge/plugin-codebase 适配器或测试内存桩
 * 实现这些最小原语即可喂数据，graph-ui 不反向依赖 codebase。
 *
 * 中文对照：数据源 seam / 注入器
 * @module @flowforge/graph-ui/data/ports
 */

import type {
  EdgeKind,
  GraphAnchor,
  GraphData,
  GraphEdge,
  GraphNode,
  GraphNodeLabel,
} from '../contacts/graph-data.ts'

/** loadStructureTree 选项：maxDepth 限制树的最大层级。 */
export interface LoadStructureOptions {
  readonly maxDepth?: number
}

/** loadSymbolGraph 选项：标签过滤 + 数量截断。 */
export interface LoadSymbolOptions {
  readonly labelFilter?: readonly GraphNodeLabel[]
  readonly limit?: number
}

/** 可视化消费端只读数据 seam。 */
export interface GraphDataPort {
  loadStructureTree(projectId: string, opts?: LoadStructureOptions): Promise<GraphData>
  loadSymbolGraph(projectId: string, opts?: LoadSymbolOptions): Promise<GraphData>
  loadAnchors(nodeId: string): Promise<GraphAnchor | null>
}

/**
 * 注入凸面：真实 codebase 适配器 / 测试桩实现的最小原语。
 * projectLabel 把某条边（相对某节点）投影为结构边/符号边归属（EdgeKind），
 * 决定其在树/图布局中的角色；无法判定时返回 undefined。
 */
export interface GraphDataInjector {
  loadStructureNodes(project: string): readonly GraphNode[]
  loadSymbolNodes(project: string): readonly GraphNode[]
  loadEdges(project: string): readonly GraphEdge[]
  resolveAnchor(nodeId: string): GraphAnchor | null
  projectLabel(nodeId: string, edge: GraphEdge): EdgeKind | undefined
}
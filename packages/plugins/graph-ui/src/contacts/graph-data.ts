/**
 * @flowforge/graph-ui — 数据契约层（data contract layer, EP-CB6 T6.2）。
 *
 * graph-ui 自有的归一化图谱触点类型，独立于 @flowforge/plugin-codebase（不反向
 * import 它）：NodeLabel/EdgeType 对齐 codebase graph-model 语义但为本地枚举，
 * 使渲染层与数据源解耦。GraphData 为纯数据触点（可 JSON 序列化），供测试快照与
 * 渲染消费。
 *
 * 中文对照（Web/正式文档双语文案）：
 * - GraphNode 节点 / GraphEdge 边 / GraphData 图谱数据 / GraphAnchor 定义锚点
 * @module @flowforge/graph-ui/contacts/graph-data
 */

/** graph-ui 归一化节点标签词表（对齐 codebase NODE_LABELS 的结构 + 符号子集）。 */
export const GRAPH_NODE_LABELS = [
  'Project',
  'Folder',
  'File',
  'Module',
  'Function',
  'Method',
  'Class',
  'Interface',
  'Enum',
  'Type',
  'Variable',
] as const

export type GraphNodeLabel = (typeof GRAPH_NODE_LABELS)[number]

/** 结构层标签（结构树的 Project/Folder/File/Module）。 */
export const GRAPH_STRUCTURAL_LABELS: readonly GraphNodeLabel[] = [
  'Project',
  'Folder',
  'File',
  'Module',
]

/** 符号层标签（Function/Method/Class/Interface/Enum/Type/Variable）。 */
export const GRAPH_SYMBOL_LABELS: readonly GraphNodeLabel[] = [
  'Function',
  'Method',
  'Class',
  'Interface',
  'Enum',
  'Type',
  'Variable',
]

/** 结构边：容器层级（CONTAINS_FOLDER/CONTAINS_FILE）与 IMPORTS。 */
export const GRAPH_STRUCTURAL_EDGE_TYPES = [
  'CONTAINS_FOLDER',
  'CONTAINS_FILE',
  'IMPORTS',
] as const

/** 符号边：关系/定义（CALLS/USAGE/INHERITS/IMPLEMENTS/DEFINES 等）。 */
export const GRAPH_SYMBOL_EDGE_TYPES = [
  'CALLS',
  'CALL_REFERENCE',
  'USAGE',
  'INHERITS',
  'IMPLEMENTS',
  'DEFINES',
  'DEFINES_METHOD',
] as const

/** graph-ui 归一化边类型词表。 */
export const GRAPH_EDGE_TYPES = [
  ...GRAPH_STRUCTURAL_EDGE_TYPES,
  ...GRAPH_SYMBOL_EDGE_TYPES,
] as const

export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number]

/**
 * 边归属类别：结构边（structure）或符号边（symbol）。
 * 注入 seam 用 projectLabel 把一条边投影到归属类别，决定其在树/图布局中的角色。
 */
export type EdgeKind = 'structure' | 'symbol'

/** 按边类型归类为 structure 或 symbol。 */
export function classifyEdgeKind(type: GraphEdgeType): EdgeKind {
  return (GRAPH_SYMBOL_EDGE_TYPES as readonly string[]).includes(type) ? 'symbol' : 'structure'
}

/** 归一化图节点。name 为限定名，shortName/startLine/endLine 为定义锚点。 */
export interface GraphNode {
  readonly id: string
  readonly label: GraphNodeLabel
  readonly name: string
  /** 定义锚点 - 简单名。 */
  readonly shortName?: string
  readonly startLine?: number
  readonly endLine?: number
  readonly filePath?: string
  readonly props?: Readonly<Record<string, unknown>>
}

/** 归一化图边。 */
export interface GraphEdge {
  readonly source: string
  readonly target: string
  readonly type: GraphEdgeType
}

/** 图谱数据元信息（计数 + 所属工程）。 */
export interface GraphDataMeta {
  readonly totalNodes: number
  readonly totalEdges: number
  readonly projectId?: string
}

/** 归一化图谱数据触点（纯数据，可 JSON 序列化）。 */
export interface GraphData {
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly meta: GraphDataMeta
}

/** 定义锚点：从节点定位到源码中的定义位置。 */
export interface GraphAnchor {
  readonly nodeId: string
  readonly shortName?: string
  readonly startLine?: number
  readonly endLine?: number
  readonly filePath?: string
}

/** 运行时类型守卫：是否为 graph-ui 归一化节点标签。 */
export function isGraphNodeLabel(value: string): value is GraphNodeLabel {
  return (GRAPH_NODE_LABELS as readonly string[]).includes(value)
}

/** 运行时类型守卫：是否为 graph-ui 归一化边类型。 */
export function isGraphEdgeType(value: string): value is GraphEdgeType {
  return (GRAPH_EDGE_TYPES as readonly string[]).includes(value)
}
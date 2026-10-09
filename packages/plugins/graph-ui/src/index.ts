/**
 * @flowforge/graph-ui — public export surface (EP-CB6 T6.2).
 *
 * 对齐 plugin-codebase index.ts 风格：值用 export { ... } from，类型用 export type。
 * 暴露数据契约层触点、只读数据 seam（ports/memory）、布局纯函数与渲染 seam。
 *
 * @module @flowforge/graph-ui
 */

export {
  GRAPH_NODE_LABELS,
  GRAPH_STRUCTURAL_LABELS,
  GRAPH_SYMBOL_LABELS,
  GRAPH_STRUCTURAL_EDGE_TYPES,
  GRAPH_SYMBOL_EDGE_TYPES,
  GRAPH_EDGE_TYPES,
  classifyEdgeKind,
  isGraphNodeLabel,
  isGraphEdgeType,
} from './contacts/graph-data.ts'
export type {
  GraphNodeLabel,
  GraphEdgeType,
  EdgeKind,
  GraphNode,
  GraphEdge,
  GraphDataMeta,
  GraphData,
  GraphAnchor,
} from './contacts/graph-data.ts'

export type {
  LoadStructureOptions,
  LoadSymbolOptions,
  GraphDataPort,
  GraphDataInjector,
} from './data/ports.ts'

export { MemoryGraphDataPort } from './data/memory.ts'

export type { Point3, NodePosition, LayoutBounds, LayoutResult } from './layout/types.ts'
export { layoutStructureTree } from './layout/structure.ts'
export type { LayoutStructureOptions } from './layout/structure.ts'
export { layoutSymbolForce } from './layout/force.ts'
export type { LayoutForceOptions } from './layout/force.ts'

export type { RendererPort, ThreeRendererUnits, ThreeBinding } from './render/ports.ts'
export { createThreeRenderer, ThreeForceGraphRenderer } from './render/three.ts'
export type { ThreeRendererOptions } from './render/three.ts'

export { createGraphUi } from './graph-ui.ts'
export type { CreateGraphUiOptions, GraphUi } from './graph-ui.ts'
/**
 * @flowforge/graph-ui — 布局共享类型（layout shared types, EP-CB6 T6.3）。
 *
 * 布局纯函数的共享坐标触点：Point3 / NodePosition / LayoutResult。
 * 布局为契约定点纯函数，坐标为 seam 注入式，可单测断言。
 *
 * 中文对照：三维坐标 / 节点坐标 / 布局结果
 * @module @flowforge/graph-ui/layout/types
 */

/** 三维坐标点。 */
export interface Point3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** 某个图节点的布局坐标。 */
export interface NodePosition {
  readonly nodeId: string
  readonly x: number
  readonly y: number
  readonly z: number
}

/** 布局结果的包围盒（depth 表示层深/纵深跨度）。 */
export interface LayoutBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly depth?: number
}

/** 布局纯函数输出：节点坐标集合 + 包围盒。 */
export interface LayoutResult {
  readonly positions: readonly NodePosition[]
  readonly bounds: LayoutBounds
}
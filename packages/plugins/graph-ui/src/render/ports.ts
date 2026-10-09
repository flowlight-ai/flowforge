/**
 * @flowforge/graph-ui — 渲染 seam（renderer seam, EP-CB6 T6.4）。
 *
 * RendererPort 是渲染注入式契约（renderGraph/onNodeSelect/dispose），React/DOM 胶水
 * 隔离，渲染层不依赖数据契约层内部实现。ThreeBinding 是极窄的三维命名空间类型面，
 * 由 web 层把真实 three 命名空间对象注入，graph-ui 本身不静态 import three。
 *
 * 中文对照：渲染 seam / 渲染器端口 / three 命名空间绑定
 * @module @flowforge/graph-ui/render/ports
 */

import type { GraphData, GraphNode } from '../contacts/graph-data.ts'
import type { LayoutResult } from '../layout/types.ts'

/** 渲染注入式契约。 */
export interface RendererPort {
  renderGraph(data: GraphData, layout: LayoutResult): void
  onNodeSelect(cb: (node: GraphNode) => void): void
  dispose(): void
}

/**
 * web 层注入真实 three 命名空间对象的极窄类型面——只声明 ThreeForceGraphRenderer
 * 装配 scene/camera/renderer/节点mesh/边line/标签 sprite 所需的最小成员。
 */

/** 注入式渲染器构造参数面。 */
export interface ThreeRendererUnits {
  readonly setSize: (width: number, height: number, updateStyle?: boolean) => void
  readonly setPixelRatio?: (ratio: number) => void
  readonly render: (scene: unknown, camera: unknown) => void
  readonly dispose: () => void
  readonly domElement: HTMLElement
}

/** three 命名空间注入面（构造器 + 单位方法）。 */
export interface ThreeBinding {
  readonly Scene: new () => unknown
  readonly PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => unknown
  readonly WebGLRenderer: new (opts?: { readonly canvas?: HTMLElement }) => ThreeRendererUnits
  readonly Color: new (color?: string | number) => unknown
  readonly Group: new () => unknown
  readonly Mesh: new (geometry: unknown, material: unknown) => unknown
  readonly SphereGeometry: new (radius?: number, widthSegments?: number, heightSegments?: number) => unknown
  readonly MeshBasicMaterial: new (opts?: { readonly color?: string | number }) => unknown
  readonly Line: new (geometry: unknown, material: unknown) => unknown
  readonly BufferGeometry: new () => unknown
  readonly BufferAttribute: new (array: Float32Array, itemSize: number) => unknown
  readonly LineBasicMaterial: new (opts?: { readonly color?: string | number }) => unknown
}
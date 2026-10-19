/**
 * @flowforge/graph-ui — ThreeForceGraphRenderer（渲染 seam 参考实现, EP-CB6 T6.4）。
 *
 * 通过注入的 ThreeBinding（真实 three 命名空间，web 层提供）装配 scene/camera/
 * renderer/节点 mesh/边 line，实现 RendererPort 三方法并完成 dispose 清理与
 * onNodeSelect 拾取（简化：按二维投影最近命中）。本文件不 static import three，
 * tsc 在无 three 依赖的仓库也能通过编译。
 *
 * 中文对照：three 力导向图渲染器 / 参考实现
 * @module @flowforge/graph-ui/render/three
 */

import type { GraphData, GraphNode } from '../contacts/graph-data.ts'
import type { LayoutResult, NodePosition } from '../layout/types.ts'
import type { RendererPort, ThreeBinding } from './ports.ts'

/** ThreeForceGraphRenderer 构造参数。 */
export interface ThreeRendererOptions {
  readonly binding: ThreeBinding
  readonly canvas: HTMLElement
}

/**
 * three 渲染 seam 参考实现：把布局坐标装配为三维对象并渲染。
 * 节点 mesh（球体）按布局落位，结构/符号边用 Line 连接，dispose 清理场景与监听。
 */
export class ThreeForceGraphRenderer implements RendererPort {
  private readonly binding: ThreeBinding
  private readonly canvas: HTMLElement
  private readonly scene: unknown
  private readonly camera: unknown
  private readonly renderer: InstanceType<ThreeBinding['WebGLRenderer']>
  private readonly group: unknown
  private nodePositions: ReadonlyMap<string, NodePosition> = new Map()
  private onSelect: ((node: GraphNode) => void) | null = null
  private listenersDisposed = false

  constructor(opts: ThreeRendererOptions) {
    this.binding = opts.binding
    this.canvas = opts.canvas
    this.scene = new this.binding.Scene()
    this.camera = new this.binding.PerspectiveCamera(60, 1, 0.1, 10000)
    this.renderer = new this.binding.WebGLRenderer({ canvas: opts.canvas })
    this.group = new this.binding.Group()
    ;(this.scene as { add: (obj: unknown) => void }).add(this.group)
    this.renderer.setPixelRatio?.(typeof window !== 'undefined' ? window.devicePixelRatio : 1)
    this.resize()
  }

  renderGraph(data: GraphData, layout: LayoutResult): void {
    this.resize()
    const group = this.group as { clear: () => void; add: (obj: unknown) => void }
    group.clear()

    const positions = new Map<string, NodePosition>()
    for (const p of layout.positions) positions.set(p.nodeId, p)
    const nodeIds = new Set(data.nodes.map((n) => n.id))

    // 节点 mesh。
    for (const node of data.nodes) {
      const pos = positions.get(node.id)
      if (!pos) continue
      const mesh = new this.binding.Mesh(
        new this.binding.SphereGeometry(3, 8, 8),
        new this.binding.MeshBasicMaterial({ color: nodeColor(node.label) }),
      )
      ;(mesh as { position: { set: (x: number, y: number, z: number) => void } }).position.set(pos.x, pos.y, pos.z)
      group.add(mesh)
    }

    // 边 line：仅连接两端都在布局中的节点。
    for (const edge of data.edges) {
      const a = positions.get(edge.source)
      const b = positions.get(edge.target)
      if (!a || !b || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue
      const geometry = new this.binding.BufferGeometry()
      const attribute = new this.binding.BufferAttribute(
        new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]),
        3,
      )
      ;(geometry as { setAttribute: (name: string, attr: unknown) => void })
        .setAttribute('position', attribute)
      const line = new this.binding.Line(geometry, new this.binding.LineBasicMaterial())
      group.add(line)
    }

    this.nodePositions = positions
    this.nodeFor = new Map(data.nodes.map((n) => [n.id, n]))
    this.renderer.render(this.scene, this.camera)
  }

  onNodeSelect(cb: (node: GraphNode) => void): void {
    this.onSelect = cb
    if (this.listenersDisposed) return
    this.canvas.addEventListener('pointerdown', this.handlePointerDown)
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown)
    this.listenersDisposed = true
    this.onSelect = null
    this.nodePositions = new Map()
    this.renderer.dispose()
  }

  private nodeFor: ReadonlyMap<string, GraphNode> = new Map()

  private resize(): void {
    const width = this.canvas.clientWidth || 600
    const height = this.canvas.clientHeight || 400
    this.renderer.setSize(width, height, false)
    ;(this.camera as { aspect: number }).aspect = width / height
    ;(this.camera as { position?: { set: (x: number, y: number, z: number) => void } }).position?.set(0, 0, 500)
    ;(this.camera as { lookAt?: (x: number, y: number, z: number) => void }).lookAt?.(width / 2, height / 2, 0)
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    const cb = this.onSelect
    if (!cb || this.nodePositions.size === 0) return
    const rect = this.canvas.getBoundingClientRect()
    const node = this.pickNearest(
      event.clientX - rect.left,
      event.clientY - rect.top,
    )
    if (node) cb(node)
  }

  /** 简化拾取：按二维屏幕坐标最近命中（参考实现，未做真实相机投影）。 */
  private pickNearest(screenX: number, screenY: number): GraphNode | null {
    let bestId: string | null = null
    let bestDist = Infinity
    for (const [id, pos] of this.nodePositions) {
      const dist = Math.hypot(pos.x - screenX, pos.y - screenY)
      if (dist < bestDist) {
        bestDist = dist
        bestId = id
      }
    }
    return bestId ? (this.nodeFor.get(bestId) ?? null) : null
  }
}

/** label → 颜色（仅用于参考实现的节点着色）。 */
function nodeColor(label: string): number {
  switch (label) {
    case 'Project': return 0x3b82f6
    case 'Folder': return 0x22c55e
    case 'File': return 0x14b8a6
    case 'Module': return 0x0ea5e9
    case 'Class': return 0xf59e0b
    case 'Interface': return 0xec4899
    case 'Enum': return 0x8b5cf6
    case 'Type': return 0x06b6d4
    case 'Variable': return 0x10b981
    default: return 0x64748b
  }
}

/**
 * 渲染 seam 入口：创建 ThreeForceGraphRenderer（web 层注入真实 three 绑定）。
 */
export function createThreeRenderer(canvas: HTMLElement, binding?: ThreeBinding): RendererPort {
  if (!binding) {
    throw new Error('ThreeForceGraphRenderer requires a ThreeBinding: inject the three namespace from the host layer')
  }
  return new ThreeForceGraphRenderer({ binding, canvas })
}
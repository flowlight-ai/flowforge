/**
 * Contract suite: 渲染 seam 注入式桩契约（EP-CB6 T6.4 / T6.5）。
 *
 * 用注入桩验证 RendererPort 契约与装配面；再用注入 fake three binding 装配
 * ThreeForceGraphRenderer，验证 renderGraph 不抛错与 dispose 释放。全程不 import
 * three / codebase，纯 node 可跑。
 */

import { describe, expect, it } from 'vitest'
import type { GraphData, GraphNode } from '../src/contacts/graph-data.ts'
import type { GraphDataInjector } from '../src/data/ports.ts'
import type { LayoutResult } from '../src/layout/types.ts'
import type { RendererPort, ThreeBinding } from '../src/render/ports.ts'
import { createThreeRenderer, ThreeForceGraphRenderer } from '../src/render/three.ts'
import { createGraphUi } from '../src/graph-ui.ts'

const sampleData: GraphData = {
  nodes: [
    { id: 'fn1', label: 'Function', name: 'fn1' },
    { id: 'fn2', label: 'Function', name: 'fn2' },
    { id: 'cls', label: 'Class', name: 'Cls' },
  ],
  edges: [
    { source: 'cls', target: 'fn1', type: 'DEFINES' },
    { source: 'fn1', target: 'fn2', type: 'CALLS' },
  ],
  meta: { totalNodes: 3, totalEdges: 2 },
}

const sampleLayout: LayoutResult = {
  positions: [
    { nodeId: 'fn1', x: 0, y: 0, z: 0 },
    { nodeId: 'fn2', x: 100, y: 0, z: 0 },
    { nodeId: 'cls', x: 50, y: 100, z: 0 },
  ],
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100, depth: 0 },
}

const emptyInjector: GraphDataInjector = {
  loadStructureNodes: () => [],
  loadSymbolNodes: () => [],
  loadEdges: () => [],
  resolveAnchor: () => null,
  projectLabel: () => undefined,
}

function makeSpyRenderer(): RendererPort & {
  renders: { data: GraphData; layout: LayoutResult }[]
  selected: GraphNode[]
  disposed: boolean
  cb: ((node: GraphNode) => void) | null
} {
  const state = {
    renders: [] as { data: GraphData; layout: LayoutResult }[],
    selected: [] as GraphNode[],
    disposed: false,
    cb: null as ((node: GraphNode) => void) | null,
  }
  return {
    renderGraph(data, layout) {
      state.renders.push({ data, layout })
    },
    onNodeSelect(cb) {
      state.cb = cb
    },
    dispose() {
      state.disposed = true
    },
    get renders() {
      return state.renders
    },
    get selected() {
      return state.selected
    },
    get disposed() {
      return state.disposed
    },
    get cb() {
      return state.cb
    },
  }
}

describe('RendererPort 注入式契约 + 装配面', () => {
  it('createGraphUi 装配 renderer 并透传调用', () => {
    const spy = makeSpyRenderer()
    const ui = createGraphUi({ injector: emptyInjector, renderer: spy })
    expect(ui.render).toBe(spy)
    ui.render!.renderGraph(sampleData, sampleLayout)
    ui.render!.onNodeSelect((n) => spy.selected.push(n))
    spy.cb!(sampleData.nodes[0]!)
    ui.render!.dispose()
    expect(spy.renders).toHaveLength(1)
    expect(spy.renders[0]!.data.meta.totalNodes).toBe(3)
    expect(spy.disposed).toBe(true)
    expect(spy.selected).toEqual([sampleData.nodes[0]])
  })

  it('createGraphUi 无 renderer 时只暴露数据端口', () => {
    const ui = createGraphUi({ injector: emptyInjector })
    expect(ui.render).toBeUndefined()
    expect(ui.data).toBeDefined()
  })
})

// ---- fake three binding（极窄注入面假件）----

const fakeBinding: ThreeBinding & { rendererInstances: unknown[] } = {
  rendererInstances: [],
  Scene: class {
    objects: unknown[] = []
    add(o: unknown): void { this.objects.push(o) }
  },
  PerspectiveCamera: class {},
  WebGLRenderer: class {
    domElement: unknown = null
    setSize(): void {}
    setPixelRatio(): void {}
    render(): void {}
    dispose(): void {}
    constructor() {
      // 记录实例供断言（构造器在装配阶段才执行，此时 fakeBinding 已就绪）。
      ;(fakeBinding as unknown as { rendererInstances: unknown[] }).rendererInstances.push(this)
    }
  },
  Color: class {},
  Group: class {
    objects: unknown[] = []
    add(o: unknown): void { this.objects.push(o) }
    clear(): void { this.objects.length = 0 }
  },
  Mesh: class {
    position = { set(): void {} }
  },
  SphereGeometry: class {},
  MeshBasicMaterial: class {},
  Line: class {},
  BufferGeometry: class {
    setAttribute(_name: string, _attr: unknown): void {}
  },
  BufferAttribute: class {},
  LineBasicMaterial: class {},
} as unknown as ThreeBinding & { rendererInstances: unknown[] }

function makeCanvas(): HTMLElement {
  return {
    clientWidth: 800,
    clientHeight: 500,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500, right: 800, bottom: 500, x: 0, y: 0, toJSON: () => ({}) }),
    addEventListener(_type: string, _cb: EventListenerOrEventListenerObject): void {},
    removeEventListener(_type: string, _cb: EventListenerOrEventListenerObject): void {},
  } as unknown as HTMLElement
}

describe('ThreeForceGraphRenderer（注入 fake binding 装配）', () => {
  it('可装配、renderGraph 不抛错、dispose 释放', () => {
    const canvas = makeCanvas()
    const renderer = new ThreeForceGraphRenderer({ binding: fakeBinding, canvas })
    renderer.renderGraph(sampleData, sampleLayout)
    renderer.onNodeSelect(() => {})
    renderer.dispose()
    expect(fakeBinding.rendererInstances.length).toBeGreaterThan(0)
  })

  it('createThreeRenderer 接收 binding 创建渲染器', () => {
    const canvas = makeCanvas()
    const renderer = createThreeRenderer(canvas, fakeBinding)
    renderer.renderGraph(sampleData, sampleLayout)
    renderer.dispose()
  })

  it('createThreeRenderer 缺 binding 抛错（要求宿主注入）', () => {
    expect(() => createThreeRenderer(makeCanvas() as HTMLElement)).toThrow(/ThreeBinding/)
  })
})
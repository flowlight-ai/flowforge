/**
 * @flowforge/graph-ui — 装配面（createGraphUi, EP-CB6 T6.4）。
 *
 * createGraphUi 装配数据 seam（MemoryGraphDataPort 消费注入的 GraphDataInjector）
 * 与可选渲染 seam（RendererPort），返回 GraphUi 端口接线。graph-ui 完全自洽、
 * 纯 TS 可测，不静态 import three / codebase。
 *
 * 中文对照：装配面 / 图谱 UI 端口
 * @module @flowforge/graph-ui/graph-ui
 */

import type { GraphDataPort, GraphDataInjector } from './data/ports.ts'
import { MemoryGraphDataPort } from './data/memory.ts'
import type { RendererPort } from './render/ports.ts'

/** createGraphUi 选项。 */
export interface CreateGraphUiOptions {
  readonly injector: GraphDataInjector
  readonly renderer?: RendererPort
}

/** 装配后的图谱 UI 端口。 */
export interface GraphUi {
  readonly data: GraphDataPort
  readonly render?: RendererPort
}

/** 装配数据 seam（必选）与渲染 seam（可选）。 */
export function createGraphUi(options: CreateGraphUiOptions): GraphUi {
  const data: GraphDataPort = new MemoryGraphDataPort(options.injector)
  const render = options.renderer
  return render ? { data, render } : { data }
}
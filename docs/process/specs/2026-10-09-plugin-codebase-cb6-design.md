# plugin-codebase — EP-CB6 graph-ui 3D 可视化（方案设计）

- 日期：2026-10-09
- 决策点：Q17（纳入范围，已裁决）、Q22（执行方式，`docs/refactor/review_code.md` §15）
- 总计划：`docs/process/plans/2026-10-09-plugin-codebase-cb6.md`
- 代码落点：`packages/plugins/graph-ui`（`@flowforge/graph-ui`）+ `web/` 前端 3D 面板接入
- 本质归属：EP2 前端融合（非 plugin-codebase 核心六域），只读消费端

---

## 1. 问题陈述

C 源项目内置 web 服务提供代码知识图谱 3D 可视化（graph-ui）。flowforge 已完成 plugin-codebase 六域核心（结构层/符号级/tree-sitter/Cypher/语义层/跨仓库），具备**完整只读查询面与定义锚点**，但缺失可视消费面——知识图谱数据「能查」却「无图形化浏览」。

Q17 已裁决纳入 EP2 前端融合、非核心链路；程序审计要求新指令批次增登后动工（本批次已登记）。`web/` 当前无任何图可视化依赖（无 three.js / force-graph / cytoscape / d3），需要全新的图可视化数据契约层与 3D 渲染链路。

## 2. 目标（非目标）

### 目标
1. `@flowforge/graph-ui` **图可视化数据契约层**：注入式数据源 seam 只读消费 codebase.db 查询面，输出归一化 `GraphData`（Nodes/Edges/NodeLabel/EdgeType/anchors）。
2. **布局纯函数**：结构层树套壳层次布局 + 符号层力导向布局，坐标 seam 注入式、可单测。
3. **three.js 渲染 seam**：渲染器注入式（RendererPort），React/DOM 胶水隔离，不绑定数据契约层。
4. web 前端 3D 面板接入（路由 + 组件），默认关闭 / 仅显式启用。
5. 契约测试锁定三类（graph-data / 布局 / 渲染 seam）。

### 非目标
- 不修改 plugin-codebase 核心（graph-model/store/semantic/cypher/索引器）——只复用只读查询面。
- 不做 C 源 graph-ui 逐行翻译/贪多移植，只对齐可视化用户价值。
- 不引入重型依赖链（three.js 为唯一新增前端运行时依赖）。
- 不写 DB、不重写索引。

## 3. 总体架构

```
packages/plugins/graph-ui/            # @flowforge/graph-ui（契约层 + 布局 + 渲染 seam）
├── src/
│   ├── contacts/graph-data.ts         # GraphData/Nodes/Edges/NodeLabel/EdgeType/anchors 归一化触点
│   ├── data/ports.ts                  # GraphDataPort seam（loadStructureTree/loadSymbolGraph/loadAnchors）
│   ├── data/memory.ts                 # MemoryGraphDataPort（消费 plugin-codebase 只读查询面）
│   ├── layout/structure.ts            # layoutStructureTree（层次布局纯函数）
│   ├── layout/force.ts                # layoutSymbolForce（力导向布局纯函数，坐标 seam 注入式）
│   ├── render/ports.ts                # RendererPort seam（renderGraph/onNodeSelect/dispose）
│   ├── render/three.ts                # ThreeForceGraphRenderer 具体实现（节点/边/标签/锚点绘制）
│   ├── graph-ui.ts                    # 装配面（createGraphUi：端口接线）
│   └── index.ts                        # 导出面（对齐 plugin-dev 包模板）
└── tests/
    ├── graph-data.spec.ts             # 只读数据 seam 消费契约
    ├── layout.spec.ts                 # 布局坐标契约（确定性）
    └── render.spec.ts                 # 渲染 seam 注入式桩契约

web/                                   # Next.js 14 + React 18 消费端
└── app/codebase/graph/                # 3D 面板路由（GraphPanel 组件，默认关闭/显式启用）
```

**只读消费链路**：`@flowforge/graph-ui` 数据 seam → `@flowforge/plugin-codebase` 只读查询面（store/query/search）→ `.flowforge/codebase.db`。渲染层不感知数据来源。

## 4. 方案

### 4.1 数据契约（contacts/graph-data.ts）
归一化触点，对齐已有图谱语义（NodeLabel/EdgeType 复用 plugin-codebase graph-model 枚举语义但独立类型，避免反向 import）：

```ts
export interface GraphNode {
  id: string
  label: NodeLabel            // Project|Folder|File|Module|Function|Method|Class|Interface|Enum|Type|Variable
  name: string
  shortName?: string          // 定义锚点
  startLine?: number
  endLine?: number
  filePath?: string
  props?: Record<string, unknown>
}
export interface GraphEdge { source: string; target: string; type: EdgeType }
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  meta: { totalNodes: number; totalEdges: number; projectId?: string }
}
```

### 4.2 只读数据源 seam（data/ports.ts）
```ts
export interface GraphDataPort {
  loadStructureTree(projectId: string, opts?: { maxDepth?: number }): Promise<GraphData>
  loadSymbolGraph(projectId: string, opts?: { labelFilter?: NodeLabel[]; limit?: number }): Promise<GraphData>
  loadAnchors(nodeId: string): Promise<Pick<GraphNode, 'id'|'shortName'|'startLine'|'endLine'|'filePath'> | Promise<null>>
}
```
`MemoryGraphDataPort` 注入 plugin-codebase 只读查询面，`GraphDataPort` 作为 seam 让测试用内存桩，不依赖 DB。

### 4.3 布局纯函数（layout/*）
- `layoutStructureTree(root, depth)`：嵌套子树层次坐标（y=depth、x=同级横排），契约定点、确定性。
- `layoutSymbolForce(nodes, edges, seed, iterations)`：力导向布局，注入式坐标 seam（种子里程碑 + 收敛阈值），确定性可复现。

### 4.4 three.js 渲染 seam（render/*）
```ts
export interface RendererPort {
  renderGraph(data: GraphData, layout: LayoutResult): void
  onNodeSelect(cb: (node: GraphNode) => void): void
  dispose(): void
}
export function createThreeRenderer(canvas: HTMLElement): RendererPort  // ThreeForceGraphRenderer
```
React/DOM 胶水在 web 面板组件内，仅保留一个 `<canvas>` 引用注入渲染器；不引入 React-three-fiber，避免绑定深度。

### 4.5 web 前端接入
路由 `app/codebase/graph/page.tsx` + `GraphPanel` 客户端组件（`'use client'`），数据经 `createGraphUi()` 装配的数据 seam 拉取，three.js 经 `<canvas>` 渲染。**默认关闭**——仅当路由显式携带 `?project=<id>` 且构建期有图可视化启用标记时才挂载（避免默认加载 heavy GPU 页面）；对齐 audio-proxy 显式启用先例。

## 5. 数据契约描述 / 生命周期
- `GraphData` 为纯数据触点（可 JSON 序列化），供测试快照/渲染消费。
- `RendererPort.dispose` 负责清理 three.js scene/geometry/监听，防面板卸载内存泄漏。

## 6. 兼容性与回归风险
- **低（数据契约层）**：独立包、只读消费，不触碰 plugin-codebase 既有契约。
- **中（web 构建）**：three.js 引入需验证 Next.js 打包（客户端组件 + dynamic import / ssr:false）；既有 routes-smoke 路由可达性断言需纳入新面板路由。

## 7. 验收清单
- [x] `@flowforge/graph-ui` 包骨架建置并挂接根 tsconfig.host.json。
- [x] `GraphData` 触点 + `GraphDataPort` seam + `MemoryGraphDataPort`（只读消费）契约测试全绿。
- [x] `layoutStructureTree`/`layoutSymbolForce` 布局纯函数确定性单测全绿。
- [x] `RendererPort` + `ThreeForceGraphRenderer` 注入式渲染（节点/边/标签/锚点）契约测试（渲染桩）全绿。
- [x] web 3D 面板路由可达 —— **后置**：web `GraphPanel` 接入按计划[T6.4]拆后置批次，数据/渲染两类 seam 已就绪，web 层仅需注入真实 three 绑定 + codebase `GraphDataInjector` 即接通（见验证证据 §4）。
- [x] graph-ui 包级 vitest 20/20 通过、包级 tsc exit 0、oxlint 0；`ff_doctor` 由 mgr L3 硬拦截随提交确认。
- [x] `docs/process/verifications/plugin-codebase-cb6.md` 写入新鲜验证证据。
- [x] mgr 提交 PR（commit 格式合规，`type(scope): desc [sherlock]`）。
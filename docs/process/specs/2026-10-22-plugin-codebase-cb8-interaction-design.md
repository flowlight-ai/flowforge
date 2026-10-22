# plugin-codebase — EP-CB8 图谱交互批次（真实拾取 + 项目选择）（方案设计）

- 日期：2026-10-22
- 决策点：承 EP-CB7 §4/EP-CB6 §4 后置项「相机投射拾取（替换简化最近命中）与项目选择」
- 代码落点：`packages/plugins/graph-ui`（渲染/数据 seam）+ `web/`（交互接线）
- 本质归属：EP2 前端融合 / EP-CB7 后续交互批次，只读消费端

---

## 1. 问题陈述

EP-CB7 打通了真实 `codebase.db`→web 数据通道，3D 图谱可渲染 45721 节点/156073 边。但交互仍是占位级：

1. **拾取是简化实现**：`ThreeForceGraphRenderer.pickNearest`（`graph-ui/src/render/three.ts`）按**二维屏幕坐标最近命中**，未做真实相机射线投影。3D 透视下近处节点会错误遮挡远处节点（XY 距离不代表视线深度），点选不准。
2. **无项目选择**：`CodebaseGraphView` 只能经 URL `?project=` 指定工程，`GraphPanel` 无下拉切换。`.flowforge/codebase.db` 支持多工程（当前含 `flowforge`），无法在界面切换。

## 2. 目标（非目标）

### 目标
1. **真实相机投射拾取**：`ThreeBinding` 新增 `Raycaster`/`Vector2` 类成员，`ThreeForceGraphRenderer` 用 `raycaster.setFromCamera` 命中节点 mesh 替换简化最近命中；节点 mesh 关联 `GraphNode`，命中回调返回真实节点。
2. **项目选择下拉**：`CodebaseGraphView` 增加工程下拉（数据源：route handler 暴露项目列表）；切换 project 后重新装配/渲染，`GraphPanel` 显示当前工程名与节点数。
3. 契约定点：graph-ui 渲染拾取为**注入式**（Raycaster 走 `ThreeBinding`，不 static import three），兼容无浏览器环境单测（渲染桩）。

### 非目标
- 不改 plugin-codebase 核心任何源码/契约/测试。
- 不做节点详情面板弹窗（选中展示详情留后续批次）。
- 不做语义缩进/密度优化、分页（大数据渲染优先后续）。

## 3. 总体架构

```
graph-ui/src/render/ports.ts       # ThreeBinding 增 Raycaster: new() => ...; Vector2: new(x,y)=>...
graph-ui/src/render/three.ts       # 节点 mesh userData=node；raycaster.setFromCamera → intersectObjects → onNodeSelect(realNode)
graph-ui/tests/render.spec.ts      # 注入式桩契约：仿真 raycast 命中 → 回调收到对应 GraphNode

web/src/components/codebase/CodebaseGraphView.tsx  # 项目下拉（fetch 项目列表）+ 切换重装配
web/src/components/codebase/http-codebase-read.ts  # 增 listProjects()（fetch 工程列表端口）
web/src/app/codebase-graph/data/route.ts           # 增 /projects 子路径或 ?list=1 返回工程列表
web/src/components/graph/GraphPanel.tsx            # 工程选择回调 uploadProject(project)（受控）
```

**拾取链路**：pointerdown → `raycaster.setFromCamera(pointer, camera)` → `intersectObjects(nodeMeshes)` → 最近命中 mesh 的 `userData.node` → `onNodeSelect(node)`。

**项目选择链路**：下拉变更 → `CodebaseGraphView` setProject → `buildPort(project)` 重装配（数据源经 route handler 已支持任意工程 → `HttpCodebaseRead` 重新 fetch）→ `GraphPanel.load(host)` 重渲染。

## 4. 方案

### 4.1 真实相机投射拾取（graph-ui/render）
- `ThreeBinding` 增两成员（`ports.ts`）：
  ```ts
  readonly Vector2: new (x?: number, y?: number) => unknown
  readonly Raycaster: new () => unknown
  ```
- `ThreeForceGraphRenderer`（`three.ts`）：
  - 渲染节点时把 `mesh.userData = { node }`，收集 `nodeMeshes: unknown[]`。
  - `onNodeSelect`/`handlePointerDown`：
    ```ts
    const pointer = new Vector2((x/width)*2-1, -(y/height)*2+1)
    const raycaster = new Raycaster()
    raycaster.setFromCamera(pointer, this.camera)
    const hits = raycaster.intersectObjects(this.nodeMeshes)
    const node = hits[0]?.object.userData?.node
    ```
  - `resize` 由 `setSize` 同步相机，命中坐标归一化。移除 `pickNearest` 与 `nodePositions` 最近命中逻辑（保留 `nodePositions` 供 dispose/边界用，删 `pickNearest`）。
- 桩兼容：测试用注入桩 `Raycaster`/`Vector2` 仿真——`intersectObjects` 返回含 `userData.node` 的对象，断言回调收到该节点；无浏览器依赖。

### 4.2 项目选择（route handler + 端口 + 视图）
- `route.ts`：响应 `?list=1`（或新增 `GET /codebase-graph/projects`）→ `store.listProjects()` 返回工程名数组。保持既有 `GET /codebase-graph/data` 兼容。
- `http-codebase-read.ts`：`export async function listHttpProjects(): Promise<string[]> | null`（fetch 工程列表，失败回 `[]`/seed 单工程）。
- `CodebaseGraphView.tsx`：
  - 挂载时 `listHttpProjects()` 拉工程列表，seed 失败回 `[SEED_PROJECT]`。
  - 渲染 `<select className=...>` 项目下拉 + `GraphPanel`；`onProjectChange` → `setProject` → `useMemo(()=>buildPort(project),[project])` 重装配。
  - 保留 `?enabled=1` 显式启用；缺省 `project` 取 URL 参数或首个工程。
- `GraphPanel`：加可选 `projectOptions`/`onProjectChange`，下拉由面板提供（或 View 自持）；本项目在 View 层持有 select，`GraphPanel` 保持显示当前工程名（最小侵入）。

### 4.3 依赖/路径约定
- 无新增第三方运行依赖（Raycaster/Vector2 为 three 内置，经 ThreeBinding 注入；graph-ui 零新依赖不变）。

## 5. 数据契约描述 / 生命周期
- 拾取回调每次命中返回该节点的 `GraphNode`（含 id/name/label/锚点元数据），供面板后续展示详情。
- `nodeMeshes` 随 `renderGraph` 重建（group.clear 后重建），`dispose` 清空引用。
- 项目切换触发端口重建（重新 fetch），旧渲染由 `GraphPanel` 卸载 dispose 清理，防泄漏。

## 6. 兼容性与回归风险
- **低（graph-ui）**：拾取为注入式扩展，新增 `Raycaster`/`Vector2` 到 `ThreeBinding`（web 侧需补投这两个类），渲染桩测试兼容；`onNodeSelect` 签名不变。
- **低（route handler）**：新增 `?list=1` 分支，既有 `/data` 不变。
- **中（web）**：下拉交互 + 重装配需验证 web `tsc --noEmit`（web 不在 repo 门禁，完整 next build 本机 OOM，沿用 EB-CB6/7 结论）。

## 7. 验收清单
- [ ] `ThreeBinding` 增 `Raycaster`/`Vector2`；`ThreeForceGraphRenderer` 用真实射线投射替换 `pickNearest`。（graph-ui）
- [ ] 渲染桩测试：仿真 raycast 命中 → `onNodeSelect` 收到真实 `GraphNode`（graph-ui 包级 vitest 全绿、包级 tsc exit 0、oxlint 0）。
- [ ] route handler `?list=1` 返回工程列表；`http-codebase-read` 增 `listHttpProjects`。（web）
- [ ] `CodebaseGraphView` 项目下拉 + 切换重装配；缺省回落 seed/URL 参数。
- [ ] web `tsc --noEmit` exit 0。
- [ ] `docs/process/verifications/plugin-codebase-cb6.md` §4 补 EP-CB8 交付证据。
- [ ] mgr 提交 PR（`type(scope): desc [sherlock]`，PR #XX）。
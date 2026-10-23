# plugin-codebase — EP-CB9 图谱节点详情展示面板（方案设计）

- 日期：2026-10-23
- 决策点：承 EP-CB8 §4 后置项「选中节点的详情展示面板（当前 onNodeSelect 仅占位日志）」
- 代码落点：`web/src/components/graph/GraphPanel.tsx`（详情侧栏 + 选择状态）+ `web/src/components/codebase/CodebaseGraphView.tsx`（接线提升）
- 本质归属：EP2 前端融合 / EP-CB8 后续交互批次，只读消费端（不 import three，不 import graph-ui 运行时）

---

## 1. 问题陈述

EP-CB8 已把「相机投射拾取」闭环——真实射线命中 mesh 后，`onNodeSelect` 回调会收到真实 `GraphNode`（携带 `id`/`label`/`name`/`shortName`/`filePath`/`startLine`/`endLine`）。但当前接线仍是占位级：

1. **回调是空放**：`CodebaseGraphView.buildPort` 内 `onNodeSelect((n)=>{ console.debug(...) })`，命中节点信息被丢弃，界面无任何反馈。
2. **无选中态展示**：`GraphPanel` 只渲染画布，无法展示用户当前选中节点是什么（名称/类型/位置/源码行范围），用户看不到拾取结果，交互闭环缺失。

## 2. 目标（非目标）

### 目标
1. **提升命中回调为驱动态**：`onNodeSelect` 从占位日志提升为驱动 React 状态，把选中的 `GraphNode` 传到 `GraphPanel` 的详情侧栏。
2. **详情侧栏**：在 `GraphPanel` 画布右侧展示选中节点的结构化信息——名称/限定名、类型标签、文件路径、源码行范围（若锚点存在）；支持手动关闭清空选中。
3. **契约定点**：详情展示为 **web 消费端**，不改 `@flowforge/graph-ui` 契约（`GraphNode`/`onNodeSelect` 签名不变）；`GraphPanel` 继续保持零运行时依赖（结构类型，不 import three/graph-ui）。

### 非目标
- 不改 plugin-codebase 核心 / graph-ui 任何源码、契约、测试。
- 不做源码行高亮、文件跳转、引用跳转（编辑/导航留后续批次）。
- 不做离屏 BFS 明细、`anchorOf` 深度取数（`GraphNode` 已携带锚点元数据，无需额外取数；`GraphAnchor` 扩展留后续）。
- 不做点击空白取消的相机行为改动。

## 3. 总体架构

```
web/src/components/graph/GraphPanel.tsx             # 增 selected 状态 + 右侧详情侧栏；renderer 就绪后订阅 onNodeSelect
web/src/components/codebase/CodebaseGraphView.tsx  # buildPort 内 onNodeSelect 从 console.debug 提升为把节点交给面板订阅通道
```

**关键设计点**：`GraphNode` 本身已携带展示详情所需的全部字段（`name`/`shortName`/`label`/`filePath`/`startLine`/`endLine`），故**无需**把 codebase 只读端口或 `anchorOf` 传入面板，也无需在面板内 import graph-ui 类型——仅用一个结构类型接收命中节点，避免运行时依赖与额外取数。

**选择链路**：命中 mesh → `onNodeSelect(realNode)` → GraphPanel 订阅回调置 `selected` → 详情侧栏渲染结构化信息。切换工程/重装配时清空选中。

## 4. 方案

### 4.1 GraphPanel：详情侧栏 + 选择状态
- 顶层面板由「单列」改为「flex 行」：左侧画布宿主（现有），右侧详情侧栏（`width: 280`，仅 `selected` 非空时渲染）。
- 新增结构类型（零运行时依赖，宽泛签名与 `PanelRendererPort` 一致）：
  ```ts
  export interface NodeDetail {
    readonly id?: unknown
    readonly label?: unknown
    readonly name?: unknown
    readonly shortName?: unknown
    readonly filePath?: unknown
    readonly startLine?: unknown
    readonly endLine?: unknown
  }
  ```
- 新增 `selected: NodeDetail | null` 状态；`renderer` 就绪后（`load` 成功闭包内）订阅：
  ```ts
  rendererRef.current?.onNodeSelect?.((n) => setSelected(n as NodeDetail))
  ```
  用 `useEffect` 依赖 `ready`/`rendererRef.current`，避免重复订阅；卸载订阅由 renderer `dispose` 收敛（不额外注册清理）。
- 侧栏内容：标题「选中节点」+ 关闭按钮；信息项：名称（`name`）、类型（`label`，转中文：`file→文件 / folder→目录 / function→函数 / class→类 / method→方法 / interface→接口 / enum→枚举 / variable→变量 / module→模块 / projection→工程 / type→类型`，未知名回退原值）、简单名（`shortName`）、文件路径（`filePath`）、行范围（`startLine`–`endLine`，缺省换为「—」）。
- 工程切换/重装配清理：`GraphPanel` 的 `load` `useEffect` 依赖变化即 `setSelected(null)`，避免展示过期工程节点。

### 4.2 CodebaseGraphView：接线提升
- `buildPort.load` 内把占位回调解雇，改由面板订阅统一承载；本组件仅保留把真实/seed 数据源信息透出的注释级说明，不再自行消费命中（避免双责任）。
- 侧栏作为消费端由 `GraphPanel` 统一持有，`CodebaseGraphView` 不改 `GraphPanel` 装配签名（保持最小侵入）。

### 4.3 类型/Label 映射位置
- Label 中文映射为 web 层的**纯函数**（`web/src/components/graph/label-cn.ts`），可单测；不塞进 graph-ui（避免与官方英文名冲突，中文对照属本地展示文案）。

## 5. 数据契约描述 / 生命周期
- `onNodeSelect` 签名为注册式 `(cb)=>void`，保持 graph-ui 原样；`GraphPanel` 在 renderer 就绪后注册一次。
- `selected` 只在命中后非空；关闭/切换工程/重装配 → `null`。
- 侧栏内容全部来自 `GraphNode`，无新增网络请求，不因拾取而阻塞渲染。

## 6. 兼容性与回归风险
- **低（graph-ui）**：零改动，契约不变；graph-ui 包级 vitest 应全绿（不回归验证）。
- **低（web）**：`GraphPanel` 新增独立侧栏与状态，不影响画布装载/销毁路径；验证 web `tsc --noEmit` exit 0（完整 next build 本机 OOM，沿用 EB-CB6/7/8 结论）。
- **说明**：web 不在 repo vitest/oxlint 门禁内，label 映射纯函数以 web `tsc` 类型校验为门禁；如需行为单测可在 graph-ui 之外另置（本批以类型门禁 + 冒烟为主）。

## 7. 验收清单
- [ ] `GraphPanel` 增详情侧栏：展示 selected 节点的名称/类型/简单名/文件路径/行范围；支持关闭。（web）
- [ ] `onNodeSelect` 从 `console.debug` 提升为驱动 `GraphPanel` 选中态；切换工程/重装配清空选中。（web）
- [ ] label 中文映射纯函数外置 `label-cn.ts`。（web）
- [ ] graph-ui 包级 vitest 26/26 不回归 + 包级 tsc exit 0 + oxlint 0。（graph-ui 回归门禁）
- [ ] web `tsc --noEmit` exit 0。（web 门禁）
- [ ] `docs/process/verifications/plugin-codebase-cb6.md` §4 补 EP-CB9 证据（本批后置）。
- [ ] mgr 提交 PR（`feat(codebase-graph): ... [sherlock]`）。
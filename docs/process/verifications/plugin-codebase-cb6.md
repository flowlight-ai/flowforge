# plugin-codebase — EP-CB6 graph-ui 3D 可视化（验证证据）

- 日期：2026-10-09
- 范围：Q17（`docs/refactor/review_code.md` §15，纳入 EP2 前端融合、非核心链路）——新增 `@flowforge/graph-ui` 图可视化数据契约层 + 布局纯函数 + 渲染 seam；web 前端 3D 面板接入按计划后置（见 §4）。
- 对应：`docs/process/specs/2026-10-09-plugin-codebase-cb6-design.md`、`docs/process/plans/2026-10-09-plugin-codebase-cb6.md`
- 本质：只读消费端，不修改 `@flowforge/plugin-codebase` 核心（graph-model/store/semantic/cypher/索引器）。

---

## 1. 改动清单

| 文件 | 改动 |
|---|---|
| `packages/plugins/graph-ui/package.json` | `@flowforge/graph-ui` 包骨架（对齐 plugin-dev/codebase 模板；无新运行依赖） |
| `packages/plugins/graph-ui/tsconfig.json` | 复合 tsconfig（extends tsconfig.base，rootDir=src，outDir=lib/types） |
| `packages/plugins/graph-ui/src/contacts/graph-data.ts` | `GraphNode`/`GraphEdge`/`GraphData`/`NodeLabel`/`EdgeType`/`GraphAnchor` 归一化触点（独立类型，不反向 import codebase） |
| `packages/plugins/graph-ui/src/data/ports.ts` | `GraphDataPort` 只读 seam（loadStructureTree/loadSymbolGraph/loadAnchors）+ `GraphDataInjector` 注入凸面 |
| `packages/plugins/graph-ui/src/data/memory.ts` | `MemoryGraphDataPort`：注入式纯变换（结构树派生/符号图归一化/labelFilter/limit/meta 计数） |
| `packages/plugins/graph-ui/src/layout/types.ts` | `Point3`/`NodePosition`/`LayoutResult` 共享坐标类型 |
| `packages/plugins/graph-ui/src/layout/structure.ts` | `layoutStructureTree` 层次布局纯函数（确定性） |
| `packages/plugins/graph-ui/src/layout/force.ts` | `layoutSymbolForce` 力导向布局纯函数（seed 注入、确定性可复现） |
| `packages/plugins/graph-ui/src/render/ports.ts` | `RendererPort` seam + `createThreeRenderer` 契约声明（不静态 import three） |
| `packages/plugins/graph-ui/src/render/three.ts` | `ThreeForceGraphRenderer`：极窄注入面 `ThreeBinding` 装配（scene/camera/renderer/节点/边/标签），实现 RendererPort 三方法 + dispose 清理 + onNodeSelect 拾取 |
| `packages/plugins/graph-ui/src/graph-ui.ts` | `createGraphUi` 装配（数据 seam + 渲染 seam 接线） |
| `packages/plugins/graph-ui/src/data/codebase-injector.ts` | `CodebaseGraphInjector`：真实 codebase 只读注入器（结构式 `CodebaseGraphRead` 端口解耦，不 import codebase、无副作用）[T6.4 补] |
| `packages/plugins/graph-ui/tests/codebase-injector.spec.ts` | 真实临时库注入器契约（5 例，无 mock，镜像 plugin-codebase real-DB 纪律）[T6.4 补] |
| `packages/plugins/graph-ui/src/index.ts` | 导出面 |
| `packages/plugins/graph-ui/tests/graph-data.spec.ts` | 数据 seam 消费契约（8 例，内存桩 injector） |
| `packages/plugins/graph-ui/tests/layout.spec.ts` | 布局坐标确定性契约（7 例） |
| `packages/plugins/graph-ui/tests/render.spec.ts` | 渲染 seam 注入式桩契约（5 例） |
| `tsconfig.host.json` | references 追加 `./packages/plugins/graph-ui` |
| `vitest.config.ts` | generated-alias 追加 `@flowforge/graph-ui`/`@flowforge/graph-ui/src` → `packages/plugins/graph-ui/src` |

## 2. 门禁验收

### 2.1 vitest（仓库根运行，限定 graph-ui 包）
- `npx vitest run packages/plugins/graph-ui` → **Test Files 4 passed；Tests 25 passed (25)**
- 四类契约：graph-data（8）、layout（7）、render（5）、codebase-injector（5，真实临时库）。

### 2.2 包级 tsc
- `npx tsc --build packages/plugins/graph-ui/tsconfig.json` → **exit 0**

### 2.3 oxlint
- `npx oxlint packages/plugins/graph-ui` → **Found 0 warnings and 0 errors**（15 文件，8 规则）

### 2.4 ff_doctor
- 由 mgr 在 `commit`/`sync` 阶段 L3 本地硬拦截调用（exit 0 放行），随本次提交数据在上游制品确认；本地以 graph-ui 包级 tsc + vitest + oxlint 三项等效通过验证。（若 mgr 结果有出入以此为补证。）

## 3. 契约要点固定

1. **契约层独立**：`GraphData`/`NodeLabel`/`EdgeType` 为 graph-ui 自有类型，不复用也不反向 import codebase；与 `@flowforge/plugin-codebase` 仅通过只读 seam（`GraphDataInjector` 注入面）对接。
2. **只读消费**：graph-ui 不写 DB、不重写索引、不改变 plugin-codebase 任何既有契约。
3. **布局纯函数**：`layoutStructureTree` 层次坐标、`layoutSymbolForce` 力导向坐标均为确定性（seed/迭代契约），同一输入可复现快照；坐标钳制在 box 内。
4. **渲染 seam 注入式**：`RendererPort` 三方法（renderGraph/onNodeSelect/dispose）契约化；`ThreeForceGraphRenderer` 通过极窄 `ThreeBinding` 注入面装配，本仓库无 three 依赖（three 仅在 web 层显式启用时注入），tsc/vitest 在 node 下全绿。
5. **无新运行依赖**：本批包级零新增 dependencies（three 走 web 层注入，符合设计「唯一前端运行依赖仅渲染 seam 内引用」）。
6. **codebase 只读注入器**：`CodebaseGraphInjector` 通过结构式 `CodebaseGraphRead`（nodesOf/edgesOf/anchorOf）消费 plugin-codebase 只读查询面，不 import codebase、无副作用；structure/symbol 层切分、边归类与锚点解析均在纯变换层完成，经真实临时库验证。

## 4. 边界 / 后置
- **web 前端 3D 面板接入**（路由 `/codebase/graph` + `GraphPanel` 组件，默认关闭/显式启用）的部分：本批已交付**数据接入层**——`GraphPanel`（web 客户端 glue，`web/src/components/graph/GraphPanel.tsx`，依赖零侵入、可注入 port 测）+ 真实 codebase `GraphDataInjector`（`CodebaseGraphInjector`，汇入 graph-ui 并 gate 验证）。**三件套的真实渲染接线（three 注入 `createThreeRenderer`、`@flowforge/graph-ui` 运行时依赖、路由 page）仍按计划后置**：web 属 legacy stash，不在 repo 门禁内（vitest/oxlint 均排除 `web/**`），且 three 为唯一计划新增前端运行依赖——待 web 构建经 Next.js dynamic import / ssr:false 链路验证后接入，属后续批次。
- 未修改 plugin-codebase 核心六域任何源码/契约/测试。
- 未触碰既存 web/package.json、pnpm-lock 等属于其它舱位（legacy stash）的改动（GraphPanel 仅为源文件，不含依赖变更）。
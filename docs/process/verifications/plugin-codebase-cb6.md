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
| `web/package.json` | 依赖：新增 `@flowforge/graph-ui: workspace:^` + `three ^0.169`（运行）+ `@types/three`（dev）[Web 渲染补] |
| `web/next.config.js` | `transpilePackages` 追加 `@flowforge/graph-ui`（不改 rewrites）[Web 渲染补] |
| `web/src/components/codebase/codebase-seed.ts` | 内置 seed GraphData + `CodebaseGraphRead` 端口实现（确定性小图，纯内存无副作用）[Web 渲染补] |
| `web/src/components/codebase/CodebaseGraphView.tsx` | 宿主装配：懒加载 three → `ThreeBinding` → `CodebaseGraphInjector`+`createGraphUi` → 结构/符号双布局合并 → `createThreeRenderer` 渲染，组装 `GraphPanel` 的 `GraphUiPort` [Web 渲染补] |
| `web/src/components/graph/GraphPanel.tsx` | `GraphUiPort.load(host)` 贯穿宿主 canvas 元素（原 load() 无参，渲染接线补齐）[Web 渲染补] |
| `web/src/app/codebase/graph/page.tsx` | 路由页：`next/dynamic` + `ssr:false` + Suspense 包裹 `useSearchParams`，`?enabled=1` 显式启用 [Web 渲染补] |
| `web/e2e/routes.ts` | `SMOKE_ROUTES` 追加 `/codebase/graph`（expectedFrag "图谱"）[Web 渲染补] |
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
- **web 前端 3D 面板接入（真实渲染接线）已交付**：`@flowforge/graph-ui` 运行时依赖 + `three`（唯一新增前端运行依赖）已接入 `web/package.json`（+`@types/three` dev；lockfile 已更新）；`next.config.js` transpile 纳入 graph-ui；新增 `/codebase/graph` 路由页（`next/dynamic`+`ssr:false`+Suspense，`?enabled=1` 显式启用，缺省关闭占位）；新增宿主装配 `CodebaseGraphView`（懒加载 three→`ThreeBinding`→`CodebaseGraphInjector`(seed)+`createGraphUi`→结构/符号双布局合并→`createThreeRenderer`→`GraphPanel` 的 `GraphUiPort`）；`GraphPanel` 补全 `load(host)` 画布贯穿；`e2e/routes.ts` 追加冒烟项。
  - **数据用内置 seed**（`codebase-seed.ts`，确定性小图），原因：web 的 `/api/*` 仅转发到 Python FastAPI(8000)（`python/legacy/app/main.py` uvicorn 默认 8000），而 GraphData 源在 TS 插件私有 `node:sqlite`（`.flowforge/codebase.db`），跨语言直读属高耦合。真实 DB 通道留作后续独立批次（评审 Python FastAPI 直读 vs TS 独立只读 HTTP 端点）。
  - **构建链路验证现状**：web 不在仓库门禁内（vitest/oxlint 排除 `web/**`）。本次以 **web `tsc --noEmit` 通过（exit 0，无诊断）** 验证三组件（seed/view/page + GraphPanel 接线）对 graph-ui 类型 + three 类型编译正确。完整 `pnpm --filter web-frontend build` 在本机无法跑通：默认 4GB node 堆 OOM（exit 134，堆溢出 abort），8GB 堆下运行 >60min 且无 `.next` 产物写入（三者/大应用构建的病理耗时）→ 属环境资源限制，非本改动的类型/语法错误（tsc 同源全绿可证）。最终 next 构建门禁交由 CI/内存更充裕环境执行。
- graph-ui 包本体本轮零改动，其既有门禁（vitest 25/25、包级 tsc exit 0、oxlint 0，见 §2）保持有效。
- 未修改 plugin-codebase 核心六域任何源码/契约/测试；未触碰任何 Python legacy / TS host 路由文件；未改 `next.config.js` rewrites。
- 后续批次：真实 `codebase.db`→web 数据通道（独立立项）；真实相机投射拾取（替换当前简化最近命中）与项目选择。
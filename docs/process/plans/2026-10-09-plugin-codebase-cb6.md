# plugin-codebase — EP-CB6 graph-ui 3D 可视化（总体计划）

- 日期：2026-10-09
- 隶属：EP-CB 系列（@flowforge/plugin-codebase）；本质归属 EP2 前端融合批次（Q17/D-CB4，非核心链路）
- 前置：EP-CB0/1/2/3/4/5 全部 ✅ 已交付（见 `docs/refactor/review_code.md` §13.0）；`@flowforge/plugin-codebase` 只读查询面完整可用
- 决策点：Q17（已裁决纳入范围）、Q22（本批次执行方式，见 `docs/refactor/review_code.md` §15）
- 流程：docs-first（review_code.md/34-stage 登记 → plan → design → 评审 → 实现 → 门禁 → mgr 提交）

---

## 1. 背景与问题

C 源项目 `codebase-memory-mcp` 内置 web 服务提供知识图谱 3D 可视化（graph-ui）。Q17 已裁决将其纳入移植范围，归属 **EP2 前端融合**、作为**非核心链路**追加（`34-stage` D-CB4），且程序审计明确要求「作为新指令批次在 34-stage 增登后再动工」——本批次即该增登的执行落地。

当前 flowforge 侧：
- `@flowforge/plugin-codebase` 已具备完整只读查询面（store/query/search/semantic/architecture/cypher），覆盖结构层树（Project→Folder→File→Module）与符号层（Function/Method/Class/Interface/Enum/Type/Variable + CALLS/USAGE/INHERITS/IMPLEMENTS 等边）及定义锚点（shortName/startLine/endLine）——这正是 3D 可视化的数据底座。
- `web/` 前端为 Next.js 14 + React 18，**尚无任何图可视化依赖**（无 three.js / force-graph / cytoscape / d3）。

## 2. 目标（EP-CB6）

为代码知识图谱提供**只读 3D 可视化浏览**：结构层树 + 符号层节点/边/标签渲染，支持「按标签浏览 → 按锚点定位到定义」的浏览闭环。

### 2.1 验收可测结果
1. `@flowforge/graph-ui` 图可视化数据契约层：注入式数据源 seam（只读消费 codebase.db 查询面），输出归一化 `GraphData`（Nodes/Edges/标签/锚点）。
2. 布局为**契约定点纯函数**（结构层树套壳层次布局 + 符号层力导向布局，坐标 seam 注入式），可单测断言。
3. three.js 渲染 seam（渲染器注入式 RendererPort），React/DOM 胶水隔离，不绑定数据契约层。
4. web 前端 3D 面板接入：路由 + 面板组件，默认关闭 / 仅显式启用（对齐 audio-proxy 显式启用先例，避免陌生人加载重 GPU 页面）。
5. 契约测试锁定：graph-data / 布局 / 渲染 seam 三类；vitest / tsc / oxlint / ff_doctor 全绿。

## 3. 交付物

| # | 产物 | 落点 | 状态 |
|---|---|---|---|
| 1 | review_code.md / 34-stage 登记（§13.0 / §15 Q17/Q22 / §16 计划表） | `docs/refactor/{review_code.md,34-stage-ep-cb-plugin-codebase.md}` | ✅ 本次完成 |
| 2 | 总体计划 | `docs/process/plans/2026-10-09-plugin-codebase-cb6.md` | ✅ 本次完成 |
| 3 | 方案设计 | `docs/process/specs/2026-10-09-plugin-codebase-cb6-design.md` | ⏳ 下一步 |
| 4 | 评审记录 | `docs/process/reviews/2026-10-09-plugin-codebase-cb6.md` | 待 operator 评审 |
| 5 | 实现 + 契约测试 | `packages/plugins/graph-ui/src/**` + `tests/**`；web 前端 3D 面板接入 | 评审后 |
| 6 | 验证证据 | `docs/process/verifications/plugin-codebase-cb6.md` | 实现后 |

**包落点决策（Q22 提案）**：独立包 `packages/plugins/graph-ui`（`@flowforge/graph-ui`）承载数据契约层 + 布局纯函数 + 渲染 seam，与 `@flowforge/plugin-codebase` 解耦（仅通过其**只读查询面**消费数据），web 作为消费端接入。理由：graph-ui 本质是 EP2 前端融合域（非 plugin-codebase 核心六域），独立包避免反向耦合、便于渲染层按前端宿主演进。

## 4. 阶段划分（批次）

### 批次 T6.1 — 独立根因定位 / 登记收尾
- review_code.md §13.0 EP-CB6 条目、§15 Q22、§16 计划表 EP-CB6 行；34-stage EP-CB6 任务清单（T6.1–T6.7）。✅ 本次完成。

### 批次 T6.2 — 数据契约层（`@flowforge/graph-ui` 核心）
1. 包骨架：`package.json` 对齐 plugin-dev 模板 + tsconfig + 根 tsconfig.host.json 挂接 + vitest 装配。
2. `GraphData` 归一化触点：`GraphNode`（id/label/name/filePath/anchors: shortName,startLine,endLine）/ `GraphEdge`（source,target,type）/ `GraphData`（nodes,edges,meta）。
3. 只读数据源 seam `GraphDataPort`：`loadStructureTree(projectId)`/`loadSymbolGraph(projectId, labelFilter?)`/`loadAnchors(nodeId)`；消费 `@flowforge/plugin-codebase` 只读查询面（store/query），`MemoryGraphDataPort` 注入实现。
4. 边界：**只读消费，不写 DB、不重写索引**；数据契约层不 import 渲染栈。

### 批次 T6.3 — 布局纯函数
- `layoutStructureTree`（嵌套子树层次坐标）、`layoutSymbolForce`（力导向，注入式坐标 seam / 迭代步数契约）+ 稳定性契约（确定性种子 / 收敛阈值）。契约定点纯函数，可单测。

### 批次 T6.4 — three.js 渲染 seam + web 接入
- `RendererPort` 注入式（`renderGraph(GraphData+Layout)`/`onNodeSelect` 回调），`ThreeForceGraphRenderer` 具体实现（节点/边/标签/锚点绘制）。
- web 前端 3D 面板：新增路由（如 `/codebase/graph?project=`）+ `GraphPanel` 组件，数据经 `@flowforge/graph-ui` 数据 seam 拉取，**默认关闭 / 显式启用**。

### 批次 T6.5 — 门禁与提交
- 全量 vitest、包级 tsc exit 0、oxlint 0、ff_doctor 通过；verification 证据；mgr 提交（PR，commit 格式 `type(scope): desc [sherlock]`）。

## 5. 边界（明确不做）
- **不新增/修改 plugin-codebase 核心查询**——只复用其已交付只读查询面；不接触 graph-model/store/semantic/cypher 等。
- **不做 C 源 graph-ui 的逐行翻译**——只对齐其可视化用户价值（Q17「非核心链路」定位，渲染栈按 flowforge web 前端选型）。
- 不引入 heavy 依赖链；three.js 为唯一新增前端运行时依赖，且仅渲染 seam 内引用。
- 默认关闭/显式启用，避免托管 GPU 页面。

## 6. 风险
- **中**：three.js 依赖与渲染胶水涉及 web 前端构建（Next.js 动态 import / ssr false），需在实现阶段验证打包链路。
- **低**：数据契约层与 plugin-codebase 解耦明确，无反向耦合风险；布局纯函数可隔离单测。
- 既有 web 前端测试若涉及路由清单（routes-smoke），需将新面板路由纳入可达性断言。
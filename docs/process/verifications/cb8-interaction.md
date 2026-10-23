# cb8-interaction 验证证据（verification）

> 铁律：没有新鲜的验证证据，就没有完成宣称（⑩）。

## 元信息

| 字段 | 值 |
|---|---|
| 流程实例名 | `cb8-interaction` |
| 工作流 | change |
| 日期 | 2026-10-22 |
| 设计 | `docs/process/specs/2026-10-22-plugin-codebase-cb8-interaction-design.md` |
| 计划 | `docs/process/plans/2026-10-22-plugin-codebase-cb8-interaction.md` |
| 评审 | `docs/process/reviews/2026-10-22-plugin-codebase-cb8-interaction.md` |

## 需求核对（finish 前置）

- [x] `ThreeBinding` 增 `Vector2`/`Raycaster`；`ThreeForceGraphRenderer` 用真实射线投射替换 `pickNearest`。
- [x] 渲染桩测试：fake `Raycaster` 仿真命中 → `onNodeSelect` 收到真实 `GraphNode`（render.spec 6 例）。
- [x] route handler `?list=1` 返回工程列表；`http-codebase-read` 增 `listHttpProjects`。
- [x] `CodebaseGraphView` 工程下拉 + 切换重装配；缺省回落 URL 参数/seed。
- [x] `GraphPanel` 切换时释放旧渲染与旧容器（评审发现的双画布缺陷已修复）。
- [x] web `tsc --noEmit` exit 0。
- [x] `docs/process/verifications/plugin-codebase-cb6.md` §4 补 EP-CB8 交付证据。

## 浏览器验收（T8，Playwright + chromium）

前置：`pnpm build`（tsdown host face）生成 `packages/plugins/graph-ui/lib/index.js`，`next dev --port 5174`。

1. `GET /codebase-graph/data?list=1`
   - HTTP 200、`Cache-Control: no-store`
   - 响应：`{"projects":[{"name":"flowforge","createdAt":"2026-09-12T05:31:52.423Z","filesIndexed":6575,"lastIndexedAt":"2026-09-12T05:45:45.221Z"}]}`
2. `GET /codebase-graph/data?project=flowforge` → HTTP 200，54,053,886 bytes（既有通道无回归）。
3. `/codebase/graph?enabled=1&project=__seed__`
   - `select[data-project-select]` 出现，`value="__seed__"`，options=`["__seed__","flowforge"]`，可交互（`disabled=false`）
   - 面板 `data-graph-panel="active"`，标题 `代码知识图谱 · __seed__`，pill `7 节点`
   - `canvas` 数量 **1**（修复前为 2），宿主 slot 数量 1，无 pageerror
4. 切换工程 `__seed__ → flowforge`
   - 标题即时变为 `代码知识图谱 · flowforge`，pill 回到 `渲染中…`，旧画布清空（`canvases=0`、`slots=1`）→ 证明端口重建与旧渲染释放生效

## 红-绿回归（评审缺陷）

- [x] 修复前 seed 实测 `canvases=2`（StrictMode 双挂载 + 在途装载竞争）
- [x] 修复后同路径实测 `canvases=1`，切换后 `slots=1`

## 限制与遗留

- **全量图谱渲染**：flowforge 工程 45,721 节点 / 156,073 边在 headless 下 7 分钟未完成首帧（每边一个 `Line`，draw call 过多）。设计明确本批不做分页/LOD/密度优化；数据端点与 seed 渲染均已验证，全量渲染性能留后续批次。
- **运行前置**：web 依赖 `@flowforge/graph-ui` 的 `lib/index.js`（tsdown 产物）。干净工作树直接 `next dev` 会 `Module not found`；需先 `pnpm build`。CI web 线是否先构建 host 包属 CB6 遗留的构建编排问题，不在本批修改范围。
- 本机未跑 `next build`（历史结论：4GB 堆 OOM / 8GB >60min），最终构建门禁交 CI。

## 证据条目（Evidence Log）
### [2026-10-22T12:10:52.747Z] npx vitest run packages/plugins/graph-ui
- **命令**：`npx vitest run packages/plugins/graph-ui`
- **退出码**：0
- **输出摘要**：Test Files 4 passed (4); Tests 26 passed (26)
- **耗时**：3220ms
- **结论**：通过### [2026-10-22T12:10:52.770Z] pnpm --filter web-frontend exec tsc --noEmit
- **命令**：`pnpm --filter web-frontend exec tsc --noEmit`
- **退出码**：0
- **输出摘要**：web tsc exit 0，无诊断
- **结论**：通过### [2026-10-22T12:10:53.094Z] npx tsc --build packages/plugins/graph-ui/tsconfig.json
- **命令**：`npx tsc --build packages/plugins/graph-ui/tsconfig.json`
- **退出码**：0
- **输出摘要**：包级 tsc exit 0，无诊断
- **结论**：通过### [2026-10-22T12:10:53.118Z] pnpm build
- **命令**：`pnpm build`
- **退出码**：0
- **输出摘要**：tsdown host face 构建完成，生成 packages/plugins/graph-ui/lib/index.js (20148 bytes)
- **耗时**：40000ms
- **结论**：通过### [2026-10-22T12:10:53.453Z] npx oxlint packages/plugins/graph-ui
- **命令**：`npx oxlint packages/plugins/graph-ui`
- **退出码**：0
- **输出摘要**：Found 0 warnings and 0 errors (15 files)
- **结论**：通过
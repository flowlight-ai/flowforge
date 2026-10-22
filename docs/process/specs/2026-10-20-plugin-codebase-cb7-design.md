# plugin-codebase — EP-CB7 真实 codebase.db→web 数据通道（方案设计）

- 日期：2026-10-20
- 决策点：承 EP-CB6 §4 后置项「真实 `codebase.db`→web 数据通道（独立立项）」
- 决策依据：EP-CB6 验证证据 `docs/process/verifications/plugin-codebase-cb6.md` §4（seed 替代说明 + 通道方向抉择）
- 代码落点：`web/`（Next.js 14 服务端 route handler + 浏览器侧只读端口）
- 本质归属：EP2 前端融合 / EP-CB6 后续批次，只读消费端，不触碰 plugin-codebase 核心六域

---

## 1. 问题陈述

EP-CB6 交付了 web 前端 3D 图谱渲染闭环，但数据源用的是**内置 seed**（`web/src/components/codebase/codebase-seed.ts` 确定性小图）。真实浏览需求是渲染 `.flowforge/codebase.db`（本地仓库 107MB、1 工程 `flowforge`、6575 files）的真实代码知识图谱。

阻点：GraphData 源在 TS 插件私有 `node:sqlite`（`.flowforge/codebase.db`），而 web 的 `/api/*` 路径被 `next.config.js` rewrites 全部转发到 Python FastAPI(8000)。跨语言直读属高耦合，需独立数据通道。

## 2. 目标（非目标）

### 目标
1. 新增 `@flowforge/plugin-codebase` 服务端 route handler（Next.js 14），进程内 `node:sqlite` 读 `.flowforge/codebase.db`，暴露只读 JSON 端点。
2. route handler 路径**绕开 `/api/*`**，避免被 rewrites 劫持转发到 FastAPI。
3. DB 路径由**环境变量注入**（`FF_CODEBASE_DB`，缺省回落 `<repo>/.flowforge/codebase.db`，与 CLI 约定一致）。
4. 浏览器侧新增 `HttpCodebaseRead` 端口（`fetch` 服务端端点），实现 `CodebaseGraphRead`（nodesOf/edgesOf/anchorOf），**原位替换** `seedCodebaseRead` 接线，`CodebaseGraphInjector` 零改动。
5. seed 保留为无 DB 时的兜底回落（优雅降级），不删既有确定性闭环。

### 非目标
- 不改 plugin-codebase 核心（graph-model/store/semantic/cypher/索引器）任何源码/契约/测试。
- 不改 `next.config.js` rewrites。
- 不做相机投射拾取、项目选择（仍为后置批次）。
- 不引入 WebSocket/实时增量。

## 3. 总体架构

```
web/
├── src/app/
│   └── codebase-graph/
│       └── data/route.ts          # 服务端 route handler（绕开 /api/*，node runtime）
│   └── components/codebase/
│       ├── codebase-seed.ts        # 保留（兜底回落）[既有]
│       ├── http-codebase-read.ts   # 【新】浏览器侧 HttpCodebaseRead（fetch 服务端）
│       └── CodebaseGraphView.tsx   # 【改】接线切换到 httpCodebaseRead
└── next.config.js                  # 不改 rewrites
```

**数据链路**：
```
浏览器 HttpCodebaseRead ──fetch JSON──▶ web route handler
                                          └─▶ @flowforge/plugin-codebase CodebaseStore
                                                └─(node:sqlite)─▶ .flowforge/codebase.db
```
浏览器侧 `HttpCodebaseRead` 实现 `CodebaseGraphRead`，喂入既有 `CodebaseGraphInjector` → `createGraphUi` → 布局/渲染，管道不变。

## 4. 方案

### 4.1 服务端 route handler（web/src/app/codebase-graph/data/route.ts）
- 路径 `/codebase-graph/data`（**非 `/api` 前缀** → 不被 rewrites 匹配，Next.js 自身处理）。
- Next.js 14 默认 Node runtime（非 edge），可 `import` `node:sqlite`。
- 入参：`?project=<id>`（缺省回落当前仓库名）。
- 职责：
  1. 解析 DB 路径：`process.env.FF_CODEBASE_DB` 缺省 `resolve(process.cwd(), '.flowforge/codebase.db')`（web dev server CWD 通常为仓库根；可真化用 `node:process` + 探测）。
  2. `new CodebaseStore(dbPath).open()`，幂等。
  3. `allNodes(project)` / `edgesOf(project)` / `indexNodePaths(project)` 组装响应 JSON（`{ nodes, edges, anchors, project }`），形状对齐 `CodebaseNodeRow`/`CodebaseEdgeRow`/`GraphAnchor`。
- 响应 `Cache-Control: no-store`（数据实时，避免 SW/浏览器缓存）。
- 失败（db 缺失 / 工程不存在 / 解析错）→ 4xx + JSON 错误，浏览器侧回落 seed。

### 4.2 浏览器侧只读端口（web/src/components/codebase/http-codebase-read.ts）
- 新建 `HttpCodebaseRead` 实现 `CodebaseGraphRead`（同步签名：nodesOf/edgesOf/anchorOf）。
- 因 `fetch` 是异步：采用**预取缓存**策略——`factory` 先 `await fetch` 一次拉全量到内存 `Map`，再返回同步只读端口对象（`nodes`/`edges`/`anchorsById`）。
- `anchorOf(nodeId)` 走响应内 `anchors` Map O(1)。对齐 seed 的 `SEED_ANCHORS` 语义。

### 4.3 接线切换（CodebaseGraphView.tsx）
- `buildPort()` 内：`const read = await loadHttpCodebaseRead(project)`（内部 fetch+解析锚点表），失败则 `fallback = seedCodebaseRead`。
- `new CodebaseGraphInjector(read)` → 下游不变。
- 语义：有库读真实，无库演示 seed，两态皆可用。

### 4.4 依赖/路径约定
- `web/package.json` 新增 `@flowforge/plugin-codebase: workspace:^`（仅服务端 route handler 用；node:sqlite 不进浏览器 bundle）。
- 不引入新第三方运行依赖。

## 5. 数据契约描述 / 生命周期
- route handler 每次请求 `open()` 幂等 + 读操作 + 不 `dispose()`（复用连接，防反复开库；进程生命周期由 Next 管理）。
- `HttpCodebaseRead` 预取一次即常驻组件生命周期；`GraphPanel.unmount` 由既有 `dispose` 清理渲染 seam 即可，prefetch 无监听需释放。

## 6. 兼容性与回归风险
- **低（核心）**：只读消费，不改 plugin-codebase 任何契约。
- **中（web 构建）**：`node:sqlite` 只能在服务端 route handler，必须确保不被打进浏览器 bundle（route handler 天然 server）；`tsc --noEmit` 作快速类型门禁（web 不在 repo 门禁，完整 next build 本机 OOM，沿用 EP-CB6 结论）。
- **路径回归**：新路由 `/codebase-graph/*` 不与既有 `/codebase/graph` 页面冲突（不同前缀）。

## 7. 验收清单
- [ ] `web/src/app/codebase-graph/data/route.ts` 存在，路径非 `/api`，环境变量注入 DB 路径。
- [ ] `web/src/components/codebase/http-codebase-read.ts` 实现 `CodebaseGraphRead`，fetch 服务端，锚点 O(1)。
- [ ] `CodebaseGraphView.tsx` 接线切换到 http 端口，失败回落 seed。
- [ ] `web` 包级 `tsc --noEmit` exit 0（真实 db 通道类型编译通过）。
- [ ] 契约定点：seed 保留、injector 零改动、plugin-codebase 核心零改动、rewrites 零改动。
- [ ] `docs/process/verifications/plugin-codebase-cb6.md` §4 后置项补充 EP-CB7 交付证据。
- [ ] mgr 提交 PR（commit 格式合规，`type(scope): desc [sherlock]`，PR #XX）。
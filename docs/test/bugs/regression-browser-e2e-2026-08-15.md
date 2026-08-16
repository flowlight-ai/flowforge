# 第十二轮 浏览器端到端实测缺陷明细（2026-08-15）

> 测试人员：QA（真实浏览器 E2E，遵循 T8 铁律：真实 Chromium + 真实 DOM 验证）
> 测试环境：后端 `uvicorn app.main:app --port 8000`（已启动）、前端 `next dev --port 5174`（已启动）
> 验证手段：Playwright 驱动系统 Chromium 遍历 33 个前端路由 + 真实 DOM 断言 + 失败请求捕获
> 复现脚本（仓库内，可复现）：`tests/e2e/_manual_browser_e2e.py`
>   执行：`.venv/Scripts/python tests/e2e/_manual_browser_e2e.py` → 证据落盘 `/tmp/ff_e2e_report.json`
> 关联主索引：`docs/test/bugs.md`
> 编号区间：P-528 … P-540（全仓连续，不与历史重复）

> 说明：本批 13 单全部为**实跑复现**（真实浏览器 + 真实后端），非静态推测。
> 其中 P-528/P-529/P-530 为前端**未捕获异常导致整页白屏（body 文本长度为 0）**；
> P-531…P-536 为后端接口 **404/422**（前端调用但后端未实现/校验失败）；
> P-537/P-538/P-539 为 React 渲染期警告（hydration mismatch / 缺唯一 key / 重复 key）；
> P-540 为首访引导层**拦截指针事件**导致核心聊天页不可交互。
> 全部工单 `T7/T8 = 是（T8）`，因均经浏览器 DOM 实测。

---

### P-528 — /mission-control 页面读取 undefined.length 未捕获异常导致整页白屏

- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/app/mission-control/page.tsx:22`（MissionControlPage 组件入口）、具体 `.length` 访问点在该页对任务统计字段（doing/done/blocked 等）的读取处
- **现象**：浏览器实测（Playwright，真实 DOM）访问 `http://127.0.0.1:5174/mission-control`，页面 `body` 文本长度为 **0**（整页白屏），控制台/未捕获异常中 `Cannot read properties of undefined (reading 'length')` 出现 **12 次**，并触发 `NotFoundErrorBoundary` 兜底渲染。
  - 复现命令：`.venv/Scripts/python tests/e2e/_manual_browser_e2e.py`（路由 `/mission-control` 条目：`status=200 crash=False body=0 perr=12`）
  - 实测关键输出：
    ```
    [route] /mission-control  status=200 crash=False body=0 cerr=3 perr=12 failreq=0
    page_errors (x12): Cannot read properties of undefined (reading 'length')
    console: The above error occurred in the <NotFoundErrorBoundary> component:
             at MissionControlPage (.../app/mission-control/page.tsx:22:82)
    ```
- **根因判断**：MissionControlPage 在渲染期对某个任务统计数组/对象执行 `.length`，但上游数据（接口返回或初始化值）为 `undefined`，未做空值保护。
- **建议修复**：对统计字段做可选链/默认值（`?? []` / `?? 0`）保护；在取数失败时使用骨架屏而非抛异常；补充该页取数成功/失败的单元测试与 E2E 断言。
- **T7/T8**：是（T8 — 浏览器 DOM 实测白屏）

---

### P-529 — /memory/health 页面 HealthReport 读取 undefined.toFixed 未捕获异常导致整页白屏

- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/memory/HealthReport.tsx:34`（组件入口，错误栈定位行）
- **现象**：浏览器实测访问 `http://127.0.0.1:5174/memory/health`，`body` 文本长度 **0**（白屏），未捕获异常 `Cannot read properties of undefined (reading 'toFixed')` 出现 **14 次**，触发 `NotFoundErrorBoundary`。
  - 复现命令：`.venv/Scripts/python tests/e2e/_manual_browser_e2e.py`（路由 `/memory/health`：`body=0 perr=14`）
  - 实测关键输出：
    ```
    [route] /memory/health  status=200 crash=False body=0 cerr=3 perr=14 failreq=0
    page_errors (x14): Cannot read properties of undefined (reading 'toFixed')
    console: The above error occurred in the <NotFoundErrorBoundary> component:
             at HealthReport (.../src/components/memory/HealthReport.tsx:34:80)
    ```
- **根因判断**：HealthReport 对某个健康指标数值调用 `.toFixed()`，但该指标在接口返回/初始态为 `undefined`（如命中率、压缩率等浮点字段缺省）。
- **建议修复**：所有 `.toFixed()` 调用前做空值与 `isFinite` 校验；指标缺省给 0；增加健康页空数据的降级渲染与单测。
- **T7/T8**：是（T8 — 浏览器 DOM 实测白屏）

---

### P-530 — /signals 页面 SignalCard 读取 undefined.slice 未捕获异常导致整页白屏

- **严重度**：S2 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/signals/SignalCard.tsx:32`（组件入口，错误栈定位行）
- **现象**：浏览器实测访问 `http://127.0.0.1:5174/signals`，`body` 文本长度 **0**（白屏），未捕获异常 `Cannot read properties of undefined (reading 'slice')` 出现 **12 次**，触发 `NotFoundErrorBoundary`。
  - 复现命令：`.venv/Scripts/python tests/e2e/_manual_browser_e2e.py`（路由 `/signals`：`body=0 perr=12`）
  - 实测关键输出：
    ```
    [route] /signals  status=200 crash=False body=0 cerr=4 perr=12 failreq=0
    page_errors (x12): Cannot read properties of undefined (reading 'slice')
    console: The above error occurred in the <NotFoundErrorBoundary> component:
             at SignalCard (.../src/components/signals/SignalCard.tsx:32:11)
    ```
- **根因判断**：SignalCard 对某字符串字段（如摘要/内容预览）调用 `.slice()`，但字段在卡片数据缺失时为 `undefined`。
- **建议修复**：字符串切片前做空值保护（`(x ?? '').slice(...)`）；对残缺信号数据渲染占位而非抛异常；补充卡片数据的单测。
- **T7/T8**：是（T8 — 浏览器 DOM 实测白屏）

---

### P-531 — /admin/observability 健康检查接口 404（8 个服务端口全部探测失败）

- **严重度**：S2 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/components/hub/HubObservabilityTab.tsx:51`（`fetch(\`/api/v1/system/health/${svc.port}\`)` 调用点）
- **现象**：浏览器实测访问 `http://127.0.0.1:5174/admin/observability`，该页发起对 8 个服务端口的健康探测，全部返回 **404**，可观测性健康看板完全无数据（共 16 次失败请求）。后端直接 `curl` 复现：
  - 复现命令（后端直连）：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/v1/system/health/8000` → `404`
  - 前端侧：`for p in 5174 6000 8000 8001 8002 8003 8004 8100; do curl .../api/v1/system/health/$p; done` 全部 404
  - 实测关键输出（Playwright failed_req）：
    ```
    /admin/observability:  HTTP 404 x2  /api/v1/system/health/8000
                           HTTP 404 x2  /api/v1/system/health/5174
                           HTTP 404 x2  /api/v1/system/health/6000
                           HTTP 404 x2  /api/v1/system/health/8100
                           HTTP 404 x2  /api/v1/system/health/8001
                           HTTP 404 x2  /api/v1/system/health/8002
                           HTTP 404 x2  /api/v1/system/health/8003
                           HTTP 404 x2  /api/v1/system/health/8004
    ```
- **根因判断**：后端未实现 `/api/v1/system/health/{port}` 路由（或路径/方法不匹配），导致可观测性页的服务健康探针 100% 失败，整个健康看板不可用。
- **建议修复**：在后端 `app/api` 中实现 `GET /api/v1/system/health/{port}`（或改为批量 `/api/v1/system/health` 返回所有服务状态）；前端对单端口失败做容错（已 `.catch(() => null)`，但需展示“探测失败”而非空白）。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-532 — /admin/mcp 页面 mcp-servers 接口 404（MCP 管理后端未实现）

- **严重度**：S3 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/app/admin/mcp/page.tsx:27`（`fetch("/api/v1/system/mcp-servers")`）
- **现象**：浏览器实测访问 `/admin/mcp`，前端请求 `http://127.0.0.1:5174/api/v1/system/mcp-servers` 返回 **404**，MCP 服务器列表无法加载。
  - 复现命令（后端直连）：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/v1/system/mcp-servers` → `404`
  - 实测关键输出（Playwright failed_req）：
    ```
    /admin/mcp:  HTTP 404 x2  /api/v1/system/mcp-servers
    ```
- **根因判断**：后端未实现 `/api/v1/system/mcp-servers` 路由（与 P-531 同属 system 子路由缺失）。
- **建议修复**：实现该 GET 路由返回已注册 MCP server 列表；或前端在该页改用既有 MCP 注册表接口。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-533 — /memory/graph 记忆图谱接口返回 422（后端校验失败）

- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/memory/CollectionGraph.tsx:50`（`fetch("/api/v1/memory/graph")`）；后端路由于 `app/api`（记忆图谱端点校验逻辑）
- **现象**：浏览器实测访问 `/memory/graph`，前端请求 `/api/v1/memory/graph` 返回 **422 Unprocessable Content**，图谱无法渲染。
  - 复现命令（后端直连）：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/v1/memory/graph` → `422`
  - 实测关键输出（Playwright failed_req）：
    ```
    /memory/graph:  HTTP 422 x2  /api/v1/memory/graph
    ```
- **根因判断**：后端该端点存在但入参/依赖校验失败（如缺查询参数、内存索引未初始化等），返回 422 而非正常图谱数据。
- **建议修复**：核对后端 `memory/graph` 端点的参数与依赖初始化；422 时返回明确错误体；前端对 422 展示错误提示而非静默失败。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-534 — /memory/status 记忆索引状态接口返回 422（后端校验失败）

- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/memory/IndexStatus.tsx:50`（`fetch("/api/v1/memory/index-status")`）；后端路由于 `app/api`
- **现象**：浏览器实测访问 `/memory/status`，前端请求 `/api/v1/memory/index-status` 返回 **422**，索引状态无法显示。
  - 复现命令（后端直连）：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/v1/memory/index-status` → `422`
  - 实测关键输出（Playwright failed_req）：
    ```
    /memory/status:  HTTP 422 x2  /api/v1/memory/index-status
    ```
- **根因判断**：后端该端点校验失败返回 422（与 P-533 同类记忆域接口问题）。
- **建议修复**：同 P-533，核对端点参数/依赖初始化并完善错误返回。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-535 — /admin/governance 治理健康接口 404（后端未实现）

- **严重度**：S3 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/components/hub/HubGovernanceTab.tsx:50`（`fetch("/api/v1/governance/health")`）
- **现象**：浏览器实测访问 `/admin/governance`，前端请求 `/api/v1/governance/health` 返回 **404**，治理健康信息无法加载。
  - 复现命令（后端直连）：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/v1/governance/health` → `404`
  - 实测关键输出（Playwright failed_req）：
    ```
    /admin/governance:  HTTP 404 x2  /api/v1/governance/health
    ```
- **根因判断**：后端未实现 `/api/v1/governance/health` 路由。
- **建议修复**：实现该路由或修正前端调用的路径。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-536 — /admin/marketplace 能力市场 artifacts 接口 404（后端未实现）

- **严重度**：S3 ｜ **分类**：功能缺失（浏览器实测） ｜ **状态**：Open
- **文件**：`web/src/components/marketplace/Marketplace.tsx:35`（`fetch(\`/api/v1/marketplace/artifacts?${params}\`)`）
- **现象**：浏览器实测访问 `/admin/marketplace`，前端请求 `/api/v1/marketplace/artifacts?sort=popular` 返回 **404**，市场作品列表无法加载。
  - 复现命令（后端直连）：`curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8000/api/v1/marketplace/artifacts?sort=popular"` → `404`
  - 实测关键输出（Playwright failed_req）：
    ```
    /admin/marketplace:  HTTP 404 x2  /api/v1/marketplace/artifacts?sort=popular
    ```
- **根因判断**：后端未实现 `/api/v1/marketplace/artifacts` 路由（能力市场后端缺失）。
- **建议修复**：实现该 GET 路由返回作品列表；或前端降级展示“市场暂不可用”。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-537 — ActivityBar 主题切换按钮 title 服务端/客户端不一致导致 React hydration mismatch（系统性，约 30 路由）

- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/ActivityBar.tsx:176`（`跟随系统（当前: ${resolvedTheme === "dark" ? "暗色" : "亮色"}，点击切换到亮色）`）
- **现象**：浏览器实测访问几乎全部路由（首页、/solo、/council、/memory/*、/review、/tasks、/signals、全部 /admin/* 等约 30 个），控制台均出现：
  ```
  Warning: Prop `%s` did not match. Server: %s Client: %s
  title "跟随系统（当前: 暗色，点击切换到亮色）" "跟随系统（当前: 亮色，点击切换到 亮色）"
  at button / at div / at nav / at ActivityBar
  ```
  根因：`resolvedTheme` 在服务端渲染（SSR）与客户端水合时取值不一致（服务端默认暗色、客户端按系统/持久化为亮色），导致 `title` 属性 SSR/CSR 不匹配，每次访问都触发 hydration 警告。
- **复现命令**：`.venv/Scripts/python tests/e2e/_manual_browser_e2e.py`（`cerr` 列在约 30 个路由均含 1 条该警告；`/admin/models` 因二次渲染出现 2 条）
- **建议修复**：主题相关文本改为客户端挂载后再渲染（避免 SSR 输出主题依赖值），或使用 `suppressHydrationWarning` 仅作用于该节点；统一 SSR/CSR 的主题解析来源。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-538 — 多处列表渲染缺唯一 key（Dashboard / TaskListPage / SignalsOverview）

- **严重度**：S4 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/app/page.tsx`（首页 `Dashboard` 列表）、`web/src/app/tasks/page.tsx`（`TaskListPage` 任务行 `<tr>`）、`web/src/components/signals/SignalsOverview.tsx`（`SignalsOverview` 选项 `<option>`）
- **现象**：浏览器实测各页控制台警告：
  ```
  Warning: Each child in a list should have a unique "key" prop.
  Check the render method of `Dashboard`.      (首页 /)
  Check the render method of `TaskListPage`.   (/tasks)
  Check the render method of `SignalsOverview`.(/signals)
  ```
  列表项未设置稳定唯一 `key`，React 复用错位、潜在重复渲染与可控性下降。
- **复现命令**：`.venv/Scripts/python tests/e2e/_manual_browser_e2e.py`（首页 `cerr=2`、/tasks `cerr=2`、/signals `cerr=4` 中均含该 key 警告）
- **建议修复**：为三处列表的 `<tr>`/`<option>`/列表项补上稳定唯一 `key`（优先使用数据 id，避免数组下标）。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-539 — /solo 聊天流渲染出现重复 key（"two children with the same key"）

- **严重度**：S4 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/app/solo/page.tsx`（聊天消息列表渲染，或其所引用的 ChatStream 组件）
- **现象**：浏览器实测访问 `/solo`（已置 `flowforge-guide-completed` 关闭首访引导后），向聊天框输入并提交后，控制台出现 **4 次**：
  ```
  Warning: Encountered two children with the same key, `%s`. Keys should be unique ...
  ```
  聊天消息流存在重复 key，可能导致消息节点重复渲染/状态错乱。
- **复现命令**：
  ```
  .venv/Scripts/python tests/e2e/_manual_browser_e2e.py   # /solo 条目 cerr=5，其中 x4 为重复 key 警告
  ```
  或直接交互复现：置 localStorage 后访问 `/solo`，在 textarea 输入并提交，观察 console。
- **建议修复**：聊天消息列表使用消息唯一 id 作为 `key`；排查是否存在同一消息被重复 push 或 id 生成重复。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

### P-540 — GuideOverlay 非目标步骤缺 pointer-events-none，首访拦截指针事件致 /solo 不可交互

- **严重度**：S3 ｜ **分类**：代码缺陷 ｜ **状态**：Open
- **文件**：`web/src/components/GuideOverlay.tsx:187-191`（无 target 的居中引导步：欢迎步、紧急刹车步的覆盖层 `className="fixed inset-0 z-[9995]"` **缺少** `pointer-events-none`）
- **现象**：首次访问（localStorage 无 `flowforge-guide-completed`）时，欢迎/紧急刹车等**无目标元素**的引导步渲染全屏 `z-[9995]`、`rgba(0,0,0,0.6)` 覆盖层，**未加 `pointer-events-none`**，拦截全部指针事件。浏览器实测：`/solo` 聊天输入框被 `data-guide-overlay="true"` 拦截，`ElementHandle.click` 超时（该覆盖层 `intercepts pointer events`）。与同文件有目标步骤的分支（line 179 带 `pointer-events-none`）行为不一致，且该组件注释自述“不阻塞应用渲染（半透明覆盖层 + 高亮目标）”与实际不符。
  - 复现命令：清空 localStorage 后 `.venv/Scripts/python` 打开 `/solo`，或：
    ```
    .venv/Scripts/python - <<'PY'
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b=p.chromium.launch(headless=True); pg=b.new_page()
        pg.goto("http://127.0.0.1:5174/solo", wait_until="load", timeout=90000)
        pg.wait_for_timeout(2000)
        ov=pg.query_selector("[data-guide-overlay=true]")
        print("overlay_present=", ov is not None)   # 首访 True，且拦截点击
    PY
    ```
- **根因判断**：`GuideOverlay` 非目标步骤的覆盖层 div 漏写 `pointer-events-none`，与有目标分支不一致，导致整屏不可点击。
- **建议修复**：将无目标步骤覆盖层（line 187-191）补上 `pointer-events-none`（与 line 179 一致）；或统一用一层始终 `pointer-events-none` 的遮罩 + 独立可点击的气泡。
- **T7/T8**：是（T8 — 浏览器 DOM 实测）

---

## 本轮汇总（P-528…P-540）

| ID | 标题 | 严重度 | 分类 | 状态 | 文件:行号 |
|----|------|:----:|------|:----:|----------|
| P-528 | /mission-control 白屏（undefined.length） | S2 | 代码缺陷 | Open | `web/src/app/mission-control/page.tsx:22` |
| P-529 | /memory/health 白屏（undefined.toFixed） | S2 | 代码缺陷 | Open | `web/src/components/memory/HealthReport.tsx:34` |
| P-530 | /signals 白屏（undefined.slice） | S2 | 代码缺陷 | Open | `web/src/components/signals/SignalCard.tsx:32` |
| P-531 | /admin/observability 健康检查 404（8 端口） | S2 | 功能缺失（浏览器实测） | Open | `web/src/components/hub/HubObservabilityTab.tsx:51` |
| P-532 | /admin/mcp mcp-servers 404 | S3 | 功能缺失（浏览器实测） | Open | `web/src/app/admin/mcp/page.tsx:27` |
| P-533 | /memory/graph 422 | S3 | 代码缺陷 | Open | `web/src/components/memory/CollectionGraph.tsx:50` |
| P-534 | /memory/status index-status 422 | S3 | 代码缺陷 | Open | `web/src/components/memory/IndexStatus.tsx:50` |
| P-535 | /admin/governance governance/health 404 | S3 | 功能缺失（浏览器实测） | Open | `web/src/components/hub/HubGovernanceTab.tsx:50` |
| P-536 | /admin/marketplace artifacts 404 | S3 | 功能缺失（浏览器实测） | Open | `web/src/components/marketplace/Marketplace.tsx:35` |
| P-537 | ActivityBar 主题 title hydration mismatch（系统性） | S3 | 代码缺陷 | Open | `web/src/components/ActivityBar.tsx:176` |
| P-538 | 列表缺唯一 key（Dashboard/TaskListPage/SignalsOverview） | S4 | 代码缺陷 | Open | `web/src/app/page.tsx`、`web/src/app/tasks/page.tsx`、`web/src/components/signals/SignalsOverview.tsx` |
| P-539 | /solo 聊天流重复 key | S4 | 代码缺陷 | Open | `web/src/app/solo/page.tsx` |
| P-540 | GuideOverlay 非目标步缺 pointer-events-none 拦截交互 | S3 | 代码缺陷 | Open | `web/src/components/GuideOverlay.tsx:187-191` |

**严重度分布（本轮新增）**：S2×4、S3×7、S4×2
**分类分布（本轮新增）**：代码缺陷×9、功能缺失（浏览器实测）×4
**本轮新增 DI 增量** = 4×5 + 7×2 + 2×1 = **36**
**T7/T8 关联**：全部 13 单均为 T8（浏览器 DOM 实测）

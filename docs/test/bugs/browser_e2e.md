# 浏览器端到端实测证据（browser_e2e.md）

> 配套 `bugs.md` v4.1。记录**真实启动前端+后端、用 Playwright 驱动系统 Chrome 实操产品**的测试方法与原始证据。
> 临时驱动脚本 `_browsertest/driver*.js` 与原始结果 `_browsertest/result*.json`、`_browsertest/oa.json`、`_browsertest/route_verify*.txt` 为辅助验证产物，跑完清理；**崩溃页证据已固化为 `docs/test/bugs/evidence/U0*.png`**。

## 1. 测试环境

- 后端：`uvicorn flowforge.app.main:app` @ `127.0.0.1:8000`（真实启动，`/health`=200）。
- 前端：`cd web && npm run dev`（Next.js 14.2.35）@ `127.0.0.1:5174`，代理 `/api`、`/ws` → 后端 8000。
- 浏览器：Playwright 1.62.1 + 系统 Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`（未下载 chromium，用系统浏览器）。
- 真实 LLM 后端：不可用（`OPENROUTER_API_KEY` 占位符 / OpenRoute :13001 未起）→ 需 LLM 的完整工作流标 Blocked。

## 2. 测试方法

1. **路由全扫**：遍历 38 个前端路由（来自 `web/src/app` 真实目录），逐页捕获：
   - `console` error/warning
   - 未捕获 JS 异常（`pageerror`）
   - 失败网络请求（`requestfailed`）
   - HTTP 4xx/5xx 响应
   - 页面 body 文本长度、是否触发 React 错误边界、最终 URL
   - 逐页截图
2. **核心流实操**：对 4 条用户流做真实交互（填表/点击/发送）：
   - Helm 对话（`/solo` 发消息）
   - tasks 创建（`/tasks` 提交任务）
   - agents 锻造（`/admin/agents` 点新建/Forge）
   - council 议事（`/council` 发消息）
   捕获交互前后 console/pageerror/http 增量。
3. **API 契约交叉比对（产出 P-34~P-37 的核心证据）**：
   - 抓后端 OpenAPI 路由表（`/openapi.json`，共 187 条 `/api/v1` 路径）作为**权威路由基线**。
   - grep 前端 `web/src` 真实 `fetch` 路径（146 条）。
   - 逐路径匹配：前端路径在后端 OpenAPI 中**无对应路由模式** = 真实缺失（curl 复测 100% 404）；`/tasks/{id}`、`/workspace/{id}/*`、`/prompts/{id}` 等因使用假 ID 返回 404 的属应用层 404（路由存在），已过滤不计。
   - 对照 `docs/spec.md` §4.1：SRS 规定的 5 个核心 `/api/v7/*` 接口后端均未实现（全部 404）= P-36。
4. **深层交互驱动（driver3.js，加固版）**：逐页点击前 6 个可见按钮 + 输入框真实填"测试消息"并提交，单页 45s 硬预算、增量落盘、16min 全局上限（避免卡死）；捕获 BTN_PAGEERR / FLOW_PAGEERR（S1 未捕获异常）与 BTN_HTTP / FLOW_HTTP（后端异常）。

## 3. 路由扫描汇总（节选）

| 路由 | body | 崩溃 | consoleErr | pageErr | http4xx |
|------|:----:|:----:|:----:|:----:|:----:|
| / | 1070 | – | 5 | 0 | 2 |
| /tasks | 874 | – | 4 | 0 | 2 |
| /solo | 1848 | – | 7 | 0 | 2 |
| /council | 679 | – | 3 | 0 | 2 |
| /mission | 155 | – | 4 | 0 | 3(含文档404) |
| **/mission-control** | **0** | **✅** | 5 | **12** | 2 |
| **/mission/ff-m-001** | **0** | **✅** | 5 | **14** | 2 |
| /mission-hub | 252 | – | 3 | 0 | 2 |
| **/memory/health** | **0** | **✅** | 5 | **14** | 2 |
| /memory/graph | 241 | – | 5 | 0 | 4 |
| /admin/observability | 2670 | – | 19 | 0 | 18 |
| /admin/quotas | 338 | – | 7 | 0 | 6 |
| /admin/models | 179 | – | 3 | 0 | 2(+1 reqFail) |
| /admin/tools | 381 | – | 5 | 0 | 4 |

> 完整 38 路由明细见 `_browsertest/result.json`。

## 4. 崩溃页证据截图

| Bug | 路由 | 截图 |
|-----|------|------|
| P-27 | /mission-control | `docs/test/bugs/evidence/U01_mission-control_crash.png` |
| P-28 | /mission/ff-m-001 | `docs/test/bugs/evidence/U02_mission-detail_crash.png` |
| P-29 | /memory/health | `docs/test/bugs/evidence/U03_memory-health_crash.png` |

## 5. 原始信号统计（未归并，供溯源）

- 原始信号总数：339 条
- 按类型：HTTP_404 ×113、CONSOLE_Failed-to-load-resource(404) ×110、CONSOLE_Prop-did-not-match(hydration) ×38、PAGE_ERROR ×40、HTTP_422 ×4、CONSOLE_key-warning ×6、CONSOLE_Cannot-update-component ×3、REQ_FAILED ×1、ERROR_BOUNDARY ×3
- **归并原则（BUG_PROTOCOL 一因一单）**：同一根因跨多页/多端点出现只立一单。原 v4.0 将"前端 API 路由缺失"按端点拆成 P-14~P-25（12 单）违反 B4，v4.1 作废归并为 P-34（路径不匹配·9 家族）、P-35（功能未实现·22 家族）、P-37（记忆 422·4）；新增 P-36（SRS §4.1 `/api/v7/*` 未实现·5）。3 个崩溃页 = P-27/28/29。
- 归并后有效缺陷：**32 单（DI=175）**，作废归并 12 单（P-14~P-25，编号保留不复用），见 `bugs.md`。

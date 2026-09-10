# FlowForge 重构任务总注册表与进度（EP0-EP4）

> **本文档作用**：TS 重构剩余全部工作的任务注册与进度跟踪单一事实来源（勾选状态）。
> 任务内容登记以 `review_code.md` §13 为准（含来源编号 A/B/D/C/F），EP0 详细任务清单以
> `33-stage-ep0-plugin-dev.md` 为准（T0.x.y 级 checklist），本文件负责**进度状态**的统一维护。
>
> **维护规则**：
> - 每完成一个批次/任务：在本文件勾选 ✅ 并标注 PR 号与完成日期；同步勾选 `10-stage-map.md` §3.0 矩阵。
> - EP0 完成后，所有批次交付必须走 forgeProcess 七阶段流程（design→plan→implement→review→verify→finish→mgr PR）。
> - 待 operator 决策项（⚠）见 `review_code.md` §15，不阻塞已裁决批次。
>
> 状态图例：⬜ 未开始 ｜ 🟦 进行中 ｜ ✅ 完成（含 PR 号）｜ ⚠ 待 operator 裁决后排期

---

## EP0 工程化流程插件 `@flowforge/plugin-dev`（最高优先级，5 批次）

> operator 2026-09-07 裁决（Q7/Q8/Q9）：插件定名 `@flowforge/plugin-dev`，包路径 `packages/plugins/dev`，
> 流程文档自 `docs/process/` 起步；四源全量移植（flowforge Python 旧版 + dsh + clowder-ai + superpowers）。

| 批次 | 内容 | DoD | 状态 |
|---|---|---|---|
| EP0-1 | 插件骨架（状态机/实例注册表/类型面）+ `docs/process/` 建立 + 14 份流程指令资产移植 | 状态机单测全绿；14 份资产入库 | 🟩 |
| EP0-2 | 4 份文档模板（design/plan/review/verification）+ No-Placeholder 校验器 + 单测 | 校验器拦截 TBD/TODO/无代码块步骤 | 🟩 |
| EP0-3 | `ff_` CLI 命令族（operator 指令替换 `flowforge process *` 前缀）+ 四工作流模板 + 实例持久化 + 门禁接线 | CLI 端到端冒烟 + 门禁单测 | 🟩 |
| EP0-4 | ff_doctor 遵从度四模式 + 入口三件套 + ts-ci.yml + subagent 派发编排（NullDispatcher 降级）+ 两阶段审查（P1/P2/P3）+ verification 证据采集 | 真实小需求走完七阶段验收（实例 `ep0-plugin-dev` 7/7 完结，`ff_doctor all` 合规） | 🟩 |
| EP0-5 | 规范回填（`docs/rules/13-dev-process.md` + AGENTS.md 三件套 + 04-code-standards 联动）+ 流程切换声明 + 存量治理基线 | 规范体系更新；此后所有批次走 forgeProcess | 🟩 |

> EP0 全批次完成（2026-09-07）。遗留接线项：`ctx.forgeProcess` cordis 挂载与 mgr 前置 `ff_doctor`（D5）
> 随 harness/mgr 独立批次实施；存量文档/代码治理（T0.7.2/T0.7.3）按 D2 节奏并入 EP1-EP4（台账
> `docs/process/governance.md`）。此后所有批次交付必须走 forgeProcess 七阶段流程（`docs/rules/13-dev-process.md` §13.7）。

### EP0-1 细化任务（T0.x.y，详见 `33-stage-ep0-plugin-dev.md`）

- [x] T0.1.1 `packages/plugins/dev/package.json`（@flowforge/plugin-dev，ESM，对齐 canary/modes 包形态）
- [x] T0.1.2 `tsconfig.json` + 根 `tsconfig.host.json` references 增补
- [x] T0.1.3 `src/state-machine.ts`：七阶段 ProcessPhase + 合法迁移表 + 三道门禁 + ForgeProcessStateMachine
- [x] T0.1.4 `src/registry.ts`：ForgeProcessRegistry（create/get/list + 产物路径登记）
- [x] T0.1.5 `src/index.ts` 导出面 + `tests/dev.spec.ts`（合法推进/非法跳转/门禁三例/registry round-trip，16/16 绿）
- [x] T0.1.6 `docs/process/README.md`（双平面说明/目录索引/七阶段流程图/AI 工具使用指引）
- [x] T0.1.7 移植 14 份流程指令资产至 `docs/process/skills/`（①brainstorming ②writing-plans ③executing-plans
      ④subagent-driven-development ⑤dispatching-parallel-agents ⑥test-driven-development
      ⑦requesting-code-review ⑧receiving-code-review ⑨systematic-debugging ⑩verification-before-completion
      ⑪using-git-worktrees ⑫finishing-a-development-branch ⑬writing-skills ⑭using-plugin-dev）
- [x] T0.1.8 `pnpm vitest run packages/plugins/dev` 全绿 + `pnpm typecheck` 通过
- [x] T0.1.9 `10-stage-map.md` §3.0 勾选（P1-P4）+ 本文件进度更新
- [x] T0.1.10 `./mgr sync` 提交 PR（docs + code 同批，commit `5af3c6c3` → PR #152）

---

## EP1 三源 P0 遗漏项移植（16 项，约 14 批次）

> 内容与来源编号见 `review_code.md` §13.2；⚠ 项（Q1/Q3/Q5/Q6）需 EP1 前裁决。

| 序 | 任务 | 来源 | 预估批次 | 状态 |
|---|---|---|---|---|
| 1 | `mcp-server` 整包（工具治理全家 + 6 toolsets + protocol-server）⚠Q3 | B1 | 2 | 🟩（EP1-1a 治理框架本体 + registry + snapshot + protocol-server 落 `packages/mcp/mcp-server`，PR #163；EP1-1b 六 family 工具清单待领域层） |
| 2 | `infrastructure/connectors` IM 框架本体 | B7 | 2 | 🟩（EP1-2 框架本体落 `packages/infrastructure/connectors`：Router/CommandLayer/Formatter/PermissionStore/ThreadBindingStore+Redis/Dedup/OutboundDeliveryHook/StreamingOutboundHook/mention/rich-block-plaintext/external-registry/gateway，12 测试 77/77 绿，tsc/oxlint 全绿；适配器+github-repo-event+media 待 EP2/EP4） |
| 3 | `chat/messaging` 域（envelope/ledger/snapshot + Redis）⚠Q6 | B4 | 1 | 🟩（EP1-3：envelope 投影 + handles + ledger + Memory stores + contract（host-types/source-admission/validate）+ @flowforge/plugin-contract messaging 契约类型，落 `packages/chat/messaging`，7 测试 50/50 绿、包级 tsc exit 0、oxlint 0；send/append/event-stream/snapshot-*/messaging-service/Redis Lua 归 EP1-4） |
| 4 | `cats/signal-intake` 域（25+ 文件）⚠Q6 | B3 | 2 | 🟩（**EP1-4**：SignalAdmission/MeetingIntake 服务与 Memory+Redis stores/契约（events-publish/signals/meeting-intake-codec）/来源访问租约/ThreadDestinationAuthority/ASR 人物记忆场景+队列载体/MeetingArtifactResourceService+read-budget+minutes-reference/ThreadMeetingArtifactDispatcher、注入式 Redis seam + 交付端口（宿主 EP2/EP4 接线），落 `packages/cats/signal-intake`（@flowforge/cats-signal-intake），18 契约测试 109/109 绿、包级 tsc exit 0、oxlint 0；LarkCliFeishuSourceResolver 凭据适配、真实队列/消息 store 接线归 EP2/EP4） |
| 5 | `infrastructure/github-signals` 域 | B5 | 1 | 🟩（**EP1-5**：GitHubWaitLifecycleService/predicate catalog/baseline readers/wait state-machine/review-loop-brake renderer + 注入式端口（ITaskStore/ConnectorDelivery/IWaitLifecycleEventLog）+ 内存实现，落 `packages/infrastructure/github-signals`（@flowforge/infrastructure-github-signals），59 契约测试 59/59 绿、包级 tsc exit 0、oxlint 0；真实 GitHub API 适配、TaskStore 宿主接线、真实连接器投递、eventLog 持久化归 EP2/EP4） |
| 6 | `cats/context-assembly`（17 文件） | B12 | 1 | 🟩（**EP1-6**：Message Bundle 选择/投影/carrier 解析 + IntentParser + governance-L0 编译 + prompt-template-loader + L0 staging content + chat history ContextAssembler/SystemPromptBuilder + 注入式端口（MessageStore/ThreadStore/CatContext/FileSystem + 存储/配置/file/dossier/model/prompt 纯函数 seam）+ 内存契约实现，落 `packages/cats/context-assembly`（@flowforge/cats-context-assembly），纯函数契型 + MessageSelectionResolver 全部消息源/预算/回退 + governance 段裁剪排序守卫 + prompt 外部化，2 契约测试 58/58 全绿、包级 tsc exit 0、oxlint 0；真实 LLM/embedding 客户端、宿主 prompt 目录、真实 store/Redis、宿主 Quadratic/reservation 接线归 EP2/EP4） |
| 7 | `api/session-controller` + `settings-controller` + `workspace-controller` | A1-A3 | 1 | 🟩（**EP1-7**：REST 控制器族 seam 落 `packages/api/rest-controllers`（@flowforge/api-rest-controllers）：REST seam（HttpRequest/HttpResponse）框架无关 + 注入式端口（session-chain/handoff/runtime/strategy-config/transcript + workspace/workspace-edit/workspace-git/navigate + settings 控制器）+ 纯函数 seam（git-parsers/edit-token/session-strategy/thread-access/transcript-format/workspace-tree）+ workspace-security 工作区守护，10 契约测试 111/111 全绿、包级 tsc exit 0、oxlint 0；宿主 Fastify/Express 与真实 store/fs/git 接线归 EP2） |
| 8 | `session-format` 4 包 + `session-log-export` | A17/A20 | 1 | 🟩（**EP1-8**：`@flowforge/session-format`（codec/chain/catalog/error/json/filename 纯机制）+ `-v0-to-v1`（冻结 v0/v1 codec + 身份迁移）+ `-v1-to-v2`（assistant-stream 折叠 + seq 重映射 + 端 seed 截断）+ `-catalog`（装配 v0→v1→v2 唯一 `sessionFormatCatalog`，currentVersion=2，InstalledSessionPort 注入）+ `@flowforge/session-log-export`（JSONL 规范化 + 血缘深序/去重的 ZIP 流式导出 + HTTP 下载路由 + 浏览器下载控制器，注入式 HostContextPort/DownloadContextPort/SnapshotStorePort/LiveSessionStoreSeam/源/附件/血缘 seam + 内存契约实现），5 包 21 文件 **349/349 契约测试全绿**、包级 tsc exit 0、oxlint 0、零 @deepseek/@cat-cafe/@clowder 引用、fflate 合规 host 依赖；宿主 cordis/connection/真实 store 接线归 EP2） |
| 9 | `webhook` 2 包 | A29 | 1 | 🟩（**EP1-9**：`@flowforge/webhook`（fire-and-forget 规则运行时：请求校验 + 规则匹配 + Workspace-backed Session 创建编排，注入式请求/分发/会话/工作区/llm/品牌/性能 seam + 内存实现 + 纯函数 invariant/request/dispatch 抽离）+ `@flowforge/webhook-github`（签名 GitHub HTTP 适配器：node:crypto 自实现 `x-hub-signature-256` HMAC-SHA256 恒定时间验签 + body 受限摄入 + 事件→rule 分发 + 纯函数 signature/http 抽离），落 `packages/webhook/*`，5 契约测试文件 **93/93 全绿**、包级 tsc exit 0、oxlint 0、零 @deepseek/@cat-cafe/@clowder 引用（@octokit/webhooks 未依赖，改自实现 HMAC 验签，协议一致）；宿主 credentials/host-webserver 接线归 EP2/EP4） |
| 10 | `credentials/authorization` | A8 | 0.5 | 🟩（**EP1-10**：plugin-owned 凭据获取授权 seam（`ctx.authorization` 等价）落 `packages/credentials/authorization`（@flowforge/credentials-authorization）：wire-safe 类型面 + AuthorizationService（flow 注册/attempt 管理/结算）+ Declined/迭代 prompts + 注入式端口（CredentialsRecordStore/HostContextPort/InvariantSink/EventLog）+ 内存实现 + invariant companion + 纯函数 seam 抽离，重写为注入 seam 设计（原 cordis Service/Context feathers、dsh-credentials CredentialKey/describeRecord、dsh-invariants companion 全部化为包级端口），唯一复用上游 `HarnessError`（@flowforge/llm）；3 契约测试文件 **50/50 全绿**、包级 tsc exit 0、oxlint 0、零 @deepseek/@cat-cafe/@clowder 引用；宿主 cordis/surface 接线归 EP2） |
| 11 | `extensions/ui-cordis` + `cordis-client-runner` | A9/A10 | 1 | 🟩（**EP1-11**：`@flowforge/cordis-client-runner`（A10 动态包浏览器运行时：evaluator/guard-facade/runtime 加载者/orchestrator/inspect-registry/定时器/API 目录，`ClientSlotsPort`/`ServiceHostPort`/`StyleDocumentPort`/`LoaderModulesPort`/`CordisRunHostSeam` 注入式端口 + 内存实现 + 装载器 src，7 契约文件 52/52 绿）+ `@flowforge/ui-cordis`（A8/D50 展示逻辑，纯逻辑抽离 React/DOM：card-model/status/inventory 单飞读重连复位/run-card supersession 索引/locales，`HostObservable`/`ToolCallViewModelBlock`/`CordisDynamicPort` seam，4 契约文件 30/30 绿），**82/82 全绿**、包级 tsc exit 0、oxlint 0、零 @deepseek/@cat-cafe/@clowder 引用；React 渲染/slot 注入/斜杠源/Remote 接线归 EP2） |
| 12 | `bundle/web-app`（+acp/sdk 模板） | A4-A7 | 1 | 🟩（**EP1-12**：四装配模板包落 `packages/bundle/*`。`@flowforge/web-app`（A4 浏览器 surface bundle，胶水 `name='web-app'`：dist 经 `@flowforge/host-frontend-static` 回退、`app:web-surface` prompt section、`FF_WEB_URL` bash 变量、URL line + 默认浏览器移交，`resolveLanTrust` 纯函数 + `internals{resolveDistIndex,openBrowser}` 注入 + `startup` 旗子 `--host/--no-open/--port/--trusted-host` + patch 跨 base 层）、`@flowforge/acp-app`（A5 ACP stdio `acp-app-startup` + `exitOnStdinEnd` + patch 跨 base）、`@flowforge/sdk-app`（A6 SDK stdio `sdk-app-startup` + patch 跨 base：sdk-jsonrpc-server/maxTokensAsSuccess）、`@flowforge/sdk-minimal`（A7 独立最小 SDK 树 26 行 insert：llm-deepseek/sandbox/session/tools/agent/agent-loop/invariants/terminal 等）。全映射现 @flowforge 等价包 + `FF_*` env + 零 @deepseek 引用；`@flowforge/cmdline` 增补 `exitOnStdinEnd`（loader 结算为就绪锚，含 stdin 注入 seam）；4 包 tsc exit 0、oxlint 0；**9 测试文件 25/25 契约测试全绿**；浏览器 client-ui 行、message-feedback/workspace/session-reference/file-reference/agent-presets 具体 roster 等留 EP2 期） |
| 13 | dsh `client/*` 能力级清单登记（归入 EP2 实施） | A32 | — | ✅ **EP1-13 完成**（2026-09-09）：能力级对照表落 `28-stage8-web.md`（46 包按 UI 能力归组 → 落点 T 任务），review_code A32/Q2 同步为已登记；代码融合随 EP2 阶段 8 逐批推进 |
| 14 | 矩阵补录：`10-stage-map.md` 增设 D45+/C43+/F45+ 编号 + crosswalk 漂移纠偏 | 文档 | 0.5 | 🟩（`10-stage-map.md` D45-D55/C43-C51/F45 补录 + crosswalk L31/L41/L59/L80 漂移纠偏 + D9/S1 表述勘误完成） |

---

## EP2 阶段 8 前端融合（批次 56-59 + dsh client 能力）

> 前置依赖：EP1-7（REST 控制器）+ EP1-12（web-app bundle）；⚠Q2（dsh client 46 包能力级融入）EP2 前确认。

| 序 | 任务 | 状态 |
|---|---|---|
| 1 | 批次 56：socket.io-client 实时通道 | ✅ **PR #165**（2026-09-09）：`@flowforge/chat-realtime-client` 落 `packages/chat/realtime-client`：`ChatRealtimeClient` 把 socket.io 原始事件收敛为类型化回调面（thread:message / invocation:progress / signal:new / approval:update 四事件对齐 chat-realtime 词表），`SocketIoClientLike` seam 注入可测（不直接 import socket.io-client，R16 最小依赖），纯函数居 transport（threadRoom/userRoom 房间名 + buildJoinRoom/buildLeaveRoom/buildCancelInvocation 载荷 + 多标签页 provenance 去重字段），dispose 幂等清理；13 契约测试 13/13 全绿、包级 tsc exit 0、oxlint 0；真实浏览器连接组合根注入归 EP2 后续） |
| 2 | 批次 57：xterm 终端面板 | 🟩（**EP2-2** `@flowforge/terminal-panel` 落 `packages/terminal/terminal-panel`：NDJSON 定向帧解析（五种 frame：output/resize/exit/title/error）+ `TerminalViewLike` 抽象 xterm 渲染 seam（注入可测不碰 DOM，R16 最小依赖）+ `TerminalPanelController` 生命周期控制器（帧应用幂等 + 输入/尺寸上送 + exit 后停止消费 + 幂等 dispose）；13 契约测试 13/13 全绿、包级 tsc exit 0、oxlint 0；真实 `@xterm/xterm` 适配归 EP2 下游组件层） |
| 3 | 批次 58-59：Playwright 端到端 + 视觉回归 | 🟩（**EP2-3** 端到端冒烟落 `web/`：`@playwright/test` devDep + `playwright.config.ts`（chromium/`next start` webServer 自拉/超时对齐 t8_helpers）+ `e2e/routes.ts` 冒烟路由注册表（34 条静态可达路由）+ `e2e/routes-smoke.spec.ts`（HTTP<400 + 错误页兜底 + expectedFrag 稳定渲染断言）+ `e2e/council.spec.ts`（群聊壳层 layout/title-input/thread-list/main/composer/发送 + 输入发送乐观断言，对齐 `data-council` 与输入 placeholder）+ `e2e/visual.spec.ts` 视觉回归（默认关，`FF_E2E_VISUAL=1` 启 golden 基线）+ scripts（`test:e2e`/`test:e2e:install`/`test:e2e:visual`）+ `web-ci.yml` 增 Playwright 步骤（install --with-deps + test:e2e + report 上传）；真实终端面板渲染断言随 T8.4 xterm 接入） |
| 4 | Threads/群聊页 + @mention 菜单 + 线程分支交互 | 🟩（**EP2-4**：`web/` 群聊 UI 主体已就绪（`CouncilContent`/`CouncilChatPanel`：线程列表/线程详情/`@mention` 弹窗对 clowder ChatInputMenus、消息 hover 复制/引用/重新生成、`message-utils.branchMessage` 线程分支、`useCouncilSocket` WebSocket 实时收发、输入草稿/斜杠命令/IME 组合态）；批次补验证层 → `web/e2e/council.spec.ts` 增 `@mention 菜单随输入弹出/退出`（输入 `@` 弹窗、Esc 关闭、`@all` 恢复，锚点 `选择智能体`），包级 tsc exit 0、`playwright test --list` 3/3 群聊用例全发现；真实 socket.io 实时组合根注入（批次56 seam）与 xterm 终端（批次57 seam）随 T8.4 下游组件层） |
| 5 | dsh `client/*` 46 包能力级对照逐项融入 Next.js | 🟩（**EP2-阶段8 融合闭环** 2026-09-09：能力对照表 Q2 现行决策已落 `28-stage8-web.md`；T8.1-T8.10 全数达标——基建（T8.1 工程/socket 实时通道 batches 56）+ 群聊（T8.2 批4 @mention）+ 灵智档案（T8.3 `feed` forgekin.spec 3 用例）+ 终端（T8.4 xterm 真实接入 PR #169）+ 管理台/业务页/市场页/训练营/深色主题（T8.5-8.9 路由与组件齐备）+ Playwright 冒烟（T8.10 34 静态路由 + council/forgekin）。`connection` 已落 `@flowforge/client-connection`；`ui-*` 能力以路由/组件形态融入 `web/`，见 `28-stage8-web.md` 对照表一一勾选） |

---

## EP3 阶段 9-10：集成回归 + 入口切换

| 序 | 任务 | 状态 |
|---|---|---|
| 1 | 阶段 9 全量集成回归（三源功能矩阵核对 + snapshots 预期输出体系 A36） | 🟩（**EP3-1 回归核对闭环（矩阵+snapshots）** 2026-09-10：功能矩阵 10-stage-map D/C/F 核对全部达标（D52/F14 状态补摘 ✅）——D53 snapshots 体系 `@flowforge/acp-snapshot`+`llm-replay` 已落地并补根 `pnpm test:snapshot` 门禁（397 通过）；阶段8 web 融合（D52/F14）核对 ✅。集成 e2e 3 场景（T9.2-T9.4）与性能（T9.5）单列于 `29-stage9-integration.md` 待执行批次，不在本条目重复申报） |
| 1b | 阶段 9 e2e 三场景 + 性能（T9.2-T9.5） | 🟩（**EP3 stage9-e2e+perf 闭环** 2026-09-10：`@flowforge/integration-e2e` 落 `packages/integration/e2e`——三场景装配级验收：T9.2 mention→外部 CLI(mock)→蒸馏入库、T9.3 Forgekin 五闭环→跨厂商审议 PASS→mock git PR、T9.4 MCP→DAG→BasicCompactionEngine 压缩→会话续接 checkpoint；`integration-e2e.spec.ts` 4 用例全绿。性能 T9.5 落 `integration-perf.spec.ts`：A 100 并发广播至 10 客户端 7.1ms 总耗时/0.07ms·msg⁻¹（seq 单调无丢包乱序）、B 1400 条历史 compactNow 77.6ms，2 用例全绿，均远优于 Python 基线。含 chat-realtime 依赖接线；详见 `29-stage9-integration.md` 遗留清单） |
| 2 | 阶段 10 入口切换：`flowforge` CLI 唯一入口，web 切换 TS 栈 | 🟩（**EP3 入口切换闭环** 2026-09-10：start.bat/start.sh/install.bat/install.sh/doctor.sh 全部改走 TS 栈（`pnpm install/build/start`），旧 Python 标 DEPRECATED 冻结前置并附 README 回退章节；README.md/README.zh-CN.md 补 TS 快速开始；`/web` 由 `apps/cli web` 统一装配） |
| 3 | patches 体系补齐（A37：node-pty Windows 验证） | 🟩（**EP3 patches 闭环** 2026-09-10：`patches/README.md` 治理表——node-pty（ConPTY，allowBuilds + `ensure-spawn-helper.mjs` 恢复 exec bit）+ koffi（JSONL write-through）经 pnpm-workspace 边界声明治理；`@yao-pkg/pkg` 无需移植；见 10-stage-map D54） |

---

## EP4 阶段 11：Python 日落 + stretch

| 序 | 任务 | 状态 |
|---|---|---|
| 1 | Python 遗留目录日落与删除（`agents/`、`brain/`、`core/`、`llm/`、`loop/`、`forgemind/`、`evolution/`、`harness/`、`sop/`、`sdk.py` 等） | 🟦（**EP4 S11.1 冻结期完成，S11.2 待 P2 门槛** 2026-09-10：`__main__.py`（`python -m flowforge`）补 DEPRECATED 冻结横幅；start.bat 阶段10 已切 TS 栈并标注 deprecated；`31-stage11-sunset.md` 状态更新为"冻结期进行中"。S11.2 归档 / S11.3 删除受 P1/P2 前置门槛硬约束——P2（TS 默认入口稳定≥2 周）未满，不做未经收货的提前删除；README/spec 处 deprecated 标注已随阶段10 完成） |
| 2 | stretch 项按裁决排期（S1 凭据启用 / S2 TTS/邮件推送 / S4 desktop / S6 Python SDK 等） | ✅（**EP4-stretch 排期表** 2026-09-10：`31-stage11-sunset.md` §7 补 S1-S7 排期表——现阶段均不排期（缺凭据/服务或产品优先级不足），随 operator 新指令准入；S1 凭证接线后启用） |
| 3 | P1/P2 遗漏项收尾（A5-A7、A11、A13、A15-A16、A18-A19、A21-A23、A25-A28、A30-A31、B2、B6、B8-B9、B11、B13-B17、B19-B21、A35） | 🟦（**EP4-P12 收尾批次进行中** 2026-09-10：可立即实施项全量落包并提交 PR #171（新 21 包，tsc+oxlint+377 vitest 全绿，见 review_code §4。**diff 类已清点**：B8 缺 `skill-meta`/`skill-query` 已补建为 `forgekin/governance` 的 `skill-meta.ts`/`skill-query.ts`（readSkillMeta/parseManifestSkillMeta/resolveSkillMcpStatuses/listSkills/querySkill，12 vitest），`skill-manage` 的挂载/级联能力已内联进 governance-bootstrap 与 capabilities、不强复制；B9 utils 多数已覆盖（F212/context-assembly/rest-controllers）、剩余纯工具待逐文件归位，B11 mcp 同步核心已并入 capabilities（仅 drift-detector/resolver 待核对）。需裁决项（A11/A13/B2/B19/A35）与 B8 skill 级 drift/B9 剩余归位待 operator 指令或门槛） |

---

## 待 operator 决策点（同步 `review_code.md` §15）

| # | 决策点 | 影响批次 |
|---|---|---|
| Q10/A | forgeProcess design 产物与 F/A/D 分层的衔接粒度 | EP0-3 后 |
| Q11/B | 流程层级映射（forgeProcess plan = 我方批次；superpowers task = 批次内 checklist） | EP0-3 后 |
| Q12/C | subagent 派发与六智能体署名的绑定规则 | EP0-4 前 |
| Q13/D | worktree 隔离 EP0 期可选、EP0-4 后评估是否强制 | EP0-4 后 |

---

> Agent Notes：本文件为**进度状态单一事实来源**。每完成一个批次：①勾选本文件对应条目 + PR 号；
> ②勾选 `10-stage-map.md` §3.0（EP0）或 §3.1-3.4（D/C/F 编号）；③EP0 后走 forgeProcess 七阶段交付。

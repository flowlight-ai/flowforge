# 36 — Stretch 剩余批次解决方案设计（S2/S4/S5/S6）

> 类型：EP4 stretch 后续｜前置：`35-stage-stretch-batch.md`（三张已收口）+ `31-stage11-sunset.md` §7 排期表
> 决策点：Q3（finance 剔除）、Q4（文档站暂缓）、Q1（agent-team 暂缓）——已裁决，不在此表
> 本表各批次**随 operator 指令逐批准入**；每条列"可动工性 / 依赖门禁 / 最小首子项"。

---

## 0. 总览：四批次现状研判（2026-09-19 勘察）

| # | 能力 | 现状落点（flowforge 已有） | 真实缺口 | 可动工性 |
|---|---|---|---|---|
| S2 | TTS/语音 / RSS / 邮件 / GitHub signals | email ✅ / github-signals ✅ / connectors ✅ / redis-port ✅ / revile `audio-proxy.ts` 留 501 宿主点 | TTS 合成引擎、RSS 聚合（依赖外部服务/凭据） | 低（缺服务） |
| S4 | 桌面端 desktop | `@yao-pkg/pkg` 打包先例（D54）；web Next.js 前端可承载 | Electron 壳（main/preload/托盘/单实例/窗口） | **高（纯 TS/Electron，无外部凭据）** |
| S5 | 游戏/信号 games | `cats/shared/types/game.ts` 类型 + `mcp-server/toolsets/collab/game-action` | 游戏引擎本体（WerewolfLobby / GameOrchestrator）+ `/game` 路由 | 中（依赖 LLM + 引擎移植） |
| S6 | Python↔TS 桥接 SDK | `code-runtime-python` ✅（内嵌执行 Python） | **对外**网关（外部 Python 程序调用 flowforge：LLM chat / 注册 tool/agent/事件订阅），方向 = ACP/stdio（基于 `acp-app`/`sdk-app`） | 中（需先澄清目标面） |

**要点**：S4 唯一满足"即时动工、零外部凭据"，且 user 已下达准入指令 → 建议 **S4 为首启批次**。

---

## 1. S4 — 桌面端 desktop（首启候选）

### 1.1 目标澄清
port clowder `desktop/`（`cat-cafe-desktop`）：**服务编排器 + 浏览器壳**。主进程 `main.js`：
- 起后端服务（Redis/API/Web），随后加载 `http://localhost:3003`（web 前端）；
- `BrowserWindow`（Splash + 主窗，`contextIsolation:true` / `nodeIntegration:false`）+ `preload.js` 暴露 `desktopBridge`（IPC：splash 状态/更新提示/更新进度/更新设置/更新动作）；
- **Tray 托盘**：关闭时隐藏到托盘、托盘退出停止服务并 `app.quit()`；单实例锁；窗口导航守卫；外部链接走系统浏览器。

### 1.2 可动工性
- 零外部凭据；flowforge 已有 `web/` Next.js 前端 + `@yao-pkg/pkg` 打包先例（D54 治理）。
- **依赖门禁**：Node 运行时可加载本地 web 产物；Electron/electron-builder 引入是否与本仓库"零原生"策略冲突需确认（convention：可接受 devDependency 打包工具，运行时仍走 pkg 产物）。

### 1.3 拆分矩阵（最小首子项 → 后续）
| 子项 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| S4-1 | **端口契约 + 壳脚手架**：`DesktopShell` 主进程编排（spawn 后端→HTTP 健康探测→加载 URL）+ `preload` 桥（`desktopBridge` 暴露契约）+ 配置（端口/URL）外置 | 无（注入式 spawn/HTTP） | **✅ 已交付（2026-09-19）**：`@flowforge/desktop`（`packages/apps/desktop`）——`resolveDesktopConfig`（env 注入式，端口/URL/根路径规范化）+ `DesktopBridgeContract`（splash-status/update prompt/progress/update settings/action 词汇）+ 包内 `DesktopInvariantViolation` 不变式 + `InMemoryDesktopBridge` 总线 + `DesktopShellOrchestrator`（spawn→health 探测→URL，注入式 BackendSpawner/ReadinessProbe/持久化）；21 包级 vitest / tsc exit 0 / oxlint 0；Electron 集成（S4-2）后置 |
| S4-2 | Electron 集成：`main.js`/`preload.js` 包装壳（窗口/托盘/单实例/导航守卫）+ electron-builder 打包装配 | Electron 打包工具 | 后续 |
| S4-3 | 更新/升级流程（desktopBridge 的 update 通道）承接 host 平台 | pkg 产物源 | 后续 |

---

## 2. S5 — 游戏/信号 games

### 2.1 目标澄清
port clowder `packages/api/src/routes/games.ts`（`gameRoutes`，`gameStartSchema` 现仅 `gameType:'werewolf'`）+ `game-command-interceptor.ts`（`parseGameCommand`/`sanitizeCatIds`/`buildGameSeats`）+ `game-actions.ts`（`/api/game/:gameId/action`，校验 `x-cat-id`/线程所有权/round/phase/seat）。flowforge 已有 `cats/shared/types/game.ts`（Seat/GameDefinition/GameRuntime/GameView）+ MCP `collab/game-action`。

### 2.2 可动工性
- 中。类型层已具备；缺口是**引擎逻辑**（WerewolfLobby 状态机 + GameOrchestrator 动作分派）。
- **依赖门禁**：LLM（角色发言/裁决）；游戏线程/消息存储（chat probe 已有）。

### 2.3 拆分矩阵
| 子项 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| S5-1 | **命令解析 + 座位构建** pure 层（`parseGameCommand`/`sanitizeCatIds`/`buildGameSeats` + schema 校验）移植为注入式纯函数 | 无 | **✅ 已交付（2026-09-19）**：`@flowforge/cats-games`（`packages/cats/games`）忠实移植 game-command-interceptor（parse/sanitize/build + 常量词汇 + clampToPreset）+ zod seatSchema/gameStartSchema/parsedGameCommandSchema/safeParseParsedGameCommand（`z.record` 双参对齐 zod v4 惯例），复用 `@flowforge/cats-shared` `Seat`，零 LLM/传输依赖注入式纯函数；30 包级 vitest / tsc exit 0 / oxlint 0 |
| S5-2a | **LLM 注入 seam**（决策面适配层）：AI 端口 + prompt 构造 + AI 玩家适配器 + 测试双例 | 无（纯注入式，可离线） | **✅ 已交付（2026-09-20）**：详见行下注 |
| S5-2b | **LLM runtime 具体注入**：HTTP GameAIProvider + 配置 resolver + runtime 装配 | S5-2a seam | **✅ 已交付（2026-09-20）**：详见行下注 |
| S5-2c | 完整引擎状态机（WerewolfLobby + GameEngine + GameOrchestrator 动作分派） | S5-2a/S5-2b | **✅ 已交付（2026-09-21）**：详见行下注 |
| S5-3 | `/game` 路由 + MCP game-action 接线 | S5-1/S5-2 | **✅ 已交付（2026-09-21）**：详见行下注 |

> **S5-2a 注**（2026-09-20 交付）：`@flowforge/cats-games` 新增 `src/llm/` 三件套 + 测试双例——①`ai-provider.ts`：`GameAIProvider` 端口（`generateAction(prompt,schema)→{actionName,targetSeat?}` + `generateSpeech(prompt)→string`，对齐 clowder `AIProvider` 但改名避歧义）+ `assertAIActionResponse` 不变式守卫（在 seam 边界把 LLM 输出当非安全输入校验：actionName 非空 string、targetSeat 合法座次）；②`werewolf-prompt.ts`：`buildWerewolfPrompt` 忠实移植 clowder werewolf-prompts 全角色（wolf/seer/witch/guard/hunter/idiot/villager）；③`ai-player.ts`：`GameWerewolfAIPlayer` 适配器（`decideNightAction`/`decideSpeech`/`decideVote`/`decideSpeechWithFormat`，动作经 assert 校验后转 `GameAction`）；④`ai-provider-fakes.ts`：`NoopGameAIProvider`（any call → `GameLlmInvariantViolation`）+ `ScriptedGameAIProvider`（FIFO `actions`/`speeches` 队列 + 调用记录，队列耗尽即 throw）。57 包级 vitest（新增 27：seam/guard 7 + prompt 8 + adapter 6 + fakes 6）/ tsc exit 0 / oxlint 0。完整引擎 S5-2c 待 LLM runtime 注入。随 PR 提交。
>
> **S5-2b 注**（2026-09-20 交付）：`@flowforge/cats-games` `src/llm/` 新增三件具体注入实现，忠实聚焦移植 clowder `LlmAIProvider.ts` 的 HTTP 传输而**不携带 clowder 内部配置栈**（account-resolver/cat-models/provider-endpoint）——①`llm-config.ts`：`LlmProviderKind`（anthropic/openai/google/kimi）+ `LlmProviderConfig` + `LlmConfigResolver` 注入端口（按 cat 解析 endpoint）+ env 探测 `resolveLlmConfigFromEnv`（`GAME_LLM_*` 键，缺 provider/model/baseUrl 抛 `GameLlmConfigError`）+ `assertLlmProviderKind` 配置不变式 + `GAME_LLM_TIMEOUT_MS=10s`；②`http-ai-provider.ts`：`HttpGameAIProvider implements GameAIProvider`——注入 `resolveConfig`/`fetchImpl`（缺省 globalThis.fetch）/`timeoutMs`，四协议分支（anthropic `x-api-key`+version、openai/kimi `Bearer`、google `x-goog-api-key`），`AbortController` 超时，`parseActionResponse` markdown fence 容错 + `P<n>` 回退，输出经 `assertAIActionResponse` 守卫；③`llm-runtime.ts`：`GameLlmRuntime` 装配层——按 `catId` memo 缓存 `providerFor`（HttpGameAIProvider）与 `playerFor`（GameWerewolfAIPlayer），懒构造，供 S5-2c 引擎注入。`src/index.ts` 追加导出。23 新增包级 vitest（config 8 + http 11 + runtime 4），update 后总 80 全绿 / tsc exit 0 / oxlint 0。完整引擎状态机 S5-2c 依赖此 runtime + 引擎逻辑移植。随 PR 提交。
>
> **S5-2c 注**（2026-09-21 交付）：`@flowforge/cats-games` `src/engine/` 十文件忠实移植 clowder `services/game/` 全引擎域、复用 `@flowforge/cats-shared` 完整类型系统（零新增）——`werewolf-roles`（WerewolfRole + WEREWOLF_ROLES）/`werewolf-definition`（WerewolfPreset + WEREWOLF_PRESETS + createWerewolfDefinition）/`werewolf-lobby`（createLobby + startGame 洗牌分牌 + role_assigned 座位作用域事件）/`game-engine`（appendEvent/getVisibleEvents/submitAction/allActionsCollected/checkWinCondition）/`werewolf-engine`（Night：submitNightBallot/resolveNightBallots 平票 no_kill/setNightAction guard 连守/resolveNight 同守同救+自救限制+毒杀+hunter；Day：castVote/castDayVote/lockDayVote/allDayVotesLocked/resolveDayVotes/resolvePK/applyExile idiot 翻牌/hunterShoot/recordSpeech+LastWords）+ `game-stats-recorder`（extractDetailedStats MVP）/`game-view-builder`（GameViewBuilder：SeatId/'god'/`detective:Pn` 视图 + scope/revealPolicy 掩码 + 注入式 displayName）/`engine-ports`（IGameStore/IMessageStore/SocketLike/AppLogger 注入端口 + appendGameSystemMessage）/`game-orchestrator`（startGame/handlePlayerAction/tick/forceSettle/broadcastGameState/pause/resume/skipPhase/advancePhase 全生命周期 + 注入式 store/socket/messageStore/logger）/`game-auto-player`（GameAutoPlayer：`aiPlayerFactory` seam 不直接 new provider、getAIPlayer memo、runLoop TICK_MS 800/wall-clock 2h/AbortController、buildAIAction phase+role 白名单、随机回退）。`src/index.ts` 追加导出。**门禁修 10 处 `exactOptionalPropertyTypes`**（可选字段显式 `| undefined`/条件赋值/`?? null` 收窄）。update 后总 **141/141** vitest（新增引擎 36：def 7 + lobby 6 + engine 9 + werewolf 18 + view 9 + orch 7 + auto 5）/ 包级 tsc exit 0 / oxlint 0。S5-3 路由/MCP 接线为后置批次。随 PR 提交。
>
> **S5-3 注**（2026-09-21 交付）：`packages/api/rest-controllers` 移植 clowder 两套游戏路由为注入式控制器——`src/ports/game.ts` seam（`NonceDeduplicator`/`InMemoryNonceDeduplicator`（`Map<string,Set<string>>` 去重）+ `GameThreadHostSeam`（createThread/setPlayMode/setPin）+ `GameActionAuth`（assertOwned）+ `AutoPlayerSurface`（startLoop/stopLoop/stopAllLoops/isLoopActive））；`controllers/game-action.ts` 低层 MCP 路由 `POST /api/game/:gameId/action`：完整校验矩阵（identity 401 → body shape 400 → store 404 → ownership 403 → x-callback-thread-id 隔离 403 → status/round/phase 409 → seat/seat.actorId/alive 400/403/409 → `nonce.tryClaim` 重复返回 `{accepted:true,deduplicated:true}` 不调 orchestrator → 构建 `GameAction` → `handlePlayerAction`）；`controllers/game.ts` 高层 gameRoutes：`POST /api/game/start`（userId 401 → `gameStartSchema` safeParse 400 → `resolveAllowedCatIds` whitelist 过滤 → deduped 空 400 → detective 缺 `detectiveCatId` 提前 400 → thread 已活跃 409 → `hostThreads.createThread/setPlayMode/setPin` → `buildGameSeats` → `lobby.createLobby+startGame` 分牌 → `buildConfig`（player→humanSeat='P1' / 非 player→observerUserId / detective→detectiveSeatId）→ `orchestrator.startGame` → `autoPlayer.startLoop` → `{status:'game_started'}`）+ `GET/POST/DELETE /api/threads/:threadId/game`（view 三模式 `resolveViewer` + `GameViewBuilder.buildView` / playerAction / abort（stopLoop+nonce.clear+updateGame finished+broadcast `game:aborted`+setPin false））+ `POST .../god-action`（`z.enum(['pause','resume','skip','stop'])`，stop 同 abort）。`cats-games/src/llm/composition.ts`：`createGameAutoPlayerFactory(env)` 内部 new `GameLlmRuntime`（`resolveConfig:()=>resolveLlmConfigFromEnv(env)`）resolve 失败返 null。包级接线：`rest-controllers` peer/dev `@flowforge/cats-games` + `tsconfig.host.json` references `packages/cats/games`（含 `packages/` 段）+ vitest 生成式别名块注入 + `pnpm-lock.yaml` 更新。**类型门禁修 11 处**：cats-games 5 个测试文件接入 host 图后首现的类型错误（game.helpers `SocketLike` 改自 engine-ports、werewolf-definition `ROLE_TABLE` 加 `!`、werewolf-engine void 真值改语句块、ai-provider-fakes 零参、http-ai-provider makeFakeFetch/`LlmProviderConfig` cast/signal 收窄）+ 控制器 6 处（构造器 param-property 改普通参数、`z.infer<typeof gameStartSchema>`、`req.body?.threadId` 收窄、action 显式 `GameAction` 类型）。update 后两包合计 **309/309** vitest（rest-controllers 新增 game 20 + game-action 20 = 40）/ 根 tsc 零新增错误（剩余 desktop/chat/code-runtime/audio-proxy 为 git-stash 比对确认的基线预存）/ oxlint 0。S5-4 宿主接线（真实 MCP transport 注入身份 header）为后置批次。随 PR 提交。

---

## 3. S6 — Python↔TS 桥接 SDK

### 3.1 目标澄清（关键）
旧 `python/legacy/sdk.py` = **外部 Python 程序调用 flowforge**（暴露 `FlowForgeSDK`：LLM chat、注册 tool/agent、事件订阅、插件注册、`models/tools/agents` 注册表）。这与 `code-runtime-python`（flowforge **内嵌执行** Python）是**两个相反方向**——S6 缺的是"对外"接入面。
- 方向判别：沿用 dsh A34 的 **ACP/stdio**（`@flowforge/acp-app`/`sdk-app` 已存在对外 stdio SDK 形态）为底座，做 **Python 客户端 SDK**（Python 侧调用 ACP/stdio → flowforge agent），或 HTTP 网关。
- 需 operator 先定：**S6 = Python 客户端库（对 ACP/stdio）** 还是 **通用对外 HTTP 网关**。✅ **已定**（2026-09-22）＝ Python 客户端库对 flowforge SDK stdio JSON-RPC 协议，落地 `python/sdk`；真 ACP 规范（`--profile acp`）为后续可选项。

### 3.2 拆分矩阵（待方向定后再细化）
| 子项 | 内容 | 状态 |
|---|---|---|
| S6-0 | **方向裁决**：Python 客户端库（ACP/stdio）vs HTTP 网关 | ✅ **已裁决**（2026-09-22，operator 指令）＝ **Python 客户端库对 flowforge SDK stdio JSON-RPC 协议**，非 HTTP 网关；真 ACP 规范（`--profile acp`）留后续 |
| S6-1 | Python 侧 SDK 包（`python/sdk` stdio 客户端，复用 code-runtime-python 协议经验，镜像 `@flowforge/sdk-client`） | ✅ **已交付**（2026-09-22）：`python/sdk` 纯标准库 + asyncio，`HarnessClient`/`FlowForgeHarness`/`HarnessSession.run()` 整轮 idle；4 测试文件 28 用例全绿；详见 review_code §13.5 |
| S6-2 | 真 ACP 规范客户端（`--profile acp`，Agent Client Protocol） | 后续可选项（operator 准入） |

---

## 4. S2 — TTS/语音 / RSS / 邮件 / GitHub signals

### 4.1 现状
email / github-signals / connectors / redis-port 已交付；`audio-proxy.ts` 已把 SSE `/api/audio/events` 归宿主 S2 平台路由。真正缺口仅 **TTS 合成引擎 + RSS 聚合**，均需**外部服务/凭据**。

### 4.2 可动工性
- 低：无外部服务前无法落地真实 TTS/RSS。
- **建议**：S2 保持"端口 + mock + 显式地址门控"（对齐 B21 audio-proxy 的 `audioServiceUrl` 显式注入模式），**待凭据/服务准入**——本轮**不排期动工**，仅登记可复用 seam 位置。
- ✅ **S2-1 外部 TTS/RSS 凭据配置面已交付**（2026-09-22）：按 operator 准入指令，先落地**配置探测面**（对齐已批准 S1 飞书通道 `feishu-config.ts` 先例 + audio-proxy 显式地址门控语义，不接真实服务、不硬编码地址/密钥）。`packages/chat/stretch-ports` 新增 `src/tts/tts-config.ts`（权威键 `TTS_SERVICE_URL`/`TTS_API_KEY`/`TTS_VOICE`，`resolveTtsConfig`/`isTtsConfigured`/`ttsConfigGap`）+ `src/rss/rss-config.ts`（权威键 `RSS_SERVICE_URL`/`RSS_API_KEY`，`resolveRssConfig`/`isRssConfigured`/`rssConfigGap`），`index.ts` 导出全集，9 新增包级 vitest 全绿 / oxlint 0 / tsc clean。真实 TTS/RSS 服务接线与凭据由 operator 注入后再行开启。

---

## 5. 建议启动顺序与门禁

| 顺序 | 批次 | 理由 | 门禁 |
|---|---|---|---|
| 1 | S4（先 S4-1） | 唯一零外部凭据、即时动工、符合 operator 准入指令 | ✅ S4-1 已交付（2026-09-19）；S4-2 依 Electron 工具链裁决 |
| 2 | S5（先 S5-1） | pure 层即时动工；引擎后续需 LLM | ✅ S5-1 已交付（2026-09-19）；**S5-2a seam 已交付 + S5-2b LLM runtime 已交付（2026-09-20）**；**S5-2c 完整引擎状态机已交付（2026-09-21）**；**S5-3 路由/MCP 接线已交付（2026-09-21）** |
| 3 | S6 | 先裁决方向（S6-0）；`python/sdk` 纯标准库无外部凭据可即时动工 | ✅ **S6-0 已裁决 + S6-1 已交付**（2026-09-22）：`python/sdk` Python SDK stdio 客户端，28 用例全绿 |
| 4 | S2 | 缺服务，保持 ports，待凭据 | 外部 TTS/RSS 凭据 |

---

## 6. 待 operator 裁决点

| # | 决策 | 影响 |
|---|---|---|
| R1 | 确认 **S4 首启**（含 S4-1 壳脚手架先行） | S4 全部子项 |
| R2 | S6 方向：**Python 客户端库（ACP/stdio）** vs 通用 HTTP 网关 | ✅ **已裁决**（2026-09-22，operator 指令）＝ Python 客户端库对 flowforge SDK stdio JSON-RPC，落地 `python/sdk`（S6-1 已交付）；真 ACP（S6-2）留后续 |
| R3 | Electron/electron-builder 作为 **devDependency 打包工具** 是否接受 | S4-2 |
| R4 | S2 本轮**保持 ports 不排期**，确认 | ✅ **已闭环（2026-09-22）**：确认保持 ports + 显式地址门控；本轮已按 operator 指令先落地 TTS/RSS 凭据**配置探测面**（S2-1，同 36-stage §4.2 交付注），真实服务接线仍待凭据 |

---

> **执行纪律**：本表为方案设计与排期单一事实来源；批次启动后登记 `review_code.md` §13.5 第 2 项、`task.md` EP4 行 2、`10-stage-map.md` §3.4 对应行，走 ff_dev 七阶段 + ff_doctor 门禁 + mgr PR。
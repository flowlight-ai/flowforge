# 2026-09-21 S5-3 cats-games 路由 / MCP 接线

> 类型：EP4 stretch 过程记录｜上游设计：`docs/refactor/36-stage-stretch-remaining.md` §2（S5）
> 单一事实来源：`docs/refactor/review_code.md` §13.5 第 2 项（S5-3 行）
> 批准计划：`.trae/documents/s5-3-cats-games-routes-mcp-bind.md`

## 1. 决策落点

- 按 `36-stage-stretch-remaining.md` §2.3 拆分矩阵，S5-1（命令/座位）+ S5-2a/b/c（LLM seam→runtime→完整引擎）均已交付。本批 **S5-3** 落实 clowder 两套游戏路由的 flowforge 注入式 REST 控制器 + MCP game-action 接线：
  - **高层 gameRoutes**：`POST /api/game/start`、`GET/POST/DELETE /api/threads/:threadId/game`、`POST /api/threads/:threadId/game/god-action`（建线程/分牌/start/auto-player/view/action/abort/god-action）。
  - **低层 gameActionRoutes**：`POST /api/game/:gameId/action`（MCP 回调）——完整校验矩阵 → `orchestrator.handlePlayerAction`。
- **controller 蓝本 = clowder `routes/games.ts` + `routes/gameActions.ts`**，均改为注入式 seam：`GameStore`/`SocketLike`/`GameThreadHostSeam`（createThread/setPlayMode/setPin）/`GameActionAuth`（assertOwned）/`resolveAllowedCatIds`/`NonceDeduplicator`/`AutoPlayerSurface` 全部注入，缺省 InMemory，纯 TS 可离线单测。
- **注入式纪律**：`RestControllerBase` + `RouteRegistrar`（`RouteHandler=(req)=>Response`），controller extends + `registerRoutes()` + `this.post/get/delete()`；`handle()` 直接测试，不透网络。
- **auto-player 装配**：`createGameAutoPlayerFactory(process.env)`（cats-games `src/llm/composition.ts`）内部 new `GameLlmRuntime`（`resolveConfig:()=>resolveLlmConfigFromEnv(env)`），resolve 失败返回 null（随机回退），沿用 S5-2c 的 `aiPlayerFactory` seam，不硬编码 provider。
- **角色分配流程（对齐 S5-2）**：`buildGameSeats()`（role=''）→ `WerewolfLobby.createLobby({...})` → `lobby.startGame(lobbyRuntime)`（roles 赋到 seats）→ 把 `lobbyRuntime.definition` + `seats` 交给 `orchestrator.startGame`。
- **MCP game-action 路由模板**：`POST /api/game/${gameId}/action`；`CallbackRequest` 无身份 header，宿主 transport 注入 `x-cat-id`/`x-callback-thread-id` 等（完成标准，本批仅按 header 读取，宿主注入后置）。

## 2. 交付物

### rest-controllers `packages/api/rest-controllers/src/ports/game.ts`（seam）
- `NonceDeduplicator` + `InMemoryNonceDeduplicator`（`Map<string,Set<string>>` 去重）
- `GameThreadHostSeam`（`createThread(userId,title,route)` / `setPlayMode(id)` / `setPin(id,on)`）
- `GameActionAuth`（`assertOwned(...)`）
- `AutoPlayerSurface`（`startLoop`/`stopLoop`/`stopAllLoops`/`isLoopActive`）

### rest-controllers `src/controllers/game-action.ts`（低层 MCP 路由）
- `POST /api/game/:gameId/action`：解析 gameId → `x-cat-id`(401) → userId(401) → body shape(400: round/phase/seat/action 类型 + `isSeatId`) → `gameStore.getGame`(404) → `ownership.assertOwned`(403) → `x-callback-thread-id` 隔离(403) → status!=='playing'(409) → round mismatch(409) → phase mismatch(409) → seat 不存在(400) → `seat.actorId!==catId`(403) → `!seat.alive`(409) → `nonce.tryClaim` 重复返回 `{accepted:true,deduplicated:true}`（不调 orchestrator）→ 构建 `GameAction`（target→targetSeat、text→params.speechText）→ `orchestrator.handlePlayerAction`，抛错→400，成功→`{accepted:true}`。

### rest-controllers `src/controllers/game.ts`（高层 gameRoutes）
- `DEFAULT_TIMEOUT_MS=60000`；`defaultAutoPlayer()` 用 `createGameAutoPlayerFactory(process.env)` 组装 `GameAutoPlayer({gameStore,orchestrator,aiPlayerFactory})`。
- **startGame**：userId(401) → `gameStartSchema.safeParse`(400) → `resolveAllowedCatIds` 过滤 → deduped(空→400) → detective 缺 `detectiveCatId` 提前检查(400) → `findActiveGameByThread`(409) → `hostThreads.createThread/setPlayMode/setPin` → `buildGameSeats` catch(400) → detective hit-seat 检查(400) → lobby 创建+startGame → `buildConfig` → `orchestrator.startGame` → `autoPlayer.startLoop` → `{status:'game_started',gameId,gameThreadId}`。
- **buildConfig**：player→`humanSeat='P1'`；非 player→`observerUserId=userId`；detective→`detectiveSeatId`。
- **viewGame**：`resolveViewer`（player→own seat by actorId else 403；god-view/detective→observerUserId 匹配 else 403）→ `GameViewBuilder.buildView(runtime, viewer)`。
- **playerAction**：`actionSchema`(seat/action/target?/text?) → `getActiveGameByThread`(404) → status playing(409) → seat(400) → `handlePlayerAction`(抛错400) → `{accepted:true}`。
- **abortGame**：`stopLoop` + `nonce.clear` + `updateGame status finished` + broadcast `game:aborted` + `setPin(thread,false)`。
- **godAction**：`z.enum(['pause','resume','skip','stop'])`；pause/resume/skip→orchestrator 对应方法；stop→同 abort。

### cats-games `src/llm/composition.ts` + `src/index.ts` 导出
- `createGameAutoPlayerFactory(env,opts?)`→`GameAutoPlayerFactory=(catId)=>GameWerewolfAIPlayer|null`（内部 `new GameLlmRuntime({resolveConfig, ...(opts?.fetchImpl?{fetchImpl}:{})})`，resolve 抛错返回 null）。

### 包级接线
- `rest-controllers/package.json`：peer+dev 依赖 `@flowforge/cats-games: workspace:^`。
- `tsconfig.host.json`：references 加 `packages/cats/games/tsconfig.host.json`（含 `packages/` 段）。
- `vitest.config.ts` 生成式别名块注入 `@flowforge/cats-games` 三条别名（src/裸名/regex）。
- `pnpm-lock.yaml`：`pnpm install --no-frozen-lockfile` 更新。

### 测试
- `tests/game-action.spec.ts`：20 用例（FakeGameStore/FakeSocket/buildRuntime + `vi.spyOn(orchestrator,'handlePlayerAction')`），`it.each` 覆盖 6 个 body 400、401/403/409/400 matrix、nonce 去重、成功派发、orchestrator 抛错→400。
- `tests/game.spec.ts`：20 用例（makeSeats(6)/SEVEN_CATS、FakeGameStore seed、FakeThreadHost/FakeAutoPlayer/FakeSocket），覆盖 start 成功/401/400/detective 三段/not enough cats/409、view 三模式、abort、god-action、player action。
- update 后两包合计 **309/309** vitest 全绿（rest-controllers 含新增 40）。

## 3. 验证

- vitest：`packages/api/rest-controllers` + `packages/cats/games` 合计 **309/309** 全绿（新增 game 20 + game-action 20 = 40）。
- oxlint `rest-controllers + cats-games`：**0 warnings / 0 errors**。
- 根 `tsc -b tsconfig.host.json`：**零新增类型错误**——修复 cats-games 5 个测试文件接入 host 图后首现的类型错误（game.helpers SocketLike 改从 engine-ports 导入、werewolf-definition ROLE_TABLE `!`、werewolf-engine void 真值改语句块、ai-provider-fakes 零参、http-ai-provider makeFakeFetch/`LlmProviderConfig` cast/signal 收窄）+ 自身控制器 6 处（构造器 param-property 改普通参数、`z.infer<typeof gameStartSchema>`、`req.body?.threadId` 收窄、action 显式 `GameAction` 类型）。剩余错误与基线（origin/master）逐条一致，仅为预存问题：`apps/desktop`（TS6307/ReadinessProbe/DesktopConfig）、`chat/stretch-ports` feishu（TS2532）、`code-runtime/code-runtime-python`（TS6307）、`rest-controllers` audio-proxy（TS2379 exactOptional）——均已 git stash 对比确认非本批引入。
- 依赖：`rest-controllers` 新增 peer/dev `@flowforge/cats-games`（workspace），零外部运行时依赖。

## 4. 提交与文档登记

- review_code.md §13.5 第 2 项追加 S5-3 行；task.md 行 2 追加 S5-3 交付；10-stage-map §3.4 追加 S5-3 行；36-stage §2.3 S5-3 行改 ✅ 已交付 + 追加注 + §5 顺序表更新。
- 走 ff_doctor 门禁 + mgr PR（累加更新至 S5 全量路由 PR）。
- S5-4 宿主接线（MCP game-action 真实 transport 注入身份 header + 引擎装配进 host）为后置批次。
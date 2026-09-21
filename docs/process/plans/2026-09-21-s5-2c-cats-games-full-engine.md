# 2026-09-21 S5-2c cats-games 完整引擎状态机

> 类型：EP4 stretch 过程记录｜上游设计：`docs/refactor/36-stage-stretch-remaining.md` §2（S5）
> 单一事实来源：`docs/refactor/review_code.md` §13.5 第 2 项（S5-2c 行）
> 批准计划：`.trae/documents/s5-2c-cats-games-full-engine.md`

## 1. 决策落点

- 按 `36-stage-stretch-remaining.md` §2.3 拆分矩阵，S5-2a（LLM seam）+ S5-2b（LLM runtime）已验证 `@flowforge/cats-shared` 的**完整游戏类型系统**（GameDefinition/GameRuntime/GameView/GameEvent/PendingAction/Ballot/Resolution/GameResultStats，零新增类型）。本批 **S5-2c** 落实**完整引擎状态机**：角色/定义/大厅 + 引擎核心 + 视图/统计 + 编排 + 自动玩家，全部迁移为纯 TS 注入式端口。
- **全部迁移蓝本 = clowder-api `services/game/` 十个文件**（GameEngine/WerewolfEngine/WerewolfLobby/WerewolfDefinition/WerewolfRoles/GameViewBuilder/GameStatsRecorder/GameOrchestrator/GameAutoPlayer/gameSystemMessage），**不携带 clowder 内部依赖**（catRegistry、LlmAIProvider、account-resolver/cat-models 均禁依赖）。
- **GameAutoPlayer 特殊性**：flowforge 版**不直接 new LLM provider**，改用注入式 `aiPlayerFactory(catId)=>GameWerewolfAIPlayer|null` seam（缺省随机回退，不硬编码 provider）——S5-3 接 `GameLlmRuntime.playerFor`。测试注入 fake 决策器。
- **GameViewBuilder 解耦**：clowder 的 catRegistry display-name 富化替换为注入式 `opts.displayName?(actorId)=>string`（缺省恒等），保持零依赖。
- 注入式纪律：`IGameStore`/`IMessageStore`/`SocketLike`/`AppLogger`/`aiPlayerFactory`/`displayName`/`sleep` 全部走注入端口，缺省 noop，纯 TS 可单测、可离线验证。

## 2. 交付物（packages/cats/games，`src/engine/` — 10 文件）

- **`werewolf-roles.ts`**：`WerewolfRole` + `WEREWOLF_ROLES` 常量（wolf/seer/witch/hunter/guard/idiot/villager，faction + nightActionPhase）
- **`werewolf-definition.ts`**：`WerewolfPreset` + `WEREWOLF_PRESETS`（6/7/8/9/10/12）+ `buildPhases()`（12 相）+ `buildActions()`（8 动作）+ `buildWinConditions()` + `createWerewolfDefinition(playerCount)`（越界抛错）
- **`werewolf-lobby.ts`**：`WerewolfLobby`——`createLobby` 建 lobby 态 runtime，`startGame` 洗牌分牌 + 每座发 `role_assigned`（scope `seat:Pn`）+ 转 playing/round=1
- **`game-engine.ts`**：`GameEngine` 基类——`appendEvent`（自增 `evt-N`）/`getVisibleEvents`（scope 掩码）/`submitAction`（存活+phase+role 校验）/`allActionsCollected`/`clearPendingActions`/`checkWinCondition`
- **`werewolf-engine.ts`**：`WerewolfEngine extends GameEngine`——夜间 `submitNightBallot`/`resolveNightBallots`（平票 no_kill）/`setNightAction`（guard 连守限制）/`resolveNight`（同守同救卒、单救存活、witch 仅 round1 自救、poison 独立毒杀、hunter 狼刀死可开枪/毒死不可）；白天 `castVote`/`castDayVote`/`feedDayBallotSilent`/`lockDayVote`/`allDayVotesLocked`/`resolveDayVotes`/`resolveVotes`/`resolvePK`/`applyExile`（idiot 翻牌存活）/`hunterShoot`/`recordLastWords`/`recordSpeech` + override `checkWinCondition`（'wolf'|'village'|null）
- **`game-stats-recorder.ts`**：`extractDetailedStats(runtime): GameResultStats`（从 `action.submitted` 事件计 kill/heal/divine；MVP 按胜方 impact score）
- **`game-view-builder.ts`**：`GameViewBuilder.buildView(runtime, viewer, opts?)`——viewer 支持 `SeatId`/'god'/`detective:Pn`，scope+revealPolicy 过滤、role/faction 掩码、hasActed 昼夜敏感、god actionStatus、聚合进度、finished 附 gameStats
- **`engine-ports.ts`**：`IGameStore`/`IMessageStore`/`SocketLike`/`AppLogger`+`noopAppLogger` + `appendGameSystemMessage`（移植 gameSystemMessage.ts）
- **`game-orchestrator.ts`**：`GameOrchestrator`——`startGame`/`handlePlayerAction`（action.requested/submitted、speak 双写、night_thought 作用域 faction:wolf/god、ballot.updated、allCollected→advance）/`forceSettle`/`tick`（超时+fallback+grace）/`broadcastGameState`（每座 scoped view + god/detective observer）/`pauseGame`/`resumeGame`/`skipPhase`；私有 `resolveCurrentPhase`（night_resolve 事件重构、day_vote 静默喂票）、`applyFallbacks`、`advancePhase`（resolve→clear→换相→round_start/phase_start→胜负→skipEmptyPhases）、`resolveNightFromEvents`、`resolveDayVoteFromPending`、`resolveLastWords`、`skipEmptyPhases`
- **`game-auto-player.ts`**：`GameAutoPlayer`——`PHASE_ACTION_MAP`/`SKIP_PHASES`/`ANNOUNCE_PHASES`、`aiPlayerFactory` seam（不直接 new provider）、`getAIPlayer` memo、`startLoop`/`stopLoop`/`stopAllLoops`/`isLoopActive`/`recoverActiveGames`/`runLoop`（TICK_MS 800/MAX_WALL_CLOCK_MS 2h/AbortController）、`actForPhase`、`buildAction`（LLM→随机回退）、`buildAIAction`（phase+role 白名单+targetSeat 存活校验）、`buildAISpeech`（messageStore 上下文注入 synthetic events）、`buildRandomAction`、模块级 `pickRandom`/`sleep`（unref + abort）
- **`src/index.ts`**：追加导出 `./engine/*` 全部 10 模块
- **测试** `tests/engine/`：`game.helpers.ts` 共享夹具（makeSeat/makeSeatsFromRoles/makeRuntime + InMemoryGameStore/RecordingSocket/RecordingMessageStore/writesSpiedLogger）+ 七个 spec：werewolf-definition(7)/werewolf-lobby(6)/game-engine(9)/werewolf-engine(18)/game-view-builder(9)/game-orchestrator(7)/game-auto-player(5)

## 3. 验证

- vitest：update 后总 **141/141** 全绿（新增引擎 36：def 7 + lobby 6 + engine 9 + werewolf 18 + view 9 + orch 7 + auto 5，合计 61 项断言用例中的 36 项引擎用例）
- 包级 tsc（extends 根基座，`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）：**exit 0**（修 10 处可选属性类型：orchestrator/auto-player 字段显式 `| undefined`、view-builder `hasActed`/`phaseStartedAt` 条件赋值、werewolf-engine `exiled` `?? null` 收窄）
- oxlint `packages/cats/games`：**0 warnings / 0 errors**
- 依赖：仅 `@flowforge/cats-shared` + 既有 S5-2a/b 组件（`GameWerewolfAIPlayer` 作 auto-player seam 类型）；零 LLM 运行时依赖、零新增依赖

## 4. 提交与文档登记

- review_code.md §13.5 第 2 项追加 S5-2c 行；task.md 行 2 追加 S5-2c 交付；10-stage-map §3.4 追加 S5-2c 行；36-stage §2.3 拆分矩阵标 S5-2a✅/S5-2b✅/**S5-2c✅** + §5 顺序表更新。
- 走 ff_doctor 门禁 + mgr PR（累加更新至 S5 全量引擎 PR）。
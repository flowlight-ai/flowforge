# 2026-09-19 S5-1 cats-games 命令解析与座位构建

> 类型：EP4 stretch 过程记录｜上游设计：`docs/refactor/36-stage-stretch-remaining.md` §2（S5）
> 单一事实来源：`docs/refactor/review_code.md` §13.5 第 2 项（S5-1 行）

## 1. 决策落点

- 按 `36-stage-stretch-remaining.md` §5 启动顺序 S4→S5→S6→S2，S4-1 已交付（PR #207）后进入 S5。
- S5 先做**零 LLM 依赖**的 pure 层 S5-1，引擎（S5-2）与路由/接线（S5-3）后置。
- 新包落点 `packages/cats/games`（`@flowforge/cats-games`），对齐 cats 域包模板（tsconfig extends 根基座、rootDir src、composite、ref `../shared`）。
- 类型复用现有 `@flowforge/cats-shared` 的 `Seat`（`types/index.ts` 重导出 `./game.ts`），不重复定义。

## 2. 交付物（packages/cats/games）

- **`src/command-interceptor.ts`**：忠实移植 clowder `game-command-interceptor.ts`
  - 常量词汇：`KNOWN_GAME_TYPES`/`GAME_SUBCOMMANDS`/`VALID_HUMAN_ROLES`/`VALID_PLAYER_COUNTS`/`DEFAULT_PLAYER_COUNT`
  - `clampToPreset`（就近钳制到合法 preset，返回 `PlayerCount` 联合类型）
  - `sanitizeCatIds`（白名单过滤 + 去重防重复占用座位）
  - `parseGameCommand`（`/game <type> <role> [playerCount] [catIds] [voice]`，`exactOptionalPropertyTypes` 下条件装配可选键）
  - `buildGameSeats`（player 模式 P1=human/P2..Pn=cats、god-view/detective 全 cats，cat 不足抛错杜绝座位重复）
- **`src/schema.ts`**：移植 clowder `routes/games.ts` 边界 schema
  - `seatSchema` / `gameStartSchema`（gameType enum + humanRole enum + playerCount preset 范围 + catIds ≥1 + voiceMode/detectiveCatId）
  - `parsedGameCommandSchema` / `safeParseParsedGameCommand`（`/game` 解析输出边界校验）
  - 注：zod v4 `z.record` 需**双参** `z.record(z.string(), z.unknown())`，对齐项目惯例（非 clowder 旧版单参写法）。
- **`src/index.ts`**：导出全集。
- **测试** `tests/command-interceptor.spec.ts`（21）`tests/schema.spec.ts`（9）。

## 3. 验证

- vitest：30/30 全绿（命令解析 / 座位构建 / schema 校验）
- 包级 tsc（extends 根基座）：exit 0
- oxlint `packages/cats/games`：0 warnings / 0 errors
- 依赖：`@flowforge/cats-shared`（`Seat` 类型）+ zod（peer/dev 对齐 cats-shared 惯例）；零 LLM/传输运行时依赖

## 4. 提交与文档登记

- `pnpm install --no-frozen-lockfile` 注册 `packages/cats/games` importer。
- review_code.md §13.5 第 2 项追加 S5-1 行；task.md 行 2 追加 S5-1 交付；10-stage-map §3.4 追加 S5-1 行；36-stage §2.3 + §5 标记 S5-1 ✅。
- 走 ff_doctor 门禁 + mgr PR。

## 5. 后续

- S5-2 引擎状态机（WerewolfLobby + GameOrchestrator 动作分派）依赖 LLM seam，待准入。
- S5-3 `/game` 路由（gameRoutes）+ MCP collab/game-action 接线依赖 S5-1/S5-2。
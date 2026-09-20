# 2026-09-19 S5-2a cats-games LLM 注入 seam

> 类型：EP4 stretch 过程记录｜上游设计：`docs/refactor/36-stage-stretch-remaining.md` §2（S5）
> 单一事实来源：`docs/refactor/review_code.md` §13.5 第 2 项（S5-2a 行）

## 1. 决策落点

- 按 `36-stage-stretch-remaining.md` §2.3 拆分矩阵，S5-2 引擎状态机（WerewolfLobby + GameOrchestrator）依赖 LLM，先拆出**决策面适配层 S5-2a**（LLM 注入 seam）作为引擎前置条件。
- seam 模式对齐 S4-1 `@flowforge/desktop` 的注入式纪律：所有外部依赖（此处为 LLM 调用）用**注入式接口**，保持纯 TS 可单测、可离线验证。
- core seam 源头 = clowder `WerewolfAIPlayer.ts` 的 `AIProvider` 端口；本项目命名为 **`GameAIProvider`**（`AIProvider` 过泛易歧义），经不变式守卫把 LLM 输出当**非安全输入**处理。
- 完整引擎状态机（WerewolfLobby + GameOrchestrator 动作分派）留待 **S5-2b**（依赖本 seam + LLM runtime）。

## 2. 交付物（packages/cats/games，`src/llm/`）

- **`src/llm/ai-provider.ts`**：LLM 注入 seam 核心
  - `AIActionResponse`（`actionName: string` + `targetSeat?: string`）
  - `GameAIProvider` 端口（`generateAction(prompt, schema) → Promise<AIActionResponse>` + `generateSpeech(prompt) → Promise<string>`）
  - `GameLlmInvariantViolation`（不变式违规错误）
  - `assertAIActionResponse(value)`：seam 边界守卫——actionName 非空 string + targetSeat 合法座次（`isSeatId`），返回干净副本
- **`src/llm/werewolf-prompt.ts`**：忠实移植 clowder `werewolf-prompts.ts` 全角色段
  - `buildWerewolfPrompt(role, view, round)` + `buildBaseContext` + `buildRoleSection`（wolf/seer/witch/guard/hunter/idiot/villager），纯函数
- **`src/llm/ai-player.ts`**：忠实移植 clowder `WerewolfAIPlayer.ts`
  - `GameWerewolfAIPlayer`（构造注入 `GameAIProvider`），方法 `decideNightAction`/`decideSpeech`/`decideVote`/`decideSpeechWithFormat`；动作经 `assertAIActionResponse` 校验后 `toGameAction` 转 `GameAction`（`@flowforge/cats-shared`）
- **`src/llm/ai-provider-fakes.ts`**：注入式测试双例
  - `NoopGameAIProvider`（任何调用 throw `GameLlmInvariantViolation`）+ `ScriptedGameAIProvider`（FIFO `actions`/`speeches` 队列 + `actionCalls`/`speechCalls` 记录，队列耗尽同 noop throw）
- **`src/index.ts`**：追加导出 `./llm/*`
- **测试** `tests/llm/`：`game-view.fixture.ts`（makeSeat/makeGameView 构造最小合法 `GameView`）+ `ai-provider.spec.ts`（7）/`werewolf-prompt.spec.ts`（8）/`ai-player.spec.ts`（6）/`ai-provider-fakes.spec.ts`（6）
  - 路径注意：测试位于 `tests/llm/`，相对 src 用具 `../../src/llm/...`

## 3. 验证

- vitest：57/57 全绿（含 S5-1 30 张；新增 27：seam/guard 7 + prompt 8 + adapter 6 + fakes 6）
- 包级 tsc（extends 根基座）：exit 0
- oxlint `packages/cats/games`：0 warnings / 0 errors
- 依赖：`@flowforge/cats-shared`（`GameAction`/`GameView`/`isSeatId`）+ vitest；零 LLM 运行时依赖（纯注入式）

## 4. 提交与文档登记

- review_code.md §13.5 第 2 项追加 S5-2a 行；task.md 行 2 追加 S5-2a 交付；10-stage-map §3.4 追加 S5-2a 行；36-stage §2.3 拆分矩阵改 S5-2→S5-2a/S5-2b/S5-3 + §5 顺序表标记。
- 走 ff_doctor 门禁 + mgr PR（累加更新至 S5 分支 PR）。
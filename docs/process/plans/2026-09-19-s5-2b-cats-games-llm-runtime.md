# 2026-09-19 S5-2b cats-games LLM runtime 具体注入

> 类型：EP4 stretch 过程记录｜上游设计：`docs/refactor/36-stage-stretch-remaining.md` §2（S5）
> 单一事实来源：`docs/refactor/review_code.md` §13.5 第 2 项（S5-2b 行）

## 1. 决策落点

- 按 `36-stage-stretch-remaining.md` §2.3 拆分矩阵，S5-2a 已交付 **LLM 注入 seam**（`GameAIProvider` 端口 + prompt + 决策适配器 + 测试双例）。本批 **S5-2b** 落实 seam 背后的**具体 runtime 注入实现**：真实 HTTP provider + 配置 resolver 注入 + runtime 装配层。
- 核心迁移蓝本 = clowder-api `game/LlmAIProvider.ts` 的 **HTTP 传输**（Anthropic/OpenAI/Google/Kimi 四协议分支 + 10s 超时 + markdown fence 容错解析 + `P<n>` 回退），**但不携带 clowder 内部配置栈**（account-resolver / cat-models / provider-endpoint 均为禁依赖）。
- 配置缺省采用 `GAME_LLM_*` env 探测（`resolveLlmConfigFromEnv`），在 resolver 边界执行不变式（缺 provider/model/baseUrl 抛 `GameLlmConfigError`）。所有外部依赖（fetch / 配置 / 超时）均用**注入式接口**，保持纯 TS 可单测、可离线验证。
- 完整引擎状态机（WerewolfLobby + GameEngine + GameOrchestrator 动作分派）下沉为 **S5-2c**（依赖本 runtime）。

## 2. 交付物（packages/cats/games，`src/llm/`）

- **`src/llm/llm-config.ts`**：配置端口 + env 探测
  - `LlmProviderKind`（`anthropic`/`openai`/`google`/`kimi`）+ `LLM_PROVIDER_KINDS` 常量数组 + `assertLlmProviderKind`
  - `LlmProviderConfig`（`provider`/`model`/`baseUrl`/`apiKey?`）
  - `LlmConfigResolver` 注入端口（`(catId: string) => LlmProviderConfig`，按 cat 解析 endpoint）
  - `GAME_LLM_TIMEOUT_MS = 10_000` + `GAME_LLM_ENV_KEYS` + `resolveLlmConfigFromEnv(env)`（缺 provider/model/baseUrl 抛 `GameLlmConfigError`）
- **`src/llm/http-ai-provider.ts`**：注入式 HTTP provider（忠实聚焦移植 `LlmAIProvider.ts` 传输）
  - `HttpGameAIProvider implements GameAIProvider`——构造注入 `resolveConfig`/`fetchImpl`（缺省 `globalThis.fetch`）/`timeoutMs`
  - `callLlm` 四协议分支：anthropic（`x-api-key` + `anthropic-version: 2023-06-01`，`{model,max_tokens:256,messages}`）、openai/kimi（`Bearer`，`{model,max_tokens,messages}`）、google（`x-goog-api-key`，`{contents:[{parts:[{text}]}],generationConfig:{maxOutputTokens:256}}`）
  - `AbortController` 超时中止；`parseActionResponse` markdown fence 剥离 + JSON.parse + `P<n>` 回退；输出经 `assertAIActionResponse` 守卫
- **`src/llm/llm-runtime.ts`**：装配层
  - `GameLlmRuntime`——按 `catId` memo 缓存 `providerFor`（懒构造 `HttpGameAIProvider`）与 `playerFor`（懒构造 `GameWerewolfAIPlayer`），供 S5-2c 引擎注入
  - 注意 `exactOptionalPropertyTypes`：构造器字段显式可空（`fetchImpl: (typeof fetch) | undefined` / `timeoutMs: number | undefined`），`providerFor` 显式空值判断构建 opts，不用 spread 可选参
- **`src/index.ts`**：追加导出 `./llm/llm-config` / `./llm/http-ai-provider` / `./llm/llm-runtime`
- **测试** `tests/llm/`：`llm-config.spec.ts`（8）+ `http-ai-provider.spec.ts`（11）+ `llm-runtime.spec.ts`（4）

## 3. 验证

- vitest：update 后总 **80/80** 全绿（新增 23：config 8 + http 11 + runtime 4）
  - http spec 关键覆盖：四协议 wire format、anthropic action 解析、空 content 触发 `GameLlmInvariantViolation`、未知 provider 抛 `GameLlmConfigError`、`AbortController` 超时中止（fake fetch 监听 signal abort 事件 reject）、parseActionResponse 四分支
- 包级 tsc（extends 根基座）：exit 0
- oxlint `packages/cats/games`：0 warnings / 0 errors
- 依赖：`@flowforge/cats-shared` + S5-2a seam（`GameAIProvider`/`GameWerewolfAIPlayer`/`assertAIActionResponse`）；零 LLM 运行时依赖（纯 fetch 注入式）

## 4. 提交与文档登记

- review_code.md §13.5 第 2 项追加 S5-2b 行；task.md 行 2 追加 S5-2b 交付；10-stage-map §3.4 追加 S5-2b 行；36-stage §2.3 拆分矩阵标 S5-2a✅/S5-2b✅ + 下沉 S5-2c + §5 顺序表更新。
- 走 ff_doctor 门禁 + mgr PR（累加更新至 S5 分支 PR）。
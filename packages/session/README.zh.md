# session/ — 持久化会话数据平面

[English](README.md) | 中文

`session` 数据平面是 FlowForge 的**持久化状态主干**：一个**事件溯源（event-sourced）**的会话存储，以及其持久化、投影、查询、遥测、标题等子系统的集合。可变数据库行里**从不存放**持久化状态——持久化状态就是那条只能追加（append-only）的会话**事件日志**，而每一个"当前记录"（模型历史、请求头、投影、计数等）都是对日志的一次确定性**折叠（fold）**。定时器、投影、缓存都是**可丢弃的**：它们随时都能从日志重建。

> 目录说明：事件溯源核心包 `@flowforge/session` 位于 `packages/core/session`（属于 `core` 工作区分组）。`packages/session` 目录下放的是持久化 / 投影 / 遥测 / 标题 / 检查点等子包，`packages/session-query` 下放的是检索子包。它们共同构成本 SESSION 模块，在此一并说明。

## 子包一览

| 包 | 职责 | `ctx` 键 |
| --- | --- | --- |
| `@flowforge/session`（`packages/core/session`） | 事件溯源会话存储：追加日志、内存 `SessionStore`、派生的 LLM 消息历史。 | `ctx.sessions` |
| `@flowforge/session-persistence` | 抽象持久化接缝（后端契约 + 写入协调器）。 | `ctx.sessionPersistence` |
| `@flowforge/session-persistence-jsonl` | JSONL 持久化后端（通过 `koffi` 使用原生 FFI）。 | （`ctx.sessionPersistence` 的实现） |
| `@flowforge/session-persistence-sqlite` | SQLite 持久化后端。 | （`ctx.sessionPersistence` 的实现） |
| `@flowforge/session-query` | 统一的、优先取活数据的检索：有界读取、血缘追踪、过滤、全文搜索。 | `ctx.sessionQuery` |
| `@flowforge/session-query-sqlite` | 查询引擎的 SQLite FTS 实现。 | （`ctx.sessionQuery` 的实现） |
| `@flowforge/session-projection` | 能力接缝：可合并扩展的 `SessionProjectionMap`、`ProjectionDefinition` 契约（`init`/`apply`/`view`）、驱动各单元的 `ctx.sessionProjections` 注册表。 | `ctx.sessionProjections` |
| `@flowforge/session-projection-cache` | 每会话的持久化投影检查点、节流后写（write-behind）、冷读阶梯。 | `ctx.sessionProjectionCache` |
| `@flowforge/session-stats` | 整日志的对话计数 / 墙钟时长投影。 | （投影单元） |
| `@flowforge/session-title`（含 `-llm`、`-first-prompt-llm`、`-all-prompts-llm`） | 基于日志的会话标题服务与 LLM 提供者注册表。 | （投影 + 提供者） |
| `@flowforge/session-telemetry`（含 `-otel`） | 会话事件捕获、脱敏，并交给上报后端（OpenTelemetry）。 | — |
| `@flowforge/session-checkpoint-policy` | 在模型请求与工具副作用之前的语义化持久化检查点。 | — |
| `@flowforge/tool-session-query` | 把会话查询暴露给模型的智能体工具。 | — |

## 事件溯源模型（通俗版）

一个 `Session` 就是一串只能追加的 `SessionEvent` 日志。`SessionStore`
（`ctx.sessions`）**只在内存中**持有会话；持久化是插件的事。

- **追加（Append）。** `session.append(type, data, surfaceOp?, sourceEventSeqs?)`
  推入一条被深度冻结的事件。`seq === log.length`（连续性契约）：序号永远等于当前日志长度。事件的 `data` 必须能无损 JSON 序列化，否则在追加处就被拒绝。
- **折叠（Fold）。** 所有从会话派生出的东西，都是对日志折叠算出来的：
  - `deriveMessages()` —— 模型可见的历史。**surface**（被打上 `surfaceOp` 标记的、按序排列的消息产生事件）是派生历史的唯一来源；一次压缩 `replace` 会删掉被遮蔽（shadowed）的节点。
  - `requestHeader()` / `requestContext()` —— 对最新 `request/header` / `request/context` 快照的增量折叠。
  - 投影（`ctx.sessionProjections`）通过 `init → apply → view` 折叠日志事件；每个单元返回*完整的当前值*。
- **Header 在日志之外。** `SessionHeader`（id、格式版本、cwd、种子血缘、委派深度）是存储/血缘元数据，单独携带在事件日志之外——它不是可重放的对话状态。
- **持久化 = 订阅 / flush。** 后端订阅 `session/event`，并在 `session/flush`
  时落盘。在从存储读取持久化决策前，先调用
  `ctx.sessions.flush(session)`。
- **生命周期。** `prepare` → `enter` → `announce`（或便捷方法
  `ctx.sessions.create`）；销毁时发出 `session/disposed`。`ctx.sessions.fork`
  可从某活会话的稳定前缀派生出子会话。

### 核心事件词汇

`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、
`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、
`todo/write`、`request/header`、`request/context`、`session/end-seed`。
`SessionEventMap` 是可合并扩展的，插件可追加自己的事件类型。

## 交叉引用

- 事件溯源核心：`packages/core/session` —— `@flowforge/session`。
- 检索：`packages/session-query` —— `@flowforge/session-query`。
- 持久化接缝与后端：`packages/session/session-persistence`、
  `session-persistence-jsonl`、`session-persistence-sqlite`。
- 投影：`packages/session/session-projection`、`session-projection-cache`。
- 面向 AI 工具的持久化状态铁律：见 [AGENTS.md](AGENTS.md)（中文）。

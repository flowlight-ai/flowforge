# AGENTS.md — session 模块开发规范（强制）

> 本文件是仓库根 `AGENTS.md` 的补充，专用于 **session 模块**（事件溯源的会话持久化数据平面）。在本目录及其子包（`packages/session/*`、`packages/session-query/*`、`packages/core/session`）工作，必须同时遵守本文件与仓库根 `AGENTS.md`。

session 模块的核心不变量：**会话事件日志是唯一持久化状态**。所有"当前记录"都是对日志的折叠派生，永远可以从日志重建。任何违反这一点的改动都属于严重违规。

## 持久化状态铁律

**规则：会话事件日志是唯一持久化状态。** 可持久化的真相只有一条 append-only 的 `SessionEvent` 日志（`packages/core/session`）。除该日志外，不得在磁盘上写入任何代表"会话当前状态"的可变记录。

**规则：活动记录必须由折叠派生，而非独立存储。** `deriveMessages()`（模型历史）、`requestHeader()`、`requestContext()`、以及 `ctx.sessionProjections` 下的各投影，全部是从日志确定性 fold 出来的。它们**可丢弃**——重建日志即可重建它们，因此永远不要把派生结果当成真相源去单独持久化（投影缓存 `ctx.sessionProjectionCache` 是性能加速，不是真相源，且以 `(sessionId, key, ver, seq, val)` 形式带失效版本号）。

**规则：读取持久化决策前先 `flush`。** 在从存储读取任何"已落盘"的结论前，必须调用 `ctx.sessions.flush(session)`。日志的追加是热路径、异步缓冲的；不 flush 就读存储，会读到过期的尾部。

**规则：模型可见状态必须能从日志重建。** 任何要喂给 LLM 的 `Message` 历史，都必须来自 `session.deriveMessages()`（即 surface 折叠）。禁止绕开 surface、直接用手头的易变变量构造模型历史；surface 是模型历史的唯一来源，压缩（`replace`）会正确删除被遮蔽节点。

**规则：一个会话 = 一个生命周期控制器。** 用 `prepare → enter → announce`（或便捷方法 `ctx.sessions.create`）建立会话，用同一个 effect 在销毁时按顺序拆除。禁止把会话生命周期拆成互不知晓、会竞速的兄弟 effect——那会在最后一次事件提交前就移除发布钩子，导致尾部事件丢失。

**规则：事件的 `data` 必须无损 JSON 可序列化。** `session.append` 在追加处就用 `isJsonValue` 校验：BigInt、函数、symbol、undefined、`Date`/类实例等都会当场被拒绝。需要带额外信息（如工具私有 `meta`）时，必须是合法 `JsonValue`。

**规则：遵守 `seq = log.length` 连续性契约。** 事件序号永远等于追加时的日志长度，且从 0 连续。seed / fork / resume 时也必须校验连续性与序号对齐，否则日志与磁盘会无声地分叉。

**规则：Header 在日志之外，且不是可重放对话状态。** `SessionHeader`（id、格式版本、cwd、种子血缘、委派深度）是存储/血缘元数据，单独携带、不参与对话状态重放。不要在事件 `data` 里重复存放本应属于 header 的字段，也不要把对话状态塞进 header。

**规则：持久化是插件职责，订阅/落盘模式固定。** 后端订阅 `session/event` 获取追加，在 `session/flush` 并行落盘（必须 `await` 全部监听）。新增后端请实现 `packages/session/session-persistence` 的 `SessionPersistence` 抽象（或 `PersistenceBackend`），不要另起一套写入协议，也不要在核心存储里直接写盘。

**规则：状态携带事件用整值（whole-value），不用裸 delta。** 投影单元（`ProjectionDefinition.apply`）期望状态携带型日志事件带上**完整的变更后状态**，而非增量 diff——这让每个单元的转移成本恒定、且每个被服务的值自描述。新增日志事件时同样遵守。

**规则：surface 标记不可省略、不可乱标。** 每个消息产生型事件必须声明它的 `surfaceOp`（如何进入 surface），且 `sourceEventSeqs` 指向它派生的更早事件。裸事件（chunk、turn 边界）没有标记，正确地不进入模型历史。`Session.append` 在编译期即拒绝给非 surface 类型加 surface 元数据。

## 新增 / 修改事件类型

**规则：扩展 `SessionEventMap` 必须向后兼容。** 事件类型是 merge-extensible 的；新增类型时要写明 envelope 字段（`type`/`seq`/`time`/`data`，可选 `surfaceOp`/`sourceEventSeqs`/`ignorable`），并保证旧回放能安全跳过未知类型。禁止复用已删除的 `request/header-delta` 等遗留词汇。

**规则：fork 边界必须落在 turn 之间。** 用 `ctx.sessions.fork` 派生子会话时，边界 seq 必须落在 `turn/start`/`turn/end` 之间，禁止落在 open turn 内部（`OPEN_TURN` 错误），否则子会话历史不完整。

## 检索与查询

**规则：查询走 `ctx.sessionQuery`，且优先活数据。** 所有精确读取、有界窗口读取（`readWindowMax`）、血缘追踪、过滤、全文搜索，统一通过 `@flowforge/session-query` 的 `ctx.sessionQuery` 完成；有不同后端的 FTS 实现（如 `session-query-sqlite`）也挂在同一个服务上。不要自己直接扫持久化文件。

**规则：跨大日志读取要受窗口上限约束。** 一次读取的事件数不得超过 `SESSION_QUERY_READ_WINDOW_MAX`；需要更大范围时走分页游标（cursor），避免一次性把整条长日志拉进内存。

## 与 AI 工具协作

- 凡是要"判断某会话持久化到了哪一步 / 某结论是否已落盘"，先 `ctx.sessions.flush(session)` 再读。
- 凡是要"重建模型上下文"，一律 `session.deriveMessages()`，不要手搓。
- 凡是要"新增可持久化的状态"，先问：它能否从现有日志折叠得到？能，就写成投影/折叠，而不是新开一张表。
- 不要运行任何 git 命令；改动走仓库根 `AGENTS.md` 规定的 `./mgr` 流程。

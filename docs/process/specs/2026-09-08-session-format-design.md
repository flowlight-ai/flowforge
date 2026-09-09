# EP1-8 会话格式版本化 + 日志导出移植设计（A17/A20）

- 来源：dsh（`@deepseek-ai/dsh-*`）`packages/session/session-format{,-catalog,-v0-to-v1,-v1-to-v2}`（**A17**，4 包）+ `packages/session-query/session-log-export`（**A20**，1 包）
- 落点：`packages/session/session-format`、`packages/session/session-format-catalog`、`packages/session/session-format-v0-to-v1`、`packages/session/session-format-v1-to-v2`（新包 `@flowforge/session-format*`）与 `packages/session-query/session-log-export`（新包 `@flowforge/session-log-export`）
- 依据：`docs/refactor/review_code.md` §13.2（批次 8，A17/A20 登记）、§6 crosswalk 漂移、`docs/refactor/task.md` 序列 8、`docs/refactor/10-stage-map.md` D47/D48
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9；沿用 EP1-6/EP1-7 移植风格（框架无关 + 注入式 ports seam + 真实内存实现契约测试 + 纯函数抽取）
- 编译：各包 `tsc -b tsconfig.host.json` exit 0 + `oxlint` 0 告警；ESM；文件 ≤1000 行
- 边界：本批次仅留盘（设计文档 + 任务登记），由主会话统一提交（不做 git add/commit/push/mgr）
- 运行时依赖：`zod`（复用既有 workspace 依赖）；复用既有 `@flowforge/session-persistence` / `@flowforge/session-query` / `@flowforge/attachment` / `@flowforge/brand` / `@flowforge/llm`；`fflate` 仅 host 压缩合规引入
- 承诺：**零引用 `@deepseek-ai/*`、`@cat-cafe/*`、`@clowder-ai/*`**；宿主上下文、存储、连接、Schema、assistant-stream 状态机、brand 全部以包内注入式 seam / 本地纯模块呈现

## 1. 范围界定

五个源包共同构成 **“会话持久化格式版本化 + 迁移链 + 导出”**。总体职责如下：

| 源包 | 职责 | flowforge 落点包（新建） |
|---|---|---|
| `session/session-format` | **核心纯机制**：Session 逻辑工件类型（header/event/artifact）、物理 JSON codec 抽象（`SessionFormatCodec`）、相邻迁移声明（`SessionFormatMigration`）、链规划器/运行器（`SessionFormatChain`）、物理分发目录（`SessionFormatCatalog`）、无损 JSON 快照、错误类型、规范日志文件名映射 | `@flowforge/session-format` |
| `session/session-format-catalog` | **装配静态目录**：把 released v0/v1/v2 codec + v0→v1、v1→v2 迁移 + “已安装当前 Session”恢复/校验器编译为唯一 `sessionFormatCatalog`（currentVersion=2） | `@flowforge/session-format-catalog` |
| `session/session-format-v0-to-v1` | **冻结 v0/v1 物理 codec + 身份迁移**：v0/v1 共享布局的 physical header/事件行编解码、`RELEASED_V0_EVENT_DISPOSITIONS` 事件清册、跨事件关系校验、payload 语义校验、legacy（pre-react-loop）事件归一化；`sessionFormatV0ToV1`（0→1） | `@flowforge/session-format-v0-to-v1` |
| `session/session-format-v1-to-v2` | **冻结 v2 物理 codec + assistant-stream 迁移**：把 v1 顶层 `assistant/chunk` 流折叠进 v2 的 `assistant/attempt` + `assistant/message` 内嵌 stream，经重排重写 seq 引用并重算继承截断；`sessionFormatV1ToV2`（1→2） | `@flowforge/session-format-v1-to-v2` |
| `session-query/session-log-export` | **会话日志导出**：Host 侧把会话逻辑日志规范化为 JSONL，连同所有子代理后代 log 与引用的图片/附件，增量流式压缩为 ZIP（`/api/session.export` 下载路由 + `/export` 命令 + 浏览器下载控制器） | `@flowforge/session-log-export` |

### 跨包依赖图

```
@flowforge/session-format                    （核心：types / chain / catalog / codec / json / error / filename）
        ▲                                          ▲
        │ 继承 core 契约                              │ 复用 RELEASED_V1 codec / dispositions / assertReleasedV1*
@flowforge/session-format-v0-to-v1 ───────────────► @flowforge/session-format-v1-to-v2
        │                                                      │
        └───────────────► @flowforge/session-format-catalog ◄──┘
                                 │ 依赖"已安装当前 Session" seam（SESSION_FORMAT_VERSION / KNOWN_SESSION_EVENT_TYPES /
                                 │    validateHeader / validateArtifact），非  @deepseek 运行时引用
                                 ▼
@flowforge/session-log-export  （依赖 session-format 的 sessionFormatLogFilename；复用 @flowforge/session-persistence /
      @flowforge/session-query / @flowforge/attachment / @flowforge/brand；Host 接线 seam）
```

### 版本迁移链语义 v0 → v1 → v2

- **currentVersion = 2**。`SessionFormatChain` 只承认**相邻**迁移（`to === from + 1`，由 `defineSessionFormatMigration` 强制），构造时校验从 0..current 全连通（无缺口、无重复、无越界 from）。
- `plan(fromVersion)` 返回从存储版本到当前版本的**完整有序**相邻迁移序列；`migrate`/`migrateHeader` 逐段执行并调用各段 `validateTarget*` 后，经“已安装当前 Session”恢复/校验。
- 单向、无损（`snapshotSessionFormatJson` 深冻结、无负零、无转义漂移）；历史未知事件类型以 `SessionFormatUnsupportedMigrationError` 拒绝（v0 连 ignorable 也不放行），保证“缺席==不支持”而非静默吞掉。
- 读写分离：`SessionFormatCodec.decode*` 复原物理行 → `migrate` 在逻辑层逐段提升 → `SessionFormatCatalog.encodeCurrent` 以当前 v2 写入器重编码。

## 2. 依赖映射（消除 @deepseek-ai/* 与 @cat-cafe/*）

| 源依赖（`@deepseek-ai/*` 或 host） | 用途 | FlowForge 消除方案 |
|---|---|---|
| `dsh-session-format`（核心） | types/chain/catalog/codec/json/error/filename | **`@flowforge/session-format`** 新建核心包（本地契约，逐字移植） |
| `dsh-session-format-v0-to-v1` | v0/v1 codec + dispositions + 校验 + 0→1 迁移 | `@flowforge/session-format-v0-to-v1` 新建 |
| `dsh-session-format-v1-to-v2` | v2 codec + 1→2 迁移 | `@flowforge/session-format-v1-to-v2` 新建 |
| `dsh-util-values`（`deepFreeze` / `snapshotJsonValue` / `deepEqualJson`） | 无损深快照与深度相等 | **包内 `src/pure/json-value.ts` 本地实现**（`snapshotJsonValue` + `deepFreeze` + `deepEqualJson`，自包含无外部依赖；core 的 `json.ts` 与 v0-to-v1 `relationships.ts`、v1-to-v2 `validation.ts` 改用本地模块） |
| `dsh-llm`（`AssistantStreamAccumulator` / `BlockAssembler` / `expandAssistantStream` / stream chunk 类型） | v1→v2 折叠 assistant-stream、v2 stream payload 校验 | 优先复用 `@flowforge/llm`（现有 `packages/llm/llm`）；若其未导出等价 assistant-stream 状态机，则**包内 `src/pure/assistant-stream.ts` 本地纯模块**（chunk 分类累积 / block 组装含 `interruptedBlocks`/`usage`/`replayState` / 时序展开），供 v1-to-v2 使用 |
| `dsh-session`（`Session` / `SESSION_FORMAT_VERSION` / `KNOWN_SESSION_EVENT_TYPES` / `SessionId` / `SessionLogOffset` / `SessionEvent` / `SessionHeader` / `SessionStore`） | catalog 的“已安装当前”恢复校验；log-export 的日志/血缘/Store | flowforge 尚无独立 `@flowforge/session` 核心包：**以注入式 seam 呈现**——catalog 的 `restoreCurrent` / `restoreCurrentHeader` / 事件类型集合、log-export 的 `SessionStore`（`get`/`flush`）、`SessionId`/`SessionEvent`/`SessionHeader` 契型全部经 ports 注入 + 内存实现（见 §5），不产生 `@deepseek` 运行时 import |
| `dsh-session-persistence` | `SessionPersistence` / `SessionHandle`（open/read/close）/ `SessionPersistenceNotFoundError` | **复用 `@flowforge/session-persistence`**（现有包，类型对等；`SessionPersistenceNotFoundError` 映射到 flowforge 对应错误类型） |
| `dsh-session-query` | `SessionQueryEngine.traceSession` / `SessionLineageNode` | **复用 `@flowforge/session-query`**（现有包） |
| `dsh-attachment`（`AttachmentStore` / `ImageAttachmentRef` / `FileAttachmentRef`） | 导出 ZIP 内截图/文件条目读取 | **复用 `@flowforge/attachment`**（现有包 `AttachmentStore` 对等） |
| `dsh-brand`（`brandString`） | SessionId 品牌化 | **复用 `@flowforge/brand`**（现有包） |
| `cordis`（`Context` / client `Context` / module augmentation） | 宿主上下文、命令注册、fetch 路由注册、slot/locale | **注入式 `HostContextPort` / `DownloadContextPort` seam**（见 §5）：命令名、`/api/session.export` fetch 路由、slot/locale 全部改由调用方注入回调；不引 cordis |
| `schemastery`（`Schema<Config>`） | 压缩等级配置校验 | **包内 `src/pure/config.ts`**（用 `zod`——flowforge workspace 既有依赖——重建 `compressionLevel: 0..9 步进 1 默认 6`） |
| `dsh-commands`（`CommandResult`） | `/export` 命令结果 | **包内 `src/contract/command.ts`** 本地契型 |
| `dsh-client-store`（`createSnapshotStore` / `SnapshotStore`） | 浏览器下载态 store | **注入式 `SnapshotStorePort` + 内存 `MemorySnapshotStore`**（uSES 快照语义），供 `SessionLogDownloadController` 使用 |
| `dsh-client-locale/*`、`dsh-client-ui-*/*`、`react`/`Dialog.tsx`/`HeaderAction.tsx` | 浏览器弹窗/头部按钮 UI | **归 EP2（A32 前端融合）**：本批次仅交付框架无关的下载控制器（controller + MemorySnapshotStore），React 壳在 EP2 接线 |
| `fflate`（`Zip` / `ZipDeflate`） | host 流式 ZIP | 保留为 `@flowforge/session-log-export` 的 host 运行时依赖（非 `@deepseek`），按 flowforge 依赖管控合规引入 |

> 关键解耦：五个包均不产生任何 `@deepseek-ai/*` / `@cat-cafe/*` / `@clowder-ai/*` 运行时 import。跨包仅依赖用户自己的 `@flowforge/session-format*`、既有 `@flowforge` 基础包，以及 `zod`/`fflate` 两个非 DeepSeek 依赖。宿主上下文、存储、连接、assistant-stream 状态机、brand、SnapshotStore 全部注入化 / 本地纯实现。

## 3. 核心 wire 形状 / 数据模型

### 3.1 logical Session（core 的 `types.ts`）

- JSON 原语/值/对象：`SessionFormatJsonPrimitive / Value / Object`（无损、只读）。
- `SessionFormatHeader`：`{ version, id, createdAt, cwd?, parentSession?, isSeeded, origin?:'subagent', delegationDepth, agentPreset? }`。
- `SessionFormatEvent`：`{ type, seq, time, data }`（`seq` 必须连续且从 0 起；`data` 为任意无损 JSON）。
- `SessionFormatArtifact`：`{ header, inheritedEventCount, events }`。
- 物理 codec 输出 `EncodedSessionFormatArtifact`：`{ header: JsonObject, rows: readonly JsonObject[] }`（一行一条 JSONL）。

### 3.2 SessionFormatCodec / Chain / Catalog 签名

```
SessionFormatMigration { name; fromVersion; toVersion;
  migrateHeader(header): header; migrate(artifact): artifact;
  validateTarget(artifact): void; validateTargetHeader(header): void }

SessionFormatCodec { version;
  decodeHeader(unknown): SessionFormatHeader;
  decodeArtifact(headerValue, rowValues[]): SessionFormatArtifact;
  decodeRecoverableArtifact(headerValue, rowValues[]): SessionFormatArtifact }   // crash-tail 前缀恢复

SessionFormatChain { currentVersion;
  plan(fromVersion): Migration[]; migrate(artifact): artifact; migrateHeader(header): header }
SessionFormatCatalog { currentVersion;
  readHeader(unknown): SessionFormatHeaderReadResult;      // current | migration-required | unsupported | malformed
  decodeArtifact(headerValue, rowValues[]): SessionFormatArtifact;
  decodeRecoverableArtifact(...): SessionFormatArtifact;
  migrate(artifact): SessionFormatArtifact; encodeCurrent(artifact): EncodedSessionFormatArtifact }
```

### 3.3 v0 / v1 物理布局（`codec.ts`，共享 release，仅 `seedLength` 语义差异）

- physical header：`{ type:'session', version, id, createdAt, cwd?, parentSession?, seedLength?(v0/v1 用, 承接 isSeeded), origin?, delegationDepth, agentPreset? }`；decode 后 seedLength→`isSeeded` + `inheritedEventCount`。
- 事件行：每行一个事件对象；支持**打包 chunk 行**（`text-chunks` / `reasoning-chunks` / `tool-call-chunks`：`{type, seq0, time0, data:{turn, step, index, dt[], texts[]|args[], id?, name?}}`）与 `sourceEventSeqs` 区间压缩（`[start,end]` 对 + 单值）。
- `RELEASED_V0_EVENT_DISPOSITIONS`：约 80+ 事件类型的 `{required, optional, opaque}` payload 清册（`dispositions.ts`）。

### 3.4 v2 物理布局（`codec.ts`）

- physical header：**弃用 `seedLength`**，显式 `isSeeded: boolean`；其余字段同。
- 事件行：除普通事件外新增：
  - `assistant/attempt`：`{ turn, step, stream }`——由 **v1→v2 折叠整段 assistant/chunk 流**（经 assistant-stream 状态机累积为时序化 stream，`messageEvent`/`attemptEvent` 产出）。
  - `assistant/message`：`{ turn, step, message, stream, usage?, interrupted? }`——`message.content` 必须与内嵌 `stream` 装配出的 blocks 深度相等。
  - `session/end-seed`：`{ inherited?: true }` 标记——**v2 用“最后一段 inherited=true 的 end-seed”定义继承截断**（不再用 header seedLength）。
- `RELEASED_V2_EVENT_DISPOSITIONS`：从 v0 清册剔除 `assistant/chunk` / `assistant/message` 旧形态，新增 `assistant/attempt` 等。

### 3.5 迁移函数确切签名与语义

**v0→v1：`sessionFormatV0ToV1 = defineSessionFormatMigration({ name:'@flowforge/session-format-v0-to-v1', fromVersion:0, toVersion:1, ... })`**
- `migrateHeader(header)`：断言 v0 → `{ ...header, version: 1 }`。
- `migrate(source)`：`assertReleasedV0SourceArtifact` → 逐事件 legacy **归一化**：
  - `steering/message` → `user/message`（拆 `turn`，包装或补齐 `{id, role:'user'}`）；
  - `turn/start`/`turn/end` 收敛（trigger 折叠、error/aborted/disposed 语义保留）；
  - `request/header` 剥离 `messagePrefix`；
  - `user/message` / `assistant/message` / `tool/result` 补齐 `message` 身份与 source（`legacy-message:{sessionId}:{seq}`）；
  - 拒绝 `request/header-delta`、`mode/set`、`request/header reason:'fallback'`。
  - 随后 `assertNormalizedReleasedV0Artifact` + `snapshotSessionFormatArtifact({header:version1,...})` + `assertReleasedV1Artifact`。
- `validateTarget`/`validateTargetHeader`：`assertReleasedV1Artifact` / `assertReleasedV1Header`。

**v1→v2：`sessionFormatV1ToV2 = defineSessionFormatMigration({ name:'@flowforge/session-format-v1-to-v2', fromVersion:1, toVersion:2, ... })`**
- `migrateHeader(header)`：断言 v1 → `{ ...header, version: 2 }`。
- `migrate(source)`：`assertReleasedV1Artifact` → `collectAttemptGroups`（按 `turn:step` 归并 v1 `assistant/chunk` 尝试组，遇 `finish`/`step/end`/`turn/end`/`llm/retry*` 封组）→ 逐事件重排：chunk 组 → `assistant/attempt`（`streamOf(group)`）或并入 `assistant/message` 内嵌 stream；普通事件改写 `seq` 并**重映射全部 seq 引用**（`sourceEventSeqs`、`surfaceOp.replace{start,end}`、`command/done.sourceEventSeq`、`compaction/prune|summary.shadowedRange/shadowedSeqs`、`session/title*.messageSeqs`）；重算继承截断（`remapInheritedCut`，拒绝切割单个 attempt）；必要时补 `session/end-seed{inherited:true}`；`snapshotSessionFormatArtifact` + `assertReleasedV2Artifact`。
- `validateTarget`/`validateTargetHeader`：`assertReleasedV2Artifact` / `assertReleasedV2Header`。

### 3.6 session-log-export 入参 / 产出契约

- 配置：`Config = { compressionLevel?: SessionLogCompressionLevel }`（0–9，默认 6）。
- 服务依赖 `SessionLogExportDeps = { sessionQuery?, sessionPersistence?, attachments?, sessions? }`；就绪收窄 `SessionLogExportReady`（`sessions?` 保留可选）。
- 核心函数：
  - `sessionLogExportDeps(ctx)`：从注入上下文解析四项服务。
  - `flushLiveSessionLog(deps, id, signal?)`：对 live session 经 `sessions.flush` 做持久化屏障。
  - `readSessionLogText(persistence, id, signal?): Promise<string|undefined>`：open(read)→read(0,·)→`serializeSessionLog`→close；不存在返回 `undefined`。
  - `serializeSessionLog(header, events): string`：规范 JSONL = 首行 v2 physical header + 每事件一行 + 末尾换行（与 JSONL 后端同构）。
  - `sessionLogZipFilename(sessionId)`：`dsh-session-<sanitized>.zip`。
  - `sessionLogZipEntries(deps, rootContent, sessionId, includeDescendants, signal?): AsyncGenerator<SessionLogZipEntry>`：依次产 root log（`SESSION_LOG_FILENAME` = 当前代的 `session[.vN].jsonl`）→ 子代理后代（`subagents/<id>/<SESSION_LOG_FILENAME>`）→ 图片（`media/<attachmentId>.<ext>`，content-addressed 去重）→ 文件（`files/<digest0:2>/<digest>/<name>`，流式）。
  - `streamSessionLogZip(...): ReadableStream<Uint8Array>`：fflate 增量 ZIP，`ResponseCapacityGate` 反压（64 KiB 高水位），请求/消费取消合并到生产者 signal，失败 fail-loud。
- `SessionLogZipEntry = {path, content:string} | {path, data:Uint8Array} | {path, chunks:AsyncIterable<Uint8Array>}`。
- 下载路由：`GET|HEAD /api/session.export?sessionId=…&includeDescendants=true`；`/export` 命令（Web）触发。客户端 `SessionLogDownloadController.download/dismiss/dispose`（注入 fetcher/save/Store）。

## 4. 目录结构

沿用 EP1-6/EP1-7 的 `src/{contract,pure,ports}/` + 包驱动布局：

```
packages/session/session-format/                    @flowforge/session-format      (核心纯机制)
  package.json / tsconfig.json / tsconfig.host.json
  src/
    index.ts
    types.ts                # SessionFormat* 全契约类型
    chain.ts                # defineSessionFormatMigration / createSessionFormatChain
    catalog.ts              # createSessionFormatCatalog
    json.ts                 # 无损 JSON 快照 / version / count / inspect
    error.ts                # SessionFormatError / SessionFormatUnsupportedMigrationError
    filename.ts             # sessionFormatLogFilename / parseSessionFormatLogFilename
    pure/json-value.ts      # snapshotJsonValue / deepFreeze / deepEqualJson（本地，替代 dsh-util-values）
  tests/  *.test.ts

packages/session/session-format-v0-to-v1/           @flowforge/session-format-v0-to-v1
  src/
    index.ts
    codec.ts                # releasedV0/V1 codec（decode/encode/recoverable + packed rows + seq-range）
    dispositions.ts         # RELEASED_V0_EVENT_DISPOSITIONS / RELEASED_V0_EVENT_TYPES
    migration.ts            # sessionFormatV0ToV1（legacy 归一化 + 身份迁移）
    validation.ts           # assertReleasedV0/V1Header/Artifact / restoreReleasedV1 / surface metadata
    validation-helpers.ts   # releasedV0Record / assertReleasedV0Keys
    payload-validation.ts   # assertReleasedPayloadSemantics（~80 事件类型语义）
    relationships.ts        # assertReleasedArtifactRelationships（turn/step/tool/compaction/retry/title…）
  tests/  *.test.ts

packages/session/session-format-v1-to-v2/           @flowforge/session-format-v1-to-v2
  src/
    index.ts                # 复用 v0-to-v1 的 releasedV1SessionFormatCodec（依赖同包）
    codec.ts                # releasedV2SessionFormatCodec
    dispositions.ts         # RELEASED_V2_EVENT_DISPOSITIONS / RELEASED_V2_EVENT_TYPES
    validation.ts           # assertReleasedV2Header/Artifact/PhysicalArtifact / restoreReleasedV2Artifact
    migration.ts            # sessionFormatV1ToV2（assistant-stream 折叠 + seq 重映射）
    pure/assistant-stream.ts# AssistantStreamAccumulator/BlockAssembler/expandAssistantStream（本地，替代 dsh-llm）
  tests/  *.test.ts

packages/session/session-format-catalog/            @flowforge/session-format-catalog
  src/
    index.ts                # re-export sessionFormatCatalog + SessionFormatUnsupportedMigrationError
    generated.ts            # sessionFormatCatalog = createSessionFormatCatalog({currentVersion:2, codecs, migrations, restoreCurrent/currentHeader})
    installed-session.ts    # validateInstalledCurrentSessionHeader/Artifact（经 seam）
    ports/installed-session.ts  # InstalledSessionPort + MemoryInstalledSession（SESSION_FORMAT_VERSION / KNOWN_EVENT_TYPES / validate*）
  tests/  *.test.ts

packages/session-query/session-log-export/          @flowforge/session-log-export
  package.json / tsconfig.json / tsconfig.host.json
  src/
    index.ts                # apply(...)/Config + route + command 装配（经 HostContextPort 注入）
    archive.ts              # serializeSessionLog / readSessionLogText / flushLiveSessionLog / sessionLogZipEntries / streamSessionLogZip
    controller.ts           # SessionLogDownloadController（下载状态机，注入 fetcher/save/SnapshotStore）
    contract/command.ts     # CommandResult 本地契型
    contract/config.ts      # zod 重建 Config（compressionLevel 0-9）
    pure/zip.ts             # ResponseCapacityGate / pushArtifact/Binary/StreamChunks / 附件路径（纯/反压）
    ports/context.ts        # HostContextPort / DownloadContextPort seam
    ports/snapshot-store.ts # SnapshotStorePort + MemorySnapshotStore
    ports/live-session.ts   # LiveSessionStoreSeam（get/flush）——替代 dsh-session SessionStore 注入
  tests/  *.test.ts         # host（archive/route/loader-composition）+ controller 契约
```

## 5. 注入 ports 契约（seam + 内存实现）

- `InstalledSessionPort`（catalog 用）：`version: number`（=2）、`knownEventTypes(): ReadonlySet<string>`、`validateHeader(header): void`、`validateArtifact(artifact): void`。内存实现 `MemoryInstalledSession` 内置 released v2 事件清册与校验，契约测试真实还原（非 mock）。
- `LiveSessionStoreSeam`（log-export 用）：`get(id): Session | undefined`、`flush(session): Promise<void>`。内存实现。
- `HostContextPort`（log-export 装配用）：`registerCommand({name,description,handler})`、`registerFetch({path,methods,requestBody,fetch})`、`config: { compressionLevel }`。内存实现用于契约测试。
- `SnapshotStorePort`（下载控制器用）：`getSnapshot(): State`、`update(fn): void` + `MemorySnapshotStore`（uSES 语义）。
- `fetcher` / `save`：控制器构造注入（默认 `fetch` / `downloadUrl`），浏览器依赖全部经注入回调呈现。
- 内存实现满足：所有 seam 在契约测试中走**真实内存实现**（铁律 T9，无 mock），仅在边界（如真实 attachment store 读取）用同功内存替身。

## 6. 质量门槛

| 包 | 建议契约测试量级 | 目标 |
|---|---|---|
| `session-format`（core） | ≥ 20（chain 规划/migrate/migrateHeader、catalog readHeader 四态/dispatch/recoverable/encode、json 快照/负零、filename 映射、error） | `tsc -b` exit 0 + oxlint 0 |
| `session-format-catalog` | ≥ 6（generated 装配、current/migration-required/unsupported/malformed、installed-session 校验） | 同上 |
| `session-format-v0-to-v1` | ≥ 40（codec 打包/seq-range、legacy 归一化、payload 语义、relationships、surface、迁移链） | 同上 |
| `session-format-v1-to-v2` | ≥ 28（codec、assistant-stream 折叠、seq 重映射、end-seed 截断、validation、迁移链） | 同上 |
| `session-log-export` | ≥ 30（serialize JSONL、read/flush、zipEntries 顺序与去重、stream 反压/取消/错误、controller 下载态机） | 同上 |

合计 ≥ 120 契约测试；各包 `tsc -b tsconfig.host.json` exit 0、`oxlint` 0 告警（沿用 EP1-6/EP1-7 收官口径）。

---

> 迁移链与 wire 形状为 dsh 已发布版本事实，移植为逐字/语义等价重建（身份 v0→v1、assistant-stream v1→v2 除外，其为确定性重写，须以契约测试锁定）。本批次不动任何控制器/业务实现，仅设计文档 + 任务登记。
# EP1-6 上下文装配域 context-assembly 移植设计（B12）

- 来源：clowder-ai `packages/api/src/domains/cats/services/context`（B12），crosswalk 落点对应 `docs/refactor/10-stage-map.md` 上下文域矩阵行
- 落点：`packages/cats/context-assembly`（新包 `@flowforge/cats-context-assembly`）
- 依据：`docs/refactor/review_code.md` §13（EP1-6 任务登记）、§16 融合决策、`docs/refactor/10-stage-map.md`
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9
- 编译：包级 `tsc -b tsconfig.host.json` exit 0 + `oxlint` 0 告警；ESM；文件 ≤1000 行
- 边界：本批次仅留盘，由主会话统一提交（不做 git add/commit/push/mgr）
- 运行时依赖：仅 `zod`（peer/devDependency，workspace ^4.4.3）
- 承诺：**零引用 `@cat-cafe/*`、`@deepseek-ai/*`、clowder 内部路径**；外部平台/存储/配置 seam 全部以包内注入式端口呈现

## 1. 范围界定

`context-assembly` 源 18 个 TS 文件，实现猫（智能体）每次调用前的**上下文装配**：
选题解析（IntentParser）→ 富消息块规则（rich-block-rules）→ 消息束 Message Bundle 的
选题/载入/投影/载体解析（selection / source-projection / source-group / carrier-resolver /
digest / quote-matching / prompt-resolver）→ 治理 L0 编译（governance-l0）→ prompt 模板加载
（prompt-template-loader）→ 分期内容 L0 Staging（staging-content）→ 会话历史装配
（context-assembler）→ 系统提示构建（system-prompt-builder）。

本批次交付**自包含、接口驱动、注入式 seam 的域内核**：

1. **域名契约（contract）**：`@cat-cafe/shared` 的 Message Bundle 契型 + schema 本地重建
   （`MessageBundleCarrierV1` / `MessageBundleItemV1` / selection items / 各 schema /
   digest domain / projection version 常量），放 `src/contract/message-bundle.ts`（按 clowder
   `message-bundle.schema.ts` 逐字移植，仅依赖 `zod`）。
2. **纯函数（pure）**：`canonical-json.ts`、`sha256-digest.ts`、`markdown-readable.ts`、
   `cli-tool-label.ts`、`token-estimate.ts`、`format-prompt-time.ts`、`entrusted-work-signals.ts`、
   `prompt-digest.ts` — 全部无外部依赖自包含。
3. **注入式端口（ports）+ 内存实现**：
   - `message-store.ts`：`StoredMessage` / `StoredToolEvent` / `IMessageStore`（`getById` /
     `getByThreadAfter`）+ `MemoryMessageStore`（供 `MessageSelectionResolver` 等消费）；
   - `thread-store.ts`：`Thread` / `IThreadStore`（`get`）+ `MemoryThreadStore`；
   - `visibility.ts`：`isSystemUserMessage` / `isTimelinePublished` / `getTimelineOrderTime` /
     `canViewMessage` / managed-hold connector 判断 — 由 clowder `stores/visibility.ts` 逐字移植为
     纯谓词模块（不引宿主 store）；
   - `cat-context.ts`：`CatContextPort`（猫配置/名册/模型/档案/prompt 管线 seam）注入口，
     供 `SystemPromptBuilder` / `ContextAssembler.getSenderName` / `StagingContent` 消费；
   - `file-system.ts`：`FileSystemSeam`（`readFileSync` / `existsSync` / 根目录解析）注入口，
     供 `governance-l0` / `prompt-template-loader` / `staging-content` 测试注入内存/临时文件系统。
4. **Message Bundle 子域（src/message-bundle/）**：`message-selection-types.ts` /
   `message-selection-results.ts` / `message-bundle-quote-matching.ts` /
   `message-bundle-project-digest.ts` / `message-bundle-source-projection.ts` /
   `message-bundle-source-group.ts` / `message-bundle-carrier-resolver.ts` /
   `message-selection-resolver.ts` / `message-bundle-prompt-resolver.ts` — 逐字移植。
5. **Context 子域（src/context/）**：`intent-parser.ts` / `rich-block-rules.ts` /
   `governance-l0.ts` / `prompt-template-loader.ts` / `staging-content.ts` /
   `context-assembler.ts` / `system-prompt-builder.ts` — 逐字移植（外部配置/文件 seam 注入化）。
6. **索引**：`src/index.ts` 统一导出。

**本批次不交付（EP2/EP4 下游承接）**：
- 真实 LLM/embedding 客户（`WebChatClient` / `llm route` / `extractUserIntentEmbedding`）— 只留 seam；
- 宿主存储接线（cats-stores SQLite / Redis）— 用内存端口实现满足契约测试；
- 宿主 prompt 目录 / `.cat-cafe` overlay — `prompt-template-loader` 以注入式
  `FileSystemSeam` + 可配置基准目录呈现，宿主接线归 EP2；
- `SystemPromptBuilder` 的 hook 管线（`buildStaticIdentityViaHookPipeline` /
  `buildInvocationContextViaHookPipeline`）、宿主 Quadratic/reservation 接线 — 以
  `CatContextPort.promptPipeline` 注入回调呈现，真实实现归 EP2/EP4。

## 2. 依赖映射（消除 @cat-cafe/* 与 @deepseek-ai/*）

| 依赖 | FlowForge 等价 / 处理 |
|---|---|
| `@cat-cafe/shared` Message Bundle 契型 + schema（MESSAGE_BUNDLE_VERSION / MessageBundleCarrierV1 / MessageBundleSelectionSchema / digest domain / projection version）| **包内 `src/contract/message-bundle.ts` 本地重建**（zod，逐字移植） |
| `@cat-cafe/shared` `RichBlock` / `MessageContent` / `RichMessageExtra` / `CrossThreadCoordination` / `isCrossThreadProvenance` / `CatId` / `ConnectorSource` / `SchedulerMessageExtra` / `CatConfig` / `Roster` / `ReviewPolicy` / `CoCreatorConfig` | **复用 `@flowforge/cats-shared`**（`@flowforge/cats-shared` 为既有 cats 基础包，非 clowder） |
| `@cat-cafe/shared` `cleanCliToolLabel` / `projectCliToolUseLabel` / `projectMarkdownReadableText` / `findGeneratedTextConstructs` | **包内 `src/pure/cli-tool-label.ts` + `src/pure/markdown-readable.ts` 本地实现**（自包含，无 remark/unified 运行时依赖） |
| `@cat-cafe/shared/dossier`（getDossierL0Pronouns / getDossierRosterSummary / hasDossierEntry）| **`CatContextPort.dossier` 注入口** |
| `config/cat-config-loader`（catHasRole / getReviewPolicy / getRoster / isCatAvailable / isCatLead）| **`CatContextPort` 注入口**（`roles` / `reviewPolicy` / `roster` / `availability`） |
| `config/cat-models.js`（getCatModel）| **`CatContextPort.resolvedModel(catId)` 注入回调** |
| `utils/monorepo-root`（findMonorepoRoot）| **`FileSystemSeam.rootDir` 注入** |
| `prompt-hooks/PipelinePromptBuilder` | **`CatContextPort.promptPipeline` 注入回调** |
| `utils/token-counter`（estimateTokens）/ `format-time`（formatPromptTime）| **包内 `src/pure/token-estimate.ts` + `format-prompt-time.ts` 本地实现** |
| `growing/EntrustedWorkSourceSignals`（containsEntrustedWorkTimeSignal）| **包内 `src/pure/entrusted-work-signals.ts` 本地实现** |
| `stores/ports/MessageStore.ts` / `ThreadStore.ts` / `visibility.ts` | **包内 `src/ports/*` 本地契型 + 纯谓词** |
| `CatRegistry`（`catRegistry.tryGet`）| **`CatContextPort.getConfig(catId)` 注入口** |
| `yaml`（prompt-template-loader / workflow-triggers.yaml）| **`FileSystemSeam` + 包内轻量 YAML 子集解析器 `src/pure/simple-yaml.ts`** |
| `zod`（message-bundle schema / selection schema）| `zod` peer/devDependency（workspace ^4.4.3） |

> 关键解耦：**不引任何 `@clowder-ai/*` 或 `@cat-cafe/*` 或 `@deepseek-ai`**。运行时依赖仅 `zod`
> 与既有 cats 基础包 `@flowforge/cats-shared`（peerDependency，非 clowder）。文件读取 / 配置 / 档案 /
> 模型 / prompt 管线 / LLM 客户均注入化。

## 3. Message Bundle 载体 wire 形状

从 clowder `@cat-cafe/shared` `schemas/message-bundle.schema.ts` 读取确认：

- `MESSAGE_BUNDLE_VERSION = 1`，`MESSAGE_BUNDLE_MAX_ITEMS = 50`。
- carrier：`{ v, sourceThreadId, note?, items[] }`；item 为 discriminated union：
  `message`（`{messageId}`）、`quote`（`{messageId, selectionStart, selectionEnd,
  sourceProjectionVersion, sourceProjectionSha256, comment?}`）、`cli_quote`
  （`{messageId, sourceMessageIds, segmentId, selectionStart, selectionEnd,
  sourceProjectionVersion, sourceProjectionSha256, comment?}`）、`rich_block`
  （`{messageId, sourceMessageIds, blockId, sourceProjectionVersion, sourceProjectionSha256}`）。
- **分级分辨率平面**：v1 raw-plane / v2 readable-plane（`projectMarkdownReadableText`）/
  v3 浏览器 canonical bubble 平面（`projectMessageBundleGroupQuoteSourceV3`）；
  CLI v1 raw stdout / v2 Markdown 渲染 stdout readable 平面。
- digest domain 常量：
  `cat-cafe:message-bundle-quote:v{1,2,3}\0`、`cat-cafe:message-bundle-cli-quote:v{1,2}\0`、
  `cat-cafe:message-bundle-rich-block:v1\0`（按需本地复刻同样 domain 区分字节）。

## 4. 目录结构

```
packages/cats/context-assembly/
  package.json / tsconfig.json / tsconfig.host.json
  src/
    index.ts
    contract/message-bundle.ts        # 契型 + schema + digest domain + projection version 常量
    pure/
      canonical-json.ts              # 稳定 JSON 序列化（digest 用）
      sha256-digest.ts               # node:crypto 封装
      markdown-readable.ts           # readable-text 投影 + findGeneratedTextConstructs（自包含）
      cli-tool-label.ts              # cleanCliToolLabel / projectCliToolUseLabel
      simple-yaml.ts                 # workflow-triggers / staging frontmatter 的轻量 YAML 子集
      token-estimate.ts              # estimateTokens
      format-prompt-time.ts          # formatPromptTime
      entrusted-work-signals.ts      # containsEntrustedWorkTimeSignal
      prompt-digest.ts               # createPromptDigest
    ports/
      message-store.ts               # StoredMessage / StoredToolEvent / IMessageStore / MemoryMessageStore
      thread-store.ts                # Thread / IThreadStore / MemoryThreadStore
      visibility.ts                  # 纯谓词（isTimelinePublished 等）
      cat-context.ts                 # CatContextPort（配置/名册/模型/档案/prompt 管线 seam）
      file-system.ts                 # FileSystemSeam
    message-bundle/
      message-selection-types.ts
      message-selection-results.ts
      message-bundle-quote-matching.ts
      message-bundle-project-digest.ts
      message-bundle-source-projection.ts
      message-bundle-source-group.ts
      message-bundle-carrier-resolver.ts
      message-selection-resolver.ts
      message-bundle-prompt-resolver.ts
    context/
      intent-parser.ts
      rich-block-rules.ts
      governance-l0.ts
      prompt-template-loader.ts
      staging-content.ts
      context-assembler.ts
      system-prompt-builder.ts
  tests/  *.test.ts
```

## 5. 注入 ports 契约

- `MessageStorePort`：`getById(id): StoredMessage | null`、`getByThreadAfter(threadId, afterId,
  limit, viewerUserId, opts)` — 供 selection resolver / carrier resolver 消费。
- `ThreadStorePort`：`get(threadId): Thread | null`、`accessCheck` 由 `canAccessSourceThread` 纯谓词承担。
- `CatContextPort`：
  - `getConfig(catId): CatConfig | undefined`
  - `getAllConfigs(): Record<string, CatConfig>`
  - `isCatAvailable(catId): boolean`
  - `roster`：`getRoster(): Roster`，`isCatLead(catId)`, `catHasRole(catId, role)`
  - `reviewPolicy: ReviewPolicy`
  - `resolvedModel(catId): string`（env → registry → default，F167 强制）
  - `dossier`：`getL0Pronouns(catId)`, `getRosterSummary(catId)`, `hasEntry(catId)`
  - `rootDir: string`、`frontendPort`/`apiServerPort`（staging runtime placeholder）
  - `promptPipeline: { buildStaticIdentity(catId, options): string; buildInvocationContext(ctx): string }`
- `FileSystemSeam`：`readFileSync(path): string | null`、`existsSync(path): boolean`、
  `rootDir: string`；测试注入内存实现。

## 6. 质量门槛
- `ner vitest run packages/cats/context-assembly` 全绿（真实内存 port 实现，临界路径非 mock）：
  MessageSelectionResolver 各类消息源（reply/quote/thread/scattered）选择排序、reach 预算与 fallback、
  source-projection 聚合/去重、prompt-template-loader 加载与缺失回退、governance-l0 段/裁剪/排序守卫、
  ContextAssembler 组装与面包屑载体、SystemPromptBuilder 多版本构建、StagingContent 生命周期、
  rich-block 规则、IntentParser 意图抽取。
- 包级 `tsc -b packages/cats/context-assembly/tsconfig.host.json` exit 0。
- `oxlint packages/cats/context-assembly` 0 warnings。
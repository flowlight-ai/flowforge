# EP1-2 实施计划：connectors IM 框架本体移植（B7，自包含批次）

- 依据：`docs/process/specs/2026-09-07-connectors-design.md`
- 批次目标：落 `packages/infrastructure/connectors`（@flowforge/infrastructure-connectors），IM 框架本体（绑定存储/权限/去重/路由/命令/格式化/出站/mention/富块纯文本/外部注册表/网关装配），vitest/tsc/oxlint 全绿，mgr PR。
- 遵循：测试铁律 T1–T9，禁 Mock。
- 边界：**不含** 依赖外部平台 SDK/凭据的 6 适配器 + github-repo-event + media（EP2/EP4 承接）。

## 步骤与门禁

| # | 步骤 | 产物 | 门禁 |
|---|---|---|---|
| 1 | 包骨架（package.json/tsconfig/index）+ workspace 依赖（@flowforge/cats-shared、@flowforge/infrastructure-redis-port） | `packages/infrastructure/connectors/` | pnpm install 解析 |
| 2 | TDD 红：13 契约测试文件 | `tests/*.spec.ts` | vitest 红 |
| 3 | 绑定存储 + 权限存储 + 去重 + mention + 富块纯文本 + 格式化 + 外部注册表 | `src/connector-{thread-binding-store,permission-store,message-formatter}.ts`、`inbound-message-dedup.ts`、`mention-parser.ts`、`rich-block-plaintext.ts`、`external-connector-registry.ts` | vitest 绿 |
| 4 | 命令助手 + 命令层（含 /history 轮次预算、/focus、/ask） | `src/connector-command-helpers.ts`、`src/connector-command-layer.ts` | vitest 绿 |
| 5 | 入站编排 ConnectorRouter（去重→绑定→写消息→触发） | `src/connector-router.ts` | vitest 绿 |
| 6 | 出站投递 + 流内联 OutboundDeliveryHook / StreamingOutboundHook | `src/outbound-delivery-hook.ts`、`src/streaming-outbound-hook.ts` | vitest 绿 |
| 7 | 网关装配（bootstrap/lifecycle/binding-keys）+ index 导出面整合 | `src/connector-gateway-{bootstrap,lifecycle}.ts`、`connector-binding-keys.ts`、`index.ts` | tsc |
| 8 | 全量核验 + oxlint | 全包 | vitest/tsc/oxlint 全绿 |
| 9 | mgr sync 提交 PR + review_code §13.2 序号 2 ✅ + 10-stage-map D43 + task.md | PR | mgr 通过 |

## 文件清单

- 新增（src）：`index.ts` + 上述 16 个"框架本体"模块。
- 测试：13 个 `*.spec.ts` 契约测试文件。
- 文档：spec 本文件上方已建、plan 本文件、review_code §13.2、10-stage-map D43、task.md。

## 验收

- ≥13 契约测试文件全绿；
- 包级 `tsc -p tsconfig.json --noEmit` exit 0；
- `oxlint` 0 error / 0 warning；
- 消除全部 `@cat-cafe/*` 引用；
- 走 plugin-dev 七阶段，经 `mgr.ps1 sync` 提交（类型 feat，scope connectors，署名 sherlock）。
# EP1-1a 实施计划：mcp-server 治理框架本体移植（自包含子批次）

- 依据：`docs/process/specs/2026-09-07-mcp-server-design.md`
- 批次目标：落 `packages/mcp/mcp-server`（@flowforge/mcp-server），治理框架 + json-schema-to-zod + server-toolsets 装配机制 + refresh-loop + protocol-server，vitest/tsc/oxlint 全绿，mgr PR。
- 遵循：测试铁律 T1–T9（真实 SDK server + 临时目录 fixture，禁 Mock）。
- 边界：**不含** 依赖 @cat-cafe/shared/finance 的领域 toolsets（EP1-1b，待领域层）。

## 步骤与门禁

| # | 步骤 | 产物 | 门禁 |
|---|---|---|---|
| 1 | 包骨架（package.json/tsconfig/index）+ pnpm-add 依赖（@modelcontextprotocol/sdk/zod/js-tiktoken/yaml） | `packages/mcp/mcp-server/` | pnpm install 解析 |
| 2 | TDD 红：治理/校验/快照/转换/装配/protocol 契约测试 | `tests/*.spec.ts` | vitest 红 |
| 3 | 移植 tool-governance-types/ts/registry/validation/snapshot + canonical-tool-registry + json-schema-to-zod（zod v4 适配） | `src/tool-governance-*.ts` 等 | vitest 绿 |
| 4 | server-toolsets 装配机制（parseToolsetEnv/applyReadonlyFilter/registerTools）+ refresh-loop | `src/server-toolsets.ts`、`src/refresh-loop.ts` | vitest 绿 |
| 5 | protocol-server + protocol-engine（loader/engine/types/template-utils/auth） | `src/protocol-server.ts`、`src/protocol-engine/` | vitest 绿 |
| 6 | index.ts 导出面整合 | `src/index.ts` | tsc |
| 7 | 全量核验 + oxlint | 全包 | vitest/tsc/oxlint 全绿 |
| 8 | mgr sync 提交 PR + review_code §13.2 序号 1（1a 标记）+ 10-stage-map C43 | PR | mgr 通过 |

## 文件清单

- 新增（src）：`tool-governance-types.ts`、`tool-governance.ts`、`tool-governance-registry.ts`、`tool-governance-validation.ts`、`tool-governance-snapshot.ts`、`canonical-tool-registry.ts`、`json-schema-to-zod.ts`、`server-toolsets.ts`、`refresh-loop.ts`、`protocol-server.ts`、`protocol-engine/{engine,index,loader,template-utils,types,auth/{apikey,hmac-sha256-v4,index,jwt-hs256}}.ts`、`index.ts`
- 测试：`tool-governance.spec.ts`、`tool-governance-validation.spec.ts`、`tool-governance-snapshot.spec.ts`、`json-schema-to-zod.spec.ts`、`server-toolsets.spec.ts`、`protocol-server.spec.ts`
- 文档：spec 已建、plan 本文件、review_code §13.2、10-stage-map C43、task.md

## 验收

- ≥8 契约测试文件全绿；
- 包级 `tsc -p tsconfig.json --noEmit` exit 0；
- `oxlint` 0 error / 0 warning；
- 走 plugin-dev 七阶段，经 `mgr.ps1 sync` 提交（类型 feat，scope mcp-server，署名）。
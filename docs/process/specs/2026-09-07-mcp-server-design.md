# EP1-1 mcp-server 整包移植设计（分两子批次）

- 来源：clowder-ai `packages/mcp-server`（B1），crosswalk 落点 C43（`10-stage-map.md`）
- 落点：`packages/mcp/mcp-server`（新包 `@flowforge/mcp-server`）
- 依据：`docs/refactor/review_code.md` §13.2 序号 1、§16 融合决策
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9（真实 SQLite/文件系统，禁 Mock）
- 编译：包级 `tsc --noEmit` exit 0 + oxlint 0 告警；ESM

## 1. 范围界定

clowder `mcp-server` 源约 100 个 TS 文件，依赖面分两类：

1. **自包含治理框架本体**（仅依赖 zod / @modelcontextprotocol/sdk / node 内置）——首批次 **EP1-1a** 交付：
   - `tool-governance-types.ts`、`tool-governance.ts`、`tool-governance-validation.ts`
   - `tool-governance-registry.ts`、`tool-governance-snapshot.ts`
   - `canonical-tool-registry.ts`（registry 构建/投影机制）
   - `server-toolsets.ts`（**仅注册机制**：parseToolsetEnv/applyReadonlyFilter/registerTools 装配；工具源由插件注入，不硬编码 clowder 工具）
   - `json-schema-to-zod.ts`（JSON Schema → Zod，源为 v3，flowforge 为 zod **v4**，需迁移适配）
   - `refresh-loop.ts`
   - `protocol-server.ts` + `protocol-engine/`（通用协议服务器：读 protocol YAML → 暴露 MCP 工具，可作视频/生态插件协议底座）

2. **领域耦合 toolsets**（`tools/*-tools.ts` 大量 import `@cat-cafe/shared` / `@cat-cafe/finance`，这些 domain 属 EP4-3 未移植）——第二批 **EP1-1b** 待领域层承接后落地：collab/memory/signals/limb/audio/finance 六 family 的 canonical 工具清单与 `callback-*` HTTP 代理 seam。

> 选型原则：迁移即重构，非逐行翻译；`@cat-cafe/shared`/`@cat-cafe/finance` 依赖绝不引入 flowforge（用户硬性约束：禁 @deepseek-ai/@cat-cafe 依赖），领域工具在自身领域层移植后由 mcp-server 以注册注入方式暴露。

## 2. zod v4 适配（核心工程决策）

- clowder 用 zod `^3.22.4`，flowforge 已统一 zod `^4.4.3`（mcp-client 引用）。
- `json-schema-to-zod` 中 `z.enum(tuple)`、`z.object(shape)`、`z.record(z.string(), z.unknown())`、`.describe()` 在 v4 均兼容，仅需类型导入调整；测试断言 API 尽量贴合 v4。
- `tool-governance-snapshot.ts` 用 `@modelcontextprotocol/sdk/server/zod-json-schema-compat.js` 的 `toJsonSchemaCompat`（v1.12 仍在，保持）与 `js-tiktoken`（cl100k_base 计 token）。
  - **决策**：`js-tiktoken` 为 runtime 依赖。若 monorepo 未装，列入 `@flowforge/mcp-server` dependencies 并 pnpm-add；token 计量仅用于 descriptionDigest/descriptionTokens 快照字段，不影响工具功能。

## 3. 包结构（EP1-1a）

```
packages/mcp/mcp-server/
  package.json          # @flowforge/mcp-server, ESM
  tsconfig.json         # extends ../../../tsconfig.base.json
  src/
    index.ts            # 导出面
    tool-governance-types.ts
    tool-governance.ts
    tool-governance-validation.ts
    tool-governance-registry.ts
    tool-governance-snapshot.ts
    canonical-tool-registry.ts
    json-schema-to-zod.ts
    server-toolsets.ts  # 仅装配机制（可注入工具源）
    refresh-loop.ts
    protocol-server.ts
    protocol-engine/{engine,loader,template-utils,types,auth/*}.ts
  tests/
    tool-governance.spec.ts      # defineMcpTool/derive annotations/registry delta
    tool-governance-validation.spec.ts  # 真实注册表 + 伪造 evidence/index cases
    tool-governance-snapshot.spec.ts   # snapshot + compare + protocol parity
    json-schema-to-zod.spec.ts
    server-toolsets.spec.ts      # parseToolsetEnv/applyReadonlyFilter 真实过滤
    protocol-server.spec.ts      # fixture protocol YAML → MCP 工具装配
```

## 4. 关键契约（照搬 C 源语义）

- `McpServerFamily` = collab | memory | signals | limb | audio | finance
- `defineMcpTool(input)`：由 operation/boundary 推导 `effectiveRisk`、`annotations`（readOnlyHint/destructiveHint/openWorldHint）、`actionInventory`、`inputSchema`
- `buildCanonicalToolRegistry(sources)`：断言治理证书完备 + 名称唯一 + 排序
- `projectCanonicalToolRegistry(registry, env)`：desktop → 双 profile 白名单；readonly → readonly ∪ agent-key
- `validateToolGovernance(definitions, {evidenceCatalog, implementationCatalog, protectedBase})`：duplicate-name/unresolved-evidence/protected-base-drift/admission-mismatch 等 10 类 GovernanceFinding
- `createMcpSurfaceSnapshot` / `compareMcpSurfaceRegistry` / `compareMcpSurfaceProtocol`：schemaVersion 2、cl100k_base digest
- `createServer()`：注册后可被相同 mechanism 装配任意注入工具源（EP1-1b 复用）

## 5. 测试策略

- 契约测试用**真实** `McpServer` + 注入内存工具定义（不走 stdio），不 Mock SDK。
- protocol-server 用临时目录 fixture YAML 断言工具数/参数 schema/认证参数注入。
- 覆盖：定义→推导、registry 构建/投影、validation 10 类 finding、snapshot/parity、zod v4 转换、env 过滤优先级。

## 6. 验收（EP1-1a）

- ≥8 契约测试文件全绿（vitest）
- 包级 `tsc --noEmit` exit 0；`oxlint` 0 error/0 warning
- `pnpm install` 解析成功（新增 @modelcontextprotocol/sdk/zod/js-tiktoken 依赖合规）
- 走 plugin-dev 七阶段，经 `mgr.ps1 sync` 提交（type feat，scope mcp-server，署名），登记 review_code §13.2 序号 1（标记 1a 完成、1b 待领域层）与 10-stage-map C43
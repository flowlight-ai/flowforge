# EP1-1b mcp-server 领域工具集迁移设计（collab / memory / signals / limb）

- 依据：`docs/process/specs/2026-09-07-mcp-server-design.md` §1.2、`docs/refactor/review_code.md` §13.2 序号 1 与 §15 Q3
- 来源：clowder-ai `packages/mcp-server/src/tools/*`（B1），crosswalk 落点 C43
- 落点：`packages/mcp/mcp-server`（@flowforge/mcp-server）`src/toolsets/`
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9（真实 SDK server + 临时目录 fixture，禁 Mock）
- 编译：包级 `tsc --noEmit` exit 0 + oxlint 0 告警；ESM；zod v4（v3 zod 迁移适配沿用 EP1-1a 既有 `jsonSchemaToZod`/shape 兼容）
- 硬性约束：零 `@deepseek-ai` / `@cat-cafe` / `@clowder` 依赖；领域实现交宿主接线，本包只交付**治理清单 + 注入式回调端口**

## 1. 范围界定

EP1-1a 已落地自包含治理框架（tool-governance-*、canonical-tool-registry、server-toolsets 装配机制、json-schema-to-zod、refresh-loop、protocol-server），并预留「工具源由插件注入，不硬编码 clowder 工具」。EP1-1b 补齐**领域耦合工具集的工具目录（catalog）与治理证书**，打开 EP1-1a 预留的注入装配位。

Q3 已裁决（2026-09-10）：**剔除 finance / audio 家族**。故本次迁移四个家族共 33 工具组：

| 家族 | 工具组（clowder `CANONICAL_TOOL_SOURCES` 溯源） | 组数 |
|---|---|---|
| **collab** | callback / capability-evolution / capability-evolution-round / capability-evolution-change / auto-dream / community-route-acceptance / external-review-verdict / external-runtime-session-callback / hub-action / skill-consumption / entrusted-work-read / event-memory / publish-verdict / eval-lifecycle / paw-feel-disposition / rich-block-rules / game-action / schedule / shell | 19 |
| **memory** | callback-memory / distillation / evidence / external-runtime-session-read / meeting-artifact / file-slice / graph / library-lifecycle / perspective / recent / session-chain | 11 |
| **signals** | signals / signal-study | 2 |
| **limb** | limb | 1 |

> 工具组英文名与 clowder 源文件对应注释在 `src/toolsets/README.md` 命名映射表逐行登记（见 §4）。

## 2. 迁移模型（迁移即重构，非逐行翻译）

clowder 各 `*-tools.ts` 的 handler 几乎全部收敛为两类回调：

- `callbackPost(path, body, { agentKeyCatId, ... })` → `ToolResult`
- `callbackGet(path, params, { agentKeyCatId })` → `ToolResult`

这些 handler 依赖 `@cat-cafe/shared`（域名/API URL 装配）与 `getCallbackConfig`。flowforge **不引入**这些依赖，改为：

### 2.1 注入式回调端口（CallbackTransportPort）

定义宿主注入的回调传输端口，取代 clowder 的全局 `getCallbackConfig` + `fetch`：

```ts
export type CallbackRequest = {
  method: 'POST' | 'GET';
  path: string;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  agentKeyCatId?: string;
};

export type CallbackTransportPort = {
  readonly id: string;
  readonly send: (req: CallbackRequest) => Promise<ToolResult>;
};
```

- 每个工具组的 handler 经包级共享助手 `createCallbackInvoker(port)` 生成 `(args) => port.send({ method, path, body, params, ... })`。
- **注入接线点**：装配入口 `assembleMcpSeverToolsets(port)` 接收 `CallbackTransportPort`，返回 `CanonicalToolSources`；宿主（插件 / MCP provider）在领域层接线后传入。未接线时 `registerToolset` 不注册任何工具（fail-open，与 EP1-1a 空配置行为一致）。
- clowder 的 KD-6（CatRoutingError 400 前缀）、callback-auth 失败 reason 标签、出站队列/重试、agent-key 选择等**决策逻辑**不做搬运——它们是宿主层职责；本包回调端口仅承载请求/响应契约。

### 2.2 工具目录（catalog）形态

每个工具组一个模块，导出 `defineMcpToolsetTools(...)` 构建的定义数组。每个工具沿用定义：

```ts
defineMcpToolsetTool({
  name: 'cat_cafe_advance_evolution_program_change',
  description: '…',          // 原文照搬
  operation: { action: 'update', /* risk/openWorld */ },
  resourceFamily: 'evolution-program',
  runtimeProfiles: ['full', 'agent-key'],
  admissionRef: 'file:docs/features/F311-capability-evolution-workspace.md',
  sourceExport: 'handleAdvanceEvolutionProgramChange', // 溯源
  // clowder 定义的输入 schema：字段 → ZodShape（v4 迁移沿用 EP1-1a 兼容面）
  inputSchema: { programId: programId.describe('…'), /* … */ },
})
```

助手职责：
- 将 `{ action, risk }` 组装为 EP1-1a 的 `McpOperationContract`（`kind:'single'`、`boundary.authorizationPaths` 从 `authorizationHint` 推导，见 §2.3）。
- `implementation` 绑定到 `createCallbackInvoker(port)`，`ref = module:<catalog>:<sourceExport>`（实现目录源码面而非 handler 本体）。
- `policy`：`resourceFamily`、`schemaDelivery`（host-default / 按 `targetExposure`）、`runtimeProfiles`、`owner`（mcp-surface-governance cell）、`standaloneReason`（沿用 clowder `standaloneReason.accepted-boundary` 的 kind + admissionRef）、`activeState` 按源标注。

全部工具经 `defineMcpTool` 走 EP1-1a 的 `deriveEffectiveRisk` / `deriveSdkAnnotations` / `deriveInputSchema`，保证与治理框架同一推导链。

### 2.3 授权路径推导（authorizationPaths）

clowder `callback-*` 工具按 authority 归约。为避免引入 `@cat-cafe/shared`，授权路径用严格的**局部推导表**（enum 而非字符串拼接），字段缺省取安全默认：

```ts
type AuthorityHint =
  | 'callback-owner'     // invocation-cat × invocation-record，scope=owner/resourceRef=path
  | 'agent-key'          // agent-key-cat × agent-key
  | 'read-only'          // invocation-cat × invocation-record，scope=owner-private
  | 'local-operator'     // local-operator × local-process
```

推导约束：
- unknown authority → 抛错（fail-fast，防止遗漏治理面）。
- `read` action 不允许出现 `authority='local-operator'` 之外的写路径（validation finding）。
- enforcementRef 一律回填对应 `admissionRef`（同证据链）。

### 2.4 输入 schema 迁移（zod v3 → v4）

clowder 用 zod `^3.x`，flowforge 统一 zod `^4.4.3`。逐文件迁移时：
- `z.string()/number()/enum()/object()/discriminatedUnion()/describe()/.optional()/.strict()` 语义在 v4 兼容，仅改类型导入。
- 工具输入 schema 在 flowforge 保持「字段 → zod shape」形态（EP1-1a `deriveInputSchema` 与 `registerTools` 已兼容）。
- 契约测试断言 schema 时用 v4 API（`safeParse`/`safeParseAsync`，判别联合 `z.discriminatedUnion` v4 语法）。

## 3. 包结构

```
packages/mcp/mcp-server/
  src/
    toolsets/
      README.md                 # 工具组→正式名/中文名映射 + 批登记（对齐 B19 manifest 风格）
      callback-transport.ts     # CallbackRequest / CallbackTransportPort + createCallbackInvoker + NO_CONFIG/error 语义
      define-toolset-tool.ts    # defineMcpToolsetTool / defineMcpToolsetTools + authority 推导表
      canonical-tool-sources.ts # CANONICAL_TOOL_SOURCES（collab/memory/signals/limb）+ CANONICAL_TOOL_REGISTRY
      assemble.ts               # assembleMcpSeverToolsets(port) → CanonicalToolSources
      collab/                   # 19 工具组模块
      memory/                   # 11 工具组模块
      signals/                  # 2 工具组模块
      limb/                     # 1 工具组模块
  tests/
    toolsets/callback-transport.spec.ts
    toolsets/define-toolset-tool.spec.ts
    toolsets/canonical-tool-sources.spec.ts
    toolsets/collab-CATALOG.spec.ts     # collab 每批契约
    toolsets/memory-CATALOG.spec.ts     # memory 每批契约
    toolsets/signals-limb-CATALOG.spec.ts
    toolsets/assemble.spec.ts           # 注入 port → registerTools 真实 McpServer 装配
```

> 迁移规模大，**按家族分批**（每批独立 PR，见计划）。catalog 计数（组/工具数）在每批契约测试中注册并断言，保证与 clowder 源工具清单一致，防止搬运遗漏。

## 4. 命名映射

- `toolsets/README.md` 登记：家族 → 工具组（clowder 源文件）→ 迁移正式名 → 中文名（对照 `docs/design/naming-contract.md`）。
- `cat_cafe_*` 工具名**保留原名**（对外工具契约不复用字段名，避免宿主与既有协议断连）；不做改名，仅在命名映射表补充中文说明。

## 5. 测试策略

- 契约测试用**真实** `McpServer` + 注入内存 `CallbackTransportPort`（fixture 记录 `send` 收到的方法/路径），不走 stdio、不 Mock SDK。
- 用例覆盖：
  - 每个工具：`defineMcpTool` 推导（name 唯一、actionInventory、effectiveRisk、annotations、inputSchema 可解析）；cb port 收到正确 method/path。
  - authority 推导安全默认与非法值 fail-fast。
  - `buildCanonicalToolRegistry(CANONICAL_TOOL_SOURCES)` 通过治理证书断言 + 无重名 + 排序。
  - `assembleMcpSeverToolsets(port)` + `registerToolset` 装配到真实 `McpServer.listTools`。
  - 目录规模锚：每家族断言工具组数/工具总数 ≥ 源清单，防遗漏。
- 迁移走「先红后绿」：每批先写 catalog 规模锚测试（红：规模为 0），再落目录（绿）。

## 6. 验收（EP1-1b）

- 四家族 33 工具组合部迁入，catalog 规模锚测试断言齐备；
- 契约测试文件全绿（vitest）；
- 包级 `tsc --noEmit` exit 0、`oxlint` 0 error / 0 warning；
- `pnpm install` 解析成功（无新增 runtime 依赖，或仅合规 host 依赖）；
- 走 plugin-dev 七阶段，经 `mgr.ps1 sync` 提交（type feat，scope mcp-server），登记 `task.md`、`review_code.md` §13.2 序号 1（1b 完成）与 `10-stage-map.md` C43。

## 7. 边界（明确不做）

- 不移植 clowder handler 的真实 HTTP 实现（回调出站/重试/降级/agent-key 选择/KD-6 前缀）——归宿主接线；本包只提供 `CallbackTransportPort` 契约。
- 不引入 `@cat-cafe/shared` / `@cat-cafe/finance`；finance / audio 家族不迁移（Q3）。
- 不迁移 `protocol-engine` 之外的协议资产、不迁移工具测试夹具中对 clowder 内部 store 的依赖。
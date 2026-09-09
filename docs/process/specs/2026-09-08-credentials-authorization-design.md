# EP1-10 凭证授权 seam 移植设计（A8）

- 来源：dsh `@deepseek-ai/dsh-authorization`（A8，P0）
- 落点：`packages/credentials/authorization`（新包 `@flowforge/credentials-authorization`）
- 依据：`docs/refactor/review_code.md` §13（EP1-10 任务登记）、§16 融合决策、`docs/refactor/10-stage-map.md` D46 矩阵行
- 遵循：plugin-dev 七阶段流程 + 测试铁律 T1–T9
- 编译：包级 `tsc -b tsconfig.host.json` exit 0 + `oxlint` 0 告警；ESM；文件 ≤1000 行
- 边界：本批次仅留盘，由主会话统一提交（不做 git add 之后的额外本地 commit 编排）
- 运行时依赖：仅复用 `@flowforge/llm` 的 `HarnessError`
- 承诺：**零引用 `@deepseek-ai/*`、`@cat-cafe/*`、`@clowder-ai/*`、cordis Service/Context feathers**；原 cordis 宿主服务全部化为包内注入式端口

## 1. 职责

`ctx.authorization` 等价 seam：通过与人对话获取任何无法仅凭配置得到的凭据——打开页面、
粘贴代码、选账户。seam 拥有对话与生命周期，却永不拥有协议。插件注册面向它写入的
`CredentialKey` 的 flow；surface 以统一通知/提示词汇渲染所有 flow。

一个授权协议到达 = 新增一个 flow，而非新增一个 seam；一个能渲染任一 flow 的 surface
渲染所有 flow。`begin()` 至多一个 attempt 在途（`ALREADY_IN_FLIGHT`）；结算释放 key
并广播 `authorization/settled`。

## 2. 范围与边界

**本批次交付**：
- wire-safe 类型面（`types.ts`，无 cordis/service import，浏览器类型链可安全消费）
- `AuthorizationService`：`registerFlow/describe/list/begin` + attempt 生命周期（notify/prompt 迭代/结算/清理）+ 事件广播
- `AuthorizationDeclinedError` 语义（提示被人类拒绝 = `cancelled`，区别于 surface 故障 = `failed`）
- 注入式端口 + 内存实现：`AuthorizationCredentialsPort`（CredentialRecordStore）、`AuthorizationHostPort`（describe/record-updated/logger/事件）、invariant sink
- invariant companion（`settled` 后 key 不得在途）
- 便捷装配 `createAuthorizationService`/`memoryAuthorizationRuntime`

**本批次不交付（EP2 下游承接）**：cordis 宿主挂载、真实 surface 渲染、真实凭据存储接线、跨会话鉴权。

## 3. 端口设计

| 原 cordis 宿主面 | 本包端口 | 说明 |
|---|---|---|
| dsh-credentials `CredentialKey`/`describeRecord`/`commitRecord` | `AuthorizationCredentialsPort`（`describeRecord`/`commitRecord`，key 以 string 呈现）+ `MemoryCredentialsStore` | 凭据记录 seam |
| cordis `Service`/`Context` feathers、事件总线 | `AuthorizationHostPort`（`onRecordUpdated`/`emitSettled`/`now`/`logger`）+ `MemoryAuthorizationHost` / `InMemoryAuthorizationLogger` | 宿主协议 seam |
| dsh-invariants companion | `installAuthorizationInvariant` + `createAuthorizationInvariantTarget` + `apply` | invariant companion |

## 4. 示例（flow 注册）

```ts
const dispose = authorization.registerFlow({
  key: 'llm-pi-ai:openai-codex',
  label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  async run(session) {
    session.notify({ message: 'Continue in your browser', url })
    await commitThroughCredentials(await exchange(session.signal))
  },
})
```

## 5. DoD

- 3 契约测试文件 50/50 全绿、包级 tsc exit 0、oxlint 0
- 零 @deepseek/@cat-cafe/@clowder 引用
- 文件 ≤1000 行；`task.md`/`10-stage-map.md`/`review_code.md` 对应条目已标 🟩
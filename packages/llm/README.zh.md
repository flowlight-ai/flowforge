# llm/ — LLM 能力族

[English](README.md) | 中文

基于 vendored Cordis 内核的 TypeScript pnpm monorepo 能力族（npm scope `@flowforge/*`）。
**一切皆插件**：LLM 层被拆成「provider 中立的服务定义」与「注册到它的供应商消费者」，
外加横切的重试与 token 计量能力。

## 子包一览

| 包 | 角色 | ctx key |
| --- | --- | --- |
| [`@flowforge/llm`](llm) | provider 中立的 LLM **服务定义**：适配器注册表 + 流式调用 API（`LlmRuntime`）。 | `ctx.llm` |
| [`@flowforge/llm-deepseek`](llm-deepseek) | `deepseek-official` 路由的 DeepSeek chat-completions 适配器。 | 注册到 `ctx.llm`（无独立 key） |
| [`@flowforge/llm-pi-ai`](llm-pi-ai) | 基于 pi-ai 的通用多供应商适配器（`llm-deepseek` 的设计验证孪生实现）。 | 注册到 `ctx.llm`（无独立 key） |
| [`@flowforge/llm-retry`](llm-retry) | 挂在 agent loop 恢复扩展点上的、按 provider 路由的请求重试策略。 | 无（监听 `agent/request-error`） |
| [`@flowforge/token-meter`](token-meter) | 回放感知的 token 计量服务（回放 session 持久尾部）。 | `ctx.tokenMeter` |
| `@flowforge/llm-mock-server` *（test-support）* | 可脚本化的 OpenAI 兼容 HTTP/SSE 故障服务器，用于 LLM 恢复测试。 | **仅测试用**（非运行时服务） |

> **关于 `llm-mock-server`**：它位于 `packages/test-support`，而非 `packages/llm`。
> 仅允许用于单元 / 契约层（例如 `llm-retry` 的故障注入测试），**禁止**用于 e2e 或集成组合——
> 见铁律 **T1**（e2e 禁止 Mock LLM），详见 `docs/test/T001-test-ironrules.md`。

## 能力分层（Seam）

- **服务定义** —— `packages/llm/llm` 定义契约：抽象类 `LlmAdapter`、服务 `LlmRuntime`（`ctx.llm`）、
  `llm/stream` 瀑布事件，以及模型 / 能力 / 重试解析 API（`registerAdapter`、
  `registerConfigurableProviders`、`registerModelDiscovery`、`listProviders`、`listModels`、
  `resolveModelInfo`、`prepareCall`、`stream` …）。同时导出 `BlockAssembler`、`LlmError`、
  `assertUsableApiKey`，以及 `types` / `message` / `content` / `brand` / `retry-policy` 子路径模块。
- **供应商消费者** —— `llm-deepseek` 与 `llm-pi-ai` 实现 `LlmAdapter` 并注册到 `ctx.llm`
  （二者均为 `inject: ['llm']`）。新增供应商 = 实现适配器后调用
  `ctx.llm.registerAdapter(providers, adapter)`。

## 给贡献者的关键不变量

- 供应商适配器以 Service Provider 形式注册到 `ctx.llm`，绝不替换或绕开 `LlmRuntime`。
- 供应商凭证**绝不**硬编码；每次请求都从基于环境变量的 `credentialRef`（如 `DEEPSEEK_API_KEY`）
  经 credentials seam 或受信任的 launch-environment 层解析。
- 模型可见文本可从会话日志重建：agent loop 构建的请求 deep-freeze 并携带 `markAgentLoopRequest`
  身份；`llm/stream` 监听器只读取、不改写请求内容。
- 非平凡的 LLM 行为变更需要**真实组合测试**；Mock LLM 服务器仅限单元 / 契约层
  （禁止 e2e —— T1）。
- 每条发往供应商的 HTTP 请求必须携带 `attributionHeaders()`；适配器在 wire 请求或库 header hook 中
  实际注入并证明注入发生。

## 交叉引用

- 根规则：[`AGENTS.md`](../../AGENTS.md)（Git 工作流、开发红线、T1–T8）。
- LLM 专属规则：[`AGENTS.md`](AGENTS.md)（中文规则手册，补充根规则）。
- `llm-retry` 消费的 agent loop 恢复点：见 `agent` 包与 `agent/request-error` 事件。
- `token-meter` 消费的 session 持久尾部：见 `session` 包。

# AGENTS.md — `packages/llm` 工作规范（强制）

> 本文件是对仓库根目录 `AGENTS.md` 的补充，专门约束 **`packages/llm`**（LLM 能力族）下的开发、文档与测试。根目录规则（Git 工作流、开发红线、铁律 T1–T8）在此全部适用，本文件不再重复，只补充 LLM 专属规则。

## 能力分层（Seam 结构）

- `packages/llm/llm`（`@flowforge/llm`）是 **Service Definition**：provider 中立的 LLM 服务接口（`ctx.llm` 即 `LlmRuntime`），定义适配器契约、流式调用 API 与 `llm/stream` 瀑布事件。
- `packages/llm/llm-deepseek`、`packages/llm/llm-pi-ai` 是 **Provider Consumers**（供应商适配器），通过 `ctx.llm.registerAdapter` / `ctx.llm.registerConfigurableProviders` 注册到 `ctx.llm`。
- `packages/llm/llm-retry`、`packages/llm/token-meter` 是横切能力：前者挂在 agent loop 的恢复扩展点上，后者提供 `ctx.tokenMeter`。

**规则：** 供应商适配器必须以 Service Provider 形式注册到 `ctx.llm`，绝不直接替换或绕开 `LlmRuntime`。新增供应商走 `LlmAdapter` 抽象类实现一个适配器并调用 `ctx.llm.registerAdapter(providers, adapter)`；注册是 all-or-nothing 且随 fiber 销毁自动注销。

**规则：** 禁止硬编码任何供应商凭证。凭证只通过环境变量注入（`credentials` seam 的 `credentialRef`，例如 `DEEPSEEK_API_KEY`），运行时经 `ctx.credentials.resolve(ref)` 或受信任的 `launch-environment` 层解析；缺失时以 `MISSING_CREDENTIAL` 失败，绝不在加载期失败。

**规则：** 模型可见文本（送给 LLM 的 messages / request 内容）必须是会话日志的**纯函数**，可从 session log 重建（reconstructable from session log）。由 agent loop 构建的请求携带 `markAgentLoopRequest` 标记并 deep-freeze（改写即抛错）；监听器对 `llm/stream` 瀑布只能读取，不得重写请求内容。

**规则：** 非平凡的 LLM 行为变更（适配器协议、重试、能力解析、流式组装等）必须配套一个 **真实组合（real-composition）测试**；Mock LLM 仅允许出现在**单元 / 契约层**，禁止用于 E2E（参见铁律 T1）。`packages/test-support/llm-mock-server` 是 TEST-ONLY 支撑包，仅供 `llm-retry` 等恢复类的故障注入契约测试使用，不得进入任何 e2e / 集成组合。

**规则：** `llm/stream` 是 waterfall 事件，调用方通过 `next()` 触达已解析适配器的流；监听器可产出自己的 chunk 短路，但不得在 `agent/request-error` 等回退路径之外吞掉或伪造 `finish` chunk。Provider 边界失败统一归一为 `error`/`aborted` 的 finish chunk（由 `adapterStream` 处理），中间件与消费者失败保持原样抛出。

**规则：** 每条发往供应商的 HTTP 请求必须携带 `attributionHeaders()`（来源归因头）；适配器必须在 wire 请求或库 header hook 中实际注入这些头，并在测试中证明注入发生。两个参考实现（直连 fetch 的 `DeepSeekAdapter` 与基于库的 `PiAiAdapter`）以不同内部机制满足同一契约。

**规则：** 能力元数据（context window、maxTokens、reasoning efforts、modalities）由适配器通过 `listModels` / `resolveModel` / `providerRetryPolicy` 提供，目录（catalog）仅作建议，绝不参与路由或请求校验；未列入目录的 model id 仍可被接受。

## 测试铁律（摘要，详见 `docs/test/T001-test-ironrules.md`）

- **T1 禁止 Mock LLM**：E2E / 集成测试必须调用真实 LLM；`llm-mock-server` 仅限单元 / 契约层（如 `llm-retry` 故障注入、恢复路径验证）。
- **T7 LLM 内容须经 LLM 审核**：凡 LLM 生成内容（含生成的提示词 / 文档 / 文案）须过 LLM 审核后方可视为验证通过。
- **T8 Web 功能须操控浏览器验证 DOM**：Web 相关功能必须用真实浏览器验证 DOM，并对 DOM 内容做 LLM 质量审核。

## 跨包引用

- Service Definition：`packages/llm/llm`（导出 `LlmAdapter`、`BlockAssembler`、`LlmError`、`assertUsableApiKey`、各 `types`/`message`/`content`/`brand`/`retry-policy` 子路径）。
- 供应商适配器：`packages/llm/llm-deepseek`（`deepseek-official` 路由，env `DEEPSEEK_API_KEY`）、`packages/llm/llm-pi-ai`（基于 `@earendil-works/pi-ai` 的多供应商路由）。
- 横切能力：`packages/llm/llm-retry`（监听 `agent/request-error`，provider 拥有 `retryPolicy`）、`packages/llm/token-meter`（`ctx.tokenMeter`，回放 session 持久尾部度量 token 压力）。
- 测试支撑（非运行时）：`packages/test-support/llm-mock-server`（可脚本化的 OpenAI 兼容故障服务器）。

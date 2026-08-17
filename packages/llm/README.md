# llm/ — LLM capability family

English | [中文](README.zh.md)

A TypeScript pnpm monorepo family (npm scope `@flowforge/*`) built on the vendored
Cordis kernel. **Everything is a plugin**: the LLM layer is split into a
provider-neutral service definition and provider-specific consumers that register
against it, plus cross-cutting retry and token-metering capabilities.

## Packages

| Package | Role | ctx key |
| --- | --- | --- |
| [`@flowforge/llm`](llm) | Provider-neutral LLM **service definition**: adapter registry + streaming call API (`LlmRuntime`). | `ctx.llm` |
| [`@flowforge/llm-deepseek`](llm-deepseek) | DeepSeek chat-completions adapter for the `deepseek-official` route. | registers on `ctx.llm` (no own key) |
| [`@flowforge/llm-pi-ai`](llm-pi-ai) | Generic pi-ai-backed multi-provider adapter (design-verification twin of `llm-deepseek`). | registers on `ctx.llm` (no own key) |
| [`@flowforge/llm-retry`](llm-retry) | Provider-routed request retry policy on the agent-loop recovery extension point. | none (hooks `agent/request-error`) |
| [`@flowforge/token-meter`](token-meter) | Replay-aware token measurement service (replays the session durable tail). | `ctx.tokenMeter` |
| `@flowforge/llm-mock-server` *(test-support)* | Scriptable OpenAI-compatible HTTP/SSE fault server for LLM recovery tests. | **test-only** (not a runtime service) |

> **Note on `llm-mock-server`**: it lives under `packages/test-support`, not
> `packages/llm`. It is permitted only at the unit/contract layer (e.g.
> `llm-retry` fault-injection tests). It MUST NOT be used in e2e or integration
> compositions — see iron rule **T1** (mock LLM forbidden for E2E) in
> `docs/test/T001-test-ironrules.md`.

## Capability seam

- **Service Definition** — `packages/llm/llm` defines the contract: the abstract
  `LlmAdapter`, the `LlmRuntime` service (`ctx.llm`), the `llm/stream` waterfall
  event, and the model/capability/retry resolution API (`registerAdapter`,
  `registerConfigurableProviders`, `registerModelDiscovery`, `listProviders`,
  `listModels`, `resolveModelInfo`, `prepareCall`, `stream`, …). It also exports
  `BlockAssembler`, `LlmError`, `assertUsableApiKey`, and the `types` / `message`
  / `content` / `brand` / `retry-policy` subpath modules.
- **Provider Consumers** — `llm-deepseek` and `llm-pi-ai` implement `LlmAdapter`
  and register themselves on `ctx.llm` (both `inject: ['llm']`). A new provider is
  added by implementing the adapter and calling
  `ctx.llm.registerAdapter(providers, adapter)`.

## Key invariants (for contributors)

- Provider adapters register on `ctx.llm` as Service Providers — they never
  replace or bypass `LlmRuntime`.
- Provider credentials are **never** hardcoded; they resolve per request from an
  env-var-backed `credentialRef` (e.g. `DEEPSEEK_API_KEY`) via the credentials
  seam or a trusted launch-environment layer.
- Model-visible text is reconstructable from the session log: agent-loop-built
  requests are deep-frozen and carry a `markAgentLoopRequest` identity; `llm/stream`
  listeners read, never rewrite, request content.
- Non-trivial LLM behavior changes require a **real-composition** test; the mock
  LLM server is allowed only at the unit/contract layer (never e2e — T1).
- Every provider HTTP request must carry `attributionHeaders()`; adapters prove
  injection in the wire request or library header hook.

## Cross-references

- Root rules: [`AGENTS.md`](../../AGENTS.md) (Git workflow, dev redlines, T1–T8).
- LLM-specific rules: [`AGENTS.md`](AGENTS.md) (Chinese rulebook, supplements the root).
- Agent loop / recovery point consumed by `llm-retry`: see the `agent` package and
  the `agent/request-error` event.
- Session durable tail consumed by `token-meter`: see the `session` package.

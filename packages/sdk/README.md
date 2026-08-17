# sdk/ — out-of-process runtime SDK

English | [中文](README.zh.md)

The `sdk/` workspace is FlowForge's **out-of-process control surface**. An
external driver (a CLI, an orchestrator, another-language SDK) spawns the
`flowforge-jsonrpc-agent` runtime as a subprocess and drives agent turns over
**stdio JSON-RPC**. The runtime itself is a full Cordis process configured by
its own `cordis.yml`; the SDK only carries control in and events out.

## Packages

| Package | Role | ctx key |
| --- | --- | --- |
| `@flowforge/sdk-protocol` | Shared wire protocol: the newline-delimited JSON-RPC stdio transport plus the named request / result / notification types spoken on the wire. Single source of truth for both ends. | — (library) |
| `@flowforge/sdk-jsonrpc-server` | Stdio JSON-RPC **server plugin** that exposes the running runtime to external drivers/CLIs. Registered via `ctx.plugin`. | `sdk-jsonrpc-server` (plugin, `apply` via `ctx.plugin`) |
| `@flowforge/sdk-client` | TypeScript **client SDK**: spawns the runtime over stdio JSON-RPC. `DeepSeekHarness` is the high-level run API; `HarnessClient` is the lower-level protocol client. | — (library) |

## How an external system drives FlowForge

1. The host spawns the runtime binary `flowforge-jsonrpc-agent` (its `cordis.yml`
   decides whether to load the `sdk-jsonrpc-server` plugin).
2. The client opens a newline-delimited JSON-RPC stream over the child's
   `stdin`/`stdout` (transport defined in `@flowforge/sdk-protocol`).
3. The client sends `initialize` (cwd / provider / model / optional
   `maxTokens`), then one or more `session/prompt` calls keyed by `sessionId`
   (an unknown id lazily creates the agent + session pair).
4. The server streams four notifications back to the client:
   `session.event`, `session.status`, `subagent.started`, `subagent.finished`.
5. A `shutdown` request flushes, disposes the whole root runtime, and exits 0.
   EOF / signal exits are owned by the app bin.

All three request methods and four notifications are defined in
`@flowforge/sdk-protocol` (`HarnessSdkRequestMap`,
`HarnessSdkNotificationMap`) and must not be extended ad-hoc outside that package.

## Cross-references

- Wire types & transport: [`protocol/`](./protocol)
- Server plugin: [`server/`](./server)
- TypeScript client: [`client/`](./client)
- Root architecture notes: [../../docs/arch.md](../../docs/arch.md)
- Module rules for AI tools: [./AGENTS.md](./AGENTS.md)

## Planned consumers

- `apps/cli` — a command-line host intended to **consume this SDK** — is
  **(planned)** and does not exist yet. It is referenced here only to explain
  the SDK's design purpose.

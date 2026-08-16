# core/ — product API spine

English | [中文](README.zh.md)

The `core` workspace is the product API spine of FlowForge: the TypeScript
layer on top of the vendored [Cordis](https://cordis.nodejs.cn/) kernel that
turns “everything is a plugin” into the concrete Agent / Session / Tool / Prompt
surface. Every subpackage is an npm package under the `@flowforge/*` scope.

Each subpackage either mounts a **service** onto the Cordis `Context` (read it
as `ctx.<key>`) or contributes a **primitive** / **plugin** consumed by other
packages. Services are `Service` subclasses; registrations are effects that
auto-dispose when their scope unloads.

| Package | Role | ctx key |
| --- | --- | --- |
| [`agent`](agent) | Agent interface, live registry (`AgentRegistry`), process-local initiator scope, and event vocabulary (`agent/created`, `agent/disposed`, `agent/session-start`). Defines the `AgentFactory` contract that a loop plugin implements. | `ctx.agents` (also `ctx.agent` DX accessor, optional) |
| [`agent-default-model`](agent-default-model) | Default model selection shared by Agent entry points, with optional settings-backed overrides. | `ctx.agentDefaultModel` |
| [`agent-loop`](agent-loop) | The concrete agent-loop plugin: creates scoped agents, publishes them through the agent/session registries, owns their ordered teardown, and provides the `AgentFactory` implementation. | `ctx.agentLoop` (also optional `ctx.configuredAgentIdentities`) |
| [`agent-tool-presentation`](agent-tool-presentation) | Agent-plane tool-presentation selector: declares whether an agent's model sees tools as `native` / `code` / `both`. It is a **plugin**, not a service — it calls `ctx.tools.presentAs()`. | *(none — plugin; calls `ctx.tools.presentAs`)* |
| [`scope`](scope) | Scoped-context registration primitive: mint a Cordis context tagged with an opaque `ScopeKey`, build routing-only event carriers (`scopeTarget`), and read the enclosing scope (`scopeOf`). This is the foundation for scope-filtered dispatch. | *(none — primitive library)* |
| [`session`](session) | Event-sourced session store: append-only `SessionEvent` log, in-memory `SessionStore`, and the derived LLM message history (`deriveMessages`). Durable persistence is a separate plugin concern (subscribe to `session/event`, flush on `session/flush`). | `ctx.sessions` |
| [`system-prompt`](system-prompt) | System-prompt assembly registry: ordered sections, dynamic contexts, tool-schema providers, and `{{variable}}` interpolation; assembled before each model step. | `ctx.systemPrompt` |
| [`tools`](tools) | Tool registry and execution pipeline: registration, pre/execute/post waterfalls, and per-scope presentation. | `ctx.tools` |

## Capability seams

The spine is deliberately split into **Service Definition / Provider / Consumer**:

- `@flowforge/agent` defines `AgentRegistry` (`ctx.agents`) and the `AgentFactory`
  interface — the definition layer.
- `@flowforge/agent-loop` implements `AgentFactory` and registers it via
  `ctx.agents.setFactory(this)` — the provider layer.
- Everything else drives agents only through `ctx.agents.create` / `resume` —
  the consumer layer, with no dependency on the concrete loop package.

The same shape repeats for tools (`ctx.tools`, `ToolRuntime`) and the prompt
(`ctx.systemPrompt`, `SystemPrompt`): a service is the stable contract; the
plugins that fill it in are swappable.

## Cross-references

- Vendored kernel: `@flowforge/cordis` (Cordis `Context`, `Service`, `effect`, `on`).
- Heavy session persistence backends live outside core: `session-persistence*` packages (read via `ctx.get('sessionPersistence')`).
- The durable, host-plane code runtime that `code` presentation depends on: `@flowforge/code-runtime` (read via `ctx.get('codeRuntime')`).
- Root workspace rules: [`../../AGENTS.md`](../../AGENTS.md). Core-specific AI/dev rules: [`AGENTS.md`](AGENTS.md).
- Package-local AI/dev rules for this directory: [`AGENTS.md`](AGENTS.md).

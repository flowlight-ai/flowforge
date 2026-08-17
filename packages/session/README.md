# session/ — durable session data plane

English | [中文](README.zh.md)

The `session` data plane is the durable-state backbone of FlowForge: an
**event-sourced** session store plus its persistence, projection, query,
telemetry, and title sub-systems. Durable state never lives in a mutable
database row — it is the append-only session **event log**, and every
"current record" (model history, request header, projections, counts) is a
deterministic **fold** over that log. Timers, projections, and caches are
disposable: they can always be rebuilt from the log.

> Package layout note: the event-sourced core `@flowforge/session` lives at
> `packages/core/session` (it is part of the `core` workspace group). The
> `packages/session` directory holds the persistence / projection / telemetry /
> title / checkpoint sub-packages, and `packages/session-query` holds the
> retrieval sub-packages. All are documented together here as the SESSION
> module.

## Packages

| Package | Role | `ctx` key |
| --- | --- | --- |
| `@flowforge/session` (`packages/core/session`) | Event-sourced session store: append-only log, in-memory `SessionStore`, derived LLM message history. | `ctx.sessions` |
| `@flowforge/session-persistence` | Abstract durable-persistence seam (backend contract + write-path coordinator). | `ctx.sessionPersistence` |
| `@flowforge/session-persistence-jsonl` | JSONL durable backend (native FFI via `koffi`). | (impl of `ctx.sessionPersistence`) |
| `@flowforge/session-persistence-sqlite` | SQLite durable backend. | (impl of `ctx.sessionPersistence`) |
| `@flowforge/session-query` | Unified, live-preferred retrieval: bounded reads, lineage traces, filters, full-text search. | `ctx.sessionQuery` |
| `@flowforge/session-query-sqlite` | SQLite FTS implementation of the query engine. | (impl of `ctx.sessionQuery`) |
| `@flowforge/session-projection` | Capability seam: merge-extensible `SessionProjectionMap`, `ProjectionDefinition` contract (`init`/`apply`/`view`), `ctx.sessionProjections` registry that drives every unit forward. | `ctx.sessionProjections` |
| `@flowforge/session-projection-cache` | Persisted per-session projection checkpoints, throttled write-behind, and the cold-read ladder. | `ctx.sessionProjectionCache` |
| `@flowforge/session-stats` | Whole-log conversation counts / wall-time projection. | (projection unit) |
| `@flowforge/session-title` (+ `session-title-llm`, `-first-prompt-llm`, `-all-prompts-llm`) | Log-backed session title service and LLM provider registry. | (projection + providers) |
| `@flowforge/session-telemetry` (+ `session-telemetry-otel`) | Session-event capture, redaction, and handoff to a reporting backend (OpenTelemetry). | — |
| `@flowforge/session-checkpoint-policy` | Semantic durability checkpoints before model requests and tool side effects. | — |
| `@flowforge/tool-session-query` | Agent tool that exposes session query to the model. | — |

## Event-sourcing model

A `Session` is an append-only log of `SessionEvent`s. The store
(`ctx.sessions`) holds sessions **in memory only**; persistence is a plugin
concern.

- **Append.** `session.append(type, data, surfaceOp?, sourceEventSeqs?)` pushes
  a typed, deep-frozen event. `seq === log.length` (the contiguity contract):
  sequence numbers are always the current log length. Event `data` must be
  losslessly JSON-serializable or the append is rejected at the source.
- **Fold.** Anything derived from the session is computed by folding the log:
  - `deriveMessages()` — the model-visible history. The **surface** (the ordered
    sequence of message-producing events tagged with `surfaceOp`) is the single
    source of derived history; a compaction `replace` deletes shadowed nodes.
  - `requestHeader()` / `requestContext()` — incremental folds of the latest
    `request/header` / `request/context` snapshot.
  - Projections (`ctx.sessionProjections`) fold log events through
    `init → apply → view`; each unit returns the *whole current value*.
- **Header is separate.** The `SessionHeader` (id, format version, cwd, seed
  lineage, delegation depth) is storage/lineage metadata carried *outside* the
  event log — it is not replayable conversation state.
- **Persistence is订阅/flush.** Backends subscribe to `session/event` and
  drain on `session/flush`. Call `ctx.sessions.flush(session)` before reading
  durable decisions from storage.
- **Lifecycle.** `prepare` → `enter` → `announce` (or the convenience
  `ctx.sessions.create`); disposal emits `session/disposed`. Forking
  (`ctx.sessions.fork`) creates a child from a stable prefix of a live source.

### Event vocabulary (core)

`turn/start`, `turn/end`, `step/start`, `step/end`, `user/message`,
`assistant/chunk`, `assistant/message`, `tool/call`, `tool/result`,
`todo/write`, `request/header`, `request/context`, `session/end-seed`. The
`SessionEventMap` is merge-extensible, so plugins may add their own event types.

## Cross-references

- Event-sourced core: `packages/core/session` — `@flowforge/session`.
- Retrieval: `packages/session-query` — `@flowforge/session-query`.
- Persistence seam + backends: `packages/session/session-persistence`,
  `session-persistence-jsonl`, `session-persistence-sqlite`.
- Projections: `packages/session/session-projection`,
  `session-projection-cache`.
- Durable-state rules for AI tools: see [AGENTS.md](AGENTS.md) (中文).

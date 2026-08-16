# cordis-host-runner/ — dynamic plugin host & assembly

English | [中文](README.zh.md)

The dynamic package-definition registry, host-half sandbox lifecycle, and
host→client invoke handler table. This is the **runtime assembly point** of
FlowForge: the dynamic counterpart to a static host. Whereas a static host
imports plugin packages at compile time, this package discovers and registers
plugin *definitions* at runtime — from a manifest supplied by the model — and
boots them onto a live Cordis `Context`.

| Package | Role |
| --- | --- |
| `@flowforge/cordis-host-runner` | Dynamic Plugin registry + Host-half sandbox lifecycle + invoke handler table (the assembly boundary). |

The companion toolset [`@flowforge/tool-cordis`](../tool-cordis/README.md)
injects this service (`ctx.dynamicCordisRunner`) and supplies the
model-facing verbs (`cordis_define` / `cordis_run` / `cordis_stop` /
`cordis_undefine` / `cordis_inspect`). A composition that has those tools but
no runner never activates a package — the registry, the VM sandbox, and the
browser broadcast all live here.

## Assembly model

```
                 root Context (booted by the host application)
                                  │
                                  ▼
                  cordis-dynamic  group fiber   ◄── runner owns this
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                        ▼
        Host half (sandbox)                      Client half
   evaluateHostCode() → Plugin              delivered to open web pages
   startHostHalf() → child fiber            registers UI into Client slots
   handlers → run.handlers (invoke table)
```

1. **Discover / register** — `define()` records an immutable `Package`
   (`name`, `purpose`, and a Host half `hostCode` and/or a Client half
   `clientCode`) after a syntax precheck. It mints a stable `pluginId` (new
   plugin) or appends to an existing one, and a unique `packageId` per version.
   Versions are append-only; the definition never re-runs on its own.
2. **Boot a Context** — the runner is constructed with a root `Context` and
   mounts every Host half under a single `cordis-dynamic` group fiber on that
   Context. The Host source is evaluated in a VM sandbox, must return a Cordis
   `Plugin` (`apply(ctx)`), and is settled as a child fiber so its service
   registrations become real `ctx.*` services.
3. **Run / invoke** — `run()` (and the approving `runHostHalf()`) start a
   package; Host methods registered via `handle(method, fn)` are exposed through
   the `invoke()` handler table that the Client half calls back into. A Client
   half that needs a service the host hasn't mounted yet stays *pending* rather
   than failing (legal Cordis semantics: it activates when the service appears).
4. **Effect-bound cleanup** — `retract()` runs every `handlerDisposer` and
   `await fiber.dispose()`. Because everything a Host half registered is an
   effect on its fiber, disposing the fiber tears the package down completely;
   after retraction the services it contributed are gone, exactly like a static
   plugin unload.

### Run / control verbs (summary)

- `define` / `undefine` — own a definition's life. `define` prechecks each
  half's syntax (running nothing) and records the definition against the owning
  session; `undefine` stops a running definition first, then forgets it. Neither
  crosses the wire.
- `run` — answers a model request to run one definition. Host-only packages
  evaluate and return in-process; packages with a Client half emit
  `cordis/request-run`, suspend, and settle on an approval (`resolveRequestRun`)
  or cancellation.
- `runHostHalf` / `getClientCode` — the steps an allowed page walks: Host half
  first (so a Host failure short-circuits), then the Client source is handed to
  that one page. Code never rides an announcement.
- `stop` — unwinds one live dispatch (handlers dropped, Host fiber disposed,
  `retract` broadcast) and leaves the definition runnable.
- `inventory` / `snapshot` — whole-registry and session-scoped reports.
  `snapshot` carries each live Host half's fiber so `cordis_inspect` can render
  provides / waiting / state (a fiber cannot cross the wire).
- `invoke` — routes one call from a package's Client half to a method its own
  Host half registered. The infrastructure only routes; no Host→Client direction
  exists.

A refusal from `run` / `stop` names one of `definition-missing`,
`host-half-failed`, `client-half-failed`, `rejected`, `cancelled`, or
`not-running`; the last three are answers rather than defects.

## How `apps/cli` would use it (planned / stage 3)

`apps/cli` is **planned (stage 3, `docs/refactor/23-stage3-api-cli.md`,
task T3.6)** — it does not exist yet. When built, the host application is the
composition root: it boots the root `Context`, installs the kernel and domain
services, mounts `@flowforge/cordis-host-runner`, and lets the model drive
packages through the `tool-cordis` verbs. The runner itself does **not**
self-boot — it is handed an already-running `Context` and treats it as the
assembly boundary. The planned application verticals (`cats` / `chat` / `limb`
/ `forgekin`, stages 4–7) compose their capabilities here as loaded packages,
not as kernel code.

## Storage & trust stance

- The registry is process memory and the only source of truth. The session log
  carries only a `define` call's metadata — never its code — so a restarted
  process legitimately has no definitions, and a card whose id no longer resolves
  says exactly that rather than pretending it can run. Nothing here is written to
  disk, and no definition is restored automatically.
- The VM sandbox isolates globals but is **not a security boundary**: Node
  globals are absent or redirect to Cordis services (`ctx.fs`, `ctx.web`,
  `ctx.bash`), and a Host half receives a façade without framework internals, yet
  the services it declares reach the live runtime. Treat a dynamic package like
  bash access — see the
  [self-referential toolset Agent Note](../../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md).

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `vmTimeoutMs` | `5000` | Maximum synchronous VM evaluation time for a Host half, in milliseconds. |

## Export shape

Service package: default-exports `DynamicCordisRunnerService` (service key
`dynamicCordisRunner`); `./types` carries the payload shapes the
`dynamicCordisRunner` remote namespace and its consumers share. The
`define` / `undefine` shapes stay inside the package, because they never cross
the wire.

## Cross-references

- Project rules and the development red lines: root [`AGENTS.md`](../../../AGENTS.md).
- Package-level rules supplement: [`./AGENTS.md`](./AGENTS.md).
- Refactor context: [`docs/refactor/22-stage2-plugins.md`](../../../docs/refactor/22-stage2-plugins.md)
  (T2.13 — host-runner as the production assembler) and
  [`docs/refactor/23-stage3-api-cli.md`](../../../docs/refactor/23-stage3-api-cli.md)
  (`apps/cli`, planned).
- Model-facing verbs and trust stance: [`@flowforge/tool-cordis`](../tool-cordis/README.md).
- Client delivery: [`@flowforge/cordis-client-runner`](../cordis-client-runner/README.md).

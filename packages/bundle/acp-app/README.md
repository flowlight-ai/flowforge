# `@flowforge/acp-app`

English | [中文](README.zh.md)

The automation-only ACP stdio application as a `flowforge` profile bundle over [`@flowforge/base`](../base/README.md). It inherits the base's disabled module-HMR policy; its patch sets the coding-agent persona and default model route, mounts an app-owned zero-option command provider, and starts [`@flowforge/acp`](../../acp/acp/README.md) only after that provider accepts the invocation. `flowforge --profile acp --help` therefore writes help and exits without claiming stdin or stdout.

## Use this package

The startup provider (`acp-app-startup`, injected by `cmdlineArgs`, provided by `acp-app`) binds stdin EOF to the launcher's bounded successful shutdown through [`@flowforge/cmdline`](../../boot/cmdline/README.md). ACP connection close, SIGINT, and SIGTERM drain the bridge-owned agents and the root profile tree before exit. Stdout is reserved for newline-delimited ACP JSON-RPC frames. The bundle disables model-generated session titles because ACP exposes no title surface; deterministic fallback titles remain durable without an auxiliary model request. A deployment selects a different composition through profile bundles and patch files, not another app bin.

The shipped row creates sessions with `deepseek-official` and `deepseek-v4-flash`; a later patch can replace that row's complete config. The base profile owns adapters, tools, persistence, policy, settings, credentials, and the per-session workspace supplied by the ACP client.

## Model Experience

### ACP coding-agent persona

#### What the model sees

The profile supplies `You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.` before the base tool and context contributions. The ACP row's route and each `session/new` cwd resolve the placeholders.

#### KV Cache effect

Stable for a fixed profile, provider, model, and tool roster.

## Known Limitations and Deferred Work

- **A profile can omit the ACP bridge** — a custom ACP launch profile must retain this bundle or another `@flowforge/acp` row; otherwise no peer answers the client.
- **User plugins can violate stdout purity** — profile and per-launch patches are trusted application composition. The shipped bundle writes no non-protocol stdout, but it cannot contain an arbitrary inserted plugin.

**Runtime invariant:** No companion is published. The bundle adds a process transport and startup latch; the startup specs own frame purity, help exclusion, and shutdown.
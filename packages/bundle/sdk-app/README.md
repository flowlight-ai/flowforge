# `@flowforge/sdk-app`

English | [中文](README.zh.md)

The SDK stdio application as a `flowforge` profile bundle over [`@flowforge/base`](../base/README.md). It inherits the base's disabled module-HMR policy; its patch sets the coding-agent persona, mounts an app-owned zero-option command provider, and starts [`@flowforge/sdk-jsonrpc-server`](../../sdk/server/README.md) only after that provider accepts the invocation. `flowforge --profile sdk --help` therefore writes help and exits without claiming stdin or stdout. The standalone [`sdk-minimal`](../sdk-minimal/README.md) bundle reuses the same startup provider with its own profile name.

## Use this package

The startup provider (`sdk-app-startup`, provided by `sdk-app`) binds stdin EOF to the launcher's bounded successful shutdown through [`@flowforge/cmdline`](../../boot/cmdline/README.md). SDK protocol `shutdown`, SIGINT, and SIGTERM retain their owning server or launcher paths; disposal drains the root profile tree and persistence. Stdout is reserved for newline-delimited JSON-RPC frames. The bundle disables model-generated session titles because the SDK exposes no title surface; deterministic fallback titles remain durable without an auxiliary model request. A deployment selects a different composition through profile bundles and patch files, not another app bin.

| Config | Default | Behavior |
|---|---|---|
| `profile` | `sdk` | Profile name rendered in command help; a bundle mounting this provider sets its own shipped profile name. |

`FF_MAX_TOKENS_AS_SUCCESS` retains the SDK deployment mapping: unset or JSON `true` reports token-limited subagent completion as accepted, while JSON `false` reports it as an error. Provider/model and workspace cwd arrive through the SDK initialization request; the base profile owns adapters, tools, persistence, policy, settings, and credentials.

## Model Experience

### SDK coding-agent persona

#### What the model sees

The profile supplies `You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.` before the base tool and context contributions. The exact SDK initialization route and session cwd resolve the placeholders.

#### KV Cache effect

Stable for a fixed profile, provider, model, and tool roster.

## Known Limitations and Deferred Work

- **A profile can omit the SDK server** — a custom profile selected by the client must retain this bundle or another `@flowforge/sdk-jsonrpc-server` row; client initialization fails when no peer answers.
- **User plugins can violate stdout purity** — profile and per-launch patches are trusted application composition. The shipped bundle writes no non-protocol stdout, but it cannot contain an arbitrary inserted plugin.

**Runtime invariant:** No companion is published. The bundle adds a process transport and startup latch; the startup specs own frame purity, help exclusion, and shutdown.
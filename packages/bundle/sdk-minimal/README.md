# `@flowforge/sdk-minimal`

English | [中文](README.zh.md)

Use `flowforge --profile sdk-minimal` when an SDK client needs a small, explicit coding-agent runtime. The profile advertises a platform-selected persistent shell and `str_replace_editor`, persists sessions as uncompressed JSONL, and selects the model from the SDK initialization request. It supplies a complete Cordis tree and deliberately excludes [`@flowforge/base`](../base/README.md), Web, settings, managed credentials, telemetry, compaction, workspace instructions, skills, jobs, and subagents. Its danger-full-access policy lets the shell and editor modify any path available to the process, so use it only with an isolated workspace.

## Use this package

Launch the profile directly or select it from the SDK client. Supply an explicit `FF_HOME`, use a disposable workspace, and provide the model credential through `DEEPSEEK_API_KEY`.

```sh
export FF_HOME=/absolute/path/to/example-flowforge-home
flowforge --profile sdk-minimal
```

`FF_CONTEXT_WINDOW` sets the fallback capacity for a model absent from the adapter's advisory catalog. `FF_SYSTEM_PROMPT` replaces the default persona. The SDK initialization request is the sole model selection and overrides environment defaults.

Profile, home, and ordered `--patch` files can replace rows or insert bundles above the complete default tree. The shipped template applies patches only at startup.

The profile mounts exactly one persistent shell stack: Bash on Linux and macOS, or PowerShell on Windows. Both stacks use a 300-second timeout and one owner-scoped terminal; the other platform's rows remain disabled.

## Understand the implementation

The bundle's single insert is the complete application tree: SDK stdio startup and JSON-RPC serving, one environment-configured DeepSeek adapter, the explicit agent core, local subprocess and unrestricted filesystem providers, a platform-selected persistent shell PTY, the string-replace editor, and uncompressed JSONL persistence under `$FF_HOME/sessions`. It does not inherit another bundle, so every extra row is an explicit profile change.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Complete standalone profile tree and its environment-backed defaults |
| [`src/index.ts`](src/index.ts) | Bundle package entry |
| — | No runtime invariant companion is published; the package is a static patch-list carrier whose inserted rows own their runtime relationships. |
| [`tests/sdk-minimal.spec.ts`](tests/sdk-minimal.spec.ts) | Exact composition, profile-name, and platform-selection checks |

## Further Exploration

- [SDK application bundle](../sdk-app/README.md) — the JSON-RPC application layer reused by full and minimal SDK profiles.
- [Base bundle](../base/README.md) — the full product foundation that this profile deliberately omits.

## Model Experience

### Minimal coding-agent composition

#### What the model sees

The system prompt is `FF_SYSTEM_PROMPT` or `You are a helpful software engineer assistant.`. The only advertised tools are owner-scoped persistent `bash` on Linux/macOS or `pwsh` on Windows, plus `str_replace_editor`; runtime context, workspace instructions, skills, jobs controls, compaction, and Harness identity are absent.

#### KV Cache effect

Stable for a fixed persona, platform, provider, model, and bundle patch stack.

## Known Limitations and Deferred Work

- **The composition intentionally omits shared product services** — select `flowforge --profile sdk` when settings, managed credentials, policy presets, telemetry, Web tools, or the full default tool roster are required.
- **User patches can expand the tree and corrupt stdout** — profile customization is trusted application composition; a plugin that writes ordinary text to stdout can break JSON-RPC framing.
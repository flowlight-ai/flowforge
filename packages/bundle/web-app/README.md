# `@flowforge/web-app`

English | [中文](README.zh.md)

The flowforge browser-surface bundle: the [`cordis.patch.yml`](cordis.patch.yml) web patch layer over [`@flowforge/base`](../base/README.md) plus the `web-app` runtime glue plugin and the `web-startup` command-line provider. It owns the host rows FlowForge can compose today — worker-thread code execution, session-log export and stats, the dual-face directory picker, plugin inventory, the webserver, the browser-transport host half, frontend dist serving, the web-surface prompt section, the `FF_WEB_URL` bash variable, the URL line, and the default-browser handoff — and moves the agent plane behind agent presets.

The full browser surface (a shipped `@flowforge/web-frontend` dist, the browser `__FF_BOOT__` seam, and the client-capability roster) lands with the EP2 client capability-integration batch; until it exists this bundle keeps the host-row composition it can verify today.

## Use this package

Start the GUI and open your browser:

```sh
flowforge --profile web
flowforge --profile web --no-open --port 8080
```

After startup a `flowforge web:` line prints the canonical loopback URL (plus a LAN URL when the server binds all interfaces). Unless `--no-open` or an SSH session suppresses it, the default browser opens that URL. Two failures to expect: if `@flowforge/web-frontend` is absent, startup stops with an EP2 hint; if the browser cannot be opened, a credential-free diagnostic prints to stderr while the server keeps running — open the printed URL yourself.

### Configuration

The command-line flags feed the four settings below — `--host`, `--port`, and `--trusted-host` come from the invocation, and `--no-open` turns the browser handoff off for that invocation:

| Field | Default | Meaning |
|---|---|---|
| `openBrowser` | `true` | Open the default browser after startup; SSH launches suppress it |
| `printUrl` | `true` | Print the `flowforge web:` URL line at startup |
| `surfaceContext` | `true` | Give the agent GUI-orientation context and expose `FF_WEB_URL` to its shell commands |
| `trustedHosts` | `[]` | Extra hosts allowed to reach the GUI from the network |

### LAN access and trusted hosts

By default the GUI accepts connections from this machine only. A deployment that binds all network interfaces also allows browsers from the LAN, and the printed URL then includes a LAN address; `--trusted-host` adds extra hosts in either case. The LAN addresses are sampled once at startup, so a network change later is not picked up — restart the GUI to re-advertise.

### Running over SSH

When you launch `flowforge --profile web` over SSH, the URL line still prints but the browser is not opened for you: the SSH client or editor owns the local forwarding address. Open the forwarded URL on your machine yourself; the printed URL names the remote host's loopback endpoint.

## Understand the implementation

The bundle is one patch plus one runtime glue plugin and one command-line provider. The patch restates the surface-specific values the base deliberately omits, inserts the web-only host rows, then moves the agent plane behind presets. The glue plugin owns dist serving, LAN trust sampling, the prompt section, the bash variable, and the readiness announcements; the startup provider parses the web flag family.

### Readiness

The URL line and browser handoff are readiness signals, so they run only after the Loader tree settles — or immediately in a hand-built tree without a Loader. A tree disposed mid-boot announces nothing.

### LAN trust sampling

`resolveLanTrust` samples the network once at boot: a loopback bind (`127.0.0.1`) derives no LAN addresses, while an all-interfaces bind adds every non-internal IPv4 literal. The derived literals plus the explicit `--trusted-host` authorities form the `/api` browser-trust fence, and the printed LAN URL always matches that fence.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The `web-app` glue plugin: dist resolution, LAN trust sampling, prompt section, bash variable, URL line, browser handoff |
| [`src/startup.ts`](src/startup.ts) | The `web-startup` provider: `--host`, `--port`, `--trusted-host`, `--no-open`, `--help` |
| [`cordis.patch.yml`](cordis.patch.yml) | The web patch: restated base values, web host rows, agent plane behind presets |
| — | No runtime invariant companion is published; every contribution (frontend-static child plugin, prompt section, bash variable registration) is registry-disposed with the fiber, and each owning registry's package carries that relation's invariant. |
| [`tests/web-app.spec.ts`](tests/web-app.spec.ts) | Dist resolution, fallback seat, prompt sections, readiness |
| [`tests/startup.spec.ts`](tests/startup.spec.ts) | Command-line parsing |
| [`tests/trusted-hosts.spec.ts`](tests/trusted-hosts.spec.ts) | LAN-trust sampling |
| [`tests/browser-open.spec.ts`](tests/browser-open.spec.ts) | Default-browser handoff |

## Further Exploration

- [Base bundle](../base/README.md) — the shared core the GUI runs on.
- [frontend-static](../../host/frontend-static/README.md) — how a built frontend dist is served.

## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk FlowForge implementation without claiming it is the working directory, and the `app:web-surface` section orients the model to the GUI: the canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `FF_WEB_URL` additionally appears in the managed shell environment with its description, resolved per invocation from the live server. When it is false, neither section nor the variable is registered.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The browser surface ships with EP2** — `@flowforge/web-frontend` and the client-capability roster are not in this bundle; the host glue composes the warp it can verify today, and resolution of the absent dist fails loud with an EP2 hint.
- **LAN addresses are sampled once at startup** — interface changes after boot are not re-advertised; the printed LAN URL always matches what was sampled.
- **Only the handoff start is observable** — the GUI reports that the browser was asked to open, not that it actually opened; a later browser exit is never reported, and the printed URL is your manual fallback.
- **SSH sessions keep the URL but skip the browser handoff** — the printed URL names the remote host's loopback endpoint; the SSH client or editor must expose and open the local forwarded address.
- **Binding all network interfaces is not supported** — `--host 0.0.0.0` is rejected at startup for safety; use the default loopback host.
- **A patch replaces whole row configs** — profile overlays restate every field a row keeps; there is no deep-merge layer.
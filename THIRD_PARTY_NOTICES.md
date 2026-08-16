# Third-Party Notices

FlowForge 0.2.0 (TypeScript) vendors and adapts source code from the following
MIT-licensed open-source projects. Each vendored package retains its upstream
LICENSE file inside its directory.

## Vendored runtime frameworks (vendor/)

| Package | Upstream | License |
|---|---|---|
| `@flowforge/cordis` | Cordis (https://github.com/cordiverse/cordis) | MIT |
| `@flowforge/cosmokit` | Cosmokit (vendored snapshot) | MIT |
| `@flowforge/schemastery` | Schemastery (vendored snapshot) | MIT |
| `@flowforge/cordis-plugin-loader` | Cordis Loader | MIT |
| `@flowforge/cordis-plugin-include` | Cordis Include | MIT |
| `@flowforge/cordis-plugin-group` | Cordis Group | MIT |
| `@flowforge/cordis-plugin-timer` | Cordis Timer | MIT |
| `@flowforge/cordis-plugin-hmr` | Cordis HMR | MIT |
| `@flowforge/cordis-plugin-logger-console` | Cordis Logger Console | MIT |

The vendor/ tree is a version snapshot (as of 2026-08-16) of the upstream
plugin-framework monorepo, adapted under MIT.

## Adapted architecture references (packages/)

- An internal agent-harness reference implementation — the "everything is a
  plugin" design; adapted under MIT.
- A multi-agent collaboration platform reference (chat threads, evolvable
  agents, external CLI control); adapted under MIT.

All adaptations preserve upstream copyright notices in the adapted source files
where applicable. FlowForge itself is MIT-licensed.

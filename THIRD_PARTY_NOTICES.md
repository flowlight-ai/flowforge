# Third-Party Notices

FlowForge 2.0 (TypeScript) vendors and adapts source code from the following
MIT-licensed open-source projects. Each vendored package retains its upstream
LICENSE file inside its directory.

## Vendored runtime frameworks (vendor/)

| Package | Upstream | License |
|---|---|---|
| `@deepseek-ai/cordis` | DeepSeek Harness / Cordis (https://github.com/cordiverse/cordis) | MIT |
| `@deepseek-ai/cosmokit` | DeepSeek Harness / Cosmokit | MIT |
| `@deepseek-ai/schemastery` | DeepSeek Harness / Schemastery | MIT |
| `@deepseek-ai/cordis-plugin-loader` | DeepSeek Harness / Cordis Loader | MIT |
| `@deepseek-ai/cordis-plugin-include` | DeepSeek Harness / Cordis Include | MIT |
| `@deepseek-ai/cordis-plugin-group` | DeepSeek Harness / Cordis Group | MIT |
| `@deepseek-ai/cordis-plugin-timer` | DeepSeek Harness / Cordis Timer | MIT |
| `@deepseek-ai/cordis-plugin-hmr` | DeepSeek Harness / Cordis HMR | MIT |
| `@deepseek-ai/cordis-plugin-logger-console` | DeepSeek Harness / Cordis Logger Console | MIT |

Source of vendored upstream: https://github.com/deepseek-ai/deepseek-harness
(version snapshot as of 2026-08-16; licensed under MIT).

## Adapted architecture references (packages/)

- DeepSeek Harness (`@deepseek-ai/dsh-*`) — agent harness framework, "everything
  is a plugin" design; adapted under MIT.
- Clowder AI / cat-cafe (https://github.com/zts212653/clowder-ai) — multi-agent
  collaboration platform (chat threads, evolvable agents "cats", external CLI
  control "limb"); adapted under MIT.

All adaptations preserve upstream copyright notices in the adapted source files
where applicable. FlowForge itself is MIT-licensed.

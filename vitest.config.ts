import { defineConfig } from 'vitest/config'
import path from 'node:path'
import ts from 'typescript'

// Transform standard TypeScript decorators before Vite's default parser sees
// source files (port of dsh's vitest.shared.ts standardDecoratorPlugin).
const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

function standardDecoratorPlugin() {
  return {
    name: 'flowforge-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

// Root-level vitest config: discovers per-package projects via workspace globs.
// Each package may ship its own vitest.config.ts; package configs take priority
// (vitest workspace semantics).
export default defineConfig({
  plugins: [standardDecoratorPlugin()],
  resolve: {
    alias: [
      // tools sub-paths: '@flowforge/tools/src/*' (self-imports spelled with
      // the src/ component) and exports like '@flowforge/tools/invariant'
      // both map into src/; the package's lib/ is not built in test mode.
      // NB: find must NOT end with '/' - rollup-plugin-alias matches with
      // `importee.startsWith(find + '/')`, so a trailing slash would require
      // a double slash to ever match (vite's normalizeAlias only strips the
      // slash when BOTH find and replacement end with one).
      { find: '@flowforge/tools/src', replacement: path.resolve(import.meta.dirname, 'packages/core/tools/src') },
      { find: '@flowforge/tools', replacement: path.resolve(import.meta.dirname, 'packages/core/tools/src') },
      { find: /^@flowforge\/tools$/, replacement: path.resolve(import.meta.dirname, 'packages/core/tools/src') },
      { find: '@flowforge/session-checkpoint-policy/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-checkpoint-policy/src') },
      { find: '@flowforge/session-checkpoint-policy', replacement: path.resolve(import.meta.dirname, 'packages/session/session-checkpoint-policy/src') },
      { find: '@flowforge/session-projection-cache/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-projection-cache/src') },
      { find: '@flowforge/session-projection-cache', replacement: path.resolve(import.meta.dirname, 'packages/session/session-projection-cache/src') },
      { find: '@flowforge/session-stats/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-stats/src') },
      { find: '@flowforge/session-stats', replacement: path.resolve(import.meta.dirname, 'packages/session/session-stats/src') },
      { find: '@flowforge/session-telemetry/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-telemetry/src') },
      { find: '@flowforge/session-telemetry', replacement: path.resolve(import.meta.dirname, 'packages/session/session-telemetry/src') },
      { find: '@flowforge/session-telemetry-otel/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-telemetry-otel/src') },
      { find: '@flowforge/session-telemetry-otel', replacement: path.resolve(import.meta.dirname, 'packages/session/session-telemetry-otel/src') },
      { find: '@flowforge/session-title/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title/src') },
      { find: '@flowforge/session-title', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title/src') },
      { find: '@flowforge/session-title-llm/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title-llm/src') },
      { find: '@flowforge/session-title-llm', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title-llm/src') },
      { find: '@flowforge/session-title-first-prompt-llm/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title-first-prompt-llm/src') },
      { find: '@flowforge/session-title-first-prompt-llm', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title-first-prompt-llm/src') },
      { find: '@flowforge/session-title-all-prompts-llm/src', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title-all-prompts-llm/src') },
      { find: '@flowforge/session-title-all-prompts-llm', replacement: path.resolve(import.meta.dirname, 'packages/session/session-title-all-prompts-llm/src') },
      { find: '@flowforge/storage-domain/src', replacement: path.resolve(import.meta.dirname, 'packages/storage/storage-domain/src') },
      { find: '@flowforge/storage-domain', replacement: path.resolve(import.meta.dirname, 'packages/storage/storage-domain/src') },
      { find: '@flowforge/storage-json/src', replacement: path.resolve(import.meta.dirname, 'packages/storage/storage-json/src') },
      { find: '@flowforge/storage-json', replacement: path.resolve(import.meta.dirname, 'packages/storage/storage-json/src') },
      { find: '@flowforge/storage-sqlite/src', replacement: path.resolve(import.meta.dirname, 'packages/storage/storage-sqlite/src') },
      { find: '@flowforge/storage-sqlite', replacement: path.resolve(import.meta.dirname, 'packages/storage/storage-sqlite/src') },
      { find: '@flowforge/command-feedback/src', replacement: path.resolve(import.meta.dirname, 'packages/feedback/command-feedback/src') },
      { find: '@flowforge/command-feedback', replacement: path.resolve(import.meta.dirname, 'packages/feedback/command-feedback/src') },
      { find: '@flowforge/message-feedback/src', replacement: path.resolve(import.meta.dirname, 'packages/feedback/message-feedback/src') },
      { find: '@flowforge/message-feedback', replacement: path.resolve(import.meta.dirname, 'packages/feedback/message-feedback/src') },
      { find: '@flowforge/acp-snapshot/src', replacement: path.resolve(import.meta.dirname, 'packages/test-support/acp-snapshot/src') },
      { find: '@flowforge/acp-snapshot', replacement: path.resolve(import.meta.dirname, 'packages/test-support/acp-snapshot/src') },
      { find: '@flowforge/llm-replay/src', replacement: path.resolve(import.meta.dirname, 'packages/test-support/llm-replay/src') },
      { find: '@flowforge/llm-replay', replacement: path.resolve(import.meta.dirname, 'packages/test-support/llm-replay/src') },
      { find: '@flowforge/loader-smoke/src', replacement: path.resolve(import.meta.dirname, 'packages/test-support/loader-smoke/src') },
      { find: '@flowforge/loader-smoke', replacement: path.resolve(import.meta.dirname, 'packages/test-support/loader-smoke/src') },
      { find: '@flowforge/code-runtime-worker-thread/src', replacement: path.resolve(import.meta.dirname, 'packages/code-runtime/code-runtime-worker-thread/src') },
      { find: '@flowforge/code-runtime-worker-thread', replacement: path.resolve(import.meta.dirname, 'packages/code-runtime/code-runtime-worker-thread/src') },
      { find: '@flowforge/cordis', replacement: path.resolve(import.meta.dirname, 'vendor/cordis/src') },
      { find: '@flowforge/cosmokit', replacement: path.resolve(import.meta.dirname, 'vendor/cosmokit/src') },
      { find: '@flowforge/cordis-plugin-group', replacement: path.resolve(import.meta.dirname, 'vendor/group/src') },
      { find: '@flowforge/cordis-plugin-hmr', replacement: path.resolve(import.meta.dirname, 'vendor/hmr/src') },
      { find: '@flowforge/cordis-plugin-include', replacement: path.resolve(import.meta.dirname, 'vendor/include/src') },
      { find: '@flowforge/cordis-plugin-loader', replacement: path.resolve(import.meta.dirname, 'vendor/loader/src') },
      { find: '@flowforge/cordis-plugin-logger-console', replacement: path.resolve(import.meta.dirname, 'vendor/logger-console/src') },
      { find: '@flowforge/schemastery', replacement: path.resolve(import.meta.dirname, 'vendor/schemastery/src') },
      { find: '@flowforge/cordis-plugin-timer', replacement: path.resolve(import.meta.dirname, 'vendor/timer/src') },
      { find: '@flowforge/attachment', replacement: path.resolve(import.meta.dirname, 'packages/attachment/attachment/src') },
      { find: '@flowforge/code-runtime', replacement: path.resolve(import.meta.dirname, 'packages/code-runtime/code-runtime/src') },
      { find: '@flowforge/compaction', replacement: path.resolve(import.meta.dirname, 'packages/compaction/compaction/src') },
      { find: '@flowforge/agent', replacement: path.resolve(import.meta.dirname, 'packages/core/agent/src') },
      { find: '@flowforge/agent-default-model', replacement: path.resolve(import.meta.dirname, 'packages/core/agent-default-model/src') },
      { find: '@flowforge/agent-loop', replacement: path.resolve(import.meta.dirname, 'packages/core/agent-loop/src') },
      { find: '@flowforge/scope', replacement: path.resolve(import.meta.dirname, 'packages/core/scope/src') },
      { find: '@flowforge/session', replacement: path.resolve(import.meta.dirname, 'packages/core/session/src') },
      { find: '@flowforge/system-prompt', replacement: path.resolve(import.meta.dirname, 'packages/core/system-prompt/src') },
      { find: '@flowforge/credentials', replacement: path.resolve(import.meta.dirname, 'packages/credentials/credentials/src') },
      { find: '@flowforge/credentials-local', replacement: path.resolve(import.meta.dirname, 'packages/credentials/credentials-local/src') },
      { find: '@flowforge/harness-boot', replacement: path.resolve(import.meta.dirname, 'packages/harness/boot/src') },
      { find: '@flowforge/anonymous-user-id', replacement: path.resolve(import.meta.dirname, 'packages/identity/anonymous-user-id/src') },
      { find: '@flowforge/commands', replacement: path.resolve(import.meta.dirname, 'packages/interaction/commands/src') },
      { find: '@flowforge/user-approval', replacement: path.resolve(import.meta.dirname, 'packages/interaction/user-approval/src') },
      { find: '@flowforge/llm', replacement: path.resolve(import.meta.dirname, 'packages/llm/llm/src') },
      { find: '@flowforge/llm-deepseek', replacement: path.resolve(import.meta.dirname, 'packages/llm/llm-deepseek/src') },
      { find: '@flowforge/llm-pi-ai', replacement: path.resolve(import.meta.dirname, 'packages/llm/llm-pi-ai/src') },
      { find: '@flowforge/llm-retry', replacement: path.resolve(import.meta.dirname, 'packages/llm/llm-retry/src') },
      { find: '@flowforge/token-meter', replacement: path.resolve(import.meta.dirname, 'packages/llm/token-meter/src') },
      { find: '@flowforge/invariants', replacement: path.resolve(import.meta.dirname, 'packages/runtime-diagnostics/invariants/src') },
      { find: '@flowforge/session-persistence', replacement: path.resolve(import.meta.dirname, 'packages/session/session-persistence/src') },
      { find: '@flowforge/session-persistence-jsonl', replacement: path.resolve(import.meta.dirname, 'packages/session/session-persistence-jsonl/src') },
      { find: '@flowforge/session-persistence-sqlite', replacement: path.resolve(import.meta.dirname, 'packages/session/session-persistence-sqlite/src') },
      { find: '@flowforge/session-projection', replacement: path.resolve(import.meta.dirname, 'packages/session/session-projection/src') },
      { find: '@flowforge/settings', replacement: path.resolve(import.meta.dirname, 'packages/settings/settings/src') },
      { find: '@flowforge/settings-file', replacement: path.resolve(import.meta.dirname, 'packages/settings/settings-file/src') },
      { find: '@flowforge/spill', replacement: path.resolve(import.meta.dirname, 'packages/spill/spill/src') },
      { find: '@flowforge/storage', replacement: path.resolve(import.meta.dirname, 'packages/storage/storage/src') },
      { find: '@flowforge/agent-loop-testkit', replacement: path.resolve(import.meta.dirname, 'packages/test-support/agent-loop-testkit/src') },
      { find: '@flowforge/llm-mock-server', replacement: path.resolve(import.meta.dirname, 'packages/test-support/llm-mock-server/src') },
      { find: '@flowforge/typert-protocol', replacement: path.resolve(import.meta.dirname, 'packages/typert/protocol/src') },
      { find: '@flowforge/typert-registry', replacement: path.resolve(import.meta.dirname, 'packages/typert/registry/src') },
      { find: '@flowforge/atomic-write', replacement: path.resolve(import.meta.dirname, 'packages/util/atomic-write/src') },
      { find: '@flowforge/brand', replacement: path.resolve(import.meta.dirname, 'packages/util/brand/src') },
      { find: '@flowforge/home-paths', replacement: path.resolve(import.meta.dirname, 'packages/util/home-paths/src') },
      { find: '@flowforge/launch-environment', replacement: path.resolve(import.meta.dirname, 'packages/util/launch-environment/src') },
      { find: '@flowforge/native-command', replacement: path.resolve(import.meta.dirname, 'packages/util/native-command/src') },
      { find: '@flowforge/output-retention', replacement: path.resolve(import.meta.dirname, 'packages/util/output-retention/src') },
      { find: '@flowforge/timeout', replacement: path.resolve(import.meta.dirname, 'packages/util/timeout/src') },
    ],
  },
  test: {
    environment: 'node',
    // process-bound suites (session-persistence-jsonl) and torn-frame
    // decoding are timing-sensitive under full-suite parallelism on Windows;
    // the dsh upstream runs them in a dedicated fork project.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // pnpm declares the workspace in pnpm-workspace.yaml, which vitest does not
    // auto-discover; inline @flowforge/* so every package import goes through
    // the Vite transform pipeline (alias + package-exports self-resolution)
    // instead of Node's bare-module lookup.
    server: {
      deps: {
        inline: [/@flowforge\/.*/],
      },
    },
    include: ['tests/**/*.test.ts', 'packages/*/*/tests/**/*.{test,spec}.ts', 'packages/*/*/test/**/*.{test,spec}.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'web/**',
      'flowforge/**',
      // Stage-ahead suites: depend on packages/scripts ported in later stages.
      // gen-tool-catalog.spec.ts needs the full tool ecosystem (stage 2+);
      // gen-persistence-catalog.spec.ts needs the mdast toolchain. Restored
      // when their dependencies land in the monorepo.
      'packages/core/tools/tests/gen-tool-catalog.spec.ts',
      'packages/core/session/tests/gen-persistence-catalog.spec.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**'],
    },
  },
})

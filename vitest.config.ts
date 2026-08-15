import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Root-level vitest config: discovers per-package projects via workspace globs.
// Each package may ship its own vitest.config.ts; package configs take priority
// (vitest workspace semantics).
export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/cordis': path.resolve(import.meta.dirname, 'vendor/cordis/src'),
      '@deepseek-ai/cosmokit': path.resolve(import.meta.dirname, 'vendor/cosmokit/src'),
      '@deepseek-ai/schemastery': path.resolve(import.meta.dirname, 'vendor/schemastery/src'),
      '@deepseek-ai/cordis-plugin-loader': path.resolve(import.meta.dirname, 'vendor/loader/src'),
      '@deepseek-ai/cordis-plugin-include': path.resolve(import.meta.dirname, 'vendor/include/src'),
      '@deepseek-ai/cordis-plugin-group': path.resolve(import.meta.dirname, 'vendor/group/src'),
      '@deepseek-ai/cordis-plugin-timer': path.resolve(import.meta.dirname, 'vendor/timer/src'),
      '@deepseek-ai/cordis-plugin-hmr': path.resolve(import.meta.dirname, 'vendor/hmr/src'),
      '@deepseek-ai/cordis-plugin-logger-console': path.resolve(import.meta.dirname, 'vendor/logger-console/src'),
      '@flowforge/harness-boot': path.resolve(import.meta.dirname, 'packages/harness/boot/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/*/*/tests/**/*.test.ts', 'packages/*/*/test/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'web/**', 'flowforge/**'],
    coverage: {
      provider: 'v8',
      include: ['packages/**/src/**'],
    },
  },
})

/**
 * CLI 适配器注册表（T6.6）
 *
 * 对齐 forgemind/external_agents.py EAC `_build_all_agents` 装配语义：
 * - 默认注册五个适配器（claude / codex / gemini / agy / opencode），
 *   二进制缺失时 isAvailable()=false，spawn 调用方据此降级提示
 * - register 允许组合根以自定义实现覆盖（一切皆可装配）
 */

import type { CliAdapter, CliProviderKind } from './types.js';
import { createAgyAdapter } from './agy-adapter.js';
import { createClaudeAdapter } from './claude-adapter.js';
import { createCodexAdapter } from './codex-adapter.js';
import { createGeminiAdapter } from './gemini-adapter.js';
import { createOpenCodeAdapter } from './opencode-adapter.js';

export interface LimbCliAdapterRegistry {
  /** 注册/覆盖适配器（同 kind 后注册者生效） */
  register(adapter: CliAdapter): void;
  /** 按 kind 取适配器；未注册返回 undefined */
  get(kind: CliProviderKind): CliAdapter | undefined;
  /** 是否已注册某 kind */
  has(kind: CliProviderKind): boolean;
  /** 列出全部已注册适配器（注册序） */
  list(): CliAdapter[];
}

/** 内存注册表实现（默认装配五适配器） */
export function createLimbCliAdapterRegistry(seed?: CliAdapter[]): LimbCliAdapterRegistry {
  const adapters = new Map<CliProviderKind, CliAdapter>();
  for (const adapter of seed ?? buildDefaultAdapters()) {
    adapters.set(adapter.config.kind, adapter);
  }
  return {
    register(adapter: CliAdapter): void {
      adapters.set(adapter.config.kind, adapter);
    },
    get(kind: CliProviderKind): CliAdapter | undefined {
      return adapters.get(kind);
    },
    has(kind: CliProviderKind): boolean {
      return adapters.has(kind);
    },
    list(): CliAdapter[] {
      return [...adapters.values()];
    },
  };
}

/** 默认五适配器（EAC DEFAULT_CONFIGS 全量移植） */
export function buildDefaultAdapters(): CliAdapter[] {
  return [
    createClaudeAdapter(),
    createCodexAdapter(),
    createGeminiAdapter(),
    createAgyAdapter(),
    createOpenCodeAdapter(),
  ];
}

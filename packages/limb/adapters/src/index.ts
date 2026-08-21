/**
 * @flowforge/limb-adapters — 阶段6 T6.6 外部 CLI 适配器域 Cordis 插件
 *
 * 挂载 `ctx.limbAdapters`：注册表持有五 CLI 适配器（claude / codex / gemini /
 * agy / opencode），统一 EAC 契约：isAvailable / buildSpawnArgs / createParser /
 * parsePlainText。全部纯函数/对象装配，组合根可注入自定义注册表或覆盖单个适配器。
 *
 * 对齐 forgemind/external_agents.py（老 flowforge Python）+ clowder-ai
 * providers/* 事件解析语义（详见各 adapter 模块头注释）。
 */

import { Context, Service } from '@flowforge/cordis';
import type { CliAdapter, CliAdapterConfig, CliEvent, CliEventParser, CliPlainTextResult, CliProviderKind, CliSpawnOptions } from './types.js';
import { createLimbCliAdapterRegistry, type LimbCliAdapterRegistry } from './registry.js';

export type {
  AgyCliPlainTextInput,
} from './agy-adapter.js';
export type {
  CliAdapter,
  CliAdapterConfig,
  CliEvent,
  CliEventParser,
  CliPlainTextResult,
  CliProviderKind,
  CliSpawnOptions,
} from './types.js';
export {
  classifyAgyPlainText,
  createAgyAdapter,
  DEFAULT_AGY_ADAPTER_CONFIG,
  extractAgyCliConversationId,
  extractAgyCliSelectedModelLabel,
} from './agy-adapter.js';
export { binaryInPath } from './binary-lookup.js';
export {
  createClaudeAdapter,
  DEFAULT_CLAUDE_ADAPTER_CONFIG,
  extractClaudeUsage,
  transformClaudeEvent,
} from './claude-adapter.js';
export {
  createCodexAdapter,
  createCodexStreamState,
  DEFAULT_CODEX_ADAPTER_CONFIG,
  transformCodexEvent,
  type CodexStreamState,
} from './codex-adapter.js';
export {
  createGeminiAdapter,
  DEFAULT_GEMINI_ADAPTER_CONFIG,
  extractGeminiErrorMessage,
  isGeminiResultErrorEvent,
  isKnownGeminiCandidatesCrash,
  transformGeminiEvent,
} from './gemini-adapter.js';
export {
  createOpenCodeAdapter,
  DEFAULT_OPENCODE_ADAPTER_CONFIG,
  transformOpenCodeEvent,
} from './opencode-adapter.js';
export {
  buildDefaultAdapters,
  createLimbCliAdapterRegistry,
  type LimbCliAdapterRegistry,
} from './registry.js';

export interface LimbAdaptersServiceOptions {
  /** 适配器注册表（缺省装配默认五适配器；组合根可注入自定义装配） */
  readonly registry?: LimbCliAdapterRegistry | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 外部 CLI 适配器域：注册表 + 统一 EAC 契约门面 */
    limbAdapters: LimbAdaptersService;
  }
}

export class LimbAdaptersService extends Service {
  /** 适配器注册表（默认五 CLI；组合根可覆盖） */
  readonly registry: LimbCliAdapterRegistry;

  constructor(ctx: Context, options?: LimbAdaptersServiceOptions) {
    super(ctx, 'limbAdapters');
    // ctx.plugin(Service) 不带 options 时 Cordis 传入 undefined
    this.registry = options?.registry ?? createLimbCliAdapterRegistry();
  }

  /** 按 kind 取适配器；未注册返回 undefined */
  get(kind: CliProviderKind): CliAdapter | undefined {
    return this.registry.get(kind);
  }

  /** 列出全部已注册适配器 */
  list(): CliAdapter[] {
    return this.registry.list();
  }

  /** 二进制是否在 PATH 中（EAC is_available） */
  isAvailable(kind: CliProviderKind, pathEnv?: string): boolean {
    return this.registry.get(kind)?.isAvailable(pathEnv) ?? false;
  }

  /** 组装 spawn argv（[binary, ...flags, prompt]） */
  buildSpawnArgs(kind: CliProviderKind, options?: CliSpawnOptions): string[] {
    const adapter = this.requireAdapter(kind);
    return [adapter.config.binary, ...adapter.buildSpawnArgs(options)];
  }

  /** 创建流式事件解析器（stream-json/json/ndjson） */
  createParser(kind: CliProviderKind): CliEventParser {
    return this.requireAdapter(kind).createParser();
  }

  /** plain text 输出分类（agy print 模式；其余适配器返回 undefined） */
  parsePlainText(kind: CliProviderKind, stdout: string, stderr?: string): CliPlainTextResult | undefined {
    return this.registry.get(kind)?.parsePlainText?.(stdout, stderr);
  }

  /** 便捷：把适配器配置转为内部视图（供日志/诊断） */
  describe(kind: CliProviderKind): CliAdapterConfig | undefined {
    return this.registry.get(kind)?.config;
  }

  private requireAdapter(kind: CliProviderKind): CliAdapter {
    const adapter = this.registry.get(kind);
    if (!adapter) {
      throw new Error(`CLI adapter not registered: ${kind}`);
    }
    return adapter;
  }
}

export default function Plugin(ctx: Context, options?: LimbAdaptersServiceOptions) {
  return ctx.plugin(LimbAdaptersService, options);
}

// 保持 CliEvent 在类型导出中可见（工具链友好）
export type { CliEvent as LimbCliEvent };

/**
 * @flowforge/forgekin-external-agents — 阶段7 T7.9 外部 Agent 适配器域 Cordis 插件
 *
 * 挂载 `ctx.forgeExternalAgents`：EAC 七契约外部 agent 适配器
 * （claude_code / codex / gemini / opencode / trae / custom，子进程隔离），
 * 对齐 Python `forgemind/external_agents.py` + `core/helm_adapter.py`，
 * 桥接 limb 域的 Helm 事件。
 */
import { Context, Service } from '@flowforge/cordis';
import {
  BinaryResolver,
  ExternalAgentAdapter,
  ExternalAgentConfig,
  ExternalAgentError,
  ExternalAgentKind,
  loadAdaptersFromConfig,
  SpawnFn,
} from './external-agent.js';
import {
  getHelmEmitter,
  HelmChatMessage,
  HelmEventEmitter,
  LLMClientHelmAdapter,
  setHelmEmitter,
} from './helm-adapter.js';

export * from './external-agent.js';
export * from './helm-adapter.js';

export interface ExternalAgentsServiceOptions {
  /** forgemind 配置（external_agents 段覆盖；缺省回退默认适配器） */
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  /** 预置适配器（跳过默认构造） */
  readonly adapters?: ReadonlyMap<ExternalAgentKind, ExternalAgentAdapter> | undefined;
  /** 二进制探测器（测试注入） */
  readonly resolveBinary?: BinaryResolver | undefined;
  /** 子进程执行器（测试注入） */
  readonly spawnFn?: SpawnFn | undefined;
}

export interface InvokeOptions {
  readonly cwd?: string | undefined;
  readonly timeout?: number | undefined;
  readonly extraArgs?: string[] | undefined;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 外部 Agent 适配器域：第三方编码/Agent 工具调用桥 */
    forgeExternalAgents: ExternalAgentsService;
  }
}

export class ExternalAgentsService extends Service {
  readonly adapters: ReadonlyMap<ExternalAgentKind, ExternalAgentAdapter>;

  constructor(ctx: Context, options: ExternalAgentsServiceOptions = {}) {
    super(ctx, 'forgeExternalAgents');
    this.adapters = options.adapters ?? loadAdaptersFromConfig(
      options.config ?? {},
      {
        resolveBinary: options.resolveBinary,
        spawnFn: options.spawnFn,
      },
    );
  }

  /** 取某 kind 的适配器（未注册抛错） */
  getAdapter(kind: ExternalAgentKind): ExternalAgentAdapter {
    const adapter = this.adapters.get(kind);
    if (!adapter) {
      throw new ExternalAgentError(`External agent adapter not registered: ${kind}`);
    }
    return adapter;
  }

  /** 探测某 kind 的 CLI 二进制是否已安装 */
  isAvailable(kind: ExternalAgentKind): boolean {
    return this.getAdapter(kind).isAvailable();
  }

  /** 以 one-shot prompt 调用某 kind 外部 Agent，返回 stdout */
  invoke(kind: ExternalAgentKind, prompt: string, options: InvokeOptions = {}): Promise<string> {
    return this.getAdapter(kind).invoke(prompt, options);
  }

  /** 构造任务级 Helm LLM 桥（可选注入 emitter，缺省取全局 emitter） */
  helmAdapter(taskId: string, emitter?: HelmEventEmitter | undefined): LLMClientHelmAdapter {
    return new LLMClientHelmAdapter(emitter ?? getHelmEmitter() ?? EMPTY_EMITTER, taskId);
  }

  /** 注册全局 Helm emitter（对齐 g_llm_client_set_helm_emitter） */
  setHelmEmitter(emitter: HelmEventEmitter | null): void {
    setHelmEmitter(emitter);
  }

  /** 快照（trace 日志）：kinds / available / 配置摘要 */
  snapshot(): { kinds: string[]; available: string[]; binaries: Record<string, string> } {
    const kinds: string[] = [];
    const available: string[] = [];
    const binaries: Record<string, string> = {};
    for (const [kind, adapter] of this.adapters) {
      kinds.push(kind);
      binaries[kind] = adapter.config.binary;
      if (adapter.isAvailable()) {
        available.push(kind);
      }
    }
    return { kinds, available, binaries };
  }
}

/** 缺省空发射器：无全局 emitter 时静默丢弃（避免运行时崩溃） */
const EMPTY_EMITTER: HelmEventEmitter = {
  emitLlmStart(): void {},
  emitLlmReasoning(): void {},
  emitLlmStream(): void {},
  emitLlmEnd(): void {},
};

export default function Plugin(ctx: Context, options?: ExternalAgentsServiceOptions) {
  return ctx.plugin(ExternalAgentsService, options);
}

// re-export 类型，便于消费方单独引用
export type { ExternalAgentConfig, ExternalAgentKind as ExternalAgentKindT };
export type { BinaryResolver, SpawnFn };
export type { HelmChatMessage, HelmEventEmitter };

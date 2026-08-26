/**
 * @flowforge/external-agent — F33/F34/F35 外部 Agent 域 Cordis 插件。
 *
 * 挂载 `ctx.forgeExternalAgent`，统一提供外部 Agent 域能力
 * （TS 重写自 flowforge/core/external_agent/，全部 17 核心模块 + 6 guardrails）：
 *   - registry: ProviderTransportRegistry（F241 CL-014，manifest.py + registry.py）
 *   - hostInjector: HostInjector（F241 CL-015 host-owned，host_injection.py）
 *   - transport: ACPTransport（F241 CL-016，acp_transport.py）
 *   - fallback: ExternalAgentFallback（F34，fallback.py）
 *   - fusion: ExternalAgentCapabilityFusion（F35，capability_fusion.py）
 *   - sharedState: ExternalAgentSharedState（F33，shared_state.py）
 *   - bridge: ExternalAgentBridge（bridge.py 五步调用链）
 *   - capabilityRegistry: CapabilityRegistry（capability_registry.py）
 *   - sessionManager: SessionManager（session_manager.py）
 *   - collaboration: CollaborationCoordinator（collaboration_coordinator.py）
 *   - avatarSync: AvatarSyncAdapter（avatar_sync.py）
 *   - promptConfigMap: PromptConfigMap（prompt_config_map.py）
 *   - worktree: ExternalAgentWorktree（worktree.py）
 *   - guardrails: 六层 Guardrails（L1 输入验证 ~ L6 成本上限）
 *   - reference: runReferenceDemo（F241 CL-017 reference runtime）
 *
 * 配置（config/*.yaml）随包发布，全部经 options 可覆盖。
 */

import { Context, Service } from '@flowforge/cordis';
import { ACPTransport, InMemoryTransportBackend, type TransportBackend } from './acp-transport.js';
import { AvatarSyncAdapter } from './avatar-sync.js';
import { ExternalAgentBridge, type AdapterFactory } from './bridge.js';
import { CapabilityRegistry } from './capability-registry.js';
import { ExternalAgentCapabilityFusion } from './capability-fusion.js';
import { NDJSONParser, StderrCollector } from './cli-ndjson.js';
import { CollaborationCoordinator } from './collaboration-coordinator.js';
import {
  loadFallbackConfig,
  loadManifestsConfig,
  loadPromptsConfig,
  loadToolAllowlistConfig,
} from './config.js';
import { ExternalAgentFallback } from './fallback.js';
import {
  type ConfirmCallback,
  ActionConfirmGuardrail,
  CostCeilingGuardrail,
  InputValidationGuardrail,
  OutputValidationGuardrail,
  SystemPromptGuardrail,
  ToolAllowlistGuardrail,
  type CostStore,
} from './guardrails/index.js';
import { HostInjector, type CredentialStore } from './host-injection.js';
import { type AgentProviderManifest, type SafetyLevel } from './manifest.js';
import { PromptConfigMap } from './prompt-config-map.js';
import { runReferenceDemo } from './reference-runtime.js';
import { ProviderTransportRegistry } from './registry.js';
import { SessionManager } from './session-manager.js';
import { ExternalAgentSharedState, type SharedStateStore } from './shared-state.js';
import { ExternalAgentWorktree, type WorktreeConfig } from './worktree.js';

export * from './manifest.js';
export * from './registry.js';
export * from './adapter.js';
export * from './shared-state.js';
export * from './fallback.js';
export * from './capability-fusion.js';
export * from './capability-registry.js';
export * from './session-manager.js';
export * from './collaboration-coordinator.js';
export * from './avatar-sync.js';
export * from './prompt-config-map.js';
export * from './host-injection.js';
export * from './worktree.js';
export * from './acp-transport.js';
export * from './cli-ndjson.js';
export * from './reference-runtime.js';
export * from './bridge.js';
export * from './config.js';
export * from './guardrails/index.js';

/** 内存 SharedStateStore（缺省后端，测试/单进程使用）。 */
export class InMemorySharedStateStore implements SharedStateStore {
  private readonly _data = new Map<string, Map<string, unknown>>();

  async read(forgekinId: string, key: string): Promise<unknown> {
    return this._data.get(forgekinId)?.get(key);
  }

  async write(forgekinId: string, key: string, value: unknown): Promise<void> {
    let map = this._data.get(forgekinId);
    if (!map) {
      map = new Map();
      this._data.set(forgekinId, map);
    }
    map.set(key, value);
  }

  async listKeys(forgekinId: string): Promise<string[]> {
    return Array.from(this._data.get(forgekinId)?.keys() ?? []);
  }
}

/** 内存 CostStore（缺省后端，测试/单进程使用）。 */
export class InMemoryCostStore implements CostStore {
  private readonly _usage = new Map<string, Record<string, unknown>>();

  async getUsage(forgekinId: string): Promise<Record<string, unknown>> {
    return { ...(this._usage.get(forgekinId) ?? { tokens: 0, calls: 0, cost: 0 }) };
  }

  async addUsage(
    forgekinId: string,
    tokens: number,
    calls: number,
    cost: number,
  ): Promise<void> {
    const current = await this.getUsage(forgekinId);
    this._usage.set(forgekinId, {
      tokens: Number(current['tokens'] ?? 0) + tokens,
      calls: Number(current['calls'] ?? 0) + calls,
      cost: Number(current['cost'] ?? 0) + cost,
    });
  }

  async resetUsage(forgekinId: string): Promise<void> {
    this._usage.delete(forgekinId);
  }
}

/** 环境变量 CredentialStore（缺省实现）。 */
export class EnvCredentialStore implements CredentialStore {
  get(envVar: string): string | undefined {
    return process.env[envVar];
  }
}

/** ExternalAgentService 配置（一切外部依赖经 options 注入）。 */
export interface ExternalAgentServiceOptions {
  /** Provider Manifests（缺省从内置 config/manifests/*.yaml 加载 4 个）。 */
  readonly manifests?: readonly AgentProviderManifest[];
  /** 凭据存储（缺省 EnvCredentialStore）。 */
  readonly credentialStore?: CredentialStore;
  /** ACP 传输后端（缺省 InMemoryTransportBackend）。 */
  readonly transportBackend?: TransportBackend;
  /** 共享状态存储（缺省 InMemorySharedStateStore）。 */
  readonly sharedStateStore?: SharedStateStore;
  /** 成本存储（缺省 InMemoryCostStore）。 */
  readonly costStore?: CostStore;
  /** fallback 重试次数（缺省 3）。 */
  readonly retryMaxAttempts?: number;
  /** fallback 退避秒数（缺省 5）。 */
  readonly backoffSeconds?: number;
  /** L5 操作确认回调（缺省无，不可逆操作默认拒绝）。 */
  readonly confirmCallback?: ConfirmCallback;
  /** Adapter 工厂（缺省无，走 ACPTransport）。 */
  readonly adapterFactory?: AdapterFactory;
  /** fallback.yaml 配置（缺省内置）。 */
  readonly fallbackConfig?: Record<string, unknown>;
  /** tool_allowlist.yaml 配置（缺省内置）。 */
  readonly toolAllowlistConfig?: Record<string, unknown>;
  /** prompts.yaml 配置（缺省内置）。 */
  readonly promptsConfig?: Record<string, unknown>;
}

declare module '@flowforge/cordis' {
  interface Context {
    /** 外部 Agent 域：共享状态 / 降级 / 能力融合 / 桥接 / 六层 Guardrails */
    forgeExternalAgent: ExternalAgentService;
  }
}

/**
 * 外部 Agent 域服务 — F33/F34/F35 统一入口。
 *
 * 组装全部 17 个核心模块 + 6 个 Guardrails：
 * bridge 五步调用链（选 Provider → 共享状态注入 → fallback → 融合 → 聚合成本）
 * 为对外主 API；其余模块经 ctx.forgeExternalAgent.xxx 直接访问。
 */
export class ExternalAgentService extends Service {
  /** Provider 注册表（F241 CL-014）。 */
  readonly registry: ProviderTransportRegistry;
  /** host-owned 注入器（F241 CL-015）。 */
  readonly hostInjector: HostInjector;
  /** ACP 统一传输层（F241 CL-016）。 */
  readonly transport: ACPTransport;
  /** 失败回退链（F34 fallback.py）。 */
  readonly fallback: ExternalAgentFallback;
  /** 能力融合（F35 capability_fusion.py）。 */
  readonly fusion: ExternalAgentCapabilityFusion;
  /** 共享状态（F33 shared_state.py）。 */
  readonly sharedState: ExternalAgentSharedState;
  /** 统一桥接层（bridge.py）。 */
  readonly bridge: ExternalAgentBridge;
  /** 能力注册表（capability_registry.py）。 */
  readonly capabilityRegistry: CapabilityRegistry;
  /** 会话管理（session_manager.py）。 */
  readonly sessionManager: SessionManager;
  /** 协作协调器（collaboration_coordinator.py）。 */
  readonly collaboration: CollaborationCoordinator;
  /** 形象同步（avatar_sync.py）。 */
  readonly avatarSync: AvatarSyncAdapter;
  /** 提示词配置映射（prompt_config_map.py）。 */
  readonly promptConfigMap: PromptConfigMap;
  /** 六层 Guardrails（L1-L6）。 */
  readonly guardrails: {
    readonly inputValidation: InputValidationGuardrail;
    readonly systemPrompt: SystemPromptGuardrail;
    readonly toolAllowlist: ToolAllowlistGuardrail;
    readonly outputValidation: OutputValidationGuardrail;
    readonly actionConfirm: ActionConfirmGuardrail;
    readonly costCeiling: CostCeilingGuardrail;
  };

  constructor(ctx: Context, options: ExternalAgentServiceOptions = {}) {
    super(ctx, 'forgeExternalAgent');

    // 1. 注册表：Manifests（内置 4 个或注入）
    const manifests =
      options.manifests ??
      loadManifestsConfig().map((raw) => normalizeRawManifest(raw));
    this.registry = new ProviderTransportRegistry();
    for (const manifest of manifests) {
      this.registry.register(manifest);
    }

    // 2. host 注入器 + ACP 传输
    this.hostInjector = new HostInjector(
      options.credentialStore ?? new EnvCredentialStore(),
    );
    this.transport = new ACPTransport(
      options.transportBackend ?? new InMemoryTransportBackend(),
    );

    // 3. F33/F34/F35 核心
    this.sharedState = new ExternalAgentSharedState(
      options.sharedStateStore ?? new InMemorySharedStateStore(),
    );
    const fallbackConfig = options.fallbackConfig ?? loadFallbackConfig();
    const retry = (fallbackConfig['retry'] ?? {}) as Record<string, unknown>;
    this.fallback = new ExternalAgentFallback(
      options.retryMaxAttempts ?? Number(retry['max_attempts'] ?? 3),
      options.backoffSeconds ?? Number(retry['backoff_seconds'] ?? 5.0),
    );
    this.fusion = new ExternalAgentCapabilityFusion();

    // 4. 管理模块
    this.capabilityRegistry = new CapabilityRegistry();
    this.sessionManager = new SessionManager();
    this.collaboration = new CollaborationCoordinator();
    this.avatarSync = new AvatarSyncAdapter();
    this.promptConfigMap = new PromptConfigMap();

    // 5. 六层 Guardrails
    const prompts = options.promptsConfig ?? loadPromptsConfig();
    const systemPromptRaw = (prompts['system_prompt'] ?? {}) as Record<string, unknown>;
    const allowlist = options.toolAllowlistConfig ?? loadToolAllowlistConfig();
    this.guardrails = {
      inputValidation: new InputValidationGuardrail(),
      systemPrompt: new SystemPromptGuardrail({
        ...(typeof systemPromptRaw['boundary_template'] === 'string'
          ? { boundary_template: systemPromptRaw['boundary_template'] as string }
          : {}),
        inject_position:
          systemPromptRaw['inject_position'] === 'suffix' ? 'suffix' : 'prefix',
      }),
      toolAllowlist: new ToolAllowlistGuardrail({
        default_allowed: asStrArray(allowlist['default_allowed']),
        default_forbidden: asStrArray(allowlist['default_forbidden']),
        per_provider: asRecordOfArrays(allowlist['per_provider']),
      }),
      outputValidation: new OutputValidationGuardrail(),
      actionConfirm: new ActionConfirmGuardrail({}, options.confirmCallback),
      costCeiling: new CostCeilingGuardrail(
        options.costStore ?? new InMemoryCostStore(),
      ),
    };

    // 6. Bridge（五步调用链）
    this.bridge = new ExternalAgentBridge({
      registry: this.registry,
      hostInjector: this.hostInjector,
      transport: this.transport,
      fallback: this.fallback,
      fusion: this.fusion,
      sharedState: this.sharedState,
      ...(options.adapterFactory !== undefined
        ? { adapterFactory: options.adapterFactory }
        : {}),
    });
  }

  /** 创建工作区（worktree.py create 工厂）。 */
  createWorktree(
    providerName: string,
    forgekinId: string,
    sourceSubdir?: string,
    config?: Partial<WorktreeConfig>,
  ): ExternalAgentWorktree {
    return ExternalAgentWorktree.create(providerName, forgekinId, sourceSubdir, config);
  }

  /** 参考运行时端到端演示（F241 CL-017）。 */
  runReferenceDemo(
    manifest: AgentProviderManifest,
    task: string,
  ): Promise<Record<string, unknown>> {
    return runReferenceDemo(manifest, this.hostInjector, task);
  }

  /** stderr 收集器工厂（CL-038）。 */
  createStderrCollector(): StderrCollector {
    return new StderrCollector();
  }

  /** NDJSON 解析器工厂（CL-038）。 */
  createNdjsonParser(): NDJSONParser {
    return new NDJSONParser();
  }
}

/** 规范化字符串数组。 */
function asStrArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** 规范化为 Record<string, readonly string[]>。 */
function asRecordOfArrays(
  value: unknown,
): Record<string, readonly string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(value as Record<string, unknown>)) {
    result[key] = asStrArray(items);
  }
  return result;
}

/** 从原始 YAML 数据规范化 Manifest（覆盖校验字段，一次性构建 readonly 对象）。 */
function normalizeRawManifest(raw: Record<string, unknown>): AgentProviderManifest {
  const retryPolicy = raw['retry_policy'];
  return {
    provider_name: String(raw['provider_name']),
    display_name: String(raw['display_name']),
    version: String(raw['version'] ?? '1.0.0'),
    protocol: String(raw['protocol'] ?? 'cli') as AgentProviderManifest['protocol'],
    transport: String(raw['transport'] ?? 'stdio') as AgentProviderManifest['transport'],
    capabilities: asStrArray(raw['capabilities']),
    blind_spots: asStrArray(raw['blind_spots']),
    ...(raw['timeout_seconds'] !== undefined
      ? { timeout_seconds: Number(raw['timeout_seconds']) }
      : {}),
    ...(retryPolicy !== undefined && typeof retryPolicy === 'object'
      ? {
          retry_policy: {
            max_attempts: Number((retryPolicy as Record<string, unknown>)['max_attempts'] ?? 3),
            backoff_seconds: Number((retryPolicy as Record<string, unknown>)['backoff_seconds'] ?? 5),
          },
        }
      : {}),
    ...(raw['cost_per_token'] !== undefined ? { cost_per_token: Number(raw['cost_per_token']) } : {}),
    ...(raw['cost_per_call'] !== undefined ? { cost_per_call: Number(raw['cost_per_call']) } : {}),
    ...(raw['safety_level'] !== undefined
      ? { safety_level: String(raw['safety_level']) as SafetyLevel }
      : {}),
    ...(raw['required_env_vars'] !== undefined
      ? { required_env_vars: asStrArray(raw['required_env_vars']) }
      : {}),
    ...(raw['required_permissions'] !== undefined
      ? { required_permissions: asStrArray(raw['required_permissions']) }
      : {}),
  };
}

export default function Plugin(
  ctx: Context,
  options: ExternalAgentServiceOptions = {},
): void {
  ctx.forgeExternalAgent = new ExternalAgentService(ctx, options);
}

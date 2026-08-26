/**
 * @flowforge/external-agent bridge — ExternalAgentBridge 统一桥接层（EX-003）。
 *
 * TS 重写自 flowforge/core/external_agent/bridge.py：
 *   - BridgeInvokeRequest: forgekin_id / task / context /
 *     preferred_providers / required_capability / worktree_root
 *   - BridgeInvokeResponse: success / winning_provider / result /
 *     fusion_result / fallback_attempts / cost / timestamp
 *   - ExternalAgentBridge: invoke 五步（选 Provider → 注入共享状态历史 →
 *     fallback 链调用 → 写共享状态 + 能力融合 → 聚合成本）/
 *     stream / listAvailableProviders / discoverProviders
 *
 * 调用流程：
 *   1. 查询 Registry 选择 Provider（或按 preferred_providers）
 *   2. HostInjector 注入 sandbox / credentials
 *   3. ACPTransport 调用三方 Agent（或 adapter_factory 注入的 Adapter）
 *   4. 结果写入 SharedState（EX-004）
 *   5. CapabilityFusion 融合能力到 Forgekin 画像（EX-010）
 *   6. 失败时 Fallback 链回退到下一个 Provider
 */

import { ACPTransport } from './acp-transport.js';
import type { ExternalAgentAdapter, ExternalAgentResult } from './adapter.js';
import {
  type FusionResult,
  ExternalAgentCapabilityFusion,
} from './capability-fusion.js';
import { type FallbackResult, ExternalAgentFallback } from './fallback.js';
import type { HostInjector, SandboxConfig } from './host-injection.js';
import type { AgentProviderManifest } from './manifest.js';
import { ProviderTransportRegistry } from './registry.js';
import { ExternalAgentSharedState } from './shared-state.js';

/** Bridge 调用请求（bridge.py BridgeInvokeRequest）。 */
export interface BridgeInvokeRequest {
  /** Forgekin ID。 */
  readonly forgekin_id: string;
  /** 任务描述。 */
  readonly task: string;
  /** 调用上下文。 */
  readonly context?: Record<string, unknown>;
  /** 首选 Provider 列表（空时使用默认 fallback 链）。 */
  readonly preferred_providers?: readonly string[];
  /** 所需能力（用于 discover，EX-008）。 */
  readonly required_capability?: string;
  /** worktree 根目录（None 时无 worktree 隔离）。 */
  readonly worktree_root?: string;
}

/** Bridge 调用响应（bridge.py BridgeInvokeResponse）。 */
export interface BridgeInvokeResponse {
  /** 最终是否成功。 */
  readonly success: boolean;
  /** 成功的 Provider。 */
  readonly winning_provider: string;
  /** 调用结果。 */
  readonly result: unknown;
  /** 能力融合结果（EX-010）。 */
  readonly fusion_result?: FusionResult;
  /** fallback 尝试记录。 */
  readonly fallback_attempts: readonly Record<string, unknown>[];
  /** 总成本信息（EX-006）。 */
  readonly cost: Record<string, unknown>;
  /** 响应时间戳（ISO 8601）。 */
  readonly timestamp: string;
}

/** Adapter 工厂函数类型（bridge.py adapter_factory）。 */
export type AdapterFactory = (manifest: AgentProviderManifest) => ExternalAgentAdapter;

/** 三方 Agent 统一桥接层（bridge.py ExternalAgentBridge）。 */
export class ExternalAgentBridge {
  private readonly _registry: ProviderTransportRegistry;
  private readonly _hostInjector: HostInjector;
  private readonly _transport: ACPTransport;
  private readonly _fallback: ExternalAgentFallback;
  private readonly _fusion: ExternalAgentCapabilityFusion;
  private readonly _sharedState: ExternalAgentSharedState;
  private readonly _adapterFactory?: AdapterFactory;

  constructor(options: {
    registry: ProviderTransportRegistry;
    hostInjector: HostInjector;
    transport: ACPTransport;
    fallback: ExternalAgentFallback;
    fusion: ExternalAgentCapabilityFusion;
    sharedState: ExternalAgentSharedState;
    /** 可选的 Adapter 工厂（None 时使用 ACPTransport 直接调用）。 */
    adapterFactory?: AdapterFactory;
  }) {
    this._registry = options.registry;
    this._hostInjector = options.hostInjector;
    this._transport = options.transport;
    this._fallback = options.fallback;
    this._fusion = options.fusion;
    this._sharedState = options.sharedState;
    if (options.adapterFactory !== undefined) {
      this._adapterFactory = options.adapterFactory;
    }
  }

  /**
   * Forgekin 调用三方 Agent 完成任务（bridge.py invoke 五步）。
   */
  async invoke(request: BridgeInvokeRequest): Promise<BridgeInvokeResponse> {
    const context = request.context ?? {};

    // 1. 选择 Provider 列表
    const providers = this._selectProviders(
      request.preferred_providers,
      request.required_capability,
    );
    if (providers.length === 0) {
      return {
        success: false,
        winning_provider: '',
        result: null,
        fallback_attempts: [],
        cost: {},
        timestamp: new Date().toISOString(),
      };
    }

    // 2. 注入历史 shared_state 到 context（EX-004）
    const history = await this._sharedState.listHistory(request.forgekin_id);
    context['shared_state_history'] = history;
    if (request.worktree_root) {
      context['worktree_root'] = request.worktree_root;
    }

    // 3. 通过 fallback 链调用
    const invokeFn = async (
      providerName: string,
      taskStr: string,
      ctx: Record<string, unknown>,
    ): Promise<Record<string, unknown>> =>
      this._invokeSingle(providerName, taskStr, ctx);
    const fallbackResult = await this._fallback.withFallback(
      providers,
      invokeFn,
      request.task,
      context,
    );

    // 4. 成功时写入 shared_state + 触发能力融合
    let fusionResult: FusionResult | undefined;
    if (fallbackResult.success) {
      // 4a. 写入 shared_state（EX-004）
      await this._sharedState.write(
        request.forgekin_id,
        `task_result/${new Date().toISOString()}`,
        {
          task: request.task,
          provider: fallbackResult.winning_provider,
          result: fallbackResult.result,
        },
        fallbackResult.winning_provider,
        { task: request.task, context_keys: Object.keys(context) },
      );
      // 4b. 能力融合（EX-010）
      const manifest = this._registry.get(fallbackResult.winning_provider);
      if (manifest !== undefined) {
        const externalProfile = this._buildExternalProfile(manifest);
        // 从 context 读取历史统计（由调用方维护）
        const invocationCount = Number(context['invocation_count'] ?? 1);
        const successRate = Number(context['success_rate'] ?? 1.0);
        const forgekinProfile =
          (context['forgekin_profile'] as Record<string, unknown>) ?? {};
        fusionResult = this._fusion.fuse(
          forgekinProfile,
          externalProfile,
          invocationCount,
          successRate,
        );
      }
    }

    // 5. 返回响应
    return {
      success: fallbackResult.success,
      winning_provider: fallbackResult.winning_provider,
      result: fallbackResult.result,
      ...(fusionResult !== undefined ? { fusion_result: fusionResult } : {}),
      fallback_attempts: [...fallbackResult.attempts] as unknown as Record<
        string,
        unknown
      >[],
      cost: this._aggregateCost(fallbackResult),
      timestamp: new Date().toISOString(),
    };
  }

  /** 流式调用三方 Agent（EX-009 流式语义）。 */
  async *stream(
    providerName: string,
    task: string,
    context: Record<string, unknown> = {},
  ): AsyncIterable<string> {
    yield* this._transport.stream(providerName, 'stream', { task, context });
  }

  /** 列出所有可用的三方 Agent（EX-008 能力发现）。 */
  listAvailableProviders(): Record<string, unknown>[] {
    return this._registry.listAll().map((m) => ({
      provider_name: m.provider_name,
      display_name: m.display_name,
      capabilities: m.capabilities,
      blind_spots: m.blind_spots,
      safety_level: m.safety_level,
    }));
  }

  /** 按能力发现 Provider（EX-008 能力发现机制）。 */
  discoverProviders(capability: string): Record<string, unknown>[] {
    return this._registry.discover(capability).map((m) => ({
      provider_name: m.provider_name,
      display_name: m.display_name,
      capabilities: m.capabilities,
      blind_spots: m.blind_spots,
    }));
  }

  // ── 内部方法 ──────────────────────────────────────────────────

  /** 选择 Provider 调用顺序（preferred → discover → 默认链）。 */
  private _selectProviders(
    preferred: readonly string[] | undefined,
    requiredCapability: string | undefined,
  ): string[] {
    if (preferred && preferred.length > 0) {
      return [...preferred];
    }
    if (requiredCapability) {
      const discovered = this._registry.discover(requiredCapability);
      if (discovered.length > 0) {
        return discovered.map((m) => m.provider_name);
      }
    }
    // 默认链仅保留已注册 Provider（未注册的无法调用，避免无效重试）
    return this._fallback
      .getDefaultChain()
      .filter((p) => this._registry.get(p) !== undefined);
  }

  /** 调用单个 Provider（优先 adapterFactory，否则 ACPTransport）。 */
  private async _invokeSingle(
    providerName: string,
    task: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const manifest = this._registry.get(providerName);
    if (manifest === undefined) {
      return {
        success: false,
        error: `Provider not registered: ${providerName}`,
      };
    }

    // 优先使用 Adapter（如果配置了 adapterFactory）
    if (this._adapterFactory !== undefined) {
      try {
        const adapter = this._adapterFactory(manifest);
        // 注入 sandbox（如配置了 worktree_root）
        let sandbox: SandboxConfig | undefined;
        const worktreeRoot = context['worktree_root'];
        if (typeof worktreeRoot === 'string') {
          sandbox = this._hostInjector.injectSandbox(
            providerName,
            worktreeRoot,
            toStrArray(context['network_allowlist']),
          );
        }
        const result: ExternalAgentResult = await adapter.invoke(task, context, sandbox);
        return {
          success: result.success,
          result: result.output,
          cost: result.cost,
          provider: result.provider_name,
          error: result.error,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // 否则使用 ACPTransport（F241 CL-016）
    try {
      const response = await this._transport.call(providerName, 'invoke', {
        task,
        context,
      });
      return {
        success: true,
        result: response['result'],
        cost: response['cost'] ?? {},
        provider: providerName,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: providerName,
      };
    }
  }

  /** 从 Manifest 构建外部 Agent 能力画像（供融合使用）。 */
  private _buildExternalProfile(
    manifest: AgentProviderManifest,
  ): Record<string, unknown> {
    return {
      provider_name: manifest.provider_name,
      display_name: manifest.display_name,
      capabilities: [...manifest.capabilities],
      blind_spots: [...manifest.blind_spots],
    };
  }

  /** 汇总 fallback 链的成本（EX-006）。 */
  private _aggregateCost(fallbackResult: FallbackResult): Record<string, unknown> {
    let totalTokens = 0;
    let totalCalls = 0;
    let totalCost = 0.0;
    const result = fallbackResult.result;
    if (result && typeof result === 'object') {
      const costInfo = (result as Record<string, unknown>)['cost'];
      if (costInfo && typeof costInfo === 'object') {
        const ci = costInfo as Record<string, unknown>;
        totalTokens = Number(ci['total_tokens'] ?? 0);
        totalCalls = Number(ci['total_calls'] ?? 0);
        totalCost = Number(ci['total_cost'] ?? 0.0);
      }
    }
    return {
      total_tokens: totalTokens,
      total_calls: totalCalls,
      total_cost: totalCost,
      attempts: fallbackResult.attempts.length,
      total_duration_ms: fallbackResult.total_duration_ms,
    };
  }
}

/** 将 unknown 值规范为字符串数组。 */
function toStrArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

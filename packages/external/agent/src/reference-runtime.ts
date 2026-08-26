/**
 * @flowforge/external-agent reference-runtime — 参考运行时（F241 CL-017）。
 *
 * TS 重写自 flowforge/core/external_agent/reference_runtime.py：
 *   - ReferenceRuntimeConfig: name / version / description /
 *     default_capabilities / default_blind_spots
 *   - ReferenceAgentAdapter: 参考 Adapter 实现（仅返回固定结构，
 *     不调用真实三方 Agent）；invoke / stream / getCapabilityProfile
 *   - runReferenceDemo: 端到端参考演示
 *
 * 厂商可参照此实现自己的 Adapter：
 *   1. 继承 BaseExternalAgentAdapter
 *   2. 实现 invoke() / stream() / getCapabilityProfile()
 *   3. 通过 Manifest 驱动（YAML 配置）
 *   4. 通过 HostInjector 注入安全配置（host-owned）
 */

import type { ExternalAgentResult } from './adapter.js';
import { BaseExternalAgentAdapter, type CapabilityProfile } from './adapter.js';
import type { HostInjector, SandboxConfig } from './host-injection.js';
import type { AgentProviderManifest } from './manifest.js';

/** 参考运行时配置（reference_runtime.py ReferenceRuntimeConfig）。 */
export interface ReferenceRuntimeConfig {
  /** 运行时名称。 */
  readonly name?: string;
  /** 运行时版本。 */
  readonly version?: string;
  /** 运行时描述。 */
  readonly description?: string;
  /** 默认能力声明。 */
  readonly default_capabilities?: readonly string[];
  /** 默认盲点声明（厂商必须覆盖）。 */
  readonly default_blind_spots?: readonly string[];
}

/** 参考 Adapter 实现（reference_runtime.py ReferenceAgentAdapter，F241 CL-017）。 */
export class ReferenceAgentAdapter extends BaseExternalAgentAdapter {
  private readonly _config: ReferenceRuntimeConfig;

  constructor(
    manifest: AgentProviderManifest,
    hostInjector: HostInjector,
    config?: ReferenceRuntimeConfig,
  ) {
    super(manifest, hostInjector);
    this._config = config ?? {};
  }

  /**
   * 参考 invoke 实现：仅返回固定结构（厂商应替换为真实三方 Agent 调用）。
   */
  async invoke(
    task: string,
    _context: Record<string, unknown>,
    sandbox?: SandboxConfig | null,
  ): Promise<ExternalAgentResult> {
    return {
      provider_name: this.providerName,
      success: true,
      output: {
        task,
        output:
          '[reference_runtime] 这是一个参考实现，厂商应替换为真实三方 Agent 调用。',
        sandbox_cwd: sandbox?.cwd ?? null,
        runtime_name: this._config.name ?? 'reference_runtime',
      },
      artifacts: [],
      cost: {
        total_tokens: 0,
        total_calls: 1,
        total_cost: 0.0,
      },
      capability_contribution: this.getCapabilityProfile() as unknown as Record<
        string,
        unknown
      >,
      timestamp: new Date().toISOString(),
    };
  }

  /** 参考 stream 实现（EX-009 流式语义）：分片输出。 */
  async *stream(
    task: string,
    _context: Record<string, unknown>,
    sandbox?: SandboxConfig | null,
  ): AsyncIterable<string> {
    void sandbox;
    yield '[reference_runtime] 开始流式输出\n';
    yield `task: ${task}\n`;
    yield '[reference_runtime] 流式输出结束\n';
  }

  /** 参考能力画像实现（EX-002）。 */
  getCapabilityProfile(): CapabilityProfile {
    return {
      provider_name: this.manifest.provider_name,
      display_name: this.manifest.display_name,
      capabilities: [...this.manifest.capabilities],
      blind_spots: [...this.manifest.blind_spots],
      strengths: ['参考实现——厂商应声明自己的优势'],
      best_practices: ['参考实现——厂商应声明最佳使用场景'],
      anti_patterns: ['参考实现——厂商应声明反模式（不该用此 Agent 的场景）'],
    };
  }
}

/**
 * 端到端参考演示（reference_runtime.py run_reference_demo）：
 * 返回 invoke / stream / capability_profile 三部分结果。
 */
export async function runReferenceDemo(
  manifest: AgentProviderManifest,
  hostInjector: HostInjector,
  task: string,
): Promise<Record<string, unknown>> {
  const adapter = new ReferenceAgentAdapter(manifest, hostInjector);

  // 1. 同步调用
  const invokeResult = await adapter.invoke(task, { demo: true }, null);

  // 2. 流式调用
  const streamChunks: string[] = [];
  for await (const chunk of adapter.stream(task, { demo: true })) {
    streamChunks.push(chunk);
  }

  // 3. 能力画像
  const profile = adapter.getCapabilityProfile();

  return {
    provider: manifest.provider_name,
    invoke_result: invokeResult,
    stream_chunks: streamChunks,
    capability_profile: profile,
  };
}

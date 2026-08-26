/**
 * @flowforge/external-agent adapter — ExternalAgentAdapter 抽象层（EX-003）。
 *
 * TS 重写自 flowforge/core/external_agent/adapter.py：
 *   - ExternalAgentResult: provider_name / success / output / artifacts / cost /
 *     capability_contribution / error / timestamp
 *   - ExternalAgentAdapter 接口: invoke / stream / get_capability_profile
 *   - 辅助：prepareSandbox / prepareCredentials（host-owned）
 */

import type { AgentProviderManifest } from './manifest.js';
import type { HostInjector, SandboxConfig } from './host-injection.js';

/** 成本信息（EX-006）。 */
export interface CostInfo {
  /** 累计 token 消耗。 */
  readonly total_tokens: number;
  /** 累计调用次数。 */
  readonly total_calls: number;
  /** 累计货币成本（美元）。 */
  readonly total_cost: number;
}

/** Adapter 调用结果（adapter.py ExternalAgentResult）。 */
export interface ExternalAgentResult {
  /** Provider 名称。 */
  readonly provider_name: string;
  /** 是否成功。 */
  readonly success: boolean;
  /** 输出（任意结构）。 */
  readonly output: unknown;
  /** 产出物列表（文件路径等）。 */
  readonly artifacts?: readonly string[];
  /** 成本信息（EX-006）。 */
  readonly cost?: CostInfo;
  /** 能力贡献画像（EX-002）。 */
  readonly capability_contribution?: Record<string, unknown>;
  /** 失败时的错误信息。 */
  readonly error?: string;
  /** 结果时间戳（ISO 8601 UTC）。 */
  readonly timestamp?: string;
}

/** Adapter 能力画像（EX-002）。 */
export interface CapabilityProfile {
  readonly provider_name: string;
  readonly display_name: string;
  readonly capabilities: readonly string[];
  readonly blind_spots: readonly string[];
  readonly strengths?: readonly string[];
  readonly best_practices?: readonly string[];
  readonly anti_patterns?: readonly string[];
  [key: string]: unknown;
}

/**
 * 三方 Agent 适配器接口（adapter.py ExternalAgentAdapter ABC）。
 *
 * 厂商参照 reference-runtime.ts 实现此接口：
 *   1. invoke() 同步调用
 *   2. stream() 流式调用（EX-009）
 *   3. get_capability_profile() 能力画像（EX-002）
 *
 * 注意：所有 I/O 使用 async/await；token/sandbox 一律经 host 注入，
 * 禁止在 Adapter 内自行读取凭据（F241 CL-015 host-owned）。
 */
export interface ExternalAgentAdapter {
  /** Provider 名称（来自 Manifest）。 */
  readonly providerName: string;
  /** Provider Manifest。 */
  readonly manifest: AgentProviderManifest;
  /** host-owned 注入器。 */
  readonly hostInjector: HostInjector;

  /** 同步调用三方 Agent。 */
  invoke(
    task: string,
    context: Record<string, unknown>,
    sandbox?: SandboxConfig | null,
  ): Promise<ExternalAgentResult>;

  /** 流式调用三方 Agent（EX-009）。 */
  stream(
    task: string,
    context: Record<string, unknown>,
    sandbox?: SandboxConfig | null,
  ): AsyncIterable<string>;

  /** 能力画像（EX-002，blind_spots 必填）。 */
  getCapabilityProfile(): CapabilityProfile;

  /**
   * 准备 sandbox（host-owned，EX-005）：
   * 无 worktree 时返回 null，由调用方决定是否注入。
   */
  prepareSandbox(worktreePath: string): SandboxConfig;

  /**
   * 准备凭据（host-owned，F241 CL-015）：
   * 按 Manifest.required_env_vars 从 CredentialStore 注入环境变量。
   *
   * @throws {Error} 必需环境变量缺失时。
   */
  prepareCredentials(extraEnv?: Record<string, string>): Record<string, string>;
}

/**
 * ExternalAgentAdapter 基类——提供 prepareSandbox / prepareCredentials 默认实现。
 * 厂商实现应继承本类（参考 reference-runtime.ts ReferenceAgentAdapter）。
 */
export abstract class BaseExternalAgentAdapter implements ExternalAgentAdapter {
  /** Provider 名称（来自 Manifest）。 */
  readonly providerName: string;
  /** Provider Manifest。 */
  readonly manifest: AgentProviderManifest;
  /** host-owned 注入器。 */
  readonly hostInjector: HostInjector;

  constructor(manifest: AgentProviderManifest, hostInjector: HostInjector) {
    this.manifest = manifest;
    this.hostInjector = hostInjector;
    this.providerName = manifest.provider_name;
  }

  abstract invoke(
    task: string,
    context: Record<string, unknown>,
    sandbox?: SandboxConfig | null,
  ): Promise<ExternalAgentResult>;

  abstract stream(
    task: string,
    context: Record<string, unknown>,
    sandbox?: SandboxConfig | null,
  ): AsyncIterable<string>;

  abstract getCapabilityProfile(): CapabilityProfile;

  /** 准备 sandbox（host-owned）：writable 默认仅 worktree。 */
  prepareSandbox(worktreePath: string): SandboxConfig {
    return this.hostInjector.injectSandbox(
      this.providerName,
      worktreePath,
    );
  }

  /** 准备凭据（host-owned）：缺失时抛 ValueError 语义错误。 */
  prepareCredentials(extraEnv?: Record<string, string>): Record<string, string> {
    return this.hostInjector.injectCredentials(
      this.providerName,
      [...(this.manifest.required_env_vars ?? [])],
      extraEnv,
    );
  }
}

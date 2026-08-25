/**
 * service — HarnessService（T7.10 七层 harness 工程统一入口）。
 *
 * 聚合六组件挂载 `ctx.forgeHarness`（Cordis 插件）：
 *   Layer1 durableState（SqliteDurableState / GitDurableState）
 *   Layer2 toolMediator（默认白名单 5 工具 + 别名 5 条）
 *   Layer3 evidenceCollector（证据哈希 + 自动验证）
 *   Layer4 governance（默认 5 规则 + SYSTEM_ROLE 压缩免疫）
 *   Layer6 entropyManager（文档新鲜度 / 技术债 / 规则演化 / GC）
 *   Layer7 harnessability（五维加权评估）
 *   Layer5 magicWords 已由 forgekin/magic-words 独立交付。
 *
 * @module @flowforge/forgekin-harness
 */

import { Service, type Context } from '@flowforge/cordis';
import type { HarnessOptions } from './types.js';
import {
  DurableStateSurface,
  GitDurableState,
  SqliteDurableState,
} from './durable-state.js';
import {
  DEFAULT_TOOL_ALIASES,
  DEFAULT_TOOL_WHITELIST,
  ToolMediator,
} from './tool-mediation.js';
import { EvidenceCollector } from './evidence-sensors.js';
import {
  DEFAULT_GOVERNANCE_RULES,
  GovernanceInjector,
} from './governance.js';
import {
  EntropyManager,
  type HarnessTaskContext,
} from './entropy-manager.js';
import {
  HarnessabilityScorer,
  type DimensionScore,
  type HarnessabilityReport,
} from './harnessability.js';

declare module '@flowforge/cordis' {
  interface Context {
    forgeHarness: HarnessService;
  }
}

/** Harness 服务——七层 harness 工程统一入口（ctx.forgeHarness）。 */
export class HarnessService extends Service {
  /** Layer1：感知现实（Durable State Surfaces）。 */
  readonly durableState: DurableStateSurface;
  /** Layer2：改变现实（Tool Mediation）。 */
  readonly toolMediator: ToolMediator;
  /** Layer3：验证现实（Evidence & Sensors）。 */
  readonly evidenceCollector: EvidenceCollector;
  /** Layer4：约束现实（Governance Boundary，压缩免疫）。 */
  readonly governance: GovernanceInjector;
  /** Layer6：清理现实（Entropy Control）。 */
  readonly entropyManager: EntropyManager;
  /** Layer7：适配现实（Harnessability 评估）。 */
  readonly harnessability: HarnessabilityScorer;
  /** 默认后端名（sqlite / git）。 */
  readonly durableStateBackend: 'sqlite' | 'git';

  constructor(ctx: Context, options: HarnessOptions = {}) {
    super(ctx, 'forgeHarness');
    this.durableStateBackend = options.durableStateBackend ?? 'sqlite';
    this.durableState =
      this.durableStateBackend === 'git'
        ? new GitDurableState(
            options.durableStateRepoPath ?? 'data/harness_v7_state_repo',
          )
        : new SqliteDurableState(
            options.durableStateDbPath ?? 'data/harness_v7_state.db',
          );
    this.toolMediator = new ToolMediator({
      whitelist: [...DEFAULT_TOOL_WHITELIST, ...(options.extraToolDescriptors ?? [])],
      aliases: { ...DEFAULT_TOOL_ALIASES, ...(options.extraToolAliases ?? {}) },
      dangerousRequiresConfirm: options.dangerousRequiresConfirm,
    });
    this.evidenceCollector = new EvidenceCollector({
      hashAlgorithm: options.evidenceHashAlgorithm,
      retentionDays: options.evidenceRetentionDays,
      autoVerify: options.evidenceAutoVerify,
    });
    this.governance = new GovernanceInjector({
      criticalPriorityThreshold: options.criticalPriorityThreshold,
    });
    for (const rule of DEFAULT_GOVERNANCE_RULES) {
      this.governance.registerRule(rule);
    }
    for (const rule of options.extraGovernanceRules ?? []) {
      this.governance.registerRule(rule);
    }
    this.entropyManager = new EntropyManager({
      docGardenerEnabled: options.entropy?.docGardenerEnabled,
      debtTrackerEnabled: options.entropy?.debtTrackerEnabled,
      ruleEvolutionEnabled: options.entropy?.ruleEvolutionEnabled,
      docStaleThreshold: options.entropy?.docStaleThreshold,
      highDebtThreshold: options.entropy?.highDebtThreshold,
    });
    this.harnessability = new HarnessabilityScorer({
      assessmentThreshold: options.harnessabilityThreshold,
      assessmentIntervalHours: options.harnessabilityIntervalHours,
    });
  }

  // ========== 七层快捷方法 ==========

  /** Layer1：读取持久状态。 */
  stateRead(key: string): Promise<unknown | undefined> {
    return this.durableState.read(key);
  }

  /** Layer1：写入持久状态（乐观锁版本自增）。 */
  stateWrite(key: string, value: unknown, writer: string) {
    return this.durableState.write(key, value, writer);
  }

  /** Layer1：删除持久状态。 */
  stateDelete(key: string): Promise<boolean> {
    return this.durableState.delete(key);
  }

  /** Layer2：中介一次工具调用（白名单 / 别名 / 危险确认）。 */
  mediateTool(
    toolName: string,
    args?: Readonly<Record<string, unknown>> | undefined,
    confirmedDangerous = false,
  ) {
    return this.toolMediator.mediate(toolName, args, confirmedDangerous);
  }

  /** Layer3：采集证据（哈希 + 自动验证）。 */
  collectEvidence(
    sourceType: import('./evidence-sensors.js').EvidenceSource,
    content: string,
    metadata?: Readonly<Record<string, unknown>> | undefined,
  ) {
    return this.evidenceCollector.collect(sourceType, content, metadata);
  }

  /** Layer4：注入全部启用治理规则到 SYSTEM_ROLE（压缩免疫）。 */
  injectGovernanceRules(ruleIds?: readonly string[] | undefined): Promise<string> {
    return this.governance.injectToSystemRoleBatch(ruleIds);
  }

  /** Layer6：执行前轻量熵检查。 */
  entropyPreCheck(ctx: HarnessTaskContext): Promise<void> {
    return this.entropyManager.preCheck(ctx);
  }

  /** Layer6：执行结果跟踪（失败转债务 + 规则演化）。 */
  entropyPostTrack(
    result: Readonly<Record<string, unknown>>,
    ctx: HarnessTaskContext,
  ): Promise<void> {
    return this.entropyManager.postTrack(result, ctx);
  }

  /** Layer6：运行全部熵检查，返回综合报告。 */
  entropyCheck(ctx: HarnessTaskContext) {
    return this.entropyManager.check(ctx);
  }

  /** Layer7：执行 harnessability 评估。 */
  assessHarnessability(
    dimensionScores: readonly DimensionScore[],
    now?: string | undefined,
  ): HarnessabilityReport {
    return this.harnessability.assess(dimensionScores, now);
  }

  /** Harness 服务快照（各层状态摘要）。 */
  snapshot(): Readonly<{
    durableStateBackend: 'sqlite' | 'git';
    whitelistedTools: number;
    aliases: number;
    auditTrailSize: number;
    evidenceCount: number;
    governanceRules: number;
    entropyFlags: Readonly<Record<string, unknown>>;
  }> {
    return {
      durableStateBackend: this.durableStateBackend,
      whitelistedTools: this.toolMediator.whitelist.size,
      aliases: this.toolMediator.aliases.size,
      auditTrailSize: this.toolMediator.auditTrail.length,
      evidenceCount: this.evidenceCollector.storage.size,
      governanceRules: this.governance.rules.size,
      entropyFlags: Object.fromEntries(this.entropyManager.entropyFlags),
    };
  }
}

/** Cordis 插件入口（同步赋值，对齐 observability/im-council 模式）。 */
export default function Plugin(ctx: Context, options: HarnessOptions = {}) {
  ctx.forgeHarness = new HarnessService(ctx, options);
}

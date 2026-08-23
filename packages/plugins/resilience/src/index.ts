/**
 * @flowforge/resilience — resilience primitives (F25) + Cordis plugin (T7.21/F23).
 *
 * Mapped from flowforge Python legacy core: circuit_breaker.py,
 * fallback_chain.py, degradation.py (decision tree + ResilienceExecutor),
 * recovery_tier.py, restart_recovery.py, checkpoint_manager.py and
 * checkpoint_config.py. The ResilienceService plugin mounts every core
 * component on `ctx.forgeResilience`.
 */

import { Service, type Context } from '@flowforge/cordis'
import { CheckpointManager, InMemoryCheckpointStore, type CheckpointStore } from './checkpoint.ts'
import {
  CheckpointConfig,
  checkpointConfigFromDict,
  getCheckpointConfig,
} from './checkpoint-config.ts'
import { AgentExecutionGuard, getCircuitBreaker, resetAllBreakers, type AgentExecutionGuardOptions, type CircuitBreakerOptions, type CircuitBreaker } from './circuit-breaker.ts'
import { DegradationDecisionTree, type DegradationCollaborators } from './degradation.ts'
import { FallbackChain, type FallbackChainOptions, type FallbackStepConfig } from './fallback-chain.ts'
import { RecoveryTierManager, type RecoveryTierManagerOptions } from './recovery-tier.ts'
import {
  ResilienceExecutor,
  type ResilienceExecutorOptions,
} from './resilience-executor.ts'
import { RestartRecoveryPipeline, type RestartRecoveryPipelineOptions } from './restart-recovery.ts'

export type { CheckpointManagerOptions, CheckpointRecord, CheckpointStore } from './checkpoint.ts'
export { CheckpointManager, InMemoryCheckpointStore } from './checkpoint.ts'
export type {
  AgentExecutionGuardOptions,
  CircuitBreakerOptions,
  CircuitState,
} from './circuit-breaker.ts'
export {
  AgentExecutionGuard,
  CircuitBreaker,
  CircuitOpenError,
  clearBreakerRegistry,
  getCircuitBreaker,
  resetAllBreakers,
} from './circuit-breaker.ts'
export type {
  DegradationAction,
  DegradationActionType,
  DegradationCollaborators,
  DegradationEventBus,
  DegradationLlmRouter,
  DegradationToolRegistry,
  DegradeToHumanEvent,
} from './degradation.ts'
export { DegradationDecisionTree, errorTypeName, toDegradeEventData } from './degradation.ts'
export type {
  AttemptRecord,
  FallbackChainOptions,
  FallbackHandlers,
  FallbackResult,
  FallbackStepConfig,
  FallbackStepType,
} from './fallback-chain.ts'
export {
  FallbackChain,
  classifyError,
  evaluateCondition,
  resolveTemplate,
} from './fallback-chain.ts'
export type {
  RecoveryAction,
  RecoveryContext,
  RecoveryEventBus,
  RecoveryMetricsCollector,
  RecoveryOperation,
  RecoveryResult,
  RecoveryStrategy,
  RecoveryTier,
  RecoveryTierManagerOptions,
} from './recovery-tier.ts'
export {
  DEFAULT_RECOVERY_STRATEGIES,
  RECOVERY_TIER,
  RecoveryTierManager,
} from './recovery-tier.ts'
export type {
  JournalEntry,
  QueueEntryState,
  QueueStateSnapshot,
  RestartEventBus,
  RestartNotification,
  RestartRecoveryConfig,
  RestartRecoveryPipelineOptions,
  RestartRecoveryStore,
  StaleRecord,
} from './restart-recovery.ts'
export {
  DEFAULT_RESTART_RECOVERY_CONFIG,
  RestartRecoveryPipeline,
} from './restart-recovery.ts'
export type { CheckpointBackend, CheckpointConfigInit } from './checkpoint-config.ts'
export {
  CHECKPOINT_TEMPLATE_NAMES,
  CheckpointConfig,
  checkpointConfigFromDict,
  getCheckpointConfig,
} from './checkpoint-config.ts'
export type {
  ExecuteWithResilienceOptions,
  ResilienceAttemptRecord,
  ResilienceExecutorOptions,
  ResilienceMetricsCollector,
  ResilienceOnAllFail,
  ResilienceOperation,
  ResilienceQuotaManager,
  ResilienceResult,
} from './resilience-executor.ts'
export {
  AllProvidersFailedError,
  PERMANENT_ERROR_KEYWORDS,
  ResilienceExecutor,
  SILENT_FAILURE_KEYWORDS,
  TEMPORARY_ERROR_KEYWORDS,
} from './resilience-executor.ts'

// ---------------------------------------------------------------------------
// Cordis plugin (T7.21): ResilienceService at ctx.forgeResilience
// ---------------------------------------------------------------------------

export interface ResilienceServiceOptions {
  /** Checkpoint storage backend (defaults to in-memory). */
  readonly checkpointStore?: CheckpointStore | undefined
  /** Collaborators for the degradation decision tree. */
  readonly degradation?: DegradationCollaborators | undefined
  /** Options for the T1-T4 recovery tier manager. */
  readonly recovery?: RecoveryTierManagerOptions | undefined
  /** Options for the per-agent execution guard. */
  readonly guard?: AgentExecutionGuardOptions | undefined
  /** Options for the restart recovery pipeline. */
  readonly restart?: RestartRecoveryPipelineOptions | undefined
  /** Defaults applied to executors created via createExecutor(). */
  readonly executor?: ResilienceExecutorOptions | undefined
}

declare module '@flowforge/cordis' {
  interface Context {
    forgeResilience: ResilienceService
  }
}

/** Resilience domain service — breakers / fallback / degradation / recovery / checkpoints. */
export class ResilienceService extends Service {
  /** Degradation decision tree (LLM/storage/workflow/tool routing). */
  readonly decisionTree: DegradationDecisionTree
  /** T1-T4 recovery tier manager with escalation chain. */
  readonly recoveryManager: RecoveryTierManager
  /** Task state checkpoint manager. */
  readonly checkpoints: CheckpointManager
  /** Per-agent circuit breaking plus timeout budgets. */
  readonly guard: AgentExecutionGuard
  /** Restart recovery pipeline (sweep / notify / snapshot / replay). */
  readonly pipeline: RestartRecoveryPipeline
  private readonly executorDefaults: ResilienceExecutorOptions
  private readonly degradationCollaborators: DegradationCollaborators

  constructor(ctx: Context, options: ResilienceServiceOptions = {}) {
    super(ctx, 'forgeResilience')
    this.degradationCollaborators = options.degradation ?? {}
    this.decisionTree = new DegradationDecisionTree(this.degradationCollaborators)
    this.recoveryManager = new RecoveryTierManager(options.recovery ?? {})
    this.checkpoints = new CheckpointManager(options.checkpointStore ?? new InMemoryCheckpointStore())
    this.guard = new AgentExecutionGuard(options.guard ?? {})
    this.pipeline = new RestartRecoveryPipeline(options.restart ?? {})
    this.executorDefaults = options.executor ?? {}
  }

  /** Get or create a named circuit breaker (shared registry). */
  getBreaker(name: string, options: CircuitBreakerOptions = {}): CircuitBreaker {
    return getCircuitBreaker(name, options)
  }

  /** Reset every registered breaker. */
  resetAllBreakers(): void {
    resetAllBreakers()
  }

  /** Build a P3-005 resilience executor (service defaults merged in). */
  createExecutor(
    primaryProvider: string,
    backupProviders: string[],
    options: ResilienceExecutorOptions = {},
  ): ResilienceExecutor {
    return new ResilienceExecutor(primaryProvider, backupProviders, {
      ...this.executorDefaults,
      degradation: this.degradationCollaborators,
      ...options,
    })
  }

  /** Build a declarative fallback chain. */
  createFallbackChain(steps: FallbackStepConfig[], options: FallbackChainOptions = {}): FallbackChain {
    return new FallbackChain(steps, options)
  }

  /** Resolve a checkpoint config template (Iron rule 5: config-driven). */
  checkpointTemplate(name = 'default'): CheckpointConfig {
    return getCheckpointConfig(name)
  }

  /** Cross-component status snapshot for diagnostics. */
  async snapshot(): Promise<Record<string, unknown>> {
    return {
      recovery: this.recoveryManager.getStatus(),
      guard: this.guard.getAllStatus(),
      degradation_history: this.decisionTree.getHistory().length,
      checkpoint: checkpointConfigFromDict({}).toManagerKwargs(),
    }
  }
}

export default function Plugin(ctx: Context, options?: ResilienceServiceOptions) {
  return ctx.plugin(ResilienceService, options)
}

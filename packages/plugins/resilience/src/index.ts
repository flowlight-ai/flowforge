/**
 * @flowforge/resilience — resilience primitives (F25).
 *
 * Mapped from flowforge Python legacy core: circuit_breaker.py,
 * fallback_chain.py, degradation.py, recovery_tier.py,
 * restart_recovery.py and checkpoint_manager.py.
 */

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

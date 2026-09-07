/**
 * @flowforge/plugin-dev — software engineering process plugin (EP0):
 * seven-phase delivery state machine (requirement → design → plan →
 * implement → review → verify → finish) with hard gates, process
 * instance registry and artifact path registration.
 *
 * Ported from the superpowers engineering methodology, fused with
 * our rules (mgr PR exit, T1-T9 test iron rules) — see
 * docs/refactor/33-stage-ep0-plugin-dev.md.
 */

export type {
  ForgeProcessStateMachineOptions,
  ProcessArtifactPaths,
  ProcessGateCheck,
  ProcessGateFlags,
  ProcessPhase,
  ProcessPhaseRecord,
  ProcessSnapshot,
  ProcessTransition,
} from './state-machine.ts'
export {
  ForgeProcessStateMachine,
  PROCESS_PHASES,
  PROCESS_TRANSITIONS,
  ProcessTransitionError,
} from './state-machine.ts'
export type { ForgeProcessRegistryOptions } from './registry.ts'
export { ForgeProcessRegistry, ProcessRegistryError } from './registry.ts'
export type {
  DecisionGateConfig,
  DecisionGateDimension,
  FastpassConfig,
  WorkflowKind,
  WorkflowProfile,
} from './workflows.ts'
export { gatesForPhase, getWorkflowProfile, WORKFLOW_KINDS, WORKFLOW_PROFILES } from './workflows.ts'
export type { PlanIssue, PlanValidationResult } from './plan-validator.ts'
export { validatePlan } from './plan-validator.ts'
export type { PersistedInstance } from './persistence.ts'
export { InstanceStore, InstanceStoreError, instancesDir } from './persistence.ts'
export type { EvidenceEntry } from './evidence.ts'
export { appendEvidence, formatEvidenceEntry, verificationsDir } from './evidence.ts'
export type {
  FindingSeverity,
  GateEvaluationResult,
  ReviewDispatchSpec,
  ReviewFinding,
  ReviewVerdict,
} from './review-protocol.ts'
export { buildReviewDispatch, evaluateGate, gradeReview, reviewFallbackChain } from './review-protocol.ts'
export type { DispatchResult, DispatchTask, SubagentDriver, TaskDispatcher } from './dispatcher.ts'
export { buildManualBrief, createDispatcher, NullDispatcher, SubagentDispatcher } from './dispatcher.ts'

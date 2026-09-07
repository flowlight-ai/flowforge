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

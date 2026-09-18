/**
 * @flowforge/forgekin-world-engine
 *
 * F093 three-layer world engine — waves 2a of the F44 port. This package
 * currently ships layers 1 and 2:
 *
 *   - **Core Identity Layer** — the Forgekin's immutable identity anchor (CL-007)
 *   - **World Layer** — 9 first-class citizens + three isolated memory tracks
 *     (CL-008 / CL-009), with the "RP 台词不自动入典" iron law enforced at the
 *     `addTurn` boundary (CL-010)
 *
 * Layer 3 (bridge protocols: role mask / canon sync / world driver + runtime
 * coordinator, and the four mind families) lands in wave 2b.
 *
 * @example
 * ```ts
 * const layer = new WorldLayer({
 *   world: createWorld({ worldId: 'w1', name: '西游记', setting: '取经' }),
 *   canonMemory: new InMemoryCanonMemory(),
 *   relationalMemory: new InMemoryRelationalMemory(),
 *   sessionMemory: new InMemorySessionMemory(),
 * });
 * layer.registerCharacter(createCharacter({ characterId: 'c1', name: '孙悟空', role: '主角', worldId: 'w1' }));
 * await layer.addTurn(createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '我是齐天大圣' }));
 * // canon stays empty until the Canon Sync Protocol confirms it (wave 2b / CL-010)
 * ```
 */

export {
  WorldEngineOwnershipError,
  WorldEngineStateError,
  WorldEngineValidationError,
} from './errors.js';
export { isoNow, systemClock } from './clock.js';
export type { Clock } from './clock.js';
export {
  assertKnownKeys,
  requireEnum,
  requireNonEmpty,
  requireNonNegativeInt,
  requirePresent,
  requireStringList,
  requireUnique,
} from './validation.js';
export {
  CANON_WRITERS,
  createArtifact,
  createBranch,
  createCanonDecision,
  createCharacter,
  createRelationship,
  createRound,
  createScene,
  createTurn,
  createWorld,
  withCanonFlag,
  withRelationType,
} from './citizens.js';
export type {
  Artifact,
  Branch,
  CanonDecision,
  CanonWriter,
  Character,
  Relationship,
  Round,
  Scene,
  Turn,
  World,
} from './citizens.js';
export { createCoreIdentity, describeCoreIdentity, verifyImprint } from './core-identity.js';
export type { CoreIdentityDescription, CoreIdentityLayer } from './core-identity.js';
export type { CanonFilter, CanonMemoryPort } from './ports/canon-memory.js';
export type { InteractionEntry, RelationalMemoryPort } from './ports/relational-memory.js';
export type { SessionDump, SessionMemoryPort } from './ports/session-memory.js';
export { InMemoryCanonMemory, canonWriters } from './canon-memory.js';
export { InMemoryRelationalMemory } from './relational-memory.js';
export type { RelationalMemoryOptions } from './relational-memory.js';
export { InMemorySessionMemory } from './session-memory.js';
export { WorldLayer } from './world-layer.js';
export type { WorldLayerDependencies, WorldLayerDescription } from './world-layer.js';

// ── wave 2b: bridge layer + mind families ──────────────────────────────────
export { silentLogger } from './logger.js';
export type { Logger } from './logger.js';
export {
  ONTOLOGY_LAYERS,
  ROLE_MASK_LAYERS,
  RoleMask,
  SCENE_LAYERS,
  assertRoleMaskLayer,
  roleMaskLayerName,
} from './bridge/role-mask.js';
export type {
  RoleMaskContent,
  RoleMaskDescription,
  RoleMaskLayer,
} from './bridge/role-mask.js';
export { CANON_CONFIRMERS, CanonSyncProtocol } from './bridge/canon-sync.js';
export type {
  CanonConfirmer,
  CanonProposal,
  CanonProposalSnapshot,
  CanonProposalStatus,
  CanonProposer,
  CanonSyncProtocolOptions,
} from './bridge/canon-sync.js';
export { WorldDriver } from './bridge/world-driver.js';
export type { WorldDriverOptions, WorldDriverState, WorldRotationEvent } from './bridge/world-driver.js';
export { RuntimeCoordinator } from './bridge/runtime-coordinator.js';
export type { RuntimeCoordinatorDescription, RuntimeCoordinatorOptions } from './bridge/runtime-coordinator.js';
export { BridgeLayer } from './bridge/bridge-layer.js';
export type { BridgeLayerDescription, BridgeLayerOptions } from './bridge/bridge-layer.js';
export {
  FAMILY_ALLOWED_ACTIONS,
  FAMILY_AWAKENING_RANGE,
  FAMILY_GUARDRAIL_STRENGTH,
  GUARDRAIL_DECISIONS,
  HotfixGuardrail,
  MaineCoonGuardrail,
  MIND_FAMILIES,
  MindFamilyRouter,
  RagdollGuardrail,
  SiameseGuardrail,
  defaultFamilyHooks,
} from './mind-families.js';
export type {
  GuardrailContext,
  GuardrailDecision,
  GuardrailHook,
  MindFamily,
  MindFamilyRouterOptions,
  RouteOutcome,
} from './mind-families.js';

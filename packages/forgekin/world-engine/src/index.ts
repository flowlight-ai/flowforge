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

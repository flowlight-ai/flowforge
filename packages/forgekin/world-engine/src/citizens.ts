/**
 * The nine first-class citizens of the World Layer (F093, CL-008).
 *
 *   1. World          世界设定
 *   2. Character      角色
 *   3. Scene          场景
 *   4. CanonDecision  典藏决策（世界级不可推翻）
 *   5. Relationship   关系
 *   6. Artifact       造物
 *   7. Round          回合
 *   8. Branch         分支
 *   9. Turn           轮次
 *
 * Iron law (CL-010): `Turn.isCanon` defaults to `false` — "RP 台词不自动入典".
 * Only a `Turn` explicitly confirmed through the Canon Sync Protocol may become
 * canon, and that protocol lives in the bridge layer (wave 2b).
 *
 * Validation parity: the legacy models were pydantic `BaseModel`s with
 * `extra="forbid"`. Only `World`, `CanonDecision` and `Round` carried
 * `@field_validator`s; the remaining citizens required their fields to be
 * present but did **not** reject blank strings. That asymmetry is preserved
 * here rather than silently tightened, so ported call sites keep their
 * behaviour.
 */

import { requireEnum, requireNonEmpty, requireNonNegativeInt, assertKnownKeys, freeze } from './validation.js';
import { WorldEngineValidationError } from './errors.js';

/** Who is allowed to author a canon decision (CL-010 / CL-021). */
export const CANON_WRITERS = ['operator', 'canon_driver', 'council'] as const;
export type CanonWriter = (typeof CANON_WRITERS)[number];

/** Citizen 1/9 — 世界设定. */
export interface World {
  readonly worldId: string;
  readonly name: string;
  readonly setting: string;
  readonly rules: readonly string[];
}

/** Citizen 2/9 — 角色. */
export interface Character {
  readonly characterId: string;
  readonly name: string;
  readonly role: string;
  readonly worldId: string;
}

/** Citizen 3/9 — 场景（一组 Round 的容器）. */
export interface Scene {
  readonly sceneId: string;
  readonly worldId: string;
  readonly location: string;
  readonly time: string;
}

/** Citizen 4/9 — 典藏决策（世界级不可推翻）. */
export interface CanonDecision {
  readonly decisionId: string;
  readonly worldId: string;
  readonly decision: string;
  readonly decidedBy: CanonWriter;
  readonly timestamp: string;
}

/** Citizen 5/9 — 关系. */
export interface Relationship {
  readonly relationshipId: string;
  readonly characterA: string;
  readonly characterB: string;
  readonly relationType: string;
}

/** Citizen 6/9 — 造物. */
export interface Artifact {
  readonly artifactId: string;
  readonly name: string;
  readonly worldId: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** Citizen 7/9 — 回合. */
export interface Round {
  readonly roundId: string;
  readonly sceneId: string;
  readonly sequence: number;
}

/** Citizen 8/9 — 分支. */
export interface Branch {
  readonly branchId: string;
  readonly parentRoundId: string;
  readonly description: string;
}

/** Citizen 9/9 — 轮次（RP 的最小单位）. */
export interface Turn {
  readonly turnId: string;
  readonly roundId: string;
  readonly characterId: string;
  readonly content: string;
  /** Iron law CL-010: defaults to `false`; never auto-promoted. */
  readonly isCanon: boolean;
}

function assertRecord(input: unknown, model: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new WorldEngineValidationError(`${model} must be an object`);
  }
  return input as Record<string, unknown>;
}

export function createWorld(input: {
  worldId: unknown;
  name: unknown;
  setting: unknown;
  rules?: unknown;
}): World {
  const raw = assertRecord(input, 'World');
  assertKnownKeys(raw, ['worldId', 'name', 'setting', 'rules'], 'World');
  const rules = raw['rules'];
  if (rules !== undefined && !Array.isArray(rules)) {
    throw new WorldEngineValidationError('World.rules must be a list');
  }
  return freeze({
    worldId: requireNonEmpty(raw['worldId'], 'world_id', 'World'),
    name: requireNonEmpty(raw['name'], 'name', 'World'),
    setting: String(raw['setting'] ?? ''),
    rules: Object.freeze((rules as readonly unknown[] | undefined ?? []).map((rule) => String(rule))),
  });
}

export function createCharacter(input: {
  characterId: unknown;
  name: unknown;
  role: unknown;
  worldId: unknown;
}): Character {
  const raw = assertRecord(input, 'Character');
  assertKnownKeys(raw, ['characterId', 'name', 'role', 'worldId'], 'Character');
  return freeze({
    characterId: String(raw['characterId'] ?? ''),
    name: String(raw['name'] ?? ''),
    role: String(raw['role'] ?? ''),
    worldId: String(raw['worldId'] ?? ''),
  });
}

export function createScene(input: {
  sceneId: unknown;
  worldId: unknown;
  location: unknown;
  time: unknown;
}): Scene {
  const raw = assertRecord(input, 'Scene');
  assertKnownKeys(raw, ['sceneId', 'worldId', 'location', 'time'], 'Scene');
  return freeze({
    sceneId: String(raw['sceneId'] ?? ''),
    worldId: String(raw['worldId'] ?? ''),
    location: String(raw['location'] ?? ''),
    time: String(raw['time'] ?? ''),
  });
}

export function createCanonDecision(input: {
  decisionId: unknown;
  worldId: unknown;
  decision: unknown;
  decidedBy: unknown;
  timestamp: unknown;
}): CanonDecision {
  const raw = assertRecord(input, 'CanonDecision');
  assertKnownKeys(raw, ['decisionId', 'worldId', 'decision', 'decidedBy', 'timestamp'], 'CanonDecision');
  return freeze({
    decisionId: String(raw['decisionId'] ?? ''),
    worldId: String(raw['worldId'] ?? ''),
    decision: String(raw['decision'] ?? ''),
    decidedBy: requireEnum(raw['decidedBy'], CANON_WRITERS, 'decided_by', 'CanonDecision'),
    timestamp: String(raw['timestamp'] ?? ''),
  });
}

export function createRelationship(input: {
  relationshipId: unknown;
  characterA: unknown;
  characterB: unknown;
  relationType: unknown;
}): Relationship {
  const raw = assertRecord(input, 'Relationship');
  assertKnownKeys(raw, ['relationshipId', 'characterA', 'characterB', 'relationType'], 'Relationship');
  return freeze({
    relationshipId: String(raw['relationshipId'] ?? ''),
    characterA: String(raw['characterA'] ?? ''),
    characterB: String(raw['characterB'] ?? ''),
    relationType: String(raw['relationType'] ?? ''),
  });
}

export function createArtifact(input: {
  artifactId: unknown;
  name: unknown;
  worldId: unknown;
  properties?: unknown;
}): Artifact {
  const raw = assertRecord(input, 'Artifact');
  assertKnownKeys(raw, ['artifactId', 'name', 'worldId', 'properties'], 'Artifact');
  const properties = raw['properties'];
  if (properties !== undefined && (typeof properties !== 'object' || properties === null || Array.isArray(properties))) {
    throw new WorldEngineValidationError('Artifact.properties must be a dict');
  }
  return freeze({
    artifactId: String(raw['artifactId'] ?? ''),
    name: String(raw['name'] ?? ''),
    worldId: String(raw['worldId'] ?? ''),
    properties: freeze({ ...(properties as Record<string, unknown> | undefined ?? {}) }),
  });
}

export function createRound(input: { roundId: unknown; sceneId: unknown; sequence: unknown }): Round {
  const raw = assertRecord(input, 'Round');
  assertKnownKeys(raw, ['roundId', 'sceneId', 'sequence'], 'Round');
  return freeze({
    roundId: String(raw['roundId'] ?? ''),
    sceneId: String(raw['sceneId'] ?? ''),
    sequence: requireNonNegativeInt(raw['sequence'], 'sequence', 'Round'),
  });
}

export function createBranch(input: {
  branchId: unknown;
  parentRoundId: unknown;
  description: unknown;
}): Branch {
  const raw = assertRecord(input, 'Branch');
  assertKnownKeys(raw, ['branchId', 'parentRoundId', 'description'], 'Branch');
  return freeze({
    branchId: String(raw['branchId'] ?? ''),
    parentRoundId: String(raw['parentRoundId'] ?? ''),
    description: String(raw['description'] ?? ''),
  });
}

/** Citizen 9/9 — note the CL-010 default (`isCanon: false`). */
export function createTurn(input: {
  turnId: unknown;
  roundId: unknown;
  characterId: unknown;
  content: unknown;
  isCanon?: unknown;
}): Turn {
  const raw = assertRecord(input, 'Turn');
  assertKnownKeys(raw, ['turnId', 'roundId', 'characterId', 'content', 'isCanon'], 'Turn');
  const isCanon = raw['isCanon'];
  if (isCanon !== undefined && typeof isCanon !== 'boolean') {
    throw new WorldEngineValidationError('Turn.isCanon must be a boolean');
  }
  return freeze({
    turnId: String(raw['turnId'] ?? ''),
    roundId: String(raw['roundId'] ?? ''),
    characterId: String(raw['characterId'] ?? ''),
    content: String(raw['content'] ?? ''),
    isCanon: isCanon ?? false,
  });
}

/** Rebuild a Turn with `isCanon` promoted — used by the canon confirm path. */
export function withCanonFlag(turn: Turn, isCanon: boolean): Turn {
  return freeze({ ...turn, isCanon });
}

/** Same-shape copy used by relational memory when a relationship evolves. */
export function withRelationType(relationship: Relationship, relationType: string): Relationship {
  return freeze({ ...relationship, relationType });
}

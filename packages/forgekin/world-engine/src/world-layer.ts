/**
 * World Layer (F093 layer 2) — the stage a Forgekin performs on.
 *
 * Holds one `World` plus the three memory tracks (canon / relational / session)
 * and the registries for the remaining citizens.
 *
 * Two boundaries are enforced here:
 *   - **World isolation** — characters, scenes and artifacts whose `worldId`
 *     does not match this layer are rejected (`WorldEngineOwnershipError`).
 *   - **CL-010** — `addTurn` writes to session memory *only*. Promoting a turn
 *     to canon requires the Canon Sync Protocol (bridge layer, wave 2b), which
 *     is deliberately not reachable from this class.
 *
 * Ported from `world.py` (F093, CL-008 / CL-009).
 */

import type { CanonMemoryPort } from './ports/canon-memory.js';
import type { RelationalMemoryPort } from './ports/relational-memory.js';
import type { SessionMemoryPort } from './ports/session-memory.js';
import type { Artifact, Branch, Character, Relationship, Round, Scene, Turn, World } from './citizens.js';
import { WorldEngineOwnershipError } from './errors.js';
import { requirePresent } from './validation.js';

export interface WorldLayerDependencies {
  readonly world: World;
  readonly canonMemory: CanonMemoryPort;
  readonly relationalMemory: RelationalMemoryPort;
  readonly sessionMemory: SessionMemoryPort;
}

/** Entity counts reported by {@link WorldLayer.describe}. */
export interface WorldLayerDescription {
  readonly world: World;
  readonly characterCount: number;
  readonly sceneCount: number;
  readonly artifactCount: number;
  readonly roundCount: number;
  readonly branchCount: number;
  readonly relationshipCount: number;
  readonly layer: 'world';
}

export class WorldLayer {
  private readonly worldValue: World;
  private readonly canon: CanonMemoryPort;
  private readonly relational: RelationalMemoryPort;
  private readonly session: SessionMemoryPort;

  private readonly characters = new Map<string, Character>();
  private readonly scenes = new Map<string, Scene>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly rounds = new Map<string, Round>();
  private readonly branches = new Map<string, Branch>();
  private readonly relationships = new Map<string, Relationship>();

  constructor(dependencies: WorldLayerDependencies) {
    this.worldValue = requirePresent(dependencies?.world, 'world');
    this.canon = requirePresent(dependencies?.canonMemory, 'canon_memory');
    this.relational = requirePresent(dependencies?.relationalMemory, 'relational_memory');
    this.session = requirePresent(dependencies?.sessionMemory, 'session_memory');
  }

  get world(): World {
    return this.worldValue;
  }

  get worldId(): string {
    return this.worldValue.worldId;
  }

  get canonMemory(): CanonMemoryPort {
    return this.canon;
  }

  get relationalMemory(): RelationalMemoryPort {
    return this.relational;
  }

  get sessionMemory(): SessionMemoryPort {
    return this.session;
  }

  // ── entity registration ────────────────────────────────────────────────

  registerCharacter(character: Character): void {
    this.assertSameWorld(character.worldId, '角色');
    this.characters.set(character.characterId, character);
  }

  getCharacter(characterId: string): Character | undefined {
    return this.characters.get(characterId);
  }

  listCharacters(): readonly Character[] {
    return [...this.characters.values()];
  }

  registerScene(scene: Scene): void {
    this.assertSameWorld(scene.worldId, '场景');
    this.scenes.set(scene.sceneId, scene);
  }

  getScene(sceneId: string): Scene | undefined {
    return this.scenes.get(sceneId);
  }

  registerArtifact(artifact: Artifact): void {
    this.assertSameWorld(artifact.worldId, '造物');
    this.artifacts.set(artifact.artifactId, artifact);
  }

  registerRound(round: Round): void {
    this.rounds.set(round.roundId, round);
  }

  registerBranch(branch: Branch): void {
    this.branches.set(branch.branchId, branch);
  }

  registerRelationship(relationship: Relationship): void {
    this.relationships.set(relationship.relationshipId, relationship);
  }

  /**
   * Append a turn to session memory.
   *
   * Iron law CL-010: this never writes canon memory — canon writes go through
   * the Canon Sync Protocol and require explicit confirmation.
   */
  async addTurn(turn: Turn): Promise<void> {
    await this.session.addTurn(turn);
  }

  describe(): WorldLayerDescription {
    return {
      world: this.worldValue,
      characterCount: this.characters.size,
      sceneCount: this.scenes.size,
      artifactCount: this.artifacts.size,
      roundCount: this.rounds.size,
      branchCount: this.branches.size,
      relationshipCount: this.relationships.size,
      layer: 'world',
    };
  }

  private assertSameWorld(entityWorldId: string, kind: string): void {
    if (entityWorldId !== this.worldId) {
      throw new WorldEngineOwnershipError(
        `${kind} world_id='${entityWorldId}' 与本世界 world_id='${this.worldId}' 不一致（world 隔离）`,
      );
    }
  }
}

/**
 * Runtime Coordinator (F093 bridge layer) — the director.
 *
 * Decides when to wear a mask (enter a scene), when to take it off (leave), and
 * when to propose canon. It is the protocol-level mediator between the Core
 * Identity Layer and the World Layer (CL-012).
 *
 * Dependency note (design D2): the source held a reference to the whole
 * `BridgeLayer` just to reach its canon sync protocol, which would be a module
 * cycle in TypeScript. The coordinator depends on the minimal
 * {@link CanonProposer} seam instead; `BridgeLayer` wires the two together.
 */

import type { Scene, Turn } from '../citizens.js';
import type { CoreIdentityLayer } from '../core-identity.js';
import { WorldEngineOwnershipError, WorldEngineStateError, WorldEngineValidationError } from '../errors.js';
import { requirePresent } from '../validation.js';
import type { WorldLayer } from '../world-layer.js';
import type { CanonProposer } from './canon-sync.js';
import { RoleMask, type RoleMaskContent, type RoleMaskLayer } from './role-mask.js';

export interface RuntimeCoordinatorOptions {
  readonly coreIdentity: CoreIdentityLayer;
  readonly world: WorldLayer;
  readonly canonProposer: CanonProposer;
}

export interface RuntimeCoordinatorDescription {
  readonly forgekinId: string;
  readonly worldId: string;
  readonly isInScene: boolean;
  readonly currentSceneId: string | null;
  readonly roleMaskActive: boolean;
  readonly roleMaskLayers: readonly RoleMaskLayer[];
}

export class RuntimeCoordinator {
  private readonly identity: CoreIdentityLayer;
  private readonly worldLayer: WorldLayer;
  private readonly proposer: CanonProposer;
  private scene: Scene | null = null;
  private activeRoleMask: RoleMask | null = null;

  constructor(options: RuntimeCoordinatorOptions) {
    this.identity = requirePresent(options?.coreIdentity, 'core_identity');
    this.worldLayer = requirePresent(options?.world, 'world');
    this.proposer = requirePresent(options?.canonProposer, 'canon_proposer');
  }

  get coreIdentity(): CoreIdentityLayer {
    return this.identity;
  }

  get currentScene(): Scene | null {
    return this.scene;
  }

  get isInScene(): boolean {
    return this.scene !== null;
  }

  /**
   * Enter a scene (wear the mask).
   *
   * Three checks, in the source's order: the scene belongs to this world, the
   * mask is held by this Forgekin (anti-impersonation), and no scene is active.
   */
  async enterScene(scene: Scene, roleMask: RoleMask): Promise<void> {
    if (scene.worldId !== this.worldLayer.worldId) {
      throw new WorldEngineOwnershipError(
        `场景 world_id='${scene.worldId}' 与当前世界 world_id='${this.worldLayer.worldId}' 不一致，拒绝进入场景`,
      );
    }
    if (roleMask.forgekinId !== this.identity.forgekinId) {
      throw new WorldEngineValidationError(
        `RoleMask 持有者 '${roleMask.forgekinId}' 与 CoreIdentity '${this.identity.forgekinId}' 不一致，拒绝进入场景（防止身份冒用，CL-012）`,
      );
    }
    if (this.scene !== null) {
      throw new WorldEngineStateError(
        `已在场景 '${this.scene.sceneId}' 中，必须先 exitScene 再进入新场景`,
      );
    }
    this.scene = scene;
    this.activeRoleMask = roleMask;
  }

  /**
   * Leave the scene (take off the mask). Removes L4/L5 so scene skin cannot
   * pollute ontology capability (CL-011) and returns what was removed.
   */
  async exitScene(): Promise<Partial<Record<RoleMaskLayer, RoleMaskContent>>> {
    if (this.scene === null) {
      throw new WorldEngineStateError('当前不在场景中，无法 exitScene');
    }
    const taken =
      this.activeRoleMask !== null ? this.activeRoleMask.takeOffSceneLayers() : {};
    this.scene = null;
    this.activeRoleMask = null;
    return taken;
  }

  /**
   * Propose canon for a turn, delegating to the Canon Sync Protocol.
   *
   * Iron law CL-010: this never writes canon memory; it only creates a pending
   * proposal that `operator` / `canon_driver` must confirm.
   *
   * @throws {WorldEngineStateError} not currently in a scene.
   */
  async proposeCanon(turn: Turn): Promise<string> {
    if (this.scene === null) {
      throw new WorldEngineStateError('当前不在场景中，无法提议入典。必须先 enterScene');
    }
    return this.proposer.proposeCanon(turn, this.identity.forgekinId);
  }

  describe(): RuntimeCoordinatorDescription {
    return {
      forgekinId: this.identity.forgekinId,
      worldId: this.worldLayer.worldId,
      isInScene: this.isInScene,
      currentSceneId: this.scene !== null ? this.scene.sceneId : null,
      roleMaskActive: this.activeRoleMask !== null,
      roleMaskLayers:
        this.activeRoleMask !== null
          ? (Object.keys(this.activeRoleMask.getActiveMask())
              .map((key) => Number(key) as RoleMaskLayer)
              .sort((left, right) => left - right))
          : [],
    };
  }
}

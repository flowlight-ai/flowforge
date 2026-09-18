/**
 * Bridge Layer (F093 layer 3) — the only channel between Core Identity and World.
 *
 * Aggregates the three protocols (Role Mask / Canon Sync / World Driver) plus
 * the runtime coordinator, and holds no business state of its own.
 *
 * Iron law CL-012: cross-layer operations (wear a mask, enter canon, rotate the
 * world) must go through this layer. Core Identity must not touch the World
 * directly, and the World must not modify Core Identity.
 *
 * Ported from `bridge.py`.
 */

import { requirePresent } from '../validation.js';
import type { CanonSyncProtocol } from './canon-sync.js';
import type { RoleMask } from './role-mask.js';
import type { RuntimeCoordinator, RuntimeCoordinatorDescription } from './runtime-coordinator.js';
import type { WorldDriver } from './world-driver.js';

export interface BridgeLayerOptions {
  readonly roleMaskProtocol: RoleMask;
  readonly canonSyncProtocol: CanonSyncProtocol;
  readonly worldDriver: WorldDriver;
  readonly coordinator: RuntimeCoordinator;
}

export interface BridgeLayerDescription {
  readonly layer: 'bridge';
  readonly protocols: readonly string[];
  readonly coordinator: RuntimeCoordinatorDescription;
  readonly roleMask: ReturnType<RoleMask['describe']>;
  readonly worldDriverTickCount: number;
}

export class BridgeLayer {
  private readonly roleMask: RoleMask;
  private readonly canonSync: CanonSyncProtocol;
  private readonly driver: WorldDriver;
  private readonly director: RuntimeCoordinator;

  constructor(options: BridgeLayerOptions) {
    this.roleMask = requirePresent(options?.roleMaskProtocol, 'role_mask_protocol');
    this.canonSync = requirePresent(options?.canonSyncProtocol, 'canon_sync_protocol');
    this.driver = requirePresent(options?.worldDriver, 'world_driver');
    this.director = requirePresent(options?.coordinator, 'coordinator');
  }

  get roleMaskProtocol(): RoleMask {
    return this.roleMask;
  }

  get canonSyncProtocol(): CanonSyncProtocol {
    return this.canonSync;
  }

  get worldDriver(): WorldDriver {
    return this.driver;
  }

  get coordinator(): RuntimeCoordinator {
    return this.director;
  }

  describe(): BridgeLayerDescription {
    return {
      layer: 'bridge',
      protocols: ['role_mask', 'canon_sync', 'world_driver'],
      coordinator: this.director.describe(),
      roleMask: this.roleMask.describe(),
      worldDriverTickCount: this.driver.tickCount,
    };
  }
}

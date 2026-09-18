/**
 * Role Mask Protocol (F093 bridge protocol 1) — five-layer categorisation.
 *
 * Splits a Forgekin's "role play" into five independently loadable layers so
 * that scene skin cannot pollute本体 capability (CL-011):
 *
 *   - **L1 Routing**        which agent takes the task
 *   - **L2 Infrastructure** which tools are used
 *   - **L3 Ontology**       the agent's inherent capability
 *   - **L4 Scene Skin**     the role-played character
 *   - **L5 World State**    the character's current in-world state
 *
 * When a Forgekin plays 孙悟空, L4 must not contaminate L3 — a writing Forgekin
 * does not forget it knows how to write. Leaving a scene takes off L4/L5 and
 * keeps L1-L3.
 *
 * Ported from `role_mask.py` (CL-011 / CL-012).
 */

import { WorldEngineValidationError } from '../errors.js';
import { requireNonEmpty } from '../validation.js';

export const ROLE_MASK_LAYERS = [1, 2, 3, 4, 5] as const;
export type RoleMaskLayer = (typeof ROLE_MASK_LAYERS)[number];

/** Scene-related layers, taken off when leaving a scene. */
export const SCENE_LAYERS: readonly RoleMaskLayer[] = [4, 5];
/** Ontology-related layers, held long-term. */
export const ONTOLOGY_LAYERS: readonly RoleMaskLayer[] = [1, 2, 3];

const LAYER_NAMES: Readonly<Record<RoleMaskLayer, string>> = {
  1: '路由身份',
  2: '基础设施',
  3: '本体能力',
  4: '场景皮肤',
  5: '世界内状态',
};

/** Chinese name for a layer (used in logs / UI). */
export function roleMaskLayerName(layer: RoleMaskLayer): string {
  return LAYER_NAMES[layer];
}

/**
 * Runtime guard mirroring the source's `isinstance(layer, RoleMaskLayer)`
 * check — the type system covers callers in TS, this covers untyped data.
 */
export function assertRoleMaskLayer(layer: unknown): RoleMaskLayer {
  if (typeof layer !== 'number' || !(ROLE_MASK_LAYERS as readonly number[]).includes(layer)) {
    throw new WorldEngineValidationError(
      `layer must be one of ${ROLE_MASK_LAYERS.join(', ')}; got ${String(layer)}`,
    );
  }
  return layer as RoleMaskLayer;
}

export type RoleMaskContent = Readonly<Record<string, unknown>>;

/** Description payload for logs / debugging. */
export interface RoleMaskDescription {
  readonly forgekinId: string;
  readonly activeLayers: readonly RoleMaskLayer[];
  readonly layerCount: number;
  readonly hasSceneSkin: boolean;
}

export class RoleMask {
  private readonly ownerId: string;
  private readonly layers = new Map<RoleMaskLayer, RoleMaskContent>();

  constructor(forgekinId: string) {
    this.ownerId = requireNonEmpty(forgekinId, 'forgekin_id', 'RoleMask');
  }

  get forgekinId(): string {
    return this.ownerId;
  }

  /** Wear a mask on one layer; an existing mask on that layer is replaced. */
  wear(layer: RoleMaskLayer, mask: Record<string, unknown>): void {
    this.layers.set(assertRoleMaskLayer(layer), Object.freeze({ ...mask }));
  }

  /** Take off one layer; `undefined` when nothing was worn. */
  takeOff(layer: RoleMaskLayer): RoleMaskContent | undefined {
    const key = assertRoleMaskLayer(layer);
    const mask = this.layers.get(key);
    if (mask === undefined) return undefined;
    this.layers.delete(key);
    return mask;
  }

  /**
   * Take off every scene layer (L4/L5) — call this when leaving a scene.
   * Returns the taken masks, in L4 → L5 order (the source used a `frozenset`,
   * so its iteration order was unspecified).
   */
  takeOffSceneLayers(): Partial<Record<RoleMaskLayer, RoleMaskContent>> {
    const taken: Partial<Record<RoleMaskLayer, RoleMaskContent>> = {};
    for (const layer of SCENE_LAYERS) {
      const mask = this.layers.get(layer);
      if (mask !== undefined) {
        taken[layer] = mask;
        this.layers.delete(layer);
      }
    }
    return taken;
  }

  /** Currently worn layers → mask content (copies). */
  getActiveMask(): Readonly<Record<RoleMaskLayer, RoleMaskContent | undefined>> {
    const active: Partial<Record<RoleMaskLayer, RoleMaskContent>> = {};
    for (const layer of ROLE_MASK_LAYERS) {
      const mask = this.layers.get(layer);
      if (mask !== undefined) active[layer] = mask;
    }
    return Object.freeze(active as Record<RoleMaskLayer, RoleMaskContent | undefined>);
  }

  /** Content of one layer without taking it off. */
  getLayer(layer: RoleMaskLayer): RoleMaskContent | undefined {
    return this.layers.get(assertRoleMaskLayer(layer));
  }

  isWearing(layer: RoleMaskLayer): boolean {
    return this.layers.has(assertRoleMaskLayer(layer));
  }

  describe(): RoleMaskDescription {
    return {
      forgekinId: this.ownerId,
      activeLayers: [...this.layers.keys()].sort((left, right) => left - right),
      layerCount: this.layers.size,
      hasSceneSkin: this.layers.has(4),
    };
  }
}

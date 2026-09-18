/**
 * World Driver Protocol (F093 bridge protocol 3) — the world turns by itself.
 *
 * NPCs grow, relationships shift and scenes advance on their own; the world is
 * not merely reactive to agent interaction (CL-013). A driver instance is the
 * single owner of one virtual world's state (CL-021).
 *
 * Canon writes stay behind the gate: `canWriteCanon` only answers the
 * permission question — the driver never writes canon itself. World events it
 * produces wait in a pending queue until the Canon Sync Protocol confirms them.
 *
 * Ported from `driver.py` (CL-013 / CL-021).
 */

import { isoNow, type Clock } from '../clock.js';
import type { CanonMemoryPort } from '../ports/canon-memory.js';
import { requirePresent } from '../validation.js';
import { CANON_WRITERS } from '../citizens.js';
import type { WorldLayer } from '../world-layer.js';

const CANON_WRITER_SET: ReadonlySet<string> = new Set(CANON_WRITERS);

/** One self-rotation event produced by {@link WorldDriver.tick}. */
export interface WorldRotationEvent {
  readonly tick: number;
  readonly worldId: string;
  readonly timestamp: string;
  readonly type: 'world_rotation';
  readonly summary: string;
}

/** Snapshot returned by {@link WorldDriver.getWorldState}. */
export interface WorldDriverState {
  readonly world: WorldLayer['world'];
  readonly tickCount: number;
  readonly lastTickAt: string | null;
  readonly pendingEvents: number;
  readonly canonWriters: readonly string[];
  readonly state: ReturnType<WorldLayer['describe']>;
}

export interface WorldDriverOptions {
  readonly world: WorldLayer;
  readonly canonMemory: CanonMemoryPort;
  readonly clock?: Clock;
}

export class WorldDriver {
  private readonly worldLayer: WorldLayer;
  private readonly clock: Clock | undefined;
  private ticks = 0;
  private lastTickAt: string | null = null;
  private readonly pendingEvents: WorldRotationEvent[] = [];

  constructor(options: WorldDriverOptions) {
    this.worldLayer = requirePresent(options?.world, 'world');
    // Canon memory is not held: the driver only answers permission questions and
    // queues its own events. The option is validated so misconfigured wiring
    // fails at construction (the source stored it for a future write path).
    requirePresent(options?.canonMemory, 'canon_memory');
    this.clock = options.clock;
  }

  get world(): WorldLayer {
    return this.worldLayer;
  }

  get tickCount(): number {
    return this.ticks;
  }

  /**
   * Rotate the world one tick.
   *
   * The ported skeleton emits one `world_rotation` event and queues it. A host
   * implementation is expected to advance world time, produce richer events and
   * hand high-value ones to the Canon Sync Protocol.
   */
  async tick(): Promise<readonly WorldRotationEvent[]> {
    this.ticks += 1;
    this.lastTickAt = isoNow(this.clock);
    const event: WorldRotationEvent = Object.freeze({
      tick: this.ticks,
      worldId: this.worldLayer.worldId,
      timestamp: this.lastTickAt,
      type: 'world_rotation',
      summary: `世界 ${this.worldLayer.worldId} 自转第 ${this.ticks} tick`,
    });
    this.pendingEvents.push(event);
    return [event];
  }

  /** Current world state snapshot. */
  async getWorldState(): Promise<WorldDriverState> {
    return {
      world: this.worldLayer.world,
      tickCount: this.ticks,
      lastTickAt: this.lastTickAt,
      pendingEvents: this.pendingEvents.length,
      canonWriters: [...CANON_WRITERS],
      state: this.worldLayer.describe(),
    };
  }

  /**
   * Whether `actor` may write canon directly (CL-010 / CL-021). The driver's own
   * events are not exempt — they still need an authorised confirmer.
   */
  canWriteCanon(actor: string): boolean {
    return CANON_WRITER_SET.has(actor);
  }

  /** Pending (not yet confirmed) world events. */
  getPendingEvents(): readonly WorldRotationEvent[] {
    return [...this.pendingEvents];
  }

  /** Drop the pending queue once the events have been handled. */
  clearPendingEvents(): void {
    this.pendingEvents.length = 0;
  }
}

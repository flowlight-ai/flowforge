import { describe, expect, it, vi } from 'vitest';

import { CanonSyncProtocol, CANON_CONFIRMERS } from '../src/bridge/canon-sync.js';
import { BridgeLayer } from '../src/bridge/bridge-layer.js';
import { RoleMask, ROLE_MASK_LAYERS, roleMaskLayerName } from '../src/bridge/role-mask.js';
import { RuntimeCoordinator } from '../src/bridge/runtime-coordinator.js';
import { WorldDriver } from '../src/bridge/world-driver.js';
import { InMemoryCanonMemory } from '../src/canon-memory.js';
import {
  createCharacter,
  createRound,
  createScene,
  createTurn,
  createWorld,
} from '../src/citizens.js';
import { createCoreIdentity } from '../src/core-identity.js';
import {
  WorldEngineOwnershipError,
  WorldEngineStateError,
  WorldEngineValidationError,
} from '../src/errors.js';
import { InMemoryRelationalMemory } from '../src/relational-memory.js';
import { InMemorySessionMemory } from '../src/session-memory.js';
import { WorldLayer } from '../src/world-layer.js';
import type { Clock } from '../src/clock.js';

const clock: Clock = { now: () => '2026-09-17T00:00:00.000Z' };
const FORGEKIN_ID = 'forgemind:writer_cat';

function buildWorld(): WorldLayer {
  return new WorldLayer({
    world: createWorld({ worldId: 'w1', name: '西游记', setting: '取经' }),
    canonMemory: new InMemoryCanonMemory(),
    relationalMemory: new InMemoryRelationalMemory({ clock }),
    sessionMemory: new InMemorySessionMemory(),
  });
}

describe('RoleMask five layers (CL-011)', () => {
  it('wears and takes off layers independently', () => {
    const mask = new RoleMask(FORGEKIN_ID);
    mask.wear(3, { capability: '写作' });
    mask.wear(4, { character: '孙悟空' });

    expect(mask.isWearing(3)).toBe(true);
    expect(mask.isWearing(4)).toBe(true);
    expect(mask.takeOff(4)).toEqual({ character: '孙悟空' });
    expect(mask.isWearing(4)).toBe(false);
    // taking off L4 leaves the ontology layer intact
    expect(mask.isWearing(3)).toBe(true);
    expect(mask.takeOff(4)).toBeUndefined();
  });

  it('takes off scene layers only, in deterministic order', () => {
    const mask = new RoleMask(FORGEKIN_ID);
    mask.wear(1, { agent: 'writer' });
    mask.wear(2, { tool: 'web_search' });
    mask.wear(3, { capability: '写作' });
    mask.wear(4, { character: '孙悟空' });
    mask.wear(5, { state: '压在五行山下' });

    const taken = mask.takeOffSceneLayers();
    expect(Object.keys(taken)).toEqual(['4', '5']);
    expect(mask.getActiveMask()).toMatchObject({ 1: { agent: 'writer' }, 2: { tool: 'web_search' }, 3: { capability: '写作' } });
    expect(mask.isWearing(4)).toBe(false);
    expect(mask.isWearing(5)).toBe(false);
  });

  it('validates the owner and layer values', () => {
    expect(() => new RoleMask('  ')).toThrow(WorldEngineValidationError);
    const mask = new RoleMask(FORGEKIN_ID);
    expect(() => mask.wear(9 as never, {})).toThrow(WorldEngineValidationError);
    expect(() => mask.isWearing(9 as never)).toThrow(WorldEngineValidationError);
    expect(ROLE_MASK_LAYERS).toHaveLength(5);
    expect(roleMaskLayerName(3)).toBe('本体能力');
    expect(roleMaskLayerName(4)).toBe('场景皮肤');
  });

  it('describes worn layers', () => {
    const mask = new RoleMask(FORGEKIN_ID);
    mask.wear(4, { character: '孙悟空' });
    expect(mask.describe()).toEqual({
      forgekinId: FORGEKIN_ID,
      activeLayers: [4],
      layerCount: 1,
      hasSceneSkin: true,
    });
  });
});

describe('CanonSyncProtocol (CL-010)', () => {
  function build() {
    const canon = new InMemoryCanonMemory();
    const session = new InMemorySessionMemory();
    let counter = 0;
    const protocol = new CanonSyncProtocol({
      canonMemory: canon,
      sessionMemory: session,
      worldId: 'w1',
      clock,
      generateId: () => `proposal-${(counter += 1)}`,
    });
    return { canon, session, protocol };
  }

  it('never writes canon from a proposal alone', async () => {
    const { canon, protocol } = build();
    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '我是齐天大圣' });
    const proposalId = await protocol.proposeCanon(turn, 'forgemind:writer_cat');
    expect(proposalId).toBe('proposal-1');
    expect(await canon.read('w1')).toEqual([]);
    expect((await protocol.getProposal(proposalId))?.status).toBe('pending');
  });

  it('rejects proposing an already-canon turn or a blank proposer', async () => {
    const { protocol } = build();
    const canonTurn = createTurn({
      turnId: 't1',
      roundId: 'r1',
      characterId: 'c1',
      content: 'x',
      isCanon: true,
    });
    await expect(protocol.proposeCanon(canonTurn, 'operator')).rejects.toThrow(WorldEngineStateError);
    const fresh = createTurn({ turnId: 't2', roundId: 'r1', characterId: 'c1', content: 'x' });
    await expect(protocol.proposeCanon(fresh, '   ')).rejects.toThrow(WorldEngineValidationError);
  });

  it('requires an authorised confirmer before canon is written', async () => {
    const { canon, session, protocol } = build();
    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '我是齐天大圣' });
    await session.addTurn(turn);
    const proposalId = await protocol.proposeCanon(turn, FORGEKIN_ID);

    expect(await protocol.confirmCanon(proposalId, 'forgekin:writer_cat')).toBe(false);
    expect(await canon.read('w1')).toHaveLength(0);

    expect(await protocol.confirmCanon(proposalId, 'operator')).toBe(true);
    expect(await canon.read('w1')).toHaveLength(1);
    expect(await canon.read('w1').then((entries) => entries[0]?.decisionId)).toBe('canon-t1');
    // the session copy is flagged, and the proposal closes
    expect((await session.getTurns('r1'))[0]?.isCanon).toBe(true);
    expect((await protocol.getProposal(proposalId))?.status).toBe('confirmed');
  });

  it('is idempotent on re-confirm and unknown proposals', async () => {
    const { protocol } = build();
    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: 'x' });
    const proposalId = await protocol.proposeCanon(turn, FORGEKIN_ID);
    expect(await protocol.confirmCanon('missing', 'operator')).toBe(false);
    expect(await protocol.confirmCanon(proposalId, 'canon_driver')).toBe(true);
    expect(await protocol.confirmCanon(proposalId, 'operator')).toBe(false);
  });

  it('lets anyone reject, with a mandatory reason', async () => {
    const { protocol } = build();
    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: 'x' });
    const proposalId = await protocol.proposeCanon(turn, FORGEKIN_ID);

    await expect(protocol.rejectCanon(proposalId, 'operator', '   ')).rejects.toThrow(
      WorldEngineValidationError,
    );
    expect(await protocol.rejectCanon('missing', 'operator', 'nope')).toBe(false);
    expect(await protocol.rejectCanon(proposalId, 'forgemind:writer_cat', 'RP 台词不入典')).toBe(true);

    const snapshot = await protocol.getProposal(proposalId);
    expect(snapshot).toMatchObject({
      proposalId,
      turnId: 't1',
      proposer: FORGEKIN_ID,
      status: 'rejected',
      rejecter: 'forgemind:writer_cat',
      rejectReason: 'RP 台词不入典',
      createdAt: '2026-09-17T00:00:00.000Z',
    });
    expect(await protocol.getProposal('missing')).toBeUndefined();
    expect(protocol.canonConfirmers()).toEqual(['operator', 'canon_driver']);
    expect(CANON_CONFIRMERS).toHaveLength(2);
  });

  it('falls back to the world-of-round placeholder without an explicit worldId', async () => {
    const canon = new InMemoryCanonMemory();
    const protocol = new CanonSyncProtocol({ canonMemory: canon, clock });
    const turn = createTurn({ turnId: 't9', roundId: 'r9', characterId: 'c1', content: 'x' });
    const proposalId = await protocol.proposeCanon(turn, FORGEKIN_ID);
    await protocol.confirmCanon(proposalId, 'operator');
    expect(await canon.read('world-of-r9')).toHaveLength(1);
  });
});

describe('WorldDriver (CL-013 / CL-021)', () => {
  function build() {
    const world = buildWorld();
    return { world, driver: new WorldDriver({ world, canonMemory: world.canonMemory, clock }) };
  }

  it('rotates the world and queues events', async () => {
    const { driver } = build();
    expect(driver.tickCount).toBe(0);

    const first = await driver.tick();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      tick: 1,
      worldId: 'w1',
      timestamp: '2026-09-17T00:00:00.000Z',
      type: 'world_rotation',
    });
    await driver.tick();
    expect(driver.tickCount).toBe(2);
    expect(driver.getPendingEvents()).toHaveLength(2);

    driver.clearPendingEvents();
    expect(driver.getPendingEvents()).toEqual([]);
  });

  it('reports world state and canon write permissions', async () => {
    const { driver } = build();
    await driver.tick();
    const state = await driver.getWorldState();
    expect(state).toMatchObject({ tickCount: 1, lastTickAt: '2026-09-17T00:00:00.000Z', pendingEvents: 1 });
    expect(state.canonWriters).toEqual(['operator', 'canon_driver', 'council']);
    expect(state.state.layer).toBe('world');

    expect(driver.canWriteCanon('operator')).toBe(true);
    expect(driver.canWriteCanon('canon_driver')).toBe(true);
    expect(driver.canWriteCanon('council')).toBe(true);
    expect(driver.canWriteCanon('forgemind:writer_cat')).toBe(false);
  });

  it('rejects missing dependencies', () => {
    const world = buildWorld();
    expect(() => new WorldDriver({ world, canonMemory: undefined as never })).toThrow(
      WorldEngineValidationError,
    );
  });
});

describe('RuntimeCoordinator (CL-012)', () => {
  function build() {
    const world = buildWorld();
    const canon = world.canonMemory as InMemoryCanonMemory;
    const session = world.sessionMemory as InMemorySessionMemory;
    const protocol = new CanonSyncProtocol({ canonMemory: canon, sessionMemory: session, worldId: 'w1', clock });
    const identity = createCoreIdentity({
      forgekinId: FORGEKIN_ID,
      name: '写作猫',
      species: 'bio',
      birthTimestamp: '2026-01-01T00:00:00.000Z',
      soulImprintHash: 'h1',
    });
    const coordinator = new RuntimeCoordinator({ coreIdentity: identity, world, canonProposer: protocol });
    const driver = new WorldDriver({ world, canonMemory: canon, clock });
    const bridge = new BridgeLayer({
      roleMaskProtocol: new RoleMask(FORGEKIN_ID),
      canonSyncProtocol: protocol,
      worldDriver: driver,
      coordinator,
    });
    return { world, canon, session, protocol, identity, coordinator, driver, bridge };
  }

  const scene = () => createScene({ sceneId: 's1', worldId: 'w1', location: '花果山', time: '秋' });

  it('refuses scenes from another world and masks held by another forgekin', async () => {
    const { coordinator } = build();
    await expect(coordinator.enterScene({ ...scene(), worldId: 'w2' }, new RoleMask(FORGEKIN_ID))).rejects.toThrow(
      WorldEngineOwnershipError,
    );
    await expect(coordinator.enterScene(scene(), new RoleMask('forgemind:other_cat'))).rejects.toThrow(
      /不一致/,
    );
    expect(coordinator.isInScene).toBe(false);
  });

  it('refuses a second scene without leaving the first', async () => {
    const { coordinator } = build();
    await coordinator.enterScene(scene(), new RoleMask(FORGEKIN_ID));
    await expect(coordinator.enterScene(scene(), new RoleMask(FORGEKIN_ID))).rejects.toThrow(
      WorldEngineStateError,
    );
  });

  it('requires an active scene for exit and canon proposals', async () => {
    const { coordinator } = build();
    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: 'x' });
    await expect(coordinator.exitScene()).rejects.toThrow(WorldEngineStateError);
    await expect(coordinator.proposeCanon(turn)).rejects.toThrow(WorldEngineStateError);
  });

  it('runs the full enter → propose → exit loop and takes off scene layers', async () => {
    const { coordinator, canon, session, world } = build();
    const mask = new RoleMask(FORGEKIN_ID);
    mask.wear(1, { agent: 'writer' });
    mask.wear(3, { capability: '写作' });
    mask.wear(4, { character: '孙悟空' });

    await coordinator.enterScene(scene(), mask);
    expect(coordinator.isInScene).toBe(true);
    world.registerCharacter(createCharacter({ characterId: 'c1', name: '孙悟空', role: '主角', worldId: 'w1' }));
    world.registerRound(createRound({ roundId: 'r1', sceneId: 's1', sequence: 0 }));

    const turn = createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '俺老孙来也' });
    await session.addTurn(turn);
    const proposalId = await coordinator.proposeCanon(turn);
    // the proposal exists but canon is still empty: the gate held (CL-010)
    expect(await canon.read('w1')).toEqual([]);
    expect(await session.getTurns('r1')).toHaveLength(1);

    const taken = await coordinator.exitScene();
    expect(Object.keys(taken)).toEqual(['4']);
    expect(mask.isWearing(1)).toBe(true);
    expect(mask.isWearing(3)).toBe(true);
    expect(mask.isWearing(4)).toBe(false);
    expect(coordinator.isInScene).toBe(false);
    expect(proposalId).toBeTruthy();
  });

  it('describes its state', async () => {
    const { coordinator } = build();
    expect(coordinator.describe()).toMatchObject({
      forgekinId: FORGEKIN_ID,
      worldId: 'w1',
      isInScene: false,
      currentSceneId: null,
      roleMaskActive: false,
      roleMaskLayers: [],
    });
  });
});

describe('BridgeLayer (CL-012)', () => {
  it('aggregates the three protocols and the coordinator', () => {
    const world = buildWorld();
    const canon = world.canonMemory as InMemoryCanonMemory;
    const protocol = new CanonSyncProtocol({ canonMemory: canon, worldId: 'w1', clock });
    const mask = new RoleMask(FORGEKIN_ID);
    const driver = new WorldDriver({ world, canonMemory: canon, clock });
    const coordinator = new RuntimeCoordinator({
      coreIdentity: createCoreIdentity({
        forgekinId: FORGEKIN_ID,
        name: '写作猫',
        species: 'bio',
        birthTimestamp: '2026-01-01T00:00:00.000Z',
        soulImprintHash: 'h1',
      }),
      world,
      canonProposer: protocol,
    });
    const bridge = new BridgeLayer({
      roleMaskProtocol: mask,
      canonSyncProtocol: protocol,
      worldDriver: driver,
      coordinator,
    });

    expect(bridge.roleMaskProtocol).toBe(mask);
    expect(bridge.canonSyncProtocol).toBe(protocol);
    expect(bridge.worldDriver).toBe(driver);
    expect(bridge.coordinator).toBe(coordinator);
    expect(bridge.describe()).toMatchObject({
      layer: 'bridge',
      protocols: ['role_mask', 'canon_sync', 'world_driver'],
      worldDriverTickCount: 0,
    });
  });

  it('rejects missing protocols', () => {
    const loggerSpy = vi.fn();
    expect(loggerSpy).not.toHaveBeenCalled();
    expect(
      () =>
        new BridgeLayer({
          roleMaskProtocol: undefined as never,
          canonSyncProtocol: undefined as never,
          worldDriver: undefined as never,
          coordinator: undefined as never,
        }),
    ).toThrow(WorldEngineValidationError);
  });
});

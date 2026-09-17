import { describe, expect, it } from 'vitest';

import { InMemoryCanonMemory } from '../src/canon-memory.js';
import {
  createArtifact,
  createBranch,
  createCharacter,
  createRelationship,
  createRound,
  createScene,
  createTurn,
  createWorld,
} from '../src/citizens.js';
import { WorldEngineOwnershipError, WorldEngineValidationError } from '../src/errors.js';
import { InMemoryRelationalMemory } from '../src/relational-memory.js';
import { InMemorySessionMemory } from '../src/session-memory.js';
import { WorldLayer } from '../src/world-layer.js';
import type { Clock } from '../src/clock.js';

const clock: Clock = { now: () => '2026-09-17T00:00:00.000Z' };

function build(worldId = 'w1'): WorldLayer {
  return new WorldLayer({
    world: createWorld({ worldId, name: '西游记', setting: '取经' }),
    canonMemory: new InMemoryCanonMemory(),
    relationalMemory: new InMemoryRelationalMemory({ clock }),
    sessionMemory: new InMemorySessionMemory(),
  });
}

describe('WorldLayer construction', () => {
  it('rejects missing dependencies', () => {
    const world = createWorld({ worldId: 'w1', name: 'n', setting: 's' });
    expect(
      () =>
        new WorldLayer({
          world,
          canonMemory: undefined as never,
          relationalMemory: new InMemoryRelationalMemory(),
          sessionMemory: new InMemorySessionMemory(),
        }),
    ).toThrow(WorldEngineValidationError);
  });

  it('exposes the world and its three memory tracks', () => {
    const layer = build();
    expect(layer.worldId).toBe('w1');
    expect(layer.world.name).toBe('西游记');
    expect(layer.canonMemory).toBeInstanceOf(InMemoryCanonMemory);
    expect(layer.sessionMemory).toBeInstanceOf(InMemorySessionMemory);
    expect(layer.relationalMemory).toBeInstanceOf(InMemoryRelationalMemory);
  });
});

describe('world isolation', () => {
  it('rejects characters, scenes and artifacts from another world', () => {
    const layer = build('w1');
    expect(() =>
      layer.registerCharacter(createCharacter({ characterId: 'c1', name: '孙悟空', role: '主角', worldId: 'w2' })),
    ).toThrow(WorldEngineOwnershipError);
    expect(() =>
      layer.registerScene(createScene({ sceneId: 's1', worldId: 'w2', location: 'x', time: 'y' })),
    ).toThrow(WorldEngineOwnershipError);
    expect(() =>
      layer.registerArtifact(createArtifact({ artifactId: 'a1', name: '金箍棒', worldId: 'w2' })),
    ).toThrow(WorldEngineOwnershipError);
  });

  it('keeps two layers of the same shape independent', () => {
    const first = build('w1');
    const second = build('w2');
    first.registerCharacter(createCharacter({ characterId: 'c1', name: '孙悟空', role: '主角', worldId: 'w1' }));
    expect(first.getCharacter('c1')).toBeDefined();
    expect(second.getCharacter('c1')).toBeUndefined();
  });
});

describe('entity registration', () => {
  it('registers citizens of the same world and returns copies', () => {
    const layer = build();
    layer.registerCharacter(createCharacter({ characterId: 'c1', name: '孙悟空', role: '主角', worldId: 'w1' }));
    layer.registerScene(createScene({ sceneId: 's1', worldId: 'w1', location: '花果山', time: '秋' }));
    layer.registerArtifact(createArtifact({ artifactId: 'a1', name: '金箍棒', worldId: 'w1' }));
    layer.registerRound(createRound({ roundId: 'r1', sceneId: 's1', sequence: 0 }));
    layer.registerBranch(createBranch({ branchId: 'b1', parentRoundId: 'r1', description: '分支' }));
    layer.registerRelationship(
      createRelationship({ relationshipId: 'rel1', characterA: 'c1', characterB: 'c2', relationType: '师徒' }),
    );

    const listed = layer.listCharacters() as ReturnType<typeof createCharacter>[];
    listed.push(createCharacter({ characterId: 'ghost', name: 'x', role: 'y', worldId: 'w1' }));
    expect(layer.listCharacters()).toHaveLength(1);

    expect(layer.describe()).toMatchObject({
      characterCount: 1,
      sceneCount: 1,
      artifactCount: 1,
      roundCount: 1,
      branchCount: 1,
      relationshipCount: 1,
      layer: 'world',
    });
  });
});

describe('CL-010 iron law at the world layer', () => {
  it('never auto-promotes a turn into canon', async () => {
    const layer = build();
    await layer.addTurn(
      createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '我是齐天大圣' }),
    );
    // The turn is visible in session memory...
    expect(await layer.sessionMemory.getTurns('r1')).toHaveLength(1);
    // ...but canon stays untouched: "RP 台词不自动入典".
    expect(await layer.canonMemory.read('w1')).toEqual([]);
  });

  it('keeps turns out of relational memory too (three-track isolation)', async () => {
    const layer = build();
    await layer.addTurn(createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '台词' }));
    expect(await layer.relationalMemory.queryRelationships('c1')).toEqual([]);
  });
});

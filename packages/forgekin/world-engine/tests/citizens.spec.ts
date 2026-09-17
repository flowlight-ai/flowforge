import { describe, expect, it } from 'vitest';

import {
  createArtifact,
  createBranch,
  createCanonDecision,
  createCharacter,
  createRelationship,
  createRound,
  createScene,
  createTurn,
  createWorld,
} from '../src/citizens.js';
import { createCoreIdentity, describeCoreIdentity, verifyImprint } from '../src/core-identity.js';
import { WorldEngineValidationError } from '../src/errors.js';
import { assertKnownKeys, requireNonEmpty, requireUnique } from '../src/validation.js';

describe('validation primitives', () => {
  it('rejects unknown keys like pydantic extra=forbid', () => {
    expect(() => assertKnownKeys({ a: 1, b: 2 }, ['a'], 'M')).toThrow(WorldEngineValidationError);
    expect(() => assertKnownKeys({ a: 1 }, ['a'], 'M')).not.toThrow();
  });

  it('rejects blank strings and trims the rest', () => {
    expect(() => requireNonEmpty('   ', 'name')).toThrow(WorldEngineValidationError);
    expect(() => requireNonEmpty(42, 'name')).toThrow(WorldEngineValidationError);
    expect(requireNonEmpty('  x ', 'name')).toBe('x');
  });

  it('rejects duplicate list items', () => {
    expect(() => requireUnique(['a', 'a'], 'corePersonality')).toThrow(WorldEngineValidationError);
    expect(requireUnique(['a', 'b'], 'corePersonality')).toEqual(['a', 'b']);
  });
});

describe('nine first-class citizens', () => {
  it('exposes exactly nine citizen factories', () => {
    const factories = [
      createWorld,
      createCharacter,
      createScene,
      createCanonDecision,
      createRelationship,
      createArtifact,
      createRound,
      createBranch,
      createTurn,
    ];
    expect(factories).toHaveLength(9);
  });

  it('validates World fields and defaults rules to an empty list', () => {
    const world = createWorld({ worldId: 'w1', name: '西游记', setting: '取经' });
    expect(world.rules).toEqual([]);
    expect(createWorld({ worldId: 'w1', name: '西游记', setting: '取经', rules: ['因果不灭'] }).rules).toEqual([
      '因果不灭',
    ]);
    expect(() => createWorld({ worldId: '  ', name: 'x', setting: 's' })).toThrow(WorldEngineValidationError);
    expect(() => createWorld({ worldId: 'w1', name: '', setting: 's' })).toThrow(WorldEngineValidationError);
    expect(() =>
      createWorld({ worldId: 'w1', name: 'n', setting: 's', extra: 1 } as never),
    ).toThrow(/unknown field/);
  });

  it('restricts CanonDecision.decidedBy to the whitelist', () => {
    const base = { decisionId: 'd1', worldId: 'w1', decision: 'x', timestamp: '2026-01-01T00:00:00.000Z' };
    expect(createCanonDecision({ ...base, decidedBy: 'operator' }).decidedBy).toBe('operator');
    expect(createCanonDecision({ ...base, decidedBy: 'canon_driver' }).decidedBy).toBe('canon_driver');
    expect(createCanonDecision({ ...base, decidedBy: 'council' }).decidedBy).toBe('council');
    expect(() => createCanonDecision({ ...base, decidedBy: 'forgekin:writer' })).toThrow(
      WorldEngineValidationError,
    );
  });

  it('defaults Turn.isCanon to false (CL-010)', () => {
    const turn = createTurn({
      turnId: 't1',
      roundId: 'r1',
      characterId: 'c1',
      content: '我是齐天大圣',
    });
    expect(turn.isCanon).toBe(false);
    expect(createTurn({ turnId: 't2', roundId: 'r1', characterId: 'c1', content: 'x', isCanon: true }).isCanon).toBe(
      true,
    );
    expect(() =>
      createTurn({ turnId: 't3', roundId: 'r1', characterId: 'c1', content: 'x', isCanon: 'yes' } as never),
    ).toThrow(WorldEngineValidationError);
  });

  it('enforces Round.sequence >= 0', () => {
    expect(createRound({ roundId: 'r1', sceneId: 's1', sequence: 0 }).sequence).toBe(0);
    expect(() => createRound({ roundId: 'r1', sceneId: 's1', sequence: -1 })).toThrow(
      WorldEngineValidationError,
    );
    expect(() => createRound({ roundId: 'r1', sceneId: 's1', sequence: 1.5 })).toThrow(
      WorldEngineValidationError,
    );
  });

  it('defaults Artifact.properties to an empty dict and freezes entities', () => {
    const artifact = createArtifact({ artifactId: 'a1', name: '金箍棒', worldId: 'w1' });
    expect(artifact.properties).toEqual({});
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(createArtifact({ artifactId: 'a1', name: 'x', worldId: 'w1', properties: { weight: 13500 } }).properties).toEqual(
      { weight: 13500 },
    );
    expect(() =>
      createArtifact({ artifactId: 'a1', name: 'x', worldId: 'w1', properties: [] as never }),
    ).toThrow(WorldEngineValidationError);
  });

  it('constructs the remaining citizens', () => {
    expect(createCharacter({ characterId: 'c1', name: '孙悟空', role: '主角', worldId: 'w1' }).role).toBe('主角');
    expect(createScene({ sceneId: 's1', worldId: 'w1', location: '花果山', time: '贞观十三年秋' }).location).toBe(
      '花果山',
    );
    expect(
      createRelationship({ relationshipId: 'rel1', characterA: 'c1', characterB: 'c2', relationType: '师徒' })
        .relationType,
    ).toBe('师徒');
    expect(createBranch({ branchId: 'b1', parentRoundId: 'r1', description: '分支一' }).parentRoundId).toBe('r1');
  });
});

describe('core identity layer (CL-007)', () => {
  const input = {
    forgekinId: 'forgemind:writer_cat',
    name: '写作猫',
    species: 'bio',
    birthTimestamp: '2026-01-01T00:00:00.000Z',
    corePersonality: ['沉稳', '好奇'],
    valueAnchors: ['诚实'],
    soulImprintHash: 'imprint-hash-1',
  };

  it('is frozen at runtime and cannot be polluted', () => {
    const identity = createCoreIdentity(input);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(() => {
      (identity as unknown as Record<string, unknown>)['name'] = '孙悟空';
    }).toThrow(TypeError);
    expect(identity.name).toBe('写作猫');
  });

  it('validates required fields and list uniqueness', () => {
    expect(() => createCoreIdentity({ ...input, forgekinId: ' ' })).toThrow(WorldEngineValidationError);
    expect(() => createCoreIdentity({ ...input, species: '' })).toThrow(WorldEngineValidationError);
    expect(() => createCoreIdentity({ ...input, soulImprintHash: '' })).toThrow(WorldEngineValidationError);
    expect(() => createCoreIdentity({ ...input, corePersonality: ['a', 'a'] })).toThrow(
      WorldEngineValidationError,
    );
    expect(() => createCoreIdentity({ ...input, valueAnchors: ['x', 'x'] })).toThrow(
      WorldEngineValidationError,
    );
    expect(() => createCoreIdentity({ ...input, rogue: 1 } as never)).toThrow(/unknown field/);
  });

  it('describes itself with the layer and immutability markers', () => {
    const description = describeCoreIdentity(createCoreIdentity(input));
    expect(description.layer).toBe('core_identity');
    expect(description.immutable).toBe(true);
    expect(description.corePersonality).toEqual(['沉稳', '好奇']);
  });

  it('verifies soul imprints both ways', () => {
    const identity = createCoreIdentity(input);
    expect(verifyImprint(identity, 'imprint-hash-1')).toBe(true);
    expect(verifyImprint(identity, 'imprint-hash-2')).toBe(false);
  });
});

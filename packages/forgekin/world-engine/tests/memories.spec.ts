import { describe, expect, it } from 'vitest';

import { InMemoryCanonMemory, canonWriters } from '../src/canon-memory.js';
import { createCanonDecision, createRelationship, createTurn } from '../src/citizens.js';
import { InMemoryRelationalMemory } from '../src/relational-memory.js';
import { InMemorySessionMemory } from '../src/session-memory.js';
import type { Clock } from '../src/clock.js';

const clock: Clock = { now: () => '2026-09-17T00:00:00.000Z' };

function decision(overrides: Partial<Parameters<typeof createCanonDecision>[0]> = {}) {
  return createCanonDecision({
    decisionId: 'd1',
    worldId: 'w1',
    decision: '世界规则：因果不灭',
    decidedBy: 'operator',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('canon memory (CL-010)', () => {
  it('refuses writes from actors outside the whitelist', async () => {
    const canon = new InMemoryCanonMemory();
    expect(await canon.write(decision(), 'forgekin:writer_cat')).toBe(false);
    expect(await canon.write(decision(), '')).toBe(false);
    expect(await canon.read('w1')).toEqual([]);
    expect(await canon.write(decision(), 'operator')).toBe(true);
    expect(await canon.read('w1')).toHaveLength(1);
  });

  it('refuses decisions whose author is itself unauthorised', async () => {
    const canon = new InMemoryCanonMemory();
    // Simulate a decision that bypassed the factory (e.g. loaded from storage).
    const forged = { ...decision(), decidedBy: 'forgekin:writer_cat' } as unknown as ReturnType<typeof decision>;
    expect(await canon.write(forged, 'operator')).toBe(false);
  });

  it('is idempotent per decision id', async () => {
    const canon = new InMemoryCanonMemory();
    expect(await canon.write(decision(), 'operator')).toBe(true);
    expect(await canon.write(decision(), 'canon_driver')).toBe(true);
    expect(await canon.read('w1')).toHaveLength(1);
  });

  it('orders reads by timestamp and keeps worlds separate', async () => {
    const canon = new InMemoryCanonMemory();
    await canon.write(decision({ decisionId: 'late', timestamp: '2026-03-01T00:00:00.000Z' }), 'operator');
    await canon.write(decision({ decisionId: 'early', timestamp: '2026-01-01T00:00:00.000Z' }), 'operator');
    await canon.write(decision({ decisionId: 'other', worldId: 'w2' }), 'operator');
    expect((await canon.read('w1')).map((entry) => entry.decisionId)).toEqual(['early', 'late']);
    expect(await canon.read('w2')).toHaveLength(1);
  });

  it('filters by decidedBy and by worldId', async () => {
    const canon = new InMemoryCanonMemory();
    await canon.write(decision({ decisionId: 'd1', decidedBy: 'operator' }), 'operator');
    await canon.write(
      decision({ decisionId: 'd2', decidedBy: 'council', timestamp: '2026-02-01T00:00:00.000Z' }),
      'council',
    );
    expect((await canon.query('w1')).length).toBe(2);
    expect((await canon.query('w1', { decidedBy: 'council' })).map((entry) => entry.decisionId)).toEqual(['d2']);
    expect((await canon.query('w1', { worldId: 'w1' })).length).toBe(2);
    expect((await canon.query('w1', { worldId: 'w9' })).length).toBe(0);
  });

  it('reports write permission', () => {
    const canon = new InMemoryCanonMemory();
    expect(canon.canWrite('operator')).toBe(true);
    expect(canon.canWrite('canon_driver')).toBe(true);
    expect(canon.canWrite('council')).toBe(true);
    expect(canon.canWrite('forgekin:writer_cat')).toBe(false);
    expect(canonWriters()).toEqual(['operator', 'canon_driver', 'council']);
  });
});

describe('relational memory', () => {
  const bond = () => createRelationship({ relationshipId: 'rel1', characterA: 'c1', characterB: 'c2', relationType: '朋友' });

  it('auto-registers a relationship on first interaction and timestamps entries', async () => {
    const relational = new InMemoryRelationalMemory({ clock });
    await relational.recordInteraction(bond(), { type: '对话', summary: '初次相遇' });
    expect(await relational.queryRelationships('c1')).toHaveLength(1);
    const history = await relational.getInteractionHistory('rel1');
    expect(history).toHaveLength(1);
    expect(history[0]?.timestamp).toBe('2026-09-17T00:00:00.000Z');
  });

  it('keeps an explicit timestamp when the caller supplies one', async () => {
    const relational = new InMemoryRelationalMemory({ clock });
    await relational.recordInteraction(bond(), { timestamp: '2020-01-01T00:00:00.000Z' });
    expect((await relational.getInteractionHistory('rel1'))[0]?.timestamp).toBe('2020-01-01T00:00:00.000Z');
  });

  it('queries relationships from either side', async () => {
    const relational = new InMemoryRelationalMemory({ clock });
    await relational.recordInteraction(bond(), {});
    expect((await relational.queryRelationships('c2')).map((rel) => rel.relationshipId)).toEqual(['rel1']);
    expect(await relational.queryRelationships('c3')).toEqual([]);
  });

  it('evolves a relationship type and reports unknown ids', async () => {
    const relational = new InMemoryRelationalMemory({ clock });
    await relational.recordInteraction(bond(), {});
    expect(await relational.updateRelationship('rel1', '师徒')).toBe(true);
    expect((await relational.queryRelationships('c1'))[0]?.relationType).toBe('师徒');
    expect(await relational.updateRelationship('nope', '师徒')).toBe(false);
  });
});

describe('session memory', () => {
  function turn(overrides: Partial<Parameters<typeof createTurn>[0]> = {}) {
    return createTurn({ turnId: 't1', roundId: 'r1', characterId: 'c1', content: '台词', ...overrides });
  }

  it('buckets turns by round id and isolates sessions', async () => {
    const session = new InMemorySessionMemory();
    await session.addTurn(turn());
    await session.addTurn(turn({ turnId: 't2', roundId: 'r2' }));
    expect(await session.getTurns('r1')).toHaveLength(1);
    expect(await session.getSessionIds()).toEqual(['r1', 'r2']);
  });

  it('clears one session without touching the others', async () => {
    const session = new InMemorySessionMemory();
    await session.addTurn(turn());
    await session.addTurn(turn({ turnId: 't2', roundId: 'r2' }));
    await session.clearSession('r1');
    expect(await session.getTurns('r1')).toEqual([]);
    expect(await session.getTurns('r2')).toHaveLength(1);
  });

  it('marks a turn as canon in the session copy only, and reports the count', async () => {
    const session = new InMemorySessionMemory();
    await session.addTurn(turn());
    expect(await session.markTurnCanon('t1')).toBe(true);
    const dump = await session.dumpSession('r1');
    expect(dump.turnCount).toBe(1);
    expect(dump.canonCount).toBe(1);
    // the stored copy was rebuilt, never mutated in place
    expect(Object.isFrozen(dump.turns[0])).toBe(true);
    expect(await session.markTurnCanon('missing')).toBe(false);
  });

  it('reports an empty dump for an unknown session', async () => {
    const session = new InMemorySessionMemory();
    expect(await session.dumpSession('nope')).toEqual({
      sessionId: 'nope',
      turnCount: 0,
      canonCount: 0,
      turns: [],
    });
  });
});

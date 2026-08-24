/**
 * MemoryGovernance — F39 治理三要素契约验证。
 *
 * 移植自 `core/memory_federation/governance.py`（roleagent.md §4.4）：
 *   - 权威等级：基础分 + 可信来源加成，上限 1.0
 *   - 消费加权：log(1+count)/log(101) 归一化，行为信号而非自评
 *   - 衰减策略：半衰期指数衰减，幂等（重复调用不累积误差），返回新对象
 *
 * @module @flowforge/forgekin-stores/tests
 */

import { describe, expect, it } from 'vitest';
import { MemoryEntry } from '../src/collection.js';
import { MemoryGovernance } from '../src/governance.js';

describe('compute_authority（要素 1：权威等级）', () => {
  it('未验证来源 = authority_base（0.5）', async () => {
    const g = new MemoryGovernance();
    const entry = new MemoryEntry({ content: 'x', source: 'unknown-agent' });
    expect(await g.compute_authority(entry)).toBe(0.5);
  });

  it('可信来源 = 基础分 + 加成（0.5 + 0.2 = 0.7）', async () => {
    const g = new MemoryGovernance({
      verified_sources: ['claude-code-forgekin', 'spiritforge'],
    });
    const entry = new MemoryEntry({ content: 'x', source: 'spiritforge' });
    expect(await g.compute_authority(entry)).toBeCloseTo(0.7, 6);
  });

  it('权威上限 1.0（高加成不越界）', async () => {
    const g = new MemoryGovernance({
      authority_base: 0.9,
      authority_source_boost: 0.5,
      verified_sources: ['operator'],
    });
    const entry = new MemoryEntry({ content: 'x', source: 'operator' });
    expect(await g.compute_authority(entry)).toBe(1.0);
  });
});

describe('compute_weight（要素 2：消费加权）', () => {
  it('未消费权重为 0（log(1)/log(101) = 0）', async () => {
    const g = new MemoryGovernance();
    const entry = new MemoryEntry({ content: 'x', consumption_count: 0 });
    expect(await g.compute_weight(entry)).toBe(0);
  });

  it('消费 100 次归一化到 1.0', async () => {
    const g = new MemoryGovernance();
    const entry = new MemoryEntry({ content: 'x', consumption_count: 100 });
    expect(await g.compute_weight(entry)).toBeCloseTo(1.0, 6);
  });

  it('消费越多权重越高（单调性）', async () => {
    const g = new MemoryGovernance();
    const low = await g.compute_weight(new MemoryEntry({ content: 'x', consumption_count: 1 }));
    const mid = await g.compute_weight(new MemoryEntry({ content: 'x', consumption_count: 10 }));
    const high = await g.compute_weight(new MemoryEntry({ content: 'x', consumption_count: 50 }));
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });
});

describe('apply_decay（要素 3：衰减策略）', () => {
  it('未衰减返回新对象（authority 不变，不修改原对象）', async () => {
    const g = new MemoryGovernance();
    const entry = new MemoryEntry({
      content: 'x',
      authority_level: 0.8,
      last_accessed: new Date().toISOString(),
    });
    const decayed = await g.apply_decay(entry);
    expect(decayed).not.toBe(entry);
    expect(decayed.authority_level).toBeCloseTo(0.8, 6);
    expect(entry.authority_level).toBe(0.8);
  });

  it('半衰期衰减：30 天未访问权威减半', async () => {
    const g = new MemoryGovernance({ decay_half_life_days: 30 });
    const last_accessed = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const entry = new MemoryEntry({ content: 'x', authority_level: 0.8, last_accessed });
    const decayed = await g.apply_decay(entry);
    expect(decayed.authority_level).toBeCloseTo(0.4, 2);
  });

  it('衰减下限生效：久远记忆不低于 decay_min_score', async () => {
    const g = new MemoryGovernance({ decay_min_score: 0.1 });
    const last_accessed = new Date(Date.now() - 3650 * 86_400_000).toISOString();
    const entry = new MemoryEntry({ content: 'x', authority_level: 0.8, last_accessed });
    const decayed = await g.apply_decay(entry);
    expect(decayed.authority_level).toBe(0.1);
  });

  it('幂等性：重复调用结果一致（基于 last_accessed，不累积误差）', async () => {
    const g = new MemoryGovernance({ decay_half_life_days: 7 });
    const last_accessed = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const entry = new MemoryEntry({ content: 'x', authority_level: 0.6, last_accessed });

    const once = await g.apply_decay(entry);
    const twice = await g.apply_decay(entry);
    expect(twice.authority_level).toBeCloseTo(once.authority_level, 6);
  });

  it('非法时间戳回退到当前时间（不衰减，对齐 Python _parse_iso）', async () => {
    const g = new MemoryGovernance();
    const entry = new MemoryEntry({ content: 'x', authority_level: 0.9, last_accessed: 'not-a-date' });
    const decayed = await g.apply_decay(entry);
    expect(decayed.authority_level).toBeCloseTo(0.9, 6);
  });
});

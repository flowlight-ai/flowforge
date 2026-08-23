/**
 * models — Forgekin 通用数据模型契约验证（对齐 Python forgekin.py）。
 *
 * 覆盖：构造校验 / defaultForgekinId 格式 / 能力与盲点 / history /
 * canTakeTask / spendEnergy / recoverEnergy。
 *
 * @module @flowforge/forgekin-species/tests
 */

import { describe, expect, it } from 'vitest';
import {
  Forgekin,
  ForgekinError,
  ForgekinType,
  defaultForgekinId,
  makeBlindSpot,
  makeCapability,
  makeForgekinState,
} from '../src/models.js';

describe('defaultForgekinId', () => {
  it('fk- 前缀 + 12 位十六进制', () => {
    const id = defaultForgekinId();
    expect(id).toMatch(/^fk-[0-9a-f]{12}$/);
  });

  it('多次生成大概率不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => defaultForgekinId()));
    expect(ids.size).toBeGreaterThan(45);
  });
});

describe('Forgekin 构造', () => {
  it('name 为空抛 ForgekinError', () => {
    expect(() => new Forgekin({ name: '   ' })).toThrow(ForgekinError);
  });

  it('默认值：type=custom / vendor=flowforge / energy=1.0', () => {
    const fk = new Forgekin({ name: '鲁班' });
    expect(fk.forgekinType).toBe(ForgekinType.CUSTOM);
    expect(fk.vendor).toBe('flowforge');
    expect(fk.forgekinId).toMatch(/^fk-/);
    expect(fk.state.energy).toBe(1.0);
    expect(fk.state.mood).toBe('neutral');
  });
});

describe('能力 / 盲点 / 历史', () => {
  it('addCapability + hasCapability（默认阈值 0.5）', () => {
    const fk = new Forgekin({ name: '夏洛克' });
    fk.addCapability(makeCapability('coding', 0.9, ['PR#1']));
    fk.addCapability(makeCapability('design', 0.3));
    expect(fk.hasCapability('coding')).toBe(true);
    expect(fk.hasCapability('design')).toBe(false);
    expect(fk.hasCapability('design', 0.2)).toBe(true);
    expect(fk.hasCapability('unknown')).toBe(false);
  });

  it('addBlindSpot + makeBlindSpot 自动填充时间', () => {
    const fk = new Forgekin({ name: '梵高' });
    fk.addBlindSpot(makeBlindSpot('长期规划', 0.6, '委派给 council'));
    expect(fk.blindSpots).toHaveLength(1);
    expect(fk.blindSpots[0]?.discoveredAt).toBeTruthy();
  });

  it('recordHistory 自动补 timestamp，已有则保留', () => {
    const fk = new Forgekin({ name: '鲁班' });
    fk.recordHistory({ event: 'forged' });
    fk.recordHistory({ event: 'evolved', timestamp: '2026-01-01T00:00:00.000Z' });
    expect(fk.history).toHaveLength(2);
    expect(fk.history[0]?.['timestamp']).toBeTruthy();
    expect(fk.history[1]?.['timestamp']).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('canTakeTask / 能量', () => {
  it('缺失能力时返回缺失列表', () => {
    const fk = new Forgekin({ name: '鲁班' });
    fk.addCapability(makeCapability('coding', 0.9));
    const [ok, missing] = fk.canTakeTask(['coding', 'design']);
    expect(ok).toBe(false);
    expect(missing).toEqual(['design']);
  });

  it('能量耗尽拒绝承接', () => {
    const fk = new Forgekin({ name: '鲁班' });
    fk.addCapability(makeCapability('coding', 0.9));
    fk.spendEnergy(1.5);
    const [ok, missing] = fk.canTakeTask(['coding']);
    expect(ok).toBe(false);
    expect(missing).toEqual(['energy depleted']);
  });

  it('spendEnergy 负数抛错；下限 0 / 上限 1', () => {
    const fk = new Forgekin({ name: '鲁班' });
    expect(() => fk.spendEnergy(-1)).toThrow(ForgekinError);
    expect(() => fk.recoverEnergy(-1)).toThrow(ForgekinError);
    fk.spendEnergy(2.0);
    expect(fk.state.energy).toBe(0);
    fk.recoverEnergy(5.0);
    expect(fk.state.energy).toBe(1.0);
  });

  it('makeForgekinState 每次独立', () => {
    const a = makeForgekinState();
    const b = makeForgekinState();
    a.energy = 0.1;
    expect(b.energy).toBe(1.0);
  });
});

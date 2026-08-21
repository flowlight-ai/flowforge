/**
 * LimbAccessPolicy — T6.1 三维权限契约验证。
 *
 * 覆盖（对齐 clowder-ai `src/domains/limb/LimbAccessPolicy.ts` 语义）：
 * - setPolicy 覆盖已有；check 未配置返回 null
 * - getEffectiveAuth：显式策略优先，回退到能力自身 authLevel
 *
 * @module @flowforge/limb-core/tests
 */

import { describe, expect, it } from 'vitest';
import { LimbAccessPolicy } from '../src/limb-access-policy.js';
import type { LimbCapability } from '../src/index.ts';

function cap(authLevel: LimbCapability['authLevel']): LimbCapability {
  return { cap: 'gpu_render', commands: ['gpu.render'], authLevel };
}

describe('LimbAccessPolicy', () => {
  it('setPolicy 后 check 返回显式级别，未配置返回 null', () => {
    const policy = new LimbAccessPolicy();
    expect(policy.check('cat_a', 'camera-01', 'gpu_render')).toBeNull();

    policy.setPolicy({ catId: 'cat_a', nodeId: 'camera-01', capability: 'gpu_render', authLevel: 'gated' });
    expect(policy.check('cat_a', 'camera-01', 'gpu_render')).toBe('gated');
    // 其他猫不受影响
    expect(policy.check('cat_b', 'camera-01', 'gpu_render')).toBeNull();
  });

  it('setPolicy 覆盖已有条目', () => {
    const policy = new LimbAccessPolicy();
    policy.setPolicy({ catId: 'cat_a', nodeId: 'camera-01', capability: 'gpu_render', authLevel: 'gated' });
    policy.setPolicy({ catId: 'cat_a', nodeId: 'camera-01', capability: 'gpu_render', authLevel: 'free' });
    expect(policy.check('cat_a', 'camera-01', 'gpu_render')).toBe('free');
  });

  it('getEffectiveAuth 显式策略优先', () => {
    const policy = new LimbAccessPolicy();
    policy.setPolicy({ catId: 'cat_a', nodeId: 'camera-01', capability: 'gpu_render', authLevel: 'gated' });
    expect(policy.getEffectiveAuth('cat_a', 'camera-01', cap('leased'))).toBe('gated');
  });

  it('getEffectiveAuth 无显式策略时回退到能力自身 authLevel', () => {
    const policy = new LimbAccessPolicy();
    expect(policy.getEffectiveAuth('cat_a', 'camera-01', cap('leased'))).toBe('leased');
    expect(policy.getEffectiveAuth('cat_a', 'camera-01', cap('free'))).toBe('free');
    expect(policy.getEffectiveAuth('cat_a', 'camera-01', cap('gated'))).toBe('gated');
  });
});

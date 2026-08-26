/**
 * fusion — F35 能力融合测试（EX-010）。
 *
 * 语义对照 flowforge/core/external_agent/test_capability_fusion.py：
 *   - FusionConfig 门槛：min_invocations=3 / min_success_rate=0.7
 *   - weight = min(base_weight * count, max_weight)
 *   - 能力不去重合并 / 盲点合并 / 历史追加
 *
 * @module @flowforge/external-agent/tests
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FUSION_CONFIG,
  ExternalAgentCapabilityFusion,
} from '../src/capability-fusion.js';

const forgekinProfile = {
  forgekin_id: 'fk-1',
  capabilities: ['code-gen'],
  blind_spots: ['deploy'],
};

const externalProfile = {
  provider_name: 'vendor.tool',
  capabilities: ['code-gen', 'review', 'test'],
  blind_spots: ['infra'],
};

describe('ExternalAgentCapabilityFusion（capability_fusion.py fuse）', () => {
  it('调用次数不足不融合（invocation_count < min_invocations）', () => {
    const fusion = new ExternalAgentCapabilityFusion();
    const result = fusion.fuse(forgekinProfile, externalProfile, 2, 1.0);
    expect(result.fused).toBe(false);
    expect(result.fused_capabilities).toEqual([]);
    expect(result.fusion_weight).toBe(0);
    expect(result.reason).toContain('invocation_count=2');
    expect(result.reason).toContain('min_invocations=3');
  });

  it('成功率不足不融合（success_rate < min_success_rate）', () => {
    const fusion = new ExternalAgentCapabilityFusion();
    const result = fusion.fuse(forgekinProfile, externalProfile, 5, 0.5);
    expect(result.fused).toBe(false);
    expect(result.reason).toContain('success_rate=0.5');
  });

  it('门槛通过：融合能力（不去重合并）', () => {
    const fusion = new ExternalAgentCapabilityFusion();
    const result = fusion.fuse(forgekinProfile, externalProfile, 3, 0.8);
    expect(result.fused).toBe(true);
    // 不去重：code-gen 出现 2 次（forgekin + external 合并）
    expect(result.fused_capabilities).toEqual(['code-gen', 'code-gen', 'review', 'test']);
    expect(result.fused_blind_spots).toEqual(['deploy', 'infra']);
  });

  it('权重 = base_weight × count（封顶 max_weight）', () => {
    const fusion = new ExternalAgentCapabilityFusion();
    const r1 = fusion.fuse(forgekinProfile, externalProfile, 3, 0.8);
    expect(r1.fusion_weight).toBeCloseTo(0.3); // 0.1 × 3
    const r2 = fusion.fuse(forgekinProfile, externalProfile, 10, 0.8);
    expect(r2.fusion_weight).toBeCloseTo(0.5); // min(1.0, 0.5)
  });

  it('fused_profile 保留原画像字段并新增能力', () => {
    const fusion = new ExternalAgentCapabilityFusion();
    const result = fusion.fuse(forgekinProfile, externalProfile, 3, 0.8);
    expect(result.fused_profile['forgekin_id']).toBe('fk-1');
    expect(result.fused_profile['capabilities']).toEqual([
      'code-gen',
      'code-gen',
      'review',
      'test',
    ]);
  });

  it('自定义配置生效（Partial<FusionConfig>）', () => {
    const fusion = new ExternalAgentCapabilityFusion({
      min_invocations: 1,
      min_success_rate: 0.0,
      base_weight: 0.2,
      max_weight: 0.8,
    });
    const result = fusion.fuse(forgekinProfile, externalProfile, 1, 0.0);
    expect(result.fused).toBe(true);
    expect(result.fusion_weight).toBeCloseTo(0.2);
  });

  it('fuse_blind_spots=false 时不合并盲点', () => {
    const fusion = new ExternalAgentCapabilityFusion({
      fuse_blind_spots: false,
      min_invocations: 1,
      min_success_rate: 0.0,
    });
    const result = fusion.fuse(forgekinProfile, externalProfile, 1, 0.0);
    expect(result.fused_blind_spots).toEqual([]);
    expect(result.fused_profile['blind_spots']).toEqual(['deploy']);
  });

  it('DEFAULT_FUSION_CONFIG 缺省值正确', () => {
    expect(DEFAULT_FUSION_CONFIG).toMatchObject({
      base_weight: 0.1,
      max_weight: 0.5,
      min_invocations: 3,
      min_success_rate: 0.7,
      fuse_blind_spots: true,
    });
  });

  it('融合历史按 provider 记录（getFusionHistory）', () => {
    const fusion = new ExternalAgentCapabilityFusion({
      min_invocations: 1,
      min_success_rate: 0.0,
    });
    fusion.fuse(forgekinProfile, externalProfile, 1, 0.0);
    fusion.fuse(forgekinProfile, externalProfile, 1, 0.0);
    const history = fusion.getFusionHistory('vendor.tool');
    expect(history).toHaveLength(2);
    expect(history[0]!.provider_name).toBe('vendor.tool');
    expect(history[0]!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('未融合不写历史', () => {
    const fusion = new ExternalAgentCapabilityFusion();
    fusion.fuse(forgekinProfile, externalProfile, 1, 1.0); // 门槛未过
    expect(fusion.getFusionHistory('vendor.tool')).toEqual([]);
  });
});

/**
 * executors — F038 分裂/融合执行器契约验证
 *
 * 覆盖：operator 审批 / 子数上限 / 分裂保留父血缘 + 能力复制与调整 /
 * 融合多父血缘 + 加权合并（weighted_by_performance）/ 规则解析。
 *
 * @module @flowforge/forgekin-lineage/tests
 */

import { describe, expect, it } from 'vitest';
import { loadLineageConfig } from '../src/config.js';
import { LineageFuseExecutor, LineageSplitExecutor, parseLineageExecutorsConfig } from '../src/executors.js';
import type { LineageNode } from '../src/models.js';
import { InMemoryLineageStore } from '../src/store.js';

function makeParent(forgekinId: string, imprint: string, capability: Record<string, unknown>): LineageNode {
  return {
    forgekin_id: forgekinId,
    soul_imprint: imprint,
    species: 'virtual',
    layer_id: 'forgemind',
    created_at: '2026-08-01T00:00:00.000Z',
    relation_to_parents: 'forged',
    parent_soul_imprints: [],
    child_soul_imprints: [],
    capability_profile: capability,
    value_anchors: ['vision-1'],
  };
}

function makeSetup() {
  const store = new InMemoryLineageStore();
  const config = parseLineageExecutorsConfig(
    (loadLineageConfig()['forgekin_lineage'] as Record<string, unknown>)?.['split'] !== undefined
      ? (loadLineageConfig()['forgekin_lineage'] as Record<string, unknown>)
      : {},
  );
  const split = new LineageSplitExecutor(store, config);
  const fuse = new LineageFuseExecutor(store, config);
  return { store, split, fuse };
}

describe('parseLineageExecutorsConfig（YAML 规则解析）', () => {
  it('内置 forgekin-lineage.yaml 解析出分裂/融合规则', () => {
    const lineage = loadLineageConfig()['forgekin_lineage'] as Record<string, unknown>;
    const config = parseLineageExecutorsConfig(lineage);
    expect(config.splitRequireApproval).toBe(true);
    expect(config.maxChildrenPerSplit).toBe(5);
    expect(config.copyCapabilityFromParent).toBe(true);
    expect(config.fuseRequireApproval).toBe(true);
    expect(config.maxParentsPerFuse).toBe(3);
    expect(config.mergeStrategy).toBe('weighted_by_performance');
  });

  it('宽松解析缺省回落内置默认', () => {
    const config = parseLineageExecutorsConfig(undefined);
    expect(config.splitRequireApproval).toBe(true);
    expect(config.maxParentsPerFuse).toBe(3);
  });
});

describe('LineageSplitExecutor 分裂', () => {
  it('未获 operator 批准拒绝', async () => {
    const { store, split } = makeSetup();
    store.addNode(makeParent('writer', 'w', { writing: 0.8 }));
    await expect(
      split.split('writer', { children: [{ name: 'tech', species: 'virtual' }], operator_approved: false, reason: 'x' }),
    ).rejects.toThrow(/operator 批准/);
  });

  it('超过 max_children_per_split 拒绝', async () => {
    const { store, split } = makeSetup();
    store.addNode(makeParent('writer', 'w', { writing: 0.8 }));
    const children = Array.from({ length: 6 }, (_, i) => ({ name: `c${i}`, species: 'virtual' }));
    await expect(
      split.split('writer', { children, operator_approved: true, reason: 'x' }),
    ).rejects.toThrow(/单次分裂最多 5 个/);
  });

  it('分裂保留父血缘 + 生成新 SoulImprint + 能力复制与调整', async () => {
    const { store, split } = makeSetup();
    store.addNode(makeParent('writer', 'w', { writing: 0.8, research: 0.5 }));
    const childIds = await split.split('writer', {
      children: [
        { name: 'tech-blog', species: 'virtual', capability_adjust: { research: 0.9 } },
        { name: 'essay', species: 'virtual' },
      ],
      operator_approved: true,
      reason: '内容细分',
    });
    expect(childIds).toHaveLength(2);
    const tech = store.findNodeByForgekinId(childIds[0]!);
    expect(tech).toBeDefined();
    // 新 SoulImprint ≠ 父
    expect(tech!.soul_imprint).not.toBe('w');
    expect(tech!.soul_imprint).toHaveLength(64); // SHA-256
    expect(tech!.relation_to_parents).toBe('split');
    expect(tech!.parent_soul_imprints).toEqual(['w']);
    // 能力：从父复制 + manifest 调整（覆盖 research）
    expect(tech!.capability_profile['writing']).toBe(0.8);
    expect(tech!.capability_profile['research']).toBe(0.9);
    const essay = store.findNodeByForgekinId(childIds[1]!);
    expect(essay!.capability_profile['writing']).toBe(0.8);
    expect(essay!.capability_profile['research']).toBe(0.5);
    // 父节点被自动记录子血缘
    expect(store.getNode('w').child_soul_imprints).toHaveLength(2);
    // 谱系边审计
    expect(store.listEdges()).toHaveLength(1);
    expect(store.listEdges()[0]!.relation).toBe('split');
  });

  it('父不存在抛错', async () => {
    const { split } = makeSetup();
    await expect(
      split.split('ghost', { children: [{ name: 'x', species: 'virtual' }], operator_approved: true, reason: 'x' }),
    ).rejects.toThrow(/不存在 forgekin_id=ghost/);
  });
});

describe('LineageFuseExecutor 融合', () => {
  it('未获 operator 批准拒绝', async () => {
    const { store, fuse } = makeSetup();
    store.addNode(makeParent('writer', 'w', { writing: 0.8 }));
    store.addNode(makeParent('researcher', 'r', { research: 0.7 }));
    await expect(
      fuse.fuse(['writer', 'researcher'], { name: 'deep-report', species: 'virtual', operator_approved: false, reason: 'x' }),
    ).rejects.toThrow(/operator 批准/);
  });

  it('父数 < 2 拒绝', async () => {
    const { store, fuse } = makeSetup();
    store.addNode(makeParent('writer', 'w', { writing: 0.8 }));
    await expect(
      fuse.fuse(['writer'], { name: 'x', species: 'virtual', operator_approved: true, reason: 'x' }),
    ).rejects.toThrow(/至少需要 2 个父/);
  });

  it('超过 max_parents_per_fuse 拒绝', async () => {
    const { store, fuse } = makeSetup();
    for (let i = 0; i < 4; i += 1) {
      store.addNode(makeParent(`p${i}`, `imprint-${i}`, { x: 0.5 }));
    }
    await expect(
      fuse.fuse(['p0', 'p1', 'p2', 'p3'], { name: 'x', species: 'virtual', operator_approved: true, reason: 'x' }),
    ).rejects.toThrow(/单次融合最多 3 个父/);
  });

  it('融合保留多父血缘 + 能力按权重加权合并', async () => {
    const { store, fuse } = makeSetup();
    store.addNode(makeParent('writer', 'w', { writing: 0.8, research: 0.5, tags: ['writing'] }));
    store.addNode(makeParent('researcher', 'r', { writing: 0.4, research: 0.9, tags: ['research'] }));
    const childId = await fuse.fuse(['writer', 'researcher'], {
      name: 'deep-report',
      species: 'virtual',
      weights: { writer: 1, researcher: 3 },
      operator_approved: true,
      reason: '深度报道',
    });
    const child = store.findNodeByForgekinId(childId);
    expect(child).toBeDefined();
    expect(child!.soul_imprint).toHaveLength(64);
    expect(child!.relation_to_parents).toBe('fused');
    expect(child!.parent_soul_imprints).toEqual(['w', 'r']);
    // 加权平均：writing=(0.8*1+0.4*3)/4=0.5；research=(0.5*1+0.9*3)/4=0.8
    expect(child!.capability_profile['writing']).toBeCloseTo(0.5, 5);
    expect(child!.capability_profile['research']).toBeCloseTo(0.8, 5);
    // 数组并集
    expect(child!.capability_profile['tags']).toEqual(['writing', 'research']);
    // 双父血缘在边中记录
    expect(store.listEdges()).toHaveLength(1);
    expect(store.listEdges()[0]!.from_soul_imprints).toEqual(['w', 'r']);
    // 父节点被自动记录子血缘
    expect(store.getNode('w').child_soul_imprints).toContain(child!.soul_imprint);
    expect(store.getNode('r').child_soul_imprints).toContain(child!.soul_imprint);
  });

  it('父不存在抛错', async () => {
    const { store, fuse } = makeSetup();
    store.addNode(makeParent('writer', 'w', { writing: 0.8 }));
    await expect(
      fuse.fuse(['writer', 'ghost'], { name: 'x', species: 'virtual', operator_approved: true, reason: 'x' }),
    ).rejects.toThrow(/不存在 forgekin_id=ghost/);
  });
});

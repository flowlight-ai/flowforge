/**
 * store — F038 谱系存储契约验证
 *
 * 覆盖：节点/边写入与校验（soul_imprint 锚点唯一、forgekin_id 唯一）、
 * addEdge 自动维护父子索引、双向遍历（祖先/后代 + 深度限制）。
 *
 * @module @flowforge/forgekin-lineage/tests
 */

import { describe, expect, it } from 'vitest';
import type { LineageEdge, LineageNode } from '../src/models.js';
import { InMemoryLineageStore } from '../src/store.js';

function makeNode(overrides: Partial<LineageNode> = {}): LineageNode {
  return {
    forgekin_id: 'fk-1',
    soul_imprint: 'imprint-1',
    species: 'virtual',
    layer_id: 'forgemind',
    created_at: '2026-08-01T00:00:00.000Z',
    relation_to_parents: 'forged',
    parent_soul_imprints: [],
    child_soul_imprints: [],
    capability_profile: { writing: 0.5 },
    value_anchors: ['vision-1'],
    ...overrides,
  };
}

function makeEdge(overrides: Partial<LineageEdge> = {}): LineageEdge {
  return {
    edge_id: 'edge-1',
    relation: 'split',
    from_soul_imprints: ['imprint-1'],
    to_soul_imprints: ['imprint-2'],
    timestamp: '2026-08-01T00:00:00.000Z',
    operator_approved: true,
    capability_snapshot: {},
    trigger_reason: 'test',
    ...overrides,
  };
}

describe('LineageStore 节点写入', () => {
  it('forged 节点入谱成功（无父）', () => {
    const store = new InMemoryLineageStore();
    store.addNode(makeNode());
    expect(store.count()).toBe(1);
    expect(store.getNode('imprint-1').forgekin_id).toBe('fk-1');
  });

  it('重复 soul_imprint 抛错（F038 AC-1 锚点唯一）', () => {
    const store = new InMemoryLineageStore();
    store.addNode(makeNode());
    expect(() => store.addNode(makeNode())).toThrow(/soul_imprint=imprint-1/);
  });

  it('重复 forgekin_id 抛错（同一 Forgekin 不可重复入谱）', () => {
    const store = new InMemoryLineageStore();
    store.addNode(makeNode());
    expect(() => store.addNode(makeNode({ soul_imprint: 'imprint-2' }))).toThrow(/forgekin_id=fk-1/);
  });

  it('split 节点必须恰好 1 个父', () => {
    const store = new InMemoryLineageStore();
    expect(() =>
      store.addNode(makeNode({ relation_to_parents: 'split', parent_soul_imprints: [] })),
    ).toThrow(/split 节点必须有且仅有 1 个父/);
  });

  it('fused 节点必须至少 2 个父', () => {
    const store = new InMemoryLineageStore();
    expect(() =>
      store.addNode(makeNode({ relation_to_parents: 'fused', parent_soul_imprints: ['a'] })),
    ).toThrow(/fused 节点必须至少有 2 个父/);
  });

  it('空 soul_imprint 抛错', () => {
    const store = new InMemoryLineageStore();
    expect(() => store.addNode(makeNode({ soul_imprint: '  ' }))).toThrow(/soul_imprint 不能为空/);
  });

  it('查询不存在节点抛错 / 反查不存在 forgekin_id 返回 undefined', () => {
    const store = new InMemoryLineageStore();
    expect(() => store.getNode('ghost')).toThrow(/不存在/);
    expect(store.findNodeByForgekinId('ghost')).toBeUndefined();
  });
});

describe('LineageStore 边写入与父子索引', () => {
  it('addEdge 自动维护父节点 child_soul_imprints', () => {
    const store = new InMemoryLineageStore();
    store.addNode(makeNode());
    store.addNode(makeNode({ forgekin_id: 'fk-2', soul_imprint: 'imprint-2', relation_to_parents: 'split', parent_soul_imprints: ['imprint-1'] }));
    store.addEdge(makeEdge());
    expect(store.getNode('imprint-1').child_soul_imprints).toContain('imprint-2');
    expect(store.getNode('imprint-2').parent_soul_imprints).toContain('imprint-1');
  });

  it('split 边必须恰好 1 个源', () => {
    const store = new InMemoryLineageStore();
    expect(() =>
      store.addEdge(makeEdge({ from_soul_imprints: ['a', 'b'] })),
    ).toThrow(/split 边必须恰好 1 个源/);
  });

  it('fused 边必须恰好 1 个目标', () => {
    const store = new InMemoryLineageStore();
    expect(() =>
      store.addEdge(makeEdge({ relation: 'fused', from_soul_imprints: ['a', 'b'], to_soul_imprints: ['c', 'd'] })),
    ).toThrow(/fused 边必须恰好 1 个目标/);
  });

  it('重复 edge_id 抛错', () => {
    const store = new InMemoryLineageStore();
    store.addEdge(makeEdge());
    expect(() => store.addEdge(makeEdge())).toThrow(/edge_id=edge-1/);
  });
});

describe('LineageStore 双向遍历', () => {
  function buildTree(): InMemoryLineageStore {
    const store = new InMemoryLineageStore();
    // 根（写作 Forgekin）
    store.addNode(makeNode({ forgekin_id: 'writer', soul_imprint: 'w' }));
    // 分裂出两个子
    store.addNode(makeNode({ forgekin_id: 'tech-blog', soul_imprint: 't', relation_to_parents: 'split', parent_soul_imprints: ['w'] }));
    store.addNode(makeNode({ forgekin_id: 'essay', soul_imprint: 'e', relation_to_parents: 'split', parent_soul_imprints: ['w'] }));
    store.addEdge(makeEdge({ edge_id: 'e1', from_soul_imprints: ['w'], to_soul_imprints: ['t', 'e'] }));
    // 技术博客再分裂
    store.addNode(makeNode({ forgekin_id: 'deep-report', soul_imprint: 'd', relation_to_parents: 'split', parent_soul_imprints: ['t'] }));
    store.addEdge(makeEdge({ edge_id: 'e2', from_soul_imprints: ['t'], to_soul_imprints: ['d'] }));
    return store;
  }

  it('getAncestry 向上查祖先（深度限制）', () => {
    const store = buildTree();
    const ancestry = store.getAncestry('d', 2);
    expect(ancestry.map((n) => n.soul_imprint)).toEqual(['t', 'w']);
    const shallow = store.getAncestry('d', 1);
    expect(shallow.map((n) => n.soul_imprint)).toEqual(['t']);
  });

  it('getDescendants 向下查后代（深度限制）', () => {
    const store = buildTree();
    const descendants = store.getDescendants('w', 2);
    expect(descendants.map((n) => n.soul_imprint).sort()).toEqual(['d', 'e', 't']);
    const shallow = store.getDescendants('w', 1);
    expect(shallow.map((n) => n.soul_imprint).sort()).toEqual(['e', 't']);
  });

  it('depth ≤ 0 表示不限制深度', () => {
    const store = buildTree();
    expect(store.getAncestry('d', 0).map((n) => n.soul_imprint)).toEqual(['t', 'w']);
    expect(store.getDescendants('w', 0).map((n) => n.soul_imprint).sort()).toEqual(['d', 'e', 't']);
  });

  it('listEdges 审计全部边', () => {
    const store = buildTree();
    expect(store.listEdges()).toHaveLength(2);
  });
});
